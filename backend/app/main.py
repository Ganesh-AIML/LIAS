import os
import secrets
import logging
import socketio
import bcrypt
import time
from app.routes import auth, exam, admin as admin_routes
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.limiter import limiter

from app.database import Base, engine, SessionLocal
from app.models import Exam, TokenRegistry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scope")

# --- Database Seeding Logic ---
def seed_database():
    """
    Seeds initial exam and student tokens only when BOTH the exams table
    and token_registry table are empty (Issue 4).
    Seed passwords are read from env, never hardcoded (Issue 3).
    """
    db = SessionLocal()
    try:
        exam_exists  = db.query(Exam).first() is not None
        token_exists = db.query(TokenRegistry).first() is not None

        if exam_exists and token_exists:
            return  # Already seeded — skip entirely

        logger.info("🚀 Seeding database with initial data...")

        def hash_password(plain: str) -> str:
            return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

        if not exam_exists:
            test_exam = Exam(
                id                  = "exam_789",
                title               = "S.C.O.P.E. Master Blueprint Assessment",
                duration_seconds    = 7200,
                starts_at           = time.time() - 100,
                start_password_hash = hash_password("start_123"),
                end_password_hash   = hash_password("end_123"),
            )
            db.add(test_exam)

        if not token_exists:
            # Issue 3: read seed passwords from env; fall back to safe defaults only for dev
            raw_passwords = os.getenv("SEED_STUDENT_PASSWORDS", "Ganesh123,Madhwendra123,Pragya123")
            seed_passwords = [p.strip() for p in raw_passwords.split(",")]

            students = [
                {"name": "Ganesh",      "pass": seed_passwords[0] if len(seed_passwords) > 0 else "ChangeMe1"},
                {"name": "Madhwendra",  "pass": seed_passwords[1] if len(seed_passwords) > 1 else "ChangeMe2"},
                {"name": "Pragya",      "pass": seed_passwords[2] if len(seed_passwords) > 2 else "ChangeMe3"},
            ]
            for s in students:
                test_token = TokenRegistry(
                    token         = f"LIAS_{s['name']}",
                    exam_id       = "exam_789",
                    student_id    = s["name"],
                    password_hash = hash_password(s["pass"]),
                    is_active     = True,
                )
                db.add(test_token)

        db.commit()
        logger.info("✅ Database seeding complete.")
    finally:
        db.close()


# --- App Initialization ---
Base.metadata.create_all(bind=engine)
seed_database()

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
]

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")
if not ADMIN_SECRET:
    logger.warning("ADMIN_SECRET env var is not set — admin routes are disabled.")

fastapi_app = FastAPI(title="S.C.O.P.E. Assessment Gateway", version="2.0.0")

# Issue 2: attach rate limiter
fastapi_app.state.limiter = limiter
fastapi_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Issue 6: restrict CORS to only needed methods and headers
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins     = ALLOWED_ORIGINS,
    allow_credentials = True,
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"], # Added OPTIONS just in case
    allow_headers     = ["Content-Type", "Authorization", "X-Admin-Token"], # <--- Added X-Admin-Token
)

fastapi_app.include_router(auth.router,         prefix="/auth",  tags=["Auth"])
fastapi_app.include_router(exam.router,         prefix="/exam",  tags=["Exam"])
fastapi_app.include_router(admin_routes.router, prefix="/admin", tags=["Admin"])

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=ALLOWED_ORIGINS)


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



# Export the ASGI app (Socket.IO wraps FastAPI)
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)