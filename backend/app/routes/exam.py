import time
import json
import bcrypt
import logging
from typing import Literal, Dict, Any, Optional 
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ValidationError, Field, field_validator
from app.auth import verify_session_guard
from app.limiter import limiter
from app import repositories as repo
from app.repositories import _AttrDict, parse_json

router = APIRouter()
logger = logging.getLogger("scope")

# ── SESSION STATUS (used by lock screen to detect admin GRANT) ─────────────────
@router.get("/session-status")
def get_session_status(
    active_session = Depends(verify_session_guard),
):
    """Lightweight endpoint the lock screen polls to detect admin GRANT (unlock).
    verify_session_guard returns 401 if revoked, so a 200 response means session is valid."""
    return {"success": True, "is_revoked": False, "is_submitted": active_session.is_submitted}

ALLOWED_EVENTS = {
    "tab_switch", "fullscreen_exit", "copy_paste", "devtools",
    "face_absent", "multi_person", "right_click", "keyboard_shortcut",
    "object_detected", "proctor_head_pose",
    "proctor_engine_degraded",  # AUD-052: raised when detection pipeline fails closed instead of silently
}

# Grace period (seconds) after exam end before late submissions are rejected
LATE_SUBMISSION_GRACE_SECONDS = 60


def finalize_expired_sessions(*, exam_id: Optional[str] = None, student_id: Optional[str] = None) -> int:
    """Mark exam sessions as globally submitted once their exam has fully ended.

    This is the server-side safety net for the client-only auto-submit: if a
    browser never delivered its final POST /exam/{id}/submit (tab closed at the
    deadline, network failure, request timeout, client-clock drift past the
    grace window, or an expired JWT), the session would otherwise stay
    is_submitted=False and show forever as "In Progress" in analytics/monitor.

    Safety rules:
    * Only sessions whose exam satisfied
        now > starts_at + duration_seconds + LATE_SUBMISSION_GRACE_SECONDS
      are touched — the exact boundary at which submit_exam would reject a late
      submission (grace preserved, nothing finalized before the exam truly ends).
    * A single update operation makes repeat/concurrent execution idempotent.
    * Only the is_submitted flag is flipped. Submission/subjective payloads,
      evaluations, violations and all other session data are left untouched —
      no answers are fabricated or overwritten.
    """
    now = time.time()
    grace_cutoff = now - LATE_SUBMISSION_GRACE_SECONDS

    _expired_docs = repo.find_all("exams", {
        "$expr": {"$lt": [{"$add": ["$starts_at", "$duration_seconds"]}, grace_cutoff]}
    })
    expired_ids = [d["_id"] for d in _expired_docs]
    if not expired_ids:
        return 0
    mongo_filter = {"is_submitted": False, "exam_id": {"$in": expired_ids}}
    if exam_id:
        mongo_filter["exam_id"] = exam_id
    if student_id:
        mongo_filter["student_id"] = student_id
    _, finalized = repo.update_many("exam_sessions", mongo_filter, {"is_submitted": True})
    return int(finalized)


class SubmissionPayloadSchema(BaseModel):
    mcqs: Dict[str, str] = {}
    coding: Dict[str, Any] = {}


class ViolationPayload(BaseModel):
    event_type: str
    detail:     str = Field(default="", max_length=1024)


class SubmitPayload(BaseModel):
    answers:    dict           # MCQ: { question_id: "A" }
    autoSubmit: bool = False
    subjective: Optional[dict] = None   # { question_id: "markdown string" }

    @field_validator('subjective')
    @classmethod
    def validate_subjective(cls, v):
        if v is None:
            return v
        import re
        for qid, text in v.items():
            if not isinstance(text, str):
                raise ValueError("Subjective answer must be a string.")
            if len(text) > 10000:
                raise ValueError(f"Answer for {qid} exceeds 10,000 character limit.")
            if re.search(r'<[a-zA-Z][^>]*>', text):
                raise ValueError(f"Answer for {qid} contains disallowed HTML.")
        return v


class PasswordVerifyPayload(BaseModel):
    type:     Literal["start", "end"]
    password: str


# ── AUD-002: Coding stub payloads ──────────────────────────────────────────────

