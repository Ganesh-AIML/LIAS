import re
import time
import uuid
import bcrypt
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import StaffAccount
from app.auth import create_staff_jwt
from app.limiter import limiter

router = APIRouter()
logger = logging.getLogger("scope")

# No email-validator dependency in this repo — validated with a regex.
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


# ── SCHEMAS ─────────────────────────────────────────────────────────────────

class StaffLoginPayload(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_valid(cls, v):
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Invalid email address.")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if not v or len(v) > 256:
            raise ValueError("Invalid password length.")
        return v


class StaffRegisterPayload(StaffLoginPayload):
    name: str

    @field_validator("name")
    @classmethod
    def name_valid(cls, v):
        if not v or not v.strip():
            raise ValueError("Name cannot be empty.")
        if len(v) > 200:
            raise ValueError("Name too long (max 200 characters).")
        return v.strip()

    @field_validator("password")
    @classmethod
    def register_password(cls, v):
        if len(v) < 4:
            raise ValueError("Password must be at least 4 characters.")
        if len(v) > 256:
            raise ValueError("Password too long (max 256 characters).")
        return v


class ModuleAssignPayload(BaseModel):
    module: Optional[str] = None

    @field_validator("module")
    @classmethod
    def module_valid(cls, v):
        if v is None:
            return v
        v = v.strip()
        if len(v) > 100:
            raise ValueError("Module name too long (max 100 characters).")
        return v or None


# ── HELPERS ─────────────────────────────────────────────────────────────────

def _staff_response(staff: StaffAccount) -> dict:
    return {
        "success": True,
        "token": create_staff_jwt(staff.id),
        "staff": {
            "id": staff.id,
            "name": staff.name,
            "email": staff.email,
            "role": staff.role,
            "module": staff.module,
        },
    }


def _generic_401() -> None:
    # Generic message for unknown email AND wrong password — no enumeration.
    raise HTTPException(status_code=401, detail="Invalid email or password.")


def _find_by_email(db: Session, email: str) -> Optional[StaffAccount]:
    return (
        db.query(StaffAccount)
        .filter(StaffAccount.email == email.strip().lower())
        .first()
    )


# ── AUTH ENDPOINTS (mounted at /admin/auth/*) ───────────────────────────────

@router.post("/auth/login")
@limiter.limit("10/minute")
def staff_login(request: Request, payload: StaffLoginPayload, db: Session = Depends(get_db)):
    """Login for ADMIN accounts (role='admin')."""
    staff = _find_by_email(db, payload.email)
    if not staff or not bcrypt.checkpw(payload.password.encode("utf-8"), staff.password_hash.encode("utf-8")):
        _generic_401()
    if staff.role != "admin":
        _generic_401()
    return _staff_response(staff)


@router.post("/auth/faculty-login")
@limiter.limit("10/minute")
def faculty_login(request: Request, payload: StaffLoginPayload, db: Session = Depends(get_db)):
    """Login for FACULTY accounts (role='faculty')."""
    staff = _find_by_email(db, payload.email)
    if not staff or not bcrypt.checkpw(payload.password.encode("utf-8"), staff.password_hash.encode("utf-8")):
        _generic_401()
    if staff.role != "faculty":
        _generic_401()
    return _staff_response(staff)


@router.post("/auth/register")
@limiter.limit("10/minute")
def faculty_register(request: Request, payload: StaffRegisterPayload, db: Session = Depends(get_db)):
    """Public self-registration for faculty.

    Deliberately does NOT accept a module — faculty accounts are created in the
    pending state (module=NULL) and an admin assigns the module later.
    """
    if _find_by_email(db, payload.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    password_hash = bcrypt.hashpw(payload.password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    staff = StaffAccount(
        id=f"staff_{uuid.uuid4().hex[:8]}",
        name=payload.name,
        email=payload.email.strip().lower(),
        password_hash=password_hash,
        role="faculty",
        module=None,
        created_at=time.time(),
    )
    db.add(staff)
    db.commit()
    # No auto-login: faculty must sign in through the faculty login flow.
    return {"success": True, "message": "Account created. Please log in."}
