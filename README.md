# LIAS — Learning Integrated Assessment System

**AI-proctored online examination platform for secure, scalable assessments.**

<p align="center">
  <img src="frontend/public/Main-Logo.png" alt="LIAS Logo" width="200"/>
</p>

<div align="center">

![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Python](https://img.shields.io/badge/Python_3.12-3776AB?logo=python&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-000000?logo=jsonwebtokens&logoColor=white)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow_JS-FF6F00?logo=tensorflow&logoColor=white)
![License](https://img.shields.io/badge/License-Not%20Specified-lightgrey)

</div>

---

## Table of Contents

- [Project Overview](#project-overview)
- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Question Import](#question-import)
- [API Overview](#api-overview)
- [Database](#database)
- [Security](#security)
- [Screenshots](#screenshots)
- [Testing](#testing)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Project Overview

LIAS is a full-stack online examination platform designed for secure and scalable assessments. It combines a modern React frontend with a FastAPI backend, PostgreSQL database, and client-side AI proctoring to deliver a robust remote examination solution.

### What problem does it solve?

Traditional in-person exams face logistical challenges — venue capacity, invigilator availability, and geographic constraints. LIAS enables institutions to conduct **secure remote assessments** with real-time proctoring, automated MCQ grading, and a structured evaluation workflow for subjective and coding questions.

### Target users

- **Educational institutions** — universities, colleges, and training providers
- **Certification bodies** — organizations conducting credentialing exams
- **Administrators** — manage exams, students, proctoring, and evaluation
- **Students** — attempt proctored exams with a structured workspace

### Primary objectives

- Provide a **secure**, **scalable** platform for remote assessments
- Prevent cheating through **AI-powered proctoring** and browser-level enforcement
- Support **multiple question types**: MCQs, coding problems, and subjective answers
- Streamline **evaluation workflows** with auto-grading and manual review
- Enable **real-time monitoring** of live exams

---

## Features

### Assessment Management

| Feature | Description |
|---------|-------------|
| Exam lifecycle | Create, edit, schedule, publish, and archive exams |
| Multi-part exams | Combine MCQ sections, coding problems, and subjective questions in a single exam |
| Configurable durations | Independent timing for MCQ, coding, and subjective sections |
| Start/end passwords | Deferred two-password exam entry and exit system (encrypted via Fernet) |
| Exam duplication | Full exam content is purged and replaced on update (PUT semantics) |

### Question Bank

| Feature | Description |
|---------|-------------|
| LaTeX/ZIP import | Upload a `.zip` containing `questions.tex` and images for bulk question import |
| Three question types | MCQ (`\begin{choices}` + `\answer{}`), subjective (`\begin{question}`), coding (`\begin{codingquestion}` + `\testcase{}`) |
| Rich text authoring | TipTap-based editor for subjective questions with LaTeX math support |
| Coding problem builder | UI for creating coding problems with title, description, constraints, and test cases |
| Markdown rendering | Questions rendered via ReactMarkdown with KaTeX math typesetting |

### AI Proctoring

| Feature | Description |
|---------|-------------|
| Face detection | MediaPipe FaceLandmarker for head pose estimation (yaw detection) |
| Object detection | TensorFlow.js + COCO-SSD to detect phones, books, laptops, and multiple faces |
| Camera obstruction | Luminance sampling to detect camera covered or shutter closed |
| Self-healing pipeline | Automatic fallback from GPU to CPU on WebGL failure |
| Three-stage lifecycle | `preparing` → `observation` → `enforcement` with escalating responses |

### Anti-Cheating Enforcement

| Feature | Description |
|---------|-------------|
| Fullscreen enforcement | Overlay prevents exiting fullscreen during exam |
| Tab-switch detection | Logs violations when student navigates away |
| Keyboard shortcut blocking | Blocks F12, F5, F11, Ctrl+U/P/S/A/C/X/V, Ctrl+Shift+I/J/C |
| Copy/paste prevention | Disabled via browser event blocking |
| Devtools blocking | Detects and logs devtool openings |
| Context menu disabled | Right-click disabled during exam |
| Back navigation blocked | `popstate` handler prevents browser back |

### Evaluation & Analytics

| Feature | Description |
|---------|-------------|
| Auto-graded MCQs | Scores calculated automatically on submission |
| Manual coding evaluation | Per-problem mark entry with review status workflow |
| Manual subjective evaluation | Per-question mark entry with review status workflow |
| Assignment-level scoring | Separate MCQ, coding, and subjective scores with total aggregation |
| Review workflow | Status tracking: unreviewed → reviewed, with clear option |
| Analytics dashboard | Per-exam overview with score distribution, evaluation progress, and leaderboard |

### Student & Session Management

| Feature | Description |
|---------|-------------|
| Master student directory | Centralized student records with password reset and cross-exam sync |
| Exam token system | Each student receives a unique token for each exam |
| Session lifecycle | Create → join → attempt → submit — with revocation and grace period |
| Live proctoring monitor | Admin dashboard showing active sessions, violation counts, and per-student details |
| Session controls | Admin can revoke (kick-out) or unlock (grant) any session |

### Security

| Feature | Description |
|---------|-------------|
| JWT authentication | HS256-signed tokens with configurable expiry and refresh |
| Input validation | Pydantic models with regex, length limits, and type enforcement |
| Rate limiting | SlowAPI: 5/min on login, 10/min on token refresh and admin mutations |
| Password encryption | bcrypt for student passwords; Fernet for exam passwords at rest |
| Session revocation | Re-login automatically revokes old session; duplicate submission prevented |
| CORS | Configurable allowed origins via environment variable |

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                     │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────────────┐  │
│  │  UI       │  │ Monaco   │  │  Proctoring Engine      │  │
│  │  (Tailwind│  │ Editor   │  │  (TensorFlow.js +       │  │
│  │   + Lucide│  │          │  │   MediaPipe + COCO-SSD) │  │
│  │   + KaTeX)│  │ TipTap   │  │                         │  │
│  │           │  │ (RTE)    │  │  Face / Object / Pose   │  │
│  │ ReactMark │  │ MathLive │  │  Detection              │  │
│  │ down      │  │ (Equ.Ed) │  └──────────┬──────────────┘  │
│  └───────────┘  └──────────┘             │                  │
│         │              │                 │                  │
│         └──────┬───────┘                 │                  │
│                │                         │                  │
│         Axios REST + Socket.IO           │ (client-side)    │
└────────────────┼─────────────────────────┼──────────────────┘
                 │                         │
                 ▼                         ▼
┌──────────────────────────────────────────────┐
│              FastAPI Backend                  │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Auth     │  │ Exam     │  │ Admin    │   │
│  │ Routes   │  │ Routes   │  │ Routes   │   │
│  │          │  │          │  │          │   │
│  │ JWT +    │  │ Session  │  │ CRUD +   │   │
│  │ bcrypt   │  │ Mgmt     │  │ Monitor  │   │
│  └──────────┘  └──────────┘  └──────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  SQLAlchemy ORM + Pydantic Models    │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  Socket.IO Server (real-time clock sync)     │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│          PostgreSQL (Neon.tech)              │
│                                              │
│  Students │ Exams │ Sessions │ Questions     │
│  Violations │ Coding Problems │ Test Cases  │
│  Subjective Questions │ Sections             │
│  Token Registry │ Master Directory           │
└──────────────────────────────────────────────┘
```

### Data flow

1. **Admin** creates exams via the admin dashboard — content is stored in PostgreSQL.
2. **Students** receive exam tokens and join via `/auth/join` — JWT issued on success.
3. **Pre-exam check** validates browser capabilities (camera, microphone, network, fullscreen).
4. **Exam workspace** loads questions via `/exam/{id}` and renders them in a locked-down environment.
5. **Proctoring engine** runs entirely client-side — violations are reported via `/exam/violation`.
6. **Submission** stores answers immediately; MCQ scores are auto-calculated.
7. **Evaluation** is performed by admins through the analytics dashboard.
8. **Socket.IO** synchronizes server time for countdown accuracy across sessions.

---

## Technology Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| [React 19](https://react.dev/) | UI framework |
| [Vite 8](https://vitejs.dev/) | Build tool and development server |
| [React Router DOM 7](https://reactrouter.com/) | Client-side routing |
| [Tailwind CSS 3](https://tailwindcss.com/) | Utility-first CSS framework |
| [Zustand](https://github.com/pmndrs/zustand) | Lightweight state management (with `persist` middleware) |
| [Axios](https://axios-http.com/) | HTTP client with JWT interceptor |
| [Socket.IO Client](https://socket.io/) | Real-time WebSocket communication |
| [KaTeX](https://katex.org/) | LaTeX math typesetting |
| [ReactMarkdown](https://remarkjs.github.io/react-markdown/) | Markdown rendering with `remark-math`, `rehype-katex`, `remark-gfm` |
| [TipTap](https://tiptap.dev/) | Rich text editor (subjective answers) with custom math node |
| [MathLive](https://cortexjs.io/mathlive/) | WYSIWYG equation editor (MathInputPopover) |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | Code editor (coding problems) |
| [Lucide React](https://lucide.dev/) | Icon library |
| [TensorFlow.js](https://www.tensorflow.org/js) | Client-side ML for object detection (COCO-SSD) |
| [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) | Face landmark detection (head pose estimation) |
| [JSZip](https://stuk.github.io/jszip/) | ZIP file parsing (TeX import) |
| [idb](https://github.com/jakearchibald/idb) | IndexedDB wrapper |

### Backend

| Technology | Purpose |
|------------|---------|
| [FastAPI](https://fastapi.tiangolo.com/) | ASGI web framework |
| [Uvicorn](https://www.uvicorn.org/) | ASGI server |
| [SQLAlchemy](https://www.sqlalchemy.org/) | ORM (declarative base, session management) |
| [psycopg2-binary](https://www.psycopg.org/) | PostgreSQL adapter |
| [PyJWT](https://pyjwt.readthedocs.io/) | JSON Web Token creation and verification (HS256) |
| [bcrypt](https://github.com/pyca/bcrypt/) | Password hashing with dummy-hash timing protection |
| [Pydantic](https://docs.pydantic.dev/) | Data validation and settings management |
| [python-socketio](https://python-socketio.readthedocs.io/) | WebSocket server for real-time features |
| [SlowAPI](https://slowapi.readthedocs.io/) | Rate limiting (in-memory, per-route) |
| [cryptography (Fernet)](https://cryptography.io/) | Exam password encryption at rest |
| [pytest](https://docs.pytest.org/) | Testing framework |
| [httpx](https://www.python-httpx.org/) | Async HTTP test client (FastAPI TestClient) |
| [aiohttp](https://docs.aiohttp.org/) | Async HTTP (used by Socket.IO transport) |

### Database

| Technology | Purpose |
|------------|---------|
| [PostgreSQL](https://www.postgresql.org/) | Primary database (production on Neon.tech) |
| [SQLite](https://www.sqlite.org/) | Test database (in-memory, ephemeral) |

### Deployment

| Platform | Service |
|----------|---------|
| [Render](https://render.com/) | Backend API and static frontend hosting |

---

## Repository Structure

<details>
<summary>Click to expand full directory tree</summary>

```
LIAS/
├── backend/                          # FastAPI Python backend
│   ├── app/
│   │   ├── main.py                   # App entry, lifespan, CORS, Socket.IO
│   │   ├── auth.py                   # JWT creation/verification, session guard
│   │   ├── database.py               # SQLAlchemy engine and session factory
│   │   ├── limiter.py                # SlowAPI rate limiter instance
│   │   ├── models.py                 # All SQLAlchemy ORM models
│   │   └── routes/
│   │       ├── auth.py               # /auth/* endpoints
│   │       ├── exam.py               # /exam/* endpoints
│   │       ├── admin.py              # /admin/* endpoints
│   │       └── evaluate.py           # /admin/exams/*/evaluate/* endpoints
│   ├── tests/
│   │   ├── conftest.py               # Test fixtures (DB, client, samples)
│   │   ├── test_models.py            # Model CRUD tests
│   │   ├── test_auth.py              # Auth flow + rate limiting tests
│   │   ├── test_admin.py             # Admin endpoint tests
│   │   └── test_evaluate.py          # Evaluation endpoint tests
│   ├── pyproject.toml                # Pytest + coverage configuration
│   ├── requirements.txt              # Python dependencies
│   └── .env.example                  # Environment variable template
│
├── frontend/                         # React SPA frontend
│   ├── public/
│   │   ├── Main-Logo.png             # Application logo
│   │   ├── favicon.svg               # Browser favicon
│   │   └── icons.svg                 # SVG icon sprite
│   ├── src/
│   │   ├── main.jsx                  # React entry point
│   │   ├── App.jsx                   # Router + route guards
│   │   ├── index.css                 # Tailwind imports
│   │   ├── assets/
│   │   │   ├── Main-Logo.png
│   │   │   └── hero.png
│   │   ├── components/
│   │   │   ├── admin/                # Admin-facing components
│   │   │   │   ├── AdminNav.jsx
│   │   │   │   ├── CodingEvaluator.jsx
│   │   │   │   ├── SubjectiveEvaluator.jsx
│   │   │   │   └── TexZipImporter.jsx
│   │   │   ├── exam/                 # Exam workspace components
│   │   │   │   ├── AnswerRenderer.jsx
│   │   │   │   ├── MathInputPopover.jsx
│   │   │   │   ├── QuestionRenderer.jsx
│   │   │   │   └── SubjectiveEditor.jsx
│   │   │   └── ui/
│   │   │       └── LiveCountdown.jsx
│   │   ├── extensions/               # TipTap custom extensions
│   │   │   ├── MathNode.js
│   │   │   └── MathNodeView.jsx
│   │   ├── hooks/
│   │   │   ├── useAdminApi.js        # Admin API client with cache
│   │   │   ├── useEvaluateApi.js     # Evaluation API wrapper
│   │   │   └── useTrueTime.js        # Server-synced clock
│   │   ├── pages/
│   │   │   ├── StudentAuth.jsx       # Student login
│   │   │   ├── PreExamCheck.jsx      # System readiness check
│   │   │   ├── StudentDashboard.jsx  # Student exam list
│   │   │   ├── ExamWorkspace.jsx     # Active exam workspace
│   │   │   └── admin/
│   │   │       ├── AdminDashboard.jsx
│   │   │       └── views/
│   │   │           ├── AdminMainView.jsx
│   │   │           ├── ScheduleTest.jsx
│   │   │           ├── CodingProblemBuilder.jsx
│   │   │           ├── LiveTestMonitor.jsx
│   │   │           ├── UpcomingTestPreview.jsx
│   │   │           ├── AnalyticsView.jsx
│   │   │           └── StudentDirectory.jsx
│   │   ├── proctoring/
│   │   │   ├── engine.js             # AI proctoring engine (singleton)
│   │   │   ├── readiness.js          # Proctoring readiness gate
│   │   │   └── useProctoring.js      # React hook for engine lifecycle
│   │   ├── services/
│   │   │   └── api.js                # Axios instance with interceptors
│   │   ├── store/
│   │   │   └── authStore.js          # Zustand auth store (in-memory JWT)
│   │   └── utils/
│   │       └── normalizeMath.js      # LaTeX normalization
│   ├── index.html                    # HTML entry point
│   ├── vite.config.js                # Vite configuration
│   ├── tailwind.config.js            # Tailwind design system
│   ├── postcss.config.js             # PostCSS configuration
│   ├── eslint.config.js              # ESLint flat config
│   └── package.json                  # Node dependencies and scripts
│
├── .gitignore                        # Git ignore rules
└── README.md                         # This file
```
</details>

### Key directories explained

| Directory | Purpose |
|-----------|---------|
| `backend/app/` | FastAPI application — routes, models, authentication, database setup |
| `backend/app/routes/` | API route handlers organized by domain (auth, exam, admin, evaluate) |
| `backend/tests/` | Pytest test suite with fixtures and coverage configuration |
| `frontend/src/pages/` | Top-level page components and route views |
| `frontend/src/pages/admin/views/` | Admin dashboard sub-views (exam management, monitor, analytics, etc.) |
| `frontend/src/components/admin/` | Reusable admin components (grading UI, ZIP importer) |
| `frontend/src/components/exam/` | Reusable exam components (rendering, editors) |
| `frontend/src/proctoring/` | Client-side AI proctoring engine (TensorFlow.js + MediaPipe) |
| `frontend/src/hooks/` | Custom React hooks (API clients, clock sync) |
| `frontend/src/store/` | Zustand state management |
| `frontend/src/extensions/` | TipTap editor custom extensions |

---

## Installation

### Prerequisites

- [Python](https://www.python.org/) 3.12 or later
- [Node.js](https://nodejs.org/) 20 or later
- [PostgreSQL](https://www.postgresql.org/) (production) — or use SQLite for local development

### Clone the repository

```bash
git clone https://github.com/Ganesh-AIML/LIAS.git
cd LIAS
```

### Backend setup

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your configuration (see Configuration section)
```

### Frontend setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your backend URL
```

### Database setup

The application runs **additive migrations** automatically on startup via the lifespan handler in `main.py`. Tables are created if they don't exist, and missing columns are added for existing tables.

For local development, you can use either:

**Option 1: PostgreSQL**
```bash
# Ensure DATABASE_URL in backend/.env points to your local or cloud PostgreSQL instance
# Example: postgresql://user:password@localhost:5432/lias
```

**Option 2: SQLite** (no external database required)
```bash
# Set DATABASE_URL in backend/.env to:
# sqlite:///./test.db
```

### Run development servers

**Terminal 1 — Backend:**
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

The frontend dev server will be available at `http://localhost:5173` and the API at `http://localhost:8000`.

### Production build

```bash
cd frontend
npm run build
# Output in frontend/dist/ — serve via any static file server
```

---

## Configuration

### Backend environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL or SQLite connection string |
| `JWT_SECRET_KEY` | Yes | — | Secret key for HS256 JWT signing |
| `ADMIN_SECRET` | Yes | — | Static admin authentication token |
| `DB_ENCRYPTION_KEY` | Yes | — | Fernet-compatible 32-byte base64 key for exam password encryption |
| `ALLOWED_ORIGINS` | No | `http://localhost:5173` | Comma-separated CORS allowed origins |
| `JWT_EXPIRY_SECONDS` | No | `7200` | JWT token lifetime in seconds |
| `FRONTEND_BASE_URL` | No | `http://localhost:5173` | Frontend URL for redirects |

<details>
<summary>Backend .env.example</summary>

```env
DATABASE_URL=postgresql://user:password@localhost:5432/lias
JWT_SECRET_KEY=your-secret-key-here
ADMIN_SECRET=your-admin-secret
DB_ENCRYPTION_KEY=your-fernet-encoded-key
ALLOWED_ORIGINS=http://localhost:5173
JWT_EXPIRY_SECONDS=7200
FRONTEND_BASE_URL=http://localhost:5173
```
</details>

### Frontend environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Backend API base URL (e.g., `http://localhost:8000`) |

<details>
<summary>Frontend .env.example</summary>

```env
VITE_API_URL=http://localhost:8000
```
</details>

> **Security note:** Never commit `.env` files containing actual secrets to version control. Use `.env.example` templates instead.

---

## Usage

### Admin workflows

#### Creating an exam

1. Navigate to the admin dashboard (`/`).
2. Click **Schedule New Exam** to open the multi-step creation wizard.
3. Configure:
   - Exam title, duration, start time, and password.
   - **MCQ sections** — add questions with four options and an answer key.
   - **Coding problems** — add problem descriptions, constraints, and test cases.
   - **Subjective questions** — add open-ended questions with markdown content.
4. Publish the exam — it becomes visible to assigned students at the scheduled time.

#### Assigning students

1. Use the **Student Directory** to manage the master student list.
2. From the exam management view, **assign** students to the exam.
3. Each student receives a unique exam token (`LIAS_<STUDENT>_<HEX>`) and temporary password.

#### Monitoring a live exam

1. Navigate to **Live Test Monitor** from the admin dashboard.
2. View active sessions with real-time violation counts.
3. Click a student to see detailed violation history.
4. Use **Kick Out** to revoke a session or **Grant Access** to unlock a student.

#### Evaluating submissions

1. Open **Analytics** for the completed exam.
2. Review auto-calculated MCQ scores.
3. Switch to **Coding** or **Subjective** tabs to manually enter marks.
4. Mark each submission as **Reviewed** when evaluation is complete.
5. The **Leaderboard** tab shows aggregated scores (MCQ + Coding + Subjective).

#### Importing questions from LaTeX/ZIP

1. From the exam creation wizard, choose **Import from ZIP**.
2. Upload a `.zip` file containing `questions.tex` and optional images.
3. Preview the parsed questions and confirm import.
4. See [Question Import](#question-import) for format specification.

### Student workflows

#### Joining an exam

1. Navigate to `/join` and enter the exam token and password provided by the admin.
2. On successful authentication, a JWT session is created.

#### Pre-exam check

1. After joining, the **Pre-Exam Check** screen validates system readiness:
   - **Camera** — access and frame capture verified.
   - **Microphone** — audio input confirmed.
   - **Network** — connection speed measured.
   - **Fullscreen** — ability to enter fullscreen mode.
   - Browser compatibility and proctoring ML model loading.

#### Taking an exam

1. The **Exam Workspace** loads with the configured question sections.
2. A countdown timer (synced to server time) displays remaining time.
3. The proctoring engine runs continuously in the background.
4. **Fullscreen is enforced** — exiting triggers a warning (3 violations = session revoked).
5. Navigate through MCQ options, code in the built-in editor, and write subjective answers.
6. Submit when finished or when time expires.

#### After submission

- MCQ scores are calculated immediately.
- Coding and subjective answers are queued for manual evaluation by the admin.
- Results become available in the student dashboard once evaluation is complete.

---

## Question Import

LIAS supports bulk question import via a `.zip` archive containing a `questions.tex` file. This is the primary import path for question banks.

### ZIP structure

```
exam.zip
├── questions.tex        # Exactly one .tex file (anywhere in the zip)
└── images/              # Optional — referenced via \includegraphics
    ├── diagram1.png
    └── figure2.jpg
```

### questions.tex format

The file is organized into **sections**, each opened by a `\metasection` command:

```
\metasection{Section Name}{question_type}{marks_per_question}
```

| Argument | Values | Description |
|----------|--------|-------------|
| Section Name | Any string | Display label for the section |
| question_type | `mcq`, `subjective`, `coding` | Determines how questions are parsed |
| marks_per_question | Positive integer | Maximum marks per question |

#### MCQ questions

```latex
\metasection{Quantitative Aptitude}{mcq}{4}

\begin{question}
What is 2 + 2?
\answer{A}
\begin{choices}
\choice A: 4
\choice B: 5
\choice C: 6
\choice D: 7
\end{choices}
\end{question}
```

#### Subjective questions

```latex
\metasection{Long Answer}{subjective}{10}

\begin{question}
Explain the concept of present value in actuarial science.
Provide a detailed explanation with examples.
\end{question}
```

#### Coding questions

```latex
\metasection{Algorithms}{coding}{25}

\begin{codingquestion}
Two Sum Problem

Given an array of integers nums and an integer target...
\begin{constraints}
- 2 <= nums.length <= 10^4
- -10^9 <= nums[i] <= 10^9
\end{constraints}
\testcase{[2,7,11,15], 9}
\testcase{[3,2,4], 6}
\testcase{[3,3], 6}
\end{codingquestion}
```

### Supported LaTeX features

| Feature | Support |
|---------|---------|
| `\textbf`, `\textit`, `\emph`, `\underline` | Converted to markdown (`**`, `*`, `__`) |
| `\boldsymbol` | Converted to bold (`**`) |
| `\mathrm` | Content preserved, command stripped |
| `\pounds` | Converted to `£` |
| Math delimiters `$...$`, `$$...$$`, `\[...\]` | Normalized and rendered via KaTeX |
| `\includegraphics` | Resolved from ZIP images folder |
| `\begin{itemize}` / `\begin{enumerate}` | Converted to markdown lists |
| `\begin{center}` | Content preserved, environment stripped |
| `\begin{tabular}` | Converted to GFM pipe tables |
| `\begin{tikzpicture}` | Replaced with diagram placeholder |
| `\begin{cases}` | Rendered via KaTeX math mode |

### Limitations (verified)

- `\begin{tikzpicture}` diagrams are replaced with a placeholder text — actual rendering is not supported.
- Code execution endpoint (`/exam/{exam_id}/run`) is a stub and returns "Code execution unavailable."
- Image formats depend on browser support — standard web formats (PNG, JPG, GIF, SVG) are recommended.

---

## API Overview

The API is organized into three route groups. All endpoints are prefixed by the backend base URL.

### Auth — `/auth`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/auth/health-check` | Server health status and timestamp |
| POST | `/auth/join` | Student login with exam token + password |
| POST | `/auth/logout` | Revoke current session |
| POST | `/auth/refresh-token` | Renew JWT for active session |
| PUT | `/auth/update-password` | Change exam password |

### Exam — `/exam`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/exam/session-status` | Session validity check (lock screen polling) |
| POST | `/exam/violation` | Log a proctoring violation event |
| GET | `/exam/violation/count` | Get violation counts grouped by type |
| GET | `/exam/student/available-tests` | Student dashboard — upcoming/live/past exams |
| GET | `/exam/{exam_id}` | Load exam workspace content |
| POST | `/exam/{exam_id}/verify-password` | Verify start or end password |
| POST | `/exam/{exam_id}/submit` | Submit exam answers |
| POST | `/exam/{exam_id}/run` | Code execution (stub — currently unavailable) |
| POST | `/exam/{exam_id}/submit-code` | Code submission (pending evaluation) |

### Admin — `/admin`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/admin/verify` | Verify admin authentication token |
| GET | `/admin/exams` | List all exams with session stats |
| POST | `/admin/exams` | Create a new exam with full content |
| GET | `/admin/exams/active` | List upcoming and live exams |
| GET | `/admin/exams/{exam_id}` | Get full exam details |
| PUT | `/admin/exams/{exam_id}` | Update exam (purge + replace content) |
| DELETE | `/admin/exams/{exam_id}` | Delete exam with cascade |
| GET | `/admin/exams/{exam_id}/analytics` | Exam analytics and grading data |
| GET | `/admin/exams/{exam_id}/monitor` | Live proctoring monitor data |
| POST | `/admin/exams/{exam_id}/assign` | Bulk-assign students to exam |
| GET | `/admin/students` | List registered students |
| POST | `/admin/students` | Bulk create or update students |
| POST | `/admin/students/bulk-delete` | Bulk delete students |
| PUT | `/admin/students/{token}` | Update student |
| DELETE | `/admin/students/{token}` | Delete student |
| POST | `/admin/sessions/revoke` | Revoke and submit a student session (kick-out) |
| POST | `/admin/sessions/grant` | Unlock a student session |
| GET | `/admin/master-students` | List master directory entries |
| POST | `/admin/master-students` | Create a master student |
| POST | `/admin/master-students/bulk` | Bulk upsert master students |
| PUT | `/admin/master-students/{student_id}` | Update master student |
| POST | `/admin/master-students/{student_id}/reset-and-resync` | Reset password and resync tokens |
| DELETE | `/admin/master-students/{student_id}` | Delete master student |
| GET | `/admin/exams/{exam_id}/evaluate` | List students pending evaluation |
| GET | `/admin/exams/{exam_id}/evaluate/{session_id}` | Full evaluation detail |
| POST | `/admin/exams/{exam_id}/evaluate/{session_id}` | Save evaluation marks |
| POST | `/admin/exams/{exam_id}/evaluate/{session_id}/clear` | Clear evaluation data |
| POST | `/admin/exams/{exam_id}/evaluate/{session_id}/review` | Toggle review status |

### Authentication

- **Student endpoints**: Require `Authorization: Bearer <session_jwt>` header.
- **Admin endpoints**: Require `X-Admin-Token: <admin_secret>` header.

---

## Database

### Entity relationship diagram

```mermaid
erDiagram
    Student ||--o{ ExamSession : "attempts"
    Exam ||--o{ ExamSession : "contains"
    Exam ||--o{ Question : "has"
    Exam ||--o{ CodingProblem : "has"
    Exam ||--o{ SubjectiveQuestion : "has"
    Exam ||--o{ Section : "organized by"
    Exam ||--o{ ViolationLog : "logs"
    ExamSession ||--o{ ViolationLog : "generates"
    CodingProblem ||--o{ TestCase : "validated by"
    Section ||--o{ Question : "groups"
    Section ||--o{ SubjectiveQuestion : "groups"
    TokenRegistry }o--|| Exam : "belongs to"
    TokenRegistry }o--|| Student : "belongs to"
    MasterStudent ||--o{ TokenRegistry : "generates"
```

### Key entities

| Entity | Table | Description |
|--------|-------|-------------|
| **Student** | `students` | Registered student accounts with bcrypt-hashed passwords |
| **MasterStudent** | `master_students` | Master directory — centralized student records |
| **Exam** | `exams` | Assessment configuration — timing, passwords, status, content structure |
| **ExamSession** | `exam_sessions` | Individual student exam attempt — tracks submission, scores, evaluation |
| **Question** | `questions` | MCQ questions with four options and correct answer |
| **CodingProblem** | `coding_problems` | Coding challenge with description, constraints, and language configuration |
| **TestCase** | `test_cases` | Input/output pairs for coding problem validation |
| **SubjectiveQuestion** | `subjective_questions` | Open-ended questions with markdown content and marks |
| **Section** | `sections` | Logical grouping of questions (MCQ or subjective) within an exam |
| **ViolationLog** | `violation_logs` | Proctoring violation events linked to sessions |
| **TokenRegistry** | `token_registry` | Exam-specific tokens linking students to exams with encrypted passwords |

---

## Security

### Authentication

- **Student**: Two-factor authentication — unique exam token + bcrypt-hashed password. Sessions are managed via HS256 JWT with configurable expiry (default 2 hours). JWTs are held in memory only (never persisted to `sessionStorage`/`localStorage`).
- **Admin**: Static secret token verified via constant-time comparison (`secrets.compare_digest`).
- **Rate limiting**: Sensitive endpoints are rate-limited (5 requests/minute on `/auth/join`, 10/min on refresh/update/admin mutations).

### Input validation

- All request payloads validated through **Pydantic models** with `@field_validator` decorators.
- Student IDs restricted to alphanumeric characters, underscores, hyphens, and dots (rejects HTML/script injection).
- Password length enforced (6–256 characters).
- Content format restricted to `plain` or `markdown`.
- Subjective answers scanned for HTML tags (`<[a-zA-Z]` patterns are rejected).

### Exam security

- **Start/end passwords**: Encrypted at rest via Fernet symmetric encryption.
- **Session ownership**: Cross-exam access prevented — JWT contains `exam_id` and is validated per request.
- **Grace period**: Submissions rejected after a configured grace period post-exam-end.
- **Duplicate prevention**: Re-submission and duplicate login (revokes old session) are enforced server-side.
- **Content locking**: Exam content cannot be modified after the scheduled start time.

### Proctoring

- All ML models run **client-side** — no video stream is sent to the server.
- Violations are logged as structured events (type, detail, timestamp).
- Configurable violation limit (default: 3) — reaching the limit blocks further exam access in the UI.
- Self-healing ML pipeline falls back from WebGL GPU to CPU on failure.

### Data sanitization

- Student-facing rendered content uses **ReactMarkdown** with `allowedElements` whitelist — `<script>`, `<style>`, `<iframe>`, and other dangerous tags are blocked.
- URL sanitization restricts protocols to `https:`, `http:`, `mailto:`, and `tel:`.
- Base64 images restricted to recognized image MIME types.

### CORS

- Configurable via `ALLOWED_ORIGINS` environment variable (comma-separated).
- Methods: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`.
- Headers: `Content-Type`, `Authorization`, `X-Admin-Token`.

---

## Screenshots

<p align="center">
  <img src="frontend/src/assets/hero.png" alt="LIAS Hero" width="600"/>
  <br/>
  <em>Application hero image</em>
</p>

Additional screenshot placeholders (suggested locations for documentation images):

| Screenshot | Suggested Path | Description |
|-----------|----------------|-------------|
| Dashboard | `docs/images/dashboard.png` | Student dashboard with upcoming/live/past exams |
| Exam Workspace | `docs/images/exam-workspace.png` | Active exam with MCQ, coding editor, and subjective editor |
| Admin Monitor | `docs/images/admin-monitor.png` | Live proctoring monitor with violation breakdown |
| Analytics | `docs/images/analytics.png` | Exam analytics dashboard with scores and leaderboard |
| Import Preview | `docs/images/import-preview.png` | LaTeX/ZIP import preview before confirmation |

---

## Testing

### Backend tests

The backend uses **pytest** with 29 tests across 5 test files:

```bash
cd backend
pytest -v
```

| Test file | Coverage | Focus |
|-----------|----------|-------|
| `tests/test_models.py` | Model CRUD, cascade deletes | Student and Exam ORM operations |
| `tests/test_auth.py` | Authentication flow, rate limiting, session revocation | Join, logout, refresh, update-password |
| `tests/test_admin.py` | Admin verification, exam CRUD validation | Auth guard, payload validation |
| `tests/test_evaluate.py` | Evaluation endpoints | List, detail, save, clear, review |

Test infrastructure uses:
- **SQLite in-memory database** (ephemeral per test run)
- **httpx TestClient** for async HTTP requests
- **pytest-asyncio** for async test support
- **pytest-cov** for coverage measurement

### Frontend tests

There are currently **no automated frontend tests** in the repository.

---

## Known Limitations

The following limitations have been verified from the codebase:

1. **Code execution is a stub** — The `/exam/{exam_id}/run` endpoint returns `{"detail": "Code execution unavailable. Feature pending."}`. Coding problem evaluation is performed manually by administrators.

2. **No automated frontend tests** — The frontend codebase does not include unit or integration tests.

3. **No Docker/CI pipeline** — The repository does not contain Dockerfiles, `docker-compose.yml`, or GitHub Actions workflow files. Deployment is managed directly through Render's platform.

4. **No dark mode** — The UI uses a light color scheme only (configured in `tailwind.config.js`).

5. **TikZ picture rendering** — `\begin{tikzpicture}` blocks in LaTeX question imports are replaced with a `*[Diagram: see printed question paper]*` placeholder.

6. **No license specified** — The repository does not include a `LICENSE` file.

> **Note:** These limitations are based on the current state of the repository and may change as the project evolves.

---

## Roadmap

The following improvements are evident from the codebase as planned or partially implemented:

- [ ] **Code execution integration** — The `/exam/{id}/run` endpoint exists as a stub, suggesting plans for server-side code compilation and execution.
- [ ] **Automated coding evaluation** — The evaluation data model supports `coding_evaluation` storage, indicating future automated grading capabilities.
- [ ] **Expanded proctoring models** — The engine architecture supports adding new detection models beyond the current COCO-SSD + MediaPipe setup.
- [ ] **Dark mode support** — Design system tokens are centralized in `tailwind.config.js`, making theme extension straightforward.

> **Note:** This roadmap reflects features that are either partially implemented (stubs, data model fields) or naturally suggested by the architecture. No formal roadmap document exists in the repository.

---

## Contributing

Contributions are welcome. To contribute:

1. **Fork** the repository.
2. **Create a feature branch** (`git checkout -b feature/your-feature`).
3. **Make your changes** following the existing code style:
   - Backend: Python type hints, Pydantic validation, SQLAlchemy ORM patterns.
   - Frontend: React functional components, Tailwind CSS, Zustand for state, Axios for HTTP.
4. **Run tests** to ensure no regressions:
   ```bash
   cd backend && pytest
   ```
5. **Build the frontend** to verify no compilation errors:
   ```bash
   cd frontend && npm run build
   ```
6. **Commit your changes** with a descriptive message.
7. **Push to your fork** and submit a pull request.

### Pull request guidelines

- Keep PRs focused on a single concern.
- Include a clear description of the change and its motivation.
- Reference any related issues.
- Ensure all existing tests pass.
- Add tests for new functionality where applicable.

### Code style

- **Python**: Follow [PEP 8](https://www.python.org/dev/peps/pep-0008/) with type hints.
- **JavaScript/JSX**: The project uses ESLint flat config — run `npx eslint .` to check.
- **CSS**: Use Tailwind utility classes; avoid custom CSS where possible.

---

## License

License information not found. The repository does not include a `LICENSE` file.

---

<div align="center">
  <sub>Built with React, FastAPI, and TensorFlow.js</sub>
  <br/>
  <sub>LIAS — Learning Integrated Assessment System</sub>
</div>
