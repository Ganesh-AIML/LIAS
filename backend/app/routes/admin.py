import uuid
import time
import bcrypt
import secrets
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, field_validator

from app.database import get_db
from app.models import Exam, TokenRegistry, ExamSession, ViolationLog
from app.limiter import limiter
import os, socketio as _sio_module
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")
# sio instance injected via app state at request time

router = APIRouter()
logger = logging.getLogger("scope")


# ── AUTH GUARD ─────────────────────────────────────────────────────────────────

def verify_admin(x_admin_token: str = Header(None)):
    if (
        not ADMIN_SECRET
        or not x_admin_token
        or not secrets.compare_digest(x_admin_token, ADMIN_SECRET)
    ):
        raise HTTPException(status_code=403, detail="Unauthorized.")
    return True


# ── PYDANTIC SCHEMAS ───────────────────────────────────────────────────────────

class ExamCreatePayload(BaseModel):
    title:               str
    duration_minutes:    int
    starts_at:           float          # Unix timestamp (ms from frontend → divide by 1000)
    start_password:      str
    end_password:        Optional[str]  = None
    status:              str            = "upcoming"  # upcoming | draft | live

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Title cannot be empty.")
        return v.strip()

    @field_validator("status")
    @classmethod
    def valid_status(cls, v):
        if v not in {"upcoming", "draft", "live"}:
            raise ValueError("Status must be upcoming, draft, or live.")
        return v

    @field_validator("duration_minutes")
    @classmethod
    def positive_duration(cls, v):
        if v < 1 or v > 1440:
            raise ValueError("Duration must be between 1 and 1440 minutes.")
        return v


class ExamUpdatePayload(BaseModel):
    title:            Optional[str]   = None
    duration_minutes: Optional[int]   = None
    starts_at:        Optional[float] = None
    start_password:   Optional[str]   = None
    end_password:     Optional[str]   = None
    status:           Optional[str]   = None


class StudentCreatePayload(BaseModel):
    student_id: str
    exam_id:    str
    token:      str
    password:   str

    @field_validator("student_id", "exam_id", "token")
    @classmethod
    def no_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Field cannot be empty.")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v):
        if len(v) < 4:
            raise ValueError("Password must be at least 4 characters.")
        return v


class StudentUpdatePayload(BaseModel):
    student_id: Optional[str] = None
    password:   Optional[str] = None
    is_active:  Optional[bool] = None


class TimeSyncPayload(BaseModel):
    new_duration_minutes: int


# ── EXAM MANAGEMENT ────────────────────────────────────────────────────────────

