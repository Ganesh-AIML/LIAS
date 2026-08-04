"""Thin PyMongo repository layer for the LIAS MongoDB target.

One collection per logical entity (mirroring the PostgreSQL tables). This is
NOT an ODM and does NOT emulate the SQLAlchemy query API — it is a thin
durable-CRUD wrapper. Nothing in this module is used by the application yet;
it is the foundation the routes will consume during the migration swap (G2+).

ID strategy (parity with PostgreSQL):
    * SQL primary key -> Mongo `_id`.
    * application-generated string IDs are preserved verbatim as `_id`.
    * violation_logs has an auto-increment INTEGER PK; its value is preserved
      as an int `_id`.
    * the original column name is also kept on the document (e.g. `id`) so
      downstream reads stay source-agnostic and parity checks are trivial.

JSON-in-TEXT fields (submission_payload, subjective_payload, coding_marks,
subjective_marks, coding_evaluation, subjective_evaluation) are stored as
native BSON documents/arrays; null stays null.

Field mapping is schema-driven: `doc_for()` enumerates the SQLAlchemy model's
columns so a document can never silently omit (or misname) a field and never
diverges in ID/values from the row that produced it. Hand-maintained literal
dicts are forbidden for mirroring writes — always derive from the ORM row.
"""

import json
from contextlib import contextmanager

from app import models as _models
from app.database import get_mongo_client, get_mongo_db


# ── Source-agnostic read helpers ──────────────────────────────────────────────

def parse_json(raw):
    """Parse a JSON value that may be a string (SQL) or already a dict/list (Mongo).

    Returns {} for None/empty/falsy values and parse errors.
    """
    if not raw:
        return {}
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return {}


class _AttrDict:
    """Dict wrapper providing attribute access for source-agnostic reads.

    Allows downstream code to use ``doc.field`` instead of ``doc["field"]``,
    matching the ORM interface so callers don't need dict/attr branching.
    """

    __slots__ = ("_d",)

    def __init__(self, d):
        self._d = d

    def __getattr__(self, name):
        try:
            return self._d[name]
        except KeyError:
            raise AttributeError(name)

    def __getitem__(self, key):
        return self._d[key]

    def get(self, key, default=None):
        return self._d.get(key, default)

    def __contains__(self, key):
        return key in self._d

    def __repr__(self):
        return f"_AttrDict({self._d!r})"

# ── collection map: SQL logical table -> MongoDB document name ─────────────────
COLLECTIONS = {
    "students": "students",
    "token_registry": "token_registry",
    "staff_accounts": "staff_accounts",
    "exams": "exams",
    "exam_sessions": "exam_sessions",
    "faculty_evaluations": "faculty_evaluations",
    "violation_logs": "violation_logs",
    "questions": "questions",
    "coding_problems": "coding_problems",
    "test_cases": "test_cases",
    "subjective_questions": "subjective_questions",
    "sections": "sections",
}

# ── JSON-in-TEXT columns that become native BSON in MongoDB ───────────────────
JSON_DOC_FIELDS = {
    "exam_sessions": {
        "submission_payload",
        "subjective_payload",
        "coding_evaluation",
        "subjective_evaluation",
    },
    "faculty_evaluations": {
        "coding_marks",
        "subjective_marks",
    },
}

# logical table name -> SQLAlchemy model class (schema source for doc_for)
MODEL_BY_TABLE = {
    "students": _models.Student,
    "token_registry": _models.TokenRegistry,
    "staff_accounts": _models.StaffAccount,
    "exams": _models.Exam,
    "exam_sessions": _models.ExamSession,
    "faculty_evaluations": _models.FacultyEvaluation,
    "violation_logs": _models.ViolationLog,
    "questions": _models.Question,
    "coding_problems": _models.CodingProblem,
    "test_cases": _models.TestCase,
    "subjective_questions": _models.SubjectiveQuestion,
    "sections": _models.Section,
}


def enabled():
    """True when MONGO_URI is configured (does not force a connection)."""
    from app.database import MONGO_URI
    return bool(MONGO_URI)


def col(collection, mongo_db=None):
    """Resolve a logical table name to its PyMongo Collection."""
    if mongo_db is None:
        mongo_db = get_mongo_db()
    if mongo_db is None:
        raise RuntimeError("MongoDB is not configured (MONGO_URI is unset)")
    name = COLLECTIONS.get(collection)
    if name is None:
        raise KeyError(f"Unknown collection: {collection}")
    return mongo_db[name]


def _safe_decode(raw):
    """Decode a JSON-in-TEXT value into a native BSON structure."""
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return raw


def doc_for(table, row, *, include_id=True, fields=None):
    """Build a Mongo document from a SQLAlchemy row (or plain dict).

    Schema-driven: enumerates the model's column names so field names, nulls,
    JSON-in-TEXT decoding and the `_id` = PK invariant cannot drift from the
    source row. This is the ONLY sanctioned way to prepare a mirrored write.

    Args:
        table: logical table name (must exist in MODEL_BY_TABLE).
        row:   ORM instance or dict keyed by column names.
        include_id: when True, add `_id` = the PK value (for insert_one).
                   Pass False when the doc is used as an update ($set) target,
                   because `_id` is immutable in MongoDB.
        fields: restrict emission to this column subset (update-only optim).
    """
    model = MODEL_BY_TABLE.get(table)
    if model is None:
        raise KeyError(f"No model registered for table: {table}")

    if isinstance(row, dict):
        def get(name):
            return row.get(name)
    else:
        def get(name):
            return getattr(row, name)

    doc = {}
    for column in model.__table__.columns:
        name = column.name
        if fields is not None and name not in fields:
            continue
        doc[name] = get(name)

    for field in JSON_DOC_FIELDS.get(table, ()):
        raw = doc.get(field)
        if raw is None:
            continue
        doc[field] = _safe_decode(raw)

    if include_id and doc.get("id") is not None:
        doc["_id"] = doc["id"]
    return doc


