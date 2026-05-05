# cheatsheet/04 — Regression testing

> Docker golden baselines / PSNR / audio cross-correlation. Complements CLAUDE.md “Regression Test Golden Baselines”.

## Why Docker is required

Baselines must be produced **only** via `Dockerfile.test`. **MP4s built directly on a host (macOS/Linux) will not match CI.** Reasons:

1. **chrome-headless-shell version skew** — puppeteer cache images differ by build ID
2. **Font rasterization** — fontconfig/freetype/hinting differ by OS
3. **ffmpeg builds** — Homebrew vs Docker codecs may differ
4. **GPU encoder autodetect** — host may pick VideoToolbox; Docker often sticks to libx264

Because thresholds like PSNR 38 dB are picky, tiny deltas fail runs.

## Commands

```bash
# One-time: build test image
docker build -t hyperframes-producer:test -f Dockerfile.test .

# Refresh baseline (inside Docker, --update)
bun run --cwd packages/producer docker:test:update <test-name>

# Run regression (inside Docker)
bun run --cwd packages/producer docker:test <test-name>

# Host-only experiment — **never commit baselines from here**
bun run --cwd packages/producer test:regression -- <test-name>
```

## `TestMetadata` schema

`packages/producer/src/regression-harness.ts:25-40`

```ts
type TestMetadata = {
  name: string;
  minPsnr: number;             // minimum PSNR per frame (dB)
  maxFrameFailures: number;    // allowed frames below threshold
  minAudioCorrelation: number; // audio correlation in [0, 1]
  maxAudioLagWindows: number;  // lag tolerance in 512-sample windows
  renderConfig: {
    fps: 24 | 30 | 60;
    format?: "mp4" | "webm";
    workers?: number;
  };
};
```

## PSNR (peak signal-to-noise Ratio)

```
PSNR = 10 × log10(MAX² / MSE)
```
- MAX = 255 (8-bit) or 1023 (10-bit)
- MSE = mean squared error vs baseline frame
- Typical thresholds:
  - **draft**: minPsnr 30 (looks the same; catches big regressions)
  - **standard**: minPsnr 35
  - **high**: minPsnr 38 (near bit-identical)

Algorithm compares **luma (Y) only** to ignore chroma noise; averages PSNR per frame.

## Audio cross-correlation

`packages/producer/src/utils/audioRegression.ts`

Why: FFT phase is too sensitive to ffmpeg/encoder versions. RMS envelope in the time domain is stable and matches perception.

Flow:
1. Extract mono PCM: `ffmpeg -vn -ac 1 -ar 48000 -f s16le` from baseline and candidate MP4s
2. Sliding 512-sample RMS envelope: `rms[i] = sqrt(sum(x[k]²)/N)`
3. Normalized cross-correlation:
   ```
   r(τ) = Σ rmsA[i] × rmsB[i+τ] / sqrt(Σ rmsA² × Σ rmsB²)
   ```
4. Pass if `max(r) ≥ minAudioCorrelation` and `argmax τ` within `maxAudioLagWindows`

## Directory layout

```
packages/producer/tests/<test-name>/
  meta.json                  ← TestMetadata
  src/
    index.html               ← composition source
    assets/...               ← media
  output/
    output.mp4               ← Docker-built baseline (committed)
```

## Adding a new test

1. Create `packages/producer/tests/<name>/`
2. Write `meta.json` (name, thresholds, `renderConfig`)
3. Add deterministic `src/index.html` (no `Math.random()`, etc.)
4. Build baseline in Docker: `bun run --cwd packages/producer docker:test:update <name>`
5. Commit `output/output.mp4`
6. CI runs `bun run --cwd packages/producer test:regression`

## Debugging baseline diffs

```bash
# PSNR two MP4s
ffmpeg -i baseline.mp4 -i new.mp4 -lavfi psnr -f null -

# Visual diff
ffmpeg -i baseline.mp4 -i new.mp4 -lavfi "blend=all_mode=difference" diff.mp4

# Frame sha256
ffmpeg -i baseline.mp4 -f image2 -vframes 1 -ss 1.0 frame.png && sha256sum frame.png
```

## Further reading

- Note 05 — five-stage producer pipeline (PSNR after mux)
- Cheatsheet 03 — how Chrome flags affect baseline determinism
