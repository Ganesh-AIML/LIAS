// Strict proctoring readiness gate. Used by ExamWorkspace's INITIALIZING phase
// (between password verification and exam becoming usable). Per policy: every
// check below is mandatory — no degraded mode, no partial pass. If any check
// fails, exam entry must be blocked and retry offered.
//
// This module is intentionally separate from engine.js: the engine itself
// stays permissive/fail-open internally (camera still runs even if models
// fail to load — see AUD-041 in engine.js), because that resilience is
// correct behavior for an already-running exam. Strict "all or nothing"
// policy belongs at the entry gate, not baked into the engine's runtime
// behavior, so the same engine can serve both a strict gate (here) and stay
// robust mid-exam (existing _loop() degrades gracefully per individual model).

import proctoringEngine from './engine';

const POLL_INTERVAL_MS = 200;
// AUD-043: model download (TFJS + COCO-SSD + MediaPipe WASM + face model
// asset) is a one-time, real, multi-MB network fetch — its duration is
// network-bound and NOT comparable to the camera/permission checks below,
// which should resolve in a couple seconds once the user grants permission.
// Bounding BOTH under one short timeout was the root cause of "Proctoring
// models failed to load" firing on fast students who reached ExamWorkspace
// before the (perfectly healthy, still-progressing) background download
// finished — see readiness.js audit notes / chat history for full trace.
// Model loading therefore gets its own effectively-unbounded wait stage; the
// camera/loop stage keeps a short timeout since those genuinely are fast.
const MODEL_WAIT_CEILING_MS = 90000; // backstop only — trips if the download is ACTUALLY broken, not just slow
const CAMERA_LOOP_TIMEOUT_MS = 8000; // camera permission + first frame + first loop tick — should be fast
const LOOP_ALIVE_MAX_AGE_MS = 1500; // lastTickAt must be more recent than this to count as "running"
const LUMA_DARK_THRESHOLD = 15; // mirrors engine.js LUMA_DARK_THRESHOLD — kept in sync manually, both are small/stable

const REASONS = {
  CAMERA:  'camera',   // stream missing or track not live
  BLACK:   'black',    // frames arriving but black (shutter/cover/lens cap)
  FACE:    'face',     // face detection model never produced a successful inference
  LOOP:    'loop',     // detection loop not ticking
  MODELS:  'models',   // models did not finish loading within the backstop ceiling — genuinely broken, not just slow
  PIPELINE:'pipeline', // violation callback not wired (enforcement mode only)
};

const REASON_MESSAGES = {
  [REASONS.CAMERA]:   'Camera is not active. Please check camera permissions and try again.',
  [REASONS.BLACK]:    'No usable video signal — check that your camera is not covered, has a lens cap removed, or a shutter closed.',
  [REASONS.FACE]:     'Face detection could not initialize. Please ensure you are visible in the frame and try again.',
  [REASONS.LOOP]:     'Proctoring monitoring is not running. Please retry.',
  [REASONS.MODELS]:   'Proctoring models could not be downloaded. Please check your network connection and try again.',
  [REASONS.PIPELINE]: 'Violation reporting could not be confirmed. Please retry.',
};

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function isCameraHealthy() {
  const track = proctoringEngine.stream?.getVideoTracks?.()[0];
  return !!track && track.readyState === 'live';
}

function isFrameNotBlack() {
  const luma = proctoringEngine._sampleLuminance();
  if (luma === null) return false; // can't confirm yet (video not ready) — treat as not-yet-passing, not as failure
  return luma >= LUMA_DARK_THRESHOLD;
}

function isLoopAlive() {
  return proctoringEngine.running && (Date.now() - proctoringEngine.lastTickAt) < LOOP_ALIVE_MAX_AGE_MS;
}

/**
 * Strictly verifies every proctoring precondition before allowing the exam
 * to become usable. No degraded mode — every check below is mandatory.
 *
 * Two independent stages:
 *   1. MODEL WAIT (effectively unbounded, ceiling is a broken-download
 *      backstop only) — reuses prepare()'s singleton promise, so this never
 *      re-triggers a download; it just waits for whatever is already in
 *      flight (which may have started as early as PreExamCheck/Dashboard
 *      mount, well before this function was even called).
 *   2. CAMERA/LOOP WAIT (short timeout) — only begins once models are
 *      confirmed ready, since face-detection-confirmation depends on models.
 *
 * @param {object} opts
 * @param {(stage: 'models'|'camera') => void} [opts.onStageChange] — UI hook so the caller can show "preparing" vs "checking camera"
 * @returns {Promise<{ ok: boolean, reason?: string, message?: string, checks: object }>}
 */
export async function verifyProctoringReady({ onStageChange } = {}) {
  const pipelineOk = typeof proctoringEngine.onViolation === 'function';
  if (!pipelineOk) {
    return {
      ok: false,
      reason: REASONS.PIPELINE,
      message: REASON_MESSAGES[REASONS.PIPELINE],
      checks: { pipeline: false },
    };
  }

  // ── STAGE 1: MODEL WAIT (unbounded, backstopped) ──────────────────────────
  // prepare() is idempotent/singleton (see engine.js prepare() guard) — calling
  // it here never starts a second download, it just gives us the same
  // in-flight or already-resolved promise that may have been kicked off
  // minutes earlier on PreExamCheck/Dashboard mount.
  if (onStageChange) onStageChange('models');
  if (!proctoringEngine.modelsReady) {
    const modelWait = proctoringEngine.prepare();
    await Promise.race([modelWait, sleep(MODEL_WAIT_CEILING_MS)]);
  }

  if (!proctoringEngine.modelsReady) {
    return {
      ok: false,
      reason: REASONS.MODELS,
      message: REASON_MESSAGES[REASONS.MODELS],
      checks: { models: false, pipeline: pipelineOk },
    };
  }

  // ── STAGE 2: CAMERA / LOOP WAIT (short timeout — these should be fast) ───
  if (onStageChange) onStageChange('camera');
  proctoringEngine.start('enforcement'); // models already ready, so this resolves quickly (camera + loop only)

  const deadline = Date.now() + CAMERA_LOOP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const cameraOk = isCameraHealthy();
    const blackOk  = cameraOk && isFrameNotBlack();
    const faceOk   = proctoringEngine.faceInferenceOk;
    const loopOk   = isLoopAlive();

    if (cameraOk && blackOk && faceOk && loopOk) {
      return {
        ok: true,
        checks: { models: true, camera: true, black: true, face: true, loop: true, pipeline: true },
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  const finalChecks = {
    models: true, // confirmed in stage 1
    camera: isCameraHealthy(),
    black:  isCameraHealthy() && isFrameNotBlack(),
    face:   proctoringEngine.faceInferenceOk,
    loop:   isLoopAlive(),
    pipeline: pipelineOk,
  };

  let reason = REASONS.CAMERA;
  if (!finalChecks.camera)      reason = REASONS.CAMERA;
  else if (!finalChecks.black)  reason = REASONS.BLACK;
  else if (!finalChecks.face)   reason = REASONS.FACE;
  else if (!finalChecks.loop)   reason = REASONS.LOOP;

  return {
    ok: false,
    reason,
    message: REASON_MESSAGES[reason],
    checks: finalChecks,
  };
}

export default verifyProctoringReady;