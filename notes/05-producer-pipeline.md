# 05-producer-pipeline

> One-line summary: `@hyperframes/producer` drives a five-stage pipeline from one **4045-line** `renderOrchestrator.ts` function. It *composes* engine services, injects **VIRTUAL_TIME_SHIM** (95-line IIFE) to fake a timeline, and handles production details: HDR multi-pass, capture calibration, retry batches, chunked encoding.

---

## 1. Package shape — `index.ts` 78 lines, seven domains

```
Main rendering pipeline:    createRenderJob, executeRenderJob, RenderConfig, RenderJob, RenderPerfSummary
Frame capture (lower):      re-export engine services (createCaptureSession, captureFrame, ...)
File server:                createFileServer (VIRTUAL_TIME_SHIM injection hook)
Video frame injection:      createVideoFrameInjector (engine re-export)
Configuration:              resolveConfig, ProducerConfig
Logger:                     createConsoleLogger, defaultLogger
Server:                     createRenderHandlers, createProducerApp, startServer (HTTP API wrapper)
Utilities:                  quantizeTimeToFrame (parityContract), resolveRenderPaths, hyperframeLint
```

**Observation**: `services/frameCapture.ts` in producer is a thin re-export of `services/frameCapture.js` from engine. Producer *depends deeply* on engine but barely wraps it — it adds orchestration.

---

## 2. RenderConfig — option catalog

`renderOrchestrator.ts:214-271`

```ts
interface RenderConfig {
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  format?: "mp4" | "webm" | "mov" | "png-sequence";
  workers?: number;
  useGpu?: boolean;
  debug?: boolean;
  entryFile?: string;            // default "index.html"
  producerConfig?: EngineConfig; // bypass env, inject config directly
  logger?: ProducerLogger;
  crf?: number;                  // encoder quality factor
  videoBitrate?: string;         // mutually exclusive with crf
  hdrMode?: "auto" | "force-hdr" | "force-sdr";
}
```

### 2.1 Four output formats

See `renderOrchestrator.ts:217-249` for detailed comments.

| format | codec | pixel format | alpha | typical use |
|---|---|---|---|---|
| `mp4` (default) | H.264 (H.265 when HDR) | yuv420p | no | streaming / social (faststart) |
| `webm` | VP9 | yuva420p | yes | Chrome/Edge/Firefox `<video>` over background |
| `mov` | ProRes 4444 | yuva444p10le | yes + 10-bit | NLE ingest (Premiere/FCP/Resolve) |
| `png-sequence` | PNG sequence | RGBA | yes, lossless | After Effects/Nuke/Fusion + audio.aac sidecar |

**Alpha forces screenshot mode** (lines 1918-1922):
```ts
const needsAlpha = isWebm || isMov || isPngSequence;
if (needsAlpha) {
  cfg.forceScreenshot = true;   // BeginFrame has no alpha path
}
```
HDR + alpha is unsupported → HDR auto-disables with a warning.

### 2.2 RenderStatus lifecycle (lines 204-212)

```
queued → preprocessing → rendering → encoding → assembling → complete
                                                          ↘ failed
                                                          ↘ cancelled
```

Five in-progress stages plus three terminal states. `updateJobStatus(job, status, message, progress, onProgress)` fires as each stage starts.

### 2.3 RenderPerfSummary — observability fields (273-319)

Producer tracks a rich perf summary for production:

```ts
interface RenderPerfSummary {
  renderId, totalElapsedMs, fps, quality, workers,
  chunkedEncode, chunkSizeFrames,
  compositionDurationSeconds, totalFrames, resolution, videoCount, audioCount,
  stages: Record<string, number>,                // ms per stage
  videoExtractBreakdown?: ExtractionPhaseBreakdown, // Stage 2 detail
  tmpPeakBytes?,                                 // workDir disk high water
  captureAvgMs?, capturePeakMs?,
  captureCalibration?: { sampledFrames, p95Ms, multiplier, reasons },
  captureAttempts?: CaptureAttemptSummary[],     // retry history
  peakRssMb?, peakHeapUsedMb?,                   // sampled every 250ms
  hdrDiagnostics?, hdrPerf?,
}
```

`peakRssMb` / `peakHeapUsedMb` come from `setInterval(sampleMemory, 250)` (lines 1942-1944), with `unref()` so sampling doesn’t keep the event loop alive.

---

## 3. VIRTUAL_TIME_SHIM — `fileServer.ts:95-190`

**95-line IIFE** injected into the page `<head>`. Polyfills a virtual timeline.

### 3.1 Six mocked surfaces

