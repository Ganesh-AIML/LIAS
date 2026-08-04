# LIAS — Live Interview Assessment System

**AI-proctored online examination platform for secure, scalable assessments.**

<p align="center">
  <img src="frontend/public/Main-Logo.png" alt="LIAS Logo" width="200"/>
</p>

<div align="center">

![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white)
![Python](https://img.shields.io/badge/Python_3.11-3776AB?logo=python&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-000000?logo=jsonwebtokens&logoColor=white)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow_JS-FF6F00?logo=tensorflow&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socket.io&logoColor=white)

</div>

---

## Table of Contents

- [1. Project Overview](#1-project-overview)
- [2. System Services / Modules](#2-system-services--modules)
- [3. User Types / Roles](#3-user-types--roles)
- [4. Features](#4-features)
- [5. System Design / Architecture](#5-system-design--architecture)
- [6. Main Workflows](#6-main-workflows)
- [7. Exam Lifecycle](#7-exam-lifecycle)
- [8. Proctoring Workflow](#8-proctoring-workflow)
- [9. Evaluation Workflow](#9-evaluation-workflow)
- [10. Repository / File Structure](#10-repository--file-structure)
- [11. Technology Stack](#11-technology-stack)
- [12. Environment Variables](#12-environment-variables)
- [13. Local Setup](#13-local-setup)
- [14. Running the System](#14-running-the-system)
- [15. Production Build](#15-production-build)
- [16. Testing](#16-testing)
- [17. Database Architecture](#17-database-architecture)
- [18. Security](#18-security)
- [19. Developer Handover Notes](#19-developer-handover-notes)

---

## 1. Project Overview

LIAS (Live Interview Assessment System) is a full-stack, AI-proctored online
examination platform for secure, scalable remote assessments. It combines a
React single-page application with a FastAPI backend and MongoDB (Atlas) as the
authoritative runtime datastore.

### What problem does it solve?

Traditional in-person exams face logistical challenges — venue capacity,
invigilator availability, and geographic constraints. LIAS lets institutions
conduct secure remote assessments with:

- real-time, client-side AI proctoring (face, object, and environment checks),
- automated MCQ grading,
- a structured manual evaluation workflow for coding and subjective answers,
- live exam monitoring and session control for invigilators.

### What type of system is it?

A client-server web application consisting of:

- a **React 19 SPA** frontend (student workspace, admin dashboard, faculty portal),
- a **FastAPI** backend exposing a REST API plus a Socket.IO server for real-time events,
- a **MongoDB** datastore accessed through a thin repository layer (no ORM/ODM).

> **Note on naming:** the repository is named LIAS. The FastAPI application is
> internally titled *"S.C.O.P.E. Assessment Gateway"* (`backend/app/main.py`),
> a legacy internal name retained in code.

---

## 2. System Services / Modules

The system is organised into the following services/modules (all implemented
inside `backend/app/` and `frontend/src/`):

| Service / Module | Where | Responsibility |
|---|---|---|
| **Authentication & Authorization Service** | `app/auth.py`, `app/routes/auth.py`, `app/routes/staff_auth.py` | Student join/login (exam token + password), JWT issuance/refresh/revocation, staff (admin/faculty) login, self-registration of faculty accounts |
| **Student Examination Service** | `app/routes/exam.py` | Workspace content delivery, start/end password gates, submission, code-run stubs, session status polling |
| **Admin Management Service** | `app/routes/admin.py` | Exam CRUD, student/token management, master student directory, session revoke/grant, live monitoring, analytics, staff & module administration |
| **Faculty Evaluation Service** | `app/routes/evaluate.py`, `app/evaluation_ctx.py` | Faculty-owned coding/subjective marking, review statuses, admin context switching |
| **Proctoring Service** | `frontend/src/proctoring/` (client-side) + `app/routes/exam.py` (violation endpoints) | Client-side AI detection pipeline (TensorFlow.js COCO-SSD, MediaPipe FaceLandmarker); violation logging and auto-revocation server-side |
| **Evaluation Service** | `app/routes/evaluate.py` | MCQ auto-scoring, manual coding/subjective scoring, review workflow |
| **Analytics / Monitoring Service** | `app/routes/admin.py` (analytics, live monitor), `frontend/src/pages/admin/views/` | Per-exam score distribution, evaluation progress, leaderboard, live session monitoring |
| **MongoDB Repository / Data Layer** | `app/repositories.py`, `app/database.py`, `app/mongo_indexes.py` | Thin PyMongo CRUD wrapper, collection/schema map, index management, transactions |
| **WebSocket / Real-time Service** | `app/main.py` (Socket.IO server), `frontend/src/pages/ExamWorkspace.jsx`, `frontend/src/hooks/useTrueTime.js` | JWT-validated exam rooms; server-time sync; frontend contract for duration adjustments |

---

## 3. User Types / Roles

| Role | Authenticated via | Permissions |
|---|---|---|
| **Student** | `/auth/join` with exam token + password → session JWT | Join an assigned exam, take the exam (workspace, passwords, submission), see available tests and past results. Cannot access admin endpoints. |
| **Admin** | `/admin/auth/login` (staff JWT, `role=admin`) | Full platform administration: exam CRUD for any module, student/token management, master student directory, session revoke/grant, live monitoring, analytics, faculty account management and module assignment. **Evaluation writes are faculty-only** — admins are read-only in the evaluation workflow, but may switch between faculty evaluation contexts. |
| **Faculty** | `/admin/auth/faculty-login` (staff JWT, `role=faculty`) | Module-scoped access only: can create/update exams **within their assigned module**, view analytics/monitor for their module's exams, revoke/grant sessions for their module, and **write** coding/subjective evaluations for their module's students. Cannot manage master students, staff accounts, modules, or any other module's exams. |

### Role distinction rules (server-enforced)

- Every request re-reads the staff account from MongoDB, so role/module changes
  apply immediately (`verify_admin` in `app/routes/admin.py`).
- `require_admin` gates platform-level management (master students, staff,
  module assignment) to `role=admin` only.
- `require_exam_scope` gates all exam-scoped resources: admins pass
  unconditionally; faculty pass only when a module is assigned **and**
  `exam.module == faculty.module`.
- Faculty registration is public but creates **pending** accounts
  (`module=NULL`); an admin must assign a module before the faculty account
  can access anything.
- Evaluation mutations (`save_evaluation`, `clear_evaluation`,
  `set_review_status`) call `ensure_faculty_writer` — faculty only.

---

## 4. Features

### Authentication & Sessions

- Student join with unique per-exam token + bcrypt-hashed password
  (`token_registry`), with timing-safe dummy-hash to prevent user enumeration.
- HS256 JWT sessions bound to `session_id`, `exam_id`, and `student_id`;
  IDOR check on every request.
- JWT refresh (`/auth/refresh-token`) recomputed from the exam's current
  duration so active sessions stay alive through pre-exam and mid-exam
  duration changes.
- Atomic re-login: joining again revokes the previous session (no double-login).
- Student password change (`/auth/update-password`), logout.
- Staff login for admins and faculty; public faculty self-registration
  (pending until module assigned).

### Exam Management

- Create/update/delete exams with MCQ sections, coding problems (with test
  cases), and subjective questions; section metadata (type, marks, order).
- Scheduling with `starts_at`, total duration, and optional per-section
  durations (MCQ / coding / QnA).
- Start/end exam passwords (bcrypt hashed; Fernet-encrypted copies at rest
  for admin re-display).
- Draft/upcoming/live/completed lifecycle (see [Exam Lifecycle](#7-exam-lifecycle)).
- Exam content is replaced wholesale on update (PUT semantics) inside a Mongo
  transaction.
- LaTeX/ZIP question-bank import (`TexZipImporter.jsx`, template files in the
  repo root: `questions.tex`, `template_mcq.tex`, `template_subjective.tex`).

### Student Enrollment & Tokens

- Master student directory (central records, active flag, password reset).
- Per-exam enrollment: bulk-create students, assign students to an exam, and
  generate unique tokens (`LIAS_<STUDENT_ID>_<HEX>`).
- Reset-and-resync of a master student (password reset + token resync).

### Exam Workspace (Student)

- Database-driven workspace: MCQs grouped into sections, coding problems,
  subjective questions (plain or markdown content with KaTeX math).
- Server-synced countdown (`useTrueTime` NTP-style offset + Socket.IO).
- Start/end password gates; auto-submit on expiry; local draft caching
  (IndexedDB / sessionStorage).
- Monaco editor for coding; TipTap rich-text + MathLive for subjective
  answers; ReactMarkdown + KaTeX rendering.
- Fullscreen enforcement, keyboard shortcut blocking, copy/paste prevention,
  devtools detection, context-menu disable, back-navigation blocking.

### Proctoring

- Client-side AI pipeline: MediaPipe FaceLandmarker (head pose / face
  absence), TensorFlow.js COCO-SSD (phones, books, laptops, multiple faces),
  luminance sampling for covered/shuttered cameras.
- Self-healing pipeline (GPU→CPU fallback; degradation surfaces as
  `proctor_engine_degraded` / `face_absent` events instead of silent failure).
- Violation events logged server-side; 3 violations auto-revokes the session.
- Admin live monitor with per-session violation breakdown; revoke (kick out)
  and grant (unlock) controls.

### Evaluation

- Automatic MCQ scoring from the submission payload.
- Faculty-owned coding and subjective marks (`faculty_evaluations` collection)
  with totals recomputed as `MCQ + coding + subjective`.
- Review statuses: `pending`, `reviewed`, `flagged` (and clear).
- Admin read-only view with faculty context switching; legacy ownerless marks
  shown only when no faculty-owned evaluation exists.

### Analytics & Monitoring

- Per-exam analytics: students, scores (MCQ/coding/subjective/total), review
  status, evaluation progress, leaderboard, faculty context.
- Live test monitor: active sessions, violation counts, student detail.

---

## 5. System Design / Architecture

MongoDB is the **authoritative runtime database**. There is no SQL datastore
(SQLAlchemy, SQLite, or PostgreSQL/Neon) anywhere in the runtime — the backend
is Mongo-only.

```
┌──────────────────────────────────────────────────────────────┐
│                   Browser (React 19 SPA)                     │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────────────┐  │
│  │ Student UI │ │ Admin UI   │ │  Proctoring Engine       │  │
│  │ /join,     │ │ / (root)   │ │  (TensorFlow.js COCO-SSD │  │
│  │ /precheck, │ │ + views    │ │   + MediaPipe + luminance│  │
│  │ /dashboard │ │ Faculty    │ │   sampling)              │  │
│  │ /workspace │ │ Portal     │ └───────────┬──────────────┘  │
│  └─────┬──────┘ └─────┬──────┘             │ (client-side)   │
│        │              │                    │                 │
│        └────── Axios (REST) ───────────────┤                 │
│        └────── Socket.IO (real-time) ──────┘                 │
└───────────────┬─────────────────────────────┬────────────────┘
                │                             │
                ▼                             ▼
┌──────────────────────────────────────────────────────────────┐
│                    FastAPI Backend (Uvicorn)                 │
│                                                              │
│  /auth  /exam  /admin (admin, evaluate, staff_auth routers)  │
│                                                              │
│  auth.py (JWT guards) ── limiter.py (SlowAPI) ── CORS        │
│                                                              │
│  Socket.IO server: connect + join_exam_room (JWT-validated)  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │          Repository Layer (repositories.py)            │  │
│  │  find / find_all / update / insert / aggregate /       │  │
│  │  find_one_and_update / delete / mongo_transaction      │  │
│  └──────────────────────────┬─────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────┘
                              │ PyMongo (driver)
                              ▼
                  ┌──────────────────────┐
                  │   MongoDB (Atlas)    │
                  │ 12 collections       │
                  │ (see Database §17)   │
                  └──────────────────────┘
```

### Architectural boundaries

- **Frontend → Backend**: REST via Axios (JWT in `Authorization` header),
  plus Socket.IO for real-time events. All proctoring ML runs client-side —
  **no video stream is sent to the server**; only structured violation events.
- **Backend → Data**: FastAPI routes never touch PyMongo directly — all
  persistence goes through the repository layer (`app/repositories.py`), which
  owns the collection map, field schemas, JSON-to-BSON decoding, and
  transactions.
- **Auth**: student session JWTs (`sub` = student id, `session_id`,
  `exam_id`); staff JWTs (`sub` = staff id only; role/module re-read from DB
  per request).
- **WebSocket**: Socket.IO ASGI app wrapping the FastAPI app; clients join an
  exam room only after JWT validation (`verify_socket_token`).

---

## 6. Main Workflows

### Student Workflow

```
Join (/auth/join: token + password)
  → Pre-exam check (/precheck: camera, mic, network, fullscreen, ML models)
  → Dashboard (/dashboard: available tests + past results)
  → Exam selection (GET /exam/student/available-tests)
  → Workspace (GET /exam/{id}) — blocked until starts_at, blocked after submission
  → Start-password gate (POST /exam/{id}/verify-password)
  → Exam workspace with proctoring + server-synced timer
  → Submission (POST /exam/{id}/submit) — atomic, single-submit, grace-window enforced
  → Completion (available-tests reflects submitted exams; expired sessions
    finalized server-side as a safety net)
```

Session tokens are refreshed periodically via `/auth/refresh-token`; the lock
screen polls `/exam/session-status` to detect admin revocation (401) or grant.

### Admin Workflow

```
Login (/admin/auth/login → staff JWT; legacy X-Admin-Token only pre-seed)
  → Admin dashboard (root route "/")
  → Exam management (create/update/delete, schedule, passwords, sections)
  → Student management (bulk create, master directory, reset/resync)
  → Enrollment/token management (assign students to exams → LIAS_* tokens)
  → Live monitoring (Live Test Monitor: sessions, violations, revoke/grant)
  → Analytics (per-exam scores, evaluation progress, leaderboard)
  → Faculty management (list staff, assign modules)
```

### Faculty Workflow

```
Login (/admin/auth/faculty-login) — or self-register then await module assignment
  → Module-scoped access (own module only; pending accounts get 403)
  → Exam management within module (create/update exams)
  → Evaluation portal (GET /admin/exams/{id}/evaluate)
  → Open a student session (GET .../evaluate/{session_id})
  → Enter coding/subjective marks (POST .../evaluate/{session_id})
  → Set review status / clear marks (faculty-owned rows only)
```

---

## 7. Exam Lifecycle

Exam status is **computed from server time**, never from the browser
(`compute_exam_status` in `app/routes/admin.py`):

| Status | Meaning | Condition |
|---|---|---|
| `draft` | Not yet scheduled; created with `status=draft` | stored status `draft` |
| `upcoming` | Scheduled for the future | stored `status != draft` and `starts_at > now` |
| `live` | Currently running | `starts_at <= now <= starts_at + duration_seconds` |
| `completed` | Over | `now > starts_at + duration_seconds` |

Transition rules enforced in code:

- **draft → upcoming/live**: the admin schedules the exam (`starts_at`); a
  `draft` exam never becomes visible to students automatically.
- **upcoming → live**: automatic once `starts_at` passes — students can load
  the workspace and verify passwords only after `starts_at` (403 otherwise).
- **live → completed**: automatic once `starts_at + duration_seconds` passes;
  submissions are rejected after `end + 60s` grace (`LATE_SUBMISSION_GRACE_SECONDS`).
- **Sessions**: `finalize_expired_sessions` marks any session
  `is_submitted=True` once its exam has fully ended (safety net for missed
  client auto-submits). It is invoked lazily from `available-tests` and
  admin exam listing.
- **Content lock**: an exam can only be **edited** while in `draft` or
  `upcoming` status — editing a `live`/`completed` exam returns 409
  ("Questions are locked once an exam goes live"). Deletion is allowed at any
  status and cascades (sessions, violations, evaluations, questions, coding
  problems, test cases, sections, token registry) inside one transaction.

---

## 8. Proctoring Workflow

- **What is monitored (client-side)**: face presence and head pose (MediaPipe
  FaceLandmarker), prohibited objects — phones, books, laptops, multiple faces
  (TensorFlow.js COCO-SSD), camera obstruction (luminance sampling),
  fullscreen state, tab switches, copy/paste, devtools, right-click,
  keyboard shortcuts.
- **When monitoring begins**: after the pre-exam check passes and the student
  enters the exam workspace; the engine runs continuously in a
  `preparing → observation → enforcement` lifecycle.
- **What is recorded**: the engine posts structured events to
  `POST /exam/violation` with `event_type` (one of `ALLOWED_EVENTS` in
  `app/routes/exam.py`) and a detail string. Server-side, violations are
  stored in the `violation_logs` collection with session/student/exam
  references and a timestamp.
- **Auto-enforcement**: when a session reaches **3 violations**, the server
  automatically revokes it (`is_revoked=True`), which blocks further exam
  requests (401 `SESSION_REVOKED`).
- **How admins monitor**: the Live Test Monitor endpoint
  (`GET /admin/exams/{id}/monitor`) lists active sessions with violation
  counts; `GET /exam/violation/count` gives the per-event breakdown for the
  student's lock screen.
- **Session control**: admins can revoke a session (`/admin/sessions/revoke`,
  which also finalizes the session as submitted) or grant access back
  (`/admin/sessions/grant`); the student lock screen polls
  `/exam/session-status` and refreshes on grant.

---

## 9. Evaluation Workflow

### MCQ automatic evaluation

On submission the raw answers are stored in `exam_sessions.submission_payload`.
MCQ scores are recomputed server-side (`_compute_mcq_score` in
`app/routes/evaluate.py`) against the question answer keys and written to
`exam_sessions.mcq_score`. No client-computed score is ever trusted.

### Coding evaluation

Coding answers are stored in `submission_payload.coding` (code + language).
Code execution is **not available** (`/exam/{id}/run` is a stub returning
"unavailable"): faculty enter per-problem marks manually through the
evaluation portal (`/admin/exams/{id}/evaluate/{session_id}`).

### Subjective evaluation

Subjective answers are stored in `exam_sessions.subjective_payload` (markdown,
validated server-side — HTML rejected, 10k char limit). Faculty enter
per-question marks manually with the same evaluation endpoint.

### Faculty ownership

Each faculty's marks live in their own `faculty_evaluations` row
(`session_id` + `faculty_id` unique). Writes are faculty-only
(`ensure_faculty_writer`); the identity always comes from the validated staff
JWT — client-supplied `faculty_id` is never trusted for faculty.

### Admin override / context switching

Admins are read-only in evaluation. The evaluation context resolver
(`resolve_context` in `app/evaluation_ctx.py`) lets an admin view any faculty
assigned to the exam's module, or legacy ownerless marks (stored directly on
`exam_sessions`) via the `__legacy__` sentinel — legacy marks are shown only
when no faculty-owned evaluation exists. The default selection is the
earliest-evaluating faculty for the exam.

---

## 10. Repository / File Structure

```text
LIAS/
├── backend/                            # FastAPI Python backend
│   ├── app/
│   │   ├── main.py                     # App entry, lifespan (indexes + admin seed), CORS, Socket.IO
│   │   ├── database.py                 # PyMongo client/db singletons (Mongo-only)
│   │   ├── auth.py                     # JWT creation/validation, session guard, socket token guard
│   │   ├── repositories.py             # Thin PyMongo CRUD repository layer (schemas, transactions)
│   │   ├── mongo_indexes.py            # Mongo index definitions + ensure_mongo_indexes()
│   │   ├── limiter.py                  # SlowAPI rate limiter instance
│   │   ├── module_codes.py             # Canonical module registry (MAS701–MAS709)
│   │   ├── evaluation_ctx.py           # Faculty-evaluation context resolution & ownership rules
│   │   └── routes/
│   │       ├── auth.py                 # /auth/* (join, logout, refresh, update-password, health)
│   │       ├── exam.py                 # /exam/* (workspace, verify-password, submit, violation, run stubs)
│   │       ├── admin.py                # /admin/* (exams, students, monitor, analytics, sessions, staff)
│   │       ├── evaluate.py             # /admin/exams/*/evaluate/* (faculty evaluation)
│   │       └── staff_auth.py           # /admin/auth/* (admin/faculty login, faculty register)
│   ├── scripts/
│   │   ├── probe_databases.py          # Ops-only diagnostic: probes Mongo (+ optional Neon read-only)
│   │   └── verify_indexes.py           # Ops-only: verifies live Mongo indexes against MONGO_INDEXES
│   ├── tests/                          # pytest suite (150 tests, Mongo test DB)
│   │   ├── conftest.py                 # Fixtures: isolated lias_test DB, client, staff/exam samples
│   │   ├── test_auth.py                # Student auth flow, rate limiting, revocation
│   │   ├── test_admin.py               # Admin guards, exam/student CRUD
│   │   ├── test_staff_auth.py          # Staff login, faculty registration, module assignment, admin seed
│   │   ├── test_module_scope.py        # Module-based authorization matrix
│   │   ├── test_evaluate.py            # Evaluation endpoints
│   │   ├── test_faculty_eval_ownership.py  # Faculty ownership + admin context switching
│   │   ├── test_expired_finalize.py    # Expired-session finalization safety net
│   │   ├── test_failure_recovery.py    # Idempotency, concurrency, JWT tamper, partial failures
│   │   └── test_mongo_parity.py        # Repository doc_for()/schema parity invariants
│   ├── requirements.txt                # Python dependencies
│   ├── pyproject.toml                  # pytest + coverage configuration
│   └── .env.example                    # Backend environment template
│
├── frontend/                           # React 19 SPA
│   ├── src/
│   │   ├── main.jsx                    # React entry point
│   │   ├── App.jsx                     # Router + route guards (/join /precheck /dashboard /workspace)
│   │   ├── index.css                   # Tailwind imports
│   │   ├── services/api.js             # Axios instances with JWT + revocation-aware interceptors
│   │   ├── store/authStore.js          # Zustand auth store (in-memory JWT)
│   │   ├── hooks/                      # useAdminApi, useEvaluateApi, useTrueTime (server clock)
│   │   ├── pages/
│   │   │   ├── StudentAuth.jsx         # Student join
│   │   │   ├── PreExamCheck.jsx        # Readiness gate (camera/mic/network/fullscreen/ML)
│   │   │   ├── StudentDashboard.jsx    # Available tests + past results
│   │   │   ├── ExamWorkspace.jsx       # Locked-down exam UI (timers, proctoring, submission)
│   │   │   └── admin/
│   │   │       ├── AdminDashboard.jsx  # Admin shell
│   │   │       ├── AuthPage.jsx        # Admin/faculty login
│   │   │       ├── FacultyPortal.jsx   # Faculty evaluation portal
│   │   │       └── views/              # AdminMainView, ScheduleTest, LiveTestMonitor,
│   │   │                               # AnalyticsView, StudentDirectory, FacultyManagement,
│   │   │                               # UpcomingTestPreview, CodingProblemBuilder
│   │   ├── components/
│   │   │   ├── admin/                  # AdminNav, CodingEvaluator, SubjectiveEvaluator, TexZipImporter
│   │   │   ├── exam/                   # QuestionRenderer, AnswerRenderer, SubjectiveEditor, MathInputPopover
│   │   │   └── ui/                     # LiveCountdown, etc.
│   │   ├── proctoring/
│   │   │   ├── engine.js               # AI detection pipeline (TF.js + MediaPipe) singleton
│   │   │   ├── readiness.js            # Proctoring readiness gate
│   │   │   └── useProctoring.js        # React hook for engine lifecycle
│   │   ├── extensions/                 # TipTap custom math node
│   │   └── utils/normalizeMath.js      # LaTeX normalization
│   ├── public/                         # Logo, favicon, icons
│   ├── index.html
│   ├── vite.config.js                  # Vite + KaTeX font static copy
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── eslint.config.js
│   ├── package.json
│   └── .env.example                    # VITE_API_URL template
│
├── README.md                           # This file
├── implementation-plan.md              # Historical planning doc (informational only)
├── questions.tex / template_mcq.tex / template_subjective.tex  # Question-import format templates
└── .gitignore
```

---

## 11. Technology Stack

### Frontend

| Technology | Purpose |
|---|---|
| React 19 | UI framework |
| Vite 8 | Build tool and dev server |
| React Router DOM 7 | Client-side routing |
| Tailwind CSS 3 | Utility-first styling |
| Zustand | State management (auth store, in-memory JWT) |
| Axios | HTTP client with JWT interceptor |
| Socket.IO Client | Real-time events (exam room, time sync) |
| KaTeX + rehype-katex | LaTeX math typesetting |
| ReactMarkdown (remark-gfm, remark-math) | Question/answer markdown rendering |
| TipTap | Rich-text subjective answer editor with custom math node |
| MathLive | WYSIWYG equation editor (MathInputPopover) |
| Monaco Editor | Code editor for coding problems |
| TensorFlow.js + COCO-SSD, MediaPipe tasks-vision | Client-side proctoring models |
| JSZip | LaTeX/ZIP question-bank import |
| idb | IndexedDB draft caching |
| Lucide React | Icons |

### Backend

| Technology | Purpose |
|---|---|
| Python 3.11 | Runtime (verified against the local environment used for the test suite) |
| FastAPI | ASGI web framework |
| Uvicorn | ASGI server |
| PyJWT | JWT creation/verification (HS256) |
| bcrypt | Password hashing (staff, tokens) |
| Pydantic | Payload validation |
| python-socketio / python-engineio | Socket.IO server (ASGI mode) |
| SlowAPI | Rate limiting |
| cryptography (Fernet) | Exam password encryption at rest |
| PyMongo | MongoDB driver (repository layer) |
| pytest / httpx / pytest-asyncio / pytest-cov | Testing |
| aiohttp | Async HTTP transport (Socket.IO) |

### Database

| Technology | Purpose |
|---|---|
| MongoDB (Atlas) | Authoritative runtime datastore — 12 collections |
| PyMongo | Driver; repository layer is a thin CRUD wrapper (no ODM) |
| Indexes | Unique + lookup indexes created idempotently at startup (`mongo_indexes.py`) |
| Transactions | Multi-collection writes (exam creation/update) run in replica-set transactions |

### Testing

- **Backend**: pytest (150 tests) against a dedicated `lias_test` Mongo DB.
- **Frontend**: no automated test framework; validation is `npm run build`
  (production build) and `npm run lint`.

---

## 12. Environment Variables

> Never commit real `.env` files. Copy `.env.example` and fill in your values.
> See `backend/.env.example` and `frontend/.env.example`.

### Backend (`backend/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET_KEY` | **Yes** | HS256 signing key for all JWTs. App fails fast at import if missing. |
| `MONGO_URI` | **Yes** | MongoDB connection string (e.g. Atlas). Append `?retryWrites=true&w=majority` for production. Used by `database.py`. |
| `MONGO_DB_NAME` | No | Database name (default `lias`). |
| `ADMIN_SECRET` | Conditional | Legacy `X-Admin-Token` bootstrap secret, accepted **only while zero admin accounts exist** (pre-seed window). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Conditional | Bootstraps the first `role=admin` account at startup when zero admins exist (`_seed_admin_if_needed`). |
| `DB_ENCRYPTION_KEY` | **Yes** | Fernet key for encrypting exam start/end passwords at rest. App fails fast at import if missing. |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins (default `http://localhost:5173`). Used by CORS middleware and Socket.IO. |
| `JWT_EXPIRY_SECONDS` | No | Session JWT lifetime (default `7200`). |
| `FRONTEND_BASE_URL` | No | Reserved for frontend URL configuration (not consumed by current route code). |

### Frontend (`frontend/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_URL` | **Yes** | Backend base URL (e.g. `http://localhost:8000`). The app throws at startup if unset. |

---

## 13. Local Setup

### Prerequisites

- Python 3.11+ (the suite is verified on Python 3.11.5)
- Node.js 20+ and npm
- A MongoDB instance (local MongoDB, Docker, or Atlas free tier) — the app
  and tests require it; there is no embedded fallback database

### Backend Setup

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env: set JWT_SECRET_KEY, MONGO_URI, DB_ENCRYPTION_KEY (and optionally
# ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_SECRET for first-admin bootstrap)
```

Generate a Fernet-compatible `DB_ENCRYPTION_KEY`:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### Frontend Setup

```bash
cd frontend

npm install

# Configure environment
cp .env.example .env
# Edit .env: VITE_API_URL=http://localhost:8000
```

---

## 14. Running the System

Start the **backend** (from `backend/`):

```bash
uvicorn app.main:app --reload --port 8000
```

On startup the app:

1. connects to MongoDB (`MONGO_URI`),
2. idempotently creates the Mongo indexes (`ensure_mongo_indexes`),
3. seeds the first admin account if `ADMIN_EMAIL`/`ADMIN_PASSWORD` are set
   and no admin exists yet.

Start the **frontend** (from `frontend/`):

```bash
npm run dev
```

Expected local URLs (dev mode):

- Frontend: `http://localhost:5173` (admin dashboard is the root route)
- Backend API: `http://localhost:8000` (health check at `/auth/health-check`)

No other external services are required at runtime beyond MongoDB.

---

## 15. Production Build

### Frontend

```bash
cd frontend
npm run build
# Output in frontend/dist/ — serve via any static file server (Render static site, etc.)
```

Build-time environment: `VITE_API_URL` must point at the production backend.

### Backend

No build step — run with Uvicorn:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Deployment is handled via Render (backend web service + static frontend). The
required production environment variables are the same as §12, most
importantly `JWT_SECRET_KEY`, `MONGO_URI`, and `DB_ENCRYPTION_KEY`, plus
`ALLOWED_ORIGINS` set to the production frontend origin and the admin
bootstrap variables for the first deploy.

### Operational scripts (optional)

- `backend/scripts/verify_indexes.py` — verifies the live Mongo collections
  have the expected indexes.
- `backend/scripts/probe_databases.py` — diagnostic probe of the target Mongo
  database (optionally compares against a Neon URL if `DATABASE_URL` is
  supplied). These are ops-only tools, not part of the runtime.

---

## 16. Testing

### Backend

```bash
cd backend
python -m pytest tests/ -x --tb=short -q
```

The suite targets a dedicated **`lias_test`** Mongo database (set in
`tests/conftest.py`); each test starts from an empty database and the
collections are wiped after every test. The production database is never
touched by tests.

**Latest verified result: 150 passed** (pytest, Python 3.11.5, ~5 min run).

Test files:

| File | Focus |
|---|---|
| `test_auth.py` | Join, logout, refresh, update-password, revocation, rate limits |
| `test_admin.py` | Admin guards, exam creation/update/delete validation |
| `test_staff_auth.py` | Admin/faculty login, faculty registration, module assignment, admin seed |
| `test_module_scope.py` | Module-based authorization matrix (admin vs faculty vs pending) |
| `test_evaluate.py` | Evaluation list/detail/save/clear/review |
| `test_faculty_eval_ownership.py` | Faculty ownership, admin context switching, legacy fallback |
| `test_expired_finalize.py` | Expired-session finalization |
| `test_failure_recovery.py` | Idempotent submit/revoke, concurrent revocation, JWT expiry/tamper, partial bulk failures |
| `test_mongo_parity.py` | Repository schema/`doc_for` parity invariants |

### Frontend

No automated frontend test framework is present. Validation commands:

```bash
cd frontend
npm run build    # production build (latest verified: succeeds)
npm run lint     # ESLint flat config
```

---

## 17. Database Architecture

MongoDB is the **only** runtime datastore. The historical PostgreSQL (Neon)
datastore has been fully removed from the application code and dependencies;
any remaining migration/cutover work is operational (deployment) work, not
implemented in this codebase.

### Collections (one per logical entity)

| Collection | Purpose |
|---|---|
| `students` | Student accounts with bcrypt-hashed passwords and active flag |
| `token_registry` | Per-exam tokens linking students to exams, with hashed passwords |
| `staff_accounts` | Admin and faculty accounts (role, module, password hash) |
| `exams` | Exam configuration (timing, passwords, status, module) |
| `exam_sessions` | Per-student exam attempts (submission payloads, scores, evaluation, revocation) |
| `faculty_evaluations` | Faculty-owned coding/subjective marks per session |
| `violation_logs` | Proctoring violation events |
| `questions` | MCQ questions (options, answer key, section, marks) |
| `coding_problems` | Coding problems (description, constraints, languages, marks) |
| `test_cases` | Coding problem input/output pairs |
| `subjective_questions` | Subjective questions (marks, content format) |
| `sections` | Question-grouping metadata (type, marks per question, order) |

### Important indexes (`app/mongo_indexes.py`)

- `token_registry`: unique `(student_id, exam_id)`, index on `exam_id`
- `staff_accounts`: unique `email`
- `faculty_evaluations`: unique `(session_id, faculty_id)`, indexes on
  `faculty_id` and `session_id`
- `exam_sessions`: composite `(student_id, exam_id, is_revoked)`, index on `exam_id`
- `violation_logs`: indexes on `session_id`, `student_id`, `exam_id`
- `questions`, `subjective_questions`, `coding_problems`: index on `exam_id`
- `test_cases`: index on `problem_id`
- `sections`: index on `exam_id`

Indexes are created idempotently on every backend startup.

### Repository abstraction

All persistence flows through `app/repositories.py`:

- `doc_for(table, row, ...)` — schema-driven document builder; every document
  carries `_id` = logical id and a mirror `id` field, with JSON-in-text
  fields (submission payloads, marks) stored as native BSON.
- CRUD helpers (`find`, `find_all`, `insert_one`, `insert_many`, `update_one`,
  `update_many`, `find_one_and_update`, `delete_*`, `count`, `aggregate`,
  `distinct`) that accept logical table names.
- `mongo_transaction()` — replica-set transactions used by exam
  create/update (exam + sections + questions + coding problems + test cases +
  subjective questions committed atomically) and by exam deletion (cascade of
  sessions, violations, evaluations, and content).
- Atomicity guarantees: re-login session replacement and exam submission use
  `find_one_and_update` with state-matching filters (no TOCTOU double-submit);
  bulk inserts run `ordered=False`.

---

## 18. Security

| Control | Implementation |
|---|---|
| JWT authentication | HS256, configurable expiry (`JWT_EXPIRY_SECONDS`); student tokens carry `sub`, `exam_id`, `session_id`; staff tokens carry `sub` only |
| Session validation | `verify_session_guard` re-loads the session from Mongo per request; checks existence, revocation, and that `session.student_id == JWT sub` (IDOR protection) |
| Role authorization | `verify_admin` re-reads the staff account per request; `require_admin` (platform admin) vs `require_exam_scope` (module-gated faculty) |
| Module authorization | Canonical module registry (`module_codes.py`, MAS701–MAS709); faculty forced to their own module; unknown module codes rejected (422) |
| Session revocation | Re-login atomically revokes the old session; admin revoke/grant; auto-revoke at 3 violations; revoked sessions return 401 `SESSION_REVOKED` |
| Rate limiting | SlowAPI: 5/min `/auth/join`, 10/min staff login + admin mutations, 20/min `/admin/verify`, 30/min token refresh & evaluation writes |
| CORS | `ALLOWED_ORIGINS` (comma-separated); methods GET/POST/PUT/DELETE/OPTIONS; headers Content-Type, Authorization, X-Admin-Token |
| Password hashing | bcrypt (rounds 12) for token passwords and staff accounts; dummy-hash executed on join miss to prevent timing-based enumeration; admin seed via env vars only |
| Exam passwords | bcrypt hash for verification + Fernet-encrypted copies for admin re-display (`DB_ENCRYPTION_KEY`) |
| WebSocket authentication | `verify_socket_token` validates the session JWT and `exam_id` before a client joins an exam room |
| Exam scope enforcement | Every exam-scoped student route checks `active_session.exam_id == exam_id`; workspace/password/submit all reject cross-exam access |
| Submission integrity | Atomic single-submit (`find_one_and_update` on `is_submitted: false`); late submissions rejected past `end + 60s` grace; sessions created after exam end cannot submit |
| Input validation | Pydantic validators: student ID charset, length caps, content-format allowlist (`plain`/`markdown`), HTML rejection in subjective answers, canonical module codes |
| Legacy bootstrap window | `X-Admin-Token` (`ADMIN_SECRET`) accepted only while **zero** admin accounts exist, with constant-time comparison |

---

## 19. Developer Handover Notes

**Where to start reading:**

1. `backend/app/main.py` — app assembly: routers, CORS, rate limiter, startup
   lifespan (indexes + admin seed), Socket.IO server.
2. `backend/app/repositories.py` + `backend/app/database.py` — the data layer;
   everything that touches MongoDB goes through here.
3. `backend/app/auth.py` + `backend/app/routes/auth.py` — the two auth models
   (student session JWTs vs staff JWTs) and the student join pipeline.
4. `backend/app/routes/admin.py` — the largest surface: guards
   (`verify_admin`/`require_admin`/`require_exam_scope`), exam CRUD, students,
   monitor, analytics, staff management.
5. `backend/app/routes/exam.py` — student-facing exam lifecycle.
6. `backend/app/routes/evaluate.py` + `backend/app/evaluation_ctx.py` —
   faculty-owned evaluation and context switching.
7. `frontend/src/App.jsx` — route map and guards; then `pages/` per role and
   `proctoring/` for the client-side engine.

**Where things live:**

- **Repository / data access**: `backend/app/repositories.py` (schemas,
  `doc_for`, transactions), `backend/app/mongo_indexes.py` (indexes),
  `backend/app/database.py` (client/db singletons). Collections are addressed
  by logical name via `repo.col("collection")` or the CRUD helpers.
- **Authentication**: `backend/app/auth.py` (JWT guards), `routes/auth.py`
  (student), `routes/staff_auth.py` (admin/faculty), `routes/admin.py`
  (`verify_admin` guard + bootstrap window).
- **Exam workflows**: `backend/app/routes/exam.py` (student side),
  `backend/app/routes/admin.py` (management side).
- **Evaluation**: `backend/app/routes/evaluate.py`, `backend/app/evaluation_ctx.py`.
- **Proctoring**: `frontend/src/proctoring/` (engine, readiness, hook) +
  violation endpoints in `backend/app/routes/exam.py`.
- **Tests**: `backend/tests/` — fixtures in `conftest.py` (isolated
  `lias_test` Mongo DB, staff/exam samples); run with
  `python -m pytest tests/ -x --tb=short -q`.
- **Env config**: `backend/.env.example`, `frontend/.env.example`.

**Conventions to respect:**

- Never bypass the repository layer with direct PyMongo calls in routes.
- All documents must carry both `_id` and the mirrored `id` field (the
  repository `doc_for()` enforces this).
- Never trust a client-supplied `faculty_id` or `module` for faculty accounts;
  identity and module always come from the server-side staff record.
- Tests must never touch the production Mongo database (`lias_test` is
  asserted in `conftest.py`).
