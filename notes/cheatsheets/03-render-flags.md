# cheatsheet/03 - Render flags and capture modes

## Output formats

| Format | Notes |
|---|---|
| `mp4` | default opaque output; HDR-capable path |
| `webm` | VP9 alpha-capable; forces screenshot and SDR |
| `mov` | ProRes 4444 alpha/editor ingest; forces screenshot and SDR |
| `png-sequence` | RGBA frames; forces screenshot and SDR |

## Capture mode decision

Screenshot mode can be forced by:

- config/CLI
- alpha output
- compiler render-mode hints
- BeginFrame probe failure
- unsupported platform/browser

BeginFrame is preferred when available because it gives tighter compositor timing.
Screenshot fallback is more portable and required for alpha.

## Exact FPS

Accepted:

```bash
--fps 30
--fps 30000/1001
```

Rejected:

```bash
--fps 29.97
```

Use exact rationals for NTSC-like rates.

## Supersampling / 4K

`--output-resolution` uses Chrome `deviceScaleFactor`:

```bash
hyperframes render --output-resolution 4k -o out.mp4
hyperframes lambda render ./project --output-resolution landscape-4k --wait
```

The authored composition dimensions remain unchanged. The output dimensions are
composition dimensions multiplied by the resolved scale factor.

## Variables

```bash
hyperframes render --variables '{"title":"Hello"}' -o out.mp4
hyperframes render --variables-file vars.json --strict-variables -o out.mp4
```

Lambda mirrors this:

```bash
hyperframes lambda render ./template --variables-file vars.json --wait
```

## Debug commands

```bash
# Force single local worker to isolate parallelism issues
hyperframes render --workers 1 --debug -o out.mp4

# Transparent output
hyperframes render --format webm -o overlay.webm
hyperframes render --format png-sequence -o frames/

# HDR decisions
hyperframes render --hdr -o hdr.mp4
hyperframes render --sdr -o sdr.mp4

# Lambda progress/cost
hyperframes lambda progress <render-id-or-execution-arn>
```

## Source search

```bash
rg "forceScreenshot|captureMode|beginFrame" packages/engine/src packages/producer/src
rg "outputResolution|deviceScaleFactor" packages/producer/src packages/cli/src
rg "parseFps|fpsToFfmpegArg" packages/core/src packages/cli/src
```

## Related

- [../04-engine-capture.md](../04-engine-capture.md)
- [../05-producer-pipeline.md](../05-producer-pipeline.md)
- [../11-aws-lambda-distributed.md](../11-aws-lambda-distributed.md)
