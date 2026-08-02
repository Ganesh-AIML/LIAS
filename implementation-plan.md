# LIAS — Faculty Role & Module-Based Authorization: Implementation Plan

## 1. Objective

Establish a secure **Admin + Faculty role system** with **module-based authorization** in LIAS:

- **ADMIN** → global access to all modules, exams, students, results, evaluations (existing behavior preserved).
- **FACULTY** → assigned to exactly ONE module; full existing exam-management capability **within that module only**.
- Multiple faculty per module; cross-module access blocked server-side.
- Faculty **cannot self-assign a module** (registration excludes module; admin assigns later).
- This phase builds the auth foundation + authorization + module scoping. Faculty UI is a minimal portal (identity + module + logout) **plus module-scoped access to existing exam-management views** — no new dashboard features.

## 2. Current Architecture Findings (verified)

**Backend**
- Admin auth: `backend/app/routes/admin.py:66-73` — `verify_admin` compares `X-Admin-Token` header to static `ADMIN_SECRET` env var (`secrets.compare_digest`). Used by all 32 admin routes + 5 evaluate routes via `Depends(verify_admin)`. No accounts, no DB identity.
- Student auth: `backend/app/auth.py` — HS256 JWT (`JWT_SECRET_KEY`, `JWT_EXPIRY_SECONDS` default 7200). `verify_session_guard` requires `session_id` claim and validates against `ExamSession` DB row on **every request** (instant revocation).
- Password standard: bcrypt `hashpw(..., gensalt(rounds=12))` + `checkpw` (24 existing call sites).
- Models: `backend/app/models.py` — 10 tables (`Student`, `TokenRegistry`, `Exam`, `ExamSession`, `ViolationLog`, `Question`, `CodingProblem`, `TestCase`, `SubjectiveQuestion`, `Section`). **No StaffAccount / faculty / module entity exists.**
- `Exam` (`models.py:37-57`): id, title, duration_seconds, starts_at, password hashes, status, secrets, section duration columns. **No module field, no creator field.**
- Migrations: **no Alembic**. Additive `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `main.py` lifespan (`main.py:19-50` + `_run_additive_migrations` at 70-175).
- Routers (`main.py:65-68`): `/auth`, `/exam`, `/admin` (admin.py), `/admin` (evaluate.py).
- Env: `ADMIN_SECRET`, `JWT_SECRET_KEY`, `DATABASE_URL`, `DB_ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, `JWT_EXPIRY_SECONDS`, `FRONTEND_BASE_URL` (`backend/.env.example`).
- CORS already allows `Authorization` header (`main.py:62`).

**Frontend**
- `frontend/src/pages/admin/AdminDashboard.jsx` — inline `AdminLoginGate` (16-77, single token field, `fetch` to `/admin/verify`), `isAuthed` from `sessionStorage['lias_admin_token']` (81), logout removes key (137). View state machine: `main|schedule|live|preview|analytics|directory` (84).
- `frontend/src/hooks/useAdminApi.js` — fetch wrapper; sends `X-Admin-Token` from sessionStorage (14-17); 20s cache.
- Student auth separate: `store/authStore.js` (Zustand), `services/api.js` (axios, Bearer interceptor).
- Exam list UI: `views/AdminMainView.jsx` (polls `/admin/exams`); builder: `views/ScheduleTest.jsx`; directory: `views/StudentDirectory.jsx`; analytics: `views/AnalyticsView.jsx`.
- Design language: Tailwind, white cards `rounded-2xl`, blue-900 CTAs, uppercase micro-labels, lucide icons.

**Tests** (`backend/tests/`)
- `conftest.py:17-20` sets env (incl. `ADMIN_SECRET`), temp SQLite, `setup_database` create/drop per test, `client` fixture via TestClient (lifespan runs).
- 16 header call sites use `headers={"X-Admin-Token": admin_secret}` (test_admin.py ×9, test_evaluate.py ×7).

## 3. Current Authentication Flow

