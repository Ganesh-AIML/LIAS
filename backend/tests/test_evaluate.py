"""Tests for evaluate endpoints (faculty-owned manual evaluation).

Reads (list/detail) are admin-visible; writes (save/clear/review) are
faculty-only — admins are strictly read-only (403).
"""

import json
import time
import bcrypt

from app.models import ExamSession, Exam, Question, CodingProblem, SubjectiveQuestion, StaffAccount
from app.auth import create_staff_jwt
from app.database import get_mongo_db
from app import repositories as repo


def _mongo_mirror(orm_obj):
    """Mirror any ORM object to its Mongo collection."""
    coll = {
        Exam: "exams", Question: "questions", CodingProblem: "coding_problems",
        SubjectiveQuestion: "subjective_questions", ExamSession: "exam_sessions",
        StaffAccount: "staff_accounts",
    }.get(type(orm_obj))
    if coll:
        get_mongo_db()[coll].insert_one(dict(repo.doc_for(coll, orm_obj)))


def _module_exam(db, eid="exam_mod_001", module="MAS701", title="Module Exam"):
    exam = Exam(
        id=eid, title=title, duration_seconds=3600,
        starts_at=int((time.time() + 86400) * 1000),
        status="upcoming",
        start_password_hash="$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8nU.KQYzj6Ho6",
        module=module,
    )
    db.add(exam)
    db.commit()
    get_mongo_db()["exams"].insert_one(dict(repo.doc_for("exams", exam)))
    return exam


def _submitted_session(db, exam, sid="sess_fac_001", student_id="23-TEST-01",
                       mcqs=None, coding=None):
    session = ExamSession(
        id=sid, student_id=student_id, exam_id=exam.id,
        session_secret="secret", is_submitted=True,
        submission_payload=json.dumps({"mcqs": mcqs or {}, "coding": coding or {}}),
    )
    db.add(session)
    db.commit()
    get_mongo_db()["exam_sessions"].insert_one(dict(repo.doc_for("exam_sessions", session)))
    return session


def _faculty(db, sid="staff_faculty2", name="Faculty Two", email="f2@test.local",
             module="MAS701"):
    staff = StaffAccount(
        id=sid, name=name, email=email,
        password_hash=bcrypt.hashpw(b"test1234", bcrypt.gensalt(rounds=12)).decode("utf-8"),
        role="faculty", module=module,
    )
    db.add(staff)
    db.commit()
    get_mongo_db()["staff_accounts"].insert_one(dict(repo.doc_for("staff_accounts", staff)))
    return {"id": staff.id, "headers": {"Authorization": f"Bearer {create_staff_jwt(staff.id)}"}}


