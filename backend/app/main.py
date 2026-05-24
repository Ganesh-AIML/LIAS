import os
import secrets
import logging
import socketio
import bcrypt
import time
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.database import Base, engine, SessionLocal
from app.models import Exam, TokenRegistry
from app.routes import auth, exam

# --- Database Seeding Logic ---
def seed_database():
    db = SessionLocal()
    # Check if exam already exists
    if db.query(Exam).first() is None:
        logger.info("🚀 Seeding database with initial data...")
        
        # Helper to hash passwords directly using bcrypt
        def hash_password(plain: str) -> str:
            return bcrypt.hashpw(plain.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        # Create Exam
        test_exam = Exam(
            id="exam_789",
            title="S.C.O.P.E. Master Blueprint Assessment",
            duration_seconds=7200,
            starts_at=time.time() - 100,
            end_password_hash=hash_password("end")
        )
        db.add(test_exam)

        # Create Students
        students = [
            {"name": "Ganesh", "pass": "Ganesh123"},
            {"name": "Madhwendra", "pass": "Madhwendra123"},
            {"name": "Pragya", "pass": "Pragya123"}
        ]
        for s in students:
            test_token = TokenRegistry(
                token         = f"LIAS_{s['name']}",
                exam_id       = "exam_789",
                student_id    = s["name"],
                password_hash = hash_password(s["pass"]),
                is_active     = True
            )
            db.add(test_token)
        
        db.commit()
        logger.info("✅ Database seeding complete.")
    db.close()

# --- Initialization ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scope")

Base.metadata.create_all(bind=engine)
seed_database() # Execute the auto-seed

# --- Configuration ---
ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173"
).split(",")]

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

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins=ALLOWED_ORIGINS)

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

@fastapi_app.post("/admin/exam/{exam_id}/update-time", tags=["Admin Controls"])
async def update_exam_time(exam_id: str, new_duration: int, x_admin_token: str = Header(None)):
    if not ADMIN_SECRET or not x_admin_token or not secrets.compare_digest(x_admin_token, ADMIN_SECRET):
        raise HTTPException(status_code=403, detail="Unauthorized")
    await sio.emit('exam_time_synced', {"duration": new_duration}, room=exam_id)
    return {"success": True}

app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)