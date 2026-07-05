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

// AUD-052 ROOT CAUSE (fail-open inference catch): the previous detectForVideo /
// cocoModel.detect() catch blocks swallowed EVERY exception identically,
// whether transient (one bad frame) or fatal (lost WebGL/GPU context, model
// corrupted, OOM on a modest exam-hall PC over an hour-long exam). A fatal
// failure left the model permanently broken for the rest of the exam, with
// the RAF loop still ticking (lastTickAt kept updating) and faceInferenceOk
// stuck true forever (only set once, never reset on failure) — so every
// downstream health signal looked perfectly healthy while detection was
// completely dead. That is the actual cause of "no face_absent / no
// multi_person for the rest of the exam, no LED change, no error visible
// anywhere." Fix: count consecutive failures per model and fail CLOSED
// (raise an explicit violation + mark the model as degraded so it can
// self-heal) once a real streak is observed, instead of failing silently
// open forever after the first unlucky frame.
const FACE_FAIL_STREAK_THRESHOLD = 10; // ~ a few seconds at FACE_FRAME_SKIP cadence
const COCO_FAIL_STREAK_THRESHOLD = 4;  // ~ a few scan cycles (OBJECT_SCAN_MS apart)

// Face Absent (plain "no landmarks in this frame" case) had ZERO debounce —
// a single missed frame (autofocus hunt, brief head tilt, one dropped/
// corrupted frame) fired an immediate violation. Every OTHER face_absent
// sub-path (track-ended, luma/shutter, degraded-pipeline) already has its
// own streak guard; this is the one that didn't. 20 consecutive misses at
// the ~15/s cadence this pipeline runs at (FACE_FRAME_SKIP=2) is ~1.3-2s —
// long enough to absorb a transient blip, short enough that genuine absence
// still confirms fast.
const FACE_ABSENT_STREAK_REQ = 20;

