"""Regression tests for the expired-exam session-finalization fix.

A student session can only reach is_submitted=True via the client submit, an
admin revoke, or the evaluation flush. If the browser auto-submit never lands
(tab closed, network loss, clock drift past grace, expired JWT) the session
would otherwise stay "In Progress" forever. These tests cover the new lazy
server-side fallback (finalize_expired_sessions) and verify existing behaviour
is preserved.
"""

import json
import time

from app.models import Exam, ExamSession, Question
from app.routes.exam import finalize_expired_sessions, LATE_SUBMISSION_GRACE_SECONDS
from app.auth import create_session_jwt
from app.database import get_mongo_db
from app import repositories as repo

HASH = "$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6"


def _exam(db, eid, start_ago, duration_seconds, status="completed"):
    exam = Exam(
        id=eid,
        title=eid,
        duration_seconds=duration_seconds,
        starts_at=time.time() - start_ago,
        status=status,
        start_password_hash=HASH,
    )
    db.add(exam)
    db.commit()
    get_mongo_db()["exams"].insert_one(dict(repo.doc_for("exams", exam)))
    return exam


def _session(db, sid, exam_or_id, *, submitted=False, payload=None, subjective=None, created_at=None):
    exam_id = exam_or_id.id if hasattr(exam_or_id, "id") else exam_or_id
    session = ExamSession(
        id=sid,
        student_id="23-TEST-01",
        exam_id=exam_id,
        session_secret="secret",
        is_submitted=submitted,
        created_at=created_at,
        submission_payload=json.dumps(payload) if payload is not None else None,
        subjective_payload=json.dumps(subjective) if subjective is not None else None,
    )
    db.add(session)
    db.commit()
    get_mongo_db()["exam_sessions"].insert_one(dict(repo.doc_for("exam_sessions", session)))
    return session


class TestFinalizeExpired:
    def test_expired_unsubmitted_session_is_finalized(self, db):
        exam = _exam(db, "exam_expired", start_ago=5000, duration_seconds=1000)
        _session(db, "sess_expired", exam)

        n = finalize_expired_sessions(exam_id=exam.id)
        assert n == 1
        _doc = get_mongo_db()["exam_sessions"].find_one({"_id": "sess_expired"})
        assert _doc["is_submitted"] is True

    def test_active_exam_not_finalized(self, db):
        exam = _exam(db, "exam_active", start_ago=100, duration_seconds=100000, status="live")
        _session(db, "sess_active", exam)

        n = finalize_expired_sessions(exam_id=exam.id)
        assert n == 0
        _doc = get_mongo_db()["exam_sessions"].find_one({"_id": "sess_active"})
        assert _doc["is_submitted"] is False

    def test_expired_but_within_grace_not_finalized(self, db):
        # Exam ended 20s ago (< 60s grace) -> must NOT be finalized yet.
        exam = _exam(db, "exam_grace", start_ago=120, duration_seconds=100)
        _session(db, "sess_grace", exam)

        n = finalize_expired_sessions(exam_id=exam.id)
        assert n == 0
        _doc = get_mongo_db()["exam_sessions"].find_one({"_id": "sess_grace"})
        assert _doc["is_submitted"] is False

    def test_already_submitted_not_altered(self, db):
        exam = _exam(db, "exam_done", start_ago=5000, duration_seconds=1000)
        _session(db, "sess_done", exam, submitted=True, payload={"mcqs": {"q": "A"}, "coding": {}})

        n = finalize_expired_sessions(exam_id=exam.id)
        assert n == 0
        _doc = get_mongo_db()["exam_sessions"].find_one({"_id": "sess_done"})
        assert _doc["is_submitted"] is True

    def test_only_expired_unsubmitted_sessions_finalized(self, db):
        exam = _exam(db, "exam_mixed", start_ago=5000, duration_seconds=1000)
        _session(db, "sess_finalize", exam)
        _session(db, "sess_already", exam, submitted=True)
        exam_live = _exam(db, "exam_live_other", start_ago=100, duration_seconds=3600, status="live")
        _session(db, "sess_live", exam_live, submitted=True)

        n = finalize_expired_sessions(exam_id=exam.id)
        assert n == 1
        assert get_mongo_db()["exam_sessions"].find_one({"_id": "sess_finalize"})["is_submitted"] is True
        assert get_mongo_db()["exam_sessions"].find_one({"_id": "sess_already"})["is_submitted"] is True

    def test_expired_session_in_other_exam_untouched(self, db):
        exam_a = _exam(db, "exam_a", start_ago=5000, duration_seconds=1000)
        _session(db, "sess_a", exam_a)
        exam_b = _exam(db, "exam_b", start_ago=5000, duration_seconds=1000)
        _session(db, "sess_b", exam_b)

        n = finalize_expired_sessions(exam_id="exam_b")
        assert n == 1
        assert get_mongo_db()["exam_sessions"].find_one({"_id": "sess_a"})["is_submitted"] is False
        assert get_mongo_db()["exam_sessions"].find_one({"_id": "sess_b"})["is_submitted"] is True

    def test_answer_data_preserved_after_finalization(self, db):
        exam = _exam(db, "exam_save", start_ago=5000, duration_seconds=1000)
        payload = {"mcqs": {"q1": "A", "q2": "C"}, "coding": {"cp1": {"code": "print(1)", "score": 10}}}
        subjective = {"sq1": "paragraph answer"}
        _session(db, "sess_save", exam, payload=payload, subjective=subjective)

        finalize_expired_sessions(exam_id=exam.id)
        _doc = get_mongo_db()["exam_sessions"].find_one({"_id": "sess_save"})
        assert _doc["is_submitted"] is True
        assert _doc.get("submission_payload") == payload
        assert _doc.get("subjective_payload") == subjective

    def test_idempotent_repeated_execution(self, db):
        exam = _exam(db, "exam_idem", start_ago=5000, duration_seconds=1000)
        _session(db, "sess_idem", exam)

        assert finalize_expired_sessions(exam_id=exam.id) == 1
        assert finalize_expired_sessions(exam_id=exam.id) == 0
        assert get_mongo_db()["exam_sessions"].find_one({"_id": "sess_idem"})["is_submitted"] is True


