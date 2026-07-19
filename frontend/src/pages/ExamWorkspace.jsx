import { useState, useEffect, lazy, Suspense, useMemo, useRef, useCallback} from "react";
import { useNavigate, useParams } from "react-router-dom";
import io from "socket.io-client";
import {
  Clock,
  Code,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  FileText,
  AlertTriangle,
  Lock,
  Monitor,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import api, { violationApi } from "../services/api";
import { useProctoring } from "../proctoring/useProctoring";
import { verifyProctoringReady } from "../proctoring/readiness";
import { useAuthStore } from "../store/authStore";
import { useTrueTime } from "../hooks/useTrueTime";
const SubjectiveEditor = lazy(
  () => import("../components/exam/SubjectiveEditor"),
);
import QuestionRenderer from "../components/exam/QuestionRenderer";
const Editor = lazy(() => import("@monaco-editor/react"));

const SUPPORTED_LANGUAGES = [
  {
    id: "62",
    name: "Java",
    monaco: "java",
    defaultCode: `import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        // Write your code here\n        \n    }\n}`,
  },
  {
    id: "71",
    name: "Python 3",
    monaco: "python",
    defaultCode: `def main():\n    # Write your code here\n    pass\n\nif __name__ == "__main__":\n    main()`,
  },
  {
    id: "54",
    name: "C++",
    monaco: "cpp",
    defaultCode: `#include <iostream>\nusing namespace std;\n\nint main() {\n    // Write your code here\n    \n    return 0;\n}`,
  },
  {
    id: "50",
    name: "C",
    monaco: "c",
    defaultCode: `#include <stdio.h>\n\nint main() {\n    // Write your code here\n    \n    return 0;\n}`,
  },
  {
    id: "63",
    name: "JavaScript",
    monaco: "javascript",
    defaultCode: `// Write your code here\n`,
  },
];

// Task 3: Section-wise timer component
// Shows the active section's remaining time (if set) or total remaining time.
// Calls onSectionExpired(sectionKey) when a section timer runs out.
// Calls onTimeUp(true) when total duration expires.
const SmartTimer = ({
  examData,
  ts,
  isSynced,
  onTimeUp,
  activeSection,
  onSectionExpired,
  sectionStartTimes,  // { mcq: ms, coding: ms, qna: ms } — when each section was entered
}) => {
  const [timeLeft, setTimeLeft] = useState(null);
  const [label, setLabel]       = useState('');
  const firedRef = useRef({});   // prevent firing onSectionExpired multiple times

  useEffect(() => {
    if (!examData || !examData.duration || !isSynced || !ts) return;

    const startMs       = new Date(examData.date || Date.now()).getTime();
    const globalEndMs   = startMs + parseInt(examData.duration) * 60000;

    const tick = () => {
      const now = ts.now();

      // Global hard cutoff
      if (now >= globalEndMs) {
        setTimeLeft(0);
        clearInterval(timer);
        onTimeUp(true);
        return;
      }

      // Section-level timer
      const sectionDurationMap = {
        technical: examData.mcqDuration    ? parseInt(examData.mcqDuration)    * 60000 : null,
        coding:    examData.codingDuration  ? parseInt(examData.codingDuration) * 60000 : null,
        subjective:examData.qnaDuration    ? parseInt(examData.qnaDuration)    * 60000 : null,
      };

      const sectionDurMs = sectionDurationMap[activeSection];
      const sectionStart = sectionStartTimes?.[activeSection] || startMs;

      if (sectionDurMs !== null && sectionDurMs !== undefined) {
        const sectionEnd = sectionStart + sectionDurMs;
        const sectionLeft = Math.max(0, Math.floor((Math.min(sectionEnd, globalEndMs) - now) / 1000));
        setTimeLeft(sectionLeft);
        const lbl = activeSection === 'technical' ? 'MCQ' : activeSection === 'coding' ? 'Coding' : 'Q&A';
        setLabel(`${lbl} Time`);

        if (sectionLeft <= 0 && !firedRef.current[activeSection]) {
          firedRef.current[activeSection] = true;
          onSectionExpired && onSectionExpired(activeSection);
        }
      } else {
        // No section timer — show global remaining
        const totalLeft = Math.max(0, Math.floor((globalEndMs - now) / 1000));
        setTimeLeft(totalLeft);
        setLabel('Remaining');
      }
    };

    firedRef.current = {}; // reset on section change
    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
  }, [examData, isSynced, ts, onTimeUp, activeSection, sectionStartTimes, onSectionExpired]);

  if (timeLeft === null) return <span className="text-slate-400 font-bold tracking-widest">Syncing...</span>;

  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  const urgency = timeLeft <= 60 ? "critical" : timeLeft <= 300 ? "warning" : "normal";
  return (
    <span
      className={
        urgency === "critical"
          ? "text-red-600 font-black tracking-widest"
          : urgency === "warning"
          ? "text-amber-600 font-black tracking-widest"
          : "text-blue-900 font-bold tracking-widest"
      }
      style={urgency === "critical" ? { animation: "pulse 1s ease-in-out infinite" } : undefined}
    >
      {m}:{s < 10 ? "0" : ""}{s} {label}{urgency === "critical" ? " ⚠" : ""}
    </span>
  );
};

// Task 8/10: Lock overlay component — polls backend every 5s to detect admin GRANT.
function LockOverlay({ examId, submitPayload, navigate, onUnlocked }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        await api.get('/exam/session-status');
        clearInterval(poll);
        onUnlocked();
      } catch {
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [onUnlocked]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await api.post(`/exam/${examId}/submit`, { answers: submitPayload, autoSubmit: true });
    } catch { /* best effort */ }
    ["answers","codes","active_lang","active_source","subjective"].forEach((key) =>
      sessionStorage.removeItem(`scope_${key}_${examId}`)
    );
    navigate("/dashboard");
  };

  return (
    <div className="fixed inset-0 z-[250] bg-slate-900/95 flex flex-col items-center justify-center text-white p-6">
      <Lock size={64} className="text-red-500 mb-6" />
      <h2 className="text-2xl font-black mb-2">Exam Locked</h2>
      <p className="text-slate-400 mb-2 max-w-md text-center">
        Maximum violations reached. Your screen has been locked.
      </p>
      <p className="text-slate-500 mb-8 text-sm max-w-md text-center">
        Waiting for administrator to unlock your session…
      </p>
      <div className="flex gap-3">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse inline-block" />
          Checking for unlock…
        </div>
      </div>
      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="mt-6 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-xl transition-all disabled:opacity-50"
      >
        {isSubmitting ? 'Submitting…' : 'Submit Exam & Exit'}
      </button>
    </div>
  );
}

