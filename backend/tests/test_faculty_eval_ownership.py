"""Faculty-owned Coding & Subjective evaluation ownership tests.

Matrix cover (spec §23):
  * faculty ownership isolation (create / read / update / cross-faculty block)
  * module security (same-module independent, cross-module blocked)
  * pending / partial evaluation states
  * admin visibility + context switching + default selection
  * legacy (ownerless) context visibility rules
  * integrity: duplicate saves upsert, spoofing rejected, reassignment preserved
"""

import json
import time
import bcrypt
import pytest

from app.models import (
    Exam,
    ExamSession,
    Question,
    CodingProblem,
    SubjectiveQuestion,
    StaffAccount,
)
from app.database import get_mongo_db
from app.auth import create_staff_jwt
from app import repositories as repo


def _mongo_mirror(orm_obj):
    """Mirror any ORM object to its Mongo collection."""
    coll = {
        Exam: "exams", Question: "questions", CodingProblem: "coding_problems",
        SubjectiveQuestion: "subjective_questions", ExamSession: "exam_sessions",
        StaffAccount: "staff_accounts",
    }.get(type(orm_obj))
    if coll:
        get_mongo_db()[coll].insert_one(dict(repo.doc_for(coll, orm_obj)))


def _mongo_staff(row):
    """Mirror a SQLAlchemy-created staff account into the Mongo test DB, so
    the migrated verify_admin (which reads staff from Mongo) can resolve it."""
    get_mongo_db()["staff_accounts"].insert_one(dict(repo.doc_for("staff_accounts", row)))


def _exam(db, eid="exam_owner_001", module="MAS701"):
    exam = Exam(
        id=eid, title="Owner Exam", duration_seconds=3600,
        starts_at=int((time.time() + 86400) * 1000),
        status="upcoming",
        start_password_hash="$2b$12$YY/SvvxBjbVOAtDT5i1JkefkOvoxgH2aoL5kIhUf8nU.KQYzj6Ho6",
        module=module,
    )
    db.add(exam)
    db.commit()
    get_mongo_db()["exams"].insert_one(dict(repo.doc_for("exams", exam)))
    return exam


def _session(db, exam, sid="sess_owner_1", student_id="23-TEST-01"):
    s = ExamSession(
        id=sid, student_id=student_id, exam_id=exam.id,
        session_secret="secret", is_submitted=True,
        submission_payload=json.dumps({"mcqs": {}, "coding": {}}),
    )
    db.add(s)
    db.commit()
    get_mongo_db()["exam_sessions"].insert_one(dict(repo.doc_for("exam_sessions", s)))
    return s


def _staff(db, sid, module="MAS701"):
    row = StaffAccount(
        id=sid, name=sid, email=f"{sid}@test.local",
        password_hash=bcrypt.hashpw(b"test1234", bcrypt.gensalt(rounds=12)).decode("utf-8"),
        role="faculty", module=module,
    )
    db.add(row)
    db.commit()
    _mongo_staff(row)
    return {"id": row.id, "headers": {"Authorization": f"Bearer {create_staff_jwt(row.id)}"}}


def _eval_count(_db, session_id, faculty_id):
    return get_mongo_db()["faculty_evaluations"].count_documents({
        "session_id": session_id,
        "faculty_id": faculty_id,
    })