```ts
1. Date         → VirtualDate (Date.now() = virtualNowMs, new Date() = new OriginalDate(virtualNowMs))
2. performance.now() → return virtualNowMs
3. requestAnimationFrame  → enqueue only; no automatic fire
4. cancelAnimationFrame   → mark queue entry cancelled=true
5. setTimeout / clearTimeout / setInterval / clearInterval — originals preserved and exposed
```

`originalSetTimeout` / etc. live on `__HF_VIRTUAL_TIME__` for runtime code that must bypass the shim (e.g. real `setTimeout` polling during warmup).

### 3.2 VirtualDate implementation (lines 126-148)

```ts
function VirtualDate() {
  var args = Array.prototype.slice.call(arguments);
  if (!(this instanceof VirtualDate)) {
    return OriginalDate.apply(null, args.length ? args : [virtualNowMs]);
  }
  var instance = args.length
    ? new (Function.prototype.bind.apply(OriginalDate, [null].concat(args)))()
    : new OriginalDate(virtualNowMs);
  Object.setPrototypeOf(instance, VirtualDate.prototype);
  return instance;
}
VirtualDate.prototype = OriginalDate.prototype;
Object.setPrototypeOf(VirtualDate, OriginalDate);
VirtualDate.now = function() { return virtualNowMs; };
```

**Tricky bits**:
- Handles both `Date()` calls and `new Date()` (`this instanceof`)
- Forwards `new Date(year, month, …)` like the native — variadic args via `Function.prototype.bind.apply`
- Keeps the prototype chain so `instanceof Date` still works
- Uses `Object.defineProperty(window, "Date", { configurable, writable, value })` where direct assignment fails (strict mode / some sandboxes)

### 3.3 `flushAnimationFrame()` (113-124)

```ts
function flushAnimationFrame() {
  if (!rafQueue.length) return;
  var current = rafQueue.slice();   // ← snapshot
  rafQueue.length = 0;
  for (var i = 0; i < current.length; i++) {
    var entry = current[i];
    if (entry.cancelled) continue;
    try { entry.callback(virtualNowMs); } catch {}
  }
}
```

**Snapshot then drain**: if a callback re-enters `requestAnimationFrame`, it lands in the *next* flush (prevents infinite recursion this tick).

### 3.4 `seekToTime(nextTimeMs)` (180-185)

```ts
seekToTime: function(nextTimeMs) {
  var safeTimeMs = Math.max(0, Number(nextTimeMs) || 0);
  virtualNowMs = safeTimeMs;
  flushAnimationFrame();          // flush pending rAF now
  return virtualNowMs;
}
```

**Key idea**: bump virtual time → synchronously flush pending rAF. After `seek`, every rAF callback has run once at the new clock.

### 3.5 RENDER_MODE_SCRIPT — pages without a composition (line 210-...)

**Fallback player** for pages that only have `<video>` / `<audio>` and no composition wrapper. Fills `__player` with an object that syncs directly to media elements. Used in preview flows.

```ts
window.__player = {
  ...basePlayer,
  seek: function(time) {
    syncFallbackMedia(safeTime, false);  // media.currentTime = safeTime
  },
  renderSeek: ..., play: ..., pause: ..., getTime: ...
};
```

Tune with env vars:
- `PRODUCER_RUNTIME_RENDER_SEEK_MODE` = `"strict-boundary"` | `"preview-phase"` (default)
- `PRODUCER_DEBUG_SEEK_DIAGNOSTICS` = `"true"` for verbose seek logs
- `PRODUCER_RENDER_SEEK_STEP` = seek step (default 1/120 sec)
- `PRODUCER_RUNTIME_RENDER_SEEK_OFFSET_FRACTION` = 0.5 (in-frame sample position)

---

## 4. Five-stage pipeline — `executeRenderJob` (~4045-line function)

`renderOrchestrator.ts:1885-` owns the whole flow. Stage markers like `// ── Stage 1: Compile ──` (~line 1997) make it grep-friendly.

### 4.1 Entry and setup (1885-1995)

```ts
1. workDir = job.config.debug ? .debug/<jobId> : <outputDir>/work-<jobId>
2. cfg = resolveConfig() or injected producerConfig
3. Inspect format → if needsAlpha then forceScreenshot = true
4. memSamplerInterval = setInterval(sampleMemory, 250).unref()  ← peak RSS/heap
5. abort-signal guard helpers
6. Validate entry file — if entryFile !== "index.html" and uses a `<template>` wrapper,
   extractStandaloneEntryFromIndex pulls the real host element and builds standalone HTML
```