export default function ExamWorkspace() {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [examData, setExamData] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── PROCTORING READINESS GATE (INITIALIZING state) ─────────────────────────
  // Strict policy: exam must not become usable until models, camera,
  // black-frame check, face-detection init, the inference loop, and the
  // violation pipeline are ALL confirmed healthy. No degraded mode. Separate
  // from `loading` (which only means "exam data fetched") so a slow-but-healthy
  // network doesn't get confused with a camera/proctoring failure or vice versa.
  //
  // AUD-043: 'preparing-models' is its own status (distinct from 'checking')
  // because model download has no meaningful short timeout — it's a one-time
  // background fetch that may still be in flight from PreExamCheck/Dashboard.
  // Students must see "please wait", not a failure, while it finishes.
  const [proctorStatus, setProctorStatus] = useState('preparing-models'); // 'preparing-models' | 'checking' | 'ready' | 'failed'
  const [proctorFailReason, setProctorFailReason] = useState('');
  const [proctorRetryTick, setProctorRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProctorStatus('preparing-models');
    setProctorFailReason('');

    verifyProctoringReady({
      onStageChange: (stage) => {
        if (cancelled) return;
        setProctorStatus(stage === 'models' ? 'preparing-models' : 'checking');
      },
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setProctorStatus('ready');
      } else {
        setProctorStatus('failed');
        setProctorFailReason(result.message || 'Proctoring could not be verified.');
      }
    });

    return () => { cancelled = true; };
  }, [proctorRetryTick]);

  const retryProctorCheck = () => setProctorRetryTick((n) => n + 1);
  // ── END PROCTORING READINESS GATE ───────────────────────────────────────────

  const { ts, isSynced } = useTrueTime();
  const [isTimeUp, setIsTimeUp] = useState(false);

  const [currentTechQ, setCurrentTechQ] = useState(0);
  const [reviewLater, setReviewLater] = useState([]);

  // 🛡️ RECOVERY ENGINE: Lazy initialization directly from SessionStorage
  const [answers, setAnswers] = useState(() => {
    const cached = sessionStorage.getItem(`scope_answers_${examId}`);
    return cached ? JSON.parse(cached) : {};
  });

  const [language, setLanguage] = useState(() => {
    return sessionStorage.getItem(`scope_active_lang_${examId}`) || "71";
  });

  const [sourceCode, setSourceCode] = useState(() => {
    return (
      sessionStorage.getItem(`scope_active_source_${examId}`) ||
      "// Loading code..."
    );
  });

  const handleSubjectiveChange = useCallback((questionId, markdownValue) => {
  setSubjectiveAnswers(prev => ({ ...prev, [questionId]: markdownValue }));
}, []);

  const [subjectiveAnswers, setSubjectiveAnswers] = useState(() => {
    try {
      const cached = sessionStorage.getItem(`scope_subjective_${examId}`);
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  const [toastMessage, setToastMessage] = useState("");
  const [showLockModal, setShowLockModal] = useState(false);
  const [isCodingLocked, setIsCodingLocked] = useState(false);
  const [mcqStartTime, setMcqStartTime] = useState(null);
  // Task 3: track when each section was entered + which are locked
  const [sectionStartTimes, setSectionStartTimes] = useState({});
  const [lockedSections, setLockedSections] = useState({});
  const [needsFullscreen, setNeedsFullscreen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const [violationCount, setViolationCount] = useState(0);
  const [showViolationModal, setShowViolationModal] = useState(false);
  const [lastViolationType, setLastViolationType] = useState('');
  const MAX_VIOLATIONS = examData?.maxViolations ?? 3;

  const syncViolationCount = async () => {
    try {
      const res = await api.get("/exam/violation/count");
      if (res.data?.count !== undefined) {
        setViolationCount(res.data.count);
        return res.data.count;
      }
    } catch {
      // network failure — fall back to local count already incremented
    }
    return null;
  };

  // ROOT CAUSE FIX: this used to be a local function defined INSIDE the
  // "ANTI-CHEAT ENGINE" useEffect below, reachable only by tab-switch /
  // copy-paste / keydown handlers in that same effect. Camera/audio
  // violations (from proctoringEngine, wired via useProctoring) had their
  // own separate raw `violationApi.post(...)` call that never touched this
  // function — so they were recorded server-side (count incremented) but
  // NEVER shown to the student (no setShowViolationModal, no toast).
  // Lifting it to component scope lets useProctoring('enforcement', ...)
  // share the exact same notification pipeline as every other violation type.
  const triggerViolation = useCallback((event_type, detail = "") => {
    violationApi
      .post("/exam/violation", { event_type, detail })
      .catch(() => {});
    setLastViolationType(event_type);
    syncViolationCount().then((serverCount) => {
      if (serverCount === null) setViolationCount((prev) => prev + 1);
      setShowViolationModal(true);
    });
  }, []);

  useProctoring('enforcement', triggerViolation); // camera/audio violations now notify too

  const [showEndModal, setShowEndModal] = useState(false);
  const [endPasswordInput, setEndPasswordInput] = useState("");
  const [endPasswordError, setEndPasswordError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasSubmittedRef = useRef(false);
  const autoSubmitPendingRef = useRef(false);

  // 🚀 FIX: Removed 'React.' prefix and used the imported 'useMemo'
  const flatQuestions = useMemo(
    () =>
      examData?.sections?.flatMap((s) =>
        (s.questions || []).map((q) => ({
          ...q,
          sectionName:    q.sectionName    || s.name || "General Section",
          content_format: q.content_format || "plain",
          marks:          q.marks          ?? s.marks_per_question ?? 1,
        }))
      ) || [],
    [examData],
  );

  // 🚀 FIX: Removed 'React.' prefix and used the imported 'useMemo'
  const groupedQuestions = useMemo(
    () =>
      flatQuestions.reduce((acc, q, idx) => {
        const sName = q.sectionName || "General Section";
        if (!acc[sName]) acc[sName] = [];
        acc[sName].push({ ...q, globalIndex: idx });
        return acc;
      }, {}),
    [flatQuestions],
  );

  // 🛡️ AUTO-SUBMIT: Exponential Retry Queue
  const attemptAutoSubmit = async (retryCount = 0) => {
    if (retryCount === 0) {
      if (hasSubmittedRef.current) return; // AUD-020: already submitting/submitted
      hasSubmittedRef.current = true;
    }
    setIsSubmitting(true);
    try {
      await api.post(`/exam/${examId}/submit`, {
        answers: buildSubmissionPayload(),
        autoSubmit: true,
        subjective: Object.keys(subjectiveAnswers).length > 0 ? subjectiveAnswers : undefined,
      });
      ["answers", "codes", "active_lang", "active_source", "subjective"].forEach((key) =>
        sessionStorage.removeItem(`scope_${key}_${examId}`),
      );
      navigate("/dashboard");
    } catch (err) {
      if (retryCount < 5) {
        // 🚀 C-04: Exponential backoff (1s, 2s, 4s, 8s, 16s)
        const delay = Math.pow(2, retryCount) * 1000;
        setToastMessage(
          `Network error. Retrying submission in ${delay / 1000}s... Please do not close this page.`,
        );
        setTimeout(() => attemptAutoSubmit(retryCount + 1), delay);
      } else {
        setToastMessage(
          "Critical: Auto-submit failed. Your answers are saved locally. Please contact your invigilator immediately.",
        );
        setIsSubmitting(false); // Leaves them on the page to manually retry when WiFi returns
      }
    }
  };

  useEffect(() => {
    if (isTimeUp && !autoSubmitPendingRef.current) {
      autoSubmitPendingRef.current = true;
      setTimeout(() => {
        setToastMessage("⏳ Time has expired. Auto-submitting exam...");
        attemptAutoSubmit();
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTimeUp]);

  // 🛡️ AUTO-SAVE: Cache answers
  useEffect(() => {
    if (Object.keys(answers).length > 0) {
      try {
        sessionStorage.setItem(
          `scope_answers_${examId}`,
          JSON.stringify(answers),
        );
      } catch (e) {
        console.warn("Storage quota exceeded — answers not cached locally", e);
      }
    }
  }, [answers, examId]);

  // 🛡️ AUTO-SAVE: Cache source code
  useEffect(() => {
    if (sourceCode && sourceCode !== "// Loading code...") {
      try {
        sessionStorage.setItem(`scope_active_source_${examId}`, sourceCode);
        sessionStorage.setItem(`scope_active_lang_${examId}`, language);
      } catch (e) {
        console.warn(
          "Storage quota exceeded — active source not cached locally",
          e,
        );
      }
    }
  }, [sourceCode, language, examId]);

  useEffect(() => {
    if (Object.keys(subjectiveAnswers).length > 0) {
      try {
        sessionStorage.setItem(
          `scope_subjective_${examId}`,
          JSON.stringify(subjectiveAnswers),
        );
      } catch (e) {
        console.warn(
          "Storage quota exceeded — subjective answers not cached",
          e,
        );
      }
    }
  }, [subjectiveAnswers, examId]);

  // Auto-hide toast
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Socket Live Timer Sync
  const socketRef = useRef(null);
  useEffect(() => {
    const socketURL = import.meta.env.VITE_API_URL;

    // 🚀 H-06: Ensure only one socket exists per client
    if (!socketRef.current) {
      socketRef.current = io(socketURL);
      const jwt = useAuthStore.getState().sessionJwt;
      if (jwt)
        socketRef.current.emit("join_exam_room", {
          exam_id: examId,
          token: jwt,
        });

      socketRef.current.on("exam_time_synced", (updatedTimes) => {
        setExamData((prev) => ({
          ...prev,
          duration: updatedTimes.duration,
          codingDuration: updatedTimes.codingDuration || prev.codingDuration,
        }));
        setToastMessage("⏱️ The invigilator has adjusted the exam duration.");
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [examId]);

  // ── ANTI-CHEAT ENGINE ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!document.fullscreenElement)
      setTimeout(() => setNeedsFullscreen(true), 0);

    const handleVisibilityChange = () => {
      if (document.hidden)
        triggerViolation(
          "tab_switch",
          "Student switched tab or minimized window",
        );
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setNeedsFullscreen(true);
        triggerViolation("fullscreen_exit", "Student exited fullscreen");
      } else {
        setNeedsFullscreen(false);
      }
    };

    const handleCopy = (e) => {
      e.preventDefault();
      triggerViolation("copy_paste", "Copy attempted");
      setToastMessage("🚫 Copying is not allowed during the exam.");
    };
    const handleCut = (e) => {
      e.preventDefault();
      triggerViolation("copy_paste", "Cut attempted");
      setToastMessage("🚫 Cutting is not allowed during the exam.");
    };
    const handlePaste = (e) => {
      e.preventDefault();
      triggerViolation("copy_paste", "Paste attempted");
      setToastMessage("🚫 Pasting is not allowed during the exam.");
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      setToastMessage("🚫 Right-click is disabled during the exam.");
    };

    const BLOCKED_KEYS = new Set(["F12", "F5", "F11"]);
    const handleKeyDown = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const blocked =
        BLOCKED_KEYS.has(e.key) ||
        (ctrl &&
          ["u", "p", "s", "a", "c", "x", "v"].includes(e.key.toLowerCase())) ||
        (ctrl && e.shiftKey && ["i", "j", "c"].includes(e.key.toLowerCase())) ||
        (ctrl && e.altKey);
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
        setToastMessage(`🚫 System shortcut disabled.`);
      }
    };

    window.history.pushState(null, null, window.location.href);
    const handlePopState = () => {
      window.history.pushState(null, null, window.location.href);
      triggerViolation("tab_switch", "Back navigation attempted");
    };

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "Exam is active.";
      return e.returnValue;
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("copy", handleCopy);
    document.addEventListener("cut", handleCut);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("cut", handleCut);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [triggerViolation]);

  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const response = await api.get(`/exam/${examId}`);
        const data = response.data.data || response.data;
        setExamData(data);

        const hasCod  = (data?.codingProblems || []).length > 0;
        const hasSubj = (data?.subjectiveQuestions || []).length > 0;
        const hasMcq  = (data?.sections || []).some(s => (s.questions || []).length > 0);

        // Task 2 & 3: set initial section (MCQ → Coding → QnA) and record start time
        const initialSection = hasMcq ? 'technical' : hasCod ? 'coding' : hasSubj ? 'subjective' : null;
        if (initialSection) {
          setSectionStartTimes({ [initialSection]: Date.now() });
        }

        if (hasMcq) {
          // MCQ first — coding not yet unlocked
          setIsCodingLocked(false);
          setActiveSection("technical");
        } else if (hasCod) {
          // No MCQ — coding is first section, start unlocked
          setIsCodingLocked(false);
          setActiveSection("coding");
          if (sourceCode === "// Loading code...")
            setSourceCode(SUPPORTED_LANGUAGES[1].defaultCode);
        } else if (hasSubj) {
          setIsCodingLocked(true);
          setActiveSection("subjective");
        }
      } catch (error) {
        console.error(error);
        if (error.response?.status === 403 && error.response?.data?.detail === "Exam already submitted.") {
          setToastMessage("You have already submitted this exam.");
          navigate("/dashboard");
          return;
        }
        setToastMessage("Failed to connect to exam core.");
      } finally {
        setLoading(false);
      }
    };
    loadWorkspace();
  }, [examId]);

  // AUD-020: duplicate auto-submit effect removed. The effect above
  // (attemptAutoSubmit, with retry + localStorage cleanup) is the single
  // source of truth for time-up submission. A second independent effect
  // here previously fired its own bare POST /submit on the same isTimeUp
  // change, racing with attemptAutoSubmit and causing duplicate-submission
  // errors.

  const toggleReview = (questionId) => {
    setReviewLater((prev) =>
      prev.includes(questionId)
        ? prev.filter((id) => id !== questionId)
        : [...prev, questionId],
    );
  };

  const handleSelectOption = (questionId, optionLetter) => {
    if (lockedSections['technical']) return; // MCQ section locked — ignore input
    setAnswers((prev) => ({ ...prev, [questionId]: optionLetter }));
  };

  // Task 3: record when a section starts
  const recordSectionStart = (section) => {
    setSectionStartTimes(prev => ({ ...prev, [section]: Date.now() }));
  };

  const handleSectionExpired = useCallback((expiredSection) => {
    const hasCod  = (examData?.codingProblems || []).length > 0;
    const hasSubj = (examData?.subjectiveQuestions || []).length > 0;
    const hasMcq  = (examData?.sections || []).some(s => (s.questions || []).length > 0);

    setLockedSections(prev => ({ ...prev, [expiredSection]: true }));
    setToastMessage(`⏰ ${expiredSection === 'technical' ? 'MCQ' : expiredSection === 'coding' ? 'Coding' : 'Q&A'} time expired. Moving to next section.`);

    if (expiredSection === 'technical') {
      if (hasCod) { setActiveSection('coding'); recordSectionStart('coding'); }
      else if (hasSubj) { setActiveSection('subjective'); recordSectionStart('subjective'); }
    } else if (expiredSection === 'coding') {
      setIsCodingLocked(true);
      if (hasSubj) { setActiveSection('subjective'); recordSectionStart('subjective'); }
    } else if (expiredSection === 'subjective') {
    }
  }, [examData]);

  const executeCodingLock = async () => {
    setShowLockModal(false);
    setIsCodingLocked(true);
    const nowMs = ts.now();
    setMcqStartTime(nowMs);
    setLockedSections(prev => ({ ...prev, coding: true }));

    const hasSubj = (examData?.subjectiveQuestions || []).length > 0;
    // After coding, move to QnA if present (MCQ comes before coding in sequence)
    if (hasSubj) { setActiveSection("subjective"); recordSectionStart('subjective'); }
  };

  const handleLanguageChange = (newLangId) => {
    setLanguage(newLangId);
    const fallbackTemplate = SUPPORTED_LANGUAGES.find(
      (l) => l.id === newLangId,
    )?.defaultCode;
    setSourceCode(fallbackTemplate || "// Write your code here");
  };

  const handleFinishClick = () => {
    setShowEndModal(true);
  };

  const buildSubmissionPayload = () => {
    const codingAnswers = {};
    if (examData?.codingProblems?.length > 0) {
      examData.codingProblems.forEach(cp => {
        codingAnswers[cp.id] = { code: sourceCode, language };
      });
    }
    return {
      mcqs: answers,
      coding: codingAnswers,
    };
  };

  const confirmAndSubmit = async () => {
    if (!endPasswordInput) {
      setEndPasswordError("Please enter the end password.");
      return;
    }
    setIsSubmitting(true);
    setEndPasswordError("");
    try {
      const verifyRes = await violationApi.post(
        `/exam/${examId}/verify-password`,
        { type: "end", password: endPasswordInput },
      );
      if (!verifyRes.data.success) {
        setEndPasswordError(verifyRes.data.error || "Incorrect End Password.");
        setIsSubmitting(false);
        return;
      }
      await api.post(`/exam/${examId}/submit`, {
        answers: buildSubmissionPayload(),
        subjective: Object.keys(subjectiveAnswers).length > 0 ? subjectiveAnswers : undefined,
      });
      ["answers", "codes", "active_lang", "active_source", "subjective"].forEach((key) =>
        sessionStorage.removeItem(`scope_${key}_${examId}`),
      );
      setShowEndModal(false);
      navigate("/dashboard");
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.detail;
      if (err.response?.status === 403 && detail) {
        setEndPasswordError(detail); // "Incorrect End Password." from backend
      } else {
        setEndPasswordError("Submission failed. Please try again.");
      }
      setIsSubmitting(false);
    }
  };

  const renderMCQSection = (currentIndex, setIndex) => {
    if (!flatQuestions || flatQuestions.length === 0)
      return <div className="p-10 text-center">No questions loaded.</div>;
    const currentQ = flatQuestions[currentIndex];
    if (!currentQ) return null;

    return (
      <div className="flex flex-col md:flex-row h-[calc(100vh-120px)] bg-slate-50">
        <div className="w-full md:w-72 bg-white border-r border-slate-200 p-5 flex flex-col overflow-y-auto">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">
            Assessment Structure
          </h3>

          {Object.entries(groupedQuestions).map(([sectionName, sectionQs]) => (
            <div key={sectionName} className="mb-8 last:mb-0">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-blue-900 bg-blue-50 py-1 px-2.5 rounded uppercase tracking-widest border border-blue-200">
                  {sectionName}
                </span>
                <span className="text-[10px] font-bold text-slate-400">
                  {sectionQs.length} Qs
                </span>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {sectionQs.map((q) => {
                  const idx = q.globalIndex;
                  const isAnswered = answers[q.id] !== undefined;
                  const isActive = currentIndex === idx;
                  const isMarked = reviewLater.includes(q.id);

                  return (
                    <button
                      key={idx}
                      onClick={() => setIndex(idx)}
                      className={`w-10 h-10 rounded-lg text-sm font-bold flex items-center justify-center transition-all border relative
                        ${isActive ? "border-blue-900 ring-2 ring-blue-900/20 shadow-sm" : "border-slate-200"}
                        ${isAnswered && !isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : ""}
                        ${!isAnswered && !isActive ? "bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300" : ""}
                        ${isAnswered && isActive ? "bg-blue-900 text-white border-blue-900" : ""}
                      `}
                    >
                      {idx + 1}
                      {isMarked && (
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-white"></div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1 flex flex-col p-6 lg:p-10 overflow-y-auto">
          <div className="max-w-3xl w-full mx-auto">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-bold text-blue-900 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full">
                Question {currentIndex + 1} of {flatQuestions.length}
              </span>
            </div>

            <div className="text-xl font-bold text-slate-900 mb-8 leading-relaxed">
              <QuestionRenderer text={currentQ.text} format={currentQ.content_format} />
            </div>

            <div className="space-y-3">
              {currentQ.shuffledOptions ? (
                currentQ.shuffledOptions.map((option, index) => {
                  if (!option.text) return null;
                  const isSelected = answers[currentQ.id] === option.label;

                  return (
                    <button
                      key={index}
                      onClick={() =>
                        handleSelectOption(currentQ.id, option.label)
                      }
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center gap-4
                        ${
                          isSelected
                            ? "border-blue-900 bg-blue-50 text-blue-900 shadow-sm"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-200"
                        }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-blue-900" : "border-slate-300"}`}
                      >
                        {isSelected && (
                          <div className="w-2.5 h-2.5 bg-blue-900 rounded-full"></div>
                        )}
                      </div>
                      <span className="font-medium text-base">
                        <strong className="mr-2 text-slate-400">
                          {index + 1}.
                        </strong>
                        <QuestionRenderer text={option.text} format={currentQ.content_format} />
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="text-slate-400 text-sm italic p-4 border-2 border-dashed border-slate-200 rounded-xl">
                  Loading secure options...
                </div>
              )}
            </div>

            <div className="mt-10 pt-6 border-t border-slate-200 flex justify-between items-center">
              <button
                onClick={() => setIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                className="px-5 py-2.5 rounded-lg font-bold text-slate-600 bg-white border border-slate-200 disabled:opacity-50 transition-all flex items-center gap-2"
              >
                <ChevronLeft size={18} /> Previous
              </button>

              <div className="flex gap-3">
                <button
                  onClick={() => toggleReview(currentQ.id)}
                  className={`px-4 py-2 text-sm font-bold rounded-lg transition-all border ${reviewLater.includes(currentQ.id) ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-white text-slate-500 border-slate-300 hover:bg-slate-50"}`}
                >
                  {reviewLater.includes(currentQ.id)
                    ? "★ Marked"
                    : "Mark for Review"}
                </button>

                {answers[currentQ.id] && (
                  <button
                    onClick={() => {
                      const newAnswers = { ...answers };
                      delete newAnswers[currentQ.id];
                      setAnswers(newAnswers);
                    }}
                    className="px-4 py-2 text-sm font-bold text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  >
                    Clear Selection
                  </button>
                )}
              </div>

              <button
                onClick={() =>
                  setIndex(Math.min(flatQuestions.length - 1, currentIndex + 1))
                }
                disabled={currentIndex === flatQuestions.length - 1}
                className="px-5 py-2.5 rounded-lg font-bold text-white bg-blue-900 hover:bg-blue-800 shadow-md flex items-center gap-2 transition-colors"
              >
                Next <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

const renderSubjectiveSection = () => {
  const questions = examData?.subjectiveQuestions || [];
  if (!questions.length) return <div className="p-10 text-center text-slate-400">No subjective questions.</div>;

  return (
    <div className="h-[calc(100vh-120px)] overflow-y-auto bg-slate-50 p-6 space-y-8">
      {questions.map((q, idx) => (
        <div key={q.id} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{q.section} — Q{idx + 1}</span>
            <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded font-bold">{q.marks} marks</span>
          </div>
          <div className="mb-4 text-slate-900 font-medium leading-relaxed">
            <QuestionRenderer text={q.text} format={q.content_format} />
          </div>
          <Suspense fallback={<div className="h-40 flex items-center justify-center text-slate-400 text-sm">Loading editor...</div>}>
            <SubjectiveEditor
              questionId={q.id}
              questionText={q.text}
              onChange={(md) => handleSubjectiveChange(q.id, md)}
              initialValue={subjectiveAnswers[q.id] || ''}
              disabled={isTimeUp || isSubmitting || !!lockedSections['subjective']}
            />
          </Suspense>
        </div>
      ))}
    </div>
  );
};

  const renderCodingSection = () => {
    const currentMonacoLang =
      SUPPORTED_LANGUAGES.find((l) => l.id === language)?.monaco || "java";
    const codingProblem = examData?.codingProblems?.[0];

    return (
      <div className="flex flex-col lg:flex-row h-[calc(100vh-120px)]">
        <div className="w-full lg:w-1/3 bg-white border-r border-slate-200 p-6 overflow-y-auto flex-shrink-0 flex flex-col">
          <h2 className="text-xl font-bold text-slate-900 mb-4">
            {codingProblem?.title || "Coding Challenge"}
          </h2>
          <div className="prose prose-sm prose-slate max-w-none prose-pre:bg-slate-900 prose-pre:text-slate-100 flex-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {codingProblem?.description ||
                "Implement the solution logic in the editor."}
            </ReactMarkdown>
          </div>
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 font-medium">
            Your code will be saved and manually evaluated. No auto-compilation.
          </div>
        </div>

        <div className="w-full lg:w-2/3 flex flex-col bg-[#1e1e1e] min-w-0">
          <div className="h-12 bg-[#2d2d2d] border-b border-[#404040] flex items-center justify-between px-4 flex-shrink-0">
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="bg-[#3c3c3c] text-slate-200 text-sm rounded px-3 py-1 focus:outline-none border border-[#555]"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-h-0 relative">
            <Suspense
              fallback={
                <div className="flex flex-col items-center justify-center h-full bg-[#1e1e1e] text-slate-400 p-6 text-center">
                  <AlertTriangle size={32} className="text-amber-500 mb-4" />
                  <p>Editor module loading...</p>
                </div>
              }
            >
              <Editor
                height="100%"
                theme="vs-dark"
                language={currentMonacoLang}
                value={sourceCode}
                onChange={(value) => {
                  if (!isCodingLocked && !lockedSections['coding']) setSourceCode(value);
                }}
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  quickSuggestions: false,
                  readOnly: isCodingLocked || !!lockedSections['coding'],
                }}
              />
            </Suspense>
          </div>
        </div>
      </div>
    );
  };

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-bold">
        Initializing Workspace...
      </div>
    );

  // STRICT POLICY: exam content, sockets-driven timer display, and all
  // interactive elements stay blocked until proctoring is fully verified.
  // No degraded mode — any failed check blocks entry with a retry option.
  // 'preparing-models' is a wait state, not a failure — students should never
  // see a failure screen just because a one-time model download is still
  // in progress (see AUD-043).
  if (proctorStatus !== 'ready') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6">
        {proctorStatus === 'preparing-models' ? (
          <>
            <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-blue-500 animate-spin mb-6" />
            <h2 className="text-2xl font-black mb-2">Preparing Proctoring</h2>
            <p className="text-slate-400 max-w-md text-center">
              Downloading and initializing monitoring components. This may take a little longer on a first run or slower connection — please keep this tab open.
            </p>
          </>
        ) : proctorStatus === 'checking' ? (
          <>
            <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-blue-500 animate-spin mb-6" />
            <h2 className="text-2xl font-black mb-2">Verifying Proctoring</h2>
            <p className="text-slate-400 max-w-md text-center">
              Checking camera, face detection, and monitoring before your exam can begin. This usually takes a few seconds.
            </p>
          </>
        ) : (
          <>
            <Monitor size={64} className="text-rose-500 mb-6" />
            <h2 className="text-2xl font-black mb-2">Proctoring Could Not Be Verified</h2>
            <p className="text-slate-400 mb-8 max-w-md text-center">
              {proctorFailReason || 'Proctoring is required to begin this exam.'}
            </p>
            <button
              onClick={retryProctorCheck}
              className="bg-blue-900 hover:bg-blue-800 text-white font-bold py-4 px-8 rounded-xl shadow-lg transition-all"
            >
              Retry
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 font-sans overflow-hidden">
      {/* 🚨 VIOLATION WARNING MODAL — shown on every proctoring event */}
      {showViolationModal && (
        <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full text-center overflow-hidden border border-slate-200">
            {violationCount >= MAX_VIOLATIONS ? (
              /* ── TASK 8: LOCK SCREEN ── */
              <>
                <div className="px-8 pt-8 pb-6 border-b-4 border-red-600">
                  <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-red-50 border-2 border-red-200">
                    <Lock size={32} className="text-red-600" />
                  </div>
                  <h2 className="text-2xl font-black mb-2 text-red-600">Maximum Violations Reached</h2>
                  <p className="text-slate-600 font-medium text-sm">
                    Your screen has been locked.<br/>It can only be unlocked by an administrator.
                  </p>
                </div>
                <div className="px-8 py-6 space-y-3">
                  <button
                    onClick={() => {
                      /* Wait for admin — remain locked, close modal to show lock overlay */
                      setShowViolationModal(false);
                    }}
                    className="w-full font-bold py-3 rounded-xl transition-colors bg-slate-100 hover:bg-slate-200 text-slate-700"
                  >
                    Wait for Administrator
                  </button>
                  <button
                    onClick={() => {
                      const codAnswers = {};
                      if (examData?.codingProblems?.length > 0) {
                        examData.codingProblems.forEach(cp => {
                          codAnswers[cp.id] = { code: sourceCode || '', language };
                        });
                      }
                      api.post(`/exam/${examId}/submit`, {
                        answers: { mcqs: answers, coding: codAnswers },
                        autoSubmit: true,
                        subjective: Object.keys(subjectiveAnswers).length > 0 ? subjectiveAnswers : undefined,
                      })
                      .then(() => {
                        ["answers","codes","active_lang","active_source","subjective"].forEach((key) =>
                          sessionStorage.removeItem(`scope_${key}_${examId}`)
                        );
                        navigate("/dashboard");
                      })
                      .catch(() => navigate("/dashboard"));
                    }}
                    className="w-full font-bold py-3 rounded-xl transition-colors bg-red-600 hover:bg-red-700 text-white"
                  >
                    Submit Exam & Exit
                  </button>
                </div>
              </>
            ) : (
              /* ── TASK 7: VIOLATION ALERT ── */
              <>
                <div className="px-8 pt-8 pb-6 border-b-4 border-orange-500">
                  <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-orange-50 border-2 border-orange-200">
                    <AlertTriangle size={32} className="text-orange-500" />
                  </div>
                  <h2 className="text-2xl font-black mb-1 text-slate-900">Violation Detected</h2>
                  <p className="text-sm font-bold text-orange-600 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded-lg inline-block mt-1">
                    {lastViolationType
                      ? lastViolationType.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())
                      : 'Prohibited Action'}
                  </p>
                </div>
                <div className="px-8 py-5">
                  <div className="mb-4 bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="flex justify-between text-sm font-bold mb-2">
                      <span className="text-slate-600">Violations</span>
                      <span className="text-orange-600">{violationCount} / {MAX_VIOLATIONS}</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2 mb-3">
                      <div
                        className="h-2 rounded-full bg-orange-500 transition-all"
                        style={{ width: `${Math.min(100, (violationCount / MAX_VIOLATIONS) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 font-medium">
                      Remaining chances: <span className="font-black text-slate-700">{MAX_VIOLATIONS - violationCount}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowViolationModal(false);
                      if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen().catch(() => {});
                      }
                    }}
                    className="w-full font-bold py-3 rounded-xl transition-colors bg-slate-900 hover:bg-slate-800 text-white"
                  >
                    I Understand — Return to Exam
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TASK 8: LOCK OVERLAY — blocks exam when max violations reached and student chose to wait */}
      {violationCount >= MAX_VIOLATIONS && !showViolationModal && (
        <LockOverlay
          examId={examId}
          submitPayload={buildSubmissionPayload()}
          navigate={navigate}
          onUnlocked={() => {
            setViolationCount(0);
            setToastMessage('✅ Your session has been unlocked by the administrator.');
          }}
        />
      )}

      {/* 🚨 THE FULLSCREEN ENFORCER OVERLAY */}
      {needsFullscreen && !showViolationModal && (
        <div className="fixed inset-0 z-[200] bg-slate-900 flex flex-col items-center justify-center text-white p-6">
          <Monitor size={64} className="text-rose-500 mb-6 animate-pulse" />
          <h2 className="text-2xl font-black mb-2">Fullscreen Required</h2>
          <p className="text-slate-400 mb-8 max-w-md text-center">
            You have exited the isolated workspace. You must return to
            fullscreen to continue your assessment.
          </p>
          <button
            onClick={() =>
              document.documentElement
                .requestFullscreen()
                .catch(() => alert("Fullscreen blocked by browser."))
            }
            className="bg-blue-900 hover:bg-blue-800 text-white font-bold py-4 px-8 rounded-xl shadow-lg transition-all"
          >
            Click here to resume exam
          </button>
        </div>
      )}

      {toastMessage && (
        <div
          className="fixed top-20 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl z-[100] font-bold text-sm flex items-center gap-2"
          style={{ animation: "toastSlideIn 0.25s cubic-bezier(0.22,1,0.36,1)" }}
        >
          <style>{`@keyframes toastSlideIn{from{opacity:0;transform:translate(-50%,-12px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>
          <AlertTriangle size={16} className="text-amber-400" />
          {toastMessage}
        </div>
      )}

      <header className="bg-white border-b border-slate-200 h-16 flex-shrink-0 flex items-center justify-between px-6 shadow-sm z-20">
        <div className="flex items-center gap-4">
          <Clock size={20} className="text-slate-600" />
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">
              {examData?.title || "Active Examination"}
            </h1>
            <p className="text-xs uppercase">
              <SmartTimer
                examData={examData}
                ts={ts}
                isSynced={isSynced}
                onTimeUp={setIsTimeUp}
                activeSection={activeSection}
                onSectionExpired={handleSectionExpired}
                sectionStartTimes={sectionStartTimes}
              />
            </p>
          </div>
        </div>
        {!isOnline && (
          <span className="flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg text-xs font-bold mr-3">
            ⚠️ Offline — answers saved locally
          </span>
        )}
        <button
          onClick={handleFinishClick}
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg shadow-md transition-all"
        >
          Finish Exam
        </button>
      </header>

      <div className="bg-white border-b border-slate-200 flex px-6 flex-shrink-0 z-10 justify-between items-center">
        <div className="flex">
          {/* Task 2: Only show MCQ tab if MCQ questions exist */}
          {(examData?.sections || []).some(s => (s.questions || []).length > 0) && (
            <button
              onClick={() => {
                if (!lockedSections['technical']) {
                  if (!sectionStartTimes['technical']) recordSectionStart('technical');
                  setActiveSection("technical");
                }
              }}
              disabled={!!lockedSections['technical']}
              className={`flex items-center gap-2 px-6 py-3.5 text-sm font-bold border-b-2 transition-colors ${
                activeSection === "technical"
                  ? "border-blue-900 text-blue-900"
                  : lockedSections['technical']
                    ? "border-transparent text-slate-300 cursor-not-allowed opacity-50"
                    : "border-transparent text-slate-500"
              }`}
            >
              <FileText size={18} /> MCQs
              {lockedSections['technical'] && <Lock size={14} className="text-red-400 ml-1" />}
            </button>
          )}

          {/* Task 2: Only show Coding tab if coding problems exist */}
          {(examData?.codingProblems || []).length > 0 && (
            <button
              onClick={() => {
                if (!isCodingLocked && !lockedSections['coding']) {
                  if (!sectionStartTimes['coding']) recordSectionStart('coding');
                  setActiveSection("coding");
                }
              }}
              disabled={isCodingLocked || !!lockedSections['coding']}
              className={`flex items-center gap-2 px-6 py-3.5 text-sm font-bold border-b-2 transition-colors ${
                activeSection === "coding"
                  ? "border-blue-900 text-blue-900"
                  : isCodingLocked || lockedSections['coding']
                    ? "border-transparent text-slate-300 cursor-not-allowed"
                    : "border-transparent text-slate-500"
              }`}
            >
              <Code size={18} /> Coding Challenge
              {(isCodingLocked || lockedSections['coding']) && (
                <CheckCircle size={14} className="text-emerald-500 ml-1" />
              )}
            </button>
          )}

          {/* Task 2: Only show QnA tab if subjective questions exist */}
          {(examData?.subjectiveQuestions || []).length > 0 && (
            <button
              onClick={() => {
                if (!lockedSections['subjective']) {
                  if (!sectionStartTimes['subjective']) recordSectionStart('subjective');
                  setActiveSection('subjective');
                }
              }}
              disabled={!!lockedSections['subjective']}
              className={`flex items-center gap-2 px-6 py-3.5 text-sm font-bold border-b-2 transition-colors ${
                activeSection === 'subjective'
                  ? 'border-blue-900 text-blue-900'
                  : lockedSections['subjective']
                    ? 'border-transparent text-slate-300 cursor-not-allowed opacity-50'
                    : 'border-transparent text-slate-500'
              }`}
            >
              <FileText size={18} /> Theory / Subjective
              {lockedSections['subjective'] && <Lock size={14} className="text-red-400 ml-1" />}
            </button>
          )}
        </div>

        {activeSection === "coding" && !isCodingLocked && (
          <button
            onClick={() => setShowLockModal(true)}
            className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-4 py-1.5 rounded text-sm font-bold transition-all shadow-sm"
          >
            Submit Coding & Proceed <ChevronRight size={16} />
          </button>
        )}
      </div>

      <main className="flex-1 overflow-hidden">
        {activeSection === "coding" && renderCodingSection()}
        {activeSection === "technical" &&
          renderMCQSection(currentTechQ, setCurrentTechQ)}
        {activeSection === 'subjective' && renderSubjectiveSection()}
      </main>

      {showLockModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-black text-slate-900 mb-2">
              Lock Coding Section?
            </h2>
            <p className="text-sm text-slate-600 mb-6 font-medium">
              Are you sure?{" "}
              <span className="text-red-600 font-bold">
                You cannot return to the coding challenge.
              </span>
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowLockModal(false)}
                className="px-5 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={executeCodingLock}
                className="px-5 py-2.5 bg-blue-900 hover:bg-blue-800 text-white font-bold rounded-lg shadow-md transition-colors"
              >
                Yes, Lock & Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {showEndModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-2">
              Submit Exam
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              You are about to lock in your answers. Please enter the End
              Password to finalize submission.
            </p>
            <input
              type="password"
              placeholder="End Password"
              value={endPasswordInput}
              onChange={(e) => setEndPasswordInput(e.target.value)}
              className="w-full p-3 rounded-lg border-2 border-slate-200 mb-4 outline-none"
            />
            {endPasswordError && (
              <p className="text-sm text-red-500 font-bold mb-4">
                {endPasswordError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowEndModal(false)}
                className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={confirmAndSubmit}
                disabled={isSubmitting || !endPasswordInput}
                className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg"
              >
                {isSubmitting ? "Verifying..." : "Confirm & Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}