class TestFacultyOwnershipIsolation:
    def test_faculty_creates_reads_updates_own_coding(self, client, db, faculty_bearer_headers):
        exam = _exam(db)
        cp = CodingProblem(id="cp_a1", exam_id=exam.id, title="P", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        s = _session(db, exam)

        save1 = client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"cp_a1": 30}}, headers=faculty_bearer_headers,
        )
        assert save1.json()["data"]["coding_marks"] == {"cp_a1": 30.0}

        save2 = client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"cp_a1": 32}}, headers=faculty_bearer_headers,
        )
        assert save2.json()["data"]["coding_marks"] == {"cp_a1": 32.0}

        # repeated saves -> ONE owned row (no duplicates)
        assert _eval_count(db, s.id, "staff_faculty_test") == 1

        list_resp = client.get(f"/admin/exams/{exam.id}/evaluate", headers=faculty_bearer_headers)
        assert list_resp.json()["data"][0]["current_coding_marks"] == {"cp_a1": 32.0}

    def test_two_faculty_coding_coexist(self, client, db):
        exam = _exam(db)
        cp = CodingProblem(id="cp_a2", exam_id=exam.id, title="P", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        s = _session(db, exam, sid="sess_owner2")

        f1 = _staff(db, "staff_fa")
        f2 = _staff(db, "staff_fb")
        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"cp_a": 30}}, headers=f1["headers"],
        )
        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"cp_a": 27}}, headers=f2["headers"],
        )

        assert _eval_count(db, s.id, f1["id"]) == 1
        assert _eval_count(db, s.id, f2["id"]) == 1

        # Faculty 1 sees only their own marks
        mine = client.get(f"/admin/exams/{exam.id}/evaluate", headers=f1["headers"]).json()
        assert mine["data"][0]["current_coding_marks"] == {"cp_a": 30.0}

        # Faculty 2 sees only their own marks
        theirs = client.get(f"/admin/exams/{exam.id}/evaluate", headers=f2["headers"]).json()
        assert theirs["data"][0]["current_coding_marks"] == {"cp_a": 27.0}

    def test_faculty_cannot_read_other_facultys_evaluation(self, client, db):
        exam = _exam(db)
        cp = CodingProblem(id="cp_b", exam_id=exam.id, title="P", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        s = _session(db, exam, sid="sess_owner3")

        f1 = _staff(db, "staff_fc")
        f2 = _staff(db, "staff_fd")
        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"cp_b": 40}}, headers=f1["headers"],
        )
        # Faculty 2 reads the same session -> no marks in their context
        mine = client.get(f"/admin/exams/{exam.id}/evaluate", headers=f2["headers"]).json()
        assert mine["data"][0]["current_coding_marks"] == {}

    def test_faculty_spoof_faculty_id_is_ignored(self, client, db):
        exam = _exam(db)
        s = _session(db, exam, sid="sess_spoof")
        f1 = _staff(db, "staff_spoofer")
        f2 = _staff(db, "staff_victim")

        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"x": 5}}, headers=f2["headers"],
        )
        # Faculty 1 asks via GET with faculty_id=f2 -> coerced back to f1 (empty)
        spoof = client.get(
            f"/admin/exams/{exam.id}/evaluate?faculty_id={f2['id']}",
            headers=f1["headers"],
        ).json()
        assert spoof["data"][0]["current_coding_marks"] == {}

    def test_cross_module_faculty_blocked(self, client, db, other_faculty_bearer_headers):
        exam = _exam(db)  # MAS701
        s = _session(db, exam, sid="sess_xm")
        resp = client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"x": 1}}, headers=other_faculty_bearer_headers,
        )
        assert resp.status_code == 403


class TestSubjectiveOwnership:
    def test_subjective_evaluations_coexist_and_isolated(self, client, db):
        exam = _exam(db, eid="E_subj")
        sq = SubjectiveQuestion(id="sq_1", exam_id=exam.id, section="Theory", text="Q")
        db.add(sq)
        db.commit()
        _mongo_mirror(sq)
        s = _session(db, exam, sid="sess_subj")

        f1 = _staff(db, "sf_sub1")
        f2 = _staff(db, "sf_sub2")
        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"subjective_marks": {"sq_1": 25}}, headers=f1["headers"],
        )
        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"subjective_marks": {"sq_1": 29}}, headers=f2["headers"],
        )

        r1 = client.get(f"/admin/exams/{exam.id}/evaluate", headers=f1["headers"]).json()
        r2 = client.get(f"/admin/exams/{exam.id}/evaluate", headers=f2["headers"]).json()
        assert r1["data"][0]["current_subjective_marks"] == {"sq_1": 25.0}
        assert r2["data"][0]["current_subjective_marks"] == {"sq_1": 29.0}
        assert _eval_count(db, s.id, f1["id"]) == 1
        assert _eval_count(db, s.id, f2["id"]) == 1


class TestPendingAndPartial:
    def test_no_evaluation_is_pending(self, client, db, admin_bearer_headers):
        exam = _exam(db, eid="E_pend")
        _session(db, exam, sid="sess_pend")
        resp = client.get(f"/admin/exams/{exam.id}/analytics", headers=admin_bearer_headers)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["faculty_context"]["default_faculty_id"] is None
        assert data["faculty_context"]["is_legacy"] is True
        # pending faculty -> marks empty for any evaluated context
        assert data["students"][0]["cod_score"] == 0

    def test_partial_coding_only(self, client, db, admin_bearer_headers, faculty_bearer_headers):
        exam = _exam(db, "E_partial")
        cp = CodingProblem(id="cp_p", exam_id=exam.id, title="P", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        s = _session(db, exam, sid="sess_part")
        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"cp_p": 18}}, headers=faculty_bearer_headers,
        )
        resp = client.get(f"/admin/exams/{exam.id}/analytics", headers=admin_bearer_headers)
        data = resp.json()["data"]
        st = data["students"][0]
        assert st["cod_score"] == 18
        assert st["subjective_score"] == 0
        assert data["faculty_context"]["default_faculty_id"] == "staff_faculty_test"


