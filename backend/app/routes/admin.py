import os
import re
import secrets
import uuid
import json
import time
import bcrypt
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, field_validator
from cryptography.fernet import Fernet
from app.database import get_db
from app.models import Exam, TokenRegistry, ExamSession, ViolationLog, Question, CodingProblem, TestCase, SubjectiveQuestion, Section, Student, StaffAccount, FacultyEvaluation
from app.auth import decode_staff_jwt
from app.module_codes import MODULE_CODES, MODULES
from app.limiter import limiter
from app.routes.staff_auth import ModuleAssignPayload
from app.evaluation_ctx import (
    resolve_context,
    evaluation_material,
    default_faculty_id,
    legacy_available,
)
from app.routes.exam import finalize_expired_sessions

ENCRYPTION_KEY = os.getenv("DB_ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    raise ValueError("DB_ENCRYPTION_KEY must be set in environment!")
cipher_suite = Fernet(ENCRYPTION_KEY.encode('utf-8'))

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")
router = APIRouter()
logger = logging.getLogger("scope")


# AUD-035: A student can have multiple ExamSession rows for the same exam —
# the original submitted one (now revoked by a later re-login) and a fresh
# empty one from the re-login itself. Admin views must report the student's
# real submitted attempt, not whichever row happens to be non-revoked.
# AUD-041: shared exam status/end-time calc, used by /exams and /master-students
# (Assigned Exams visibility filter) so both stay consistent. Server clock only —
# never trust browser time for LIVE/expired decisions.
def compute_exam_status(exam, now: float):
    """Return (computed_status, end_at_epoch_seconds) for an exam."""
    if exam.status == "draft":
        return "draft", exam.starts_at + exam.duration_seconds
    end_at = exam.starts_at + exam.duration_seconds
    if exam.starts_at > now:
        return "upcoming", end_at
    elif now <= end_at:
        return "live", end_at
    else:
        return "completed", end_at


def dedupe_sessions_per_student(sessions):
    """Given a list of ExamSession rows (any exam_id mix), return one row
    per (student_id, exam_id): the submitted one if any exists, else the
    most recently created."""
    best = {}
    for s in sessions:
        key = (s.student_id, s.exam_id)
        current = best.get(key)
        if current is None:
            best[key] = s
        elif s.is_submitted and not current.is_submitted:
            best[key] = s
        elif s.is_submitted == current.is_submitted and s.created_at > current.created_at:
            best[key] = s
    return list(best.values())

# ── AUTH GUARD ─────────────────────────────────────────────────────────────────
def verify_admin(
    authorization: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Resolve the authenticated staff account.

    Returns a dict {id, role, module, name, email}.

    1. PRIMARY: `Authorization: Bearer <staff JWT>` — the account is loaded from
       staff_accounts on every request, so role/module changes (or deactivation)
       apply immediately. A present-but-invalid staff JWT is an outright 401.
    2. LEGACY BOOTSTRAP: `X-Admin-Token` == ADMIN_SECRET is accepted ONLY while
       zero admin accounts exist (pre-seed window), so an existing deployment
       can never lock itself out. Once the first admin is seeded it is rejected.
    """
    if authorization and authorization.lower().startswith("bearer "):
        payload = decode_staff_jwt(authorization[7:].strip())
        if payload:
            staff = (
                db.query(StaffAccount)
                .filter(StaffAccount.id == payload.get("sub"))
                .first()
            )
            if staff:
                return {
                    "id": staff.id,
                    "role": staff.role,
                    "module": staff.module,
                    "name": staff.name,
                    "email": staff.email,
                }
        raise HTTPException(status_code=401, detail="Unauthorized.")

    admin_count = (
        db.query(StaffAccount).filter(StaffAccount.role == "admin").count()
    )
    if (
        admin_count == 0
        and ADMIN_SECRET
        and x_admin_token
        and secrets.compare_digest(x_admin_token, ADMIN_SECRET)
    ):
        return {"id": None, "role": "admin", "module": None, "name": "Admin", "email": None}

    raise HTTPException(status_code=403, detail="Unauthorized.")


def require_admin(staff: dict):
    """Only role='admin' passes. Faculty (even module-assigned) is 403."""
    if staff.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")


def require_exam_scope(staff: dict, exam):
    """Module-based authorization gate for exam-scoped resources.

    - admin  -> allowed unconditionally.
    - faculty -> allowed only if a module is assigned AND exam.module matches.
    - exam=None (orphan rows) -> denied for faculty.
    """
    if staff.get("role") == "admin":
        return
    if staff.get("role") != "faculty":
        raise HTTPException(status_code=403, detail="Unauthorized.")
    module = staff.get("module")
    if not module:
        raise HTTPException(
            status_code=403,
            detail="No module assigned. Contact an administrator.",
        )
    if exam is None or exam.module != module:
        raise HTTPException(status_code=403, detail="Unauthorized.")


# ── LOGIN VERIFICATION ─────────────────────────────────────────────────────────
@router.get("/verify")
@limiter.limit("20/minute")  # AUD-008: rate-limit admin token verification
def verify_admin_login(request: Request, staff: dict = Depends(verify_admin)):
    """Explicit endpoint used by the frontend to validate the session token."""
    return {
        "success": True,
        "message": "Admin verified",
        "role": staff["role"],
        "module": staff["module"],
        "name": staff["name"],
        "email": staff["email"],
    }



# ── NEW PYDANTIC SCHEMAS FOR DYNAMIC EXAMS ─────────────────────────────────────

class QuestionPayload(BaseModel):
    section: str
    text: str
    optA: str
    optB: str
    optC: str
    optD: str
    ans: str
    section_id: Optional[str] = None
    order_index: int = 0
    marks: int = 1
    content_format: str = "plain"

class TestCasePayload(BaseModel):
    input: str
    output: str
    isHidden: bool  # React uses camelCase

class CodingProblemPayload(BaseModel):
    title: str
    description: str
    constraints: Optional[str] = ""
    languages: str
    marks: int = 10
    testCases: List[TestCasePayload] = []

class SectionPayload(BaseModel):
    id: Optional[str] = None
    name: str
    type: str = "mcq"            # 'mcq' | 'subjective'
    marks_per_question: int = 1
    order_index: int = 0

class SubjectiveQuestionPayload(BaseModel):
    section: str
    text: str
    marks: int = 10
    section_id: Optional[str] = None
    order_index: int = 0
    content_format: str = "plain"

    @field_validator('text')
    @classmethod
    def text_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Question text cannot be empty.")
        if len(v) > 500_000:
            raise ValueError("Question text too long (max 500,000 characters).")
        return v

class ExamCreatePayload(BaseModel):
    title:               str
    duration_minutes:    int
    coding_duration_minutes: Optional[int] = None  # None = no section timer
    mcq_duration_minutes:    Optional[int] = None  # None = no section timer
    qna_duration_minutes:    Optional[int] = None  # None = no section timer
    starts_at:           float          # Unix timestamp (ms from frontend → divide by 1000)
    start_password:      str
    end_password:        Optional[str]  = None
    status:              str            = "upcoming"
    start_password_changed: Optional[bool] = None
    end_password_changed: Optional[bool] = None
    module:              Optional[str]  = None  # module name; ignored for faculty (forced to their module)
    questions:           List[QuestionPayload] = []
    coding_problems:     List[CodingProblemPayload] = []
    subjective_questions: List[SubjectiveQuestionPayload] = []
    sections:            List[SectionPayload] = []

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Exam title cannot be empty.")
        if len(v) > 500:
            raise ValueError("Exam title too long (max 500 characters).")
        return v.strip()

    @field_validator("module")
    @classmethod
    def module_must_be_canonical(cls, v):
        if v is None:
            return None
        v = v.strip().upper()
        if v not in MODULE_CODES:
            raise ValueError(f"Unknown module code '{v}'. Must be one of: {', '.join(sorted(MODULE_CODES))}.")
        return v

    @field_validator("duration_minutes")
    @classmethod
    def validate_duration(cls, v):
        if v < 1 or v > 1440:
            raise ValueError("Duration must be between 1 and 1440 minutes.")
        return v

    @field_validator("start_password")
    @classmethod
    def validate_start_password(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Start password cannot be empty or exceed 128 characters.")
        return v

    @field_validator("end_password")
    @classmethod
    def validate_end_password(cls, v):
        if v is not None and len(v) > 128:
            raise ValueError("End password too long (max 128 characters).")
        return v

def resolve_exam_module(staff: dict, payload) -> Optional[str]:
    """Faculty are forced to their own module (payload.module is NEVER trusted
    from a faculty account). Admins may set any module or none."""
    if staff.get("role") == "faculty":
        module = staff.get("module")
        if not module:
            raise HTTPException(
                status_code=403,
                detail="No module assigned. Contact an administrator.",
            )
        return module
    return payload.module


# ── UPDATED POST ROUTE: CREATE EXAM WITH ALL CONTENT ──────────────────────────

@router.post("/exams")
@limiter.limit("10/minute")
def create_exam(
    request: Request,
    payload: ExamCreatePayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Creates an exam along with all its MCQs, Coding Problems, and Test Cases atomically.
    """
    exam_module = resolve_exam_module(staff, payload)

    try:
        exam_id = f"exam_{uuid.uuid4().hex[:8]}"

        # 1. Hash Passwords
        start_hash = bcrypt.hashpw(payload.start_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
        end_hash = None
        if payload.end_password:
            end_hash = bcrypt.hashpw(payload.end_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")

        enc_start = cipher_suite.encrypt(payload.start_password.encode("utf-8")).decode("utf-8") if payload.start_password else None
        enc_end = cipher_suite.encrypt(payload.end_password.encode("utf-8")).decode("utf-8") if payload.end_password else None

        new_exam = Exam(
            id=exam_id, title=payload.title, duration_seconds=payload.duration_minutes * 60,
            starts_at=payload.starts_at / 1000.0, status=payload.status,
            start_password_hash=start_hash, end_password_hash=end_hash,
            start_secret=enc_start, end_secret=enc_end,
            coding_duration_minutes=payload.coding_duration_minutes or None,
            mcq_duration_minutes=payload.mcq_duration_minutes or None,
            qna_duration_minutes=payload.qna_duration_minutes or None,
            module=exam_module,
        )
        db.add(new_exam)

        # 2b. Build Section Objects (must exist before questions reference them)
        section_id_map = {}  # client-supplied section.id -> generated db id
        for s_idx, s in enumerate(payload.sections):
            sec_id = f"sec_{exam_id}_{s_idx}_{uuid.uuid4().hex[:6]}"
            if s.id:
                section_id_map[s.id] = sec_id
            db.add(Section(
                id=sec_id, exam_id=exam_id, name=s.name, type=s.type,
                marks_per_question=s.marks_per_question, order_index=s.order_index
            ))

        # 3. Build Question (MCQ) Objects
        for idx, q in enumerate(payload.questions):
            new_q = Question(
                id      = f"q_{exam_id}_{idx}_{uuid.uuid4().hex[:6]}",
                exam_id = exam_id,
                section = q.section,
                text    = q.text,
                optA    = q.optA,
                optB    = q.optB,
                optC    = q.optC,
                optD    = q.optD,
                ans     = q.ans,
                section_id     = section_id_map.get(q.section_id, q.section_id),
                order_index    = q.order_index,
                marks          = q.marks,
                content_format = q.content_format if q.content_format in ("plain", "markdown") else "plain",
            )
            db.add(new_q)

        # 4. Build Coding Problem & Test Case Objects
        for p_idx, cp in enumerate(payload.coding_problems):
            cp_id = f"cp_{exam_id}_{p_idx}_{uuid.uuid4().hex[:6]}"
            new_cp = CodingProblem(
                id          = cp_id,
                exam_id     = exam_id,
                title       = cp.title,
                description = cp.description,
                constraints = cp.constraints,
                languages   = cp.languages,
                marks       = cp.marks
            )
            db.add(new_cp)

            # Build nested Test Cases
            for t_idx, tc in enumerate(cp.testCases):
                new_tc = TestCase(
                    id              = f"tc_{cp_id}_{t_idx}_{uuid.uuid4().hex[:4]}",
                    problem_id      = cp_id,
                    input_data      = tc.input,
                    expected_output = tc.output,
                    is_hidden       = tc.isHidden
                )
                db.add(new_tc)

        for idx, sq in enumerate(payload.subjective_questions):
            db.add(SubjectiveQuestion(
                id      = f"sq_{exam_id}_{idx}_{uuid.uuid4().hex[:6]}",
                exam_id = exam_id,
                section = sq.section,
                text    = sq.text,
                marks   = sq.marks,
                section_id     = section_id_map.get(sq.section_id, sq.section_id),
                order_index    = sq.order_index,
                content_format = sq.content_format if sq.content_format in ("plain", "markdown") else "plain",
            ))

        # 5. Atomic Commit (All or Nothing)
        db.commit()
        return {"success": True, "exam_id": exam_id, "message": "Exam created successfully"}

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create exam: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to save exam data to the database.")
    

@router.put("/exams/{exam_id}")
@limiter.limit("10/minute")
def update_exam(
    request: Request,
    exam_id: str,
    payload: ExamCreatePayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Updates an existing draft exam. 
    It atomically purges old questions/problems and replaces them with the new payload.
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)

    if exam.status not in ("draft", "upcoming"):
        # AUD-021: purging/replacing questions on a live or completed exam
        # destroys the mapping between already-submitted answers (keyed by
        # old question IDs) and the new question set.
        raise HTTPException(
            status_code=409,
            detail="Cannot edit a live or completed exam. Questions are locked once an exam goes live.",
        )

    try:

        # 1. Update Meta
        exam.title = payload.title
        exam.duration_seconds = payload.duration_minutes * 60
        exam.coding_duration_minutes = payload.coding_duration_minutes or None
        exam.mcq_duration_minutes = payload.mcq_duration_minutes or None
        exam.qna_duration_minutes = payload.qna_duration_minutes or None
        exam.starts_at = payload.starts_at / 1000.0
        exam.status = payload.status
        if staff.get("role") == "faculty":
            # Server-enforced: a faculty member can never move an exam out of
            # their module (payload.module is never trusted from faculty).
            exam.module = resolve_exam_module(staff, payload)
        elif "module" in payload.model_fields_set:
            exam.module = payload.module
        # payload.module omitted -> preserve the exam's existing module.

        if payload.start_password_changed is not False and payload.start_password:
            exam.start_password_hash = bcrypt.hashpw(payload.start_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            exam.start_secret = cipher_suite.encrypt(payload.start_password.encode("utf-8")).decode("utf-8")
            
        if payload.end_password_changed is not False and payload.end_password:
            exam.end_password_hash = bcrypt.hashpw(payload.end_password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            exam.end_secret = cipher_suite.encrypt(payload.end_password.encode("utf-8")).decode("utf-8") 

        # 2. Purge old nested data (Cascades will handle test cases)
        db.query(Question).filter(Question.exam_id == exam_id).delete()
        db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).delete()
        db.query(SubjectiveQuestion).filter(SubjectiveQuestion.exam_id == exam_id).delete()
        db.query(Section).filter(Section.exam_id == exam_id).delete()

        # 2b. Re-insert Sections (must exist before questions reference them)
        section_id_map = {}
        for s_idx, s in enumerate(payload.sections):
            sec_id = f"sec_{exam_id}_{s_idx}_{uuid.uuid4().hex[:6]}"
            if s.id:
                section_id_map[s.id] = sec_id
            db.add(Section(
                id=sec_id, exam_id=exam_id, name=s.name, type=s.type,
                marks_per_question=s.marks_per_question, order_index=s.order_index
            ))

        # 3. Re-insert new Questions
        for idx, q in enumerate(payload.questions):
            new_q = Question(
                id=f"q_{exam_id}_{idx}_{uuid.uuid4().hex[:6]}",
                exam_id=exam_id, section=q.section, text=q.text,
                optA=q.optA, optB=q.optB, optC=q.optC, optD=q.optD, ans=q.ans,
                section_id=section_id_map.get(q.section_id, q.section_id),
                order_index=q.order_index, marks=q.marks,
                content_format=q.content_format if q.content_format in ("plain", "markdown") else "plain",
            )
            db.add(new_q)

        # 4. Re-insert new Coding Problems & Test Cases
        for p_idx, cp in enumerate(payload.coding_problems):
            cp_id = f"cp_{exam_id}_{p_idx}_{uuid.uuid4().hex[:6]}"
            new_cp = CodingProblem(
                id=cp_id, exam_id=exam_id, title=cp.title,
                description=cp.description, constraints=cp.constraints,
                languages=cp.languages, marks=cp.marks
            )
            db.add(new_cp)

            for t_idx, tc in enumerate(cp.testCases):
                new_tc = TestCase(
                    id=f"tc_{cp_id}_{t_idx}_{uuid.uuid4().hex[:4]}",
                    problem_id=cp_id, input_data=tc.input,
                    expected_output=tc.output, is_hidden=tc.isHidden
                )
                db.add(new_tc)
        for idx, sq in enumerate(payload.subjective_questions):
            db.add(SubjectiveQuestion(
            id      = f"sq_{exam_id}_{idx}_{uuid.uuid4().hex[:6]}",
            exam_id = exam_id,
            section = sq.section,
            text    = sq.text,
            marks   = sq.marks,
            section_id=section_id_map.get(sq.section_id, sq.section_id),
            order_index=sq.order_index,
            content_format=sq.content_format if sq.content_format in ("plain", "markdown") else "plain",
            ))

        db.commit()
        return {"success": True, "message": "Exam updated successfully"}

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update exam: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to update exam data.")



# ── FACULTY-OWNED EVALUATION CONTEXT ──────────────────────────────────────────

def _build_faculty_context(staff: dict, exam, db: Session) -> dict:
    """Faculty roster for the exam's module with per-faculty evaluation state.

    - faculty role -> only their own identity, no roster leak.
    - admin       -> every faculty assigned to exam.module, with
                     has_evaluated / first_evaluated_at for selector UI.
    """
    entries = []
    sedge = (
        db.query(FacultyEvaluation)
        .join(ExamSession, ExamSession.id == FacultyEvaluation.session_id)
        .filter(
            ExamSession.exam_id == exam.id,
            (FacultyEvaluation.coding_marks.isnot(None))
            | (FacultyEvaluation.subjective_marks.isnot(None)),
        )
    )
    if staff.get("role") == "faculty":
        first = sedge.filter(FacultyEvaluation.faculty_id == staff.get("id")).order_by(FacultyEvaluation.created_at.asc()).first()
        entries.append({
            "id": staff.get("id"),
            "name": staff.get("name"),
            "email": staff.get("email"),
            "has_evaluated": first is not None,
            "first_evaluated_at": first.created_at if first else None,
        })
    else:
        frows = (
            db.query(StaffAccount)
            .filter(StaffAccount.role == "faculty", StaffAccount.module == exam.module)
            .order_by(StaffAccount.created_at.asc())
            .all()
        ) if exam.module else []
        for r in frows:
            first = sedge.filter(FacultyEvaluation.faculty_id == r.id).order_by(FacultyEvaluation.created_at.asc()).first()
            entries.append({
                "id": r.id,
                "name": r.name or r.email,
                "email": r.email,
                "has_evaluated": first is not None,
                "first_evaluated_at": first.created_at if first else None,
            })
    return {
        "available_faculty": entries,
        "default_faculty_id": default_faculty_id(db, exam.id),
        "legacy_available": legacy_available(db, exam.id),
    }


@router.get("/exams/{exam_id}/analytics")
def get_exam_analytics(
    exam_id: str,
    limit: Optional[int] = None,
    offset: int = 0,
    faculty_id: Optional[str] = None,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Fetches exam details, auto-grades all MCQ and Coding submissions on the fly,
    and returns the comprehensive analytics matrix expected by the React frontend.

    AUD-014: `limit`/`offset` are optional. Omitting them preserves the original
    behaviour (return all students) so existing callers are unaffected; callers
    that need to avoid loading all sessions for large exams can now page through
    results.

    Faculty ownership (optional `faculty_id` query): for faculty it is always
    coerced to their own evaluation. For admin it selects the evaluation
    context shown/exported; omitted -> server-computed default (earliest
    faculty), or legacy ownerless marks when none exist.
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)

    # Server-side fallback for the client-only auto-submit: finalize any session
    # whose exam window (end + grace) has fully passed so it reports as
    # Submitted/"Finished" instead of lingering "In Progress".
    finalize_expired_sessions(db, exam_id=exam_id)

    ctx = resolve_context(staff, exam, db, faculty_id)
    faculty_context = _build_faculty_context(staff, exam, db)
    faculty_context["selected_faculty_id"] = ctx["selected"]
    faculty_context["is_legacy"] = ctx["legacy"]

    # 1. Fetch Master Data
    questions = db.query(Question).filter(Question.exam_id == exam_id).all()
    coding_probs = db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).all()
    subjective_questions = db.query(SubjectiveQuestion).filter(SubjectiveQuestion.exam_id == exam_id).all()
    sections = db.query(Section).filter(Section.exam_id == exam_id).all()
    section_type_map = {s.name: s.type for s in sections}

    session_query = (
        db.query(ExamSession)
        .filter(ExamSession.exam_id == exam_id)
        .order_by(ExamSession.created_at.asc())
    )
    all_sessions = session_query.all()
    sessions = dedupe_sessions_per_student(all_sessions)
    total_students = len(sessions)
    if limit is not None:
        sessions = sessions[offset:offset + limit]

    # Map questions for O(1) grading lookups
    q_map = {q.id: q for q in questions}

    student_results = []

    # 2. Process and Grade each Session
    for s in sessions:
        coding_submissions = []

        subj_payload = {}
        if s.subjective_payload:
            try:
                subj_payload = json.loads(s.subjective_payload)
            except Exception:
                pass
        # Safely parse submission JSON
        payload = {}
        if s.submission_payload:
            try:
                payload = json.loads(s.submission_payload)
            except Exception:
                pass
        
        mcq_answers = payload.get("mcqs", {})    # Format expected from frontend: {"q_123": "A"}
        code_answers = payload.get("coding", {}) # Format: {"cp_123": {"code": "...", "score": 10, "runtime": 0.5, "results": [...]}}

        # ── GRADE MCQs — use persisted score if available, else compute on-the-fly ──
        mcq_score = s.mcq_score
        if mcq_score is None:
            mcq_score = 0
            for q_id, ans in mcq_answers.items():
                q = q_map.get(q_id)
                if q and q.ans == ans:
                    mcq_score += q.marks or 1

        # ── READ PERSISTED EVALUATION SCORES (selected faculty context) ──
        material = evaluation_material(s, ctx, db)
        cod_score = sum(material["coding_marks"].values())
        subjective_score = sum(material["subjective_marks"].values())

        # ── TOTAL SCORE ──
        total = material["total_score"]
        if total is None:
            total = mcq_score + cod_score + subjective_score

        # ── EXTRACT CODING RESULTS ──
        for cp in coding_probs:
            cp_data = code_answers.get(cp.id)
            if cp_data:
                coding_submissions.append({
                    "problemId": cp.id,
                    "problemTitle": cp.title,
                    "isAttempted": True,
                    "status": "pending_evaluation",
                    "submittedCode": cp_data.get("code", ""),
                })
            else:
                coding_submissions.append({
                    "problemId": cp.id,
                    "problemTitle": cp.title,
                    "isAttempted": False
                })

        # Heuristic: Extract Department from Roll No (e.g., 23-AIML50-27 -> AIML)
        dept = "General"
        if "-" in s.student_id:
            parts = s.student_id.split("-")
            if len(parts) >= 2:
                dept = parts[1][:4].upper()

        student_results.append({
            "student_id": s.student_id,
            "department": dept,
            "submitted": s.is_submitted,
            "joined_at": s.created_at,
            "mcq_score": mcq_score,
            "cod_score": cod_score,
            "subjective_score": subjective_score,
            "total_score": total,
            "coding_submissions": coding_submissions,
            "subjective_answers": subj_payload,
            "review_status": material["review_status"],
            "evaluated_at": material["evaluated_at"],
        })
    # 3. Return Payload matching AnalyticsView.jsx expectations
    return {
        "success": True,
        "data": {
            "exam_id": exam_id,
            "title": exam.title,
            "questions": [{"id": q.id, "section": q.section, "text": q.text} for q in questions],
            "coding_problems": [{"id": cp.id, "title": cp.title} for cp in coding_probs],
            "subjective_questions": [{"id": sq.id, "section": sq.section, "text": sq.text} for sq in subjective_questions],
            "students": student_results,
            "faculty_context": faculty_context,
            "total_students": total_students,  # AUD-014: lets callers page through large exams
            "limit": limit,
            "offset": offset,
        }
    }

# ── ACTIVE EXAMS (upcoming + live only) ────────────────────────────────────────

@router.get("/exams/active")
def list_active_exams(
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Returns only upcoming and live exams.
    Used by Test Credentials tab to show assignable exams.
    Completed and draft exams are excluded.
    Faculty only see exams in their assigned module.
    """
    exams = db.query(Exam).all()
    if staff.get("role") == "faculty":
        module = staff.get("module")
        if not module:
            return {"success": True, "data": []}
        exams = [e for e in exams if e.module == module]

    now = time.time()
    result = []

    for exam in exams:
        computed_status, _end_at = compute_exam_status(exam, now)
        if computed_status not in ("upcoming", "live"):
            continue  # draft / completed — skip

        result.append({
            "id":               exam.id,
            "title":            exam.title,
            "duration_minutes": exam.duration_seconds // 60,
            "starts_at_ms":     exam.starts_at * 1000,
            "status":           computed_status,
            "module":           exam.module,
        })

    return {"success": True, "data": result}


# ── 1. GET FULL EXAM DETAILS (For Preview Mode) ─────────────────────────────────
@router.get("/exams/{exam_id}")
def get_exam_full(exam_id: str, staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam: raise HTTPException(status_code=404)

    require_exam_scope(staff, exam)
    
    qs = db.query(Question).filter(Question.exam_id == exam_id).order_by(Question.order_index).all()
    cps = db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).all()
    sqs = db.query(SubjectiveQuestion).filter(SubjectiveQuestion.exam_id == exam_id).order_by(SubjectiveQuestion.order_index).all()
    secs = db.query(Section).filter(Section.exam_id == exam_id).order_by(Section.order_index).all()
    
    return {"success": True, "data": {
        "id": exam.id,
        "title": exam.title,
        "duration_minutes": exam.duration_seconds // 60,
        "coding_duration_minutes": exam.coding_duration_minutes,
        "mcq_duration_minutes": exam.mcq_duration_minutes,
        "qna_duration_minutes": exam.qna_duration_minutes,
        "module": exam.module,
        "sections": [{"id": s.id, "name": s.name, "type": s.type, "marks_per_question": s.marks_per_question, "order_index": s.order_index} for s in secs],
        "questions": [{"id": q.id, "section": q.section, "text": q.text, "optA": q.optA, "optB": q.optB, "optC": q.optC, "optD": q.optD, "ans": q.ans, "section_id": q.section_id, "order_index": q.order_index, "marks": q.marks, "content_format": q.content_format} for q in qs],
        "coding_problems": [{"id": cp.id, "title": cp.title, "description": cp.description, "constraints": cp.constraints} for cp in cps],
        "subjective_questions": [{"id": sq.id, "section": sq.section, "text": sq.text, "marks": sq.marks, "section_id": sq.section_id, "order_index": sq.order_index, "content_format": sq.content_format} for sq in sqs]
    }}

@router.get("/exams/{exam_id}/monitor")
def get_live_monitor(exam_id: str, staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)

    # Server-side fallback for the client-only auto-submit: finalize expired
    # (end + grace elapsed) sessions so the monitor reflects them as Completed
    # instead of lingering in the active "In Exam" bucket.
    finalize_expired_sessions(db, exam_id=exam_id)

    enrolled = db.query(TokenRegistry).filter(TokenRegistry.exam_id == exam_id).count()
    all_sessions = db.query(ExamSession).filter(ExamSession.exam_id == exam_id).all()
    sessions = dedupe_sessions_per_student(all_sessions)
    
    session_ids = [s.id for s in sessions]
    # Get violation breakdown per session
    violation_detail = {}
    if session_ids:
        v_rows = db.query(ViolationLog.session_id, ViolationLog.event_type, func.count(ViolationLog.id)).filter(
            ViolationLog.session_id.in_(session_ids)
        ).group_by(ViolationLog.session_id, ViolationLog.event_type).all()
        for sid, etype, cnt in v_rows:
            if sid not in violation_detail:
                violation_detail[sid] = {}
            violation_detail[sid][etype] = cnt

    active_now = 0; total_submitted = 0; student_data = []
    for s in sessions:
        if s.is_submitted: total_submitted += 1
        else: active_now += 1
            
        breakdown = violation_detail.get(s.id, {})
        total_violations = sum(breakdown.values())
        student_data.append({
            "student_id": s.student_id, "session_id": s.id,
            "submitted": s.is_submitted, "is_locked": s.is_revoked and not s.is_submitted,
            "total_violations": total_violations,
            "violation_breakdown": breakdown,
            "joined_at": s.created_at
        })
        
    return {"success": True, "data": {
        "total_enrolled": enrolled, "active_now": active_now, 
        "total_submitted": total_submitted, "students": student_data
    }}

# ── 3. POST KICK-OUT (REVOKE SESSION) ──────────────────────────────────────────
class RevokePayload(BaseModel):
    session_id: str

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Invalid session_id.")
        return v

@router.post("/sessions/revoke")
@limiter.limit("10/minute")
def revoke_session(request: Request, payload: RevokePayload, staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    """
    Force-terminate a student's session (admin kick-out button).

    ROOT CAUSE FIX: this used to only set is_revoked=True. The dashboard's
    Active/Completed split (and the "is_locked" flag) is driven entirely by
    is_submitted (see list_monitor_data above + LiveTestMonitor.jsx's
    `s.submitted` filter) — so a revoked session with is_submitted still
    False stayed in Active Candidates forever, even though the confirm
    dialog promises "This auto-submits their current progress." Setting
    is_submitted=True here is what actually finalizes the session, exactly
    like the student's own /exam/{id}/submit endpoint does — moving them
    into Completed Candidates and clearing the locked state.
    """
    session = db.query(ExamSession).filter(ExamSession.id == payload.session_id).first()
    if session:
        exam = db.query(Exam).filter(Exam.id == session.exam_id).first()
        require_exam_scope(staff, exam)
        session.is_revoked = True
        session.is_submitted = True
        db.commit()
    return {"success": True}

# ── 5. GRANT SESSION (UNLOCK STUDENT) ──────────────────────────────────────────
class GrantPayload(BaseModel):
    session_id: str

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Invalid session_id.")
        return v

@router.post("/sessions/grant")
@limiter.limit("10/minute")
def grant_session(request: Request, payload: GrantPayload, staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    """Unlock a student whose session was revoked due to violations. Preserves all exam state."""
    session = db.query(ExamSession).filter(ExamSession.id == payload.session_id).first()
    if session:
        exam = db.query(Exam).filter(Exam.id == session.exam_id).first()
        require_exam_scope(staff, exam)
        session.is_revoked = False
        db.commit()
    return {"success": True}

# ── 4. STUDENT DIRECTORY CRUD ──────────────────────────────────────────────────
class StudentCreatePayload(BaseModel):
    student_id: str
    exam_id: str
    password: str

    @field_validator("student_id")
    @classmethod
    def validate_student_id(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Invalid student_id.")
        if not re.match(r"^[A-Za-z0-9_\-\.]+$", v):
            raise ValueError("Student ID contains invalid characters.")
        return v

    @field_validator("exam_id")
    @classmethod
    def validate_exam_id(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Invalid exam_id.")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        if not v or len(v) > 256:
            raise ValueError("Invalid password length.")
        if len(v) < 4:
            raise ValueError("Password must be at least 4 characters.")
        return v

class StudentsBulkPayload(BaseModel):
    students: List[StudentCreatePayload]


# ── 1. ADD THIS BULK DELETE ENDPOINT ──
class BulkDeletePayload(BaseModel):
    tokens: List[str]
    exam_id: Optional[str] = None

    @field_validator("tokens")
    @classmethod
    def validate_tokens(cls, v):
        if not v:
            raise ValueError("tokens list cannot be empty.")
        for t in v:
            if not t or len(t) > 256:
                raise ValueError("Each token must be non-empty and at most 256 characters.")
        return v

@router.post("/students/bulk-delete")
@limiter.limit("10/minute")  # AUD-008: rate-limit destructive op
def bulk_delete_students(request: Request, payload: BulkDeletePayload, staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    """High-Performance route to delete multiple students at once."""
    if payload.tokens:
        if staff.get("role") == "faculty":
            records = db.query(TokenRegistry).filter(TokenRegistry.token.in_(payload.tokens)).all()
            for r in records:
                exam = db.query(Exam).filter(Exam.id == r.exam_id).first()
                require_exam_scope(staff, exam)
        query = db.query(TokenRegistry).filter(TokenRegistry.token.in_(payload.tokens))
        if payload.exam_id:
            if staff.get("role") == "faculty":
                exam = db.query(Exam).filter(Exam.id == payload.exam_id).first()
                require_exam_scope(staff, exam)
            query = query.filter(TokenRegistry.exam_id == payload.exam_id)
        query.delete(synchronize_session=False)
        db.commit()
    return {"success": True}

# ── GET ALL STUDENTS (Fortified with Auto-Migration) ───────────────────────────
@router.get("/students")
def list_students(
    exam_id: Optional[str] = None,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """Fetch all students. Includes root-level schema self-healing.

    Faculty without an exam_id filter only see enrollments in their module's
    exams; a pending faculty (no module) sees an empty list.
    """
    query = db.query(TokenRegistry)
    if exam_id:
        if staff.get("role") == "faculty":
            exam = db.query(Exam).filter(Exam.id == exam_id).first()
            require_exam_scope(staff, exam)
        query = query.filter(TokenRegistry.exam_id == exam_id)
    elif staff.get("role") == "faculty":
        module = staff.get("module")
        if not module:
            return {"success": True, "data": []}
        module_exam_ids = [e.id for e in db.query(Exam.id).filter(Exam.module == module).all()]
        if not module_exam_ids:
            return {"success": True, "data": []}
        query = query.filter(TokenRegistry.exam_id.in_(module_exam_ids))
    records = query.all()

    if not records:
        return {"success": True, "data": []}

    student_ids = [r.student_id for r in records]
    
    # Bulk fetch sessions
    session_query = db.query(ExamSession).filter(
        ExamSession.student_id.in_(student_ids),
    )
    if exam_id:
        # AUD-016: scope to the filtered exam instead of loading every
        # session across all exams for these students.
        session_query = session_query.filter(ExamSession.exam_id == exam_id)
    sessions = dedupe_sessions_per_student(session_query.all())

    session_map = {(s.student_id, s.exam_id): s for s in sessions}

    result = []
    for r in records:
        session = session_map.get((r.student_id, r.exam_id))
        result.append({
            "token":      r.token,
            "student_id": r.student_id,
            "exam_id":    r.exam_id,
            "is_active":  r.is_active,
            "submitted":  session.is_submitted if session else False,
            "session_id": session.id if session else None,
        })
    return {"success": True, "data": result}


# ── POST STUDENTS (Fortified with Upsert Logic to prevent duplicates) ──────────
@router.post("/students")
@limiter.limit("10/minute")
def create_students(request: Request, payload: StudentsBulkPayload, staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):

    if staff.get("role") == "faculty":
        module = staff.get("module")
        if not module:
            raise HTTPException(
                status_code=403,
                detail="No module assigned. Contact an administrator.",
            )
        exam_ids = {s.exam_id for s in payload.students}
        exams = {e.id: e for e in db.query(Exam).filter(Exam.id.in_(exam_ids)).all()}
        for eid in exam_ids:
            require_exam_scope(staff, exams.get(eid))

    for s in payload.students:
        # 🚀 ROOT FIX 2: Upsert Logic (Check if student already exists for this exam)
        existing_record = db.query(TokenRegistry).filter(
            TokenRegistry.student_id == s.student_id,
            TokenRegistry.exam_id == s.exam_id
        ).first()
        
        hashed = bcrypt.hashpw(s.password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
        
        if existing_record:
            # UPDATE: Overwrite password and reactivate, but KEEP the same token
            existing_record.password_hash = hashed
            existing_record.is_active = True
        else:
            # INSERT: Brand new student, mint a new token
            token = f"LIAS_{s.student_id.upper()}_{secrets.token_hex(4).upper()}"
            db.add(TokenRegistry(
                token=token, exam_id=s.exam_id, student_id=s.student_id,
                password_hash=hashed, is_active=True
            ))
            
    db.commit()
    return {"success": True}

class StudentUpdatePayload(BaseModel):
    password: Optional[str] = None
    is_active: bool

@router.put("/students/{token}")
@limiter.limit("10/minute")
def update_student(request: Request, token: str, payload: StudentUpdatePayload, staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    record = db.query(TokenRegistry).filter(TokenRegistry.token == token).first()
    if not record: raise HTTPException(status_code=404)
    exam = db.query(Exam).filter(Exam.id == record.exam_id).first()
    require_exam_scope(staff, exam)
    record.is_active = payload.is_active
    if payload.password:
        record.password_hash = bcrypt.hashpw(payload.password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
    db.commit()
    return {"success": True}

@router.delete("/students/{token}")
@limiter.limit("10/minute")  # AUD-008: rate-limit destructive op
def delete_student(request: Request, token: str, staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    record = db.query(TokenRegistry).filter(TokenRegistry.token == token).first()
    if not record: raise HTTPException(status_code=404)
    exam = db.query(Exam).filter(Exam.id == record.exam_id).first()
    require_exam_scope(staff, exam)
    db.delete(record)
    db.commit()
    return {"success": True}

@router.get("/exams")
def list_exams(
    limit: Optional[int] = None,
    offset: int = 0,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    query = db.query(Exam).order_by(Exam.starts_at.desc())
    if staff.get("role") == "faculty":
        module = staff.get("module")
        if not module:
            return {"success": True, "data": [], "total": 0, "limit": limit, "offset": offset}
        query = query.filter(Exam.module == module)
    total = query.count()
    if limit is not None:
        query = query.limit(limit).offset(offset)
    exams = query.all()
    now = time.time()

    total_counts = dict(
        db.query(ExamSession.exam_id, func.count(func.distinct(ExamSession.student_id)))
        .group_by(ExamSession.exam_id)
        .all()
    )
    submitted_counts = dict(
        db.query(ExamSession.exam_id, func.count(func.distinct(ExamSession.student_id)))
        .filter(ExamSession.is_submitted == True)
        .group_by(ExamSession.exam_id)
        .all()
    )

    result = []
    for exam in exams:
        computed_status, end_at = compute_exam_status(exam, now)

        dec_start = "********"
        dec_end = None 
        try:
            if exam.start_secret: dec_start = cipher_suite.decrypt(exam.start_secret.encode("utf-8")).decode("utf-8")
            if exam.end_secret: dec_end = cipher_suite.decrypt(exam.end_secret.encode("utf-8")).decode("utf-8")
        except Exception as e:
            logger.warning("Failed to decrypt secrets for exam %s: %s", exam.id, e)

        stats = {"total": total_counts.get(exam.id, 0), "submitted": submitted_counts.get(exam.id, 0)}
        result.append({
            "id": exam.id, "title": exam.title, "duration_minutes": exam.duration_seconds // 60,
            "starts_at_ms": exam.starts_at * 1000, "status": computed_status,
            "participants": stats["total"], "submitted": stats["submitted"],
            "start_password": dec_start, "end_password": dec_end,
            "module": exam.module
        })
    return {"success": True, "data": result, "total": total, "limit": limit, "offset": offset}

@router.delete("/exams/{exam_id}")
@limiter.limit("10/minute")  # AUD-008: rate-limit destructive op
def delete_exam(request: Request, exam_id: str, staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)

    try:

        # 1. Clean up violation logs attached to this exam's sessions
        session_ids = [s.id for s in db.query(ExamSession.id).filter(ExamSession.exam_id == exam_id).all()]
        if session_ids:
            db.query(ViolationLog).filter(ViolationLog.session_id.in_(session_ids)).delete(synchronize_session=False)
        
        # 2. Clean up test cases attached to this exam's coding problems
        problem_ids = [p.id for p in db.query(CodingProblem.id).filter(CodingProblem.exam_id == exam_id).all()]
        if problem_ids:
            db.query(TestCase).filter(TestCase.problem_id.in_(problem_ids)).delete(synchronize_session=False)
            
        # 3. Clean up core child tables
        db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).delete(synchronize_session=False)
        db.query(Question).filter(Question.exam_id == exam_id).delete(synchronize_session=False)
        db.query(ExamSession).filter(ExamSession.exam_id == exam_id).delete(synchronize_session=False)
        db.query(TokenRegistry).filter(TokenRegistry.exam_id == exam_id).delete(synchronize_session=False)
        db.query(SubjectiveQuestion).filter(SubjectiveQuestion.exam_id == exam_id).delete(synchronize_session=False)
        db.query(Section).filter(Section.exam_id == exam_id).delete(synchronize_session=False)
        # 4. Finally, safely delete the parent Exam
        db.query(Exam).filter(Exam.id == exam_id).delete(synchronize_session=False)
        db.commit()
        return {"success": True}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Safe cascade delete failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete exam and its nested records.")


# ── MASTER DIRECTORY CRUD ───────────────────────────────────────────────────────

class MasterStudentCreatePayload(BaseModel):
    id: str
    name: Optional[str] = None
    password: str
    is_active: bool = True

    @field_validator("id")
    @classmethod
    def validate_student_id(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Student ID cannot be empty or exceed 128 characters.")
        if not v.strip():
            raise ValueError("Student ID cannot be blank.")
        if not re.match(r"^[A-Za-z0-9_\-\.]+$", v.strip()):
            raise ValueError("Student ID contains invalid characters.")
        return v.strip()

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        if not v or len(v) > 256:
            raise ValueError("Invalid password length.")
        if len(v) < 4:
            raise ValueError("Password must be at least 4 characters.")
        return v

class MasterStudentUpdatePayload(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None  # if omitted, keep existing
    is_active: bool = True


class MasterStudentsBulkPayload(BaseModel):
    students: List[MasterStudentCreatePayload]


@router.get("/master-students")
def list_master_students(
    limit: Optional[int] = None,
    offset: int = 0,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Return all students from Master Directory with their exam enrollments.
    Each student row includes a list of exam_ids they're enrolled in (from TokenRegistry).

    AUD-041: "Assigned Exams" only shows enrollments for exams that are still
    LIVE, or that ended less than 1 hour ago. Older-completed enrollments are
    NOT deleted anywhere — TokenRegistry rows, sessions, and history all stay
    intact. This is a display-only filter for the Master Directory UI, so we
    do it here (backend) rather than shipping every stale enrollment to the
    frontend just to hide it there.

    Faculty: the Master Directory itself stays global (read-only for faculty),
    but enrollments are filtered down to the faculty member's module exams.
    """
    query = db.query(Student).order_by(Student.created_at.desc())
    total = query.count()
    if limit is not None:
        query = query.limit(limit).offset(offset)
    students = query.all()
    student_ids = [s.id for s in students]

    now = time.time()
    HIDE_AFTER_SECONDS = 3600

    exam_status_map = {
        exam.id: compute_exam_status(exam, now) for exam in db.query(Exam).all()
    }

    if staff.get("role") == "faculty":
        module = staff.get("module")
        if not module:
            return {"success": True, "data": [], "total": total, "limit": limit, "offset": offset}
        allowed_exam_ids = {
            e.id for e in db.query(Exam).filter(Exam.module == module).all()
        }
    else:
        allowed_exam_ids = None

    enrollments = (
        db.query(TokenRegistry.student_id, TokenRegistry.exam_id, TokenRegistry.token)
        .filter(TokenRegistry.student_id.in_(student_ids))
        .all()
    )
    enrollment_map: dict[str, list] = {}
    for e in enrollments:
        if allowed_exam_ids is not None and e.exam_id not in allowed_exam_ids:
            continue
        status_end = exam_status_map.get(e.exam_id)
        if status_end is not None:
            computed_status, end_at = status_end
            is_visible = computed_status == "live" or now <= end_at + HIDE_AFTER_SECONDS
            if not is_visible:
                continue
        enrollment_map.setdefault(e.student_id, []).append({
            "exam_id": e.exam_id,
            "token":   e.token,
        })

    result = []
    for s in students:
        result.append({
            "id":          s.id,
            "name":        s.name,
            "is_active":   s.is_active,
            "created_at":  s.created_at,
            "needs_password_reset": getattr(s, "needs_password_reset", False),
            "enrollments": enrollment_map.get(s.id, []),
        })

    return {"success": True, "data": result, "total": total, "limit": limit, "offset": offset}


@router.post("/master-students")
@limiter.limit("10/minute")
def create_master_student(
    request: Request,
    payload: MasterStudentCreatePayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """Add a student to the Master Directory. Fails if student_id already exists."""
    require_admin(staff)
    existing = db.query(Student).filter(Student.id == payload.id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Student '{payload.id}' already exists.")

    hashed = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    db.add(Student(
        id=payload.id,
        name=payload.name,
        password=hashed,
        is_active=payload.is_active,
        created_at=time.time(),
        needs_password_reset=False,
    ))
    db.commit()
    return {"success": True, "id": payload.id}


@router.post("/master-students/bulk")
@limiter.limit("10/minute")
def bulk_create_master_students(
    request: Request,
    payload: MasterStudentsBulkPayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Bulk upsert into Master Directory (CSV upload feeds this).
    Mirrors the upsert pattern in create_students() (per-exam bulk, admin.py ~661),
    but targets Student instead of TokenRegistry.
    - New id -> insert with hashed password.
    - Existing id -> update name/is_active, and password ONLY if a non-empty
      value was supplied (so re-uploading a CSV without passwords doesn't
      wipe existing real passwords back to blank).
    Returns counts so the UI can show created/updated, matching assign_students_to_exam's shape.
    """
    require_admin(staff)
    created = 0
    updated = 0

    for s in payload.students:
        existing = db.query(Student).filter(Student.id == s.id).first()
        if existing:
            if s.name is not None:
                existing.name = s.name
            existing.is_active = s.is_active
            if s.password:
                existing.password = bcrypt.hashpw(
                    s.password.encode("utf-8"), bcrypt.gensalt(rounds=12)
                ).decode("utf-8")
                existing.needs_password_reset = False
            updated += 1
        else:
            hashed = bcrypt.hashpw(s.password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            db.add(Student(
                id=s.id,
                name=s.name,
                password=hashed,
                is_active=s.is_active,
                created_at=time.time(),
                needs_password_reset=False,
            ))
            created += 1

    db.commit()
    return {"success": True, "created": created, "updated": updated}


@router.put("/master-students/{student_id}")
@limiter.limit("10/minute")
def update_master_student(
    request: Request,
    student_id: str,
    payload: MasterStudentUpdatePayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """Edit name, password, or active status of a master student."""
    require_admin(staff)
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    student.is_active = payload.is_active
    if payload.name is not None:
        student.name = payload.name
    if payload.password:
        hashed = bcrypt.hashpw(
            payload.password.encode("utf-8"), bcrypt.gensalt(rounds=12)
        ).decode("utf-8")
        student.password = hashed
        student.needs_password_reset = False

        # ROOT CAUSE FIX: exam login (auth.py) verifies against
        # TokenRegistry.password_hash, not Student.password. Without this
        # resync, saving a new password here updated the Master Directory
        # record but left already-assigned exam tokens on the OLD hash, so
        # the student couldn't actually log in with the new password.
        # Mirrors the same resync done in reset_and_resync_student below.
        db.query(TokenRegistry).filter(TokenRegistry.student_id == student_id).update(
            {"password_hash": hashed}
        )

    db.commit()
    return {"success": True}


class ResetAndResyncPayload(BaseModel):
    password: str


@router.post("/master-students/{student_id}/reset-and-resync")
@limiter.limit("10/minute")
def reset_and_resync_student(
    request: Request,
    student_id: str,
    payload: ResetAndResyncPayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    One-click fix for the 'placeholder hash poisoned my exam login' problem.
    1. Sets a real password on the Master Directory record (same as PUT /master-students/{id}).
    2. Immediately re-propagates that new hash into every TokenRegistry row for
       this student, across all exams — so existing assignments don't need a
       manual re-assign to pick up the fix.
    """
    require_admin(staff)
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    hashed = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    student.password = hashed
    student.is_active = True
    student.needs_password_reset = False

    rows = db.query(TokenRegistry).filter(TokenRegistry.student_id == student_id).all()
    for row in rows:
        row.password_hash = hashed
        row.is_active = True

    db.commit()
    return {
        "success": True,
        "id": student_id,
        "resynced_tokens": len(rows),
    }


@router.delete("/master-students/{student_id}")
@limiter.limit("10/minute")  # AUD-008: rate-limit destructive op
def delete_master_student(
    request: Request,
    student_id: str,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Remove student from Master Directory.
    Does NOT delete TokenRegistry rows — enrollment history preserved for audit.
    """
    require_admin(staff)
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    db.delete(student)
    db.commit()
    return {"success": True}


# ── EXAM ASSIGNMENT (assign master students to an exam) ────────────────────────

class AssignStudentsPayload(BaseModel):
    student_ids: List[str]

    @field_validator("student_ids")
    @classmethod
    def validate_student_ids(cls, v):
        if not v:
            raise ValueError("student_ids list cannot be empty.")
        for sid in v:
            if not sid or len(sid) > 128:
                raise ValueError("Each student_id must be non-empty and at most 128 characters.")
            if not re.match(r"^[A-Za-z0-9_\-\.]+$", sid):
                raise ValueError(f"Student ID '{sid}' contains invalid characters.")
        return v


@router.post("/exams/{exam_id}/assign")
@limiter.limit("10/minute")
def assign_students_to_exam(
    request: Request,
    exam_id: str,
    payload: AssignStudentsPayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Bulk-assign Master Directory students to an exam.
    - Fetches master password from Student table.
    - Reuses existing upsert logic: updates if enrolled, inserts if new.
    - Skips students not found in Master Directory.
    - AUD-025: also skips students whose Master password is still an unset
      placeholder (needs_password_reset=TRUE) — these get reported separately
      as `needs_reset` instead of silently locking them out with a hash
      nobody knows. Admin should use Reset & Resync for those first.
    - Returns counts of created vs updated vs skipped vs needs_reset.
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)

    students = db.query(Student).filter(Student.id.in_(payload.student_ids)).all()
    found_ids = {s.id for s in students}
    skipped = [sid for sid in payload.student_ids if sid not in found_ids]

    created = 0
    updated = 0
    needs_reset = []

    for student in students:
        if getattr(student, "needs_password_reset", False):
            needs_reset.append(student.id)
            continue

        existing = db.query(TokenRegistry).filter(
            TokenRegistry.student_id == student.id,
            TokenRegistry.exam_id == exam_id,
        ).first()

        if existing:
            existing.password_hash = student.password
            existing.is_active = True
            updated += 1
        else:
            token = f"LIAS_{student.id.upper()}_{secrets.token_hex(4).upper()}"
            db.add(TokenRegistry(
                token=token,
                exam_id=exam_id,
                student_id=student.id,
                password_hash=student.password,
                is_active=True,
            ))
            created += 1

    db.commit()
    return {
        "success": True,
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "needs_reset": needs_reset,
    }


# ── STAFF MANAGEMENT (admin-only) ──────────────────────────────────────────────

@router.get("/staff")
def list_staff(staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    """List all admin/faculty accounts (no password hashes, ever)."""
    require_admin(staff)
    rows = db.query(StaffAccount).order_by(StaffAccount.created_at.asc()).all()
    return {"success": True, "data": [
        {
            "id": s.id,
            "name": s.name,
            "email": s.email,
            "role": s.role,
            "module": s.module,
            "created_at": s.created_at,
        }
        for s in rows
    ]}


@router.put("/staff/{staff_id}")
@limiter.limit("10/minute")
def assign_staff_module(
    request: Request,
    staff_id: str,
    payload: ModuleAssignPayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """Assign/reassign/clear (null) a faculty account's module. Admin-only."""
    require_admin(staff)
    row = db.query(StaffAccount).filter(StaffAccount.id == staff_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Staff account not found.")
    if row.role != "faculty":
        raise HTTPException(
            status_code=400, detail="Only faculty accounts can be assigned a module."
        )
    row.module = payload.module
    db.commit()
    return {"success": True, "id": row.id, "module": row.module}


@router.get("/modules")
def list_modules(staff: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    """Canonical module registry (fixed list of codes, never user-typed)."""
    require_admin(staff)
    return {"success": True, "data": list(MODULES)}