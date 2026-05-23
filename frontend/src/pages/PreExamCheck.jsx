import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import { CheckCircle, XCircle, Monitor, Camera, Mic, Wifi, AlertTriangle } from 'lucide-react';

// Maps browser DOMException names to human-readable causes
const HARDWARE_ERROR_MAP = {
  NotAllowedError:    'Permission denied. Please allow camera/mic access in your browser settings.',
  NotFoundError:      'No camera or microphone detected. Please connect a device and retry.',
  NotReadableError:   'Hardware is busy — another app may be using it. Close other apps and retry.',
  AbortError:         'Driver timeout. This usually resolves on retry — click Retry below.',
  OverconstrainedError: 'Camera does not meet requirements. Try a different camera.',
};

// Max automatic retries for transient errors (AbortError, NotReadableError)
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1200;
const TRANSIENT_ERRORS = new Set(['AbortError', 'NotReadableError']);

export default function PreExamCheck() {
  const navigate = useNavigate();
  const setPreCheckStatus = useAuthStore((state) => state.setPreCheckStatus);
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const retryCount = useRef(0);

  const [checks, setChecks]           = useState({ network: false, camera: false, mic: false, fullscreen: false });
  const [hardwareError, setHardwareError] = useState('');
  const [retrying, setRetrying]       = useState(false);
  const [showRules, setShowRules]     = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);

  const allPassed = Object.values(checks).every(Boolean);

  // ── STAGGERED HARDWARE INIT ──────────────────────────────────────────────
  // Root cause fix: requesting video + audio in one getUserMedia call causes
  // a driver-level handshake conflict on Windows/Chrome, producing AbortError.
  // Solution: sequential acquisition with a deliberate yield between each device.
  const initHardware = async (isMounted) => {
    setHardwareError('');

    // STEP 1 — Video only. Explicit constraints help the driver negotiate faster.
    let vStream;
    try {
      vStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width:       { ideal: 1280 },
          height:      { ideal: 720 },
          facingMode:  'user',
          frameRate:   { ideal: 15 },   // lower framerate = faster driver handshake
        }
      });
    } catch (err) {
      if (!isMounted) return;

      // Auto-retry on transient errors
      if (TRANSIENT_ERRORS.has(err.name) && retryCount.current < MAX_RETRIES) {
        retryCount.current += 1;
        setRetrying(true);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        setRetrying(false);
        return initHardware(isMounted);  // recursive retry
      }

      setHardwareError(HARDWARE_ERROR_MAP[err.name] || `Camera error: ${err.message}`);
      return;
    }

    if (!isMounted) { vStream.getTracks().forEach(t => t.stop()); return; }

    // Attach video stream to preview element
    streamRef.current = vStream;
    setChecks(prev => ({ ...prev, camera: true }));
    if (videoRef.current) {
      videoRef.current.srcObject = vStream;
      videoRef.current.play().catch(() => {});
    }

    // STEP 2 — Deliberate yield: let the video driver finish negotiating
    // before touching the audio subsystem. 300ms is sufficient on most drivers.
    await new Promise(r => setTimeout(r, 300));
    if (!isMounted) return;

    // STEP 3 — Audio only, separate call
    try {
      const aStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      if (!isMounted) { aStream.getTracks().forEach(t => t.stop()); return; }

      // Merge audio track into the existing video stream
      aStream.getAudioTracks().forEach(t => streamRef.current.addTrack(t));
      setChecks(prev => ({ ...prev, mic: true }));

    } catch (err) {
      if (!isMounted) return;
      // Mic failure is non-fatal for camera check — mark mic failed specifically
      setHardwareError(HARDWARE_ERROR_MAP[err.name] || `Microphone error: ${err.message}`);
    }
  };
  // ── END HARDWARE INIT ────────────────────────────────────────────────────

  useEffect(() => {
    let isMounted = true;

    // 1. Network ping
    api.get('/auth/health-check')
      .then(() => isMounted && setChecks(prev => ({ ...prev, network: true })))
      .catch(() => {});

    // 2. Staggered hardware pipeline
    retryCount.current = 0;
    initHardware(isMounted);

    // 3. Fullscreen listener
    const handleFullscreen = () => {
      setChecks(prev => ({ ...prev, fullscreen: !!document.fullscreenElement }));
    };
    document.addEventListener('fullscreenchange', handleFullscreen);

    return () => {
      isMounted = false;
      document.removeEventListener('fullscreenchange', handleFullscreen);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleManualRetry = () => {
    // Stop any partial streams before retrying
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setChecks(prev => ({ ...prev, camera: false, mic: false }));
    retryCount.current = 0;
    initHardware(true);
  };

  const requestFullscreen = () => document.documentElement.requestFullscreen().catch(() => {});

  const proceedToDashboard = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        alert('Fullscreen is required to start the exam.');
        return;
      }
    }
    setPreCheckStatus(true);
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex flex-col items-center justify-center font-sans">
      <div className="w-full max-w-5xl mb-6">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">System Pre-Check</h1>
        <p className="text-slate-500 mt-2 font-medium">Verify your environment before beginning.</p>
      </div>

      <div className="w-full max-w-5xl flex flex-col md:flex-row gap-6">
        <div className="flex-1 bg-white rounded-2xl shadow-lg border border-slate-200 p-6 space-y-4">
          <CheckItem icon={<Wifi />}   title="Network Connectivity" passed={checks.network} />
          <CheckItem icon={<Camera />} title="Camera Access"        passed={checks.camera}  />
          <CheckItem icon={<Mic />}    title="Microphone Access"    passed={checks.mic}     />

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-4">
              <Monitor className={checks.fullscreen ? 'text-emerald-500' : 'text-slate-400'} />
              <p className="font-bold text-slate-900">Fullscreen Mode</p>
            </div>
            {checks.fullscreen
              ? <CheckCircle className="text-emerald-500" />
              : <button onClick={requestFullscreen} className="px-4 py-2 bg-slate-900 text-white text-sm font-bold rounded-lg hover:bg-slate-800">Enable</button>
            }
          </div>

          {/* Hardware error banner + manual retry */}
          {hardwareError && (
            <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl">
              <AlertTriangle size={18} className="text-rose-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold text-rose-700">{hardwareError}</p>
              </div>
              <button onClick={handleManualRetry}
                className="text-xs font-bold text-rose-600 border border-rose-300 px-3 py-1.5 rounded-lg hover:bg-rose-100 whitespace-nowrap">
                Retry
              </button>
            </div>
          )}

          {retrying && (
            <p className="text-xs text-slate-400 text-center animate-pulse">
              Waiting for hardware driver… retrying ({retryCount.current}/{MAX_RETRIES})
            </p>
          )}

          <div className="pt-4">
            <button disabled={!allPassed} onClick={() => setShowRules(true)}
              className={`w-full py-3.5 rounded-xl font-bold text-lg transition-all ${allPassed ? 'bg-cyan-600 hover:bg-cyan-700 text-white shadow-md' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
              Proceed to Dashboard
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-900 rounded-2xl overflow-hidden shadow-xl relative flex items-center justify-center min-h-[350px]">
          <video ref={videoRef} muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" />
        </div>
      </div>

      {showRules && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-lg w-full rounded-2xl p-8 shadow-2xl">
            <h2 className="text-xl font-black text-slate-900 mb-6">Examination Rules</h2>
            <div className="flex items-start gap-3 mb-8">
              <input type="checkbox" id="agree" className="mt-1 w-4 h-4 rounded text-cyan-600" onChange={e => setRulesAccepted(e.target.checked)} />
              <label htmlFor="agree" className="text-sm font-bold text-slate-900 cursor-pointer">I agree to the proctoring terms.</label>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowRules(false)} className="px-5 py-2.5 text-slate-500 font-bold">Cancel</button>
              <button disabled={!rulesAccepted} onClick={proceedToDashboard}
                className={`px-6 py-2.5 rounded-lg font-bold text-white ${rulesAccepted ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-slate-300'}`}>
                Enter Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CheckItem = ({ icon, title, passed }) => (
  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
    <div className="flex items-center gap-4">
      <div className={passed ? 'text-emerald-500' : 'text-slate-400'}>{icon}</div>
      <p className="font-bold text-slate-900">{title}</p>
    </div>
    {passed ? <CheckCircle className="text-emerald-500" /> : <XCircle className="text-rose-500 animate-pulse" />}
  </div>
);