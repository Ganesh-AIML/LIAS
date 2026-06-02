When executing any task in this plan: read the relevant existing file completely 
before writing any code. Never assume a file's contents from context — always verify. 
If a find/replace target string is not found exactly, stop and report it rather than 
guessing or rewriting the whole file.



Full codebase read. Now generating the complete plan.

---

# LIAS — Full Implementation Plan

## Section 1 — Directory Restructure

### Current structure (problems)
- All admin pages are files but `ExamAnalytics.jsx`, `ExamManager.jsx`, `LiveMonitor.jsx`, `StudentManager.jsx` are empty — dead files
- `admin_models.py` is a separate file but contains no models (it's empty) — confusing name
- `assets/react.svg`, `assets/vite.svg` — Vite boilerplate, never used
- `App.css` — unused, Tailwind project shouldn't have this
- All admin views crammed into one 686-line `AdminDashboard.jsx` — not maintainable
- No `components/` directory — shared UI like `Modal`, `Field`, `StatusBadge` live inline
- No `hooks/` coverage — `adminApi` helper is inline fetch wrapper, not a proper hook
- Backend has `admin_models.py` that is empty and serves no purpose

### Target structure

```
LIAS/
├── backend/
│   ├── app/
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── exam.py
│   │   │   └── admin.py
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── database.py
│   │   ├── limiter.py
│   │   ├── main.py
│   │   └── models.py          ← DELETE admin_models.py (empty)
│   ├── .env
│   ├── .env.example
│   └── requirements.txt
│
└── frontend/
    ├── public/
    │   ├── favicon.svg
    │   └── icons.svg
    ├── src/
    │   ├── assets/
    │   │   └── hero.png       ← DELETE react.svg, vite.svg
    │   ├── components/        ← NEW: shared UI components
    │   │   ├── ui/
    │   │   │   ├── Modal.jsx
    │   │   │   ├── Field.jsx
    │   │   │   └── StatusBadge.jsx
    │   │   └── admin/
    │   │       └── AdminNav.jsx
    │   ├── hooks/
    │   │   ├── useTrueTime.js
    │   │   └── useAdminApi.js  ← NEW: extract adminApi helper
    │   ├── pages/
    │   │   ├── StudentAuth.jsx
    │   │   ├── PreExamCheck.jsx
    │   │   ├── StudentDashboard.jsx
    │   │   ├── ExamWorkspace.jsx
    │   │   └── admin/
    │   │       ├── AdminDashboard.jsx  ← thin shell: auth gate + layout only
    │   │       ├── ExamManager.jsx     ← extracted ExamManagerView
    │   │       ├── StudentManager.jsx  ← extracted StudentManagerView
    │   │       ├── LiveMonitor.jsx     ← extracted LiveMonitorView
    │   │       └── ExamAnalytics.jsx   ← new: post-exam analytics
    │   ├── services/
    │   │   └── api.js
    │   ├── store/
    │   │   └── authStore.js
    │   ├── App.jsx
    │   ├── App.css            ← DELETE (unused in Tailwind project)
    │   ├── index.css
    │   └── main.jsx
    ├── .env
    ├── eslint.config.js
    ├── index.html
    ├── package.json
    ├── postcss.config.js
    ├── tailwind.config.js
    └── vite.config.js
```

---

## Section 2 — What's Already Built (Do Not Rebuild)

| Area | Status |
|---|---|
| Student auth flow (login → precheck → dashboard → exam) | ✅ Complete |
| Backend auth routes (`/auth/join`, `/auth/logout`, `/auth/update-password`) | ✅ Complete |
| Backend exam routes (`/exam/violation`, `/exam/violation/count`, `/exam/{id}`, `/exam/{id}/submit`, `/exam/{id}/verify-password`) | ✅ Complete |
| Backend admin routes (list/create/update/delete exams, list/add/update/remove students, live monitor, revoke session, sync time) | ✅ Complete |
| Admin frontend (login gate, exam manager, student manager, live monitor) | ✅ Complete — needs extraction only |
| Socket.IO time sync | ✅ Complete |
| DB models (TokenRegistry, Exam, ExamSession, ViolationLog) | ✅ Complete |

---

## Section 3 — What Is Missing (Must Build)

### 3.1 Exam Link Generation (Teacher Workflow)

**The gap:** Teacher creates an exam → gets an `exam_id` back → but no shareable link is generated or shown. Students have no way to receive a link that pre-fills their token.

**What needs to be built:**

**Backend — `routes/admin.py`**

Add a new endpoint after `create_exam`:

```
POST /admin/exams/{exam_id}/generate-links
```

Request body:
```json
{ "student_tokens": ["LIAS_Ganesh", "LIAS_Pragya"] }
```

Response:
```json
{
  "success": true,
  "links": [
    {
      "student_id": "Ganesh",
      "token": "LIAS_Ganesh",
      "link": "https://yoursite.com/?token=LIAS_Ganesh&exam=exam_789"
    }
  ]
}
```

Logic: query `TokenRegistry` for each token, validate it belongs to the exam, return the constructed URL. The `FRONTEND_URL` is read from env var `FRONTEND_BASE_URL`.

**Backend — `models.py`**

No new model needed. Links are constructed on the fly from existing `TokenRegistry` data.

**Frontend — `StudentAuth.jsx`**

Read URL params on mount and pre-fill the token field:

```javascript
// On component mount
const params = new URLSearchParams(window.location.search);
const urlToken = params.get('token');
const urlExam  = params.get('exam');
if (urlToken) setToken(urlToken);
// exam param is informational — actual exam_id comes from server after auth
```

**Frontend — `ExamManager.jsx`** (after extraction)

After exam creation succeeds, show a "Generate Links" panel:
- Button: "Generate Student Links"
- Calls `POST /admin/exams/{id}/generate-links` with all enrolled student tokens
- Shows a list of student name + copyable link
- "Copy All" button copies all links as a formatted list for pasting into email/WhatsApp

---

### 3.2 Admin Auth — Proper Token Storage

**The gap:** `sessionStorage.getItem('lias_admin_token')` is used inline everywhere. If browser restores session, the admin token is gone.

**Fix:** Extract to `useAdminApi.js` hook (see Section 4).

---

### 3.3 Exam Analytics Page

**The gap:** `ExamAnalytics.jsx` is empty. After exam ends, teacher needs to view results.

**Backend — `routes/admin.py`**

Add:
```
GET /admin/exams/{exam_id}/analytics
```

Response:
```json
{
  "success": true,
  "data": {
    "exam_id": "exam_789",
    "title": "...",
    "total_enrolled": 10,
    "total_submitted": 8,
    "total_violations": 24,
    "violation_breakdown": {
      "tab_switch": 10,
      "face_absent": 8,
      "fullscreen_exit": 6
    },
    "students": [
      {
        "student_id": "Ganesh",
        "submitted": true,
        "total_violations": 2,
        "violation_detail": { "tab_switch": 2 },
        "joined_at": 1716000000
      }
    ]
  }
}
```

Logic: single query joining `ExamSession` + `ViolationLog` with GROUP BY — no N+1.

**Frontend — `ExamAnalytics.jsx`**

Build the analytics view with:
- KPI cards: enrolled / submitted / violation rate
- Per-student table: student ID, submitted, violation count, flagged (>= MAX_VIOLATIONS)
- Violation breakdown bar chart (CSS only, no chart library needed)
- Export CSV button: generates client-side CSV from the response data

---

### 3.4 Admin Route Fix in `main.py`

**The gap:** `main.py` has a duplicate route `@fastapi_app.post("/admin/exam/{exam_id}/update-time")` that does the same thing as `POST /admin/exams/{exam_id}/sync-time` in `admin.py`. The route in `main.py` also allows `DELETE` method is missing from CORS. Keep only the one in `admin.py`, delete the one in `main.py`.

Also `allow_methods` in CORS is missing `DELETE` — admin routes use `DELETE`. Fix:
```python
allow_methods=["GET", "POST", "PUT", "DELETE"],
```

---

### 3.5 `admin_models.py` — Delete

File is empty. Delete it. Nothing imports it.

---

## Section 4 — Extraction Tasks (Refactoring, No New Logic)

### 4.1 `src/hooks/useAdminApi.js` — NEW FILE

Extract the inline `adminApi` object and `adminHeaders` function from `AdminDashboard.jsx` into this hook. Every admin page imports from here.

```javascript
// src/hooks/useAdminApi.js
const BASE = import.meta.env.VITE_API_URL;

function adminHeaders() {
  const token = sessionStorage.getItem('lias_admin_token') || '';
  return { 'Content-Type': 'application/json', 'X-Admin-Token': token };
}

export const adminApi = {
  get:    (path)       => fetch(`${BASE}${path}`, { headers: adminHeaders() }).then(r => r.json()),
  post:   (path, body) => fetch(`${BASE}${path}`, { method: 'POST',   headers: adminHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
  put:    (path, body) => fetch(`${BASE}${path}`, { method: 'PUT',    headers: adminHeaders(), body: JSON.stringify(body) }).then(r => r.json()),
  delete: (path)       => fetch(`${BASE}${path}`, { method: 'DELETE', headers: adminHeaders() }).then(r => r.json()),
};
```

### 4.2 `src/components/ui/Modal.jsx` — NEW FILE

Extract `Modal` component from `AdminDashboard.jsx`. Import in all admin pages.

### 4.3 `src/components/ui/Field.jsx` — NEW FILE

Extract `Field` component from `AdminDashboard.jsx`.

### 4.4 `src/components/ui/StatusBadge.jsx` — NEW FILE

Extract `StatusBadge` component from `AdminDashboard.jsx`.

### 4.5 `src/pages/admin/ExamManager.jsx` — POPULATE

Move `ExamManagerView` function body from `AdminDashboard.jsx` into this file as the default export. Add the "Generate Links" feature (Section 3.1) inside it.

Imports needed:
```javascript
import { adminApi } from '../../hooks/useAdminApi';
import Modal from '../../components/ui/Modal';
import Field from '../../components/ui/Field';
import StatusBadge from '../../components/ui/StatusBadge';
```

### 4.6 `src/pages/admin/StudentManager.jsx` — POPULATE

Move `StudentManagerView` from `AdminDashboard.jsx` into this file as default export.

### 4.7 `src/pages/admin/LiveMonitor.jsx` — POPULATE

Move `LiveMonitorView` from `AdminDashboard.jsx` into this file as default export.

### 4.8 `src/pages/admin/AdminDashboard.jsx` — SLIM DOWN

After extraction, `AdminDashboard.jsx` should only contain:
- `AdminLoginGate` component
- `NAV` array
- `AdminDashboard` default export (auth gate + layout shell + tab routing)
- Nothing else — all views imported from their own files

Target line count: ~100 lines.

---

## Section 5 — `App.jsx` Route Additions

Add analytics route:

```javascript
import ExamAnalytics from './pages/admin/ExamAnalytics';

// Inside Routes:
<Route path="/admin/analytics/:examId" element={<AdminAnalyticsGuard><ExamAnalytics /></AdminAnalyticsGuard>} />
```

`AdminAnalyticsGuard` checks `sessionStorage.getItem('lias_admin_token')` — same pattern as existing admin route. If no token, redirect to `/admin`.

---

## Section 6 — Backend `main.py` Cleanup

**Find and DELETE this entire block** (duplicate of admin.py sync-time route):
```python
@fastapi_app.post("/admin/exam/{exam_id}/update-time", tags=["Admin Controls"])
async def update_exam_time(
    exam_id: str,
    new_duration: int,
    x_admin_token: str = Header(None),
):
    if (
        not ADMIN_SECRET
        or not x_admin_token
        or not secrets.compare_digest(x_admin_token, ADMIN_SECRET)
    ):
        raise HTTPException(status_code=403, detail="Unauthorized")
    await sio.emit("exam_time_synced", {"duration": new_duration}, room=exam_id)
    return {"success": True}
```

**Find:**
```python
from fastapi import FastAPI, Header, HTTPException, Request
```
**Replace with:**
```python
from fastapi import FastAPI, Request
```
(`Header` and `HTTPException` no longer needed in main.py after route deletion.)

**Find:**
```python
allow_methods=["GET", "POST", "PUT"],
```
**Replace with:**
```python
allow_methods=["GET", "POST", "PUT", "DELETE"],
```

**Find (duplicate import):**
```python
from app.routes import auth, exam
```
The second occurrence — delete it. It appears twice in the current `main.py`.

---

## Section 7 — `.env` Additions

Add to `backend/.env`:
```
FRONTEND_BASE_URL=http://localhost:5173
```

Add to `backend/.env.example`:
```
FRONTEND_BASE_URL=https://yoursite.com
```

Used by the link generator endpoint.

---

## Section 8 — Execution Order for Developer

Follow this exact order to avoid breaking the running system:

1. **Delete dead files:** `admin_models.py`, `App.css`, `assets/react.svg`, `assets/vite.svg`, empty admin page files
2. **Create shared components:** `Modal.jsx`, `Field.jsx`, `StatusBadge.jsx`
3. **Create `useAdminApi.js` hook**
4. **Populate `ExamManager.jsx`, `StudentManager.jsx`, `LiveMonitor.jsx`** by moving from `AdminDashboard.jsx`
5. **Slim down `AdminDashboard.jsx`** to shell only — import the three extracted views
6. **Fix `main.py`:** delete duplicate route, fix CORS, remove duplicate import
7. **Add `.env` vars**
8. **Add link generation endpoint** to `routes/admin.py`
9. **Add analytics endpoint** to `routes/admin.py`
10. **Add URL param pre-fill** to `StudentAuth.jsx`
11. **Add "Generate Links" UI** to `ExamManager.jsx`
12. **Build `ExamAnalytics.jsx`**
13. **Add analytics route** to `App.jsx`
14. **Test full flow:** teacher creates exam → generates links → shares link → student clicks → pre-filled login → dashboard → exam

---

## Section 9 — Files Changed Summary

| File | Action |
|---|---|
| `backend/app/admin_models.py` | DELETE |
| `backend/app/main.py` | Remove duplicate route, fix CORS, remove duplicate import |
| `backend/app/routes/admin.py` | Add `/generate-links` endpoint, add `/analytics` endpoint |
| `backend/.env` + `.env.example` | Add `FRONTEND_BASE_URL` |
| `frontend/src/App.css` | DELETE |
| `frontend/src/assets/react.svg` | DELETE |
| `frontend/src/assets/vite.svg` | DELETE |
| `frontend/src/pages/admin/ExamAnalytics.jsx` | BUILD from scratch |
| `frontend/src/pages/admin/ExamManager.jsx` | POPULATE (extract + add link gen UI) |
| `frontend/src/pages/admin/StudentManager.jsx` | POPULATE (extract) |
| `frontend/src/pages/admin/LiveMonitor.jsx` | POPULATE (extract) |
| `frontend/src/pages/admin/AdminDashboard.jsx` | SLIM DOWN to shell |
| `frontend/src/components/ui/Modal.jsx` | NEW |
| `frontend/src/components/ui/Field.jsx` | NEW |
| `frontend/src/components/ui/StatusBadge.jsx` | NEW |
| `frontend/src/hooks/useAdminApi.js` | NEW |
| `frontend/src/pages/StudentAuth.jsx` | Add URL param pre-fill |
| `frontend/src/App.jsx` | Add analytics route + guard |



## Code Quality Standards

- No inline anonymous functions in JSX props that cause re-renders (e.g. onClick={() => fn()} inside lists — use useCallback or extract handler)
- No `any` implicit types — every function param and return must be intentional
- No `console.log` left in production code — use `console.warn` only for genuine degraded-state warnings
- No `alert()` or `confirm()` in production UI — replace with Modal component
- Every async function must have try/catch — no unhandled promise rejections
- No magic numbers — extract to named constants at top of file (e.g. POLL_INTERVAL_MS = 60000)
- Every useEffect must have a correct dependency array — no empty array shortcuts unless intentional with comment explaining why
- Every fetch/api call must handle both success=false and network error separately
- No optional chaining chains longer than 3 levels (e.g. a?.b?.c?.d?.e is a smell — restructure)

## Component Rules

- Each file exports exactly one default component — no multi-component files except co-located sub-components under 50 lines
- Props must be destructured at function signature level, not accessed via props.x inside body
- No prop drilling beyond 2 levels — use Zustand store or pass via context
- Lists must always have stable key props — never use array index as key when list is reorderable or deletable
- Loading, empty, and error states must all be handled explicitly in every data-fetching component — no implicit "it just won't render"

## API / Network Rules

- adminApi calls must check response.success before accessing response.data — never assume success
- All admin mutations (POST/PUT/DELETE) must show user feedback on both success and failure — no silent operations
- Never call the same endpoint twice in the same render cycle — deduplicate with useRef guard or React Query pattern
- Rate-limited endpoints (auth/join, verify-password) must show user-friendly message on 429, not generic error
- Image/file uploads (future) must show upload progress — never fire-and-forget without feedback

## Security Rules — Never Violate

- Admin token lives in sessionStorage only — never Zustand, never localStorage, never a React state that could be serialized
- Student JWT lives in Zustand memory only — never sessionStorage, never localStorage
- No sensitive values (passwords, tokens, secrets) in URL query params except exam token (which is by design, documented)
- No hardcoded credentials, URLs, or secrets anywhere in frontend or backend source files
- All user-supplied strings rendered in JSX must be treated as untrusted — no dangerouslySetInnerHTML
- Backend: every route that modifies data must re-validate ownership — a student cannot submit for another student's session even with a valid JWT

## Performance Rules

- useMemo for any derived array/object computed from props or state that is used in render
- useCallback for any function passed as prop to a child component
- React.lazy + Suspense for any page-level component (already done for Monaco — apply same pattern to admin pages)
- No setInterval without storing the ID in useRef and clearing in useEffect cleanup
- No addEventListener without corresponding removeEventListener in useEffect cleanup
- Polling intervals: student dashboard = 60s, live monitor = 15s — do not reduce these without load testing
- localStorage reads are synchronous and slow — do them only in useState initializer functions, never in render body

## Error Boundary — Required

The app has zero error boundaries. A single uncaught render error in ExamWorkspace 
kills the entire exam session with a blank screen and student loses progress.

Add a top-level ErrorBoundary in App.jsx wrapping all routes:
- On error inside ExamWorkspace: show "Something went wrong. Your answers are saved. 
  Please refresh." — do NOT redirect to login (that clears their session)
- On error inside Admin pages: show "Admin panel error. Refresh to retry."
- ErrorBoundary must be a class component (React requirement) — put it in 
  src/components/ErrorBoundary.jsx

## adminApi — Current Blindspot

Current adminApi swallows HTTP errors silently. fetch() does not throw on 4xx/5xx — 
it only throws on network failure. So a 403 from the server returns silently 
with success=false and the UI shows nothing.

Every adminApi method must be updated to:
  .then(async r => {
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${r.status}`);
    }
    return r.json();
  })

This means try/catch in every caller will now correctly catch server errors.

## Naming Conventions

Files:
- React components: PascalCase.jsx
- Hooks: camelCase prefixed with "use" → useAdminApi.js
- Services/utilities: camelCase → api.js, authStore.js
- Constants files (future): SCREAMING_SNAKE.js

Variables:
- Boolean state: is/has/show prefix → isLoading, hasError, showModal
- Handler functions: handle prefix → handleSubmit, handleDelete
- Fetch functions: fetch prefix → fetchExams, fetchMonitor
- API response data destructured immediately → const { data } = response, not response.data.data.x

CSS/Tailwind:
- No custom CSS classes unless Tailwind cannot achieve it
- Responsive classes always mobile-first (base → md: → lg:)
- Interactive elements always have hover: and disabled: states defined


## After Each Section — Verify These Before Moving On

After Section 4 (extraction):
- npm run dev starts without errors
- Admin dashboard loads and all 3 tabs work identically to before

After Section 6 (main.py cleanup):
- uvicorn starts without import errors  
- DELETE /admin/students/{token} returns 200 (was broken by missing CORS DELETE)
- /admin/exams/{id}/sync-time still works (was duplicated route now removed)

After Section 8 (link generation):
- Creating exam → generating links → clicking link → StudentAuth pre-fills token
- Student can complete full auth flow from generated link

After Section 12 (analytics):
- Analytics page loads for a completed exam
- CSV export downloads correctly
- Page shows "No data" gracefully for exam with 0 submissions