**Sub-composition standalone render** (lines 1973-1995): find the host element that mounts the composition inside `<template>` via `data-composition-src` and build wrapper HTML that renders only that host — useful to *isolate* one composition (e.g. preview a single scene).

### 4.2 Stage 1 — Compile (line 1997-)

```ts
updateJobStatus(job, "preprocessing", "Compiling composition", 5, onProgress);

const compiled = compileForRender(projectDir, htmlPath, downloadDir);  // htmlCompiler.ts:922
// → CompiledComposition { html, subCompositions, videos, audios, images, unresolvedCompositions,
//                         externalAssets, width, height, staticDuration, renderModeHints, hasShaderTransitions }
```

#### `compileForRender(projectDir, htmlPath, downloadDir)` — 14 steps (verified 2026-05-05)

`packages/producer/src/services/htmlCompiler.ts:922-1047`

```
 1. readFileSync(htmlPath)
 2. compileHtmlFile(rawHtml, projectDir, downloadDir)
       → first pass compile (resolve data-composition-src, etc.)
       → { html, unresolvedCompositions }
 3. parseSubCompositions(compiledHtml, projectDir, downloadDir)
       → sub-comp media + compiled HTML extract
       → { videos, audios, images, subCompositions }
 4. ensureFullDocument(compiledHtml)
       → wrap fragment HTML in <html>/<head>/<body> (work around linkedom returning null head/body on fragments)
 5. inlineSubCompositions(fullHtml, subCompositions, projectDir)
       → inline sub-comp HTML into main (same synchronous path as preview — no async fetch)
 6. preload="none" strip
       → headless render needs eager media load (else 45s timeout)
 7. detectRenderModeHints(sanitizedHtml)
       → detect <iframe> or raw requestAnimationFrame → { recommendScreenshot, reasons[] }
       → auto-detect pages that cannot use BeginFrame
 8. detectShaderTransitionUsage(sanitizedHtml)
       → detect HyperShader.init() or __hf.transitions = … → boolean
       → enables multi-pass compositing
 9. promoteCssImportsToLinkTags
       → @import url() → <link rel="stylesheet"> (predictable network fetch order)
10. coalesceHeadStylesAndBodyScripts
       → normalize head styles + body scripts after sub-comp inline
11. injectDeterministicFontFaces
       → deterministic font selection (family match, forced weight)
12. inlineExternalScripts(coalescedHtml)
       → download + inline CDN scripts (after CSS — preserve inline order)
13. collectExternalAssets(assembledHtml, projectDir)
       → gather assets outside projectDir (e.g. ../shared-assets/hero.png)
       → copy into compile dir because file server cannot serve parent paths ad hoc
14. parseVideoElements/parseAudioElements/parseImageElements + dedupeElementsById
       → merge main + sub media (on id clash, prefer inlined sub)
       → advisory ffprobe (sparse keyframes / VFR) — fire-and-forget warning
       → dimensions(data-width/height) + staticDuration
```

#### Note: `RenderModeHints` auto-fallback (lines 96-127)

```ts
function detectRenderModeHints(html: string): RenderModeHints {
  const reasons: RenderModeHint[] = [];
  if (document.querySelector("iframe")) reasons.push({ code: "iframe", ... });
  if (/requestAnimationFrame\s*\(/.test(inlineScriptContent)) reasons.push({ code: "requestAnimationFrame", ... });
  return { recommendScreenshot: reasons.length > 0, reasons };
}
```

**Implication**: note 04 says BeginFrame only when “Linux + chrome-headless-shell + !`forceScreenshot`”, but **if the composition uses BeginFrame-hostile patterns (nested iframe, raw rAF), producer also flips to screenshot**. Capture mode is a *triple* gate (browser capability + user flags + composition pattern).

#### Other exports (922-1180)

- `compileForRender(projectDir, htmlPath, downloadDir)` — main 14-step compile
- `discoverMediaFromBrowser(page)` (1068-) — after opening the page, discover *dynamically loaded* media (`document.querySelectorAll("video,audio")` plus user-added nodes). Fills gaps static parsing misses. Orchestrator calls this.
- `resolveCompositionDurations(...)` (1122-) — pick duration from metadata (if no `data-duration`, infer from GSAP timeline length)
- `recompileWithResolutions(...)` (1180-) — partial recompile after duration/variables resolve (not full rebuild)

### 4.3 Stage 2 — Video frame extraction & Audio prep

