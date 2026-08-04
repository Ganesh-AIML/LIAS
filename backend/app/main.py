import os
import time
import uuid
import logging
import socketio
from app.routes import auth, exam, admin as admin_routes, evaluate as evaluate_routes, staff_auth as staff_auth_routes
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.limiter import limiter
from contextlib import asynccontextmanager
from app.database import get_mongo_db
from app.mongo_indexes import ensure_mongo_indexes
from app import repositories as repo

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scope")


@asynccontextmanager
async def lifespan(app):
    mdb = get_mongo_db()
    if mdb is not None:
        # Idempotent: safe on every boot; creates missing unique/lookup indexes.
        try:
            ensure_mongo_indexes(mdb)
        except Exception as e:
            logger.warning("Mongo index initialization skipped: %s", e)
    _seed_admin_if_needed()
    yield

fastapi_app = FastAPI(title="S.C.O.P.E. Assessment Gateway", version="2.0.0", lifespan=lifespan)

fastapi_app.state.limiter = limiter
fastapi_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins     = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials = True,
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers     = ["Content-Type", "Authorization", "X-Admin-Token"],
)

fastapi_app.include_router(auth.router,          prefix="/auth",   tags=["Auth"])
fastapi_app.include_router(exam.router,          prefix="/exam",   tags=["Exam"])
fastapi_app.include_router(admin_routes.router,  prefix="/admin",  tags=["Admin"])
fastapi_app.include_router(evaluate_routes.router, prefix="/admin", tags=["Admin"])
fastapi_app.include_router(staff_auth_routes.router, prefix="/admin", tags=["Admin"])

def _seed_admin_if_needed():
    """Seed the first admin account from ADMIN_EMAIL/ADMIN_PASSWORD env vars.

    Runs ONLY when zero admin accounts exist in staff_accounts — otherwise the
    seed is skipped entirely. Until this seed runs, the legacy X-Admin-Token
    (ADMIN_SECRET) bootstrap window stays open in verify_admin, so an existing
    deploy can never lock itself out.
    """
    admin_email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    admin_password = os.getenv("ADMIN_PASSWORD", "")
    if not admin_email or not admin_password:
        return
    mdb = get_mongo_db()
    if mdb is None:
        return
    existing = repo.col("staff_accounts").count_documents({"role": "admin"})
    if existing and int(existing) > 0:
        return
    import bcrypt as _bcrypt
    password_hash = _bcrypt.hashpw(
        admin_password.encode("utf-8"), _bcrypt.gensalt(rounds=12)
    ).decode("utf-8")
    staff_id = f"staff_{uuid.uuid4().hex[:8]}"
    created_at = time.time()
    mdb["staff_accounts"].insert_one({
        "_id": staff_id,
        "id": staff_id,
        "email": admin_email,
        "password_hash": password_hash,
        "role": "admin",
        "module": None,
        "created_at": created_at,
    })
    logger.info("Seeded admin account for %s", admin_email)


sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(","))

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
