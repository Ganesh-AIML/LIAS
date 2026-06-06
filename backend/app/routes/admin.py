import os
import uuid
import json
import time
import bcrypt
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from pydantic import BaseModel, field_validator
from cryptography.fernet import Fernet
import base64
from app.database import get_db
from app.models import Exam, TokenRegistry, ExamSession, ViolationLog, Question, CodingProblem, TestCase

ENCRYPTION_KEY = os.getenv("DB_ENCRYPTION_KEY", "b3Nf8x_T2lQ4vG9b_X1vR5wP3yL8sJ2nR7tC6qK9hM0=")
cipher_suite = Fernet(ENCRYPTION_KEY.encode('utf-8'))

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


# ── LOGIN VERIFICATION ─────────────────────────────────────────────────────────
@router.get("/verify")
def verify_admin_login(_: bool = Depends(verify_admin)):
    """Explicit endpoint used by the frontend to validate the X-Admin-Token."""
    return {"success": True, "message": "Admin verified"}



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
    start_password_changed: Optional[bool] = None
    end_password_changed: Optional[bool] = None
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
        start_hash = bcrypt.hashpw(payload.start_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
        end_hash = None
        if payload.end_password:
            end_hash = bcrypt.hashpw(payload.end_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")

        enc_start = cipher_suite.encrypt(payload.start_password.encode("utf-8")).decode("utf-8") if payload.start_password else None
        enc_end = cipher_suite.encrypt(payload.end_password.encode("utf-8")).decode("utf-8") if payload.end_password else None

        new_exam = Exam(
            id=exam_id, title=payload.title, duration_seconds=payload.duration_minutes * 60,
            starts_at=payload.starts_at / 1000.0, status=payload.status,
            start_password_hash=start_hash, end_password_hash=end_hash,
            start_secret=enc_start, end_secret=enc_end 
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
    

@router.put("/exams/{exam_id}")
def update_exam(
    exam_id: str,
    payload: ExamCreatePayload,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Updates an existing draft exam. 
    It atomically purges old questions/problems and replaces them with the new payload.
    """
    try:
        exam = db.query(Exam).filter(Exam.id == exam_id).first()
        if not exam:
            raise HTTPException(status_code=404, detail="Exam not found.")

        # 1. Update Meta
        exam.title = payload.title
        exam.duration_seconds = payload.duration_minutes * 60
        exam.starts_at = payload.starts_at / 1000.0
        exam.status = payload.status

        if payload.start_password_changed is not False and payload.start_password:
            exam.start_password_hash = bcrypt.hashpw(payload.start_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            exam.start_secret = cipher_suite.encrypt(payload.start_password.encode("utf-8")).decode("utf-8")
            
        if payload.end_password_changed is not False and payload.end_password:
            exam.end_password_hash = bcrypt.hashpw(payload.end_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            exam.end_secret = cipher_suite.encrypt(payload.end_password.encode("utf-8")).decode("utf-8") 

        # 2. Purge old nested data (Cascades will handle test cases)
        db.query(Question).filter(Question.exam_id == exam_id).delete()
        db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).delete()

        # 3. Re-insert new Questions
        for idx, q in enumerate(payload.questions):
            new_q = Question(
                id=f"q_{exam_id}_{idx}_{uuid.uuid4().hex[:6]}",
                exam_id=exam_id, section=q.section, text=q.text,
                optA=q.optA, optB=q.optB, optC=q.optC, optD=q.optD, ans=q.ans
            )
            db.add(new_q)

        # 4. Re-insert new Coding Problems & Test Cases
        for p_idx, cp in enumerate(payload.coding_problems):
            cp_id = f"cp_{exam_id}_{p_idx}_{uuid.uuid4().hex[:6]}"
            new_cp = CodingProblem(
                id=cp_id, exam_id=exam_id, title=cp.title,
                description=cp.description, constraints=cp.constraints, languages=cp.languages
            )
            db.add(new_cp)

            for t_idx, tc in enumerate(cp.testCases):
                new_tc = TestCase(
                    id=f"tc_{cp_id}_{t_idx}_{uuid.uuid4().hex[:4]}",
                    problem_id=cp_id, input_data=tc.input,
                    expected_output=tc.output, is_hidden=tc.isHidden
                )
                db.add(new_tc)

        db.commit()
        return {"success": True, "message": "Exam updated successfully"}

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update exam: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to update exam data.")



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
                # TODO: Replace cp_data.get("score") with server-computed score once Judge0 is integrated. 
                # Client-submitted scores are NOT trusted for production grading.
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


# ── 1. GET FULL EXAM DETAILS (For Preview Mode) ─────────────────────────────────
@router.get("/exams/{exam_id}")
def get_exam_full(exam_id: str, _: bool = Depends(verify_admin), db: Session = Depends(get_db)):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam: raise HTTPException(status_code=404)
    
    qs = db.query(Question).filter(Question.exam_id == exam_id).all()
    cps = db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).all()
    
    return {"success": True, "data": {
        "id": exam.id,
        "title": exam.title,
        "duration_minutes": exam.duration_seconds // 60,
        "questions": [{"id": q.id, "section": q.section, "text": q.text, "optA": q.optA, "optB": q.optB, "optC": q.optC, "optD": q.optD, "ans": q.ans} for q in qs],
        "coding_problems": [{"id": cp.id, "title": cp.title, "description": cp.description, "constraints": cp.constraints} for cp in cps]
    }}

@router.get("/exams/{exam_id}/monitor")
def get_live_monitor(exam_id: str, _: bool = Depends(verify_admin), db: Session = Depends(get_db)):
    enrolled = db.query(TokenRegistry).filter(TokenRegistry.exam_id == exam_id).count()
    sessions = db.query(ExamSession).filter(ExamSession.exam_id == exam_id, ExamSession.is_revoked == False).all()
    
    session_ids = [s.id for s in sessions]
    violation_counts = {}
    if session_ids:
        v_data = db.query(ViolationLog.session_id, func.count(ViolationLog.id)).filter(ViolationLog.session_id.in_(session_ids)).group_by(ViolationLog.session_id).all()
        violation_counts = {row[0]: row[1] for row in v_data}

    active_now = 0; total_submitted = 0; student_data = []
    for s in sessions:
        if s.is_submitted: total_submitted += 1
        else: active_now += 1
            
        violations = violation_counts.get(s.id, 0)
        student_data.append({
            "student_id": s.student_id, "session_id": s.id,
            "submitted": s.is_submitted, "total_violations": violations,
            "joined_at": s.created_at
        })
        
    return {"success": True, "data": {
        "total_enrolled": enrolled, "active_now": active_now, 
        "total_submitted": total_submitted, "students": student_data
    }}

# ── 3. POST KICK-OUT (REVOKE SESSION) ──────────────────────────────────────────
class RevokePayload(BaseModel):
    session_id: str

@router.post("/sessions/revoke")
def revoke_session(payload: RevokePayload, _: bool = Depends(verify_admin), db: Session = Depends(get_db)):
    session = db.query(ExamSession).filter(ExamSession.id == payload.session_id).first()
    if session:
        session.is_revoked = True
        db.commit()
    return {"success": True}

# ── 4. STUDENT DIRECTORY CRUD ──────────────────────────────────────────────────
class StudentCreatePayload(BaseModel):
    student_id: str
    exam_id: str
    password: str

class StudentsBulkPayload(BaseModel):
    students: List[StudentCreatePayload]


# ── 1. ADD THIS BULK DELETE ENDPOINT ──
class BulkDeletePayload(BaseModel):
    tokens: List[str]

@router.post("/students/bulk-delete")
def bulk_delete_students(payload: BulkDeletePayload, _: bool = Depends(verify_admin), db: Session = Depends(get_db)):
    """High-Performance route to delete multiple students at once."""
    if payload.tokens:
        # synchronize_session=False makes bulk deletes massively faster in SQLAlchemy
        db.query(TokenRegistry).filter(TokenRegistry.token.in_(payload.tokens)).delete(synchronize_session=False)
        db.commit()
    return {"success": True}

# ── GET ALL STUDENTS (Fortified with Auto-Migration) ───────────────────────────
@router.get("/students")
def list_students(
    exam_id: Optional[str] = None,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """Fetch all students. Includes root-level schema self-healing."""

    query = db.query(TokenRegistry)
    if exam_id:
        query = query.filter(TokenRegistry.exam_id == exam_id)
    records = query.all()

    if not records:
        return {"success": True, "data": []}

    student_ids = [r.student_id for r in records]
    
    # Bulk fetch sessions
    sessions = (
        db.query(ExamSession)
        .filter(
            ExamSession.student_id.in_(student_ids),
            ExamSession.is_revoked == False
        )
        .order_by(ExamSession.created_at.desc())
        .all()
    )
    
    session_map = {}
    for s in sessions:
        key = (s.student_id, s.exam_id)
        if key not in session_map:
            session_map[key] = s

    result = []
    for r in records:
        session = session_map.get((r.student_id, r.exam_id))
        result.append({
            "token":      r.token,
            "student_id": r.student_id,
            "exam_id":    r.exam_id,
            "is_active":  r.is_active,
            "submitted":  session.is_submitted if session else False,
            "session_id": session.id if session else None,
        })
    return {"success": True, "data": result}


# ── POST STUDENTS (Fortified with Upsert Logic to prevent duplicates) ──────────
@router.post("/students")
def create_students(payload: StudentsBulkPayload, _: bool = Depends(verify_admin), db: Session = Depends(get_db)):
    import secrets

    for s in payload.students:
        # 🚀 ROOT FIX 2: Upsert Logic (Check if student already exists for this exam)
        existing_record = db.query(TokenRegistry).filter(
            TokenRegistry.student_id == s.student_id,
            TokenRegistry.exam_id == s.exam_id
        ).first()
        
        hashed = bcrypt.hashpw(s.password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
        
        if existing_record:
            # UPDATE: Overwrite password and reactivate, but KEEP the same token
            existing_record.password_hash = hashed
            existing_record.is_active = True
        else:
            # INSERT: Brand new student, mint a new token
            token = f"LIAS_{s.student_id.upper()}_{secrets.token_hex(4).upper()}"
            db.add(TokenRegistry(
                token=token, exam_id=s.exam_id, student_id=s.student_id,
                password_hash=hashed, is_active=True
            ))
            
    db.commit()
    return {"success": True}

class StudentUpdatePayload(BaseModel):
    password: Optional[str] = None
    is_active: bool

@router.put("/students/{token}")
def update_student(token: str, payload: StudentUpdatePayload, _: bool = Depends(verify_admin), db: Session = Depends(get_db)):
    record = db.query(TokenRegistry).filter(TokenRegistry.token == token).first()
    if not record: raise HTTPException(status_code=404)
    record.is_active = payload.is_active
    if payload.password:
        record.password_hash = bcrypt.hashpw(payload.password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
    db.commit()
    return {"success": True}

@router.delete("/students/{token}")
def delete_student(token: str, _: bool = Depends(verify_admin), db: Session = Depends(get_db)):
    db.query(TokenRegistry).filter(TokenRegistry.token == token).delete()
    db.commit()
    return {"success": True}

# ── 2. REPLACE YOUR EXISTING list_exams FUNCTION WITH THIS ──
@router.get("/exams")
def list_exams(_: bool = Depends(verify_admin), db: Session = Depends(get_db)):    

    exams = db.query(Exam).all()
    now = time.time()
    active_sessions = db.query(ExamSession.exam_id, ExamSession.is_submitted).filter(ExamSession.is_revoked == False).all()
    
    counts_map = {}
    for session in active_sessions:
        if session.exam_id not in counts_map: counts_map[session.exam_id] = {"total": 0, "submitted": 0}
        counts_map[session.exam_id]["total"] += 1
        if session.is_submitted: counts_map[session.exam_id]["submitted"] += 1

    result = []
    for exam in exams:
        if exam.status == "draft": computed_status = "draft"
        else:
            end_at = exam.starts_at + exam.duration_seconds
            if exam.starts_at > now: computed_status = "upcoming"
            elif now <= end_at: computed_status = "live"
            else: computed_status = "completed"

        dec_start, dec_end = "********", "********"
        try:
            if exam.start_secret: dec_start = cipher_suite.decrypt(exam.start_secret.encode("utf-8")).decode("utf-8")
            if exam.end_secret: dec_end = cipher_suite.decrypt(exam.end_secret.encode("utf-8")).decode("utf-8")
        except Exception:
            pass

        stats = counts_map.get(exam.id, {"total": 0, "submitted": 0})
        result.append({
            "id": exam.id, "title": exam.title, "duration_minutes": exam.duration_seconds // 60,
            "starts_at_ms": exam.starts_at * 1000, "status": computed_status,
            "participants": stats["total"], "submitted": stats["submitted"],
            "start_password": dec_start, "end_password": dec_end 
        })
    return {"success": True, "data": result}

@router.delete("/exams/{exam_id}")
def delete_exam(exam_id: str, _: bool = Depends(verify_admin), db: Session = Depends(get_db)):
    try:
        # 1. Clean up violation logs attached to this exam's sessions
        session_ids = [s.id for s in db.query(ExamSession.id).filter(ExamSession.exam_id == exam_id).all()]
        if session_ids:
            db.query(ViolationLog).filter(ViolationLog.session_id.in_(session_ids)).delete(synchronize_session=False)
        
        # 2. Clean up test cases attached to this exam's coding problems
        problem_ids = [p.id for p in db.query(CodingProblem.id).filter(CodingProblem.exam_id == exam_id).all()]
        if problem_ids:
            db.query(TestCase).filter(TestCase.problem_id.in_(problem_ids)).delete(synchronize_session=False)
            
        # 3. Clean up core child tables
        db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).delete(synchronize_session=False)
        db.query(Question).filter(Question.exam_id == exam_id).delete(synchronize_session=False)
        db.query(ExamSession).filter(ExamSession.exam_id == exam_id).delete(synchronize_session=False)
        db.query(TokenRegistry).filter(TokenRegistry.exam_id == exam_id).delete(synchronize_session=False)

        # 4. Finally, safely delete the parent Exam
        db.query(Exam).filter(Exam.id == exam_id).delete(synchronize_session=False)
        db.commit()
        return {"success": True}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Safe cascade delete failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete exam and its nested records.")