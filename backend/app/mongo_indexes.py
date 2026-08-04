"""MongoDB index definitions for the LIAS runtime datastore.

Invoked idempotently on every startup (FastAPI lifespan, see app/main.py):
create_index is a no-op when the index already exists, and unique
constraints are enforced only on insert. Every index below is justified by an
existing route query; nothing is added blindly.
"""

# name -> (keys, kwargs). Recreates the unique constraints and lookup indexes
# required by the route queries.
MONGO_INDEXES = {
    "token_registry": [
        ("uq_token_student_exam", [("student_id", 1), ("exam_id", 1)], True),
        ("ix_token_registry_exam_id", [("exam_id", 1)], False),
    ],
    "staff_accounts": [
        ("uq_staff_email", [("email", 1)], True),
    ],
    "faculty_evaluations": [
        ("uq_faculty_eval_session_faculty", [("session_id", 1), ("faculty_id", 1)], True),
        ("ix_faculty_evaluations_faculty_id", [("faculty_id", 1)], False),
        ("ix_faculty_evaluations_session_id", [("session_id", 1)], False),
    ],
    "exam_sessions": [
        ("ix_exam_sessions_lookup", [("student_id", 1), ("exam_id", 1), ("is_revoked", 1)], False),
        ("ix_exam_sessions_exam_id", [("exam_id", 1)], False),
    ],
    "violation_logs": [
        ("ix_violation_logs_session_id", [("session_id", 1)], False),
        ("ix_violation_logs_student_id", [("student_id", 1)], False),
        ("ix_violation_logs_exam_id", [("exam_id", 1)], False),
    ],
    "questions": [
        ("ix_questions_exam_id", [("exam_id", 1)], False),
    ],
    "subjective_questions": [
        ("ix_subjective_questions_exam_id", [("exam_id", 1)], False),
    ],
    "coding_problems": [
        ("ix_coding_problems_exam_id", [("exam_id", 1)], False),
    ],
    "test_cases": [
        ("ix_test_cases_problem_id", [("problem_id", 1)], False),
    ],
    "sections": [
        ("ix_sections_exam_id", [("exam_id", 1)], False),
    ],
}


def ensure_mongo_indexes(mongo_db):
    """Create the indexes defined above on each target collection.

    Idempotent: PyMongo create_index is a no-op with a warning when the
    index already exists, and unique constraints are enforced only on insert.
    """
    if mongo_db is None:
        return
    for collection, specs in MONGO_INDEXES.items():
        coll = mongo_db[collection]
        for name, keys, unique in specs:
            coll.create_index(keys, unique=unique, name=name)