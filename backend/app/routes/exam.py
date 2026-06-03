import time
import json
import bcrypt
import logging
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from app.database import get_db
from app.auth import verify_session_guard
from app.models import Exam, ViolationLog, TokenRegistry
from app.limiter import limiter

router = APIRouter()
logger = logging.getLogger("scope")

ALLOWED_EVENTS = {
    "tab_switch", "fullscreen_exit", "copy_paste", "devtools",
    "face_absent", "multi_person", "right_click", "keyboard_shortcut",
}


class ViolationPayload(BaseModel):
    event_type: str
    detail:     str = ""


class SubmitPayload(BaseModel):
    answers:    dict
    autoSubmit: bool = False


class PasswordVerifyPayload(BaseModel):
    # Issue 16: Literal type — rejects any value other than 'start' or 'end'
    type:     Literal["start", "end"]
    password: str


# ── VIOLATION ROUTES — must be above /{exam_id} to avoid route conflict ──

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
    db.commit()
    return {"success": True}


@router.get("/violation/count")
def get_violation_count(
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    # Issue 14: single GROUP BY query instead of N+1 loop
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


# ── DASHBOARD FEED ──

@router.get("/student/available-tests")
def get_available_tests(
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    # Issue 12: real student data from DB instead of hardcoded placeholder
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

    # Single query — exam_id is already known from token_record
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


# ── EXAM WORKSPACE FEED ──

@router.get("/{exam_id}")
def load_exam_workspace(
    exam_id:        str,
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    # Issue 13 note: questions are still static — replace with DB-driven content
    # when the Questions/Options tables are added.
    exam_record = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam_record:
        raise HTTPException(status_code=404, detail="Exam not found.")

    return {
        "success": True,
        "data": {
            "id":       exam_record.id,
            "title":    exam_record.title,
            "date":     exam_record.starts_at * 1000,
            "duration": exam_record.duration_seconds // 60,
            "maxViolations": 3,
            "codingProblems": [
                {
                    "id":          "code_1",
                    "title":       "Data Structures Integrity",
                    "description": "Write a function to validate a binary search tree.\n\n**Input:** Root node of tree\n**Output:** Boolean",
                    "marks":       10,
                }
            ],
            "sections": [
                {
                    "name":      "Technical Validation",
                    "category":  "Technical",
                    "questions": [
                        {
                            "id":              "mcq_1",
                            "text":            "What is the time complexity of binary search?",
                            "shuffledOptions": [
                                {"label": "A", "text": "O(log n)"},
                                {"label": "B", "text": "O(n)"},
                                {"label": "C", "text": "O(n log n)"},
                                {"label": "D", "text": "O(1)"},
                            ],
                        }
                    ],
                }
            ],
        },
    }


@router.post("/{exam_id}/verify-password")
@limiter.limit("10/minute")  # Issue 15: brute-force protection on exam passwords
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

    if not target_hash or not bcrypt.checkpw(
        payload.password.encode("utf-8"),
        target_hash.encode("utf-8"),
    ):
        # Issue 16: payload.type is now a Literal — safe to use in detail message
        raise HTTPException(
            status_code=403,
            detail=f"Incorrect {payload.type.capitalize()} Password.",
        )

    return {"success": True}


@router.post("/{exam_id}/submit")
def submit_exam(
    exam_id:        str,
    payload:        SubmitPayload,
    active_session  = Depends(verify_session_guard),
    db: Session     = Depends(get_db),
):
    if active_session.is_submitted:
        # Prevent re-submission overwriting
        raise HTTPException(status_code=400, detail="Exam already submitted.")

    # 🚀 Save the raw answers JSON into the session record
    active_session.submission_payload = json.dumps(payload.answers)
    active_session.is_submitted = True
    
    db.commit()
    return {"success": True, "message": "Exam submitted successfully"}