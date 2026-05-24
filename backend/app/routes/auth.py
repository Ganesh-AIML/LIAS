import uuid
import logging
from secrets import token_hex
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
import bcrypt
from app.database import get_db
from app.models import TokenRegistry, ExamSession, Exam
from app.auth import create_session_jwt, verify_session_guard
import time

router = APIRouter()
logger = logging.getLogger("scope")


class JoinPayload(BaseModel):
    student_id: str
    password: str
    exam_token: str

    # FIX: basic input length guards — prevents oversized payloads hitting the DB
    @field_validator("student_id", "exam_token")
    @classmethod
    def no_empty_or_oversized(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Invalid field length")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v):
        if not v or len(v) > 256:
            raise ValueError("Invalid password length")
        return v

@router.get("/health-check")
def network_telemetry_ping():
    return {"status": "online", "server_time": int(time.time() * 1000)}

@router.post("/join")
def join_exam_pipeline(payload: JoinPayload, db: Session = Depends(get_db)):
    # FIX: Fetch by token + student_id only — do NOT filter by password in the query.
    # Password must be verified via bcrypt after fetch (constant-time).
    # Filtering by password in SQL would expose timing differences and leak hash info.
    token_record = db.query(TokenRegistry).filter(
        TokenRegistry.token      == payload.exam_token,
        TokenRegistry.student_id == payload.student_id,
        TokenRegistry.is_active  == True
    ).first()

    # FIX: Always run pwd_ctx.verify even on miss (dummy hash) to prevent
    # timing-based user enumeration — attacker cannot tell if token vs password failed.
    dummy_hash = "$2b$12$KIXkJ1yGbRPGSmPPmoBvOuoO3a8EJHxRPbPCw/dqxRdAb9RXq9z7i"
    stored_hash = token_record.password_hash if token_record else dummy_hash
    password_ok = bcrypt.checkpw(
    payload.password.encode('utf-8'), 
    stored_hash.encode('utf-8')
)

    if not token_record or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials."
        )

    # FIX: Atomic session replacement — revoke old + create new in one transaction.
    # Prevents race condition where two simultaneous logins both get valid JWTs.
    try:
        existing_session = db.query(ExamSession).filter(
            ExamSession.student_id == payload.student_id,
            ExamSession.exam_id    == token_record.exam_id,
            ExamSession.is_revoked == False
        ).with_for_update().first()  # row-level lock

        if existing_session:
            existing_session.is_revoked = True

        session_uuid       = f"sess_{uuid.uuid4().hex[:12]}"
        secret_key_entropy = token_hex(32)

        new_session = ExamSession(
            id             = session_uuid,
            student_id     = payload.student_id,
            exam_id        = token_record.exam_id,
            session_secret = secret_key_entropy
        )
        db.add(new_session)
        db.commit()  # single commit — atomic
    except Exception:
        db.rollback()
        logger.error("Session creation failed for student: [REDACTED]")
        raise HTTPException(status_code=500, detail="Session error. Please retry.")

    generated_jwt = create_session_jwt(payload.student_id, token_record.exam_id, session_uuid)

    # FIX: Never log student_id, session_id, or JWT values
    logger.info("[AUTH] New session created for exam: %s", token_record.exam_id[:8] + "****")

    return {
        "session_jwt": generated_jwt,
        "exam_id":     token_record.exam_id,
        "session_id":  session_uuid,
        "secret":      secret_key_entropy
    }

@router.post("/logout")
def logout_session(active_session=Depends(verify_session_guard), db: Session = Depends(get_db)):
    active_session.is_revoked = True
    db.commit()
    return {"success": True}