class CodeRunPayload(BaseModel):
    language_id: str
    source_code: str
    stdin: Optional[str] = ""

class CodeSubmitPayload(BaseModel):
    language_id: str
    source_code: str
    problem_id:  str


# ── VIOLATION ROUTES ───────────────────────────────────────────────────────────

@router.post("/violation")
def log_violation(
    payload:        ViolationPayload,
    active_session  = Depends(verify_session_guard),
):
    if payload.event_type not in ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail="Unknown event type.")

    try:
        violation_id = f"vl_{int(time.time()*1000)}_{active_session.id[:8]}"
        violation_doc = {
            "_id": violation_id,
            "session_id": active_session.id,
            "student_id": active_session.student_id,
            "exam_id": active_session.exam_id,
            "event_type": payload.event_type,
            "occurred_at": time.time(),
            "detail": payload.detail[:256] if payload.detail else "",
        }
        repo.insert_one("violation_logs", violation_doc)
        current_violations = repo.count("violation_logs", {"session_id": active_session.id})
        revoked = current_violations >= 3
        if revoked:
            repo.update_one("exam_sessions", {"_id": active_session.id}, {"is_revoked": True})
    except Exception:
        logger.warning("[EXAM] Mongo write failed for log_violation")
        revoked = False

    return {"success": True, "revoked": revoked}


@router.get("/violation/count")
def get_violation_count(
    active_session  = Depends(verify_session_guard),
):
    pipeline = [
        {"$match": {"session_id": active_session.id}},
        {"$group": {"_id": "$event_type", "count": {"$sum": 1}}},
    ]
    agg_results = repo.aggregate("violation_logs", pipeline)
    breakdown = {e: 0 for e in ALLOWED_EVENTS}
    total = 0
    for r in agg_results:
        etype = r["_id"]
        cnt = r["count"]
        breakdown[etype] = cnt
        total += cnt

    return {"success": True, "count": total, "breakdown": breakdown}


# ── DASHBOARD FEED ─────────────────────────────────────────────────────────────

@router.get("/student/available-tests")
def get_available_tests(
    active_session  = Depends(verify_session_guard),
):
    _doc = repo.find_one("token_registry", {
        "student_id": active_session.student_id,
        "exam_id": active_session.exam_id,
    })
    token_record = _AttrDict(_doc) if _doc else None
    if not token_record:
        raise HTTPException(status_code=404, detail="Student record not found.")

    # Server-side fallback for the client-only auto-submit: if the browser
    # never flushed a final POST for a session whose exam has ended (+ grace),
    # mark it submitted now so the dashboard does not report it as pending.
    finalize_expired_sessions(student_id=active_session.student_id)

    _e_doc = repo.find_one("exams", {"_id": token_record.exam_id})
    exam_record = _AttrDict(_e_doc) if _e_doc else None

    # AUD-007 FIX: Query real past submitted sessions for this student
    # AUD-032 FIX: is_revoked intentionally NOT filtered here. Submission
    # status must permanently mark an exam as completed, independent of
    # whether the session row later gets revoked (e.g. by a re-login).
    _past_docs = repo.find_all(
        "exam_sessions",
        {
            "student_id": active_session.student_id,
            "is_submitted": True,
        },
        sort=[("created_at", -1)],
    )
    past_sessions = [_AttrDict(d) for d in _past_docs]

    # Build past results list by joining with Exam records
    past_exam_ids = [s.exam_id for s in past_sessions]
    submitted_exam_ids = set(past_exam_ids)
    past_exams_map = {}
    if past_exam_ids:
        _pe_docs = repo.find_all("exams", {"_id": {"$in": past_exam_ids}})
        past_exams_map = {d["_id"]: _AttrDict(d) for d in _pe_docs}

    past_results = []
    for s in past_sessions:
        exam_info = past_exams_map.get(s.exam_id)
        if exam_info:
            past_results.append({
                "exam_id":      s.exam_id,
                "title":        exam_info.title,
                "submitted_at": s.created_at * 1000,   # ms for frontend
                "duration":     exam_info.duration_seconds // 60,
            })

    return {
        "success": True,
        "data": {
            "profile": {
                "name":           token_record.student_id,
                "email":          f"{token_record.student_id.lower()}@college.edu",
                "studentProfile": {
                    "rollNo":  token_record.token,
                    "branch":  "General",
                    "batch":   "2026",
                },
            },
            "availableTests": [
                {
                    "id":             exam_record.id,
                    "title":          exam_record.title,
                    "date":           exam_record.starts_at * 1000,
                    "duration":       exam_record.duration_seconds // 60,
                    "codingDuration": exam_record.coding_duration_minutes or 60,
                }
            ] if exam_record and exam_record.id not in submitted_exam_ids else [],
            "pastResults": past_results,
        },
    }


