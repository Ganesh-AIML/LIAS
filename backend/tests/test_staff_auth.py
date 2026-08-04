"""Tests for staff (admin/faculty) authentication endpoints."""

import os
import time
import jwt
import bcrypt

from app.models import StaffAccount
from app.database import get_mongo_db


def get_mongo_staff(email: str):
    return get_mongo_db()["staff_accounts"].find_one({"email": email})


# ── ADMIN LOGIN ────────────────────────────────────────────────────────────────

class TestAdminLogin:
    def test_admin_login_success(self, client, admin_staff):
        response = client.post(
            "/admin/auth/login",
            json={"email": "admin@test.local", "password": "test1234"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["token"]
        assert data["staff"]["role"] == "admin"
        assert data["staff"]["module"] is None
        assert "password" not in str(data)

    def test_admin_login_wrong_password(self, client, admin_staff):
        response = client.post(
            "/admin/auth/login",
            json={"email": "admin@test.local", "password": "wrongpass"},
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid email or password."

    def test_admin_login_unknown_email(self, client):
        response = client.post(
            "/admin/auth/login",
            json={"email": "nobody@test.local", "password": "test1234"},
        )
        assert response.status_code == 401

    def test_admin_login_rejects_faculty(self, client, faculty_staff):
        response = client.post(
            "/admin/auth/login",
            json={"email": "faculty@test.local", "password": "test1234"},
        )
        assert response.status_code == 401

    def test_admin_login_invalid_email_format(self, client):
        response = client.post(
            "/admin/auth/login",
            json={"email": "not-an-email", "password": "test1234"},
        )
        assert response.status_code == 422

    def test_admin_login_empty_password(self, client):
        response = client.post(
            "/admin/auth/login",
            json={"email": "admin@test.local", "password": ""},
        )
        assert response.status_code == 422


# ── FACULTY LOGIN ──────────────────────────────────────────────────────────────

class TestFacultyLogin:
    def test_faculty_login_success(self, client, faculty_staff):
        response = client.post(
            "/admin/auth/faculty-login",
            json={"email": "faculty@test.local", "password": "test1234"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["token"]
        assert data["staff"]["role"] == "faculty"
        assert data["staff"]["module"] == "MAS701"

    def test_faculty_login_rejects_admin(self, client, admin_staff):
        response = client.post(
            "/admin/auth/faculty-login",
            json={"email": "admin@test.local", "password": "test1234"},
        )
        assert response.status_code == 401

    def test_pending_faculty_login_succeeds_with_null_module(self, client, pending_faculty_staff):
        response = client.post(
            "/admin/auth/faculty-login",
            json={"email": "pending@test.local", "password": "test1234"},
        )
        assert response.status_code == 200
        assert response.json()["staff"]["module"] is None


# ── FACULTY REGISTRATION ───────────────────────────────────────────────────────

class TestFacultyRegister:
    def test_register_success_creates_pending_faculty(self, client, db):
        response = client.post(
            "/admin/auth/register",
            json={"name": "New Faculty", "email": "new@test.local", "password": "pass1234"},
        )
        assert response.status_code == 200
        assert response.json()["success"] is True
        # No auto-login token is issued
        assert "token" not in response.json()

        row = get_mongo_staff("new@test.local")
        assert row is not None
        assert row["role"] == "faculty"
        assert row["module"] is None  # pending until an admin assigns a module
        assert row["password_hash"] != "pass1234"
        assert bcrypt.checkpw(b"pass1234", row["password_hash"].encode("utf-8"))

    def test_register_ignores_module_field(self, client, db):
        # The module field is NOT accepted at registration — it must be ignored.
        response = client.post(
            "/admin/auth/register",
            json={
                "name": "Sneaky Faculty",
                "email": "sneaky@test.local",
                "password": "pass1234",
                "module": "HACKED",
            },
        )
        assert response.status_code == 200
        row = get_mongo_staff("sneaky@test.local")
        assert row["module"] is None

    def test_register_duplicate_email(self, client, faculty_staff):
        response = client.post(
            "/admin/auth/register",
            json={"name": "Dup", "email": "faculty@test.local", "password": "pass1234"},
        )
        assert response.status_code == 409

    def test_register_invalid_email(self, client):
        response = client.post(
            "/admin/auth/register",
            json={"name": "Bad", "email": "nope", "password": "pass1234"},
        )
        assert response.status_code == 422

    def test_register_short_password(self, client):
        response = client.post(
            "/admin/auth/register",
            json={"name": "Bad", "email": "bad@test.local", "password": "ab"},
        )
        assert response.status_code == 422

    def test_register_empty_name(self, client):
        response = client.post(
            "/admin/auth/register",
            json={"name": "", "email": "noname@test.local", "password": "pass1234"},
        )
        assert response.status_code == 422


# ── TOKEN / VERIFY BEHAVIOUR ───────────────────────────────────────────────────

class TestTokenBehaviour:
    def test_verify_with_staff_jwt_returns_role_and_module(self, client, admin_bearer_headers):
        response = client.get("/admin/verify", headers=admin_bearer_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "admin"
        assert "module" in data

    def test_verify_with_faculty_jwt_returns_role_and_module(self, client, faculty_bearer_headers):
        response = client.get("/admin/verify", headers=faculty_bearer_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "faculty"
        assert data["module"] == "MAS701"

    def test_garbage_bearer_token_rejected(self, client):
        response = client.get(
            "/admin/verify",
            headers={"Authorization": "Bearer garbage.token.here"},
        )
        assert response.status_code == 401

    def test_expired_staff_jwt_rejected(self, client, admin_staff):
        expired = jwt.encode(
            {"sub": admin_staff.id, "exp": int(time.time()) - 60},
            os.environ["JWT_SECRET_KEY"],
            algorithm="HS256",
        )
        response = client.get(
            "/admin/verify",
            headers={"Authorization": f"Bearer {expired}"},
        )
        assert response.status_code == 401

    def test_student_jwt_rejected_on_admin_route(self, client, sample_exam):
        from app.auth import create_session_jwt
        student_token = create_session_jwt("23-TEST-01", sample_exam.id, "sess_whatever")
        response = client.get(
            "/admin/verify",
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert response.status_code in (401, 403)

    def test_legacy_token_rejected_after_admin_seeded(self, client, admin_staff):
        # Once an admin account exists, the bootstrap window closes.
        response = client.get(
            "/admin/verify",
            headers={"X-Admin-Token": os.environ["ADMIN_SECRET"]},
        )
        assert response.status_code == 403


# ── ADMIN SEEDING ──────────────────────────────────────────────────────────────

class TestAdminSeeding:
    def test_seed_creates_admin_from_env(self, monkeypatch):
        from app.main import _seed_admin_if_needed

        monkeypatch.setenv("ADMIN_EMAIL", "seeded@test.local")
        monkeypatch.setenv("ADMIN_PASSWORD", "seedpass123")
        _seed_admin_if_needed()

        mdb = get_mongo_db()
        row = mdb["staff_accounts"].find_one({"email": "seeded@test.local"})
        assert row is not None
        assert row["role"] == "admin"
        assert row["module"] is None
        assert bcrypt.checkpw(b"seedpass123", row["password_hash"].encode("utf-8"))

    def test_seed_skipped_when_admin_exists(self, monkeypatch, db, admin_staff):
        from app.main import _seed_admin_if_needed

        monkeypatch.setenv("ADMIN_EMAIL", "another@test.local")
        monkeypatch.setenv("ADMIN_PASSWORD", "seedpass123")
        _seed_admin_if_needed()

        mdb = get_mongo_db()
        count = mdb["staff_accounts"].count_documents({"role": "admin"})
        assert count == 1
        admin = mdb["staff_accounts"].find_one({"role": "admin"})
        assert admin["email"] == "admin@test.local"

    def test_seed_skipped_without_env(self, monkeypatch):
        from app.main import _seed_admin_if_needed

        monkeypatch.delenv("ADMIN_EMAIL", raising=False)
        monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
        _seed_admin_if_needed()

        mdb = get_mongo_db()
        rows = list(mdb["staff_accounts"].find({"role": "admin"}))
        assert rows == []
