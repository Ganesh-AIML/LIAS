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

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.main import fastapi_app
from app.models import Student, TokenRegistry, Exam, ExamSession
from app.limiter import limiter

TEST_DATABASE_URL = f"sqlite:///{_db_path}"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


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
    return token