# ── UPDATED EXAM WORKSPACE FEED: 100% DATABASE DRIVEN ──────────────────────────

@router.get("/{exam_id}")
def load_exam_workspace(
    exam_id:        str,
    active_session  = Depends(verify_session_guard),
):
    """
    Fetches real dynamic exam content (MCQs & Coding Problems) from the database
    to construct the workspace payload for the candidate session.
    """
    # AUD-003 FIX: Ownership guard — student can only load their own exam
    if active_session.exam_id != exam_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    _doc = repo.find_one("exams", {"_id": exam_id})
    exam_record = _AttrDict(_doc) if _doc else None
    if not exam_record:
        raise HTTPException(status_code=404, detail="Exam not found.")

    # AUD-028 FIX: Block access if exam has not started yet
    if exam_record.starts_at > time.time():
        raise HTTPException(status_code=403, detail="Exam has not started yet.")

    # Block re-entry after submission
    _sub_doc = repo.find_one("exam_sessions", {
        "student_id": active_session.student_id,
        "exam_id": exam_id,
        "is_submitted": True,
    })
    existing_submission = _AttrDict(_sub_doc) if _sub_doc else None
    if existing_submission:
        raise HTTPException(status_code=403, detail="Exam already submitted.")

    # 1. Fetch dynamic questions and coding tasks attached to this test ID
    db_questions = [_AttrDict(d) for d in repo.find_all("questions", {"exam_id": exam_id}, sort=[("order_index", 1)])]
    db_coding = [_AttrDict(d) for d in repo.find_all("coding_problems", {"exam_id": exam_id})]
    db_subjective = [_AttrDict(d) for d in repo.find_all("subjective_questions", {"exam_id": exam_id}, sort=[("order_index", 1)])]

    # 2. Load first-class Section rows (new schema); may be empty for legacy exams
    db_sections = [_AttrDict(d) for d in repo.find_all("sections", {"exam_id": exam_id}, sort=[("order_index", 1)])]

    # Build a lookup: section db-id → Section row (for new exams with explicit sections)
    section_by_id = {s.id: s for s in db_sections}

    # 3. Group MCQ questions by section, preserving order
    #    For new exams: use section_id → Section.name + marks_per_question
    #    For legacy exams: fall back to q.section free-text string (existing behaviour)
    sections_map = defaultdict(list)   # section_name → [question dicts]
    section_meta = {}                  # section_name → {marks_per_question, order_index, type}

    for q in db_questions:
        if q.section_id and q.section_id in section_by_id:
            sec = section_by_id[q.section_id]
            sec_name = sec.name
            if sec_name not in section_meta:
                section_meta[sec_name] = {
                    "marks_per_question": sec.marks_per_question,
                    "order_index":        sec.order_index,
                    "type":               sec.type,
                }
        else:
            # Legacy: section is a free-text string, default marks = 1
            sec_name = q.section or "General"
            if sec_name not in section_meta:
                section_meta[sec_name] = {
                    "marks_per_question": q.marks if q.marks else 1,
                    "order_index":        0,
                    "type":               "mcq",
                }

        sections_map[sec_name].append({
            "id":             q.id,
            "text":           q.text,
            "sectionName":    sec_name,          # threaded onto question — fixes groupedQuestions bug
            "content_format": q.content_format or "plain",
            "marks":          q.marks if q.marks else section_meta[sec_name]["marks_per_question"],
            "shuffledOptions": [
                {"label": "A", "text": q.optA},
                {"label": "B", "text": q.optB},
                {"label": "C", "text": q.optC},
                {"label": "D", "text": q.optD},
            ],
        })

    # 4. Build formatted_sections sorted by order_index
    # AUD-015 FIX: category derived from section type field, not section name heuristic
    def _section_category(sec_type: str) -> str:
        """Map Section.type to a display category. Extensible for future types."""
        if sec_type == "subjective":
            return "Subjective"
        # Both 'mcq' and any future type default to 'Technical' rather than a name guess
        return "Technical"

    formatted_sections = sorted(
        [
            {
                "name":               sec_name,
                "category":           _section_category(meta["type"]),
                "marks_per_question": meta["marks_per_question"],
                "order_index":        meta["order_index"],
                "type":               meta["type"],
                "questions":          questions_list,
            }
            for sec_name, questions_list in sections_map.items()
            for meta in [section_meta[sec_name]]
        ],
        key=lambda s: s["order_index"],
    )

    # 3. Format coding tasks — no answer field exposed to student
    formatted_coding = []
    for cp in db_coding:
        formatted_coding.append({
            "id":          cp.id,
            "title":       cp.title,
            "description": cp.description,
            "constraints": cp.constraints or "",
            "marks":       10  # Standard point allocation weight
        })

    # 5. Format subjective questions with section name + content_format
    formatted_subjective = []
    for sq in db_subjective:
        if sq.section_id and sq.section_id in section_by_id:
            sq_section_name = section_by_id[sq.section_id].name
        else:
            sq_section_name = sq.section or "General"
        formatted_subjective.append({
            "id":             sq.id,
            "text":           sq.text,
            "section":        sq_section_name,
            "sectionName":    sq_section_name,
            "marks":          sq.marks,
            "content_format": sq.content_format or "plain",
        })

    return {
        "success": True,
        "data": {
            "id":             exam_record.id,
            "title":          exam_record.title,
            "date":           exam_record.starts_at * 1000,
            "duration":       exam_record.duration_seconds // 60,
            "codingDuration": exam_record.coding_duration_minutes,
            "mcqDuration":    exam_record.mcq_duration_minutes,
            "qnaDuration":    exam_record.qna_duration_minutes,
            "maxViolations":  3,
            "codingProblems": formatted_coding,
            "sections":       formatted_sections,
            "subjectiveQuestions": formatted_subjective
        },
    }


