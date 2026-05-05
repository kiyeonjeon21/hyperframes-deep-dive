# 04-engine-capture

> One-line summary: `@hyperframes/engine` is **not** a single render function but a **bundle of granular services** (`index.ts` 226 lines, almost all re-exports). It depends on one page contract — `window.__hf` — auto-selects BeginFrame (Linux) vs screenshot (everywhere), and uses `FrameReorderBuffer` to reorder out-of-order parallel-worker frames onto sequential FFmpeg stdin.

---

## 1. Package shape — `index.ts:1-226`

Service catalog. Eleven sections:

| Section | Lines | Key exports |
|---|---|---|
| Protocol types | 33-43 | `HfProtocol`, `HfMediaElement`, `HfTransitionMeta`, `CaptureOptions`, `CaptureResult`, `CapturePerfSummary` |
| Configuration | 46 | `resolveConfig`, `DEFAULT_CONFIG`, `EngineConfig` |
| Browser management | 48-58 | `acquireBrowser`, `releaseBrowser`, `resolveHeadlessShellPath`, `buildChromeArgs`, `CaptureMode` |
| Frame capture pipeline | 60-72 | `createCaptureSession`, `initializeSession`, `closeCaptureSession`, `captureFrame`, `captureFrameToBuffer`, `getCompositionDuration` |
| Screenshot (BeginFrame) | 74-88 | `beginFrameCapture`, `pageScreenshotCapture`, `getCdpSession`, `injectVideoFramesBatch`, `initTransparentBackground`, `captureAlphaPng` |
| Encoding | 90-110 | `encodeFramesFromDir`, `muxVideoWithAudio`, `applyFaststart`, `detectGpuEncoder`, `spawnStreamingEncoder`, `createFrameReorderBuffer` |
| Media processing | 112-132 | `extractVideoFramesRange`, `parseAudioElements`, `processCompositionAudio`, `FrameLookupTable`, `createVideoFrameInjector` |
| Parallel rendering | 134-144 | `calculateOptimalWorkers`, `distributeFrames`, `executeParallelCapture`, `mergeWorkerFrames` |
| File server | 146-151 | `createFileServer` (VIRTUAL_TIME_SHIM injection — note 05) |
| Utilities | 153-167 | `quantizeTimeToFrame` (re-exported from core), `extractMediaMetadata`, `runFfmpeg`, `analyzeKeyframeIntervals` |
| HDR/transitions/alpha blit | 169-225 | `decodePng`, `blitRgba8OverRgb48le`, `TRANSITIONS`, `crossfade`, `initHdrReadback`, `analyzeCompositionHdr` |

### 1.1 Four error conventions (`index.ts:8-31` comments)

```
1. Orchestration services THROW.
   browserManager, frameCapture, sessionInit, screenshotService → caller try/catch
2. FFmpeg wrappers RESOLVE { success, error? }.
   chunkEncoder, audioMixer, streamingEncoder → always resolve, never reject
3. Cleanup NEVER throws.
   releaseBrowser, closeCaptureSession, FrameLookupTable.cleanup → .catch(() => {})
4. Optional lookups RETURN T | undefined | null.
   resolveHeadlessShellPath, getFrameAtTime, detectGpuEncoder → may return null
```

Internalize these and note 05’s producer call flow reads naturally.

---

## 2. `HfProtocol` — one contract

`packages/engine/src/types.ts:68-77`:

```ts
interface HfProtocol {
  duration: number;
  seek(time: number): void;       // deterministic visual output
  media?: HfMediaElement[];
  transitions?: HfTransitionMeta[];
}

declare global { interface Window { __hf?: HfProtocol; } }
```

**The whole page must implement four fields**: `duration` is metadata, `seek` is core, `media`/`transitions` optional.

### 2.1 `HfMediaElement` (line 17-32)

