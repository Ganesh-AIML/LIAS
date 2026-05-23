import os
import secrets
import logging
import socketio
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.database import Base, engine
from app.routes import auth, exam

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scope")

Base.metadata.create_all(bind=engine)

# --- Allowed origins (extend for production domain) ---
ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173"
).split(",")]

# --- Admin secret: MUST be set via env var in production ---
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")
if not ADMIN_SECRET:
    logger.warning("ADMIN_SECRET env var is not set — admin routes are disabled.")

fastapi_app = FastAPI(title="S.C.O.P.E. Assessment Gateway", version="2.0.0")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

fastapi_app.include_router(auth.router, prefix="/auth", tags=["Auth"])
fastapi_app.include_router(exam.router, prefix="/exam", tags=["Exam"])

# --- Socket.IO: explicit origin whitelist, NOT wildcard ---
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=ALLOWED_ORIGINS
)

@sio.event
async def connect(sid, environ):
    # FIX: never log full sid or tokens — log a masked prefix only
    logger.info("[SOCKET] Client connected: %s", sid[:8] + "****")

@sio.event
async def disconnect(sid):
    logger.info("[SOCKET] Client disconnected: %s", sid[:8] + "****")

@sio.event
async def join_exam_room(sid, data):
    """
    FIX: Validate JWT before allowing room join.
    Client must send: { exam_id, token }
    """
    from app.auth import verify_socket_token  # inline import avoids circular dep

    exam_id = data.get("exam_id") if isinstance(data, dict) else data
    token   = data.get("token")   if isinstance(data, dict) else None

    session = verify_socket_token(token, exam_id)
    if not session:
        logger.warning("[SOCKET] Unauthorized room join attempt blocked.")
        await sio.disconnect(sid)
        return

    await sio.enter_room(sid, exam_id)
    logger.info("[SOCKET] Verified client joined room: %s", exam_id[:8] + "****")

@fastapi_app.post("/admin/exam/{exam_id}/update-time", tags=["Admin Controls"])
async def update_exam_time(
    exam_id: str,
    new_duration: int,
    coding_duration: int = None,
    x_admin_token: str = Header(None)
):
    # FIX: env-var secret + constant-time comparison (prevents timing attacks)
    if not ADMIN_SECRET or not x_admin_token:
        raise HTTPException(status_code=403, detail="Unauthorized")

    if not secrets.compare_digest(x_admin_token, ADMIN_SECRET):
        raise HTTPException(status_code=403, detail="Unauthorized")

    payload = {
        "duration": new_duration,
        "codingDuration": coding_duration or new_duration
    }
    await sio.emit('exam_time_synced', payload, room=exam_id)
    return {"success": True}

app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)