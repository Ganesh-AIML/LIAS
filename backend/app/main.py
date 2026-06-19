import os
import logging
import socketio
import time
from app.routes import auth, exam, admin as admin_routes
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.limiter import limiter
from contextlib import asynccontextmanager
from sqlalchemy import text
from app.database import engine, Base, SessionLocal
from app.models import Exam, TokenRegistry, ExamSession, ViolationLog, Question, CodingProblem, TestCase, SubjectiveQuestion, Student

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scope")


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        try:
            db.execute(text("ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS is_revoked BOOLEAN DEFAULT FALSE;"))
            db.execute(text("ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS submission_payload TEXT;"))
            db.execute(text("ALTER TABLE token_registry ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;"))
            db.execute(text("ALTER TABLE exams ADD COLUMN IF NOT EXISTS start_secret VARCHAR;"))
            db.execute(text("ALTER TABLE exams ADD COLUMN IF NOT EXISTS end_secret VARCHAR;"))
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS sections (
                    id VARCHAR PRIMARY KEY,
                    exam_id VARCHAR NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
                    name VARCHAR NOT NULL,
                    type VARCHAR NOT NULL DEFAULT 'mcq',
                    marks_per_question INTEGER DEFAULT 1,
                    order_index INTEGER DEFAULT 0
                );
            """))
            db.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS section_id VARCHAR;"))
            db.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;"))
            db.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS marks INTEGER DEFAULT 1;"))
            db.execute(text("ALTER TABLE questions ADD COLUMN IF NOT EXISTS content_format VARCHAR DEFAULT 'plain';"))
            db.execute(text("ALTER TABLE subjective_questions ADD COLUMN IF NOT EXISTS section_id VARCHAR;"))
            db.execute(text("ALTER TABLE subjective_questions ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;"))
            db.execute(text("ALTER TABLE subjective_questions ADD COLUMN IF NOT EXISTS content_format VARCHAR DEFAULT 'plain';"))
            db.commit()
        except Exception:
            db.rollback()
    yield

fastapi_app = FastAPI(title="S.C.O.P.E. Assessment Gateway", version="2.0.0", lifespan=lifespan)

fastapi_app.state.limiter = limiter
fastapi_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins     = os.getenv("ALLOWED_ORIGINS", "").split(","),
    allow_credentials = True,
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers     = ["Content-Type", "Authorization", "X-Admin-Token"],
)

fastapi_app.include_router(auth.router,         prefix="/auth",  tags=["Auth"])
fastapi_app.include_router(exam.router,         prefix="/exam",  tags=["Exam"])
fastapi_app.include_router(admin_routes.router, prefix="/admin", tags=["Admin"])

# ── ROOT FIX: Create tables synchronously on module load ──
logger.info("🚀 Initializing S.C.O.P.E. Database Tables...")
Base.metadata.create_all(bind=engine)
def _run_additive_migrations():
    with SessionLocal() as db:
        from sqlalchemy import text
        try:
            db.execute(text("ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS subjective_payload TEXT;"))
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning("Migration skipped: %s", e)

        # ── MASTER DIRECTORY: create students table if it doesn't exist ──
        try:
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS students (
                    id         VARCHAR PRIMARY KEY,
                    name       VARCHAR,
                    password   VARCHAR NOT NULL DEFAULT '',
                    is_active  BOOLEAN DEFAULT TRUE,
                    created_at FLOAT DEFAULT EXTRACT(EPOCH FROM NOW())
                );
            """))
            db.commit()
            logger.info("✅ students table ready.")
        except Exception as e:
            db.rollback()
            logger.warning("students table migration skipped: %s", e)

        # ── BACKFILL: seed students from existing TokenRegistry unique student_ids ──
        # Only inserts rows that don't already exist. Password left empty (placeholder).
        # Admin should set real passwords via Master Directory UI.
        try:
            db.execute(text("""
                INSERT INTO students (id, name, password, is_active, created_at)
                SELECT DISTINCT
                    tr.student_id,
                    NULL,
                    '',
                    TRUE,
                    EXTRACT(EPOCH FROM NOW())
                FROM token_registry tr
                WHERE tr.student_id IS NOT NULL
                  AND tr.student_id <> ''
                  AND NOT EXISTS (
                      SELECT 1 FROM students s WHERE s.id = tr.student_id
                  );
            """))
            db.commit()
            logger.info("✅ students backfill complete.")
        except Exception as e:
            db.rollback()
            logger.warning("students backfill skipped: %s", e)

_run_additive_migrations()
# ──────────────────────────────────────────────────────────

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=os.getenv("ALLOWED_ORIGINS", "").split(","))

@sio.event
async def connect(sid, environ):
    logger.info("[SOCKET] Client connected: %s", sid[:8] + "****")

@sio.event
async def join_exam_room(sid, data):
    from app.auth import verify_socket_token

    exam_id = data.get("exam_id") if isinstance(data, dict) else data
    token   = data.get("token")   if isinstance(data, dict) else None
    
    session = verify_socket_token(token, exam_id)
    if not session:
        await sio.disconnect(sid)
        return
    await sio.enter_room(sid, exam_id)

# ── IMPORTANT: Define 'app' for Uvicorn/Render to target ──
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)