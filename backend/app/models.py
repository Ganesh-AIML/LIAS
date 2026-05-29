import time
from sqlalchemy import Column, String, Integer, Boolean, ForeignKey, Float, Text
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
    id                  = Column(String, primary_key=True, index=True)
    title               = Column(String, nullable=False)
    duration_seconds    = Column(Integer, default=3600)
    starts_at           = Column(Float, nullable=False)
    start_password_hash = Column(String, nullable=False)
    end_password_hash   = Column(String, nullable=True)


class ExamSession(Base):
    __tablename__ = "exam_sessions"
    id             = Column(String, primary_key=True, index=True)
    student_id     = Column(String, nullable=False)
    exam_id        = Column(String, ForeignKey("exams.id"), nullable=False)
    session_secret = Column(String, nullable=False)
    is_revoked     = Column(Boolean, default=False)
    is_submitted   = Column(Boolean, default=False)
    created_at     = Column(Float, default=time.time)  # Issue 17: audit timestamp


class ViolationLog(Base):
    """
    Persistent server-side record of every proctoring event.
    Client-side guards are UX only — this is the source of truth.
    occurred_at is always server time (time.time()), not client-reported.
    """
    __tablename__ = "violation_logs"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    session_id  = Column(String, ForeignKey("exam_sessions.id"), nullable=False, index=True)
    student_id  = Column(String, nullable=False, index=True)
    exam_id     = Column(String, nullable=False)
    event_type  = Column(String, nullable=False)
    occurred_at = Column(Float, nullable=False)   # server unix timestamp
    detail      = Column(Text, nullable=True)