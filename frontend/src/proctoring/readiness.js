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
const DEFAULT_TIMEOUT_MS = 15000; // generous: camera permission prompt + model load can be slow on first run
const LOOP_ALIVE_MAX_AGE_MS = 1500; // lastTickAt must be more recent than this to count as "running"
const LUMA_DARK_THRESHOLD = 15; // mirrors engine.js LUMA_DARK_THRESHOLD — kept in sync manually, both are small/stable

const REASONS = {
  CAMERA:  'camera',   // stream missing or track not live
  BLACK:   'black',    // frames arriving but black (shutter/cover/lens cap)
  FACE:    'face',     // face detection model never produced a successful inference
  LOOP:    'loop',     // detection loop not ticking
  MODELS:  'models',   // models did not finish loading
  PIPELINE:'pipeline', // violation callback not wired (enforcement mode only)
  TIMEOUT: 'timeout',  // overall timeout before all checks passed
};

const REASON_MESSAGES = {
  [REASONS.CAMERA]:   'Camera is not active. Please check camera permissions and try again.',
  [REASONS.BLACK]:    'No usable video signal — check that your camera is not covered, has a lens cap removed, or a shutter closed.',
  [REASONS.FACE]:     'Face detection could not initialize. Please ensure you are visible in the frame and try again.',
  [REASONS.LOOP]:     'Proctoring monitoring is not running. Please retry.',
  [REASONS.MODELS]:   'Proctoring models failed to load. Please check your network connection and try again.',
  [REASONS.PIPELINE]: 'Violation reporting could not be confirmed. Please retry.',
  [REASONS.TIMEOUT]:  'Proctoring did not become ready in time. Please retry.',
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
 * to become usable. Calls engine.start('enforcement') (idempotent if already
 * running). Polls until ALL checks pass or timeout elapses.
 *
 * @param {object} opts
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ ok: boolean, reason?: string, message?: string, checks: object }>}
 */
export async function verifyProctoringReady({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // Caller (ExamWorkspace) must already have set proctoringEngine.onViolation
  // before calling this — that's how useProctoring('enforcement') normally
  // wires it. We just verify it's actually set, we don't set it ourselves,
  // so this module has no opinion on transport/reporting details.
  const pipelineOk = typeof proctoringEngine.onViolation === 'function';
  if (!pipelineOk) {
    return {
      ok: false,
      reason: REASONS.PIPELINE,
      message: REASON_MESSAGES[REASONS.PIPELINE],
      checks: { pipeline: false },
    };
  }

  // start() is idempotent (no-op if already running) and internally awaits
  // prepare() once, then acquires camera and begins the loop. We don't await
  // it here directly because under strict policy we want our own poll loop
  // to observe granular failure reasons (camera vs black-frame vs loop),
  // not just "did start() throw".
  proctoringEngine.start('enforcement');

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const modelsOk = proctoringEngine.modelsReady;
    const cameraOk = isCameraHealthy();
    const blackOk  = cameraOk && isFrameNotBlack();
    const faceOk   = proctoringEngine.faceInferenceOk;
    const loopOk   = isLoopAlive();

    if (modelsOk && cameraOk && blackOk && faceOk && loopOk) {
      return {
        ok: true,
        checks: { models: true, camera: true, black: true, face: true, loop: true, pipeline: true },
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Timed out — figure out the most relevant single reason to surface,
  // checked in dependency order (camera blocks everything downstream, so
  // report that first if it's the culprit).
  const finalChecks = {
    models: proctoringEngine.modelsReady,
    camera: isCameraHealthy(),
    black:  isCameraHealthy() && isFrameNotBlack(),
    face:   proctoringEngine.faceInferenceOk,
    loop:   isLoopAlive(),
    pipeline: pipelineOk,
  };

  let reason = REASONS.TIMEOUT;
  if (!finalChecks.camera)      reason = REASONS.CAMERA;
  else if (!finalChecks.black)  reason = REASONS.BLACK;
  else if (!finalChecks.models) reason = REASONS.MODELS;
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