```ts
interface HfMediaElement {
  elementId: string;       // DOM id of <video>/<audio>
  src: string;
  startTime: number;
  endTime: number;
  mediaOffset?: number;    // start offset inside source file
  volume?: number;
  hasAudio?: boolean;
}
```

**Why needed?** Headless Chrome in BeginFrame mode cannot play `<video>` with audio output. If the page reports “this clip is src=X visible from startTime–endTime”, the engine spawns ffmpeg *out-of-band* to extract frames and mix audio.

### 2.2 `HfTransitionMeta` (line 42-55)

```ts
interface HfTransitionMeta {
  time: number; duration: number;
  shader: string;             // "fade", "wipe", domain-warp, etc.
  ease: string;               // GSAP easing
  fromScene: string; toScene: string;
}
```

`@hyperframes/shader-transitions` pushes one entry at a time onto `__hf.transitions`. Producer/engine perform *deterministic compositing* from this metadata (no WebGL in-engine — note 08).

### 2.3 Determinism contract (lines 60-66 comment)

> "The engine does NOT care what animation framework drives the page. GSAP, Framer Motion, CSS animations, Three.js — anything works as long as `seek()` produces deterministic visual output for a given time."

That sentence is the design intent for hyperframes. **Framework-agnostic.**

---

## 3. Browser lifecycle — `browserManager.ts` (358 lines)

### 3.1 Resolving the Chrome binary (`resolveHeadlessShellPath`, 43-71)

```ts
1. If config.chromePath is set → use it
2. Else PRODUCER_HEADLESS_SHELL_PATH env → use it
3. Else ~/.cache/puppeteer/chrome-headless-shell/<version>/<platform-folder>/chrome-headless-shell
   - Scan version dirs with sort().reverse() (newest first)
   - Try linux64 → mac-arm64 → mac-x64 → win64
4. If not found → undefined → fall back to Puppeteer’s own cache
```

**Why prefer `chrome-headless-shell`?** BeginFrame is more stable there. Standard Chrome may not honor `--enable-begin-frame-control`.

### 3.2 Choosing capture mode (`acquireBrowser`, 139-215)

```ts
// 159-171
const isLinux = process.platform === "linux";
let captureMode: CaptureMode;

if (headlessShell && isLinux && !forceScreenshot) {
  captureMode = "beginframe";          // chrome-headless-shell + Linux only
  executablePath = headlessShell;
} else {
  captureMode = "screenshot";          // all-platform fallback
  executablePath = headlessShell ?? undefined;
}
```

**BeginFrame is Linux-only**: on macOS/Windows, `HeadlessExperimental.beginFrame` may crash or hang. Production render should run in Linux Docker.

**Addendum (verified in note 05, 2026-05-05)**: `captureMode` is really a **triple** gate:

1. **Here (engine `browserManager`)**: runtime — `headlessShell && isLinux && !forceScreenshot`
2. **Producer `cfg.forceScreenshot`**: user/CLI — alpha outputs (webm/mov/png-sequence) force true (`renderOrchestrator.ts:1918-1922`)
3. **Composition itself** (`htmlCompiler.ts:96-127` `detectRenderModeHints`): `<iframe>` or raw `requestAnimationFrame()` ⇒ `recommendScreenshot: true`; orchestrator ORs that into `cfg.forceScreenshot`.

So entering BeginFrame needs Linux + chrome-headless-shell + no forced screenshot + a compatible composition pattern.

### 3.3 BeginFrame probe (line 100-137)

```ts
async function probeBeginFrameSupport(browser): Promise<boolean> {
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send("HeadlessExperimental.enable");
  const beginFrame = client.send("HeadlessExperimental.beginFrame", {
    frameTimeTicks: 0, interval: 33, noDisplayUpdates: true,
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("...")), 2000),
  );
  try {
    await Promise.race([beginFrame, timeout]);
    return true;
  } catch { return false; }
}
```

**Why probe?** chrome-headless-shell build 147: `HeadlessExperimental.enable` succeeds but `beginFrame` can be missing. First capture frame dies with `'HeadlessExperimental.beginFrame' wasn't found`. Probe detects that and falls back to screenshot.

