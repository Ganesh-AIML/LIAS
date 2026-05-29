import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import api from './services/api';

import StudentAuth     from './pages/StudentAuth';
import PreExamCheck    from './pages/PreExamCheck';
import StudentDashboard from './pages/StudentDashboard';
import ExamWorkspace   from './pages/ExamWorkspace';

// Attempts silent re-authentication using the persisted examToken.
// Called when the JWT is missing but examId + examToken exist in sessionStorage
// (i.e. the student refreshed mid-exam). Answers are safe in sessionStorage.
function SilentReAuth({ children }) {
  const { sessionJwt, examId, examToken, studentName, setSessionJwt, clearSession } = useAuthStore();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // JWT present — nothing to do
    if (sessionJwt) { setChecking(false); return; }

    // No persisted context — genuine logged-out state
    if (!examId || !examToken) { setChecking(false); return; }

    // JWT missing but token persisted — try silent re-auth
    api.post('/auth/join', {
      student_id: studentName,
      password:   '',           // will fail — needs real password
      exam_token: examToken,
    })
    .catch(async () => {
      // /auth/join requires password — we can't silently re-auth without it.
      // Instead: keep student on current route, they'll hit ProtectedRoute
      // which sends them to login. Their answers remain in sessionStorage
      // and will be re-hydrated when they return to /workspace/:examId.
    })
    .finally(() => setChecking(false));
  }, []);

  if (checking) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-bold text-sm">
      Restoring session...
    </div>
  );

  return children;
}

const ProtectedRoute = ({ children }) => {
  const sessionJwt = useAuthStore((state) => state.sessionJwt);
  if (!sessionJwt) return <Navigate to="/" replace />;
  return children;
};

const PreCheckRoute = ({ children }) => {
  const { sessionJwt, preCheckPassed } = useAuthStore();
  if (!sessionJwt)      return <Navigate to="/"         replace />;
  if (!preCheckPassed)  return <Navigate to="/precheck" replace />;
  return children;
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StudentAuth />} />

        <Route path="/precheck" element={
          <ProtectedRoute><PreExamCheck /></ProtectedRoute>
        } />

        <Route path="/dashboard" element={
          <ProtectedRoute><PreCheckRoute><StudentDashboard /></PreCheckRoute></ProtectedRoute>
        } />

        <Route path="/workspace/:examId" element={
          <ProtectedRoute><PreCheckRoute><ExamWorkspace /></PreCheckRoute></ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}