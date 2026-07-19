"""Tests for model creation and relationships."""

import time


class TestStudentModel:
    def test_create_student(self, db):
        from app.models import Student
        student = Student(
            id="23-AIML-101",
            name="John Doe",
            password="hashed_password_here",
            is_active=True,
        )
        db.add(student)
        db.commit()

        saved = db.query(Student).filter(Student.id == "23-AIML-101").first()
        assert saved is not None
        assert saved.name == "John Doe"
        assert saved.is_active is True

    def test_student_defaults(self, db):
        from app.models import Student
        student = Student(id="23-AIML-102", password="hash")
        db.add(student)
        db.commit()

        saved = db.query(Student).filter(Student.id == "23-AIML-102").first()
        assert saved.is_active is True
        assert saved.created_at is not None


class TestExamModel:
    def test_create_exam(self, db):
        from app.models import Exam
        exam = Exam(
            id="exam_test_002",
            title="Midterm Exam",
            duration_seconds=7200,
            starts_at=time.time() + 86400,
            status="upcoming",
            start_password_hash="$2b$12$testhash",
        )
        db.add(exam)
        db.commit()

        saved = db.query(Exam).filter(Exam.id == "exam_test_002").first()
        assert saved is not None
        assert saved.title == "Midterm Exam"
        assert saved.duration_seconds == 7200

    def test_exam_cascade_delete(self, db):
        """Verify that deleting an exam cascades to its questions."""
        from app.models import Exam, Question
        exam = Exam(
            id="exam_cascade_test",
            title="Cascade Test",
            duration_seconds=3600,
            starts_at=time.time(),
            status="draft",
            start_password_hash="$2b$12$testhash",
        )
        db.add(exam)
        db.flush()

        q = Question(
            id="q_cascade_1",
            exam_id="exam_cascade_test",
            section="Technical",
            text="Sample question?",
            optA="A", optB="B", optC="C", optD="D", ans="A",
        )
        db.add(q)
        db.commit()

        db.query(Exam).filter(Exam.id == "exam_cascade_test").delete()
        db.commit()

        remaining = db.query(Question).filter(Question.exam_id == "exam_cascade_test").all()
        assert len(remaining) == 0