On probe failure (190-207):
```ts
await browser.close();
captureMode = "screenshot";
browser = await ppt.launch({ args: stripBeginFrameFlags(chromeArgs), ... });
```

**Must strip flags** — leaving `--enable-begin-frame-control` on makes the compositor wait for BeginFrame that never arrives → blank frames.

### 3.4 Nine BeginFrame-only flags (lines 84-94)

```
--deterministic-mode                       Chrome deterministic mode (fixed RNG seed)
--enable-begin-frame-control               enable beginFrame CDP
--disable-new-content-rendering-timeout    disable render timeouts
--run-all-compositor-stages-before-draw    finish all compositor stages before draw
--disable-threaded-animation               animations on main thread only
--disable-threaded-scrolling               scrolling on main thread
--disable-checker-imaging                  disable partial image decode
--disable-image-animation-resync         disable GIF/APNG auto resync
--enable-surface-synchronization           force surface sync
```

Tracked in `BEGINFRAME_ONLY_FLAGS` (84-94). Strip them when falling back to screenshot.

### 3.5 Shared Chrome flags (`buildChromeArgs`, 268-337)

Used in both screenshot and beginframe modes:

```
Security: --no-sandbox, --disable-setuid-sandbox
Shared memory: --disable-dev-shm-usage          (Docker /dev/shm too small)
GPU: --enable-webgl, --ignore-gpu-blocklist + per-platform GPU args
Fonts: --font-render-hinting=none              (determinism — hinting varies by OS)
Color: --force-color-profile=srgb              (determinism — neutralize display profile)
Throttling: --disable-background-timer-throttling, --disable-backgrounding-occluded-windows,
        --disable-renderer-backgrounding, --disable-background-media-suspend
        (offscreen headless: throttled timers stop time)
Noise: --disable-extensions, --disable-default-apps, --disable-print-preview,
          --no-pings, --no-zygote, 10+ more
Memory: --force-gpu-mem-available-mb=4096, --disk-cache-size=268435456 (256MB)
Features: --disable-features=AudioServiceOutOfProcess,IsolateOrigins,
          site-per-process,Translate,BackForwardCache,IntensiveWakeUpThrottling
```

### 3.6 Per-platform GPU args (`getBrowserGpuArgs`, 339-357)

```
software:  --use-gl=angle --use-angle=swiftshader  (Docker; best reproducibility)
darwin:    --use-gl=angle --use-angle=metal --enable-gpu-rasterization
win32:     --use-gl=angle --use-angle=d3d11 --enable-gpu-rasterization
linux:     --use-gl=egl --enable-gpu-rasterization
```

**Software mode** maximizes determinism (CPU render, no GPU driver variance). SwiftShader is recommended in production CI.

### 3.7 Browser pool (lines 73-78, 209-235)

```ts
let pooledBrowser: Browser | null = null;
let pooledBrowserRefCount = 0;
```

With `enableBrowserPool: true`, one launched browser is reused with ref-counting — mostly useful when workers = 1; parallel workers each get their own browser.

`forceReleaseBrowser` (237-259) SIGKILLs hung browsers when normal release stalls.

---

## 4. Capture session lifecycle — `frameCapture.ts` (~750 lines)

### 4.1 Page contract check — `pollPageExpression`

`initializeSession` uses this in both modes:

```ts
const pageReady = await pollPageExpression(
  page,
  `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`,
  pageReadyTimeout,
);
if (!pageReady) {
  throw new Error("[FrameCapture] window.__hf not ready ...");
}
```

**Three checks**:
1. `window.__hf` exists
2. `seek` is a function
3. `duration > 0` (page reports its length)

The third is finicky — if duration resolves asynchronously during bootstrap, expect ~100ms polling.

### 4.2 Screenshot-mode session init (lines 356-409)

