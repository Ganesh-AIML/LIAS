import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set) => ({
      studentName: '',
      examToken: '',
      sessionJwt: null,
      examId: null,
      sessionId: null,
      preCheckPassed: false,
      
      setAuthSession: (name, token, jwt, examId, sessionId) => set({
        studentName: name,
        examToken: token,
        sessionJwt: jwt,
        examId: examId,
        sessionId: sessionId
      }),
      
      setPreCheckStatus: (status) => set({ preCheckPassed: status }),
      
      clearSession: () => set({
        studentName: '',
        examToken: '',
        sessionJwt: null,
        examId: null,
        sessionId: null,
        preCheckPassed: false
      })
    }),
    {
      name: 'secure-exam-session', 
      storage: createJSONStorage(() => sessionStorage), // Survives F5, dies on tab close
      partialize: (state) => ({ 
        sessionJwt: state.sessionJwt, 
        examId: state.examId,
        preCheckPassed: state.preCheckPassed,
        studentName: state.studentName
      }), // Only persist critical tracking data
    }
  )
);