def insert_one(collection, doc, mongo_db=None):
    """Insert a single document, preserving its provided _id."""
    return col(collection, mongo_db).insert_one(doc).inserted_id


def insert_many(collection, documents, mongo_db=None):
    """Insert many documents in one batch.

    ordered=False so a single conflicting id cannot abort the whole run;
    callers decide how to handle reported errors.
    """
    coll = col(collection, mongo_db)
    if not documents:
        return []
    return coll.insert_many(documents, ordered=False).inserted_ids


def find_one(collection, filters=None, sort=None, mongo_db=None):
    """First document matching filters, or None."""
    cur = col(collection, mongo_db).find(filters or {})
    if sort:
        cur = cur.sort(sort)
    try:
        return cur.next()
    except StopIteration:
        return None


def find(collection, filters=None, sort=None, projection=None, mongo_db=None):
    """Cursor of matching documents. Wrap in list() for materialization."""
    cur = col(collection, mongo_db).find(filters or {}, projection=projection)
    if sort:
        cur = cur.sort(sort)
    return cur


def find_all(collection, filters=None, sort=None, projection=None, mongo_db=None):
    """Materialized list of matching documents (small-fetch convenience)."""
    return list(find(collection, filters, sort=sort, projection=projection, mongo_db=mongo_db))


def count(collection, filters=None, mongo_db=None):
    """Count documents matching filters."""
    return col(collection, mongo_db).count_documents(filters or {})


def count_all(collection, mongo_db=None):
    """Total document count in a collection."""
    return count(collection, {}, mongo_db=mongo_db)


def update_one(collection, filters, values, upsert=False, mongo_db=None):
    """$set update on one document; returns (matched_count, modified_count)."""
    res = col(collection, mongo_db).update_one(filters, {"$set": values}, upsert=upsert)
    return res.matched_count, res.modified_count


def update_many(collection, filters, values, mongo_db=None):
    """$set update on all matching documents."""
    res = col(collection, mongo_db).update_many(filters, {"$set": values})
    return res.matched_count, res.modified_count


def find_one_and_update(
    collection,
    filters,
    update,
    upsert=False,
    return_document="after",
    mongo_db=None,
):
    """Atomic read-modify-write for a single document (e.g. the join lock).
    `update` is a raw Mongo update document ($set/$inc ...); `return_document`
    is 'after' or 'before'."""
    from pymongo import ReturnDocument

    rd = ReturnDocument.AFTER if return_document == "after" else ReturnDocument.BEFORE
    return col(collection, mongo_db).find_one_and_update(
        filters, update, upsert=upsert, return_document=rd
    )


def delete_one(collection, filters, mongo_db=None):
    """Delete the first document matching filters; returns deleted count."""
    return col(collection, mongo_db).delete_one(filters).deleted_count


def delete_many(collection, filters, mongo_db=None):
    """Delete all documents matching filters."""
    return col(collection, mongo_db).delete_many(filters).deleted_count


def distinct(collection, field, filters=None, mongo_db=None):
    """Distinct values of `field` over matching documents."""
    return col(collection, mongo_db).distinct(field, filters or {})


def aggregate(collection, pipeline, mongo_db=None):
    """Run an aggregation pipeline; walk the cursor if streaming needed."""
    return list(col(collection, mongo_db).aggregate(pipeline))


@contextmanager
def mongo_transaction():
    """Run a block of writes inside a real MongoDB transaction (replica set).

    Example:
        with mongo_transaction() as tx:
            tx.col("exam_sessions").update_many(
                {"id": session_id}, {"$set": {"is_revoked": True}}
            )
            tx.col("exam_sessions").insert_one(new_session)
        # commits on clean exit; rolls back on any exception.
    """
    client = get_mongo_client()
    if client is None:
        raise RuntimeError("MongoDB is not configured (MONGO_URI is unset)")
    with client.start_session() as session:
        with session.start_transaction():
            yield _TransactionScope(client[get_mongo_db().name], session)


class _TransactionScope:
    """Transaction-scoped view that threads the session through every call."""

    def __init__(self, db, session):
        self._db = db
        self._session = session

    def col(self, collection):
        return self._db[COLLECTIONS[collection]]

    def insert_one(self, collection, doc):
        return self.col(collection).insert_one(doc, session=self._session)

    def insert_many(self, collection, documents):
        return self.col(collection).insert_many(
            documents, ordered=False, session=self._session
        )

    def update_many(self, collection, filters, values):
        return self.col(collection).update_many(
            filters, {"$set": values}, session=self._session
        )

    def update_one(self, collection, filters, values, upsert=False):
        return self.col(collection).update_one(
            filters, {"$set": values}, upsert=upsert, session=self._session
        )

    def find_one(self, collection, filters):
        return self.col(collection).find_one(filters, session=self._session)

    def find_one_and_update(self, collection, filters, update, return_document="after"):
        from pymongo import ReturnDocument

        rd = ReturnDocument.AFTER if return_document == "after" else ReturnDocument.BEFORE
        return self.col(collection).find_one_and_update(
            filters, update, return_document=rd, session=self._session
        )

    def delete_many(self, collection, filters):
        return self.col(collection).delete_many(filters, session=self._session)