```
page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
  ↓
pollPageExpression(__hf ready) — standard polling, rAF-aware
  ↓
applyVideoMetadataHints(page, options.videoMetadataHints)
  → inject ffprobe width/height into page
    (stable layout even if Chromium cannot decode native video)
  ↓
videosReady poll: video.readyState >= 1 (HAVE_METADATA)
  → skipReadinessVideoIds excludes *out-of-band extracted* videos
  ↓
document.fonts?.ready
waitForOptionalTailwindReady (Tailwind v4 browser runtime)
  ↓
if format === "png": initTransparentBackground (data-composition-id selector + injected style)
  ↓
session.isInitialized = true
```

### 4.3 BeginFrame session init (lines 411-507) — deterministic but finicky

The **warmup loop** is key. In BeginFrame mode the *Chrome event loop is frozen* — during load, rAF/setTimeout only fire if someone sends `beginFrame`. Hence:

```ts
let warmupRunning = true;
const warmupLoop = async () => {
  warmupClient = await getCdpSession(page);
  await warmupClient.send("HeadlessExperimental.enable");
  while (warmupRunning) {
    await warmupClient.send("HeadlessExperimental.beginFrame", {
      frameTimeTicks: warmupFrameTime, interval: 33, noDisplayUpdates: true,
    });
    warmupFrameTime += 33; warmupTicks++;
    await new Promise((r) => setTimeout(r, 33));
  }
};
warmupLoop().catch(() => {});

await page.goto(url, ...);

// waitForFunction that depends on rAF does not work — manual evaluate loop
while (Date.now() < pollDeadline) {
  const ready = await page.evaluate(`!!(window.__hf && ... duration > 0)`);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}

// videos readyState: manual poll too
// fonts.ready
// tailwind ready

warmupRunning = false;

// Capture start ticks: comfortably past warmup end
session.beginFrameTimeTicks = (warmupTicks + 10) * 33;
```

**Key insight**: warmup `beginFrame` with `noDisplayUpdates: true` **does not produce frames** — it only advances rAF/timer. Capture `beginFrame` includes `screenshot:{...}` so the compositor runs layout-paint-composite-screenshot atomically. The two cannot share one loop → warmup stops, then the capture loop starts.

### 4.4 Per-frame flow — `prepareFrameForCapture` + `captureFrameCore`

`prepareFrameForCapture` (548-583):

```ts
const quantizedTime = quantizeTimeToFrame(time, options.fps);

const seekStart = Date.now();
await page.evaluate((t) => {
  if (window.__hf && typeof window.__hf.seek === "function") {
    window.__hf.seek(t);
  }
}, quantizedTime);
const seekMs = Date.now() - seekStart;

if (session.onBeforeCapture) {
  await session.onBeforeCapture(page, quantizedTime);    // e.g. video frame injection
}
const beforeCaptureMs = Date.now() - beforeCaptureStart;

return { quantizedTime, seekMs, beforeCaptureMs };
```

`captureFrameCore` (590-645):

```ts
if (session.captureMode === "beginframe") {
  const frameTimeTicks = session.beginFrameTimeTicks + frameIndex * session.beginFrameIntervalMs;
  const result = await beginFrameCapture(page, options, frameTimeTicks, intervalMs);
  if (result.hasDamage) session.beginFrameHasDamageCount++;
  else session.beginFrameNoDamageCount++;
  buffer = result.buffer;
} else {
  buffer = await pageScreenshotCapture(page, options);
}

// accumulate perf: frames, seekMs, beforeCaptureMs, screenshotMs, totalMs
```

**`hasDamage`**: beginFrame response includes whether the compositor actually repainted. After seek, an idle composition may report `hasDamage=false` — valid; still counted in stats.

### 4.5 quantizeTimeToFrame (re-exported from core, `inline-scripts/parityContract`)

```ts
quantizeTimeToFrame(timeSeconds: number, fps: number): number
```

