import os
import tempfile
import time
import atexit

_db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_db_path = _db_file.name
_db_file.close()
def _cleanup():
    try:
        if os.path.exists(_db_path):
            os.unlink(_db_path)
    except PermissionError:
        pass
atexit.register(_cleanup)

os.environ["ADMIN_SECRET"] = "test_admin_secret_123"
os.environ["JWT_SECRET_KEY"] = "test_jwt_secret_key_for_testing_purposes_only"
os.environ["DB_ENCRYPTION_KEY"] = "wIAgy-gUwS1wSaQAKOeC4RcmO4zsJuPx780uRyWxMeU="
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
# Staff auth reads from MongoDB. Tests must NEVER touch the production `lias`
# database — divert to a dedicated test DB before importing app modules.
os.environ["MONGO_DB_NAME"] = "lias_test"
# Disable the admin seed in tests — the bootstrap window (X-Admin-Token) and
# staff fixtures must control exactly which admin accounts exist.
os.environ["ADMIN_EMAIL"] = ""
os.environ["ADMIN_PASSWORD"] = ""

import pytest
import bcrypt
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.database import Base, get_db, get_mongo_db
from app.main import fastapi_app
from app.models import Student, TokenRegistry, Exam, ExamSession, StaffAccount
from app.auth import create_staff_jwt
from app.limiter import limiter
from app import repositories as repo
from app.mongo_indexes import ensure_mongo_indexes

TEST_DATABASE_URL = f"sqlite:///{_db_path}"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


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


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    limiter.reset()
    yield


@pytest.fixture
def db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client(db):
    fastapi_app.dependency_overrides[get_db] = lambda: db
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def sample_exam(db):
    exam = Exam(
        id="exam_test_001",
        title="Test Exam",
        duration_seconds=3600,
        starts_at=int((time.time() + 86400) * 1000),
        status="upcoming",
        start_password_hash="$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6",
    )
    db.add(exam)
    db.commit()
    mdb = get_mongo_db()
    mdb["exams"].insert_one(dict(repo.doc_for("exams", exam)))
    return exam


@pytest.fixture
def sample_student(db):
    student = Student(
        id="23-TEST-01",
        name="Test Student",
        password="$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6",
        is_active=True,
    )
    db.add(student)
    db.commit()
    mdb = get_mongo_db()
    mdb["students"].insert_one(dict(repo.doc_for("students", student)))
    return student


@pytest.fixture
def sample_token(db, sample_exam, sample_student):
    token = TokenRegistry(
        token="LIAS_23-TEST-01_ABCD1234",
        exam_id=sample_exam.id,
        student_id=sample_student.id,
        password_hash="$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6",
        is_active=True,
    )
    db.add(token)
    db.commit()
    mdb = get_mongo_db()
    mdb["token_registry"].insert_one(dict(repo.doc_for("token_registry", token)))
    return token


# ── STAFF AUTH FIXTURES (module-based authorization) ──────────────────────────

def _staff_hash(password: str = "test1234") -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def _seed_staff(db, *, id, name, email, role, module, password="test1234"):
    """Create a staff account in BOTH the SQLite test DB (for the still SQL-backed
    seed path and ORM-fixture users) and the Mongo test DB (for migrated staff
    auth routes and verify_admin). Keeps every existing assertion valid."""
    password_hash = _staff_hash(password)
    staff = StaffAccount(
        id=id,
        name=name,
        email=email,
        password_hash=password_hash,
        role=role,
        module=module,
    )
    db.add(staff)
    db.commit()
    mdb = get_mongo_db()
    mdb["staff_accounts"].insert_one(dict(repo.doc_for("staff_accounts", staff)))
    return staff


@pytest.fixture
def admin_headers():
    """Legacy X-Admin-Token header (valid during the bootstrap window)."""
    return {"X-Admin-Token": os.environ["ADMIN_SECRET"]}


@pytest.fixture
def admin_staff(db):
    return _seed_staff(
        db,
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
        db,
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
        db,
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
        db,
        id="staff_faculty_pending",
        name="Pending Faculty",
        email="pending@test.local",
        role="faculty",
        module=None,
    )


@pytest.fixture
def pending_faculty_bearer_headers(pending_faculty_staff):
    return {"Authorization": f"Bearer {create_staff_jwt(pending_faculty_staff.id)}"}
