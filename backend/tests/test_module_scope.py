"""Tests for module-based authorization (faculty scoping, admin-only gates)."""

import json
import time

from app.database import get_mongo_db
from app import repositories as repo


def _exam(db, eid, module=None, title=None):
    mdb = get_mongo_db()
    doc = repo.doc_for("exams", {
        "id": eid,
        "title": title or eid,
        "duration_seconds": 3600,
        "starts_at": int((time.time() + 86400) * 1000),
        "status": "upcoming",
        "start_password_hash": "$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6",
        "module": module,
    })
    mdb["exams"].insert_one(doc)


def _session(db, sid, exam_id, submitted=True):
    mdb = get_mongo_db()
    doc = repo.doc_for("exam_sessions", {
        "id": sid,
        "student_id": "23-TEST-01",
        "exam_id": exam_id,
        "session_secret": "secret",
        "is_submitted": submitted,
        "submission_payload": json.dumps({"mcqs": {}, "coding": {}}),
    })
    mdb["exam_sessions"].insert_one(doc)


def _token(db, token, exam_id, student_id="23-TEST-01"):
    mdb = get_mongo_db()
    doc = repo.doc_for("token_registry", {
        "token": token,
        "exam_id": exam_id,
        "student_id": student_id,
        "password_hash": "$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6",
        "is_active": True,
    })
    doc["_id"] = token
    mdb["token_registry"].insert_one(doc)


CREATE_PAYLOAD = {
    "title": "Scoped Exam",
    "duration_minutes": 60,
    "starts_at": (time.time() + 86400) * 1000,
    "start_password": "start123",
    "status": "upcoming",
}


# ── FACULTY EXAM SCOPING ───────────────────────────────────────────────────────

