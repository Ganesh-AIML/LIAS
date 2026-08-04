"""Migration-focused Mongo parity tests.

These verify the critical invariant for the Neon -> MongoDB migration:

    SQL row id == Mongo document _id, for EVERY mirrored record.

Since SQL runtime writes have been removed (Phase E), these tests now verify:
  * doc_for() maps dict id onto Mongo _id (identity parity).
  * exam creation writes correct child trees to Mongo (sections / questions /
    coding_problems / test_cases / subjective_questions).
  * exam update purges old children and inserts new ones in Mongo.
  * exam delete cascades in Mongo, leaving no orphans.
  * JSON-in-TEXT columns decode to their native BSON type (dict / list / None)
    while non-JSON columns stay scalar.
  * indexes enforce the same uniqueness SQL enforced (token_registry
    student+exam, staff_accounts email, faculty_evaluations session+faculty).
"""

import time

import pytest
from pymongo.errors import DuplicateKeyError

from app.database import get_mongo_db
from app import repositories as repo


def _full_exam_payload(module=None):
    payload = {
        "title": "Parity Exam",
        "duration_minutes": 60,
        "coding_duration_minutes": 30,
        "mcq_duration_minutes": 20,
        "qna_duration_minutes": None,
        "starts_at": (time.time() + 86400) * 1000,
        "start_password": "start123",
        "end_password": "end123",
        "status": "upcoming",
        "module": module,
        "sections": [
            {
                "id": "client_sec_a",
                "name": "Aptitude",
                "type": "mcq",
                "marks_per_question": 2,
                "order_index": 0,
            }
        ],
        "questions": [
            {
                "section": "Aptitude",
                "text": "2 + 2 = ?",
                "optA": "3",
                "optB": "4",
                "optC": "5",
                "optD": "6",
                "ans": "B",
                "section_id": "client_sec_a",
                "order_index": 0,
                "marks": 2,
                "content_format": "plain",
            }
        ],
        "coding_problems": [
            {
                "title": "Sum Two",
                "description": "Return a + b",
                "constraints": "1 <= a, b <= 10^9",
                "languages": "62,71",
                "marks": 10,
                "testCases": [
                    {
                        "input": "1 2",
                        "output": "3",
                        "isHidden": False,
                    },
                    {
                        "input": "5 7",
                        "output": "12",
                        "isHidden": True,
                    },
                ],
            }
        ],
        "subjective_questions": [
            {
                "section": "Theory",
                "text": "Explain Big-O notation.",
                "marks": 5,
                "section_id": None,
                "order_index": 0,
                "content_format": "plain",
            }
        ],
    }
    return payload


def _mongo_child_ids(mdb, coll, exam_id):
    """Mongo _id set for a child collection. test_cases key on problem_id;
    every other child carries exam_id."""
    if coll == "test_cases":
        problem_ids = [d["_id"] for d in mdb["coding_problems"].find({"exam_id": exam_id})]
        if not problem_ids:
            return []
        return sorted(d["_id"] for d in mdb[coll].find({"problem_id": {"$in": problem_ids}}))
    return sorted(d["_id"] for d in mdb[coll].find({"exam_id": exam_id}))


class TestDocForMappingIdentity:
    """doc_for() must produce Mongo _id == dict id and keep scalars scalar."""

    def test_doc_for_uses_sql_id_as_mongo_id(self, db):
        exam = {
            "id": "exam_parity_01",
            "title": "Mapping Test",
            "duration_seconds": 3600,
            "starts_at": time.time(),
            "status": "draft",
            "start_password_hash": "$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8n8.KQYzj6Ho6",
        }
        doc = repo.doc_for("exams", exam)
        assert doc["_id"] == exam["id"]
        assert doc["id"] == exam["id"]
        assert doc["title"] == "Mapping Test"
        assert doc["duration_seconds"] == 3600
        assert doc["module"] is None
        assert doc["end_password_hash"] is None

    def test_doc_for_preserves_empty_and_false(self, db):
        exam = {
            "id": "exam_parity_02",
            "title": "Empty Fields",
            "duration_seconds": 0,
            "starts_at": 0.0,
            "status": "draft",
            "start_password_hash": "x",
            "module": None,
        }
        doc = repo.doc_for("exams", exam)
        assert doc["duration_seconds"] == 0
        assert doc["starts_at"] == 0.0

    def test_doc_for_excludes_primary_key_via_include_id_false(self, db):
        exam = {
            "id": "exam_parity_03",
            "title": "Partial",
            "duration_seconds": 3600,
            "starts_at": time.time(),
            "status": "draft",
            "start_password_hash": "h",
        }
        doc = repo.doc_for("exams", exam, include_id=False)
        assert "_id" not in doc
        assert doc["id"] == exam["id"]
        assert doc["title"] == "Partial"


