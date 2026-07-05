import { useEffect } from 'react';
import proctoringEngine from './engine';

// Mounts/unmounts the proctoring engine for a given lifecycle stage.
// mode: 'preparing' (prefetch only) | 'observation' (local-only) | 'enforcement' (reports violations)
// onViolation: called for every camera/audio violation in 'enforcement' mode.
//   ROOT CAUSE FIX: this used to build its own inline
//   `violationApi.post('/exam/violation', ...)` here, completely bypassing
//   the student-facing notification/modal pipeline used by tab-switch,
//   copy/paste, and restricted-key violations. Violations were recorded
//   server-side (count went up) but the student was never shown anything.
//   Now the caller passes its existing triggerViolation function so camera/
//   audio violations go through the SAME notify-count-modal pipeline.
// Does not render anything — safe to drop into any page without touching its JSX.
export function useProctoring(mode, onViolation) {
  useEffect(() => {
    if (mode === 'preparing') {
      proctoringEngine.prepare();
      return; // no camera, no loop, nothing to tear down
    }

    if (mode === 'observation' || mode === 'enforcement') {
      if (mode === 'enforcement') {
        proctoringEngine.onViolation = (eventType, detail) => {
          onViolation?.(eventType, detail);
        };
      }
      proctoringEngine.start(mode);

      return () => {
        // Always tear down fully on unmount (Dashboard→Workspace navigation included).
        // Costs one extra getUserMedia re-acquire on Workspace mount, but matches the
        // existing PreExamCheck pattern of "release stream on leaving the page" and
        // avoids any risk of a stale/orphaned stream surviving a route change.
        proctoringEngine.stop();
        proctoringEngine.onViolation = null;
      };
    }
  }, [mode, onViolation]);
}

export default useProctoring;