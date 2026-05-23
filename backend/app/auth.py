import os
import time
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ExamSession

# Read from OS environment, fallback ONLY for local testing
SECRET_SIGNING_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_SIGNING_KEY:
    raise ValueError("JWT_SECRET_KEY must be set in environment!")
ALGORITHM = "HS256"

security_agent = HTTPBearer()

def create_session_jwt(student_id: str, exam_id: str, session_id: str) -> str:
    payload = {
        "sub": student_id,
        "exam_id": exam_id,
        "session_id": session_id,
        # OPTIMIZATION 1: Cast to int to strictly comply with JWT RFC 7519
        "exp": int(time.time()) + 7200 
    }
    return jwt.encode(payload, SECRET_SIGNING_KEY, algorithm=ALGORITHM)

def verify_session_guard(credentials: HTTPAuthorizationCredentials = Depends(security_agent), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_SIGNING_KEY, algorithms=[ALGORITHM])
        session_id: str = payload.get("session_id")
        
        if session_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Malformed payload telemetry")
        
        # Verify status directly inside the datastore engine
        session_record = db.query(ExamSession).filter(ExamSession.id == session_id).first()
        if not session_record or session_record.is_revoked:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session revoked by remote proctor authority") 
            
        return session_record
        
    # OPTIMIZATION 2: Explicitly catch expiration for better frontend handling
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please log in again.")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cryptographic authorization signature failed validation")