```ts
updateJobStatus(job, "preprocessing", "Extracting video frames", 15, onProgress);

const { extractedFrames, breakdown } = await extractAllVideoFrames(videos, ...);
// calls engine extractAllVideoFrames:
//   - HDR preflight (PQ/HLG detect)
//   - VFR preflight (variable framerate keyframe analysis)
//   - parallel ffmpeg workers extract frames
//   - build frameLookupTable (frame index → file path)

await processCompositionAudio(audioElements, ...)
// engine audioMixer:
//   - ffmpeg-extract each audio source to PCM 48kHz stereo
//   - atrim → adelay → apad → amix → master-gain filter graph
//   - AAC 192k output
```

`videoExtractBreakdown` shows up in perf because this stage can dominate (long footage + many `<video>` tags).

### 4.4 Stage 3 — Capture calibration (optional)

Calibration helpers cluster around lines 901-1000:
- `selectCaptureCalibrationFrames(totalFrames)`: pick sample frames across the timeline
- `createCaptureCalibrationConfig(cfg)`: temporary config for calibration runs
- `estimateMeasuredCaptureCostMultiplier`: derive multiplier from measured frame time
- `combineCaptureCostEstimates`: blend static heuristics + measurements

```ts
// on large renders, capture sample frames first to measure cost
const sampleFrames = selectCaptureCalibrationFrames(totalFrames);
const measuredMultiplier = await estimateMeasuredCaptureCostMultiplier(...);
const finalMultiplier = combineCaptureCostEstimates(staticEstimate, measuredMultiplier);
const workerCount = calculateOptimalWorkers(totalFrames, requested, {
  ...cfg,
  captureCostMultiplier: finalMultiplier,
});
```

**Why**: heavy Three.js or chunky Lottie SVG can be ~5× slower than plain DOM capture — impossible to know statically. Sampling adjusts worker counts.

### 4.5 Stage 4 — Parallel capture (line ~3000+)

```ts
updateJobStatus(job, "rendering", "Capturing frames", 30, onProgress);

const tasks = distributeFrames(totalFrames, workerCount, workDir);
const result = await executeParallelCapture(tasks, serverUrl, captureOptions, ..., {
  onFrameCaptured: (workerId, frameIndex) => updateProgress(...),
  onFrameBuffer: streamingMode ? streamFrame : undefined,
});

// Retry flow
const missing = findMissingFrameRanges(...);
if (missing.length > 0) {
  const retryBatches = buildMissingFrameRetryBatches(missing, workerCount);
  // Retry with fewer workers
  const retryWorkerCount = getNextRetryWorkerCount(workerCount);
  await executeParallelCapture(retryBatches, ..., retryWorkerCount);
}
```

**Recoverable error taxonomy** (line 1002-1018):
- `isRecoverableParallelCaptureError`: CDP timeout, out-of-memory → retry with fewer workers
- `shouldFallbackToScreenshotAfterCalibrationError`: if BeginFrame already fails during calibration, switch to screenshot mode

These retry patterns are part of what makes hyperframes production-grade.

### 4.6 Stage 5 — Encoding (line ~3500+)

```ts
updateJobStatus(job, "encoding", "Encoding video", 80, onProgress);

if (shouldUseStreamingEncode(cfg, format, workerCount, duration)) {
  // Streaming encoder already received frames during capture → close
  await streamingEncoder.close();
} else if (cfg.enableChunkedEncode) {
  await encodeFramesChunkedConcat(workDir, outputPath, encoderOpts);
  // Split into N chunks, parallel encode + concat demuxer
} else {
  await encodeFramesFromDir(workDir, outputPath, encoderOpts);
  // Single ffmpeg invocation
}
```

`shouldUseStreamingEncode` (line 1838-1850) — four conditions:
1. `enableStreamingEncode: true`
2. format !== `"png-sequence"`
3. finite duration + > 0 + ≤ `streamingEncodeMaxDurationSeconds`
4. **workerCount === 1**

→ **Streaming is single-worker only**. Parallel workers write frames to disk and combine via chunked encode.

### 4.7 Stage 6 — HDR composite (optional, line 1500-3000?)

**Buffer layout**: every compositing stage uses **rgb48le `Buffer` (6 bytes/pixel, R/G/B each 16-bit uint LE)**. Alpha is tracked separately (DOM layers composite via `blitRgba8OverRgb48le`). Cross-check: `engine/utils/shaderTransitions.ts:343-350`. See note 04 §6.3.

When HDR mode is on, a separate path runs:
1. **Pass 1**: regular SDR Chrome capture (DOM layer, alpha PNG)
2. **Pass 2**: HDR video pixel extraction — **HLG pass-through vs PQ round-trip**:
   - **HLG sources**: **bypass WebGPU**. FFmpeg → `convertHdrFrameToRgb48le` (alpha drop) → FFmpeg when no transform is needed.
   - **PQ + transform required**: WebGPU six-step round-trip — `initHdrReadback` + `uploadAndReadbackHdrFrame`. Headed Chrome: rgba16float texture → float16 readback → linear → PQ.
   - Mechanism detail: §8 (tricky areas), item 4.
