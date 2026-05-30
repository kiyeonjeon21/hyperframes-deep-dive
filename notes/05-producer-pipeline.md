# 05-producer-pipeline

> `@hyperframes/producer` is the local render orchestrator and the source of
> distributed render primitives. In v0.6.61, the important change is that the
> local renderer is staged: `renderOrchestrator.ts` sequences modules under
> `services/render/stages/`, and the distributed path reuses the same stage
> logic where possible.

## 1. Package shape

Start with:

- `packages/producer/src/index.ts`
- `packages/producer/src/services/renderOrchestrator.ts`
- `packages/producer/src/services/render/stages/`
- `packages/producer/src/distributed.ts`

The default package entry exposes local rendering and server helpers. The
distributed surface is available both from `@hyperframes/producer` and the
explicit `@hyperframes/producer/distributed` subpath.

## 2. RenderConfig highlights

Current config themes:

| Field | Meaning |
|---|---|
| `fps: Fps` | exact rational FPS, not loose decimal |
| `quality` | `draft`, `standard`, `high` encoder presets |
| `format` | `mp4`, `webm`, `mov`, `png-sequence` |
| `workers` | local capture worker count override |
| `debug` | retain artifacts / emit more diagnostics |
| `crf` / `videoBitrate` | mutually exclusive encoder quality controls |
| `hdrMode` | `auto`, `force-hdr`, `force-sdr` |
| `variables` | render-time variable overrides |
| `outputResolution` | preset-driven supersampling through Chrome `deviceScaleFactor` |

Alpha output (`webm`, `mov`, `png-sequence`) forces screenshot capture and
disables HDR. HDR requires MP4 in the current local pipeline.

## 3. Local stage map

`executeRenderJob` is now best read as a sequencer:

| Stage | Module | Responsibility |
|---|---|---|
| compile | `compileStage.ts` | compile HTML, write artifacts, resolve screenshot mode, resolve device scale |
| probe | `probeStage.ts` | browser-driven duration/media/runtime discovery |
| extract videos | `extractVideosStage.ts` | pre-extract video frames for deterministic injection |
| audio | `audioStage.ts` | extract/mix audio into sidecar |
| capture | `captureStage.ts` | SDR disk capture path |
| capture streaming | `captureStreamingStage.ts` | capture -> encoder pipe when safe |
| capture HDR | `captureHdrStage.ts` | layered HDR / shader transition composite |
| encode | `encodeStage.ts` | encode frames/chunks to video-only output |
| assemble | `assembleStage.ts` | final mux, faststart, format-specific finalize |

`renderOrchestrator.ts` still owns cross-stage concerns: temp dirs, cleanup,
memory sampling, progress callbacks, cancellation, retry summaries, and final
perf summary.

## 4. Stage 1: compile

`compileStage` calls `compileForRender()` and writes `workDir/compiled/`.

It also folds three capture-mode inputs into one `forceScreenshot` result:

1. caller config
2. alpha-output requirement
3. compiler render-mode hints

The stage resolves `deviceScaleFactor` from `outputResolution`, composition
dimensions, HDR, and alpha constraints. This is how authored 1080p layouts can
render to 4K without changing CSS coordinates.

## 5. Stage 1b: probe

The browser probe exists because static HTML parsing is not enough:

- scripts may register timelines dynamically
- media `src` may come from variables
- video/audio natural duration may need FFprobe/browser reconciliation
- runtime readiness must be checked in a real page

The probe can update the composition duration and media lists before downstream
stages freeze frame counts.

## 6. Stage 2: extract videos

Video extraction turns source media into deterministic frame assets. This is
especially important for:

- clips with source offsets
- variable-driven `src`
- distributed chunks that cannot depend on live native playback
- reuse across retries/chunks

Distributed planning materializes symlinks/assets so workers can operate on a
self-contained `planDir`.

## 7. Stage 3: audio

Audio is processed separately from pixel capture:

- parse audio/video elements with audio tracks
- apply timing and volume envelopes
- produce an audio sidecar
- mux during assemble

This separation prevents visual frame capture timing from controlling final
audio sync.

## 8. Stage 4: capture

Local capture chooses among three paths:

| Path | Use case |
|---|---|
| `captureStreamingStage` | local SDR cases where streaming encode is safe |
| `captureStage` | disk-frame SDR capture, including retryable parallel capture |
| `captureHdrStage` | layered HDR/shader/DOM compositing |

`captureStage` supports `frameRange`, which is how distributed `renderChunk`
captures only its assigned slice while preserving absolute frame time.

Producer also performs capture calibration: sample frames can estimate page cost
and reduce worker count before the full capture.

## 9. Stage 5/6: encode and assemble

Encoding and assembly are split because different formats have different needs:

- video-only chunks/files may be encoded before final audio mux
- MP4 faststart moves metadata for streaming playback
- transparent formats use different codecs/pixel formats
- distributed mode needs chunk concat/assembly after all workers finish
- optional CFR re-encode can force exact average frame rate in Lambda assemble

## 10. Perf and diagnostics

`RenderPerfSummary` captures:

- total elapsed time
- fps/quality/workers/chunking
- total frames and duration
- stage timings
- video extraction breakdown
- temporary disk usage
- capture avg/peak timings
- calibration reasons
- retry attempts
- peak RSS/heap
- HDR diagnostics when relevant

Failure paths include browser console tails, cleanup attempts, and normalized
error messages.

## 11. Distributed primitive surface

`packages/producer/src/distributed.ts` exports:

```ts
plan(projectDir, config, planDir)
renderChunk(planDir, chunkIndex, outputPath)
assemble(planDir, chunkPaths, audioPath, outputPath)
```

Those primitives are deliberately transport-free:

- no AWS SDK
- no Step Functions
- no network assumptions
- pure local paths in, local paths out

Adapters such as `@hyperframes/aws-lambda` provide S3 upload/download and
scheduler semantics.

## 12. Frozen plan

`freezePlan.ts` writes:

- `compiled/index.html`
- `meta/composition.json`
- `meta/encoder.json`
- `meta/chunks.json`
- `plan.json`

The `planHash` is computed from frozen bytes and selected metadata, so workers
can reject mismatched plans. Variables are included in the locked encoder config;
different values can legitimately produce different plan hashes.

## 13. Deterministic fonts

Distributed planning can fail closed on external font fetches. This is stricter
than casual local preview because chunk workers must render the same pixels on
different machines. The plan records a deterministic font snapshot hash.

## 14. Local vs distributed

| Concern | Local render | Distributed render |
|---|---|---|
| orchestration | single Node process | external scheduler |
| temp data | work dir | frozen `planDir` + chunk outputs |
| retry | local missing-frame retry | scheduler retry + plan hash validation |
| transport | filesystem | adapter-defined, e.g. S3 |
| concurrency | local Chrome workers | chunks across workers/Lambdas |
| public package | `@hyperframes/producer` | `@hyperframes/producer/distributed` |

## 15. Next

Read [06-cli-orchestration.md](06-cli-orchestration.md) to see how local render,
cloud render, and Lambda render are exposed to users.