1. Admin enters token in `AdminLoginGate` → `GET /admin/verify` with `X-Admin-Token` → backend `compare_digest` vs `ADMIN_SECRET` → token stored in `sessionStorage['lias_admin_token']` → local `isAuthed` state.
2. Every admin API call attaches the token header; `verify_admin` runs per route.
3. Student flow (untouched): bcrypt token+password → `ExamSession` row → JWT → DB-verified per request.

**Conclusion: the previously approved Admin/Faculty auth foundation was never implemented (git log — no auth commits). It must be built in this phase.**

## 4. Proposed Role Model

```
staff_accounts (new table)
  id VARCHAR PK
  name VARCHAR NULL            -- faculty name; admin may be null
  email VARCHAR UNIQUE NOT NULL
  password_hash VARCHAR NOT NULL  -- bcrypt rounds=12
  role VARCHAR NOT NULL        -- 'admin' | 'faculty'
  module VARCHAR NULL          -- module name string; NULL = pending/unassigned
  created_at FLOAT
```

- Roles: `ADMIN` (global), `FACULTY` (one module). No other roles.
- **Module = string** on `staff_accounts.module` and `exams.module` (smallest schema change; a `Module` table adds admin CRUD UI with no requirement benefit). Admin picks module names from a server-derived distinct list.

## 5. Proposed Faculty Registration Flow

