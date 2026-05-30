# 04-engine-capture

> `@hyperframes/engine` owns the low-level browser and media services:
> launching Chrome, waiting for the page contract, seeking frames, capturing
> pixels, extracting/injecting media, encoding/muxing helpers, and HDR/shader
> utilities.

## 1. Export surface

Start with `packages/engine/src/index.ts`. The package exports:

- config resolution
- browser manager and Chrome flags
- frame capture sessions
- BeginFrame/screenshot helpers
- streaming/chunk encoders
- video frame extraction and injection
- audio parsing/mixing
- parallel capture coordinator
- file server
- HDR/color utilities
- shader transition compositing helpers
- alpha/screenshot helpers
- FFmpeg/process utilities

Producer reuses this surface heavily, but engine does not own the full render
job lifecycle.

## 2. Page protocol

The engine's capture loop waits for:

```ts
window.__hf &&
typeof window.__hf.seek === "function" &&
window.__hf.duration > 0
```

Then each frame is:

```text
frameIndex -> exact time -> window.__hf.seek(time) -> beforeCapture hook -> screenshot/BeginFrame
```

Render-time variables are injected before any page script runs by setting
`window.__hfVariables` through `page.evaluateOnNewDocument`.

## 3. Browser lifecycle

Read:

- `services/browserManager.ts`
- `services/frameCapture.ts`
- `config.ts`

Capture mode is selected from multiple signals:

| Signal | Effect |
|---|---|
| platform/browser support | BeginFrame is preferred only where supported |
| explicit/derived `forceScreenshot` | forces `Page.captureScreenshot` path |
| alpha output | forces screenshot because BeginFrame does not preserve alpha in the current headless path |
| render-mode hints | compiler can recommend screenshot for fragile pages |
| BeginFrame probe failure | falls back to screenshot |

The important idea: capture mode is frozen before downstream capture stages so
local render and distributed chunks can agree on the same behavior.

## 4. BeginFrame vs screenshot

| Mode | Mechanism | Strength | Weakness |
|---|---|---|---|
| BeginFrame | Chrome `HeadlessExperimental.beginFrame` | stronger deterministic compositor timing | platform/browser support is stricter, alpha is not preserved |
| Screenshot | Chrome `Page.captureScreenshot` | portable fallback, supports alpha path | weaker timing guarantees, more dependent on runtime readiness |

Warmup BeginFrame calls with `noDisplayUpdates` advance timers/rAF but do not
produce final pixels. Actual capture must request a screenshot payload.

## 5. Capture session lifecycle

`createCaptureSession` establishes:

- browser/page
- viewport and device scale factor
- output directory
- virtual/runtime variable injection
- expected Chromium checks
- capture mode
- perf counters
- optional `onBeforeCapture`

`initializeSession` navigates to the file server, waits for `window.__hf`, waits
for fonts/media readiness as needed, and prepares transparent background for
alpha outputs.

`captureFrame`/`captureFrameToBuffer` do the per-frame work.

## 6. Media extraction and injection

Rendering video/audio by relying on native playback would reintroduce wall-clock
state. Engine services instead support deterministic media handling:

- probe source metadata with FFprobe
- extract frames/audio as needed
- inject the exact video frame for a given render frame
- mix audio separately for final muxing

The producer decides when to invoke each service; engine provides the primitives.

## 7. Parallel capture

`services/parallelCoordinator.ts` splits frame ranges into worker tasks and caps
worker counts based on CPU/memory/estimated cost. Producer can pass a
`captureCostMultiplier` after calibration, so expensive pages do not overwhelm
Chrome/SwiftShader with too many workers.

Ordering is handled by:

- deterministic frame indices
- worker task frame ranges
- merge/reorder helpers before encoding
- adaptive retry of missing frame ranges in producer

## 8. Streaming and chunk encoding

Engine exposes both:

- streaming encoder helpers for piping captured frames into FFmpeg
- chunk encoder helpers for disk frames / distributed chunk outputs

Producer chooses among:

- streaming local path when safe
- disk frame capture path
- layered HDR/shader composite path
- distributed chunk render path

## 9. Alpha output

Alpha-capable formats:

- `webm` with VP9 alpha
- `mov` with ProRes 4444
- `png-sequence`

Alpha output forces screenshot capture and disables HDR. The engine injects
transparent-background support, but authors still need to avoid painting a full
opaque body/root background when they want true transparency.

## 10. HDR and shader utilities

Engine contains the low-level color/HDR utilities used by producer:

- FFprobe color-space reading
- transfer conversion
- rgb48le buffer compositing
- WebGPU/HDR capture helpers
- shader transition CPU ports in `utils/shaderTransitions.ts`
- layer compositor utilities

The engine registry contains 15 transitions: the shader package's set plus
`crossfade` for engine-side/CSS fallback behavior.

## 11. Failure modes to recognize

- `window.__hf not ready`: page did not expose seek contract or script crashed.
- BeginFrame method missing: browser supports part of the protocol but not the
  actual frame call; fallback to screenshot.
- non-SwiftShader GL in distributed mode: deterministic distributed rendering
  refuses hardware GL.
- font fetch failure in fail-closed paths: distributed plan wants reproducible
  font bytes.
- missing frames after capture: producer retries ranges with fewer workers.
- alpha expected but opaque output: author painted a background or used a format
  without alpha.

## 12. Debug commands

```bash
# Find Chrome/capture decisions
rg "forceScreenshot|beginFrame|captureMode" packages/engine/src packages/producer/src

# Inspect shader transition registry
rg 'TRANSITIONS\\["' packages/engine/src/utils/shaderTransitions.ts

# Inspect variable injection
rg "__hfVariables" packages/engine/src packages/producer/src packages/core/src
```

## 13. Next

Continue with [05-producer-pipeline.md](05-producer-pipeline.md), which composes
these primitives into full local renders.
