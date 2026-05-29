import os
import time
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ExamSession

SECRET_SIGNING_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_SIGNING_KEY:
    raise ValueError("JWT_SECRET_KEY must be set in environment!")

# Issue 7: configurable expiry via env, default 7200s
JWT_EXPIRY_SECONDS = int(os.getenv("JWT_EXPIRY_SECONDS", 7200))

ALGORITHM = "HS256"
security_agent = HTTPBearer()


def create_session_jwt(student_id: str, exam_id: str, session_id: str) -> str:
    payload = {
        "sub": student_id,
        "exam_id": exam_id,
        "session_id": session_id,
        "exp": int(time.time()) + JWT_EXPIRY_SECONDS,
    }
    return jwt.encode(payload, SECRET_SIGNING_KEY, algorithm=ALGORITHM)


def verify_session_guard(
    credentials: HTTPAuthorizationCredentials = Depends(security_agent),
    db: Session = Depends(get_db),
):
    try:
        payload = jwt.decode(
            credentials.credentials, SECRET_SIGNING_KEY, algorithms=[ALGORITHM]
        )
        session_id: str = payload.get("session_id")

        if session_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Malformed token payload.",
            )

        session_record = (
            db.query(ExamSession).filter(ExamSession.id == session_id).first()
        )
        if not session_record or session_record.is_revoked:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Session is invalid or has been revoked.",
            )

        return session_record

    except jwt.ExpiredSignatureError:
        # Issue 7 / 21: explicit 401 so frontend interceptor can redirect to login
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please log in again.",
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token validation failed.",
        )


def verify_socket_token(token: str, exam_id: str):
    """
    Validates a WebSocket session by session_secret.
    Uses an explicit db.close() in finally to prevent connection leaks (Issue 8).
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        session = (
            db.query(ExamSession)
            .filter(
                ExamSession.session_secret == token,
                ExamSession.exam_id == exam_id,
                ExamSession.is_revoked == False,  # noqa: E712
            )
            .first()
        )
        return session
    finally:
        db.close()  # Issue 5 & 8: guaranteed cleanup