import { useEffect } from 'react';
import proctoringEngine from './engine';
import { violationApi } from '../services/api';

// Mounts/unmounts the proctoring engine for a given lifecycle stage.
// mode: 'preparing' (prefetch only) | 'observation' (local-only) | 'enforcement' (reports violations)
// Does not render anything — safe to drop into any page without touching its JSX.
export function useProctoring(mode) {
  useEffect(() => {
    if (mode === 'preparing') {
      proctoringEngine.prepare();
      return; // no camera, no loop, nothing to tear down
    }

    if (mode === 'observation' || mode === 'enforcement') {
      if (mode === 'enforcement') {
        proctoringEngine.onViolation = (eventType, detail) => {
          violationApi
            .post('/exam/violation', { event_type: eventType, detail })
            .catch(() => {}); // best-effort, mirrors existing triggerViolation behavior
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
  }, [mode]);
}

export default useProctoring;