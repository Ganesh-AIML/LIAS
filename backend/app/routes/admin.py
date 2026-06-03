import os
import uuid
import json
import time
import bcrypt
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, field_validator

from app.database import get_db
# 🚀 Added the new models to the import
from app.models import Exam, TokenRegistry, ExamSession, ViolationLog, Question, CodingProblem, TestCase

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")
router = APIRouter()
logger = logging.getLogger("scope")

# ── AUTH GUARD ─────────────────────────────────────────────────────────────────
def verify_admin(x_admin_token: str = Header(None)):
    import secrets
    if (
        not ADMIN_SECRET
        or not x_admin_token
        or not secrets.compare_digest(x_admin_token, ADMIN_SECRET)
    ):
        raise HTTPException(status_code=403, detail="Unauthorized.")
    return True

# ── NEW PYDANTIC SCHEMAS FOR DYNAMIC EXAMS ─────────────────────────────────────

class QuestionPayload(BaseModel):
    section: str
    text: str
    optA: str
    optB: str
    optC: str
    optD: str
    ans: str

class TestCasePayload(BaseModel):
    input: str
    output: str
    isHidden: bool  # React uses camelCase

class CodingProblemPayload(BaseModel):
    title: str
    description: str
    constraints: Optional[str] = ""
    languages: str
    testCases: List[TestCasePayload] = []

class ExamCreatePayload(BaseModel):
    title:               str
    duration_minutes:    int
    starts_at:           float          # Unix timestamp (ms from frontend → divide by 1000)
    start_password:      str
    end_password:        Optional[str]  = None
    status:              str            = "upcoming"
    
    # 🚀 Nested arrays for dynamic content
    questions:           List[QuestionPayload] = []
    coding_problems:     List[CodingProblemPayload] = []

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Exam title cannot be empty.")
        return v

# ── UPDATED POST ROUTE: CREATE EXAM WITH ALL CONTENT ──────────────────────────

@router.post("/exams")
def create_exam(
    payload: ExamCreatePayload,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Creates an exam along with all its MCQs, Coding Problems, and Test Cases atomically.
    """
    try:
        exam_id = f"exam_{uuid.uuid4().hex[:8]}"

        # 1. Hash Passwords
        start_hash = bcrypt.hashpw(payload.start_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        end_hash = None
        if payload.end_password:
            end_hash = bcrypt.hashpw(payload.end_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

        # 2. Build the Exam Object
        new_exam = Exam(
            id                  = exam_id,
            title               = payload.title,
            duration_seconds    = payload.duration_minutes * 60,
            starts_at           = payload.starts_at / 1000.0, # Convert ms to seconds
            start_password_hash = start_hash,
            end_password_hash   = end_hash,
            status              = payload.status
        )
        db.add(new_exam)

        # 3. Build Question (MCQ) Objects
        for idx, q in enumerate(payload.questions):
            new_q = Question(
                id      = f"q_{exam_id}_{idx}_{uuid.uuid4().hex[:6]}",
                exam_id = exam_id,
                section = q.section,
                text    = q.text,
                optA    = q.optA,
                optB    = q.optB,
                optC    = q.optC,
                optD    = q.optD,
                ans     = q.ans
            )
            db.add(new_q)

        # 4. Build Coding Problem & Test Case Objects
        for p_idx, cp in enumerate(payload.coding_problems):
            cp_id = f"cp_{exam_id}_{p_idx}_{uuid.uuid4().hex[:6]}"
            new_cp = CodingProblem(
                id          = cp_id,
                exam_id     = exam_id,
                title       = cp.title,
                description = cp.description,
                constraints = cp.constraints,
                languages   = cp.languages
            )
            db.add(new_cp)

            # Build nested Test Cases
            for t_idx, tc in enumerate(cp.testCases):
                new_tc = TestCase(
                    id              = f"tc_{cp_id}_{t_idx}_{uuid.uuid4().hex[:4]}",
                    problem_id      = cp_id,
                    input_data      = tc.input,
                    expected_output = tc.output,
                    is_hidden       = tc.isHidden
                )
                db.add(new_tc)

        # 5. Atomic Commit (All or Nothing)
        db.commit()
        return {"success": True, "exam_id": exam_id, "message": "Exam created successfully"}

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create exam: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to save exam data to the database.")
    

@router.get("/exams/{exam_id}/analytics")
def get_exam_analytics(
    exam_id: str,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Fetches exam details, auto-grades all MCQ and Coding submissions on the fly,
    and returns the comprehensive analytics matrix expected by the React frontend.
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    # 1. Fetch Master Data
    questions = db.query(Question).filter(Question.exam_id == exam_id).all()
    coding_probs = db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).all()
    sessions = db.query(ExamSession).filter(ExamSession.exam_id == exam_id, ExamSession.is_revoked == False).all()

    # Map questions for O(1) grading lookups
    q_map = {q.id: q for q in questions}

    student_results = []

    # 2. Process and Grade each Session
    for s in sessions:
        apt_score = 0
        tech_score = 0
        cod_score = 0
        coding_submissions = []

        # Safely parse submission JSON
        payload = {}
        if s.submission_payload:
            try:
                payload = json.loads(s.submission_payload)
            except Exception:
                pass
        
        mcq_answers = payload.get("mcqs", {})    # Format expected from frontend: {"q_123": "A"}
        code_answers = payload.get("coding", {}) # Format: {"cp_123": {"code": "...", "score": 10, "runtime": 0.5, "results": [...]}}

        # ── GRADE MCQs ──
        for q_id, ans in mcq_answers.items():
            if q_id in q_map and q_map[q_id].ans == ans:
                if q_map[q_id].section.lower() == 'aptitude':
                    apt_score += 1
                else:
                    tech_score += 1
        
        # ── EXTRACT CODING RESULTS ──
        for cp in coding_probs:
            cp_data = code_answers.get(cp.id)
            if cp_data:
                cod_score += cp_data.get("score", 0)
                coding_submissions.append({
                    "problemId": cp.id,
                    "problemTitle": cp.title,
                    "isAttempted": True,
                    "runtime": cp_data.get("runtime", "0.00"),
                    "memory": cp_data.get("memory", "0"),
                    "submittedCode": cp_data.get("code", ""),
                    "testResults": cp_data.get("results", [])
                })
            else:
                coding_submissions.append({
                    "problemId": cp.id,
                    "problemTitle": cp.title,
                    "isAttempted": False
                })

        # Heuristic: Extract Department from Roll No (e.g., 23-AIML50-27 -> AIML)
        dept = "General"
        if "-" in s.student_id:
            parts = s.student_id.split("-")
            if len(parts) >= 2:
                dept = parts[1][:4].upper()

        student_results.append({
            "student_id": s.student_id,
            "department": dept,
            "submitted": s.is_submitted,
            "joined_at": s.created_at,
            "apt_score": apt_score,
            "tech_score": tech_score,
            "cod_score": cod_score,
            "coding_submissions": coding_submissions
        })

    # 3. Return Payload matching AnalyticsView.jsx expectations
    return {
        "success": True,
        "data": {
            "exam_id": exam_id,
            "title": exam.title,
            "questions": [{"id": q.id, "section": q.section, "text": q.text} for q in questions],
            "coding_problems": [{"id": cp.id, "title": cp.title} for cp in coding_probs],
            "students": student_results
        }
    }