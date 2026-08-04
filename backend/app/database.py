import os
from dotenv import load_dotenv

load_dotenv()

# ── MongoDB (authoritative runtime datastore) ─────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "lias")

_mongo_client = None
_mongo_db = None


def get_mongo_client():
    """Lazily build the shared PyMongo client and expose it module-wide."""
    global _mongo_client
    if not MONGO_URI:
        return None
    if _mongo_client is None:
        import pymongo
        _mongo_client = pymongo.MongoClient(
            MONGO_URI,
            serverSelectionTimeoutMS=8000,
        )
    return _mongo_client


def get_mongo_db():
    """Return the Mongo database handle for the configured target database."""
    global _mongo_db
    client = get_mongo_client()
    if client is None:
        return None
    if _mongo_db is None:
        _mongo_db = client[MONGO_DB_NAME]
    return _mongo_db


# ── SQLAlchemy (test-only / one-time migration) ───────────────────────────────
# Production no longer requires DATABASE_URL. The engine and session are created
# only when the env var is present (tests set it to a temp SQLite path).
# Base is always created so model class definitions work (column metadata for
# repositories.doc_for()).
from sqlalchemy.orm import declarative_base

Base = declarative_base()

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine_kwargs = {}
    if not DATABASE_URL.startswith("sqlite"):
        engine_kwargs.update(
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=2,
            pool_recycle=1800,
        )
    engine = create_engine(DATABASE_URL, **engine_kwargs)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()
else:
    engine = None
    SessionLocal = None

    def get_db():
        raise RuntimeError(
            "SQL database is not configured. Set DATABASE_URL for test environments."
        )