class TestGracePeriodSubmissionStillWorks:
    def test_submit_within_grace_accepted(self, client, db):
        # Session exists but was never submitted; exam ended and the finalizer
        # is invoked (as the analytics/monitor/dashboard endpoints would). If
        # the client's own submit still arrives inside the grace window, it
        # must be accepted exactly as before.
        # Exam ended 20s ago (< 60s grace). Session created before exam end.
        exam = _exam(db, "exam_submit_grace", start_ago=120, duration_seconds=100)
        session = _session(db, "sess_submit_grace", exam, created_at=time.time() - 200)

        finalize_expired_sessions(exam_id=exam.id)
        _doc = get_mongo_db()["exam_sessions"].find_one({"_id": session.id})
        assert _doc["is_submitted"] is False

        jwt = create_session_jwt("23-TEST-01", exam.id, session.id)
        response = client.post(
            f"/exam/{exam.id}/submit",
            json={"answers": {"mcqs": {"q1": "A"}, "coding": {}}, "autoSubmit": True},
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert response.status_code == 200
        _doc = get_mongo_db()["exam_sessions"].find_one({"_id": session.id})
        assert _doc["is_submitted"] is True
        assert _doc["submission_payload"] == {"mcqs": {"q1": "A"}, "coding": {}}


class TestExpiredSessionInAdminViews:
    def test_analytics_reports_finished_after_finalization(self, client, db, admin_headers):
        exam = _exam(db, "exam_analytics", start_ago=5000, duration_seconds=1000)
        _session(db, "sess_analytics", exam)

        response = client.get(f"/admin/exams/{exam.id}/analytics", headers=admin_headers)
        assert response.status_code == 200
        students = response.json()["data"]["students"]
        assert len(students) == 1
        assert students[0]["submitted"] is True

    def test_analytics_active_exam_still_in_progress(self, client, db, admin_headers):
        exam = _exam(db, "exam_live", start_ago=100, duration_seconds=3600, status="live")
        _session(db, "sess_live", exam)

        response = client.get(f"/admin/exams/{exam.id}/analytics", headers=admin_headers)
        assert response.status_code == 200
        students = response.json()["data"]["students"]
        assert len(students) == 1
        assert students[0]["submitted"] is False

    def test_monitor_reports_completed_after_finalization(self, client, db, admin_headers):
        exam = _exam(db, "exam_monitor", start_ago=5000, duration_seconds=1000)
        _session(db, "sess_monitor", exam)

        response = client.get(f"/admin/exams/{exam.id}/monitor", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_submitted"] == 1
        student = next(s for s in data["students"] if s["student_id"] == "23-TEST-01")
        assert student["submitted"] is True

    def test_monitor_active_exam_still_in_exam(self, client, db, admin_headers):
        exam = _exam(db, "exam_monitor_live", start_ago=100, duration_seconds=3600, status="live")
        _session(db, "sess_monitor_live", exam)

        response = client.get(f"/admin/exams/{exam.id}/monitor", headers=admin_headers)
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["active_now"] == 1
        student = next(s for s in data["students"] if s["student_id"] == "23-TEST-01")
        assert student["submitted"] is False