@router.get("/exams")
def list_exams(
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """Return all exams with participant count and real-time computed status."""
    exams = db.query(Exam).all()
    now = time.time()
    result = []
    for exam in exams:
        end_at = exam.starts_at + exam.duration_seconds
        if exam.starts_at > now:
            computed_status = "upcoming"
        elif now <= end_at:
            computed_status = "live"
        else:
            computed_status = "completed"

        participant_count = (
            db.query(func.count(ExamSession.id))
            .filter(
                ExamSession.exam_id == exam.id,
                ExamSession.is_revoked == False,  # noqa: E712
            )
            .scalar()
        )
        submitted_count = (
            db.query(func.count(ExamSession.id))
            .filter(
                ExamSession.exam_id == exam.id,
                ExamSession.is_submitted == True,  # noqa: E712
            )
            .scalar()
        )
        result.append({
            "id":               exam.id,
            "title":            exam.title,
            "duration_minutes": exam.duration_seconds // 60,
            "starts_at_ms":     exam.starts_at * 1000,
            "status":           computed_status,
            "participants":     participant_count,
            "submitted":        submitted_count,
        })
    return {"success": True, "data": result}


@router.get("/exams/{exam_id}")
def get_exam(
    exam_id: str,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")
    return {
        "success": True,
        "data": {
            "id":               exam.id,
            "title":            exam.title,
            "duration_minutes": exam.duration_seconds // 60,
            "starts_at_ms":     exam.starts_at * 1000,
            "start_password":   "[protected]",
            "has_end_password": bool(exam.end_password_hash),
        },
    }


@router.post("/exams")
@limiter.limit("30/minute")
def create_exam(
    request: Request,
    payload: ExamCreatePayload,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    def hash_pw(plain: str) -> str:
        return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

    exam_id = f"exam_{uuid.uuid4().hex[:10]}"
    # starts_at from frontend may arrive in ms — normalise to seconds
    starts_at_s = payload.starts_at / 1000 if payload.starts_at > 1e10 else payload.starts_at

    exam = Exam(
        id                  = exam_id,
        title               = payload.title,
        duration_seconds    = payload.duration_minutes * 60,
        starts_at           = starts_at_s,
        start_password_hash = hash_pw(payload.start_password),
        end_password_hash   = hash_pw(payload.end_password) if payload.end_password else None,
    )
    db.add(exam)
    db.commit()
    logger.info("[ADMIN] Exam created: %s", exam_id)
    return {"success": True, "data": {"id": exam_id}}


@router.put("/exams/{exam_id}")
def update_exam(
    exam_id: str,
    payload: ExamUpdatePayload,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    if payload.title is not None:
        exam.title = payload.title.strip()
    if payload.duration_minutes is not None:
        exam.duration_seconds = payload.duration_minutes * 60
    if payload.starts_at is not None:
        starts_at_s = payload.starts_at / 1000 if payload.starts_at > 1e10 else payload.starts_at
        exam.starts_at = starts_at_s
    if payload.start_password:
        exam.start_password_hash = bcrypt.hashpw(
            payload.start_password.encode(), bcrypt.gensalt()
        ).decode()
    if payload.end_password:
        exam.end_password_hash = bcrypt.hashpw(
            payload.end_password.encode(), bcrypt.gensalt()
        ).decode()

    db.commit()
    return {"success": True, "message": "Exam updated."}


@router.delete("/exams/{exam_id}")
def delete_exam(
    exam_id: str,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    # Cascade: revoke all sessions, delete violations, then delete exam
    sessions = db.query(ExamSession).filter(ExamSession.exam_id == exam_id).all()
    for s in sessions:
        db.query(ViolationLog).filter(ViolationLog.session_id == s.id).delete()
    db.query(ExamSession).filter(ExamSession.exam_id == exam_id).delete()
    db.query(TokenRegistry).filter(TokenRegistry.exam_id == exam_id).delete()
    db.delete(exam)
    db.commit()
    logger.info("[ADMIN] Exam deleted: %s", exam_id)
    return {"success": True, "message": "Exam and all related data deleted."}


# ── LIVE TIME SYNC ─────────────────────────────────────────────────────────────

@router.post("/exams/{exam_id}/sync-time")
async def sync_exam_time(
    request: Request,
    exam_id: str,
    payload: TimeSyncPayload,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    exam.duration_seconds = payload.new_duration_minutes * 60
    db.commit()

    # sio is the socketio.AsyncServer mounted on the ASGI app
    # Access it via the existing /admin/exam/{id}/update-time pattern in main.py
    from app.main import sio as _sio
    await _sio.emit("exam_time_synced", {"duration": payload.new_duration_minutes}, room=exam_id)
    logger.info("[ADMIN] Time synced for exam %s → %d min", exam_id, payload.new_duration_minutes)
    return {"success": True, "message": "Time synced to all live students."}


# ── STUDENT MANAGEMENT ─────────────────────────────────────────────────────────

@router.get("/students")
def list_students(
    exam_id: Optional[str] = None,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    query = db.query(TokenRegistry)
    if exam_id:
        query = query.filter(TokenRegistry.exam_id == exam_id)
    records = query.all()

    result = []
    for r in records:
        session = (
            db.query(ExamSession)
            .filter(
                ExamSession.student_id == r.student_id,
                ExamSession.exam_id    == r.exam_id,
                ExamSession.is_revoked == False,  # noqa: E712
            )
            .order_by(ExamSession.created_at.desc())
            .first()
        )
        result.append({
            "token":      r.token,
            "student_id": r.student_id,
            "exam_id":    r.exam_id,
            "is_active":  r.is_active,
            "submitted":  session.is_submitted if session else False,
            "session_id": session.id if session else None,
        })
    return {"success": True, "data": result}


@router.post("/students")
def add_student(
    payload: StudentCreatePayload,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    # Validate exam exists
    exam = db.query(Exam).filter(Exam.id == payload.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    # Check token uniqueness
    existing = db.query(TokenRegistry).filter(TokenRegistry.token == payload.token).first()
    if existing:
        raise HTTPException(status_code=409, detail="Token already in use.")

    pw_hash = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
    record = TokenRegistry(
        token         = payload.token,
        exam_id       = payload.exam_id,
        student_id    = payload.student_id,
        password_hash = pw_hash,
        is_active     = True,
    )
    db.add(record)
    db.commit()
    return {"success": True, "message": "Student added."}


@router.put("/students/{token}")
def update_student(
    token: str,
    payload: StudentUpdatePayload,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    record = db.query(TokenRegistry).filter(TokenRegistry.token == token).first()
    if not record:
        raise HTTPException(status_code=404, detail="Student token not found.")

    if payload.student_id is not None:
        record.student_id = payload.student_id.strip()
    if payload.is_active is not None:
        record.is_active = payload.is_active
    if payload.password:
        record.password_hash = bcrypt.hashpw(
            payload.password.encode(), bcrypt.gensalt()
        ).decode()

    db.commit()
    return {"success": True, "message": "Student updated."}


@router.delete("/students/{token}")
def remove_student(
    token: str,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    record = db.query(TokenRegistry).filter(TokenRegistry.token == token).first()
    if not record:
        raise HTTPException(status_code=404, detail="Student token not found.")

    # Revoke any active sessions
    db.query(ExamSession).filter(
        ExamSession.student_id == record.student_id,
        ExamSession.exam_id    == record.exam_id,
    ).update({"is_revoked": True})

    db.delete(record)
    db.commit()
    return {"success": True, "message": "Student removed and sessions revoked."}


# ── LIVE MONITOR ───────────────────────────────────────────────────────────────

@router.get("/exams/{exam_id}/monitor")
def get_live_monitor(
    exam_id: str,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """Returns live session data for all students in an exam."""
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    sessions = (
        db.query(ExamSession)
        .filter(
            ExamSession.exam_id    == exam_id,
            ExamSession.is_revoked == False,  # noqa: E712
        )
        .all()
    )

    result = []
    for s in sessions:
        # Violation summary per session
        violation_rows = (
            db.query(ViolationLog.event_type, func.count(ViolationLog.id))
            .filter(ViolationLog.session_id == s.id)
            .group_by(ViolationLog.event_type)
            .all()
        )
        violations = {ev: cnt for ev, cnt in violation_rows}
        total_violations = sum(violations.values())

        result.append({
            "session_id":       s.id,
            "student_id":       s.student_id,
            "is_submitted":     s.is_submitted,
            "created_at":       s.created_at,
            "total_violations": total_violations,
            "violations":       violations,
        })

    return {
        "success": True,
        "data": {
            "exam": {
                "id":               exam.id,
                "title":            exam.title,
                "duration_minutes": exam.duration_seconds // 60,
                "starts_at_ms":     exam.starts_at * 1000,
            },
            "sessions": result,
        },
    }


@router.delete("/exams/{exam_id}/sessions/{session_id}/revoke")
def revoke_session(
    exam_id: str,
    session_id: str,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """Force-revoke a student's session (kick out)."""
    session = (
        db.query(ExamSession)
        .filter(ExamSession.id == session_id, ExamSession.exam_id == exam_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    session.is_revoked = True
    db.commit()
    return {"success": True, "message": f"Session {session_id} revoked."}