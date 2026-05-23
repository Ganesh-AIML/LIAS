import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

// Page Imports
import StudentAuth from './pages/StudentAuth';
import PreExamCheck from './pages/PreExamCheck';
import StudentDashboard from './pages/StudentDashboard';
import ExamWorkspace from './pages/ExamWorkspace'; // 🚀 Newly added import

const ProtectedRoute = ({ children }) => {
  const sessionJwt = useAuthStore((state) => state.sessionJwt);
  if (!sessionJwt) return <Navigate to="/" replace />;
  return children;
};

const PreCheckRoute = ({ children }) => {
  const sessionJwt = useAuthStore((state) => state.sessionJwt);
  const preCheckPassed = useAuthStore((state) => state.preCheckPassed);
  
  if (!sessionJwt) return <Navigate to="/" replace />;
  if (!preCheckPassed) return <Navigate to="/precheck" replace />;
  
  return children;
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StudentAuth />} />
        
        <Route 
          path="/precheck" 
          element={
            <ProtectedRoute>
              <PreExamCheck />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <PreCheckRoute>
                <StudentDashboard />
              </PreCheckRoute>
            </ProtectedRoute>
          } 
        />

        {/* 🚀 The new Workspace Route */}
        <Route 
          path="/workspace/:examId" 
          element={
            <ProtectedRoute>
              <PreCheckRoute>
                <ExamWorkspace />
              </PreCheckRoute>
            </ProtectedRoute>
          } 
        />
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}