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

# ... (keep your existing imports and configuration at the top) ...

from app.database import Base, engine, SessionLocal
# CRITICAL FIX: Explicitly import ALL models so metadata knows about them
from app.models import Exam, TokenRegistry, ExamSession, ViolationLog 

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scope")

fastapi_app = FastAPI(title="S.C.O.P.E. Assessment Gateway", version="2.0.0")

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