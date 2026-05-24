from app.database import SessionLocal, Base, engine
from app.models import Exam, TokenRegistry
import bcrypt
import time

Base.metadata.create_all(bind=engine)

# New exam passwords
START_PASSWORD = "start"
END_PASSWORD = "end"
EXAM_TOKEN = "LIAS_TOKEN"

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

db = SessionLocal()

# Define the users
students = [
    {"name": "Ganesh", "pass": "Ganesh123"},
    {"name": "Madhwendra", "pass": "Madhwendra123"},
    {"name": "Pragya", "pass": "Pragya123"}
]

# Create the Exam
test_exam = Exam(
    id="exam_789",
    title="S.C.O.P.E. Master Blueprint Assessment",
    duration_seconds=7200, # 2 hours
    starts_at=time.time() - 100,
    end_password_hash=hash_password(END_PASSWORD)
)
db.add(test_exam)

# Create the Student Tokens
for s in students:
    # Use a unique token for each student (e.g., LIAS_Ganesh, LIAS_Madhwendra, etc.)
    unique_token = f"LIAS_{s['name']}" 
    test_token = TokenRegistry(
        token         = unique_token, # Now each row has a different PK
        exam_id       = "exam_789",
        student_id    = s["name"],
        password_hash = hash_password(s["pass"]),
        is_active     = True
    )
    db.add(test_token)

db.commit()
print(f"✅ Database seeded with: {', '.join([s['name'] for s in students])}")
print(f"🔑 Exam Token: {EXAM_TOKEN}")
print(f"🏁 Exam Passwords: Start='{START_PASSWORD}', End='{END_PASSWORD}'")

db.close()