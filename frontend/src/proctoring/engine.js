// Headless proctoring engine. Ported detection logic from ProctorAI
// (face landmark / yaw / coco-ssd loop). No DOM UI of its own —
// LIAS pages stay untouched. Modes: 'preparing' | 'observation' | 'enforcement'.

const TFJS_URL    = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
const COCO_URL     = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';
const VISION_URL    = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs';
const WASM_BASE    = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';

const YAW_THRESHOLD_DEG = 30;
const OBJECT_SCAN_MS    = 2000;
const COOLDOWN_MS       = 8000; // higher than ProctorAI default — avoid flooding /exam/violation
const FACE_FRAME_SKIP   = 2;    // run face inference every Nth RAF tick (perf, esp. on Workspace)

// AUD-036: physical shutter/lens-cap closure keeps the MediaStreamTrack
// 'live' and the video element happily playing — it just delivers black
// frames. FaceLandmarker can silently no-op or error on a degenerate
// all-black frame (swallowed by the existing inference catch), so
// face_absent never fires. Cheap periodic luminance sampling closes that
// gap and reports through the exact same face_absent path.
const LUMA_CHECK_MS        = 2000; // reuse object-scan cadence, avoid extra CPU load
const LUMA_DARK_THRESHOLD  = 15;   // mean 0-255 brightness; near-pure-black frame
const LUMA_DARK_STREAK_REQ = 2;    // consecutive dark checks before flagging (~4s)

