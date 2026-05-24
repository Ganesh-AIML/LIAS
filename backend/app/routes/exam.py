from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.auth import verify_session_guard
from app.models import Exam
from app.models import ViolationLog
import time
import bcrypt

router = APIRouter()

# ── VIOLATION ROUTES FIRST — must be above /{exam_id} to avoid route conflict ──

ALLOWED_EVENTS = {'tab_switch', 'fullscreen_exit', 'copy_paste', 'devtools', 'face_absent', 'multi_person', 'right_click', 'keyboard_shortcut'}

class ViolationPayload(BaseModel):
    event_type: str
    detail: str = ""


class SubmitPayload(BaseModel):
    answers: dict
    autoSubmit: bool = False


class PasswordVerifyPayload(BaseModel):
    type: str  # 'start' or 'end'
    password: str


@router.post("/violation")
def log_violation(
    payload: ViolationPayload,
    active_session=Depends(verify_session_guard),
    db: Session = Depends(get_db)
):
    if payload.event_type not in ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail="Unknown event type")
    entry = ViolationLog(
        session_id  = active_session.id,
        student_id  = active_session.student_id,
        exam_id     = active_session.exam_id,
        event_type  = payload.event_type,
        occurred_at = time.time(),
        detail      = payload.detail[:256] if payload.detail else ""
    )
    db.add(entry)
    db.commit()
    return {"success": True}

@router.get("/violation/count")
def get_violation_count(
    active_session=Depends(verify_session_guard),
    db: Session = Depends(get_db)
):
    count = db.query(ViolationLog).filter(
        ViolationLog.session_id == active_session.id
    ).count()
    # Per-type breakdown for admin visibility
    breakdown = {}
    for e in ALLOWED_EVENTS:
        breakdown[e] = db.query(ViolationLog).filter(
            ViolationLog.session_id == active_session.id,
            ViolationLog.event_type == e
        ).count()
    return {"success": True, "count": count, "breakdown": breakdown}

# ── DASHBOARD FEED ──

@router.get("/student/available-tests")
def get_available_tests(active_session=Depends(verify_session_guard), db: Session = Depends(get_db)):
    return {
        "success": True,
        "data": {
            "profile": {
                "name": "Ganesh Singh",
                "email": "student@college.edu",
                "studentProfile": {"rollNo": "A101", "branch": "AI&ML", "batch": "2026"}
            },
            "availableTests": [
                {
                    "id": active_session.exam_id,
                    "title": "S.C.O.P.E. Master Blueprint Assessment",
                    "date": (time.time() - 100) * 1000,  # already live
                    "duration": 120,
                    "codingDuration": 60
                }
            ],
            "pastResults": []
        }
    }

# ── EXAM WORKSPACE FEED ──

@router.get("/{exam_id}")
def load_exam_workspace(exam_id: str, active_session=Depends(verify_session_guard), db: Session = Depends(get_db)):
    return {
        "success": True,
        "data": {
            "id": exam_id,
            "title": "S.C.O.P.E. Master Blueprint Assessment",
            "date": (time.time() - 100) * 1000,
            "duration": 120,
            "codingProblems": [
                {
                    "id": "code_1",
                    "title": "Data Structures Integrity",
                    "description": "Write a function to validate a binary search tree.\n\n**Input:** Root node of tree\n**Output:** Boolean",
                    "marks": 10
                }
            ],
            "sections": [
                {
                    "name": "Technical Validation",
                    "category": "Technical",
                    "questions": [
                        {"id": "mcq_1", "text": "What is the time complexity of binary search?", "shuffledOptions": [{"label": "A", "text": "O(log n)"}, {"label": "B", "text": "O(n)"}]}
                    ]
                }
            ]
        }
    }




@router.post("/{exam_id}/verify-password")
def verify_exam_password(
    exam_id: str, 
    payload: PasswordVerifyPayload, 
    active_session=Depends(verify_session_guard), 
    db: Session = Depends(get_db)
):
    exam_record = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam_record:
        raise HTTPException(status_code=404, detail="Exam not found")

    # Determine which hash to use based on password type
    target_hash = exam_record.start_password_hash if payload.type == "start" else exam_record.end_password_hash
    
    if not target_hash or not bcrypt.checkpw(
        payload.password.encode('utf-8'), 
        target_hash.encode('utf-8')
    ):
        raise HTTPException(status_code=403, detail=f"Incorrect {payload.type.capitalize()} Password")

    return {"success": True}



@router.post("/{exam_id}/submit")
def submit_exam(
    exam_id: str,
    payload: SubmitPayload,
    active_session=Depends(verify_session_guard),
    db: Session = Depends(get_db)
):
    # Mark the session as submitted so they cannot re-enter
    active_session.is_submitted = True
    db.commit()
    
    # In the future, you can grade the payload.answers here and save to a Results table
    return {"success": True, "message": "Exam submitted securely."}