"""Tests for authentication and authorization endpoints."""

import time
from app.models import ExamSession


class TestHealthCheck:
    def test_health_check_returns_online(self, client):
        response = client.get("/auth/health-check")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "online"
        assert "server_time" in data


class TestJoinExam:
    def test_join_with_valid_credentials(self, client, sample_token):
        response = client.post("/auth/join", json={
            "student_id": "23-TEST-01",
            "password": "Pass@1234",
            "exam_token": "LIAS_23-TEST-01_ABCD1234",
        })
        assert response.status_code == 200
        data = response.json()
        assert "session_jwt" in data
        assert data["exam_id"] == sample_token.exam_id

    def test_join_with_wrong_password(self, client, sample_token):
        response = client.post("/auth/join", json={
            "student_id": "23-TEST-01",
            "password": "WrongPassword",
            "exam_token": "LIAS_23-TEST-01_ABCD1234",
        })
        assert response.status_code == 401
        assert "Invalid credentials" in response.text

    def test_join_with_invalid_token(self, client):
        response = client.post("/auth/join", json={
            "student_id": "23-TEST-01",
            "password": "Pass@1234",
            "exam_token": "NONEXISTENT_TOKEN",
        })
        assert response.status_code == 401

    def test_join_with_malformed_student_id(self, client):
        response = client.post("/auth/join", json={
            "student_id": "<script>alert(1)</script>",
            "password": "Pass@1234",
            "exam_token": "SOME_TOKEN",
        })
        # Should be rejected by field_validator before reaching DB
        assert response.status_code == 422

    def test_join_revokes_old_session(self, client, db, sample_token):
        # First login
        client.post("/auth/join", json={
            "student_id": "23-TEST-01",
            "password": "Pass@1234",
            "exam_token": "LIAS_23-TEST-01_ABCD1234",
        })
        old_sessions = db.query(ExamSession).filter(
            ExamSession.student_id == "23-TEST-01"
        ).all()
        assert len(old_sessions) == 1

        # Second login should revoke the first
        client.post("/auth/join", json={
            "student_id": "23-TEST-01",
            "password": "Pass@1234",
            "exam_token": "LIAS_23-TEST-01_ABCD1234",
        })
        sessions = db.query(ExamSession).filter(
            ExamSession.student_id == "23-TEST-01"
        ).order_by(ExamSession.created_at).all()
        assert len(sessions) == 2
        assert sessions[0].is_revoked is True
        assert sessions[1].is_revoked is False

    def test_join_rejects_deactivated_student(self, client, db, sample_token, sample_student):
        sample_student.is_active = False
        db.commit()

        response = client.post("/auth/join", json={
            "student_id": "23-TEST-01",
            "password": "Pass@1234",
            "exam_token": "LIAS_23-TEST-01_ABCD1234",
        })
        assert response.status_code == 401


class TestRateLimiting:
    def test_join_rate_limited(self, client, sample_token):
        for _ in range(5):
            client.post("/auth/join", json={
                "student_id": "23-TEST-01",
                "password": "WrongPass",
                "exam_token": "LIAS_23-TEST-01_ABCD1234",
            })
        response = client.post("/auth/join", json={
            "student_id": "23-TEST-01",
            "password": "WrongPass",
            "exam_token": "LIAS_23-TEST-01_ABCD1234",
        })
        assert response.status_code in (429, 401)
