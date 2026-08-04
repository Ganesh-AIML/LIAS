import os
import time

os.environ["ADMIN_SECRET"] = "test_admin_secret_123"
os.environ["JWT_SECRET_KEY"] = "test_jwt_secret_key_for_testing_purposes_only"
os.environ["DB_ENCRYPTION_KEY"] = "wIAgy-gUwS1wSaQAKOeC4RcmO4zsJuPx780uRyWxMeU="
os.environ["MONGO_DB_NAME"] = "lias_test"
os.environ["ADMIN_EMAIL"] = ""
os.environ["ADMIN_PASSWORD"] = ""

import pytest
import bcrypt
from fastapi.testclient import TestClient

from app.database import get_mongo_db
from app.main import fastapi_app
from app.auth import create_staff_jwt
from app.limiter import limiter
from app import repositories as repo
from app.mongo_indexes import ensure_mongo_indexes


@pytest.fixture(autouse=True)
def mongo_test_db():
    """Ensure the Mongo test collections exist and are empty for each test."""
    mdb = get_mongo_db()
    assert mdb.name == "lias_test", f"test suite must not use production db, got {mdb.name}"
    ensure_mongo_indexes(mdb)
    for name in repo.COLLECTIONS.values():
        mdb[name].delete_many({})
    yield
    for name in repo.COLLECTIONS.values():
        mdb[name].delete_many({})


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    limiter.reset()
    yield


@pytest.fixture
def client():
    with TestClient(fastapi_app) as c:
        yield c


@pytest.fixture
def sample_exam(db):
    mdb = get_mongo_db()
    exam_id = "exam_test_001"
    doc = repo.doc_for("exams", {
        "id": exam_id,
        "title": "Test Exam",
        "duration_seconds": 3600,
        "starts_at": int((time.time() + 86400) * 1000),
        "status": "upcoming",
        "start_password_hash": "$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6",
        "module": None,
    })
    mdb["exams"].insert_one(doc)
    return type("Exam", (), {"id": exam_id, "title": doc["title"]})()


@pytest.fixture
def sample_student(db):
    mdb = get_mongo_db()
    student_id = "23-TEST-01"
    doc = repo.doc_for("students", {
        "id": student_id,
        "name": "Test Student",
        "password": "$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6",
        "is_active": True,
        "needs_password_reset": False,
    })
    mdb["students"].insert_one(doc)
    return type("Student", (), {"id": student_id, "name": doc["name"]})()


@pytest.fixture
def sample_token(db, sample_exam, sample_student):
    mdb = get_mongo_db()
    doc = repo.doc_for("token_registry", {
        "token": "LIAS_23-TEST-01_ABCD1234",
        "exam_id": sample_exam.id,
        "student_id": sample_student.id,
        "password_hash": "$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6",
        "is_active": True,
    })
    mdb["token_registry"].insert_one(doc)
    return type("Token", (), {"token": doc["token"], "exam_id": doc["exam_id"], "student_id": doc["student_id"]})()


# STAFF AUTH FIXTURES (module-based authorization)

def _staff_hash(password: str = "test1234") -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def _seed_staff(*, id, name, email, role, module, password="test1234"):
    """Create a staff account in the Mongo test DB."""
    password_hash = _staff_hash(password)
    mdb = get_mongo_db()
    doc = repo.doc_for("staff_accounts", {
        "id": id,
        "name": name,
        "email": email,
        "password_hash": password_hash,
        "role": role,
        "module": module,
        "created_at": time.time(),
    })
    mdb["staff_accounts"].insert_one(doc)
    return type("Staff", (), {"id": id, "email": email, "role": role, "module": module})()


@pytest.fixture
def admin_headers():
    """Legacy X-Admin-Token header (valid during the bootstrap window)."""
    return {"X-Admin-Token": os.environ["ADMIN_SECRET"]}


@pytest.fixture
def admin_staff(db):
    return _seed_staff(
        id="staff_admin_test",
        name="Test Admin",
        email="admin@test.local",
        role="admin",
        module=None,
    )


@pytest.fixture
def admin_bearer_headers(admin_staff):
    return {"Authorization": f"Bearer {create_staff_jwt(admin_staff.id)}"}


@pytest.fixture
def faculty_staff(db):
    return _seed_staff(
        id="staff_faculty_test",
        name="Test Faculty",
        email="faculty@test.local",
        role="faculty",
        module="MAS701",
    )


@pytest.fixture
def faculty_bearer_headers(faculty_staff):
    return {"Authorization": f"Bearer {create_staff_jwt(faculty_staff.id)}"}


@pytest.fixture
def other_faculty_staff(db):
    return _seed_staff(
        id="staff_faculty_other",
        name="Other Faculty",
        email="other@test.local",
        role="faculty",
        module="MAS702",
    )


@pytest.fixture
def other_faculty_bearer_headers(other_faculty_staff):
    return {"Authorization": f"Bearer {create_staff_jwt(other_faculty_staff.id)}"}


@pytest.fixture
def pending_faculty_staff(db):
    return _seed_staff(
        id="staff_faculty_pending",
        name="Pending Faculty",
        email="pending@test.local",
        role="faculty",
        module=None,
    )


@pytest.fixture
def pending_faculty_bearer_headers(pending_faculty_staff):
    return {"Authorization": f"Bearer {create_staff_jwt(pending_faculty_staff.id)}"}


@pytest.fixture
def db():
    """Dummy fixture - no SQL database needed. Kept for fixture compatibility."""
    yield None
