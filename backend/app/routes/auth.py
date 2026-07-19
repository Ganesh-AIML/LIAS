import re
import uuid
import logging
from secrets import token_hex
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
import bcrypt
from app.database import get_db
from app.models import TokenRegistry, ExamSession, Student, Exam
from app.auth import create_session_jwt, verify_session_guard
from app.limiter import limiter
import time

router = APIRouter()
logger = logging.getLogger("scope")


class JoinPayload(BaseModel):
    student_id: str
    password:   str
    exam_token: str

    @field_validator("student_id")
    @classmethod
    def validate_student_id(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Invalid field length.")
        # Issue 10: only allow safe characters — blocks injection attempts
        if not re.match(r"^[A-Za-z0-9_\-\.]+$", v):
            raise ValueError("Student ID contains invalid characters.")
        return v

    @field_validator("exam_token")
    @classmethod
    def validate_exam_token(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Invalid field length.")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        # Do NOT strip whitespace — passwords with spaces must work (Issue 23)
        if not v or len(v) > 256:
            raise ValueError("Invalid password length.")
        return v


class UpdatePasswordPayload(BaseModel):
    currentPassword: str
    newPassword:     str

    @field_validator("newPassword")
    @classmethod
    def validate_new_password(cls, v):
        if len(v) < 6:
            raise ValueError("New password must be at least 6 characters.")
        if len(v) > 256:
            raise ValueError("Password too long.")
        return v


@router.get("/health-check")
def network_telemetry_ping():
    return {"status": "online", "server_time": int(time.time() * 1000)}


@router.post("/join")
@limiter.limit("5/minute")  # Issue 2: brute-force protection
def join_exam_pipeline(request: Request, payload: JoinPayload, db: Session = Depends(get_db)):
    token_record = (
        db.query(TokenRegistry)
        .filter(
            TokenRegistry.token      == payload.exam_token,
            TokenRegistry.student_id == payload.student_id,
            TokenRegistry.is_active  == True,  # noqa: E712
        )
        .first()
    )

    # Always run bcrypt even on miss to prevent timing-based user enumeration
    dummy_hash  = "$2b$12$KIXkJ1yGbRPGSmPPmoBvOuoO3a8EJHxRPbPCw/dqxRdAb9RXq9z7i"
    stored_hash = token_record.password_hash if token_record else dummy_hash
    password_ok = bcrypt.checkpw(
        payload.password.encode("utf-8"),
        stored_hash.encode("utf-8"),
    )

    if not token_record or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials.",
        )

    # AUD-018: TokenRegistry.is_active only governs this exam's token. The
    # master directory's Student.is_active flag must also be honored — an
    # admin deactivating a student there should block login everywhere.
    master_student = db.query(Student).filter(Student.id == payload.student_id).first()
    if master_student and not master_student.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials.",
        )

    # AUD-031 / Issue C: exam credentials must expire 5 min after the exam
    # ends. Without this, a student can keep logging in indefinitely with
    # the same token+password long after the exam is over.
    EXAM_GRACE_SECONDS = 300
    exam_record = db.query(Exam).filter(Exam.id == token_record.exam_id).first()
    grace_remaining = None
    if exam_record:
        grace_deadline = exam_record.starts_at + exam_record.duration_seconds + EXAM_GRACE_SECONDS
        if time.time() > grace_deadline:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Exam credentials have expired.",
            )
        grace_remaining = grace_deadline - time.time()

    # Atomic session replacement — revoke old, create new in one transaction
    try:
        existing_session = (
            db.query(ExamSession)
            .filter(
                ExamSession.student_id == payload.student_id,
                ExamSession.exam_id    == token_record.exam_id,
                ExamSession.is_revoked == False,  # noqa: E712
            )
            .with_for_update()
            .first()
        )
        if existing_session:
            existing_session.is_revoked = True

        session_uuid       = f"sess_{uuid.uuid4().hex[:12]}"
        secret_key_entropy = token_hex(32)

        new_session = ExamSession(
            id             = session_uuid,
            student_id     = payload.student_id,
            exam_id        = token_record.exam_id,
            session_secret = secret_key_entropy,
        )
        db.add(new_session)
        db.commit()
    except Exception:
        db.rollback()
        logger.error("Session creation failed.")
        raise HTTPException(status_code=500, detail="Session error. Please retry.")

    generated_jwt = create_session_jwt(
        payload.student_id, token_record.exam_id, session_uuid,
        max_age_seconds=grace_remaining,
    )
    logger.info("[AUTH] New session created for exam: %s", token_record.exam_id[:8] + "****")

    # Issue 9: session_secret is NOT returned to the frontend.
    # WebSocket auth uses this secret server-side only.
    # The frontend uses the JWT for WebSocket authentication instead.
    return {
        "session_jwt": generated_jwt,
        "exam_id":     token_record.exam_id,
        "session_id":  session_uuid,
    }


@router.post("/logout")
def logout_session(
    active_session=Depends(verify_session_guard),
    db: Session = Depends(get_db),
):
    active_session.is_revoked = True
    db.commit()
    return {"success": True}


@router.post("/refresh-token")
@limiter.limit("10/minute")
def refresh_token(
    request: Request,
    active_session=Depends(verify_session_guard),
    db: Session = Depends(get_db),
):
    """
    AUD-053: the original JWT exp is fixed at login time from the exam's
    scheduled duration. Time spent in PreExamCheck/Dashboard before the exam
    opens, or an admin mid-exam duration extension (exam_time_synced socket
    event), is never reflected in that fixed exp — so a still-legitimate,
    still-running session's token can expire while the student is mid-exam.
    Re-issues a token for the SAME session_id, recomputed from the exam's
    CURRENT duration_seconds, so a periodic frontend refresh keeps a
    genuinely active session alive without ever needing a fresh login.
    Requires a currently-valid (not expired, not revoked) token — renewal,
    not a bypass of expiry/revocation.
    """
    exam_record = db.query(Exam).filter(Exam.id == active_session.exam_id).first()
    if not exam_record:
        raise HTTPException(status_code=404, detail="Exam not found.")

    EXAM_GRACE_SECONDS = 300
    grace_deadline = exam_record.starts_at + exam_record.duration_seconds + EXAM_GRACE_SECONDS
    grace_remaining = grace_deadline - time.time()
    if grace_remaining <= 0:
        raise HTTPException(status_code=401, detail="Exam credentials have expired.")

    new_jwt = create_session_jwt(
        active_session.student_id, active_session.exam_id, active_session.id,
        max_age_seconds=grace_remaining,
    )
    return {"session_jwt": new_jwt}


@router.put("/update-password")
@limiter.limit("5/minute")
def update_password(
    request: Request,
    payload: UpdatePasswordPayload,
    active_session=Depends(verify_session_guard),
    db: Session = Depends(get_db),
):
    """Issue 11: This route was called from the frontend but never existed in the backend."""
    token_record = (
        db.query(TokenRegistry)
        .filter(
            TokenRegistry.student_id == active_session.student_id,
            TokenRegistry.exam_id    == active_session.exam_id,
            TokenRegistry.is_active  == True,  # noqa: E712
        )
        .first()
    )
    if not token_record:
        raise HTTPException(status_code=404, detail="Student token not found.")

    if not bcrypt.checkpw(
        payload.currentPassword.encode("utf-8"),
        token_record.password_hash.encode("utf-8"),
    ):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    token_record.password_hash = bcrypt.hashpw(
        payload.newPassword.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")
    db.commit()
    return {"success": True, "detail": "Password updated successfully."}