3. **Per-frame composite** (all work in rgb48le buffers):
   - `decodePng(...)` → RGBA8 (`Uint8Array`, 4 bytes/pixel)
   - `decodePngToRgb48le(...)` → rgb48le `Buffer` (6 bytes/pixel, alpha dropped, 8→16-bit widen)
   - `queryElementStacking(page)` → DOM stacking order
   - `groupIntoLayers(stacking)` → split into layers
   - HDR video layer: rgb48le as-is
   - DOM layer: alpha composite (`blitRgba8OverRgb48le` — RGBA8 + alpha over-blended onto rgb48le)
   - Apply transition: `TRANSITIONS[shader](from, to, out, w, h, progress)` or `crossfade` (15 registered; note 08 §7.3)
4. **rawvideo encoder**: feed the rgb48le buffer sequence to ffmpeg `-f rawvideo -pix_fmt rgb48le` (engine `streamingEncoder.ts:154-184` raw input mode)

**Memory**: per-frame streaming — ~30MB peak per frame, drained to FFmpeg before the next frame starts. Even eight-hour renders avoid memory buildup.

`hdrPerf` (`HdrPerfSummary`) accumulates per-stage timings.

### 4.8 Stage 7 — Mux + faststart (line ~3800+)

```ts
updateJobStatus(job, "assembling", "Adding audio + faststart", 95, onProgress);

await muxVideoWithAudio(videoPath, audioPath, outputPath);
// ffmpeg -i video.mp4 -i audio.aac -c:v copy -c:a aac out.mp4

if (format === "mp4") {
  await applyFaststart(outputPath);
  // Move moov atom to start of file → playback can start after partial download
}

updateJobStatus(job, "complete", "Render complete", 100, onProgress);
```

### 4.9 finally — cleanup

```ts
} finally {
  clearInterval(memSamplerInterval);
  await safeCleanup("fileServer", fileServer?.stop);
  await safeCleanup("probeSession", probeSession?.close);
  restoreLogger?.();
  if (!job.config.debug) {
    rmSync(workDir, { recursive: true, force: true });  // tidy workDir
  }
  writeFileSync(perfOutputPath, JSON.stringify(perfSummary, null, 2));
}
```

`safeCleanup` (line 120-...) — never-throw wrapper. Failed cleanup does not mask the original error (follows engine `index.ts:8-31` convention).

---

## 5. Engine services pulled into producer — line 32-97

```ts
import {
  // Capture
  createCaptureSession, initializeSession, closeCaptureSession,
  captureFrame, captureFrameToBuffer, getCompositionDuration,
  prepareCaptureSessionForReuse,

  // Video/audio
  extractAllVideoFrames, createFrameLookupTable, FrameLookupTable,
  processCompositionAudio,

  // Encoding
  encodeFramesFromDir, encodeFramesChunkedConcat, muxVideoWithAudio, applyFaststart,
  spawnStreamingEncoder, createFrameReorderBuffer,

  // Parallelism
  calculateOptimalWorkers, distributeFrames, executeParallelCapture, mergeWorkerFrames,

  // HDR
  analyzeCompositionHdr, isHdrColorSpace, detectTransfer, type HdrTransfer,

  // Alpha
  initTransparentBackground, captureAlphaPng,
  applyDomLayerMask, removeDomLayerMask,
  decodePng, decodePngToRgb48le,
  blitRgba8OverRgb48le, blitRgb48leRegion, blitRgb48leAffine, parseTransformMatrix,
  resampleRgb48leObjectFit, normalizeObjectFit,

  // Compositing / transitions
  queryElementStacking, groupIntoLayers, TRANSITIONS, crossfade, convertTransfer,
  type TransitionFn, type ElementStackingInfo, type HfTransitionMeta,

  // ffmpeg / probe
  runFfmpeg, extractMediaMetadata, type VideoColorSpace,

  type EngineConfig, resolveConfig,
  type ExtractedFrames, type ExtractionPhaseBreakdown,
  type VideoElement, type ImageElement, type AudioElement,
  type CaptureOptions, type CaptureVideoMetadataHint, type CaptureSession, type BeforeCaptureHook,
  type ParallelProgress, type WorkerTask, type StreamingEncoder,
} from "@hyperframes/engine";
```