Simple quantization like `Math.round(time * fps) / fps`. **Why?** Producer already passes `frameIndex / fps`, but external callers (e.g. validate seeking five times) should snap float error to the nearest frame boundary.

---

## 5. FrameReorderBuffer — parallel worker coordination

`packages/engine/src/services/streamingEncoder.ts:45-95`. ~50 lines, tight.

### 5.1 Interface

```ts
interface FrameReorderBuffer {
  waitForFrame(frame: number): Promise<void>;     // block until cursor reaches frame
  advanceTo(frame: number): void;                 // bump cursor, release waiters
  waitForAllDone(): Promise<void>;                // block until endFrame
}
```

### 5.2 Implementation — cursor + Map<frame, resolvers[]>

```ts
let cursor = startFrame;
const pending = new Map<number, Array<() => void>>();

const waitForFrame = (frame) => new Promise<void>((resolve) => {
  if (frame === cursor) {
    resolve();          // already at cursor
    return;
  }
  enqueueAt(frame, resolve);   // enqueue
});

const advanceTo = (frame) => {
  cursor = frame;
  flushAt(frame);       // resolve every waiter for this frame
};
```

**Multiple resolvers on one frame?** `waitForFrame(N)` and `waitForAllDone()` (waiting on endFrame) may both register on the same N. Map values are arrays so both resolve cleanly.

### 5.3 Usage pattern (callers wire this up)

```ts
// Worker N captures its frames:
for (let f = task.startFrame; f < task.endFrame; f++) {
  const buffer = await captureFrameToBuffer(session, f, f / fps);
  await reorderBuffer.waitForFrame(f);    // wait for turn
  encoder.writeFrame(buffer);              // ordered ffmpeg stdin
  reorderBuffer.advanceTo(f + 1);          // release next frame
}
```

Even if three workers capture frames [0,5,10] concurrently, `encoder.writeFrame` runs 0→1→2→…→14 in order.

---

## 6. Streaming FFmpeg encoder — `streamingEncoder.ts` (323+ lines)

### 6.1 Two input modes (`buildStreamingArgs`, lines 138-188)

**rawvideo (HDR rgb48le)**:
```
-f rawvideo -pix_fmt rgb48le -s WxH -framerate FPS
[HDR] -color_primaries bt2020 -color_trc smpte2084|arib-std-b67 -colorspace bt2020nc
-i -
```

**image2pipe (SDR mjpeg/png)**:
```
-f image2pipe -vcodec mjpeg|png -framerate FPS -i -
```

`-i -` is stdin; Node streams buffers frame-by-frame via `child.stdin.write()`.

### 6.2 Codec / preset / quality (line 191-...)

GPU encoders (nvenc, videotoolbox, vaapi) remap presets via `mapPresetForGpuEncoder` — libx264 `"medium"` becomes `"p4"` on nvenc. `getGpuEncoderName(gpuEncoder, codec)` returns `h264_nvenc`, `hevc_videotoolbox`, etc.

### 6.3 Engine compositing buffer format — `TransitionFn`

`packages/engine/src/utils/shaderTransitions.ts:343-350` (verified 2026-05-05):

```ts
export type TransitionFn = (
  from: Buffer,            // ← Node.js Buffer (NOT Uint8Array)
  to: Buffer,
  output: Buffer,
  width: number,
  height: number,
  progress: number,
) => void;
```

**6 bytes per pixel — rgb48le**:
- R, G, B each 16-bit little-endian (uint16, 0..65535)
- No alpha — DOM layers use a separate alpha PNG composite
- Same layout for HDR (PQ/HLG) and SDR (HDR uses wider dynamic range)

`crossfade` reference (lines 360-374):
```ts
export const crossfade: TransitionFn = (from, to, out, w, h, p) => {
  const inv = 1 - p;
  for (let i = 0; i < w * h; i++) {
    const o = i * 6;
    out.writeUInt16LE(Math.round(from.readUInt16LE(o) * inv + to.readUInt16LE(o) * p), o);
    out.writeUInt16LE(Math.round(from.readUInt16LE(o + 2) * inv + to.readUInt16LE(o + 2) * p), o + 2);
    out.writeUInt16LE(Math.round(from.readUInt16LE(o + 4) * inv + to.readUInt16LE(o + 4) * p), o + 4);
  }
};
```

