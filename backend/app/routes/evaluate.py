import json
import time
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.models import Exam, ExamSession, Question, CodingProblem, SubjectiveQuestion
from app.limiter import limiter

from app.routes.admin import verify_admin, dedupe_sessions_per_student, require_exam_scope
from app.evaluation_ctx import (
    get_or_create_faculty_eval,
    get_faculty_eval,
    resolve_context,
    evaluation_material,
    ensure_faculty_writer,
    parse_json,
)

router = APIRouter()
logger = logging.getLogger("scope")


def _compute_mcq_score(session: ExamSession, q_map: dict) -> float:
    """Re-compute MCQ score from submission_payload and question map."""
    payload = {}
    if session.submission_payload:
        try:
            payload = json.loads(session.submission_payload)
        except Exception:
            pass
    mcq_answers = payload.get("mcqs", {})
    total = 0.0
    for q_id, ans in mcq_answers.items():
        q = q_map.get(q_id)
        if q and q.ans == ans:
            total += q.marks or 1
    return total


# ── SCHEMAS ─────────────────────────────────────────────────────────────────

class SaveEvaluationPayload(BaseModel):
    coding_marks: Optional[dict[str, float]] = None
    subjective_marks: Optional[dict[str, float]] = None
    review_status: Optional[str] = None


class ReviewStatusPayload(BaseModel):
    status: Optional[str] = None


# ── 1. LIST STUDENTS FOR EVALUATION ─────────────────────────────────────────