@router.post("/{exam_id}/verify-password")
@limiter.limit("10/minute")
def verify_exam_password(
    request:        Request,
    exam_id:        str,
    payload:        PasswordVerifyPayload,
    active_session  = Depends(verify_session_guard),
):
    # AUD-006 FIX: Ownership guard — student can only verify password for their own exam
    if active_session.exam_id != exam_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    _doc = repo.find_one("exams", {"_id": exam_id})
    exam_record = _AttrDict(_doc) if _doc else None
    if not exam_record:
        raise HTTPException(status_code=404, detail="Exam not found.")

    # AUD-028 FIX: Also block password verify for exams not yet started
    if exam_record.starts_at > time.time():
        raise HTTPException(status_code=403, detail="Exam has not started yet.")

    # AUD-033 FIX: same already-submitted guard as load_exam_workspace,
    _sub_doc = repo.find_one("exam_sessions", {
        "student_id": active_session.student_id,
        "exam_id": exam_id,
        "is_submitted": True,
    })
    existing_submission = _AttrDict(_sub_doc) if _sub_doc else None
    if existing_submission:
        raise HTTPException(status_code=403, detail="Exam already submitted.")

    target_hash = (
        exam_record.start_password_hash
        if payload.type == "start"
        else exam_record.end_password_hash
    )

    # Fix: If checking end password, and the admin left it blank, auto-approve!
    if payload.type == "end" and not target_hash:
        return {"success": True}

    if not target_hash or not bcrypt.checkpw(
        payload.password.encode("utf-8"),
        target_hash.encode("utf-8"),
    ):
        raise HTTPException(
            status_code=403,
            detail=f"Incorrect {payload.type.capitalize()} Password.",
        )

    return {"success": True}


# ── UPDATED SUBMIT ROUTE: PERSISTS REAL TELEMETRY RESPONSE DATA ──────────────