class TestFacultyExamScoping:
    def test_faculty_lists_only_module_exams(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _exam(db, "exam_cs", module="MAS702")
        _exam(db, "exam_unassigned", module=None)

        response = client.get("/admin/exams", headers=faculty_bearer_headers)
        assert response.status_code == 200
        ids = [e["id"] for e in response.json()["data"]]
        assert ids == ["exam_aiml"]
        assert response.json()["data"][0]["module"] == "MAS701"

    def test_faculty_cannot_read_cross_module_exam(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        response = client.get("/admin/exams/exam_cs", headers=faculty_bearer_headers)
        assert response.status_code == 403

    def test_faculty_cannot_update_cross_module_exam(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        response = client.put(
            f"/admin/exams/exam_cs", json={**CREATE_PAYLOAD, "title": "Hacked"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_cannot_delete_cross_module_exam(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        response = client.delete("/admin/exams/exam_cs", headers=faculty_bearer_headers)
        assert response.status_code == 403

    def test_faculty_cannot_view_cross_module_analytics(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        response = client.get("/admin/exams/exam_cs/analytics", headers=faculty_bearer_headers)
        assert response.status_code == 403

    def test_faculty_cannot_monitor_cross_module_exam(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        response = client.get("/admin/exams/exam_cs/monitor", headers=faculty_bearer_headers)
        assert response.status_code == 403

    def test_faculty_cannot_list_cross_module_active_exams(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        response = client.get("/admin/exams/active", headers=faculty_bearer_headers)
        assert response.status_code == 200
        assert response.json()["data"] == []

    def test_faculty_can_read_own_module_exam(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        response = client.get("/admin/exams/exam_aiml", headers=faculty_bearer_headers)
        assert response.status_code == 200
        assert response.json()["data"]["module"] == "MAS701"


# ── FACULTY EXAM CREATION MODULE RULES ─────────────────────────────────────────

class TestFacultyCreateExamModuleRules:
    def test_faculty_create_exam_forces_own_module(self, client, faculty_bearer_headers):
        # Valid foreign code is ignored — the exam is locked to the faculty's module.
        payload = {**CREATE_PAYLOAD, "module": "MAS702"}
        response = client.post("/admin/exams", json=payload, headers=faculty_bearer_headers)
        assert response.status_code == 200
        exam_id = response.json()["exam_id"]

        fetched = client.get(f"/admin/exams/{exam_id}", headers=faculty_bearer_headers)
        assert fetched.json()["data"]["module"] == "MAS701"

    def test_faculty_create_exam_rejects_unknown_module(self, client, faculty_bearer_headers):
        response = client.post(
            "/admin/exams", json={**CREATE_PAYLOAD, "module": "HACKED"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 422

    def test_admin_create_exam_rejects_unknown_module(self, client, admin_bearer_headers):
        response = client.post(
            "/admin/exams", json={**CREATE_PAYLOAD, "module": "HACKED"},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 422

    def test_pending_faculty_cannot_create_exam(self, client, pending_faculty_bearer_headers):
        response = client.post("/admin/exams", json=CREATE_PAYLOAD, headers=pending_faculty_bearer_headers)
        assert response.status_code == 403


# ── EXAM UPDATE MODULE RULES ───────────────────────────────────────────────────

class TestExamUpdateModuleRules:
    def test_admin_update_exam_preserves_module_when_omitted(self, client, admin_bearer_headers):
        response = client.post(
            "/admin/exams", json={**CREATE_PAYLOAD, "module": "MAS701"},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 200
        exam_id = response.json()["exam_id"]

        # Module key omitted entirely -> existing module preserved, not NULLed.
        response = client.put(
            f"/admin/exams/{exam_id}", json={**CREATE_PAYLOAD, "title": "Renamed"},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 200

        fetched = client.get(f"/admin/exams/{exam_id}", headers=admin_bearer_headers)
        assert fetched.json()["data"]["module"] == "MAS701"

    def test_admin_update_exam_explicit_null_clears_module(self, client, admin_bearer_headers):
        response = client.post(
            "/admin/exams", json={**CREATE_PAYLOAD, "module": "MAS701"},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 200
        exam_id = response.json()["exam_id"]

        # Explicit "module": null is an intentional clear (admin UI empty field).
        response = client.put(
            f"/admin/exams/{exam_id}", json={**CREATE_PAYLOAD, "module": None},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 200

        fetched = client.get(f"/admin/exams/{exam_id}", headers=admin_bearer_headers)
        assert fetched.json()["data"]["module"] is None

    def test_faculty_update_exam_forces_own_module(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")

        for module in ("MAS702", None):
            response = client.put(
                f"/admin/exams/exam_aiml", json={**CREATE_PAYLOAD, "module": module},
                headers=faculty_bearer_headers,
            )
            assert response.status_code == 200

            fetched = client.get("/admin/exams/exam_aiml", headers=faculty_bearer_headers)
            assert fetched.json()["data"]["module"] == "MAS701"

    def test_faculty_update_exam_rejects_unknown_module(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        response = client.put(
            f"/admin/exams/exam_aiml", json={**CREATE_PAYLOAD, "module": "HACKED"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 422


# ── PENDING FACULTY ────────────────────────────────────────────────────────────

class TestPendingFaculty:
    def test_pending_faculty_lists_no_exams(self, client, db, pending_faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        response = client.get("/admin/exams", headers=pending_faculty_bearer_headers)
        assert response.status_code == 200
        assert response.json()["data"] == []

    def test_pending_faculty_cannot_read_any_exam(self, client, db, pending_faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        response = client.get("/admin/exams/exam_aiml", headers=pending_faculty_bearer_headers)
        assert response.status_code == 403

    def test_pending_faculty_verify_reports_null_module(self, client, pending_faculty_bearer_headers):
        response = client.get("/admin/verify", headers=pending_faculty_bearer_headers)
        assert response.status_code == 200
        assert response.json()["module"] is None


# ── FACULTY STUDENT MANAGEMENT ─────────────────────────────────────────────────

class TestFacultyStudentManagement:
    def test_faculty_cannot_create_master_student(self, client, faculty_bearer_headers):
        response = client.post(
            "/admin/master-students",
            json={"id": "23-AIML-900", "password": "pass1234"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_cannot_bulk_create_master_students(self, client, faculty_bearer_headers):
        response = client.post(
            "/admin/master-students/bulk",
            json={"students": [{"id": "23-AIML-901", "password": "pass1234"}]},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_cannot_update_master_student(self, client, db, sample_student, faculty_bearer_headers):
        response = client.put(
            "/admin/master-students/23-TEST-01",
            json={"is_active": False},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_cannot_delete_master_student(self, client, db, sample_student, faculty_bearer_headers):
        response = client.delete(
            "/admin/master-students/23-TEST-01", headers=faculty_bearer_headers
        )
        assert response.status_code == 403

    def test_faculty_cannot_reset_master_student(self, client, db, sample_student, faculty_bearer_headers):
        response = client.post(
            "/admin/master-students/23-TEST-01/reset-and-resync",
            json={"password": "newpass123"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_master_students_enrollments_filtered(self, client, db, sample_student, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _exam(db, "exam_cs", module="MAS702")
        _token(db, "TOKEN_A", "exam_aiml")
        _token(db, "TOKEN_B", "exam_cs")

        response = client.get("/admin/master-students", headers=faculty_bearer_headers)
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data) == 1
        exam_ids = [e["exam_id"] for e in data[0]["enrollments"]]
        assert exam_ids == ["exam_aiml"]

    def test_faculty_cannot_list_students_for_cross_module_exam(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        response = client.get("/admin/students", params={"exam_id": "exam_cs"}, headers=faculty_bearer_headers)
        assert response.status_code == 403

    def test_faculty_can_list_students_for_own_exam(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _token(db, "TOKEN_A", "exam_aiml")
        response = client.get("/admin/students", params={"exam_id": "exam_aiml"}, headers=faculty_bearer_headers)
        assert response.status_code == 200
        assert [r["token"] for r in response.json()["data"]] == ["TOKEN_A"]

    def test_faculty_students_without_exam_filter_are_module_scoped(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _exam(db, "exam_cs", module="MAS702")
        _token(db, "TOKEN_A", "exam_aiml")
        _token(db, "TOKEN_B", "exam_cs")
        response = client.get("/admin/students", headers=faculty_bearer_headers)
        assert response.status_code == 200
        assert [r["token"] for r in response.json()["data"]] == ["TOKEN_A"]

    def test_faculty_cannot_update_cross_module_student(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        _token(db, "TOKEN_B", "exam_cs")
        response = client.put(
            "/admin/students/TOKEN_B",
            json={"is_active": True},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_cannot_delete_cross_module_student(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        _token(db, "TOKEN_B", "exam_cs")
        response = client.delete("/admin/students/TOKEN_B", headers=faculty_bearer_headers)
        assert response.status_code == 403

    def test_faculty_can_update_own_module_student(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _token(db, "TOKEN_A", "exam_aiml")
        response = client.put(
            "/admin/students/TOKEN_A",
            json={"is_active": False},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 200

    def test_faculty_cannot_bulk_delete_cross_module_students(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        _token(db, "TOKEN_B", "exam_cs")
        response = client.post(
            "/admin/students/bulk-delete",
            json={"tokens": ["TOKEN_B"], "exam_id": "exam_cs"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_can_bulk_delete_own_module_students(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _token(db, "TOKEN_A", "exam_aiml")
        response = client.post(
            "/admin/students/bulk-delete",
            json={"tokens": ["TOKEN_A"], "exam_id": "exam_aiml"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 200

    def test_faculty_cannot_assign_students_to_cross_module_exam(self, client, db, sample_student, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        response = client.post(
            "/admin/exams/exam_cs/assign",
            json={"student_ids": ["23-TEST-01"]},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_can_assign_students_to_own_module_exam(self, client, db, sample_student, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        response = client.post(
            "/admin/exams/exam_aiml/assign",
            json={"student_ids": ["23-TEST-01"]},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 200
        assert response.json()["created"] == 1


# ── SESSION REVOKE / GRANT SCOPING ─────────────────────────────────────────────

class TestSessionScoping:
    def test_faculty_cannot_revoke_cross_module_session(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        _session(db, "sess_cs_1", "exam_cs")
        response = client.post(
            "/admin/sessions/revoke",
            json={"session_id": "sess_cs_1"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_can_revoke_own_module_session(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _session(db, "sess_aiml_1", "exam_aiml")
        response = client.post(
            "/admin/sessions/revoke",
            json={"session_id": "sess_aiml_1"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 200
        _doc = get_mongo_db()["exam_sessions"].find_one({"_id": "sess_aiml_1"})
        assert _doc["is_revoked"] is True

    def test_faculty_cannot_grant_cross_module_session(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        _session(db, "sess_cs_2", "exam_cs")
        response = client.post(
            "/admin/sessions/grant",
            json={"session_id": "sess_cs_2"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_can_grant_own_module_session(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _session(db, "sess_aiml_2", "exam_aiml", submitted=False)
        get_mongo_db()["exam_sessions"].update_one({"_id": "sess_aiml_2"}, {"$set": {"is_revoked": True}})
        response = client.post(
            "/admin/sessions/grant",
            json={"session_id": "sess_aiml_2"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 200
        _doc = get_mongo_db()["exam_sessions"].find_one({"_id": "sess_aiml_2"})
        assert _doc["is_revoked"] is False


# ── EVALUATION SCOPING ─────────────────────────────────────────────────────────

class TestEvaluationScoping:
    def test_faculty_cannot_access_cross_module_evaluation(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_cs", module="MAS702")
        _session(db, "sess_cs_3", "exam_cs")

        assert client.get("/admin/exams/exam_cs/evaluate", headers=faculty_bearer_headers).status_code == 403
        assert client.get("/admin/exams/exam_cs/evaluate/sess_cs_3", headers=faculty_bearer_headers).status_code == 403
        assert client.post(
            "/admin/exams/exam_cs/evaluate/sess_cs_3",
            json={"coding_marks": {"cp": 5}},
            headers=faculty_bearer_headers,
        ).status_code == 403
        assert client.post(
            "/admin/exams/exam_cs/evaluate/sess_cs_3/clear",
            json={},
            headers=faculty_bearer_headers,
        ).status_code == 403
        assert client.post(
            "/admin/exams/exam_cs/evaluate/sess_cs_3/review",
            json={"status": "reviewed"},
            headers=faculty_bearer_headers,
        ).status_code == 403

    def test_faculty_can_access_own_module_evaluation(self, client, db, faculty_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _session(db, "sess_aiml_3", "exam_aiml")
        response = client.get("/admin/exams/exam_aiml/evaluate", headers=faculty_bearer_headers)
        assert response.status_code == 200


# ── ADMIN GLOBAL ACCESS ────────────────────────────────────────────────────────

class TestAdminGlobalAccess:
    def test_admin_sees_all_exams_including_unassigned(self, client, db, admin_bearer_headers):
        _exam(db, "exam_aiml", module="MAS701")
        _exam(db, "exam_cs", module="MAS702")
        _exam(db, "exam_unassigned", module=None)
        response = client.get("/admin/exams", headers=admin_bearer_headers)
        assert response.status_code == 200
        assert len(response.json()["data"]) == 3

    def test_admin_can_read_null_module_exam(self, client, db, admin_bearer_headers):
        _exam(db, "exam_unassigned", module=None)
        response = client.get("/admin/exams/exam_unassigned", headers=admin_bearer_headers)
        assert response.status_code == 200


# ── STAFF MANAGEMENT (admin-only) ──────────────────────────────────────────────

class TestStaffManagement:
    def test_admin_lists_staff(self, client, admin_bearer_headers, faculty_staff):
        response = client.get("/admin/staff", headers=admin_bearer_headers)
        assert response.status_code == 200
        emails = [s["email"] for s in response.json()["data"]]
        assert "faculty@test.local" in emails
        assert all("password" not in s for s in response.json()["data"])

    def test_faculty_cannot_list_staff(self, client, faculty_bearer_headers):
        assert client.get("/admin/staff", headers=faculty_bearer_headers).status_code == 403

    def test_faculty_cannot_assign_modules(self, client, faculty_bearer_headers):
        response = client.put(
            "/admin/staff/staff_faculty_test",
            json={"module": "MAS702"},
            headers=faculty_bearer_headers,
        )
        assert response.status_code == 403

    def test_faculty_cannot_list_modules(self, client, faculty_bearer_headers):
        assert client.get("/admin/modules", headers=faculty_bearer_headers).status_code == 403

    def test_admin_assigns_module_to_faculty(self, client, db, admin_bearer_headers, faculty_staff):
        response = client.put(
            "/admin/staff/staff_faculty_test",
            json={"module": "MAS702"},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 200
        _doc = get_mongo_db()["staff_accounts"].find_one({"_id": "staff_faculty_test"})
        assert _doc["module"] == "MAS702"

    def test_admin_clears_faculty_module(self, client, db, admin_bearer_headers, faculty_staff):
        response = client.put(
            "/admin/staff/staff_faculty_test",
            json={"module": None},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 200
        _doc = get_mongo_db()["staff_accounts"].find_one({"_id": "staff_faculty_test"})
        assert _doc["module"] is None

    def test_cannot_assign_module_to_admin(self, client, admin_bearer_headers, admin_staff):
        response = client.put(
            "/admin/staff/staff_admin_test",
            json={"module": "MAS702"},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 400

    def test_assign_module_nonexistent_staff(self, client, admin_bearer_headers):
        response = client.put(
            "/admin/staff/staff_nope",
            json={"module": "MAS702"},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 404

    def test_assign_module_rejects_unknown_code(self, client, admin_bearer_headers, faculty_staff):
        response = client.put(
            "/admin/staff/staff_faculty_test",
            json={"module": "HACKED"},
            headers=admin_bearer_headers,
        )
        assert response.status_code == 422

    def test_modules_endpoint_returns_canonical_list(self, client, admin_bearer_headers):
        response = client.get("/admin/modules", headers=admin_bearer_headers)
        assert response.status_code == 200
        data = response.json()["data"]
        assert [m["code"] for m in data] == [
            "MAS701", "MAS702", "MAS703", "MAS704", "MAS705",
            "MAS706", "MAS707", "MAS708", "MAS709",
        ]
        assert all("title" in m and "ifoa_subject" in m for m in data)