@router.get("/exams/{exam_id}/evaluate")
def list_evaluate_students(
    exam_id: str,
    faculty_id: Optional[str] = None,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """List students for manual evaluation under ONE evaluation context.

    - faculty: always their OWN evaluation (faculty_id param is ignored/coerced).
    - admin:   the selected faculty (query param) or the server-computed
               default; legacy marks only when nothing faculty-owned exists.
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)
    ctx = resolve_context(staff, exam, db, faculty_id)

    questions = db.query(Question).filter(Question.exam_id == exam_id).all()
    q_map = {q.id: q for q in questions}

    all_sessions = (
        db.query(ExamSession)
        .filter(ExamSession.exam_id == exam_id, ExamSession.is_submitted == True)
        .order_by(ExamSession.created_at.asc())
        .all()
    )
    sessions = dedupe_sessions_per_student(all_sessions)

    result = []
    for s in sessions:
        mcq_score = s.mcq_score
        if mcq_score is None:
            mcq_score = _compute_mcq_score(s, q_map)

        material = evaluation_material(s, ctx, db)
        cod_sum = sum(material["coding_marks"].values())
        subj_sum = sum(material["subjective_marks"].values())

        total = material["total_score"]
        if total is None:
            total = (mcq_score or 0) + cod_sum + subj_sum

        dept = "General"
        if "-" in s.student_id:
            parts = s.student_id.split("-")
            if len(parts) >= 2:
                dept = parts[1][:4].upper()

        result.append({
            "session_id": s.id,
            "student_id": s.student_id,
            "department": dept,
            "submitted_at": s.created_at,
            "submission_status": s.is_submitted,
            "mcq_score": mcq_score or 0,
            "current_coding_marks": material["coding_marks"],
            "current_subjective_marks": material["subjective_marks"],
            "total_score": total,
            "review_status": material["review_status"],
            "evaluated_at": material["evaluated_at"],
        })

    return {"success": True, "data": result}


# ── 2. FULL EVALUATION DETAIL FOR ONE STUDENT ───────────────────────────────

@router.get("/exams/{exam_id}/evaluate/{session_id}")
def get_evaluation_detail(
    exam_id: str,
    session_id: str,
    faculty_id: Optional[str] = None,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ExamSession)
        .filter(ExamSession.id == session_id, ExamSession.exam_id == exam_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)
    ctx = resolve_context(staff, exam, db, faculty_id)

    questions = db.query(Question).filter(Question.exam_id == exam_id).all()
    coding_probs = db.query(CodingProblem).filter(CodingProblem.exam_id == exam_id).all()
    subjective_questions = db.query(SubjectiveQuestion).filter(SubjectiveQuestion.exam_id == exam_id).all()
    q_map = {q.id: q for q in questions}

    # MCQ answers with correct/incorrect
    payload = {}
    if session.submission_payload:
        try:
            payload = json.loads(session.submission_payload)
        except Exception:
            pass
    mcq_answers = payload.get("mcqs", {})

    mcq_details = []
    mcq_score = 0
    for q in questions:
        student_ans = mcq_answers.get(q.id)
        is_correct = student_ans == q.ans if student_ans else False
        if is_correct:
            mcq_score += q.marks or 1
        mcq_details.append({
            "question_id": q.id,
            "text": q.text,
            "options": {"A": q.optA, "B": q.optB, "C": q.optC, "D": q.optD},
            "correct_answer": q.ans,
            "student_answer": student_ans,
            "is_correct": is_correct,
            "marks": q.marks or 1,
        })

    # Coding submissions
    code_answers = payload.get("coding", {})
    coding_details = []
    for cp in coding_probs:
        cp_data = code_answers.get(cp.id, {})
        coding_details.append({
            "problem_id": cp.id,
            "title": cp.title,
            "description": cp.description,
            "constraints": cp.constraints,
            "max_marks": cp.marks or 10,
            "submitted_code": cp_data.get("code", ""),
            "language": cp_data.get("language_id", None),
            "is_attempted": bool(cp_data.get("code")),
        })

    # Subjective answers
    subj_payload = {}
    if session.subjective_payload:
        try:
            subj_payload = json.loads(session.subjective_payload)
        except Exception:
            pass
    subjective_details = []
    for sq in subjective_questions:
        subjective_details.append({
            "question_id": sq.id,
            "text": sq.text,
            "section": sq.section,
            "max_marks": sq.marks or 10,
            "content_format": sq.content_format or "plain",
            "student_answer": subj_payload.get(sq.id, ""),
        })

    material = evaluation_material(session, ctx, db)
    total = material["total_score"]
    if total is None:
        cod_sum = sum(material["coding_marks"].values())
        subj_sum = sum(material["subjective_marks"].values())
        total = mcq_score + cod_sum + subj_sum

    return {
        "success": True,
        "data": {
            "session_id": session.id,
            "student_id": session.student_id,
            "mcq_score": mcq_score,
            "mcq_details": mcq_details,
            "coding_details": coding_details,
            "subjective_details": subjective_details,
            "current_coding_marks": material["coding_marks"],
            "current_subjective_marks": material["subjective_marks"],
            "total_score": total,
            "review_status": material["review_status"],
            "evaluated_at": material["evaluated_at"],
        },
    }


# ── 3. SAVE EVALUATION MARKS (faculty-owned) ────────────────────────────────

@router.post("/exams/{exam_id}/evaluate/{session_id}")
@limiter.limit("30/minute")
def save_evaluation(
    request: Request,
    exam_id: str,
    session_id: str,
    payload: SaveEvaluationPayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ExamSession)
        .filter(ExamSession.id == session_id, ExamSession.exam_id == exam_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)
    ensure_faculty_writer(staff)  # admin: strictly read-only (403)

    questions = db.query(Question).filter(Question.exam_id == exam_id).all()
    q_map = {q.id: q for q in questions}

    # MCQ stays SYSTEM-GENERATED and shared; persisted for cheap reads.
    mcq_score = _compute_mcq_score(session, q_map)
    session.mcq_score = mcq_score

    faculty_id = staff["id"]
    faculty_eval = get_or_create_faculty_eval(db, session.id, faculty_id)

    # Merge coding marks — onto this faculty's OWN record only.
    existing_coding = parse_json(faculty_eval.coding_marks)
    if payload.coding_marks:
        existing_coding.update(payload.coding_marks)
    faculty_eval.coding_marks = json.dumps(existing_coding) if existing_coding else None

    existing_subj = parse_json(faculty_eval.subjective_marks)
    if payload.subjective_marks:
        existing_subj.update(payload.subjective_marks)
    faculty_eval.subjective_marks = json.dumps(existing_subj) if existing_subj else None

    cod_sum = sum(existing_coding.values()) if existing_coding else 0
    subj_sum = sum(existing_subj.values()) if existing_subj else 0
    faculty_eval.total_score = mcq_score + cod_sum + subj_sum

    if payload.review_status is not None:
        valid_statuses = {None, "pending", "reviewed", "flagged"}
        if payload.review_status in valid_statuses:
            faculty_eval.review_status = payload.review_status

    faculty_eval.evaluated_at = time.time()
    db.commit()

    return {
        "success": True,
        "data": {
            "session_id": session.id,
            "student_id": session.student_id,
            "mcq_score": mcq_score,
            "coding_marks": existing_coding,
            "subjective_marks": existing_subj,
            "total_score": faculty_eval.total_score,
            "review_status": faculty_eval.review_status,
            "evaluated_at": faculty_eval.evaluated_at,
        },
    }


# ── 4. CLEAR EVALUATION MARKS (faculty-owned) ───────────────────────────────

@router.post("/exams/{exam_id}/evaluate/{session_id}/clear")
@limiter.limit("30/minute")
def clear_evaluation(
    request: Request,
    exam_id: str,
    session_id: str,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ExamSession)
        .filter(ExamSession.id == session_id, ExamSession.exam_id == exam_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)
    ensure_faculty_writer(staff)

    faculty_id = staff["id"]
    faculty_eval = get_faculty_eval(db, session.id, faculty_id)
    if not faculty_eval:
        raise HTTPException(
            status_code=404,
            detail="No evaluation found for this faculty.",
        )

    questions = db.query(Question).filter(Question.exam_id == exam_id).all()
    q_map = {q.id: q for q in questions}
    mcq_score = _compute_mcq_score(session, q_map)
    session.mcq_score = mcq_score

    # Removing this faculty's record only — other faculty's marks are untouched.
    db.delete(faculty_eval)
    db.commit()

    return {"success": True, "message": "Evaluation marks cleared."}


# ── 5. SET REVIEW STATUS (faculty-owned) ────────────────────────────────────

@router.post("/exams/{exam_id}/evaluate/{session_id}/review")
@limiter.limit("30/minute")
def set_review_status(
    request: Request,
    exam_id: str,
    session_id: str,
    payload: ReviewStatusPayload,
    staff: dict = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ExamSession)
        .filter(ExamSession.id == session_id, ExamSession.exam_id == exam_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found.")

    require_exam_scope(staff, exam)
    ensure_faculty_writer(staff)

    valid_statuses = {None, "pending", "reviewed", "flagged"}
    if payload.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid review status. Must be one of: {valid_statuses}")

    faculty_eval = get_or_create_faculty_eval(db, session.id, staff["id"])
    faculty_eval.review_status = payload.status
    db.commit()

    return {
        "success": True,
        "data": {
            "session_id": session.id,
            "review_status": faculty_eval.review_status,
        },
    }