let scriptPromises = {};
function loadScript(src) {
  if (scriptPromises[src]) return scriptPromises[src];
  scriptPromises[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    // AUD-051 ROOT CAUSE: dynamically-created <script> elements default to
    // async=true, so execution order is whichever script's network fetch
    // finishes first — NOT document/insertion order. coco-ssd.min.js is far
    // smaller than tf.min.js, so on a typical connection it finishes
    // downloading first and executes before TFJS exists, throwing
    // "Cannot find TensorFlow.js" (the exact prod error). async=false forces
    // in-order execution while still fetching non-blockingly.
    s.async = false;
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
    this._startPromise = null; // in-flight start() guard — see AUD-042
    this.frameTick = 0;
    this.lastTickAt = 0; // set every _loop() tick — readiness.js uses this to confirm the loop is actually alive, not just started
    this.lastObjectScan = 0;
    this.lastLumaCheck = 0;
    this.darkStreak = 0;
    this.lumaCanvas = null;
    this.cooldown = {};
    this.faceInferenceOk = false; // set true the first time detectForVideo() runs without throwing — readiness.js requires this under strict policy
    this.faceFailStreak = 0;   // consecutive detectForVideo() exceptions — AUD-052
    this.faceAbsentStreak = 0; // consecutive "no landmarks in frame" results — new debounce for false-positive face_absent
    this.cocoFailStreak = 0;   // consecutive cocoModel.detect() rejections — AUD-052
    this.faceDegraded = false; // true once face pipeline is treated as fatally broken, not just glitchy
    this.cocoDegraded = false; // true once object-detection pipeline is treated as fatally broken
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
  start(mode) {
    this.mode = mode;
    if (this.running) return Promise.resolve(); // loop already active, mode switch above is enough

    // AUD-042: `running` is only set true after getUserMedia resolves, so two
    // near-simultaneous callers (e.g. useProctoring's mount effect and a
    // readiness check both calling start() in the same tick) could otherwise
    // both pass the `running` guard and acquire two separate camera streams.
    // Cache the in-flight attempt so concurrent callers share one acquisition.
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._doStart().finally(() => {
      this._startPromise = null;
    });
    return this._startPromise;
  }

  async _doStart() {
    try {
      // AUD-041: model load (GPU delegate / CDN scripts) can fail permanently in
      // some environments. prepare()'s internal .catch() swallows that error so
      // this await always resolves — but modelsReady can legitimately stay false.
      // Previously a `return` here meant camera was NEVER acquired in that case,
      // silently disabling ALL proctoring (including track-ended/luma checks,
      // which don't need any model) for the rest of the session. Camera
      // acquisition must not depend on model load success — _loop() already
      // guards faceLandmarker/cocoModel individually per-frame, so partial
      // protection (track-ended + luma black-frame) still works with no models.
      if (!this.modelsReady) await this.prepare();

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
    this.lastTickAt = Date.now();

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
        this.faceInferenceOk = true; // inference ran without throwing — confirms model+camera+loop are wired correctly together
        this.faceFailStreak = 0;
        this.faceDegraded = false;
        if (result.facialTransformationMatrixes?.length) {
          this.faceAbsentStreak = 0; // face seen again — clear any building miss-streak immediately
          const m = result.facialTransformationMatrixes[0].data;
          const sy = Math.sqrt(m[0] * m[0] + m[4] * m[4]);
          if (sy > 1e-6) {
            const yaw = Math.atan2(-m[8], sy) * (180 / Math.PI);
            if (Math.abs(yaw) > YAW_THRESHOLD_DEG) {
              this._flag('proctor_head_pose', `Head turned — yaw ${yaw.toFixed(1)}°`);
            }
          }
        } else {
          // Debounced: a single missed frame (autofocus hunt, brief head tilt,
          // one dropped frame) no longer fires immediately. Only flag once
          // FACE_ABSENT_STREAK_REQ consecutive frames come back empty.
          this.faceAbsentStreak++;
          if (this.faceAbsentStreak >= FACE_ABSENT_STREAK_REQ) {
            this._flag('face_absent', 'Face not detected — absent or covered');
          }
        }
      } catch (err) {
        // AUD-052: do not silently absorb this. A single bad frame is normal
        // (compressed frame mid-decode, transient WASM hiccup) — only escalate
        // once it's a real streak, so we don't fire on a one-off glitch.
        this.faceFailStreak++;
        if (this.faceFailStreak >= FACE_FAIL_STREAK_THRESHOLD) {
          this.faceInferenceOk = false; // health no longer reflects reality unless we flip this off
          if (!this.faceDegraded) {
            this.faceDegraded = true;
            console.warn('[proctoring] face pipeline degraded, attempting self-heal', err);
            this._healFacePipeline();
          }
          // Fail CLOSED, not open: if we can no longer verify the student is
          // present, that is treated the same as them being absent — never
          // disappear into a no-op.
          this._flag('face_absent', 'Face detection pipeline degraded — unable to verify presence');
        }
      }
    }

    if (this.cocoModel && Date.now() - this.lastObjectScan > OBJECT_SCAN_MS) {
      this.lastObjectScan = Date.now();
      this.cocoModel.detect(this.video).then((predictions) => {
        this.cocoFailStreak = 0;
        this.cocoDegraded = false;
        let personCount = 0;
        let flagged = [];
        for (const p of predictions) {
          if (p.class === 'person') personCount++;
          if (['cell phone', 'laptop', 'book', 'remote'].includes(p.class)) flagged.push(p.class);
        }
        if (personCount > 1) this._flag('multi_person', `Multiple persons detected (${personCount})`);
        if (flagged.length) this._flag('object_detected', `Prohibited objects: ${[...new Set(flagged)].join(', ')}`);
      }).catch((err) => {
        // AUD-052: same fail-closed treatment as face detection — a permanently
        // broken object-detection pipeline must surface, not vanish.
        this.cocoFailStreak++;
        if (this.cocoFailStreak >= COCO_FAIL_STREAK_THRESHOLD && !this.cocoDegraded) {
          this.cocoDegraded = true;
          console.warn('[proctoring] object-detection pipeline degraded', err);
          this._flag('proctor_engine_degraded', 'Object detection pipeline failed repeatedly — monitoring degraded');
        }
      });
    }

    this.rafId = requestAnimationFrame((t) => this._loop(t));
  }

  // AUD-052 self-heal: a degraded face pipeline is most likely a lost GPU/WebGL
  // context (common on modest exam-hall hardware under sustained load), not a
  // dead camera. Re-creating just the FaceLandmarker — never touching the
  // camera stream or RAF loop — is the targeted, minimal recovery. Falls back
  // to the CPU delegate, which is slower but far more resilient, so a machine
  // that already lost its GPU context once doesn't keep re-losing it.
  async _healFacePipeline() {
    try {
      const visionMod = await import(/* @vite-ignore */ VISION_URL);
      const { FilesetResolver, FaceLandmarker } = visionMod;
      const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE);
      const next = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU', // downgrade from GPU — see comment above
        },
        outputFacialTransformationMatrixes: true,
        numFaces: 1,
        runningMode: 'VIDEO',
      });
      const old = this.faceLandmarker;
      this.faceLandmarker = next;
      this.faceFailStreak = 0;
      old?.close?.();
      console.warn('[proctoring] face pipeline self-healed on CPU delegate');
    } catch (err) {
      // Self-heal failed — stay degraded. proctor_engine_degraded / face_absent
      // flags already cover this; do not retry in a tight loop.
      console.warn('[proctoring] face pipeline self-heal failed', err);
    }
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
    this.faceInferenceOk = false;
    this.faceFailStreak = 0;
    this.faceAbsentStreak = 0;
    this.cocoFailStreak = 0;
    this.faceDegraded = false;
    this.cocoDegraded = false;
    this.lastTickAt = 0;
  }
}

// Singleton — one engine per browser tab, mirrors LIAS's "one socket per client" pattern.
const proctoringEngine = new ProctoringEngine();
export default proctoringEngine;