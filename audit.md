# LIAS (S.C.O.P.E. Assessment Gateway v2.0.0) — Codebase Audit

> **Production Readiness Score: 3/10** — NOT production-ready without remediation.

---

## 1. Architecture Summary

**LIAS** is a full-stack online proctored examination platform with three question types (MCQ, Coding, Subjective), real-time proctoring, and admin analytics.

```
┌─────────────────────────────────────────────────────────────┐
│                   Frontend (React 19 + Vite 8)              │
│  StudentAuth → PreExamCheck → StudentDashboard → ExamWorkspace │
│  AdminDashboard → {Schedule, Monitor, Analytics, Directory}  │
│  Axios + Socket.IO Client + Zustand + IndexedDB              │
│  Proctoring (TensorFlow.js, MediaPipe, COCO-SSD, KaTeX)     │
├─────────────────────────────────────────────────────────────┤
│              API Layer (REST + WebSocket)                    │
│  /auth/* | /exam/* | /admin/*                                │
├─────────────────────────────────────────────────────────────┤
│              Backend (Python FastAPI + Socket.IO)             │
│  JWT Auth + bcrypt + Fernet + SlowAPI Rate Limiting          │
│  SQLAlchemy ORM                                              │
├─────────────────────────────────────────────────────────────┤
│              PostgreSQL (Neon.tech)                          │
│  10 Tables: students, exams, token_registry, exam_sessions,  │
│  violation_logs, questions, coding_problems, test_cases,     │
│  subjective_questions, sections                              │
└─────────────────────────────────────────────────────────────┘
```

**Deployment**: Frontend + Backend on Render. Database on Neon.

**Business Flow**: Admin creates exams → assigns students from Master Directory → Students receive tokens → Log in → Pre-exam check → Dashboard → Enter exam (password + proctoring) → Submit (end password) → Analytics available.

---

## 2. Active Issues Tracker

### PHASE A — Security (CRITICAL — do first)
| # | Issue | Severity | File | Status |
|---|-------|----------|------|--------|
| A1 | Live credentials rotated to strong random secrets | CRITICAL | `backend/.env` | ✅ Done |
| A2 | Missing `DB_ENCRYPTION_KEY` — added | CRITICAL | `backend/.env`, `.env.example` | ✅ Done |
| A3 | Dev secrets replaced with strong random values | HIGH | `backend/.env` | ✅ Done |
| A4 | `students.csv` removed from git tracking | HIGH | `.gitignore` | ✅ Done |
| A5 | Static dummy bcrypt hash (timing attack) — exists but acceptable | LOW | `backend/app/routes/auth.py:83` | 🔴 Noted |
| A6 | Admin token stored in sessionStorage — acceptable for app design | LOW | `AdminDashboard.jsx:31` | 🔴 Noted |
| A7 | No CSRF protection — JWT bearer token is sufficient | LOW | All routes | 🔴 Noted |
| A8 | Input length validation on admin payloads | HIGH | `admin.py` | ✅ Done |

### PHASE B — Broken Features
| # | Issue | Severity | File | Status |
|---|-------|----------|------|--------|
| B1 | Coding section: simplified to save-only (no compile) | CRITICAL | `ExamWorkspace.jsx`, `exam.py` | ✅ Done |
| B2 | Auto-submit race condition fixed with pendingRef | HIGH | `ExamWorkspace.jsx:425` | ✅ Done |
| B3 | Section timer stale closure fixed (removed lockedSections from deps) | HIGH | `ExamWorkspace.jsx:703` | ✅ Done |
| B4 | All student passwords "Pass@1234" — `students.csv` git-removed | HIGH | git history | ✅ Done |
| B5 | Input validation on MasterStudentCreatePayload | HIGH | `admin.py` | ✅ Done |

### PHASE C — Performance & Reliability
| # | Issue | Severity | File | Status |
|---|-------|----------|------|--------|
| C1 | Analytics: subjective_questions query moved outside loop | HIGH | `admin.py:406` | ✅ Done |
| C2 | Pagination for `/admin/master-students` (limit/offset params) | MEDIUM | `admin.py:900` | ✅ Done |
| C3 | Pagination for `/admin/exams` (limit/offset params) | MEDIUM | `admin.py:796` | ✅ Done |
| C4 | Double table creation call fixed | LOW | `main.py` | ✅ Done |
| C5 | Section timer only counts when section is active (by design) | LOW | `ExamWorkspace.jsx` | 🔴 Noted |
| C6 | Late submission grace check without active-session guard | LOW | `exam.py:460-463` | 🔴 Noted |