50+ symbols — producer consumes nearly everything engine exports. Engine is the parts bin; producer is the assembly recipe.

---

## 6. Regression Harness — `regression-harness.ts` (938 lines)

### 6.1 TestMetadata (line 25-40)

```ts
type TestMetadata = {
  name, description, tags: string[],
  minPsnr: number,                    // minimum PSNR per frame
  maxFrameFailures: number,           // allowed frames below threshold
  minAudioCorrelation: number,        // [0, 1]
  maxAudioLagWindows: number,         // 512-sample window
  renderConfig: { fps, format?, workers?, hdr? },
};
```

### 6.2 Test directory layout

```
packages/producer/tests/<test-name>/
  meta.json         ← TestMetadata
  src/
    index.html      ← composition source
    assets/...
  output/
    output.mp4      ← Docker-built baseline (committed)
```

### 6.3 Four check stages

```ts
type TestResult = {
  suite,
  passed,
  compilation?: { passed, errors, warnings },    // 1. compile OK?
  visual?: { passed, failedFrames, checkpoints }, // 2. per-frame PSNR
  audio?: { passed, correlation, lagWindows },    // 3. audio cross-correlation
  renderedOutputPath?,                            // 4. artifact path
};
```

**`buildRmsEnvelope` + `compareAudioEnvelopes`** (`utils/audioRegression.ts`): see cheatsheet [04-regression-testing](cheatsheets/04-regression-testing.md).

### 6.4 CLI flags

```ts
type CliOptions = {
  testNames: string[],          // positional args (empty = all tests)
  excludeTags: string[],         // --exclude-tags slow,expensive
  update: boolean,               // --update (refresh baselines)
  sequential: boolean,           // --sequential (disable parallelism)
  keepTemp: boolean,             // --keep-temp (retain workDir)
};
```

### 6.5 Why Docker baselines are mandatory

`Dockerfile.test` pins determinism for baseline builds:
1. **Same chrome-headless-shell build ID**
2. **Pinned fontconfig + freetype** (hinting differs per host)
3. **Pinned ffmpeg** (encoder flag compatibility)
4. **GPU encoders off** (force libx264 software)
5. **BeginFrame path on** (Linux + chrome-headless-shell)

macOS hosts use VideoToolbox H.264, different freetype, no BeginFrame — pixel-perfect baselines are not reproducible.

---

## 7. One-shot call trace

```
producer.executeRenderJob(job, projectDir, outputPath, onProgress, abortSignal)
  │
  ├── create workDir (.debug or sibling work-<id>)
  ├── memSamplerInterval (250ms RSS/heap)
  ├── validate entry file + standalone wrapper (sub-composition case)
  │
  ├── Stage 1 Compile:
  │     compileForRender(htmlPath, cfg, ...) → CompiledComposition
  │       (core parsers + generators + VIRTUAL_TIME_SHIM injection + inlined runtime)
  │
  ├── Stage 2 Preprocessing:
  │     ├── analyzeCompositionHdr → pick HDR mode
  │     ├── extractAllVideoFrames(videos)
  │     │     - HDR preflight, VFR preflight
  │     │     - parallel ffmpeg spawns
  │     │     - build frameLookupTable
  │     ├── processCompositionAudio(audios) → audio.aac
  │     └── createFileServer(workDir) → serverUrl (VIRTUAL_TIME_SHIM injection)
  │
  ├── Stage 3 Calibration (optional):
  │     ├── selectCaptureCalibrationFrames(totalFrames)
  │     ├── measured capture (samples)
  │     └── estimateMeasuredCaptureCostMultiplier
  │
  ├── Stage 4 Parallel capture:
  │     ├── workerCount = calculateOptimalWorkers(total, requested, { multiplier })
  │     ├── tasks = distributeFrames(total, workerCount, workDir)
  │     ├── (streaming) spawnStreamingEncoder + createFrameReorderBuffer
  │     ├── executeParallelCapture(tasks, serverUrl, captureOpts, beforeCaptureHook, ...)
  │     │     for each worker:
  │     │       acquireBrowser → createCaptureSession → initializeSession
  │     │       for frame in [start, end):
  │     │         prepareFrameForCapture → __hf.seek(t) (bump virtual clock + rAF flush)
  │     │         beginFrameCapture | pageScreenshotCapture
  │     │         (streaming) reorderBuffer.waitForFrame(f) → encoder.writeFrame(buf) → advanceTo(f+1)
  │     │         (file) writeFileSync(path, buf)
  │     │       closeCaptureSession (releaseBrowser)
  │     ├── findMissingFrameRanges → if gaps, buildMissingFrameRetryBatches → retry
  │     └── onFrameCaptured hook updates progress
  │
  ├── Stage 5 Encoding:
  │     ├── (streaming) await streamingEncoder.close()
  │     ├── (chunked)   encodeFramesChunkedConcat(workDir, outputPath, opts)
  │     └── (single)    encodeFramesFromDir(workDir, outputPath, opts)
  │
  ├── Stage 6 HDR composite (HDR mode only):
  │     ├── pass 1: SDR DOM capture (alpha PNG)
  │     ├── pass 2: WebGPU HDR readback (rgba16float → PQ/HLG float16)
  │     ├── per-frame: decodePng → blitRgba8OverRgb48le → transitions[shader]
  │     └── ffmpeg -f rawvideo -pix_fmt rgb48le output
  │
  ├── Stage 7 Assembly:
  │     ├── muxVideoWithAudio(video.mp4, audio.aac, output.mp4)
  │     └── (mp4) applyFaststart(output.mp4)
  │
  └── finally:
        ├── clearInterval(memSampler)
        ├── safeCleanup(fileServer, probeSession)
        ├── rmSync(workDir) (unless debug)
        └── writeFileSync(perf-summary.json)
```