Each pixel uses 6-byte stride (`i * 6`), R=0, G=2, B=4. Matches **streaming encoder `rawvideo -pix_fmt rgb48le` input** (`streamingEncoder.ts` 154-184).

### 6.4 `StreamingEncoder` interface

```ts
interface StreamingEncoder {
  writeFrame(buffer: Buffer): boolean;        // sync (false = backpressure)
  close(): Promise<StreamingEncoderResult>;   // close stdin + wait for ffmpeg exit
  getExitStatus(): "running" | "success" | "error";
}
```

`writeFrame` returns `false` when `child.stdin.write(buf)` buffers (high water mark). Callers use that for backpressure.

---

## 7. Parallel coordinator — `parallelCoordinator.ts`

### 7.1 Worker count — `calculateOptimalWorkers` (71-130)

Constants (lines 65-69):
```ts
MEMORY_PER_WORKER_MB = 256
MIN_WORKERS = 1
ABSOLUTE_MAX_WORKERS = 10
DEFAULT_SAFE_MAX_WORKERS = 6
MIN_FRAMES_PER_WORKER = 30
```

Triple constraint:
```ts
const cpuBasedWorkers    = Math.max(1, cpus().length - 2);                // CPU - 2
const memoryBasedWorkers = Math.max(1, Math.floor((totalmem * 0.5) / 256));// 50% of RAM in 256MB chunks
const frameBasedWorkers  = Math.floor(totalFrames / MIN_FRAMES_PER_WORKER);// ≥30 frames per worker
const optimal = Math.min(cpuBasedWorkers, memoryBasedWorkers, frameBasedWorkers);
```

**Why `totalmem` not `freemem`?** Lines 99-101: macOS caches aggressively in “inactive” memory so `freemem` looks tiny; half of `totalmem` is a more realistic budget.

### 7.2 Throttle large renders (lines 116-127)

```ts
const weightedFrames = totalFrames * captureCostMultiplier;
const contentionThreshold = Math.max(minParallel, largeRenderThreshold / 3);
if (totalFrames >= largeRenderThreshold || weightedFrames >= contentionThreshold) {
  const cpuScaledMax = Math.max(1, Math.floor(cpuCount / (coresPerWorker * captureCostMultiplier)));
  if (finalWorkers > cpuScaledMax) finalWorkers = cpuScaledMax;
}
```

**Intent**: 8 cores → ~2 workers, 16 → ~5, 32 → ~10 caps CDP timeouts from SwiftShader Chrome compositor contention on heavy renders. `captureCostMultiplier` lets producer mark GSAP-heavy or Three.js compositions with values > 1.

### 7.3 Frame split — `distributeFrames` (132-154)

```ts
const framesPerWorker = Math.ceil(totalFrames / workerCount);
for (let i = 0; i < workerCount; i++) {
  tasks.push({
    workerId: i,
    startFrame: i * framesPerWorker,
    endFrame: Math.min((i + 1) * framesPerWorker, totalFrames),
    outputDir: join(workDir, `worker-${i}`),
  });
}
```

Even split. Each worker writes PNG/JPEG into its `outputDir`; `mergeWorkerFrames` collects into one sequence.

### 7.4 `executeParallelCapture` (200+ lines, not fully read here)

Per task:
1. `acquireBrowser` its own browser instance
2. `createCaptureSession` → `initializeSession`
3. for frame in [start, end): `captureFrame` or `captureFrameToBuffer + reorderBuffer`
4. `closeCaptureSession`

In streaming mode, `onFrameBuffer` funnels buffers through the reorder buffer into the encoder.

---

## 8. One-shot call trace

