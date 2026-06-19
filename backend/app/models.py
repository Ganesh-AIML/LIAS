import time
from sqlalchemy import Column, String, Integer, Boolean, ForeignKey, Float, Text, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base

# ── 1. EXISTING TABLES (With Relationship Hooks Added) ─────────────────────────

class Student(Base):
    """Master Directory — canonical student list, independent of any exam."""
    __tablename__ = "students"
    id         = Column(String, primary_key=True, index=True)   # e.g. "23-AIML-101"
    name       = Column(String, nullable=True)                   # optional display name
    password   = Column(String, nullable=False)                  # bcrypt hash (master credential)
    is_active  = Column(Boolean, default=True)
    created_at = Column(Float, default=time.time)


class TokenRegistry(Base):
    __tablename__ = "token_registry"
    token         = Column(String, primary_key=True, index=True)
    exam_id       = Column(String, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False)
    student_id    = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    is_active     = Column(Boolean, default=True)

    # AUD-012: Prevent duplicate enrollment rows for same student+exam
    __table_args__ = (
        UniqueConstraint('student_id', 'exam_id', name='uq_token_student_exam'),
    )


class Exam(Base):
    __tablename__ = "exams"
    id                  = Column(String, primary_key=True, index=True)
    title               = Column(String, nullable=False)
    duration_seconds    = Column(Integer, default=3600)
    starts_at           = Column(Float, nullable=False)
    start_password_hash = Column(String, nullable=False)
    end_password_hash   = Column(String, nullable=True)
    status              = Column(String, default="upcoming") # draft, upcoming, live, completed
    start_secret = Column(String, nullable=True)
    end_secret   = Column(String, nullable=True)
    coding_duration_minutes = Column(Integer, default=60)  # AUD-022: was hardcoded to 60

    # Relationships - If Exam is deleted, delete all associated content
    questions       = relationship("Question", back_populates="exam", cascade="all, delete-orphan")
    coding_problems = relationship("CodingProblem", back_populates="exam", cascade="all, delete-orphan")
    sessions        = relationship("ExamSession", back_populates="exam", cascade="all, delete-orphan")
    subjective_questions = relationship("SubjectiveQuestion", back_populates="exam", cascade="all, delete-orphan")
    sections        = relationship("Section", back_populates="exam", cascade="all, delete-orphan")

class ExamSession(Base):
    __tablename__ = "exam_sessions"
    id                 = Column(String, primary_key=True, index=True)
    student_id         = Column(String, nullable=False)
    exam_id            = Column(String, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False)
    session_secret     = Column(String, nullable=False)
    is_revoked          = Column(Boolean, default=False)
    is_submitted        = Column(Boolean, default=False)
    created_at          = Column(Float, default=time.time)
    subjective_payload  = Column(Text, nullable=True)
    submission_payload  = Column(Text, nullable=True)   # AUD-001: MCQ+coding answers JSON

    exam = relationship("Exam", back_populates="sessions")
    violations = relationship("ViolationLog", back_populates="session", cascade="all, delete-orphan")
    __table_args__ = (
        Index('ix_exam_sessions_lookup', 'student_id', 'exam_id', 'is_revoked'),
    )


class ViolationLog(Base):
    __tablename__ = "violation_logs"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    session_id  = Column(String, ForeignKey("exam_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id  = Column(String, nullable=False, index=True)
    exam_id     = Column(String, nullable=False)
    event_type  = Column(String, nullable=False)
    detail      = Column(Text, nullable=True)
    occurred_at = Column(Float, default=time.time)

    session = relationship("ExamSession", back_populates="violations")


# ── 2. NEW TABLES (For Dynamic Exam Content) ───────────────────────────────────

class Question(Base):
    """Stores MCQs (Aptitude, Technical, etc.)"""
    __tablename__ = "questions"
    id       = Column(String, primary_key=True, index=True)
    exam_id  = Column(String, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False)
    section  = Column(String, nullable=False) # e.g., 'Aptitude', 'Technical'
    text     = Column(Text, nullable=False)
    optA     = Column(String, nullable=False)
    optB     = Column(String, nullable=False)
    optC     = Column(String, nullable=False)
    optD     = Column(String, nullable=False)
    ans      = Column(String, nullable=False) # 'A', 'B', 'C', or 'D'

    # ── SECTION/RICH-CONTENT SUPPORT (additive, all nullable/defaulted for backward compat) ──
    section_id     = Column(String, ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)
    order_index    = Column(Integer, default=0)
    marks          = Column(Integer, default=1)          # legacy grading hardcoded +=1; default preserves that
    content_format = Column(String, default="plain")     # 'plain' (legacy) | 'markdown' (rich)

    exam        = relationship("Exam", back_populates="questions")
    section_ref = relationship("Section", back_populates="questions")


class CodingProblem(Base):
    """Stores Programming Challenges"""
    __tablename__ = "coding_problems"
    id          = Column(String, primary_key=True, index=True)
    exam_id     = Column(String, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False)
    title       = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    constraints = Column(Text, nullable=True)
    # Store languages as a comma-separated string (e.g., "62,71,54" for Java, Python, C++)
    languages   = Column(String, nullable=True) 
    
    exam       = relationship("Exam", back_populates="coding_problems")
    test_cases = relationship("TestCase", back_populates="problem", cascade="all, delete-orphan")


class TestCase(Base):
    """Stores Inputs/Outputs for Code Execution"""
    __tablename__ = "test_cases"
    id              = Column(String, primary_key=True, index=True)
    problem_id      = Column(String, ForeignKey("coding_problems.id", ondelete="CASCADE"), nullable=False)
    input_data      = Column(Text, nullable=False)
    expected_output = Column(Text, nullable=False)
    is_hidden       = Column(Boolean, default=False)
    
    problem = relationship("CodingProblem", back_populates="test_cases")


class SubjectiveQuestion(Base):
    __tablename__ = "subjective_questions"
    id       = Column(String, primary_key=True, index=True)
    exam_id  = Column(String, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True)
    section  = Column(String, nullable=False)   # display label e.g. "Theory"
    text     = Column(Text, nullable=False)
    marks    = Column(Integer, default=10)

    # ── SECTION/RICH-CONTENT SUPPORT (additive) ──
    section_id     = Column(String, ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)
    order_index    = Column(Integer, default=0)
    content_format = Column(String, default="plain")

    exam        = relationship("Exam", back_populates="subjective_questions")
    section_ref = relationship("Section", back_populates="subjective_questions")


class Section(Base):
    """First-class Section entity: groups questions with shared marks/ordering/type."""
    __tablename__ = "sections"
    id                  = Column(String, primary_key=True, index=True)
    exam_id             = Column(String, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True)
    name                = Column(String, nullable=False)
    type                = Column(String, nullable=False, default="mcq")   # 'mcq' | 'subjective'
    marks_per_question  = Column(Integer, default=1)
    order_index         = Column(Integer, default=0)

    exam = relationship("Exam", back_populates="sections")
    questions             = relationship("Question", back_populates="section_ref")
    subjective_questions  = relationship("SubjectiveQuestion", back_populates="section_ref")