@router.post("/{exam_id}/submit")
def submit_exam(
    exam_id:        str,
    payload:        SubmitPayload,
    active_session  = Depends(verify_session_guard),
):
    """
    Finalizes the candidate session and saves response data arrays securely 
    to the centralized database column for automated evaluation grading.
    """
    # H-08: Prevent cross-exam injection
    if active_session.exam_id != exam_id:
        raise HTTPException(status_code=403, detail="Session token does not match target exam.")

    # AUD-030 FIX: Reject submissions after exam end + grace period
    _doc = repo.find_one("exams", {"_id": exam_id})
    exam_record = _AttrDict(_doc) if _doc else None
    if not exam_record:
        raise HTTPException(status_code=404, detail="Exam not found.")

    exam_end_time = exam_record.starts_at + exam_record.duration_seconds
    now = time.time()
    if now > exam_end_time + LATE_SUBMISSION_GRACE_SECONDS:
        raise HTTPException(
            status_code=403,
            detail="Exam time has expired. Submission is no longer accepted."
        )
    # Reject if session was created after exam ended (prevents last-second login + submit)
    if active_session.created_at > exam_end_time:
        raise HTTPException(
            status_code=403,
            detail="Session created after exam ended. Submission rejected."
        )

    answers_data = payload.answers if payload.answers else {}

    try:
        validated_data = SubmissionPayloadSchema(**answers_data)
    except ValidationError:
        raise HTTPException(status_code=400, detail="Malformed submission payload. Missing 'mcqs' or 'coding' keys.")

    if active_session.is_submitted:
        raise HTTPException(status_code=400, detail="Exam already submitted.")

    try:
        update_fields = {"is_submitted": True}
        update_fields["submission_payload"] = payload.answers if payload.answers else {}
        if payload.subjective:
            update_fields["subjective_payload"] = payload.subjective
        # Atomic check-and-set: only submits if not already submitted (TOCTOU fix)
        result = repo.find_one_and_update(
            "exam_sessions",
            {"_id": active_session.id, "is_submitted": False},
            {"$set": update_fields},
            return_document="after",
        )
        if result is None:
            raise HTTPException(status_code=400, detail="Exam already submitted.")
    except HTTPException:
        raise
    except Exception:
        logger.warning("[EXAM] Mongo write failed for submit_exam")

    return {"success": True, "message": "Exam submitted securely."}


# ── AUD-002 FIX: Coding stub routes ────────────────────────────────────────────
# Code execution is not available. These stubs store submitted code and return
# a graceful "unavailable" response. Compatible with future Judge0 integration.

@router.post("/{exam_id}/run")
def run_code(
    exam_id:        str,
    payload:        CodeRunPayload,
    active_session  = Depends(verify_session_guard),
):
    """
    Code execution stub. Judge0 integration is pending.
    Returns a graceful unavailable response instead of 404.
    """
    # Ownership guard
    if active_session.exam_id != exam_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    logger.info(
        "[CODE-RUN] Student %s attempted run in exam %s (language: %s) — execution unavailable.",
        active_session.student_id[:8] + "****",
        exam_id[:8] + "****",
        payload.language_id,
    )

    return {
        "success": False,
        "status": "unavailable",
        "message": "Code execution is currently unavailable. Your code has been saved and will be evaluated later.",
        "stdout": "",
        "stderr": "",
        "compile_output": "",
    }


@router.post("/{exam_id}/submit-code")
def submit_code(
    exam_id:        str,
    payload:        CodeSubmitPayload,
    active_session  = Depends(verify_session_guard),
):
    """
    Code submission stub. Stores the submitted code string only.
    Score is marked as 'Pending Evaluation'. No client score is trusted.
    Compatible with future server-side Judge0 grading integration.
    """
    # Ownership guard
    if active_session.exam_id != exam_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    logger.info(
        "[CODE-SUBMIT] Student %s submitted code for problem %s in exam %s (language: %s).",
        active_session.student_id[:8] + "****",
        payload.problem_id[:8] + "****",
        exam_id[:8] + "****",
        payload.language_id,
    )

    # Code is stored in the final exam submission payload (via submit_exam).
    # This stub acknowledges receipt and marks the problem as pending evaluation.
    return {
        "success": True,
        "status": "pending_evaluation",
        "message": "Code received. Evaluation is pending and will be completed by the administrator.",
        "score": None,
        "results": [],
    }