- **Public** `POST /admin/auth/register` — body: `{name, email, password}` (module NOT accepted).
- Validation: name non-empty ≤200; email regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` (no new dependency); password 4–256 (existing repo standard).
- Duplicate email → `409 "An account with this email already exists."`
- Stored with `role='faculty'`, `module=NULL` (pending), bcrypt `rounds=12`.
- Response: `{success, message}` — no auto-login, no token, no hash.

## 6. Proposed Faculty Module Assignment Flow

- **Admin-only** endpoints (mirrors existing Admin→Student→Exam assignment pattern):
  - `GET /admin/staff` — list staff `{id, name, email, role, module, created_at}` (no hashes).
  - `PUT /admin/staff/{staff_id}` — body `{module: str|null}`: assign, reassign, or clear (`null`) a module.
  - `GET /admin/modules` — distinct module names from `staff_accounts.module ∪ exams.module` (dropdown source).
- UI: new admin view `FacultyManagement.jsx` — list faculty, current module, dropdown assign/save, pending list (module NULL).

## 7. Admin Permissions

- All 32 existing admin routes + 5 evaluate routes → unchanged behavior, global access.
- Legacy `module=NULL` exams visible to admin only (safe default).
- Module badges shown on exam cards in `AdminMainView.jsx`.
- New admin-only endpoints: `GET /admin/staff`, `PUT /admin/staff/{id}`, `GET /admin/modules`.
- Global Master Directory CRUD stays admin-only.

## 8. Faculty Permissions

- Within `faculty.module` only: create exam, edit/manage exam, monitor, view results, view analytics, evaluate coding/subjective, leaderboard, assign students, manage per-exam credentials.
- All enforced server-side via `require_exam_scope(staff, exam)` + module filters.
- **Not granted**: global master-directory create/edit/delete/reset, cross-module anything, admin-only endpoints.

## 9. Module-Based Authorization Rules

- `verify_admin` reworked (`admin.py:66-73`):
  1. `Authorization: Bearer <staff JWT>` → decode → load `StaffAccount` by `id` from DB → return `{id, role, module, name, email}`. **Role/module always from DB** (never from JWT claims or frontend).
  2. Legacy `X-Admin-Token` accepted **only during bootstrap window** (zero admin rows exist) → prevents production lockout.
- `require_exam_scope(staff, exam)`: admin → allow; faculty → `403` unless `exam.module == staff.module`.
- List endpoints (`GET /admin/exams`, `/admin/exams/active`): faculty → `WHERE module == staff.module`.
- Pending faculty (`module=NULL`): empty lists; `403 "No module assigned. Contact an administrator."` on any scoped operation.

## 10. Exam → Module Mapping

- `ExamCreatePayload` gains optional `module` (≤100 chars).
- Faculty create/update: `module = staff.module` **forced server-side**; payload module ignored.
- Admin create/update: `module = payload.module` (nullable).
- No frontend-supplied module is trusted for faculty.

## 11. Faculty Student-Management Scope

- **Allowed**: `GET /admin/master-students` (enrollments filtered to module exams), `POST /admin/exams/{id}/assign` (scope-checked), `GET/POST /admin/students` with module exam `exam_id`, `PUT/DELETE /admin/students/{token}` (scope via token→exam), `POST /admin/students/bulk-delete` (scope-checked).
- **Forbidden (admin-only)**: `POST /admin/master-students`, `/bulk`, `PUT`, `DELETE`, `reset-and-resync`.
- Master Directory remains a single global registry (no per-module duplication).

## 12. Pending Faculty Behaviour

- Registration → `module=NULL`.
- Login succeeds (valid credentials) → `GET /admin/verify` returns `role='faculty'`, `module=null` → frontend shows **"Module assignment pending — contact an administrator."**
- No module-scoped data visible; no all-module fallback.

## 13. Database Impact

**Schema changes required: YES (minimum):**
1. **New table** `staff_accounts` (created by `create_all`, no migration).
2. **One additive migration** in `main.py` lifespan: `ALTER TABLE exams ADD COLUMN IF NOT EXISTS module VARCHAR;`
3. **Seed block** (lifespan): if `COUNT(role='admin') == 0` and `ADMIN_EMAIL`/`ADMIN_PASSWORD` env set → create admin (bcrypt, no plaintext, no logging).
4. **No data migration** — existing exams get `module=NULL` (admin-visible; faculty invisible until assigned).

## 14. Backend Changes Required

| File | Change |
|---|---|
| `backend/app/models.py` | + `StaffAccount`; + `Exam.module` column |
| `backend/app/auth.py` | + `create_staff_jwt()` (sub=staff_id), `decode_staff_jwt()`, `staff_bearer` |
| `backend/app/routes/staff_auth.py` | NEW: `POST /admin/auth/login`, `POST /admin/auth/faculty-login`, `POST /admin/auth/register` (all rate-limited, generic 401s) |
| `backend/app/routes/admin.py` | Rework `verify_admin`; + `require_exam_scope`; wire scope checks (see §API impact); + `GET /admin/staff`, `PUT /admin/staff/{id}`, `GET /admin/modules` |
| `backend/app/routes/evaluate.py` | 5 endpoints: scope check on `exam_id` |
| `backend/app/main.py` | Register `staff_auth` router; `exams.module` migration; admin seed |
| `backend/.env.example` | + `ADMIN_EMAIL=`, `ADMIN_PASSWORD=` |

**Scope-check wiring (admin.py)**: `GET/PUT/DELETE /exams/{id}`, `/analytics`, `/monitor`, `/active` (filter), `POST /exams` (module rules), `POST /sessions/revoke|grant` (via session→exam), `GET/POST /students` (+`/bulk-delete`, `PUT/DELETE /students/{token}`), `POST /exams/{id}/assign`, `GET /master-students` (enrollment filter).

## 15. Frontend Changes Required

| File | Change |
|---|---|
| `frontend/src/hooks/useAdminApi.js` | `Authorization: Bearer <jwt>` from `sessionStorage['lias_staff_jwt']` |
| `frontend/src/pages/admin/AuthPage.jsx` | NEW — role toggle; admin login (email+password); faculty login/register tabs; validation, loading, errors |
| `frontend/src/pages/admin/AdminDashboard.jsx` | Use AuthPage; read role+module; logout clears new keys; reload validates via `/admin/verify`; role-aware nav |
| `frontend/src/pages/admin/FacultyPortal.jsx` | NEW — landing shell: identity card (name, role, assigned module), logout, pending state (module NULL), and navigation into **module-scoped** existing views: Manage Exams (`AdminMainView`), Schedule (`ScheduleTest`), Student Directory (`StudentDirectory`), Analytics (`AnalyticsView`), Live Monitor, Results/Leaderboard |
| `frontend/src/pages/admin/views/FacultyManagement.jsx` | NEW — admin: staff list + module assign/reassign/clear |
| `frontend/src/pages/admin/views/AdminMainView.jsx` | Module badge on exam cards |
| `frontend/src/pages/admin/views/ScheduleTest.jsx` | Module selector (admin dropdown / faculty read-only) |
| `frontend/src/pages/admin/views/StudentDirectory.jsx` | Module label on exam dropdown |

## 16. Security Model

- **Passwords**: bcrypt `rounds=12`; never plaintext, never logged, never returned.
- **JWT/session**: staff JWT carries only `sub`; role+module re-read from DB per request (same pattern as student `verify_session_guard`) → revocation/module-change immediate; JWT tampering inert (HS256 signature).
- **Horizontal escalation / IDOR**: every scoped endpoint fetches the resource row, then `require_exam_scope` before read/write; direct ID access (URL/query/body) blocked.
- **Module tampering**: faculty module from DB only; `payload.module` ignored for faculty.
- **Admin protection**: `verify_admin` requires DB role `admin`; faculty JWT → 403 on admin routes; student JWT (no staff sub) → 403.
- **No enumeration**: same 401 for unknown email/wrong password.
- **Rate limits**: login 10/min, register 10/min (slowapi, existing pattern).

## 17. Backward Compatibility

- All existing admin routes keep `Depends(verify_admin)` — internals only.
- Legacy `ADMIN_SECRET` works until first admin seeded (bootstrap window) → no lockout; then permanently disabled.
- Student auth, exam engine, submission, proctoring, question rendering, analytics, evaluation logic: untouched.
- Legacy `module=NULL` exams: admin-visible; faculty-invisible until admin assigns a module (documented, deliberate).
- Existing 29 tests: mechanical header swap to `admin_headers` fixture (admin = global scope).

## 18. Edge Cases

| Case | Behavior |
|---|---|
| Faculty with no module | Login OK; pending banner; empty lists; 403 on scoped ops |
| Faculty module reassigned | Immediate (DB lookup per request); old exams remain in old module; faculty sees new module only |
| Faculty deleted/deactivated | JWT lookup fails → 401; no fallback |
| Module "deleted" (cleared) | Faculty → pending; exams keep old module string (admin-only) |
| Multiple faculty per module | All see all module exams (module match, not creator) |
| Existing exams without module | Admin-only until assigned |
| Cross-module access attempt | 403 on every scoped endpoint |
| Faculty creates exam for another module | `payload.module` ignored; stored = own module |
| ID manipulation (GET/PUT/DELETE by ID) | 403 before any read/write |
| Expired staff JWT | 401 → frontend clears storage → AuthPage |
| Admin account migration | Seed from env; legacy token disabled after first admin |
| Duplicate faculty registration | 409 |

## 19. Testing Strategy

- **New `test_staff_auth.py`**: admin login (valid/wrong pw/unknown email/empty/invalid email); faculty register (valid/duplicate/invalid email/missing fields/short password/hash via `bcrypt.checkpw`); faculty login; role mismatch both directions; pending login; refresh (`/admin/verify` returns role+module).
- **New `test_module_scope.py`**: faculty list scope; cross-module GET/PUT/DELETE → 403 (exams, analytics, monitor, evaluate ×5, sessions revoke/grant, students, assign); faculty create with forged module → own module stored; faculty A creates → faculty B (same module) sees; admin sees all incl. NULL-module; NULL-module faculty blocked; master-students enrollment filter; global CRUD → 403 for faculty.
- **Auth/API security**: direct requests with other module's IDs; no-token → 401/403; student JWT → 403; legacy bootstrap window before/after seed.
- **Frontend**: `npm run build`; manual matrix (login/validation/loading/errors, pending state, module badge, faculty scoped nav, logout, reload persistence).
- **Regression**: all 29 existing backend tests (header swap only); existing admin UI flows.

## 20. Files Requiring Modification

- **Backend**: `models.py`, `auth.py`, `routes/admin.py`, `routes/evaluate.py`, `routes/staff_auth.py` (new), `main.py`, `.env.example`
- **Frontend**: `hooks/useAdminApi.js`, `pages/admin/AdminDashboard.jsx`, `pages/admin/AuthPage.jsx` (new), `pages/admin/FacultyPortal.jsx` (new), `pages/admin/views/FacultyManagement.jsx` (new), `pages/admin/views/AdminMainView.jsx`, `pages/admin/views/ScheduleTest.jsx`, `pages/admin/views/StudentDirectory.jsx`
- **Database/Migrations**: lifespan in `main.py` (`exams.module` + seed)
- **Configuration**: `backend/.env.example`; `backend/tests/conftest.py` (+ fixtures), `tests/test_admin.py`, `tests/test_evaluate.py`, new test files

## 21. Files That Must Remain Untouched

- Student auth: `routes/auth.py`, `store/authStore.js`, `services/api.js`, `pages/StudentAuth.jsx`
- Exam workspace/proctoring: `routes/exam.py`, socket code in `main.py`, `ExamWorkspace`, `LiveTestMonitor` internals, `PreExamCheck`
- Question/TeX import: `TexZipImporter`, question rendering components
- Analytics/evaluation business logic: `AnalyticsView` computations, `CodingEvaluator`, `SubjectiveEvaluator` internals
- `questions.tex`, templates, README

## 22. Implementation Sequence

1. `models.py` → StaffAccount + Exam.module
2. `auth.py` → staff JWT helpers
3. `main.py` → migration + seed + router registration
4. `staff_auth.py` → 3 auth endpoints
5. `admin.py`/`evaluate.py` → verify_admin rework + scope checks + staff/module endpoints
6. Tests → conftest fixtures, header swap, new test files; run `pytest`
7. Frontend → `useAdminApi.js`, `AuthPage`, `AdminDashboard`, `FacultyPortal`, `FacultyManagement`, badges; run `npm run build`
8. Full regression + manual verification

## 23. Rollback Strategy

- **Per phase**: each step is a separate commit → revert individually.
- **DB**: `exams.module` + `staff_accounts` are additive; drop column/table or leave unused — zero impact on existing data.
- **Auth swap**: keep `verify_admin` wrapper (JWT + bootstrap window) so reverting to pure legacy token = one small edit; legacy path still functional until admin seed.
- **Frontend**: `AuthPage` replaces gate in one commit; revert restores old gate.

## 24. Risk Assessment

| Change | Risk | Impact | Mitigation |
|---|---|---|---|
| verify_admin rework | Medium — 32 routes depend on it | Total admin lockout if broken | Bootstrap window; keep signature; test first |
| Seed env vars missing at deploy | High — no admin | Lockout | Legacy token active until first admin seeded; document deploy step |
| Scope check missed on one endpoint | High — cross-module leak | Data exposure | Explicit endpoint checklist + direct-ID tests for every scoped route |
| Frontend key rename | Low — stale `lias_admin_token` | Dead state | Clear old key on mount |
| Faculty UI ambiguity | Medium — scope creep or gap | Wrong portal behavior | Minimal portal shell + scoped reuse of existing views; confirm in §25 |

## 25. Human Confirmation Required (RESOLVED)

Confirmed by project owner before implementation:

1. **Faculty portal**: minimal portal (name/role/module/logout) **plus module-scoped access to existing exam-management views** — no new dashboard features; backend scoping fully implemented and API-tested.
2. **Module representation**: free-form string on `staff_accounts.module` + `exams.module`; admin dropdown sourced from `GET /admin/modules`.
3. **Legacy exams**: `module=NULL` → admin-only until admin assigns a module.
4. **Global master-directory CRUD stays admin-only**; faculty get exam-scoped student management.
5. **Admin seed env vars**: `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
