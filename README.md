# hyperframe-deep-dive

Unofficial study workspace for deep-diving HyperFrames internals. The notes track the
local upstream checkout at:

- Source checkout: `/Users/kiyeonjeon/dev/oss/hyperframes`
- Upstream repo: <https://github.com/heygen-com/hyperframes>
- Public docs: <https://hyperframes.mintlify.app/introduction>
- Current study baseline: `@hyperframes/*` package version `0.6.61`, commit
  `a5f3b5b2`, branch `feat/registry-news-ticker-preview`

This repository contains study notes and small PoC exercises. It is not an upstream
HyperFrames package.

## Where to start

First time: start with [notes/01-architecture-overview.md](notes/01-architecture-overview.md),
then read the package notes in dependency order.

Quick entry by goal:

| Goal | Entry path |
|---|---|
| Understand the whole system | [note 01](notes/01-architecture-overview.md) -> [note 05](notes/05-producer-pipeline.md) -> [note 11](notes/11-aws-lambda-distributed.md) |
| Author HTML compositions | [note 02](notes/02-core-types-parsers.md) -> [note 12](notes/12-variables-templates.md) -> [cheatsheet/02](notes/cheatsheets/02-runtime-contract.md) |
| Add or reason about runtime adapters | [cheatsheet/01](notes/cheatsheets/01-frame-adapter.md) -> [note 03](notes/03-core-runtime-adapters.md) -> [PoC 01](projects/01-frame-adapter-poc/) |
| Debug deterministic rendering | [note 04](notes/04-engine-capture.md) -> [note 05](notes/05-producer-pipeline.md) -> [cheatsheet/03](notes/cheatsheets/03-render-flags.md) |
| Understand Lambda/distributed rendering | [note 11](notes/11-aws-lambda-distributed.md) -> upstream `docs/deploy/aws-lambda.mdx` |
| Understand Studio/player editing | [note 07](notes/07-studio-player.md) -> [note 09](notes/09-studio-editing.md) -> [note 10](notes/10-studio-captions-picker.md) |
| Understand shader transitions | [note 08](notes/08-shader-transitions.md) -> [PoC 02](projects/02-shader-transition-poc/) |
| Understand AI-agent and catalog workflows | [note 13](notes/13-agent-catalog-docs.md) |

## Directory layout

```text
hyperframe-deep-dive/
├── README.md
├── notes/
│   ├── 01-architecture-overview.md      # package graph + render/preview/deploy maps
│   ├── 02-core-types-parsers.md         # core types, parser, compiler-facing APIs, linter
│   ├── 03-core-runtime-adapters.md      # runtime bootstrap + deterministic adapters
│   ├── 04-engine-capture.md             # Chrome, BeginFrame, screenshot fallback, FFmpeg
│   ├── 05-producer-pipeline.md          # staged local render pipeline
│   ├── 06-cli-orchestration.md          # citty CLI, 29 root commands, deploy/auth/cloud
│   ├── 07-studio-player.md              # player web component + Studio playback bridge
│   ├── 08-shader-transitions.md         # WebGL shaders + engine compositing
│   ├── 09-studio-editing.md             # Studio shell, file/code/edit panels, DOM edits
│   ├── 10-studio-captions-picker.md     # captions + picker/manual editing surfaces
│   ├── 11-aws-lambda-distributed.md     # distributed primitives + AWS Lambda adapter
│   ├── 12-variables-templates.md        # composition variables + template rendering
│   ├── 13-agent-catalog-docs.md         # skills, registry/catalog, MCP, website-to-video
│   ├── lint-rules.md                    # linter rule catalog
│   ├── file-refs-audit.md               # reference audit log
│   └── cheatsheets/
│       ├── 01-frame-adapter.md
│       ├── 02-runtime-contract.md
│       ├── 03-render-flags.md
│       └── 04-regression-testing.md
└── projects/
    ├── 01-frame-adapter-poc/
    └── 02-shader-transition-poc/
```

## Package map

HyperFrames is now best read as eight packages plus registry/docs/skills content:

| Package | One-line responsibility | Start here |
|---|---|---|
| `@hyperframes/core` | Shared types, HTML parsing, compiler helpers, linter, runtime, variables, registry schema | `packages/core/src/index.ts` |
| `@hyperframes/engine` | Browser lifecycle, deterministic capture, video/audio extraction, FFmpeg helpers, HDR/shader utilities | `packages/engine/src/index.ts` |
| `@hyperframes/producer` | Local render orchestration plus distributed render primitives | `packages/producer/src/services/renderOrchestrator.ts`, `packages/producer/src/distributed.ts` |
| `@hyperframes/aws-lambda` | Lambda handler, Step Functions event types, S3 transport, SDK, CDK construct | `packages/aws-lambda/src/index.ts` |
| `@hyperframes/cli` | `hyperframes` command surface, lazy subcommands, telemetry/update/auth/deploy glue | `packages/cli/src/cli.ts` |
| `@hyperframes/player` | `<hyperframes-player>` custom element, iframe runtime injection, controls, direct timeline fallback | `packages/player/src/hyperframes-player.ts` |
| `@hyperframes/studio` | React Studio, NLE layout, file manager, DOM/manual editing, captions, render queue | `packages/studio/src/App.tsx` |
| `@hyperframes/shader-transitions` | WebGL preview transitions, snapshot cache, CSS fallback, render-mode metadata | `packages/shader-transitions/src/hyper-shader.ts` |

