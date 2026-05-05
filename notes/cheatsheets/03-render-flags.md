# cheatsheet/03 — Render flags & GPU encoder

> Chrome flag meanings, BeginFrame debugging, GPU encoder autodetection.

## BeginFrame-only Chrome flags (9)

`packages/engine/src/services/browserManager.ts:84-94`. All for deterministic rendering. **Must be stripped in screenshot fallback** or captures can be empty.

| flag | Meaning |
|---|---|
| `--deterministic-mode` | Chrome deterministic mode (fixed RNG seeds, etc.) |
| `--enable-begin-frame-control` | Enable `HeadlessExperimental.beginFrame` CDP |
| `--disable-new-content-rendering-timeout` | Disable render timeouts (external BeginFrame pacing) |
| `--run-all-compositor-stages-before-draw` | Run full compositor pipeline before draw |
| `--disable-threaded-animation` | Animations on main thread only |
| `--disable-threaded-scrolling` | Same for scrolling |
| `--disable-checker-imaging` | Disable partial image decode |
| `--disable-image-animation-resync` | Disable GIF/APNG automatic resync |
| `--enable-surface-synchronization` | Force surface sync |

## Strip conditions

`packages/engine/src/services/browserManager.ts`:
- `process.platform !== 'linux'` — BeginFrame less reliable off Linux
- `forceScreenshot` config true
- BeginFrame probe fails (chrome-headless-shell missing the method)

When stripped, **screenshot mode** falls back to `Page.captureScreenshot` CDP — weaker determinism (rAF/setTimeout timing), but works.

## BeginFrame probe (115–137)

Once per browser acquire:

```ts
await client.send("HeadlessExperimental.beginFrame", {
  frameTimeTicks: 1, interval: 16, noDisplayUpdates: true
});
```

2s timeout; on failure cache `{ supportsBeginFrame: false }`. Workers then use screenshot mode.

## GPU encoder autodetection

Near `detectGpuEncoder()` in `packages/engine/src/services/streamingEncoder.ts`:
- macOS: `videotoolbox` (`h264_videotoolbox`, `hevc_videotoolbox`)
- Linux NVIDIA: `nvenc` (`h264_nvenc`, `hevc_nvenc`)
- Linux AMD: `vaapi`
- Default: libx264 (CPU)

CRF mapping:
- `--quality draft`: x264 CRF 28
- `--quality standard`: x264 CRF 23
- `--quality high`: x264 CRF 18

## HDR color metadata

`packages/engine/src/services/chunkEncoder.ts:196-220`:
- SDR: `bt709` throughout
- PQ HDR (HEVC Main10): `bt2020` primaries + `smpte2084` transfer + `bt2020nc` matrix
- HLG HDR: `bt2020` primaries + `arib-std-b67` transfer + `bt2020nc` matrix

## Debug commands

```bash
# Force single worker (isolate parallelism issues)
hyperframes render --workers 1

# Force screenshot mode (suspect BeginFrame)
HYPERFRAMES_FORCE_SCREENSHOT=1 hyperframes render

# Verbose ffmpeg logs
HYPERFRAMES_FFMPEG_LOG=verbose hyperframes render

# External Chrome binary
PRODUCER_HEADLESS_SHELL_PATH=/path/to/chrome-headless-shell hyperframes render

# Deterministic render aligned with CI
hyperframes render --docker
```

(Confirm env var names via grep in `engine/services/browserManager.ts`, `streamingEncoder.ts`, etc.)

## Further reading

- Note 04 — `frameCapture` `initializeSession` BeginFrame warmup loop
- Cheatsheet 04 — why Docker baseline is mandatory (chrome-headless-shell drift)