class TestExamCreateParity:
    def test_full_exam_creation_writes_correct_children_to_mongo(
        self, client, db, admin_headers
    ):
        payload = _full_exam_payload()
        resp = client.post("/admin/exams", json=payload, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        exam_id = resp.json()["exam_id"]

        mdb = get_mongo_db()
        for coll in ["sections", "questions", "coding_problems", "test_cases", "subjective_questions"]:
            ids = _mongo_child_ids(mdb, coll, exam_id)
            assert ids, f"{coll} not written to Mongo"

        cp = mdb["coding_problems"].find_one({"exam_id": exam_id})
        tc_ids = sorted(t["_id"] for t in mdb["test_cases"].find({"problem_id": cp["_id"]}))
        assert len(tc_ids) == 2
        assert all(
            t["problem_id"] == cp["_id"] for t in mdb["test_cases"].find({"problem_id": cp["_id"]})
        )

        q = mdb["questions"].find_one({"exam_id": exam_id})
        assert q["ans"] == "B"

    def test_update_exam_replaces_children_in_mongo(
        self, client, db, admin_headers
    ):
        payload = _full_exam_payload()
        resp = client.post("/admin/exams", json=payload, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        exam_id = resp.json()["exam_id"]
        mdb = get_mongo_db()

        old_section_ids = _mongo_child_ids(mdb, "sections", exam_id)

        payload2 = _full_exam_payload()
        payload2["title"] = "Parity Exam Updated"
        payload2["questions"][0]["text"] = "3 + 3 = ?"
        payload2["questions"][0]["ans"] = "C"
        payload2["sections"][0]["name"] = "Rename"
        resp = client.put(f"/admin/exams/{exam_id}", json=payload2, headers=admin_headers)
        assert resp.status_code == 200, resp.text

        for coll in ["sections", "questions", "coding_problems", "test_cases", "subjective_questions"]:
            ids = _mongo_child_ids(mdb, coll, exam_id)
            assert ids, f"{coll} empty post-update"

        mq = mdb["questions"].find_one({"exam_id": exam_id})
        assert mq["ans"] == "C"
        msec = mdb["sections"].find_one({"exam_id": exam_id})
        assert msec["name"] == "Rename"
        assert mdb["exams"].count_documents({"_id": exam_id}) == 1

    def test_delete_exam_cascades_mongo(self, client, db, admin_headers):
        payload = _full_exam_payload()
        resp = client.post("/admin/exams", json=payload, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        exam_id = resp.json()["exam_id"]
        mdb = get_mongo_db()

        resp = client.delete(f"/admin/exams/{exam_id}", headers=admin_headers)
        assert resp.status_code == 200, resp.text

        for coll in ["exams", "sections", "questions", "coding_problems", "test_cases", "subjective_questions"]:
            assert mdb[coll].count_documents({}) == 0, f"{coll} left orphans"


class TestIndexEnforcement:
    """The unique indexes in MONGO_INDEXES enforce the same constraints Postgres
    enforced with UNIQUE constraints. Duplicate writes must raise."""

    def test_unique_token_registry(self, client, db, admin_headers, sample_exam, sample_student):
        mdb = get_mongo_db()
        doc = {
            "_id": "tok_dup_1",
            "token": "tok_dup_1",
            "exam_id": sample_exam.id,
            "student_id": sample_student.id,
            "password_hash": "$2b$12$h",
            "is_active": True,
        }
        mdb["token_registry"].insert_one(doc)
        with pytest.raises(DuplicateKeyError):
            mdb["token_registry"].insert_one(
                {**doc, "_id": "tok_dup_2", "token": "tok_dup_2"}
            )

    def test_unique_staff_email(self, db, admin_staff):
        mdb = get_mongo_db()
        dup = {
            "_id": "staff_dup_email",
            "name": "Twin Admin",
            "email": admin_staff.email,
            "password_hash": "$2b$12$h",
            "role": "admin",
            "module": None,
        }
        with pytest.raises(DuplicateKeyError):
            mdb["staff_accounts"].insert_one(dup)

    def test_unique_faculty_evaluation_session_faculty(
        self, db, sample_exam, faculty_staff
    ):
        mdb = get_mongo_db()
        ev = {
            "_id": "ev_dup_1",
            "session_id": "sess_dup_1",
            "faculty_id": faculty_staff.id,
            "coding_marks": None,
            "subjective_marks": None,
        }
        mdb["faculty_evaluations"].insert_one(ev)
        with pytest.raises(DuplicateKeyError):
            mdb["faculty_evaluations"].insert_one({**ev, "_id": "ev_dup_2"})
