import re
import uuid
import logging
from secrets import token_hex
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
import bcrypt
from app.database import get_db
from app.models import TokenRegistry, ExamSession
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

    generated_jwt = create_session_jwt(payload.student_id, token_record.exam_id, session_uuid)
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


@router.put("/update-password")
def update_password(
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