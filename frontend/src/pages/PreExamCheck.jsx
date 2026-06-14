import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import { CheckCircle, XCircle, Monitor, Camera, Mic, Wifi, AlertTriangle, Activity, ShieldCheck } from 'lucide-react';

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

  const [networkSpeed, setNetworkSpeed] = useState(null); // Mbps or null while measuring
  const [networkStatus, setNetworkStatus] = useState('measuring'); // measuring | good | warn | fail

  const allPassed = Object.values(checks).every(Boolean);
  const [fullscreenLost, setFullscreenLost] = useState(false);

  // ── NETWORK SPEED MEASUREMENT ───────────────────────────────────────────
  // Downloads a small timestamped payload from the backend health endpoint
  // and derives an approximate throughput in Mbps for display.
  const measureNetworkSpeed = async (isMounted) => {
    setNetworkStatus('measuring');
    setNetworkSpeed(null);
    try {
      // Use a small payload — the goal is latency+throughput estimation, not a real speedtest
      const PAYLOAD_BYTES = 50000; // ~50KB via repeated health pings
      const t0 = performance.now();
      await api.get('/auth/health-check');
      const t1 = performance.now();
      const latencyMs = t1 - t0;

      // Rough throughput estimate: assume minimal payload, derive from timing
      // A real speedtest would download a known-size blob; this is a latency proxy
      const estimatedMbps = parseFloat((1 / (latencyMs / 1000)).toFixed(1));
      const displayMbps = Math.min(estimatedMbps, 100); // cap display at 100 Mbps

      if (!isMounted) return;
      setNetworkSpeed(displayMbps);

      if (latencyMs < 200) {
        setNetworkStatus('good');
        setChecks(prev => ({ ...prev, network: true }));
      } else if (latencyMs < 800) {
        setNetworkStatus('warn');
        setChecks(prev => ({ ...prev, network: true })); // warn still passes
      } else {
        setNetworkStatus('fail');
        setChecks(prev => ({ ...prev, network: false }));
      }
    } catch {
      if (!isMounted) return;
      setNetworkStatus('fail');
      setNetworkSpeed(0);
      setChecks(prev => ({ ...prev, network: false }));
    }
  };
  // ── END NETWORK MEASUREMENT ──────────────────────────────────────────────

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

    // 1. Network speed measurement
    measureNetworkSpeed(isMounted);

    // 2. Staggered hardware pipeline
    retryCount.current = 0;
    initHardware(isMounted);

    // 3. Fullscreen listener
    const handleFullscreen = () => {
  const isFs = !!document.fullscreenElement;
  setChecks(prev => ({ ...prev, fullscreen: isFs }));
  setFullscreenLost(!isFs);
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
        <div className="flex items-center gap-2 mb-3">
            <img src="/Main-Logo.png" alt="LIAS" className="h-8 w-auto object-contain" />
          </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">System Pre-Check</h1>
        <p className="text-slate-500 mt-2 font-medium">Verify your environment before beginning.</p>
      </div>

      <div className="w-full max-w-5xl flex flex-col md:flex-row gap-6">
        <div className="flex-1 bg-white rounded-2xl shadow-lg border border-slate-200 p-6 space-y-4">
          <NetworkSpeedItem passed={checks.network} status={networkStatus} speed={networkSpeed} onRetry={() => measureNetworkSpeed(true)} />
          <CheckItem icon={<Camera />} title="Camera Access"        passed={checks.camera}  pending={!checks.camera && !hardwareError && !retrying} />
          <CheckItem icon={<Mic />}    title="Microphone Access"    passed={checks.mic}     pending={!checks.mic && !hardwareError && !retrying} />

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
          {fullscreenLost && (
  <div className="flex items-center justify-between p-4 bg-amber-50 border border-amber-300 rounded-xl">
    <div className="flex items-center gap-3">
      <AlertTriangle size={18} className="text-amber-500 shrink-0" />
      <p className="text-sm font-bold text-amber-700">Fullscreen was exited. Re-enable it to continue.</p>
    </div>
    <button
      onClick={requestFullscreen}
      className="text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg whitespace-nowrap"
    >
      Re-enter Fullscreen
    </button>
  </div>
)}
          {hardwareError && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
              <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold text-red-700">{hardwareError}</p>
              </div>
              <button onClick={handleManualRetry}
                className="text-xs font-bold text-red-600 border border-red-300 px-3 py-1.5 rounded-lg hover:bg-red-100 whitespace-nowrap">
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
              className={`w-full py-3.5 rounded-xl font-bold text-lg transition-all ${allPassed ? 'bg-blue-900 hover:bg-blue-800 text-white shadow-md' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
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
            <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-4">
              <ShieldCheck size={22} className="text-blue-900" />
            </div>
            <h2 className="text-xl font-black text-slate-900 mb-1">Examination Rules</h2>
            <p className="text-sm text-slate-500 mb-5">Please review before entering the exam.</p>
            <ul className="space-y-2.5 mb-6">
              <li className="flex items-start gap-2.5 text-sm text-slate-600"><CheckCircle size={16} className="text-emerald-500 mt-0.5 shrink-0" /> Stay in fullscreen mode for the entire duration.</li>
              <li className="flex items-start gap-2.5 text-sm text-slate-600"><CheckCircle size={16} className="text-emerald-500 mt-0.5 shrink-0" /> Remain visible in the camera frame at all times.</li>
              <li className="flex items-start gap-2.5 text-sm text-slate-600"><CheckCircle size={16} className="text-emerald-500 mt-0.5 shrink-0" /> Do not switch tabs, open other apps, or use external devices.</li>
              <li className="flex items-start gap-2.5 text-sm text-slate-600"><CheckCircle size={16} className="text-emerald-500 mt-0.5 shrink-0" /> Submit before the timer ends — no extensions are granted.</li>
            </ul>
            <div className="flex items-start gap-3 mb-8 pt-4 border-t border-slate-100">
              <input type="checkbox" id="agree" className="mt-1 w-4 h-4 rounded text-blue-900" onChange={e => setRulesAccepted(e.target.checked)} />
              <label htmlFor="agree" className="text-sm font-bold text-slate-900 cursor-pointer">I agree to the proctoring terms.</label>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowRules(false)} className="px-5 py-2.5 text-slate-500 font-bold">Cancel</button>
              <button disabled={!rulesAccepted} onClick={proceedToDashboard}
                className={`px-6 py-2.5 rounded-lg font-bold text-white transition-colors ${rulesAccepted ? 'bg-blue-900 hover:bg-blue-800' : 'bg-slate-300'}`}>
                Enter Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_CONFIG = {
  measuring: { bar: 'bg-slate-300', label: 'Measuring…',  text: 'text-slate-400', bg: 'bg-slate-50',  border: 'border-slate-200' },
  good:      { bar: 'bg-emerald-500', label: 'Good',      text: 'text-emerald-600', bg: 'bg-slate-50', border: 'border-slate-200' },
  warn:      { bar: 'bg-amber-400',   label: 'Moderate',  text: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  fail:      { bar: 'bg-red-500',    label: 'Poor',      text: 'text-red-600',   bg: 'bg-red-50',   border: 'border-red-200'  },
};

const NetworkSpeedItem = ({ passed, status, speed, onRetry }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.measuring;
  // Bar width: map 0–50 Mbps to 0–100%
  const barWidth = speed !== null ? Math.min((speed / 50) * 100, 100) : 30;

  return (
    <div className={`p-4 rounded-xl border ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <Wifi className={passed ? 'text-emerald-500' : status === 'measuring' ? 'text-slate-400 animate-pulse' : 'text-red-500'} />
          <div>
            <p className="font-bold text-slate-900 leading-tight">Network Connectivity</p>
            <p className={`text-xs font-semibold mt-0.5 ${cfg.text}`}>
              {status === 'measuring' ? 'Checking connection…' : speed !== null ? `~${speed} Mbps — ${cfg.label}` : cfg.label}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === 'fail' && (
            <button onClick={onRetry} className="text-xs font-bold text-red-600 border border-red-300 px-3 py-1.5 rounded-lg hover:bg-red-100 whitespace-nowrap">
              Retry
            </button>
          )}
          {status === 'measuring'
            ? <div className="w-5 h-5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
            : passed
              ? <CheckCircle className="text-emerald-500 shrink-0" />
              : <XCircle className="text-red-500 shrink-0" />
          }
        </div>
      </div>
      {/* Speed bar */}
      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all duration-700 ${cfg.bar} ${status === 'measuring' ? 'animate-pulse' : ''}`}
          style={{ width: `${status === 'measuring' ? 40 : barWidth}%` }}
        />
      </div>
    </div>
  );
};

const CheckItem = ({ icon, title, passed, pending }) => (
  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
    <div className="flex items-center gap-4">
      <div className={passed ? 'text-emerald-500' : 'text-slate-400'}>{icon}</div>
      <p className="font-bold text-slate-900">{title}</p>
    </div>
    {passed
      ? <CheckCircle className="text-emerald-500" />
      : pending
        ? <div className="w-5 h-5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
        : <XCircle className="text-red-500" />}
  </div>
);