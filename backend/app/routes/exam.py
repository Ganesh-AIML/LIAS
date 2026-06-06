import time
import json
import bcrypt
import logging
from typing import Literal, Dict, Any
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, ValidationError, Field
from app.database import get_db
from app.auth import verify_session_guard
from app.models import Exam, ViolationLog, TokenRegistry, Question, CodingProblem, TestCase
from app.limiter import limiter

router = APIRouter()
logger = logging.getLogger("scope")

ALLOWED_EVENTS = {
    "tab_switch", "fullscreen_exit", "copy_paste", "devtools",
    "face_absent", "multi_person", "right_click", "keyboard_shortcut",
}

class SubmissionPayloadSchema(BaseModel):
    mcqs: Dict[str, str] = {}
    coding: Dict[str, Any] = {}


class ViolationPayload(BaseModel):
    event_type: str
    detail:     str = Field(default="", max_length=1024)


class SubmitPayload(BaseModel):
    answers:    dict
    autoSubmit: bool = False


class PasswordVerifyPayload(BaseModel):
    type:     Literal["start", "end"]
    password: str


# ── VIOLATION ROUTES ───────────────────────────────────────────────────────────

@router.post("/violation")
def log_violation(
    payload:        ViolationPayload,
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    if payload.event_type not in ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail="Unknown event type.")
    entry = ViolationLog(
        session_id  = active_session.id,
        student_id  = active_session.student_id,
        exam_id     = active_session.exam_id,
        event_type  = payload.event_type,
        occurred_at = time.time(),
        detail      = payload.detail[:256] if payload.detail else "",
    )
    db.add(entry)

    # 🚀 H-02: Server-Side Anti-Cheat Enforcement (3 Strikes = Out)
    current_violations = db.query(ViolationLog).filter(ViolationLog.session_id == active_session.id).count()
    if current_violations >= 2: # The new entry makes it 3
        active_session.is_revoked = True

    db.commit()
    return {"success": True, "revoked": active_session.is_revoked}


@router.get("/violation/count")
def get_violation_count(
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    results = (
        db.query(ViolationLog.event_type, func.count(ViolationLog.id))
        .filter(ViolationLog.session_id == active_session.id)
        .group_by(ViolationLog.event_type)
        .all()
    )
    breakdown = {e: 0 for e in ALLOWED_EVENTS}
    total = 0
    for event_type, count in results:
        breakdown[event_type] = count
        total += count

    return {"success": True, "count": total, "breakdown": breakdown}


# ── DASHBOARD FEED ─────────────────────────────────────────────────────────────

@router.get("/student/available-tests")
def get_available_tests(
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    token_record = (
        db.query(TokenRegistry)
        .filter(
            TokenRegistry.student_id == active_session.student_id,
            TokenRegistry.exam_id    == active_session.exam_id,
        )
        .first()
    )
    if not token_record:
        raise HTTPException(status_code=404, detail="Student record not found.")

    exam_record = db.query(Exam).filter(Exam.id == token_record.exam_id).first()

    return {
        "success": True,
        "data": {
            "profile": {
                "name":           token_record.student_id,
                "email":          f"{token_record.student_id.lower()}@college.edu",
                "studentProfile": {
                    "rollNo":  token_record.token,
                    "branch":  "General",
                    "batch":   "2026",
                },
            },
            "availableTests": [
                {
                    "id":             exam_record.id,
                    "title":          exam_record.title,
                    "date":           exam_record.starts_at * 1000,
                    "duration":       exam_record.duration_seconds // 60,
                    "codingDuration": 60,
                }
            ] if exam_record else [],
            "pastResults": [],
        },
    }


# ── UPDATED EXAM WORKSPACE FEED: 100% DATABASE DRIVEN ──────────────────────────

@router.get("/{exam_id}")
def load_exam_workspace(
    exam_id:        str,
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    """
    Fetches real dynamic exam content (MCQs & Coding Problems) from the database
    to construct the workspace payload for the candidate session.
    """
    exam_record = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam_record:
        raise HTTPException(status_code=404, detail="Exam not found.")

    # 1. Fetch dynamic questions and coding tasks attached to this test ID
    db_questions = db.query(Question).filter(Question.exam_id == exam_id).all()
    db_coding    = db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).all()

    # 2. Map and group questions by their custom section name dynamically
    sections_map = defaultdict(list)
    for q in db_questions:
        sections_map[q.section].append({
            "id":              q.id,
            "text":            q.text,
            "shuffledOptions": [
                {"label": "A", "text": q.optA},
                {"label": "B", "text": q.optB},
                {"label": "C", "text": q.optC},
                {"label": "D", "text": q.optD},
            ]
        })

    # Transform grouped map back into structured array matching workspace layout
    formatted_sections = []
    for section_name, questions_list in sections_map.items():
        formatted_sections.append({
            "name":      section_name,
            "category":  "Technical" if "tech" in section_name.lower() else "Aptitude",
            "questions": questions_list
        })

    # 3. Format coding tasks for compilation testing
    formatted_coding = []
    for cp in db_coding:
        formatted_coding.append({
            "id":          cp.id,
            "title":       cp.title,
            "description": cp.description,
            "constraints": cp.constraints or "",
            "marks":       10  # Standard point allocation weight
        })

    return {
        "success": True,
        "data": {
            "id":             exam_record.id,
            "title":          exam_record.title,
            "date":           exam_record.starts_at * 1000,
            "duration":       exam_record.duration_seconds // 60,
            "maxViolations":  3,
            "codingProblems": formatted_coding,
            "sections":       formatted_sections,
        },
    }


@router.post("/{exam_id}/verify-password")
@limiter.limit("10/minute")
def verify_exam_password(
    request:        Request,
    exam_id:        str,
    payload:        PasswordVerifyPayload,
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    exam_record = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam_record:
        raise HTTPException(status_code=404, detail="Exam not found.")

    target_hash = (
        exam_record.start_password_hash
        if payload.type == "start"
        else exam_record.end_password_hash
    )

    # 🚀 Fix: If checking end password, and the admin left it blank, auto-approve!
    if payload.type == "end" and not target_hash:
        return {"success": True}

    if not target_hash or not bcrypt.checkpw(
        payload.password.encode("utf-8"),
        target_hash.encode("utf-8"),
    ):
        raise HTTPException(
            status_code=403,
            detail=f"Incorrect {payload.type.capitalize()} Password.",
        )

    return {"success": True}


# ── UPDATED SUBMIT ROUTE: PERSISTS REAL TELEMETRY RESPONSE DATA ──────────────

@router.post("/{exam_id}/submit")
def submit_exam(
    exam_id:        str,
    payload:        SubmitPayload,
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    """
    Finalizes the candidate session and saves response data arrays securely 
    to the centralized database column for automated evaluation grading.
    """
    # 🚀 H-08: Prevent cross-exam injection
    if active_session.exam_id != exam_id:
        raise HTTPException(status_code=403, detail="Session token does not match target exam.")

    answers_data = payload.answers if payload.answers else {}

    try:
        validated_data = SubmissionPayloadSchema(**answers_data)
    except ValidationError:
        raise HTTPException(status_code=400, detail="Malformed submission payload. Missing 'mcqs' or 'coding' keys.")

    if active_session.is_submitted:
        raise HTTPException(status_code=400, detail="Exam already submitted.")
        
    # 🚀 Crucial Fix: Saves live response telemetry to feed the grading analytics engines
    active_session.submission_payload = json.dumps(payload.answers)
    active_session.is_submitted = True
    
    db.commit()
    return {"success": True, "message": "Exam submitted securely."}