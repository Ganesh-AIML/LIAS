"""Tests for evaluate endpoints."""

import os
import json
import time


class TestEvaluateEndpoints:
    def test_list_evaluate_requires_auth(self, client, sample_exam):
        response = client.get(f"/admin/exams/{sample_exam.id}/evaluate")
        assert response.status_code == 403

    def test_list_evaluate_empty_exam(self, client, sample_exam):
        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        response = client.get(
            f"/admin/exams/{sample_exam.id}/evaluate",
            headers={"X-Admin-Token": admin_secret},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"] == []

    def test_list_evaluate_with_submitted_session(self, client, sample_exam, db):
        from app.models import ExamSession, Question

        q = Question(
            id="q_test_001", exam_id=sample_exam.id, section="Aptitude",
            text="Test?", optA="A", optB="B", optC="C", optD="D", ans="A",
        )
        db.add(q)
        db.commit()

        session = ExamSession(
            id="sess_eval_001", student_id="23-TEST-01", exam_id=sample_exam.id,
            session_secret="secret", is_submitted=True,
            submission_payload=json.dumps({"mcqs": {"q_test_001": "A"}, "coding": {}}),
        )
        db.add(session)
        db.commit()

        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        response = client.get(
            f"/admin/exams/{sample_exam.id}/evaluate",
            headers={"X-Admin-Token": admin_secret},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 1
        assert data["data"][0]["student_id"] == "23-TEST-01"
        assert data["data"][0]["mcq_score"] == 1  # question marks=1, correct answer

    def test_get_detail_requires_auth(self, client, sample_exam):
        response = client.get(
            f"/admin/exams/{sample_exam.id}/evaluate/sess_nonexistent"
        )
        assert response.status_code == 403

    def test_get_detail_nonexistent_session(self, client, sample_exam):
        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        response = client.get(
            f"/admin/exams/{sample_exam.id}/evaluate/sess_nonexistent",
            headers={"X-Admin-Token": admin_secret},
        )
        assert response.status_code == 404

    def test_get_detail_with_session(self, client, sample_exam, db):
        from app.models import ExamSession, Question, CodingProblem

        q = Question(
            id="q_test_002", exam_id=sample_exam.id, section="Aptitude",
            text="Q2?", optA="A", optB="B", optC="C", optD="D", ans="B",
        )
        db.add(q)
        cp = CodingProblem(
            id="cp_test_001", exam_id=sample_exam.id, title="Sum",
            description="Add two numbers",
        )
        db.add(cp)
        db.commit()

        session = ExamSession(
            id="sess_eval_002", student_id="23-TEST-01", exam_id=sample_exam.id,
            session_secret="secret", is_submitted=True,
            submission_payload=json.dumps({
                "mcqs": {"q_test_002": "B"},
                "coding": {"cp_test_001": {"code": "print(1+1)", "language_id": 71}},
            }),
        )
        db.add(session)
        db.commit()

        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        response = client.get(
            f"/admin/exams/{sample_exam.id}/evaluate/sess_eval_002",
            headers={"X-Admin-Token": admin_secret},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["student_id"] == "23-TEST-01"
        assert data["data"]["mcq_score"] == 1
        assert len(data["data"]["coding_details"]) == 1
        assert data["data"]["coding_details"][0]["submitted_code"] == "print(1+1)"
        assert data["data"]["coding_details"][0]["is_attempted"] is True

    def test_save_and_clear_evaluation(self, client, sample_exam, db):
        from app.models import ExamSession, CodingProblem

        cp = CodingProblem(
            id="cp_test_002", exam_id=sample_exam.id, title="Multiply",
            description="Multiply two numbers",
        )
        db.add(cp)
        db.commit()

        session = ExamSession(
            id="sess_eval_003", student_id="23-TEST-01", exam_id=sample_exam.id,
            session_secret="secret", is_submitted=True,
            submission_payload=json.dumps({
                "mcqs": {},
                "coding": {"cp_test_002": {"code": "print(2*2)"}},
            }),
        )
        db.add(session)
        db.commit()

        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")

        # Save marks
        save_resp = client.post(
            f"/admin/exams/{sample_exam.id}/evaluate/sess_eval_003",
            json={
                "coding_marks": {"cp_test_002": 8},
                "subjective_marks": {},
                "review_status": "reviewed",
            },
            headers={"X-Admin-Token": admin_secret},
        )
        assert save_resp.status_code == 200
        save_data = save_resp.json()
        assert save_data["data"]["total_score"] == 8
        assert save_data["data"]["review_status"] == "reviewed"

        # Verify total_score persisted
        db.refresh(session)
        assert session.total_score == 8
        assert session.review_status == "reviewed"

        # Clear marks
        clear_resp = client.post(
            f"/admin/exams/{sample_exam.id}/evaluate/sess_eval_003/clear",
            json={},
            headers={"X-Admin-Token": admin_secret},
        )
        assert clear_resp.status_code == 200
        db.refresh(session)
        assert session.total_score == 0
        assert session.coding_evaluation is None
        assert session.review_status is None

    def test_review_status_toggle(self, client, sample_exam, db):
        from app.models import ExamSession

        session = ExamSession(
            id="sess_eval_004", student_id="23-TEST-01", exam_id=sample_exam.id,
            session_secret="secret", is_submitted=True,
            submission_payload=json.dumps({"mcqs": {}, "coding": {}}),
        )
        db.add(session)
        db.commit()

        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")

        # Set flagged
        resp1 = client.post(
            f"/admin/exams/{sample_exam.id}/evaluate/sess_eval_004/review",
            json={"status": "flagged"},
            headers={"X-Admin-Token": admin_secret},
        )
        assert resp1.status_code == 200
        db.refresh(session)
        assert session.review_status == "flagged"

        # Toggle to reviewed
        resp2 = client.post(
            f"/admin/exams/{sample_exam.id}/evaluate/sess_eval_004/review",
            json={"status": "reviewed"},
            headers={"X-Admin-Token": admin_secret},
        )
        assert resp2.status_code == 200
        db.refresh(session)
        assert session.review_status == "reviewed"

        # Invalid status
        resp3 = client.post(
            f"/admin/exams/{sample_exam.id}/evaluate/sess_eval_004/review",
            json={"status": "invalid_status"},
            headers={"X-Admin-Token": admin_secret},
        )
        assert resp3.status_code == 400