class TestAdminVisibilityAndSwitching:
    def test_admin_can_switch_faculty_context(self, client, db, admin_bearer_headers, faculty_bearer_headers):
        exam = _exam(db, "E_admswitch")
        cp = CodingProblem(id="cp_sw", exam_id=exam.id, title="P", description="d")
        db.add(cp)
        db.commit()
        _mongo_mirror(cp)
        s = _session(db, exam, sid="sess_sw")
        f_other = _staff(db, "sw_other")

        # Default = earliest faculty (faculty_bearer => staff_faculty_test)
        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"p": 1}}, headers=faculty_bearer_headers,
        )

        get_mongo_db()["faculty_evaluations"].update_one(
            {"session_id": s.id, "faculty_id": "staff_faculty_test"},
            {"$set": {"created_at": 100.0}},
        )

        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"p": 2}}, headers=f_other["headers"],
        )
        get_mongo_db()["faculty_evaluations"].update_one(
            {"session_id": s.id, "faculty_id": f_other["id"]},
            {"$set": {"created_at": 200.0}},
        )

        # no param -> default (earliest = staff_faculty_test => 1)
        data = client.get(f"/admin/exams/{exam.id}/analytics", headers=admin_bearer_headers).json()["data"]
        assert data["faculty_context"]["selected_faculty_id"] == "staff_faculty_test"
        assert data["students"][0]["cod_score"] == 1

        # switch to other faculty -> 2
        data2 = client.get(
            f"/admin/exams/{exam.id}/analytics?faculty_id={f_other['id']}",
            headers=admin_bearer_headers,
        ).json()["data"]
        assert data2["students"][0]["cod_score"] == 2

    def test_admin_selecting_foreign_faculty_rejected(self, client, db, admin_bearer_headers):
        # admin asks for a faculty who is NOT assigned to the exam's module
        exam = _exam(db, "E_foreign")
        _session(db, exam, sid="sess_foreign")
        foreign = _staff(db, "sf_foreign", module="MAS702")
        resp = client.get(
            f"/admin/exams/{exam.id}/analytics?faculty_id={foreign['id']}",
            headers=admin_bearer_headers,
        )
        assert resp.status_code == 403

    def test_admin_default_legacy_when_no_faculty(self, client, db, admin_bearer_headers):
        exam = _exam(db, "E_legdefault")
        _session(db, exam, sid="sess_ld")
        data = client.get(f"/admin/exams/{exam.id}/analytics", headers=admin_bearer_headers).json()["data"]
        assert data["faculty_context"]["default_faculty_id"] is None
        assert data["faculty_context"]["is_legacy"] is True


class TestLegacyContext:
    def test_legacy_only_for_admin_when_no_faculty_rows(self, client, db, admin_bearer_headers, faculty_bearer_headers):
        exam = _exam(db, "E_leg")
        s = _session(db, exam, sid="sess_leg")
        s.coding_evaluation = json.dumps({"legacy_cp": 7})
        s.subjective_evaluation = json.dumps({"legacy_sq": 3})
        db.commit()
        get_mongo_db()["exam_sessions"].update_one(
            {"_id": s.id},
            {"$set": {
                "coding_evaluation": s.coding_evaluation,
                "subjective_evaluation": s.subjective_evaluation,
            }},
        )

        # Admin sees legacy values while no faculty eval exists
        admin = client.get(f"/admin/exams/{exam.id}/analytics", headers=admin_bearer_headers).json()["data"]
        assert admin["faculty_context"]["is_legacy"] is True
        assert admin["faculty_context"]["legacy_available"] is True
        assert admin["students"][0]["cod_score"] == 7
        assert admin["students"][0]["subjective_score"] == 3

        # Faculty never sees legacy marks
        fac = client.get(f"/admin/exams/{exam.id}/evaluate", headers=faculty_bearer_headers).json()
        assert fac["data"][0]["current_coding_marks"] == {}
        assert fac["data"][0]["current_subjective_marks"] == {}


class TestIntegrity:
    def test_duplicate_saves_never_duplicate_rows(self, client, db, faculty_bearer_headers):
        exam = _exam(db, "E_dup")
        s = _session(db, exam, sid="sess_dup")
        for _ in range(5):
            client.post(
                f"/admin/exams/{exam.id}/evaluate/{s.id}",
                json={"coding_marks": {"c": 1}}, headers=faculty_bearer_headers,
            )
        assert _eval_count(db, s.id, "staff_faculty_test") == 1

    def test_module_reassignment_preserves_history(self, client, db, admin_bearer_headers, faculty_bearer_headers):
        exam = _exam(db, "E_reas")
        s = _session(db, exam, sid="sess_reas")
        f = _staff(db, "reas_fac")
        client.post(
            f"/admin/exams/{exam.id}/evaluate/{s.id}",
            json={"coding_marks": {"c": 5}}, headers=f["headers"],
        )
        assert _eval_count(db, s.id, f["id"]) == 1
        db.refresh(s)

        # Admin reassigns faculty to another module
        resp = client.put(
            f"/admin/staff/{f['id']}",
            json={"module": "MAS702"}, headers=admin_bearer_headers,
        )
        assert resp.status_code == 200

        # Historical evaluation row remains (audit preserved)
        assert _eval_count(db, s.id, f["id"]) == 1
        # Faculty now blocked from the old module's exam
        blocked = client.get(f"/admin/exams/{exam.id}/evaluate", headers=f["headers"])
        assert blocked.status_code == 403