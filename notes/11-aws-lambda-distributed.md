# 11-aws-lambda-distributed

> Distributed rendering is split into transport-free producer primitives and a
> concrete AWS Lambda adapter. Read this note after note 05.

## 1. Two layers

| Layer | Package | Responsibility |
|---|---|---|
| render primitives | `@hyperframes/producer/distributed` | `plan`, `renderChunk`, `assemble` over local paths |
| AWS adapter | `@hyperframes/aws-lambda` | handler, S3 transport, SDK, CDK construct, Step Functions event types |

The producer primitives are intentionally not AWS-specific. Lambda is one
adapter around them.

## 2. Producer distributed API

Entry: `packages/producer/src/distributed.ts`.

```ts
const planResult = await plan(projectDir, config, planDir);
const chunk = await renderChunk(planDir, chunkIndex, outputChunkPath);
const final = await assemble(planDir, chunkPaths, audioPath, outputPath);
```

The key property: retries are safe when the same `planDir` and `chunkIndex` are
used. A chunk worker should produce byte-identical output for the same frozen
plan inputs.

## 3. Plan activity

`plan()` does the controller-side preparation:

- compile HTML and runtime
- probe duration/media
- extract/materialize videos
- mix audio sidecar
- compute chunk slices
- write frozen metadata
- compute `planHash`

Important plan files:

```text
compiled/index.html
meta/composition.json
meta/encoder.json
meta/chunks.json
plan.json
audio.aac       # when audio exists
video-frames/   # when extracted media exists
```

## 4. Locked config

`meta/encoder.json` freezes decisions chunk workers must not reinvent:

- capture mode
- `forceScreenshot`
- `deviceScaleFactor`
- encoder type and pixel format
- quality/preset/CRF/bitrate
- GOP/keyframe rules
- chunk count/size
- runtime env snapshot
- render variables
- software GPU mode

This is how plan-time and worker-time decisions stay aligned.

## 5. Plan hash

`planHash` is content-addressed over frozen plan data. Workers validate it before
rendering. A mismatch usually means the controller and worker are not looking at
the same plan bytes or producer version.

Variables are intentionally part of the frozen config, so two renders with
different variables can have different hashes.

## 6. RenderChunk activity

`renderChunk()`:

- reads `plan.json` and `meta/chunks.json`
- validates the plan hash
- applies runtime env snapshot
- launches deterministic browser/capture flow
- captures only `[startFrame, endFrame)` for the chunk
- encodes/writes one chunk output

The frame filenames can be chunk-local, but the time passed to the page uses the
absolute frame index. That preserves visual parity with local full renders.

## 7. Assemble activity

`assemble()`:

- reads ordered chunks
- verifies expected frame counts/format metadata
- muxes audio when present
- writes final output
- can optionally force CFR re-encode for exact average frame rate on MP4

The common fast path is concat/copy where possible.

## 8. AWS Lambda package

Entry: `packages/aws-lambda/src/index.ts`.

Exports:

- `handler`
- Step Functions event/result types
- Chrome resolution helpers
- S3 tar/upload/download helpers
- SDK: `deploySite`, `renderToLambda`, `getRenderProgress`
- cost accounting helpers
- config validation
- CDK construct via `@hyperframes/aws-lambda/cdk`

The package is separate so producer does not depend on AWS SDK/CDK.

## 9. Lambda event model

The handler dispatches by `Action`:

| Action | Producer primitive |
|---|---|
| `plan` | `plan(projectDir, config, planDir)` |
| `renderChunk` | `renderChunk(planDir, chunkIndex, output)` |
| `assemble` | `assemble(planDir, chunks, audio, output)` |

All heavy files move through S3. Lambda only writes to `/tmp`.

## 10. AWS topology

```text
Step Functions Standard
  Plan
  -> Map(N) RenderChunk
  -> Assemble

One Lambda function
  handler.mjs
  bin/ffmpeg
  @sparticuz/chromium or configured Chrome source

S3 bucket
  project tar
  plan tar
  chunk outputs
  final output
```

## 11. CLI surface

`hyperframes lambda` supports:

- `deploy`
- `sites create`
- `render`
- `render-batch`
- `progress`
- `destroy`
- `policies`

Notable ergonomics:

- default deploy concurrency is conservative
- `sites create` pre-uploads a content-addressed project tree
- `render --wait` streams progress and estimated cost
- `render-batch` fans out JSONL template renders with `--max-concurrent`
- `policies` prints or validates IAM policy documents

## 12. Templates on Lambda

Variables flow through Lambda config:

```bash
hyperframes lambda render ./template \
  --site-id abc123 \
  --variables '{"title":"Hello Alice"}' \
  --wait
```

Batch JSONL:

```jsonl
{"outputKey":"renders/alice.mp4","variables":{"title":"Hi Alice"}}
{"outputKey":"renders/bob.mp4","variables":{"title":"Hi Bob"}}
```

Step Functions Standard input is capped at 256 KiB, so variables should carry
typed data and URLs, not embedded media blobs.

## 13. Failure modes

| Error/symptom | Likely cause |
|---|---|
| `PLAN_HASH_MISMATCH` | stale plan, mixed producer versions, wrong S3 object |
| `BROWSER_GPU_NOT_SOFTWARE` | Lambda Chrome launched with non-SwiftShader GL |
| font fetch failure | fail-closed deterministic font plan could not fetch font bytes |
| stuck RUNNING | chunks queued behind reserved concurrency or Lambda cold starts |
| oversize input | variables/config exceeded Step Functions input limit |

## 14. Why this matters

This is HyperFrames' answer to render farms without making the renderer itself
cloud-specific. The same primitive model can be adapted to Lambda, K8s Jobs,
Temporal, Cloud Run Jobs, or a custom queue.

## 15. Next

Read [12-variables-templates.md](12-variables-templates.md) to understand the
template data that often motivates batch/distributed rendering.
