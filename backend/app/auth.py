import os
import time
import jwt
import logging
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app import repositories as repo
from app.repositories import _AttrDict

logger = logging.getLogger("scope")

SECRET_SIGNING_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_SIGNING_KEY:
    raise ValueError("JWT_SECRET_KEY must be set in environment!")

# Issue 7: configurable expiry via env, default 7200s
JWT_EXPIRY_SECONDS = int(os.getenv("JWT_EXPIRY_SECONDS", 7200))

ALGORITHM = "HS256"
security_agent = HTTPBearer()


def create_session_jwt(student_id: str, exam_id: str, session_id: str, max_age_seconds: int = None) -> str:
    ttl = JWT_EXPIRY_SECONDS
    if max_age_seconds is not None:
        ttl = max(0, min(JWT_EXPIRY_SECONDS, int(max_age_seconds)))
    payload = {
        "sub": student_id,
        "exam_id": exam_id,
        "session_id": session_id,
        "exp": int(time.time()) + ttl,
    }
    return jwt.encode(payload, SECRET_SIGNING_KEY, algorithm=ALGORITHM)


def create_staff_jwt(staff_id: str) -> str:
    """Staff (admin/faculty) JWT. Carries ONLY the account id — role and module
    are re-read from the DB on every request so revocation/module changes apply
    immediately."""
    payload = {
        "sub": staff_id,
        "exp": int(time.time()) + JWT_EXPIRY_SECONDS,
    }
    return jwt.encode(payload, SECRET_SIGNING_KEY, algorithm=ALGORITHM)


def decode_staff_jwt(token: str):
    """Returns the payload dict, or None if the token is invalid/expired/malformed."""
    try:
        payload = jwt.decode(token, SECRET_SIGNING_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if not payload.get("sub"):
        return None
    return payload


def verify_session_guard(
    credentials: HTTPAuthorizationCredentials = Depends(security_agent),
):
    try:
        payload = jwt.decode(
            credentials.credentials, SECRET_SIGNING_KEY, algorithms=[ALGORITHM]
        )
        session_id: str = payload.get("session_id")

        if session_id is None:
            logger.warning("verify_session_guard: malformed token payload (no session_id)")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Malformed token payload.",
            )

        _doc = repo.find_one("exam_sessions", {"_id": session_id})
        session_record = _AttrDict(_doc) if _doc else None

        if not session_record:
            logger.warning(
                "verify_session_guard: session %s not found", session_id
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session is invalid or has been revoked.",
                headers={"WWW-Authenticate": 'Bearer error="SESSION_REVOKED"'},
            )

        # IDOR: bind session to the JWT subject (student_id).
        jwt_sub = payload.get("sub")
        if jwt_sub and session_record.student_id != jwt_sub:
            logger.warning(
                "verify_session_guard: student_id mismatch token=%s session=%s",
                jwt_sub, session_record.student_id,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Session does not belong to this student.",
            )

        if session_record.is_revoked:
            # AUD-011: revoked/invalid session is distinct from a bad token.
            # Use 401 + a machine-readable code so the frontend interceptor can
            # show a "session revoked" modal instead of a silent hard redirect.
            logger.warning(
                "verify_session_guard: session %s invalid or revoked", session_id
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session is invalid or has been revoked.",
                headers={"WWW-Authenticate": 'Bearer error="SESSION_REVOKED"'},
            )

        return session_record

    except jwt.ExpiredSignatureError:
        # Issue 7 / 21: explicit 401 so frontend interceptor can redirect to login
        logger.warning("verify_session_guard: expired token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please log in again.",
            headers={"WWW-Authenticate": 'Bearer error="TOKEN_EXPIRED"'},
        )
    except jwt.PyJWTError:
        logger.warning("verify_session_guard: token validation failed")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token validation failed.",
        )


def verify_socket_token(token: str, exam_id: str):
    """Validates WebSocket connection using JWT instead of session_secret."""
    try:
        payload = jwt.decode(token, SECRET_SIGNING_KEY, algorithms=[ALGORITHM])
        session_id = payload.get("session_id")
        token_exam_id = payload.get("exam_id")
        if not session_id or token_exam_id != exam_id:
            return None
    except jwt.PyJWTError:
        return None

    _doc = repo.find_one(
        "exam_sessions",
        {"_id": session_id, "exam_id": exam_id, "is_revoked": False},
    )
    return _AttrDict(_doc) if _doc else None