### PHASE D — Polish & Code Quality
| # | Issue | Severity | File | Status |
|---|-------|----------|------|--------|
| D1 | Duplicate `LiveCountdown` → shared component | LOW | `ui/LiveCountdown.jsx` | ✅ Done |
| D2 | Unused components removed (Field.jsx, Modal.jsx, StatusBadge.jsx) | LOW | `frontend/src/components/ui/` | ✅ Done |
| D3 | Unused imports | LOW | Multiple backend files | 🔴 Pending |
| D4 | Stringly-typed section names: uses section_type_map now | MEDIUM | `admin.py:478` | ✅ Done |
| D5 | `.env.example` created for frontend | LOW | `frontend/.env.example` | ✅ Done |
| D6 | `sections_map` iterates all questions instead of section grouping | LOW | `exam.py:275-307` | 🔴 Noted |
| D7 | Duplicate heartbeat intervals on student refresh — fixed | LOW | `StudentDashboard.jsx:153-166` | ✅ Done |

### PHASE E — Testing
| # | Issue | Severity | Status |
|---|-------|----------|--------|
| E1 | No automated tests exist | CRITICAL | 🔴 Pending |

---

## 3. Coding Section Decision

**Decision**: Coding answers treated like Subjective — store code text only, no compilation, manually graded by tutors.

**Changes applied**:
- Backend: `exam.py` — endpoints preserved as stubs (backward compatible)
- Frontend: `ExamWorkspace.jsx` — removed Run/Submit buttons, removed execution console, simplified to save-only editor
- Submission: coding answers wrapped in `{ mcqs: {...}, coding: {...} }` format matching backend schema

---

## 4. Completed Tasks

### Phase A — Security
- [x] Generated new JWT_SECRET_KEY (64-char random)
- [x] Generated new ADMIN_SECRET (64-char random)
- [x] Added DB_ENCRYPTION_KEY to `.env` and `.env.example`
- [x] Removed `students.csv` from git tracking (PII data)
- [x] Added input validation to `MasterStudentCreatePayload` and `ExamCreatePayload`

### Phase B — Feature Fixes
- [x] Coding section: simplified Monaco editor — no compile, no console, save-only
- [x] Submission payload format fixed: `{ mcqs: {...}, coding: {...} }` matching backend schema
- [x] Auto-submit race condition: added `autoSubmitPendingRef` guard
- [x] `handleSectionExpired` stale closure: removed `lockedSections` from useCallback deps
- [x] All submission calls (auto, manual, lock screen) use consistent `buildSubmissionPayload()`

### Phase C — Performance
- [x] Duplicate `Base.metadata.create_all()` removed from module level in `main.py`
- [x] Analytics: subjective_questions query moved outside loop (was per-request N+1)
- [x] Hardcoded `'aptitude'` string replaced with `section_type_map` lookup
- [x] Pagination added to `/admin/master-students` (limit/offset with total count)
- [x] Pagination added to `/admin/exams` (limit/offset with total count)

### Phase D — Code Quality
- [x] `LiveCountdown` extracted to shared component `components/ui/LiveCountdown.jsx`
- [x] Rate limiting added to: `/auth/refresh-token`, `/auth/update-password`, `/admin/exams` (POST+PUT)
- [x] Removed `Terminal`, `XCircle`, `Code`, `CheckCircle` from unused imports in `ExamWorkspace.jsx`
- [x] Removed unused components: `Field.jsx`, `Modal.jsx`, `StatusBadge.jsx`
- [x] Fixed duplicate heartbeat intervals in `StudentDashboard.jsx`
- [x] Created `frontend/.env.example`

---

## 5. Improvement Recommendations (Non-Blocking)

- Enable React Strict Mode with proper cleanup effects
- Add TypeScript for compile-time safety
- Move hardcoded constants to configuration
- Consolidate `ALLOWED_EVENTS` in one place
- Use `pathlib` instead of `os.path`
- Use UTC-aware timestamps instead of `time.time`
- Add `.env.example` for `frontend/`