---

## 8. Tricky areas / items to verify

1. **`compileForRender` step-by-step accuracy** — deep read of htmlCompiler.ts (827+ lines). Pin down compositionLoader (sub-comp), Tailwind v4 inline build, runtime injection sites.
2. ~~**`recompileWithResolutions`**~~ — verified (2026-05-05): **partial recompile after duration updates** (not variable substitution!). The name’s “Resolutions” means *resolution as in settling a decision*, not pixel dimensions. Exact behavior: §4.2 catalog. `CompositionVariable` substitution is a *separate mechanism* outside htmlCompiler (exact hook needs another read).
3. ~~**`discoverMediaFromBrowser`**~~ — verified (2026-05-05): called from renderOrchestrator.ts:2102. Runs in a **dedicated probe browser session** (`probeSession.page`). So:
   - Late in Stage 2 preprocessing, spin up *one probe Chrome*
   - Merge statically parsed media (`compileForRender` output) + dynamically discovered media into the final list
   - Main capture then uses *separate browser instances* (parallel workers)
   - Probe session torn down in `finally` (line 1903 `probeSession: CaptureSession | null`)

   **CompositionVariable substitution (separate finding, 2026-05-05)**: variable substitution is **not producer’s job**. Core generator `generators/hyperframes.ts:533-547` passes values through sub-composition iframe URL query params; user code reads via `URLSearchParams(location.search)`. Details: [note 02 §2.2](02-core-types-parsers.md) (CompositionVariable, lines 88–161). Producer only runs `compileForRender` → resulting HTML may carry query-encoded iframe `src`s.
4. ~~**HDR readback throughput**~~ — verified (2026-05-05, `engine/services/hdrCapture.ts:1-240`):

   **Per-frame streaming** confirmed — no accumulating memory. Per-frame footprint ~30MB peak (rgba16f texture + base64 buffer + rgb48le output), drained to FFmpeg stdin before the next frame.

   **Six-stage pipeline** (comments line 6-14):
   ```
   1. FFmpeg → rgba64le (8 bytes/pixel, 16-bit per channel + alpha)
   2. Node: HLG/PQ signal → linear → float16 conversion
   3. WebGPU writeTexture → rgba16float texture (base64 transfer)
   4. (optional) WebGPU shader applies GSAP transform
   5. copyTextureToBuffer + mapAsync readback (base64 transfer)
   6. Node: linear float16 → PQ signal → rgb48le → FFmpeg H.265
   ```

   **Key optimization — HLG pass-through** (comment line 162-172):
   > "For HLG sources: the pixel values are already HLG-encoded. We pass them through as-is and tag the output as HLG. No OETF conversion needed — converting to linear and back to PQ produces worse results because every viewer's PQ→display tone-mapping differs from its HLG→display tone-mapping. The WebGPU round-trip is skipped for pass-through — pixels go directly from FFmpeg extraction to FFmpeg encoding. WebGPU is only needed when transforms (scale, rotate, opacity from GSAP) must be applied to the HDR pixels."

   So:
   - **HLG + no transform**: bypass WebGPU. FFmpeg → `convertHdrFrameToRgb48le` (alpha drop only) → FFmpeg. Fastest.
   - **PQ + transform**: full six-step round-trip. Two base64 transfers (~12MB × 2). Slow (~6fps at 1080×1920).
   - **PQ + no transform / HLG + transform**: in between

   **256-byte row alignment**: WebGPU `bytesPerRow` requirement. `bytesPerRow = ceil(w * 8 / 256) * 256`. 1080×1920 → bytesPerRow 8704 (32 padding bytes per row).
