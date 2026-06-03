import React from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

import StudentAuth     from './pages/StudentAuth';
import PreExamCheck    from './pages/PreExamCheck';
import StudentDashboard from './pages/StudentDashboard';
import ExamWorkspace   from './pages/ExamWorkspace';
import AdminDashboard  from './pages/admin/AdminDashboard';

const ProtectedRoute = ({ children }) => {
  const sessionJwt = useAuthStore((state) => state.sessionJwt);
  if (!sessionJwt) return <Navigate to="/join" replace />;
  return children;
};

const PreCheckRoute = ({ children }) => {
  const { sessionJwt, preCheckPassed } = useAuthStore();
  if (!sessionJwt)      return <Navigate to="/join"     replace />;
  if (!preCheckPassed)  return <Navigate to="/precheck" replace />;
  return children;
};

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Admin is now the default landing page */}
          <Route path="/" element={<AdminDashboard />} />

          {/* Student flow starts here */}
          <Route path="/join" element={<StudentAuth />} />

          <Route path="/precheck" element={
            <ProtectedRoute><PreExamCheck /></ProtectedRoute>
          } />

          <Route path="/dashboard" element={
            <ProtectedRoute><PreCheckRoute><StudentDashboard /></PreCheckRoute></ProtectedRoute>
          } />

          <Route path="/workspace/:examId" element={
            <ProtectedRoute><PreCheckRoute><ExamWorkspace /></PreCheckRoute></ProtectedRoute>
          } />

          {/* Catch-all sends unknown traffic to student join page */}
          <Route path="*" element={<Navigate to="/join" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}