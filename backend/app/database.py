import os
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("scope")

# MongoDB (authoritative runtime datastore)
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
            maxPoolSize=50,
            minPoolSize=5,
            retryWrites=True,
            appname="lias-backend",
        )
        logger.info("MongoDB client created for %s (db=%s)", MONGO_URI.split("@")[-1][:40], MONGO_DB_NAME)
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