let scriptPromises = {};
function loadScript(src) {
  if (scriptPromises[src]) return scriptPromises[src];
  scriptPromises[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return scriptPromises[src];
}

class ProctoringEngine {
  constructor() {
    this.mode = 'off';
    this.stream = null;
    this.video = null;
    this.faceLandmarker = null;
    this.cocoModel = null;
    this.modelsReady = false;
    this.modelsLoading = null;
    this.running = false;
    this.rafId = null;
    this.frameTick = 0;
    this.lastObjectScan = 0;
    this.lastLumaCheck = 0;
    this.darkStreak = 0;
    this.lumaCanvas = null;
    this.cooldown = {};
    this.onViolation = null; // (eventType, detail) => void, only called in 'enforcement'
    this.onLocalFlag = null; // (eventType, detail) => void, called in observation+enforcement
  }

  // PREPARING — fetch/warm models only, no camera, no inference.
  async prepare() {
    if (this.modelsReady || this.modelsLoading) return this.modelsLoading;
    this.modelsLoading = this._loadModels().catch((err) => {
      // Non-fatal: prepare() failures must never block PreExamCheck navigation.
      console.warn('[proctoring] model prefetch failed', err);
      this.modelsLoading = null;
    });
    return this.modelsLoading;
  }

  async _loadModels() {
    await Promise.all([loadScript(TFJS_URL), loadScript(COCO_URL)]);
    const visionMod = await import(/* @vite-ignore */ VISION_URL);
    const { FilesetResolver, FaceLandmarker } = visionMod;
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU',
      },
      outputFacialTransformationMatrixes: true,
      numFaces: 1,
      runningMode: 'VIDEO',
    });
    // eslint-disable-next-line no-undef
    this.cocoModel = await cocoSsd.load();
    this.modelsReady = true;
  }

  // OBSERVATION / ENFORCEMENT — acquire own camera stream, start detection loop.
  // mode: 'observation' | 'enforcement'
  async start(mode) {
    this.mode = mode;
    if (this.running) return; // loop already active, mode switch above is enough

    try {
      if (!this.modelsReady) await this.prepare();
      if (!this.modelsReady) return; // models unavailable — fail open per failure policy

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      await new Promise((res) => {
        if (this.video.readyState >= 2) return res();
        this.video.addEventListener('loadeddata', res, { once: true });
      });

      this.running = true;
      this.frameTick = 0;
      this.lastObjectScan = 0;
      this.lastLumaCheck = 0;
      this.darkStreak = 0;
      this.rafId = requestAnimationFrame((t) => this._loop(t));
    } catch (err) {
      // Camera/model failure must not block Dashboard or (per policy) abort Enforcement —
      // proctoring degrades silently, exam flow is untouched.
      console.warn('[proctoring] start failed', err);
      this.running = false;
    }
  }

  setMode(mode) {
    this.mode = mode;
  }

  _loop(now) {
    if (!this.running) return;
    this.frameTick++;

    // Unplug case: track ends outright — definitive, no sampling needed.
    const track = this.stream?.getVideoTracks?.()[0];
    if (track && track.readyState === 'ended') {
      this._flag('face_absent', 'Camera disconnected during exam');
    }

    // Shutter/lens-cap case: track stays 'live' but frames are black.
    if (now - this.lastLumaCheck > LUMA_CHECK_MS) {
      this.lastLumaCheck = now;
      const luma = this._sampleLuminance();
      if (luma !== null) {
        if (luma < LUMA_DARK_THRESHOLD) {
          this.darkStreak++;
          if (this.darkStreak >= LUMA_DARK_STREAK_REQ) {
            this._flag('face_absent', 'Camera obstructed — no light detected (shutter closed or lens covered)');
          }
        } else {
          this.darkStreak = 0;
        }
      }
    }

    if (this.faceLandmarker && this.frameTick % FACE_FRAME_SKIP === 0) {
      try {
        const result = this.faceLandmarker.detectForVideo(this.video, now);
        if (result.facialTransformationMatrixes?.length) {
          const m = result.facialTransformationMatrixes[0].data;
          const sy = Math.sqrt(m[0] * m[0] + m[4] * m[4]);
          if (sy > 1e-6) {
            const yaw = Math.atan2(-m[8], sy) * (180 / Math.PI);
            if (Math.abs(yaw) > YAW_THRESHOLD_DEG) {
              this._flag('proctor_head_pose', `Head turned — yaw ${yaw.toFixed(1)}°`);
            }
          }
        } else {
          this._flag('face_absent', 'Face not detected — absent or covered');
        }
      } catch { /* skip frame on transient inference error */ }
    }

    if (this.cocoModel && Date.now() - this.lastObjectScan > OBJECT_SCAN_MS) {
      this.lastObjectScan = Date.now();
      this.cocoModel.detect(this.video).then((predictions) => {
        let personCount = 0;
        let flagged = [];
        for (const p of predictions) {
          if (p.class === 'person') personCount++;
          if (['cell phone', 'laptop', 'book', 'remote'].includes(p.class)) flagged.push(p.class);
        }
        if (personCount > 1) this._flag('multi_person', `Multiple persons detected (${personCount})`);
        if (flagged.length) this._flag('object_detected', `Prohibited objects: ${[...new Set(flagged)].join(', ')}`);
      }).catch(() => {});
    }

    this.rafId = requestAnimationFrame((t) => this._loop(t));
  }

  // Cheap mean-brightness sample via a tiny downscaled offscreen canvas —
  // 16x12 px keeps this well under sub-millisecond cost, run only every
  // LUMA_CHECK_MS, not per-frame.
  _sampleLuminance() {
    if (!this.video || this.video.readyState < 2) return null;
    try {
      if (!this.lumaCanvas) {
        this.lumaCanvas = document.createElement('canvas');
        this.lumaCanvas.width = 16;
        this.lumaCanvas.height = 12;
      }
      const ctx = this.lumaCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(this.video, 0, 0, 16, 12);
      const { data } = ctx.getImageData(0, 0, 16, 12);
      let sum = 0;
      const pixelCount = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      return sum / pixelCount;
    } catch {
      return null; // transient canvas/codec error — skip this check, don't flag
    }
  }

  _flag(eventType, detail) {
    const now = Date.now();
    if (this.cooldown[eventType] && now - this.cooldown[eventType] < COOLDOWN_MS) return;
    this.cooldown[eventType] = now;

    if (this.onLocalFlag) this.onLocalFlag(eventType, detail);

    // OBSERVATION: local only, never reported. ENFORCEMENT: report upstream.
    if (this.mode === 'enforcement' && this.onViolation) {
      this.onViolation(eventType, detail);
    }
  }

  // TERMINATED — full teardown, safe to call multiple times.
  stop() {
    this.running = false;
    this.mode = 'off';
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video = null;
    this.cooldown = {};
    this.darkStreak = 0;
  }
}

// Singleton — one engine per browser tab, mirrors LIAS's "one socket per client" pattern.
const proctoringEngine = new ProctoringEngine();
export default proctoringEngine;