class TestEvaluateEndpoints:
    def test_list_evaluate_requires_auth(self, client, sample_exam):
        response = client.get(f"/admin/exams/{sample_exam.id}/evaluate")
        assert response.status_code == 403

    def test_list_evaluate_empty_exam(self, client, sample_exam, admin_headers):
        response = client.get(f"/admin/exams/{sample_exam.id}/evaluate", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"] == []

    def test_list_evaluate_with_submitted_session(self, client, db, admin_headers):
        exam = _module_exam(db)
        q = Question(
            id="q_test_001", exam_id=exam.id, section="Aptitude",
            text="Test?", optA="A", optB="B", optC="C", optD="D", ans="A",
        )
        db.add(q)
        db.commit()
        _mongo_mirror(q)
        _submitted_session(db, exam, mcqs={"q_test_001": "A"})

        response = client.get(f"/admin/exams/{exam.id}/evaluate", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 1
        assert data["data"][0]["student_id"] == "23-TEST-01"
        assert data["data"][0]["mcq_score"] == 1

    def test_get_detail_requires_auth(self, client, sample_exam):
        response = client.get(f"/admin/exams/{sample_exam.id}/evaluate/sess_nonexistent")
        assert response.status_code == 403

    def test_get_detail_nonexistent_session(self, client, sample_exam, admin_headers):
        response = client.get(
            f"/admin/exams/{sample_exam.id}/evaluate/sess_nonexistent",
            headers=admin_headers,
        )
        assert response.status_code == 404

    def test_get_detail_with_session(self, client, db, admin_headers):
        exam = _module_exam(db)
        q = Question(
            id="q_test_002", exam_id=exam.id, section="Aptitude",
            text="Q2?", optA="A", optB="B", optC="C", optD="D", ans="B",
        )
        db.add(q)
        _mongo_mirror(q)
        cp = CodingProblem(id="cp_test_001", exam_id=exam.id, title="Sum", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        session = _submitted_session(
            db, exam,
            mcqs={"q_test_002": "B"},
            coding={"cp_test_001": {"code": "print(1+1)", "language_id": 71}},
        )

        response = client.get(
            f"/admin/exams/{exam.id}/evaluate/{session.id}", headers=admin_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["student_id"] == "23-TEST-01"
        assert data["data"]["mcq_score"] == 1
        assert len(data["data"]["coding_details"]) == 1
        assert data["data"]["coding_details"][0]["submitted_code"] == "print(1+1)"
        assert data["data"]["coding_details"][0]["is_attempted"] is True

    def test_admin_cannot_save_evaluation(self, client, db, admin_bearer_headers):
        exam = _module_exam(db)
        cp = CodingProblem(id="cp_adm_001", exam_id=exam.id, title="Multiply", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        session = _submitted_session(db, exam)

        resp = client.post(
            f"/admin/exams/{exam.id}/evaluate/{session.id}",
            json={"coding_marks": {"cp_adm_001": 8}},
            headers=admin_bearer_headers,
        )
        assert resp.status_code == 403

    def test_save_and_clear_evaluation_by_faculty(self, client, db, faculty_bearer_headers):
        exam = _module_exam(db)
        cp = CodingProblem(id="cp_test_002", exam_id=exam.id, title="Multiply", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        session = _submitted_session(db, exam)

        save_resp = client.post(
            f"/admin/exams/{exam.id}/evaluate/{session.id}",
            json={"coding_marks": {"cp_test_002": 8}, "subjective_marks": {}, "review_status": "reviewed"},
            headers=faculty_bearer_headers,
        )
        assert save_resp.status_code == 200
        save_data = save_resp.json()
        assert save_data["data"]["total_score"] == 8
        assert save_data["data"]["review_status"] == "reviewed"

        list_resp = client.get(f"/admin/exams/{exam.id}/evaluate", headers=faculty_bearer_headers)
        assert list_resp.json()["data"][0]["current_coding_marks"] == {"cp_test_002": 8.0}

        clear_resp = client.post(
            f"/admin/exams/{exam.id}/evaluate/{session.id}/clear",
            json={}, headers=faculty_bearer_headers,
        )
        assert clear_resp.status_code == 200

        list_resp2 = client.get(f"/admin/exams/{exam.id}/evaluate", headers=faculty_bearer_headers)
        assert list_resp2.json()["data"][0]["current_coding_marks"] == {}

    def test_review_status_toggle_by_faculty(self, client, db, faculty_bearer_headers):
        exam = _module_exam(db)
        session = _submitted_session(db, exam)

        resp1 = client.post(
            f"/admin/exams/{exam.id}/evaluate/{session.id}/review",
            json={"status": "flagged"}, headers=faculty_bearer_headers,
        )
        assert resp1.status_code == 200
        assert resp1.json()["data"]["review_status"] == "flagged"

        resp2 = client.post(
            f"/admin/exams/{exam.id}/evaluate/{session.id}/review",
            json={"status": "reviewed"}, headers=faculty_bearer_headers,
        )
        assert resp2.status_code == 200
        assert resp2.json()["data"]["review_status"] == "reviewed"

        resp3 = client.post(
            f"/admin/exams/{exam.id}/evaluate/{session.id}/review",
            json={"status": "invalid_status"}, headers=faculty_bearer_headers,
        )
        assert resp3.status_code == 400

    def test_faculty_cannot_save_cross_module(self, client, db, other_faculty_bearer_headers):
        exam = _module_exam(db)
        cp = CodingProblem(id="cp_x_001", exam_id=exam.id, title="X", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        session = _submitted_session(db, exam)

        resp = client.post(
            f"/admin/exams/{exam.id}/evaluate/{session.id}",
            json={"coding_marks": {"cp_x_001": 5}},
            headers=other_faculty_bearer_headers,
        )
        assert resp.status_code == 403

    def test_pending_faculty_cannot_evaluate(self, client, sample_exam, pending_faculty_bearer_headers):
        resp = client.get(
            f"/admin/exams/{sample_exam.id}/evaluate", headers=pending_faculty_bearer_headers
        )
        assert resp.status_code == 403

    def test_admin_detail_sees_faculty_marks(self, client, db, admin_bearer_headers):
        exam = _module_exam(db)
        cp = CodingProblem(id="cp_adm_001", exam_id=exam.id, title="Adm", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        session = _submitted_session(db, exam)

        f2 = _faculty(db)
        client.post(
            f"/admin/exams/{exam.id}/evaluate/{session.id}",
            json={"coding_marks": {"cp_adm_001": 9}},
            headers=f2["headers"],
        )
        resp = client.get(
            f"/admin/exams/{exam.id}/evaluate/{session.id}?faculty_id={f2['id']}",
            headers=admin_bearer_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["current_coding_marks"] == {"cp_adm_001": 9.0}