```
producer.executeRenderJob({ fps, quality, workers, ... })
  │
  ├── calculateOptimalWorkers(totalFrames, requested, config)
  │     min(cpu-2, totalMem*0.5/256MB, totalFrames/30) → workerCount
  │
  ├── distributeFrames(totalFrames, workerCount, workDir)
  │     [{workerId, startFrame, endFrame, outputDir}, ...]
  │
  ├── createFrameReorderBuffer(0, totalFrames)         (streaming only)
  │
  ├── spawnStreamingEncoder({ fps, w, h, codec, ... }) (streaming only)
  │     ffmpeg -f image2pipe -i - -c:v h264 -crf 18 out.mp4
  │
  ├── executeParallelCapture(tasks, ...) — per-task worker:
  │     │
  │     ├── acquireBrowser(buildChromeArgs({ w, h, captureMode }))
  │     │     ├── resolveHeadlessShellPath() (config/env/cache order)
  │     │     ├── puppeteer.launch({ executablePath, args })
  │     │     ├── probeBeginFrameSupport(browser)  ── on failure strip + relaunch
  │     │     └── return { browser, captureMode }
  │     │
  │     ├── createCaptureSession(browser, serverUrl, outputDir, options, ...)
  │     │
  │     ├── initializeSession(session)
  │     │     ├── page.on(console/pageerror) buffering
  │     │     ├── (BeginFrame) start warmupLoop
  │     │     ├── page.goto(serverUrl + "/index.html")
  │     │     ├── pollPageExpression("__hf && seek && duration > 0")
  │     │     ├── applyVideoMetadataHints
  │     │     ├── videos.every(v => v.readyState >= 1)
  │     │     ├── document.fonts.ready
  │     │     ├── waitForOptionalTailwindReady
  │     │     ├── (BeginFrame) warmupRunning = false
  │     │     └── (PNG) initTransparentBackground
  │     │
  │     ├── for frame in [startFrame, endFrame):
  │     │     ├── { quantizedTime, seekMs, beforeCaptureMs } = prepareFrameForCapture(session, f, t)
  │     │     │     ├── page.evaluate(__hf.seek(quantizedTime))
  │     │     │     └── onBeforeCapture(page, quantizedTime)  — video frame injection
  │     │     ├── (BeginFrame) buffer = beginFrameCapture(page, options, frameTimeTicks, intervalMs)
  │     │     │     └─ HeadlessExperimental.beginFrame { frameTimeTicks, interval, screenshot:{...} }
  │     │     │        one atomic layout-paint-composite + screenshot call
  │     │     ├── (screenshot) buffer = pageScreenshotCapture(page, options)
  │     │     │     └─ Page.captureScreenshot CDP
  │     │     ├── (streaming) await reorderBuffer.waitForFrame(f)
  │     │     ├── (streaming) encoder.writeFrame(buffer)
  │     │     ├── (streaming) reorderBuffer.advanceTo(f + 1)
  │     │     └── (file) writeFileSync(framePath, buffer)
  │     │
  │     └── closeCaptureSession(session)
  │           releaseBrowser(browser) — decrement pool refcount or close
  │
  ├── (file) mergeWorkerFrames(...)   — worker-N/ → single sequence dir
  ├── (streaming) encoder.close() → result { success, fileSize, durationMs }
  └── return CapturePerfSummary { frames, avgSeekMs, avgScreenshotMs, ... }
```

---

## 9. Tricky areas / verify

