import re
import uuid
import logging
from secrets import token_hex
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
import bcrypt
from app.auth import create_session_jwt, verify_session_guard
from app.limiter import limiter
from app import repositories as repo
from app.repositories import _AttrDict
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
def join_exam_pipeline(request: Request, payload: JoinPayload):
    _doc = repo.find_one("token_registry", {
        "token": payload.exam_token,
        "student_id": payload.student_id,
        "is_active": True,
    })
    token_record = _AttrDict(_doc) if _doc else None

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
    _s_doc = repo.find_one("students", {"_id": payload.student_id})
    master_student = _AttrDict(_s_doc) if _s_doc else None
    if master_student and not master_student.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials.",
        )

    # AUD-031 / Issue C: exam credentials must expire 5 min after the exam
    # ends. Without this, a student can keep logging in indefinitely with
    # the same token+password long after the exam is over.
    EXAM_GRACE_SECONDS = 300
    _e_doc = repo.find_one("exams", {"_id": token_record.exam_id})
    exam_record = _AttrDict(_e_doc) if _e_doc else None
    grace_remaining = None
    if exam_record:
        grace_deadline = exam_record.starts_at + exam_record.duration_seconds + EXAM_GRACE_SECONDS
        if time.time() > grace_deadline:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Exam credentials have expired.",
            )
        grace_remaining = grace_deadline - time.time()

    # Atomic session replacement — revoke old, create new
    try:
        session_uuid       = f"sess_{uuid.uuid4().hex[:12]}"
        secret_key_entropy = token_hex(32)

        # Atomic revoke: single Mongo operation prevents double-login race
        repo.find_one_and_update(
            "exam_sessions",
            {"student_id": payload.student_id, "exam_id": token_record.exam_id, "is_revoked": False},
            {"$set": {"is_revoked": True}},
        )
        new_session_doc = {
            "_id":            session_uuid,
            "student_id":     payload.student_id,
            "exam_id":        token_record.exam_id,
            "session_secret": secret_key_entropy,
            "is_submitted":   False,
            "is_revoked":     False,
            "created_at":     time.time(),
        }
        repo.insert_one("exam_sessions", new_session_doc)

    except Exception:
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
):
    try:
        repo.update_one("exam_sessions", {"_id": active_session.id}, {"is_revoked": True})
    except Exception:
        logger.warning("[AUTH] Mongo write failed for logout_session")
    return {"success": True}


@router.post("/refresh-token")
@limiter.limit("10/minute")
def refresh_token(
    request: Request,
    active_session=Depends(verify_session_guard),
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
    _doc = repo.find_one("exams", {"_id": active_session.exam_id})
    exam_record = _AttrDict(_doc) if _doc else None
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
):
    """Issue 11: This route was called from the frontend but never existed in the backend."""
    _doc = repo.find_one("token_registry", {
        "student_id": active_session.student_id,
        "exam_id": active_session.exam_id,
        "is_active": True,
    })
    token_record = _AttrDict(_doc) if _doc else None
    if not token_record:
        raise HTTPException(status_code=404, detail="Student token not found.")

    if not bcrypt.checkpw(
        payload.currentPassword.encode("utf-8"),
        token_record.password_hash.encode("utf-8"),
    ):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    new_hash = bcrypt.hashpw(
        payload.newPassword.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")
    try:
        repo.update_one(
            "token_registry",
            {"_id": token_record.token},
            {"password_hash": new_hash},
        )
    except Exception:
        logger.warning("[AUTH] Mongo write failed for update_password")
    return {"success": True, "detail": "Password updated successfully."}
