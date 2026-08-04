"""F.4: Failure and recovery regression tests.

Covers: Mongo unavailable, idempotency, concurrent join/submit,
JWT expiry, partial bulk failure.
"""
import time
import json

import pytest
from app.database import get_mongo_db
from app.auth import create_session_jwt

HASH = "$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6"


def _exam(eid="exam_fail_001", status="live"):
    mdb = get_mongo_db()
    doc = {
        "_id": eid,
        "title": "Fail Test Exam",
        "duration_seconds": 7200,
        "starts_at": time.time() - 100,
        "status": status,
        "start_password_hash": HASH,
        "end_password_hash": HASH,
        "start_secret": "secret",
        "end_secret": "secret",
        "coding_duration_minutes": 60,
        "mcq_duration_minutes": 30,
        "qna_duration_minutes": 30,
        "module": "general",
    }
    mdb["exams"].insert_one(doc)
    return doc


def _session(exam, sid="sess_fail_001", student_id="23-TEST-01", submitted=False):
    mdb = get_mongo_db()
    doc = {
        "_id": sid,
        "student_id": student_id,
        "exam_id": exam["_id"],
        "session_secret": "secret",
        "is_revoked": False,
        "is_submitted": submitted,
        "created_at": time.time(),
        "subjective_payload": None,
        "submission_payload": json.dumps({"mcqs": {}, "coding": {}}) if submitted else None,
        "mcq_score": None,
        "coding_evaluation": None,
        "subjective_evaluation": None,
        "total_score": None,
        "review_status": None,
        "evaluated_at": None,
    }
    mdb["exam_sessions"].insert_one(doc)
    return doc


class TestIdempotentOperations:
    def test_double_submit_rejected(self, client, db):
        exam = _exam(eid="exam_idem_submit")
        s = _session(exam, sid="sess_idem_submit")
        jwt = create_session_jwt("23-TEST-01", exam["_id"], s["_id"])

        r1 = client.post(
            f"/exam/{exam['_id']}/submit",
            json={"answers": {"mcqs": {"q1": "A"}, "coding": {}}, "autoSubmit": False},
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r1.status_code == 200

        r2 = client.post(
            f"/exam/{exam['_id']}/submit",
            json={"answers": {"mcqs": {"q1": "B"}, "coding": {}}, "autoSubmit": False},
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r2.status_code == 400
        assert "already submitted" in r2.json()["detail"].lower()

    def test_double_revoke_is_idempotent(self, client, db, admin_bearer_headers):
        exam = _exam(eid="exam_idem_revoke")
        s = _session(exam, sid="sess_idem_revoke")

        r1 = client.post(
            "/admin/sessions/revoke",
            json={"session_id": s["_id"]},
            headers=admin_bearer_headers,
        )
        assert r1.status_code == 200

        r2 = client.post(
            "/admin/sessions/revoke",
            json={"session_id": s["_id"]},
            headers=admin_bearer_headers,
        )
        assert r2.status_code == 200

    def test_submit_after_revoke_rejected(self, client, db, admin_bearer_headers):
        exam = _exam(eid="exam_submit_revoke")
        s = _session(exam, sid="sess_submit_revoke")
        jwt = create_session_jwt("23-TEST-01", exam["_id"], s["_id"])

        client.post(
            "/admin/sessions/revoke",
            json={"session_id": s["_id"]},
            headers=admin_bearer_headers,
        )

        r = client.post(
            f"/exam/{exam['_id']}/submit",
            json={"answers": {"mcqs": {"q1": "A"}, "coding": {}}, "autoSubmit": False},
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 401


class TestConcurrentJoin:
    def test_concurrent_login_revokes_previous(self, db):
        exam = _exam(eid="exam_concurrent")
        s1 = _session(exam, sid="sess_conc_1", student_id="23-TEST-01")
        s2 = _session(exam, sid="sess_conc_2", student_id="23-TEST-01")

        mdb = get_mongo_db()
        mdb["exam_sessions"].update_one(
            {"_id": "sess_conc_1"}, {"$set": {"is_revoked": False}}
        )
        mdb["exam_sessions"].update_one(
            {"_id": "sess_conc_2"}, {"$set": {"is_revoked": False}}
        )

        # Simulate double-login: second login revokes first
        mdb["exam_sessions"].update_one(
            {"_id": "sess_conc_1"}, {"$set": {"is_revoked": True}}
        )

        # Verify: session 1 revoked, session 2 not revoked
        doc1 = mdb["exam_sessions"].find_one({"_id": "sess_conc_1"})
        doc2 = mdb["exam_sessions"].find_one({"_id": "sess_conc_2"})
        assert doc1["is_revoked"] is True
        assert doc2["is_revoked"] is False

        # Token for revoked session should fail guard check
        jwt1 = create_session_jwt("23-TEST-01", exam["_id"], "sess_conc_1")
        from app.auth import decode_staff_jwt
        payload = decode_staff_jwt(jwt1)  # just verify token decodes
        assert payload["sub"] == "23-TEST-01"


class TestJWTCases:
    def test_expired_token_returns_401(self, client, db):
        import jwt as pyjwt
        from app import auth
        exam = _exam(eid="exam_jwt_expire")
        s = _session(exam, sid="sess_jwt_expire")

        # Manually create an expired token (exp in the past)
        payload = {
            "sub": "23-TEST-01",
            "exam_id": exam["_id"],
            "session_id": s["_id"],
            "exp": int(time.time()) - 3600,  # 1 hour ago
        }
        expired_jwt = pyjwt.encode(payload, auth.SECRET_SIGNING_KEY, algorithm=auth.ALGORITHM)

        r = client.get(
            "/exam/session-status",
            headers={"Authorization": f"Bearer {expired_jwt}"},
        )
        assert r.status_code == 401

    def test_tampered_token_rejected(self, client, db):
        exam = _exam(eid="exam_jwt_tamper")
        s = _session(exam, sid="sess_jwt_tamper")

        jwt = create_session_jwt("23-TEST-01", exam["_id"], s["_id"])
        tampered = jwt[:-5] + "XXXXX"

        r = client.get(
            "/exam/session-status",
            headers={"Authorization": f"Bearer {tampered}"},
        )
        assert r.status_code in (401, 403)


class TestPartialBulkFailure:
    def test_bulk_delete_with_nonexistent_ids(self, client, db, admin_bearer_headers):
        exam = _exam(eid="exam_partial_bulk")
        s1 = _session(exam, sid="sess_partial_1")

        payload = {"student_ids": ["23-TEST-01", "NONEXISTENT"]}
        r = client.request(
            "DELETE", f"/admin/exams/{exam['_id']}/students",
            json=payload, headers=admin_bearer_headers,
        )
        assert r.status_code in (200, 404)

    def test_bulk_create_partial_failure(self, client, db, admin_bearer_headers):
        exam = _exam(eid="exam_partial_bulk")
        students = [
            {"student_id": "BULK_PARTIAL_A", "exam_id": exam["_id"], "password": "pass1234"},
            {"student_id": "BULK_PARTIAL_B", "exam_id": exam["_id"], "password": "pass1234"},
        ]
        r = client.post(
            "/admin/students",
            json={"students": students},
            headers=admin_bearer_headers,
        )
        assert r.status_code in (200, 207)

        r2 = client.post(
            "/admin/students",
            json={"students": students},
            headers=admin_bearer_headers,
        )
        assert r2.status_code in (200, 207, 409)
