# cheatsheet/04 - Regression testing

## Test layers

| Layer | Use |
|---|---|
| package unit tests | parser/runtime/stage/helper behavior |
| producer regression harness | local render visual/audio regression |
| distributed regression harness | `plan -> renderChunk -> assemble` parity |
| Lambda local harness | Lambda adapter behavior without full cloud loop |
| CLI snapshot/inspect | quick visual checks for projects |

## Commands

```bash
# All workspace tests in upstream checkout
bun test

# Package-specific examples
bun run --filter @hyperframes/core test
bun run --filter @hyperframes/producer test
bun run --filter @hyperframes/aws-lambda test

# Visual snapshot command for a project
npx hyperframes snapshot ./my-project --frames 5
npx hyperframes snapshot ./my-project --at 1.2,3.4,5.6
```

## Docker rule

Use Docker/controlled Chrome when producing visual baselines. Host-only baselines
can drift due to:

- Chrome version
- GPU backend
- fonts
- OS rendering differences
- screenshot vs BeginFrame fallback

Host-only renders are good for debugging, not for canonical baseline updates.

## Distributed-specific checks

Validate:

- `planHash` stability for same inputs
- hash changes for different variables when pixels can differ
- chunk boundary frame counts
- renderChunk idempotency
- assemble ordering
- unsupported distributed formats
- fail-closed fonts
- software GPU enforcement

Useful source:

```text
packages/producer/src/regression-harness-distributed.ts
packages/producer/src/regression-harness-lambda-local.ts
packages/producer/src/services/distributed/
packages/aws-lambda/src/
```

## Metrics

Visual:

- PSNR
- frame hashes
- screenshot diffs
- selected frame snapshots

Audio:

- duration
- cross-correlation
- sample rate/channel consistency

Performance:

- stage timings
- capture average/peak
- worker count
- retry attempts
- peak RSS/heap
- temp directory bytes

## Debug checklist

1. Run linter before render.
2. Reproduce with `--workers 1`.
3. Compare screenshot vs BeginFrame path if capture is suspicious.
4. Keep temp artifacts with debug/KEEP_TEMP where supported.
5. Inspect browser console tail in render errors.
6. For distributed, verify `plan.json`, `meta/encoder.json`, and chunk slices.
7. For Lambda, inspect Step Functions history and Lambda logs.

## Related

- [../04-engine-capture.md](../04-engine-capture.md)
- [../05-producer-pipeline.md](../05-producer-pipeline.md)
- [../11-aws-lambda-distributed.md](../11-aws-lambda-distributed.md)