## Learning order

Read in dependency order. Each note is a learning map, not a replacement for the source.

- [x] 01 - architecture overview: package graph, local vs distributed render, public docs map
- [x] 02 - core types/parsers: exact FPS, variables, linter modules, registry types
- [x] 03 - runtime/adapters: `window.__hf`, PlayerAPI, GSAP/CSS/anime/Lottie/Three/WAAPI/TypeGPU
- [x] 04 - engine capture: Chrome mode selection, BeginFrame, screenshot fallback, alpha/HDR helpers
- [x] 05 - producer pipeline: staged local render flow, probe/extract/audio/capture/encode/assemble
- [x] 06 - CLI orchestration: 29 lazy root commands, grouped help, auth/cloud/lambda surfaces
- [x] 07 - Studio/player bridge: player custom element, direct timeline fallback, iframe bridge
- [x] 08 - shader transitions: 14 package shaders, 15 engine transitions, preview snapshot cache
- [x] 09 - Studio editing: app shell, file manager, source editor, DOM edit/session split
- [x] 10 - captions/picker: caption store/UI/sync and manual editing/picker hooks
- [x] 11 - AWS Lambda/distributed: `plan -> renderChunk -> assemble`, SAM/CDK/SDK/CLI
- [x] 12 - variables/templates: declaration, runtime resolution, validation, Lambda batches
- [x] 13 - agent/catalog/docs: skills, registry, website capture, MCP/cloud product boundary

## Current architecture in one pass

```text
Author HTML
  -> core compile/bundle/lint/runtime injection
  -> producer local pipeline
     compile -> browser probe -> extract videos -> mix audio -> capture -> encode -> assemble
  -> engine services
     Chrome + virtual time + BeginFrame/screenshot + FFmpeg
  -> output
     mp4 / webm / mov / png-sequence
```

Distributed rendering splits the same work into pure primitives:

```text
plan(projectDir, config, planDir)
  -> frozen compiled HTML + extracted assets + audio + encoder/chunk metadata + planHash

renderChunk(planDir, chunkIndex, output)
  -> deterministic capture/encode for one frame slice

assemble(planDir, chunkPaths, audio, output)
  -> final mux/concat/copy or CFR re-encode
```

`@hyperframes/aws-lambda` is an adapter around those primitives. It adds S3 transport,
Step Functions orchestration, a Lambda handler, SDK helpers, and CLI deployment verbs.

## Deterministic contract

The central idea is unchanged: the composition page must expose seekable time.

```ts
window.__hf = {
  duration: number,
  seek(timeSeconds: number): void,
  media?: HfMediaElement[],
  transitions?: HfTransitionMeta[],
}
```

Important adjacent globals in the current version:

```ts
window.__HF_VIRTUAL_TIME__      // fake Date/performance/timers/rAF during render
window.__player                 // interactive PlayerAPI used by player/studio
window.__timelines              // GSAP timeline registry by composition id
window.__hyperframes            // runtime helpers such as getVariables() and fitTextFontSize()
window.__hfVariables            // top-level render-time variable overrides
window.__hfVariablesByComp      // scoped sub-composition variable overrides
window.__hfAnime                // optional anime.js instance registry
window.__hfLottie               // optional Lottie instance registry
window.__hfThreeTime            // Three.js seek time
window.__hfTypegpuTime          // TypeGPU/WebGPU seek time
window.__HF_PICKER_API          // picker/manual edit bridge
```

If the page implements this contract, local render, player preview, Studio editing,
and distributed chunk workers can all drive the same source.

## Reading workflow

```bash
export HYPERFRAMES_REPO=/Users/kiyeonjeon/dev/oss/hyperframes

# Fast file search
rg "window.__hf" "$HYPERFRAMES_REPO/packages"
rg "plan\\(" "$HYPERFRAMES_REPO/packages/producer/src"
rg "lambda" "$HYPERFRAMES_REPO/packages/cli/src/commands"

# Source entrypoints
code "$HYPERFRAMES_REPO/packages/core/src/runtime/init.ts"
code "$HYPERFRAMES_REPO/packages/producer/src/distributed.ts"
code "$HYPERFRAMES_REPO/packages/aws-lambda/src/index.ts"
```

Useful upstream docs to keep open:

- `docs/introduction.mdx`
- `docs/concepts/variables.mdx`
- `docs/guides/rendering.mdx`
- `docs/deploy/aws-lambda.mdx`
- `docs/deploy/templates-on-lambda.mdx`
- `docs/guides/mcp.mdx`
- `docs/guides/website-to-video.mdx`

## PoCs

The PoCs remain hands-on exercises. They are intentionally not pre-solved.

### `projects/01-frame-adapter-poc`

Wire a Framer Motion-style adapter into the deterministic seek contract.

```bash
cd projects/01-frame-adapter-poc
bun install
bun test
```

### `projects/02-shader-transition-poc`

Implement a `pixel-dissolve` transition and align the JS/rgb48le side with the
GLSL mental model.

```bash
cd projects/02-shader-transition-poc
bun install
bun test
```

## Progress notes

- Started: 2026-05-05
- Original baseline: HyperFrames v0.4.45 (`a57d63b5`)
- Refreshed baseline: HyperFrames v0.6.61 (`a5f3b5b2`)
- Refresh focus: docs-as-learning-roadmap, not upstream code changes
