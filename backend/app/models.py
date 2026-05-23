from sqlalchemy import Column, String, Integer, Boolean, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from app.database import Base

class TokenRegistry(Base):
    __tablename__ = "token_registry"
    token         = Column(String, primary_key=True, index=True)
    exam_id       = Column(String, nullable=False)
    student_id    = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    is_active     = Column(Boolean, default=True)

class Exam(Base):
    __tablename__ = "exams"
    id               = Column(String, primary_key=True, index=True)
    title            = Column(String, nullable=False)
    duration_seconds = Column(Integer, default=3600)
    starts_at        = Column(Float, nullable=False)
    end_password_hash = Column(String, nullable=True)

class ExamSession(Base):
    __tablename__ = "exam_sessions"
    id             = Column(String, primary_key=True, index=True)
    student_id     = Column(String, nullable=False)
    exam_id        = Column(String, ForeignKey("exams.id"), nullable=False)
    session_secret = Column(String, nullable=False)
    is_revoked     = Column(Boolean, default=False)
    is_submitted   = Column(Boolean, default=False)  # NEW: prevents re-entry after submit

class ViolationLog(Base):
    """
    Persistent server-side record of every proctoring event.
    Client-side guards are UX only — this is the source of truth.
    """
    __tablename__ = "violation_logs"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    session_id  = Column(String, ForeignKey("exam_sessions.id"), nullable=False, index=True)
    student_id  = Column(String, nullable=False, index=True)
    exam_id     = Column(String, nullable=False)
    event_type  = Column(String, nullable=False)   # tab_switch | fullscreen_exit | copy_paste | devtools
    occurred_at = Column(Float, nullable=False)    # unix timestamp from server
    detail      = Column(Text, nullable=True)      # optional extra context