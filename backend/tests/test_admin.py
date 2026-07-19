"""Tests for admin endpoints."""

import os
import time


class TestAdminAuth:
    def test_verify_with_valid_token(self, client):
        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        response = client.get("/admin/verify", headers={"X-Admin-Token": admin_secret})
        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_verify_with_invalid_token(self, client):
        response = client.get("/admin/verify", headers={"X-Admin-Token": "wrong_token"})
        assert response.status_code == 403

    def test_verify_without_token(self, client):
        response = client.get("/admin/verify")
        assert response.status_code == 403


class TestExamCRUD:
    def test_create_exam_requires_auth(self, client):
        response = client.post("/admin/exams", json={"title": "Test"})
        assert response.status_code == 403

    def test_create_exam_with_valid_payload(self, client):
        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        payload = {
            "title": "Integration Test Exam",
            "duration_minutes": 60,
            "starts_at": (time.time() + 86400) * 1000,
            "start_password": "start123",
            "status": "upcoming",
        }
        response = client.post(
            "/admin/exams",
            json=payload,
            headers={"X-Admin-Token": admin_secret},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "exam_id" in data

    def test_create_exam_empty_title_rejected(self, client):
        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        response = client.post(
            "/admin/exams",
            json={
                "title": "",
                "duration_minutes": 60,
                "starts_at": time.time() * 1000,
                "start_password": "start123",
                "status": "upcoming",
            },
            headers={"X-Admin-Token": admin_secret},
        )
        assert response.status_code == 422


class TestStudentValidation:
    def test_create_master_student_valid(self, client, db):
        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        response = client.post(
            "/admin/master-students",
            json={"id": "23-AIML-200", "name": "Valid Student", "password": "pass1234"},
            headers={"X-Admin-Token": admin_secret},
        )
        assert response.status_code == 200

    def test_create_master_student_short_password_rejected(self, client):
        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        response = client.post(
            "/admin/master-students",
            json={"id": "23-AIML-201", "name": "Bad", "password": "ab"},
            headers={"X-Admin-Token": admin_secret},
        )
        assert response.status_code == 422

    def test_create_master_student_xss_id_rejected(self, client):
        admin_secret = os.getenv("ADMIN_SECRET", "test_admin_secret")
        response = client.post(
            "/admin/master-students",
            json={"id": "<script>alert(1)</script>", "name": "XSS", "password": "pass1234"},
            headers={"X-Admin-Token": admin_secret},
        )
        assert response.status_code == 422