5. ~~**`shouldUseStreamingEncode` four conditions**~~ — partially verified (2026-05-05): line 1838-1850 has **no rationale comments**. Straightforward:
   ```ts
   if (!cfg.enableStreamingEncode) return false;
   if (outputFormat === "png-sequence") return false;
   if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
   if (durationSeconds > cfg.streamingEncodeMaxDurationSeconds) return false;
   return workerCount === 1;
   ```
   No documented reason for `workerCount === 1`. Hypothesis (not confirmed): N-worker streaming needs either per-worker ffmpeg or a central reorder buffer + single ffmpeg; the latter may clash with the disk-based path + retry flows. Worth checking PR/issue history.
6. **Is VIRTUAL_TIME_SHIM injected on every page?** — interactive preview needs wall-clock time. Confirm fileServer inject/skip rules.
7. ~~**Per-frame retry vs worker retry**~~ — verified (2026-05-05): **frame-range retry** (neither per-frame nor per-worker — *batch re-capture of missing ranges*). Flow:
   - After capture, `findMissingFrameRanges(...)` (line 1160, 1184) — called twice (after chunk encode + before final mux)
   - `buildMissingFrameRetryBatches(missingRanges, currentWorkers, attemptDir, attemptNum)` (line 1122) — repackage gaps into worker tasks
   - `getNextRetryWorkerCount(currentWorkers)` (line 1174, 1196) — worker count for next attempt (often half or 1)
   - Stop condition (line 1192): `!options.allowRetry || currentWorkers <= 1 || !isRecoverableParallelCaptureError(error)` — stop after one-worker failure or non-recoverable error
   - **Progressive fallback**: N workers → N/2 → … → 1 → fail. Each step retries only missing frames.
8. **memSampler at 250ms — misses 1ms peaks** — shorter intervals would catch peaks more accurately but cost measurement overhead. 250ms is the production trade-off.

---

## 9. Compared to Remotion

| Aspect | Remotion | Hyperframes producer |
|---|---|---|
| Time polyfill | (none — React is frame-based) | VIRTUAL_TIME_SHIM (95 lines, six mocks) |
| HDR | unsupported | 2-pass + WebGPU readback + custom composite |
| Audio mix | built-in | engine `processCompositionAudio` (atrim+adelay+amix) |
| Distribution | Lambda + S3 | local workers + Docker (force screenshot) |
| Regression tests | (no standard) | PSNR + audio cross-correlation as standard |
| memSampler | (none) | 250ms RSS/heap peak sampling |
| Capture calibration | (none) | sample frames tune worker count |

Producer *follows* Remotion-like patterns but tightens determinism (VIRTUAL_TIME_SHIM, capture calibration) and adds production ops detail (memSampler, retry, perf summary).

---

## 10. Related notes

- ← [04 engine](04-engine-capture.md) — granular pieces producer *composes* (browserManager / frameCapture / streamingEncoder / parallelCoordinator)
- → [06 cli](06-cli-orchestration.md) — 24 commands that expose producer externally
- ↗ [02 types/parsers](02-core-types-parsers.md) — core parsers/linter/generators behind `compileForRender`’s 14 steps
- ↗ [03 runtime + adapters](03-core-runtime-adapters.md) — six adapters fan out atop VIRTUAL_TIME_SHIM’s mocked clock
- ↗ [08 shader-transitions](08-shader-transitions.md) §3.3 — when `__HF_VIRTUAL_TIME__` exists, shader-transitions takes engine mode
- ⊥ [cheatsheet 04](cheatsheets/04-regression-testing.md) — `regression-harness.ts` commands + PSNR/audio thresholds
- ⊥ [cheatsheet 03](cheatsheets/03-render-flags.md) — `forceScreenshot` as one leg of the three-way captureMode gate

## 11. Next → 06

How the CLI exposes producer and layers 24 commands on producer/engine — covered in 06.

Checklist for this note:
- [ ] `bun run --cwd packages/producer build` then inspect `dist/`
- [ ] In devtools, call `window.__HF_VIRTUAL_TIME__.seekToTime(2000)` and confirm `Date.now()` reflects virtual time
- [ ] Run `bun run --cwd packages/producer test:regression --sequential` once
- [ ] `--debug` + `perf-summary.json` — inspect stages, captureCalibration, hdrPerf
- [ ] Render HDR footage → hdrPerf breakdown (does readback dominate?)