1. **Probe false but `enable` succeeded on chrome-headless-shell 147** — called out in code comments (105-110). Track which build ID restored full support.
2. **Warmup `noDisplayUpdates: true`** — compositor produces no pixels; capture uses normal beginFrame with `screenshot:{...}`. Do not merge both into one loop.
3. ~~**Absolute `frameTimeTicks`**~~ — verified (2026-05-05): `frameCapture.ts:609-610` uses `session.beginFrameTimeTicks + frameIndex * session.beginFrameIntervalMs`. JS doubles are safe integers to ~2^53 ≈ 9e15. 8h @ 30fps = 864,000 frames × 33ms ticks ≈ 28.5M — ~1/3e8 of headroom. CDP takes int64 ticks; practical workloads do not wrap.
4. **Who sets `captureCostMultiplier`** — how producer infers from composition meta (note 05): Three.js? heavy GSAP? video injection count?
5. **Exact `quantizeTimeToFrame` definition** — re-exported from core at `index.ts:154`; lives in `inline-scripts/parityContract`. Confirm `Math.round(t * fps) / fps`.
6. ~~**`onBeforeCapture` hook**~~ — partially verified (2026-05-05): signature — `frameCapture.ts:42`:
   ```ts
   export type BeforeCaptureHook = (page: Page, time: number) => Promise<void>;
   ```
   Invoked inside `prepareFrameForCapture` at lines 577-578 (every frame, right after seek). Nullable. `prepareCaptureSessionForReuse(session, onBeforeCapture)` (722-728) can attach a different hook per chunk on the same session.
   **How `createVideoFrameInjector` uses the hook** needs a separate read; `avgBeforeCaptureMs` in perf summary measures it.
7. **Screenshot-mode determinism** — is `Page.captureScreenshot` deterministic enough without BeginFrame? rAF timing may jitter slightly; macOS preview baselines may diverge from Docker CI (cheatsheet/04).

---

## 10. Compared to Remotion

| Aspect | Remotion | Hyperframes engine |
|---|---|---|
| Capture primitive | direct `puppeteer.screenshot` + streaming | two modes (BeginFrame + screenshot) via probe |
| Determinism | screenshot + `delayRender` React pattern | `__hf.seek` + atomic BeginFrame |
| Parallelism | Lambda fan-out | local workers + FrameReorderBuffer |
| Streaming | image2pipe | image2pipe + rawvideo HDR branch |
| Inspiration credit | (internal design) | noted in `streamingEncoder.ts:3-6` |

Remotion waits on async assets via `delayRender()/continueRender()` inside the React tree. Hyperframes polls until the page raises `__hf.duration > 0`.

---

## 11. Related notes

- ← [03 runtime + adapters](03-core-runtime-adapters.md) — how `__hf.seek(t)` fans out to six adapters inside the page (contract beneath this `page.evaluate` layer)
- → [05 producer](05-producer-pipeline.md) — five-stage pipeline *composing* engine services
- ↗ [05 producer](05-producer-pipeline.md) §4.2 — `detectRenderModeHints` participates in captureMode (triple condition)
- ↗ [05 producer](05-producer-pipeline.md) §8 open item 4 — HDR readback memory pattern (HLG pass-through bypasses WebGPU)
- ↗ [08 shader-transitions](08-shader-transitions.md) §7.3 — engine `TRANSITIONS` record (15 entries, rgb48le composite)
- ⊥ [cheatsheet 03](cheatsheets/03-render-flags.md) — nine Chrome flags + GPU encoder autodetect
- ⊥ [cheatsheet 04](cheatsheets/04-regression-testing.md) — why Docker baselines differ from host (ties to BeginFrame probe)

## 12. Next → 05

The engine is a toolkit. Note 05 shows how producer stitches five stages, HDR multi-pass, and regression harnesses — especially:
- When VIRTUAL_TIME_SHIM injects (`fileServer` provides the hook; producer chooses contents)
- HDR pass 1 (DOM SDR) + pass 2 (WebGPU HDR readback) compositing
- Exact audio-mix filter graph shape

Checklist for this note:
- [ ] `bun run --cwd packages/engine test` — see which fixtures run
- [ ] `HYPERFRAMES_FORCE_SCREENSHOT=1 hyperframes render` — compare screenshot-mode output
- [ ] `console.log` timeline of `frameTimeTicks`
- [ ] Toy test `FrameReorderBuffer` with three simulated workers
