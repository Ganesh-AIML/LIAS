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
import uuid
import time
from fastapi import HTTPException

from app import repositories as repo
from app.repositories import parse_json, _AttrDict

LEGACY_CTX = "__legacy__"


def _exam_module(exam) -> str:
    """Module of an exam that may be a dict or an AttrDict."""
    if isinstance(exam, dict):
        return exam.get("module")
    return getattr(exam, "module", None)


def module_faculty_ids(exam) -> list:
    """Faculty accounts currently assigned to the exam's module."""
    module = _exam_module(exam)
    if not module:
        return []
    rows = repo.find_all(
        "staff_accounts", {"role": "faculty", "module": module}
    )
    return [r.get("id") for r in rows]


def get_faculty_eval(session_id: str, faculty_id: str):
    return repo.find_one(
        "faculty_evaluations",
        {"session_id": session_id, "faculty_id": faculty_id},
    )


def get_or_create_faculty_eval(session_id: str, faculty_id: str):
    """Return a faculty evaluation doc. Creates one if it doesn't exist."""
    doc = repo.find_one(
        "faculty_evaluations",
        {"session_id": session_id, "faculty_id": faculty_id},
    )
    if doc:
        return doc
    new_id = f"fe_{uuid.uuid4().hex[:12]}"
    new_doc = {
        "_id": new_id,
        "session_id": session_id,
        "faculty_id": faculty_id,
        "coding_marks": None,
        "subjective_marks": None,
        "total_score": 0,
        "review_status": None,
        "created_at": time.time(),
        "evaluated_at": None,
    }
    repo.insert_one("faculty_evaluations", new_doc)
    return new_doc


def _has_any_marks_doc(doc) -> bool:
    return bool(doc) and bool(doc.get("coding_marks") or doc.get("subjective_marks"))


def _exam_session_ids(exam_id: str) -> list:
    """IDs of all sessions belonging to an exam."""
    return [
        s.get("id")
        for s in repo.find_all("exam_sessions", {"exam_id": exam_id}, projection={"_id": 0, "id": 1})
    ]


def default_faculty_id(exam_id: str):
    """Earliest-evaluating faculty (MIN created_at with any mark) in this exam.

    Deterministic server-side rule for the admin's default selection — never
    frontend array order.
    """
    doc = repo.find_one(
        "faculty_evaluations",
        {
            "session_id": {"$in": _exam_session_ids(exam_id)},
            "$or": [
                {"coding_marks": {"$nin": [None]}},
                {"subjective_marks": {"$nin": [None]}},
            ],
        },
        sort=[("created_at", 1)],
    )
    if not _has_any_marks_doc(doc):
        return None
    return doc.get("faculty_id")


def legacy_available(exam_id: str) -> bool:
    """True when any session of this exam still carries ownerless marks."""
    doc = repo.find_one(
        "exam_sessions",
        {
            "exam_id": exam_id,
            "$or": [
                {"coding_evaluation": {"$nin": [None]}},
                {"subjective_evaluation": {"$nin": [None]}},
            ],
        },
    )
    return doc is not None


def resolve_context(staff: dict, exam, requested=None) -> dict:
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
    exam_id = exam.id if not isinstance(exam, dict) else exam.get("id")

    if requested in (None, ""):
        fid = default_faculty_id(exam_id)
        if fid:
            return {"mode": "admin", "selected": fid, "legacy": False}
        return {"mode": "admin", "selected": None, "legacy": True}

    if requested == LEGACY_CTX:
        return {"mode": "admin", "selected": None, "legacy": True}

    allowed = set(module_faculty_ids(exam))
    if requested not in allowed:
        raise HTTPException(
            status_code=403,
            detail="Selected faculty is not assigned to this exam's module.",
        )
    return {"mode": "admin", "selected": requested, "legacy": False}


def evaluation_material(session, ctx: dict) -> dict:
    """Snapshot of the evaluation (marks/total/review/at) for ONE session under
    a resolved context. In legacy mode it reads the session columns directly.
    Faculty-owned rows come from Mongo."""
    session_id = session.id if not isinstance(session, dict) else session.get("id")

    if ctx.get("selected") and not ctx.get("legacy"):
        row = get_faculty_eval(session_id, ctx["selected"])
        if not row:
            return {
                "coding_marks": {},
                "subjective_marks": {},
                "total_score": None,
                "review_status": None,
                "evaluated_at": None,
            }
        return {
            "coding_marks": parse_json(row.get("coding_marks")),
            "subjective_marks": parse_json(row.get("subjective_marks")),
            "total_score": row.get("total_score"),
            "review_status": row.get("review_status"),
            "evaluated_at": row.get("evaluated_at"),
        }

    coding_eval = session.coding_evaluation if not isinstance(session, dict) else session.get("coding_evaluation")
    subjective_eval = session.subjective_evaluation if not isinstance(session, dict) else session.get("subjective_evaluation")
    total_score = session.total_score if not isinstance(session, dict) else session.get("total_score")
    review_status = session.review_status if not isinstance(session, dict) else session.get("review_status")
    evaluated_at = session.evaluated_at if not isinstance(session, dict) else session.get("evaluated_at")

    return {
        "coding_marks": parse_json(coding_eval),
        "subjective_marks": parse_json(subjective_eval),
        "total_score": total_score,
        "review_status": review_status,
        "evaluated_at": evaluated_at,
    }


def ensure_faculty_writer(staff: dict) -> None:
    """Mutations are faculty-only. Admins are strictly read-only."""
    if staff.get("role") != "faculty":
        raise HTTPException(
            status_code=403,
            detail="Only a faculty member can write evaluations.",
        )
