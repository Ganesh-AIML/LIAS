"""Shared evaluation-context helpers (faculty-owned evaluations).

Ownership rule, enforced SERVER-side everywhere:
  - faculty -> their OWN evaluation only. The authenticated identity always
    comes from the validated staff JWT (`staff["id"]`); a client-supplied
    `faculty_id` in URL/query/body is NEVER trusted for faculty.
  - admin   -> can select any faculty assigned to the exam's module and is
    read-only (writes are 403 for admins).
  - legacy  -> ownerless marks stored directly on exam_sessions are shown to
    admins ONLY when no faculty-owned evaluation exists (or when explicitly
    selected via the "__legacy__" sentinel). Faculty never see legacy marks.
"""
import json
import uuid
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import ExamSession, FacultyEvaluation, StaffAccount

LEGACY_CTX = "__legacy__"


def parse_json(text):
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        return {}


def module_faculty_ids(db: Session, exam) -> list:
    """Faculty accounts currently assigned to the exam's module."""
    if not exam or not exam.module:
        return []
    rows = (
        db.query(StaffAccount)
        .filter(StaffAccount.role == "faculty", StaffAccount.module == exam.module)
        .all()
    )
    return [r.id for r in rows]


def get_faculty_eval(db: Session, session_id: str, faculty_id: str):
    return (
        db.query(FacultyEvaluation)
        .filter(
            FacultyEvaluation.session_id == session_id,
            FacultyEvaluation.faculty_id == faculty_id,
        )
        .first()
    )


def get_or_create_faculty_eval(db: Session, session_id: str, faculty_id: str):
    row = get_faculty_eval(db, session_id, faculty_id)
    if row:
        return row
    row = FacultyEvaluation(
        id=f"fe_{uuid.uuid4().hex[:12]}",
        session_id=session_id,
        faculty_id=faculty_id,
    )
    db.add(row)
    db.flush()
    return row


def _has_any_marks(row) -> bool:
    """A faculty row only counts as 'evaluated' when it carries at least one
    manual mark (partial evaluation still counts as evaluated)."""
    return bool(row) and (row.coding_marks or row.subjective_marks)


def default_faculty_id(db: Session, exam_id: str):
    """Earliest-evaluating faculty (MIN created_at with any mark) in this exam.

    Deterministic server-side rule for the admin's default selection — never
    frontend array order.
    """
    first = (
        db.query(FacultyEvaluation)
        .join(ExamSession, ExamSession.id == FacultyEvaluation.session_id)
        .filter(ExamSession.exam_id == exam_id)
        .order_by(FacultyEvaluation.created_at.asc())
        .first()
    )
    if not _has_any_marks(first):
        return None
    return first.faculty_id


def legacy_available(db: Session, exam_id: str) -> bool:
    """True when any session of this exam still carries ownerless marks."""
    row = (
        db.query(ExamSession)
        .filter(
            ExamSession.exam_id == exam_id,
            ExamSession.coding_evaluation.isnot(None)
            | ExamSession.subjective_evaluation.isnot(None),
        )
        .first()
    )
    return row is not None


def resolve_context(staff: dict, exam, db: Session, requested=None) -> dict:
    """Resolve the evaluation context for a request.

    Returns {"mode": "faculty"|"admin", "selected": {faculty_id|None},
             "legacy": bool}.
    """
    if staff.get("role") == "faculty":
        return {
            "mode": "faculty",
            "selected": staff.get("id"),
            "legacy": False,
        }

    # ── admin ───────────────────────────────────────────────────────────
    if requested in (None, ""):
        fid = default_faculty_id(db, exam.id)
        if fid:
            return {"mode": "admin", "selected": fid, "legacy": False}
        return {"mode": "admin", "selected": None, "legacy": True}

    if requested == LEGACY_CTX:
        return {"mode": "admin", "selected": None, "legacy": True}

    allowed = set(module_faculty_ids(db, exam))
    if requested not in allowed:
        raise HTTPException(
            status_code=403,
            detail="Selected faculty is not assigned to this exam's module.",
        )
    return {"mode": "admin", "selected": requested, "legacy": False}


def evaluation_material(session: ExamSession, ctx: dict, db: Session) -> dict:
    """Snapshot of the evaluation (marks/total/review/at) for ONE session under
    a resolved context. In legacy mode it reads the session columns directly."""
    if ctx.get("selected") and not ctx.get("legacy"):
        row = get_faculty_eval(db, session.id, ctx["selected"])
        return {
            "coding_marks": parse_json(row.coding_marks) if row else {},
            "subjective_marks": parse_json(row.subjective_marks) if row else {},
            "total_score": row.total_score if row else None,
            "review_status": row.review_status if row else None,
            "evaluated_at": row.evaluated_at if row else None,
        }
    return {
        "coding_marks": parse_json(session.coding_evaluation),
        "subjective_marks": parse_json(session.subjective_evaluation),
        "total_score": session.total_score,
        "review_status": session.review_status,
        "evaluated_at": session.evaluated_at,
    }


def ensure_faculty_writer(staff: dict) -> None:
    """Mutations are faculty-only. Admins are strictly read-only."""
    if staff.get("role") != "faculty":
        raise HTTPException(
            status_code=403,
            detail="Only a faculty member can write evaluations.",
        )