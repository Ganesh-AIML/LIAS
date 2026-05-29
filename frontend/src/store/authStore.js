import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// sessionJwt lives in memory ONLY — never written to sessionStorage (Issue 19).
// examToken IS persisted so a page refresh can silently re-authenticate
// and restore the JWT without sending the student back to the login screen.

export const useAuthStore = create(
  persist(
    (set) => ({
      studentName:    '',
      examToken:      '',
      sessionJwt:     null,   // in-memory only
      examId:         null,
      sessionId:      null,
      preCheckPassed: false,

      setAuthSession: (name, token, jwt, examId, sessionId) => set({
        studentName: name,
        examToken:   token,
        sessionJwt:  jwt,
        examId,
        sessionId,
      }),

      setSessionJwt: (jwt, sessionId) => set({ sessionJwt: jwt, sessionId }),

      setPreCheckStatus: (status) => set({ preCheckPassed: status }),

      clearSession: () => set({
        studentName:    '',
        examToken:      '',
        sessionJwt:     null,
        examId:         null,
        sessionId:      null,
        preCheckPassed: false,
      }),
    }),
    {
      name:    'secure-exam-session',
      storage: createJSONStorage(() => sessionStorage),
      // examToken persisted for silent re-auth on refresh.
      // sessionJwt intentionally excluded — memory only.
      partialize: (state) => ({
        examId:         state.examId,
        examToken:      state.examToken,
        studentName:    state.studentName,
        preCheckPassed: state.preCheckPassed,
      }),
    }
  )
);