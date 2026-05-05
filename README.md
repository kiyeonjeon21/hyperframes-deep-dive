# hyperframe-deep-dive

Unofficial study workspace for deep-diving Hyperframes: seven packages (`core`, `engine`, `producer`, `cli`, `studio`, `player`, `shader-transitions`) and how they work internally.

> Upstream project: <https://github.com/heygen-com/hyperframes> (Apache 2.0)
> Source checkout for commands below: set `HYPERFRAMES_REPO=/path/to/hyperframes`
> This repository contains study notes and PoC exercises; it is not an upstream Hyperframes package.

## Where to start

**First time** → [`notes/01-architecture-overview.md`](notes/01-architecture-overview.md) (big picture + three mermaid diagrams + map into the notes) → then the learning order below.

**Quick entry by goal**:

| Goal | Entry path |
|---|---|
| Add a new frame adapter | [cheatsheet/01](notes/cheatsheets/01-frame-adapter.md) → [note 03](notes/03-core-runtime-adapters.md) → [PoC 01 track A](projects/01-frame-adapter-poc/) |
| Add a new shader transition | [note 08](notes/08-shader-transitions.md) → [PoC 02 track A](projects/02-shader-transition-poc/) |
| Debug determinism | [cheatsheet/03](notes/cheatsheets/03-render-flags.md) + [cheatsheet/04](notes/cheatsheets/04-regression-testing.md) + [note 04](notes/04-engine-capture.md) |
| Quick `window.*` contract reference | [cheatsheet/02](notes/cheatsheets/02-runtime-contract.md) (includes devtools snippets) |
| Understand HDR rendering | [note 05 §4.7 + open items 4](notes/05-producer-pipeline.md) (HLG pass-through note) |
| Studio internals (editing + captions) | [note 07](notes/07-studio-player.md) → [note 09](notes/09-studio-editing.md) → [note 10](notes/10-studio-captions-picker.md) |
| Full lint rule catalog (60 rules) | [`notes/lint-rules.md`](notes/lint-rules.md) |
| Note `file:line` reference accuracy | [`notes/file-refs-audit.md`](notes/file-refs-audit.md) |

**Reading upstream source**:
```bash
export HYPERFRAMES_REPO=/path/to/hyperframes

# VS Code: cmd-click for file:line jumps
code "$HYPERFRAMES_REPO/packages/core/src/runtime/init.ts:24"

# Quick search (ripgrep)
rg "FrameAdapter" "$HYPERFRAMES_REPO/packages"

# devtools console (after preview — see cheatsheet/02)
const fr = document.querySelector('hyperframes-player').iframeElement.contentWindow;
fr.__hf.duration; fr.__hf.seek(2.5); fr.__player; fr.__timelines;
```

## Directory layout

```
hyperframe-deep-dive/
├── README.md                           ← this file (checklist + package map)
├── notes/
│   ├── 01-architecture-overview.md     ← big picture — start here
│   ├── 02-core-types-parsers.md        ← core: types / parsers / generators / linter
│   ├── 03-core-runtime-adapters.md     ← core: runtime + frame adapters
│   ├── 04-engine-capture.md            ← engine: BeginFrame + FFmpeg
│   ├── 05-producer-pipeline.md         ← producer: HDR multi-pass + audio + regression tests
│   ├── 06-cli-orchestration.md         ← cli: citty + 24 commands
│   ├── 07-studio-player.md             ← player + iframe bridge
│   ├── 08-shader-transitions.md        ← WebGL: 14 shaders (engine TRANSITIONS has 15)
│   ├── 09-studio-editing.md            ← studio: App.tsx + Timeline + files + render queue
│   ├── 10-studio-captions-picker.md    ← studio: caption subsystem + element picker
│   ├── lint-rules.md                   ← full catalog of 60 lint rules
│   ├── file-refs-audit.md              ← automated check log for note file:line refs
│   └── cheatsheets/
│       ├── 01-frame-adapter.md         ← how to add an adapter (7 steps)
│       ├── 02-runtime-contract.md      ← window.__hf etc. + devtools commands
│       ├── 03-render-flags.md         ← Chrome flags / GPU encoder
│       └── 04-regression-testing.md    ← Docker baseline / PSNR / audio
└── projects/
    ├── 01-frame-adapter-poc/           ← hands-on adapter exercise
    └── 02-shader-transition-poc/       ← hands-on shader exercise
```

## Package map

One-line definition per package + a single must-read file.

| Package | One line | Must-read |
|---|---|---|
| `@hyperframes/core` | Types / parsers / linter / runtime — the foundation | `packages/core/src/index.ts` (192 lines, export map) |
| `@hyperframes/engine` | Puppeteer + BeginFrame + FFmpeg capture | `packages/engine/src/services/frameCapture.ts` |
| `@hyperframes/producer` | Orchestration on top of engine (HDR / audio / regression) | `packages/producer/src/services/renderOrchestrator.ts` |
| `@hyperframes/cli` | citty-based entry with 24 commands | `packages/cli/src/cli.ts` (124 lines) |
| `@hyperframes/studio` | NLE editor on React + Zustand + Motion | `packages/studio/src/player/hooks/useTimelinePlayer.ts` |
| `@hyperframes/player` | `<hyperframes-player>` vanilla web component | `packages/player/src/hyperframes-player.ts` |
| `@hyperframes/shader-transitions` | 14 WebGL transition shaders + GSAP driver (engine TRANSITIONS has 15 — only `crossfade` is engine-only) | `packages/shader-transitions/src/hyper-shader.ts` |

## Learning order (checklist)

Read in dependency order: open each note’s **must-read** source, then read the note body.

**Phase B (note bodies) — done ✓**. All notes + four cheatsheets are filled in.
Next: verify notes against `file:line` in upstream + work through `projects/` PoCs.

- [x] **01-architecture-overview** — package graph, `render` / `preview` traces, runtime contract
- [x] **02-core-types-parsers** — `core.types.ts` (390 lines) type hub / DOMParser HTML / regex GSAP / six linter modules
- [x] **03-core-runtime-adapters** — `runtime/init.ts` (1767 lines) bootstrap / two adapter kinds / six RuntimeDeterministicAdapter comparison
- [x] **04-engine-capture** — `browserManager` nine Chrome flags + BeginFrame probe / `frameCapture` / `streamingEncoder` FrameReorderBuffer / `parallelCoordinator` constraints
- [x] **05-producer-pipeline** — `renderOrchestrator` five stages / `fileServer` VIRTUAL_TIME_SHIM (95 lines) / HDR multi-pass / `regression-harness` PSNR + audio correlation
- [x] **06-cli-orchestration** — citty + lazy load / 24 commands / `render` · `preview` · `validate` / `help.ts` grouping
- [x] **07-studio-player** — vanilla web component (1023 lines) + audio proxy / iframe ↔ React bridge / Zustand + `liveTime` pub-sub
- [x] **08-shader-transitions** — `registry.ts` 14 shaders / two-mode init (WebGL vs `tl.set` only) / handoff to engine composite

Cheatsheets — quick references while learning (all written):

- [x] **cheatsheets/01-frame-adapter** — seven steps to add an adapter
- [x] **cheatsheets/02-runtime-contract** — single-page `window.*` + devtools
- [x] **cheatsheets/03-render-flags** — Chrome flags / BeginFrame debug / GPU encoder
- [x] **cheatsheets/04-regression-testing** — Docker baseline / PSNR / audio correlation

## Remotion → Hyperframes mapping

If you know Remotion, use this table to map concepts quickly.

| Remotion | Hyperframes | Notes |
|---|---|---|
| `<Composition>` (React) | `<div id="stage" data-composition-id ...>` (HTML + data attrs) | Core choice: HTML-first |
| `useCurrentFrame()` | `window.__hf.seek(time)` + GSAP timeline or CSS `animation-currentTime` | Adapters bridge libraries |
| Remotion Player (React) | `<hyperframes-player>` (vanilla, iframe isolation) | Two builds: ESM + global |
| Remotion Studio | hyperframes Studio (React + Motion + Zustand, Tailwind v3) | Studio pokes iframe runtime globals directly |
| `<TransitionSeries>` | `@hyperframes/shader-transitions` (WebGL + GSAP) | 14 declarative shaders (15 in engine composite) |
| Lambda distributed render | (none) — workers are local processes / Docker | `parallelCoordinator` schedules work |
| `delayRender()` / `continueRender()` | `pollPageExpression(window.__hf)` | Page signals readiness |
| BeginFrame pattern (Remotion-inspired) | `HeadlessExperimental.beginFrame` + virtual time shim | Same family; attribution comments in engine |
| image2pipe streaming (Remotion) | `streamingEncoder.ts` (FFmpeg stdin + reorder buffer) | Same pattern |

## Deterministic contract (`window.*` namespace)

Contract between the composition page and hosts (engine / producer / player / studio). This is the spine of Hyperframes.

```ts
// 1. Time — producer calls; page implements
window.__hf = {
  duration: number,
  seek(timeSeconds: number): void,           // deterministic visual state
  media?: HfMediaElement[],
  transitions?: HfTransitionMeta[],
}

// 2. Virtual time — injected by fileServer; consumed by runtime
window.__HF_VIRTUAL_TIME__ = {
  seekToTime(ms: number): number,            // fake Date.now / perf.now / timers / rAF
}

// 3. Player (interactive) — runtime exposes; studio/player call
window.__player = {
  seek, play, pause, addElement, removeElement, ...  // PlayerAPI 43-method compat
}

// 4. GSAP timeline registry — one per composition id
window.__timelines = { [compositionId]: gsap.timeline() }

// 5. Text measurement helper
window.__hyperframes = {
  fitTextFontSize(text, { maxWidth, baseFontSize, minFontSize, fontWeight, fontFamily, step })
}

// 6. Adapter hooks (runtime auto-discovery)
window.__hfAnime = []            // anime.js instances
window.__hfLottie = []           // Lottie instances
window.__hfThreeTime = number    // Three.js time

// 7. Studio / player helpers
window.__clipManifest            // runtime timeline payload cache
window.__playerReady             // runtime bootstrap complete
window.__renderReady             // render readiness flag
window.__HF_PICKER_API           // element picker imperative API
```

**Why it matters**: the whole system rests on one idea — if the page inside the iframe implements this contract, any host can drive the composition in both deterministic render mode and interactive mode.

## Reading workflow

```bash
export HYPERFRAMES_REPO=/path/to/hyperframes

# Jump to file:line — VS Code “Go to File” or Cursor:
code "$HYPERFRAMES_REPO/packages/core/src/runtime/init.ts:24"

# Search — prefer ripgrep
rg "FrameAdapter" "$HYPERFRAMES_REPO/packages"

# Follow call paths
rg "window.__hf" "$HYPERFRAMES_REPO/packages"

# See it run (separate terminal)
cd "$HYPERFRAMES_REPO" && bun install && bun run build
cd /path/to/test-project && npx hyperframes preview --dir .
# In devtools: inspect window.__hf, window.__player
```

> Treat the upstream checkout as read-only while using these notes. Keep experiments in a separate scratch directory outside this repo unless a PoC explicitly says otherwise.

## Phase C — PoCs (hands-on)

Reading alone does not internalize the notes. Two PoCs let you **own** determinism and the contract in your own code.

### projects/01-frame-adapter-poc

> Wire Framer Motion `animate()` into Hyperframes’ deterministic time contract; also explore the gap between public `FrameAdapter` and internal `RuntimeDeterministicAdapter`.

Two tracks:
- **Track A (in this repo, ~30–60 min)**: `bun test` with mocks — learn adapter logic without a full Hyperframes install.
- **Track B (1–3 h, needs environment)**: real Hyperframes project + preview/render determinism.

```bash
# Track A — start here:
cd projects/01-frame-adapter-poc
bun install && bun test       # reference impl should pass 20 tests
```

- [ ] **Track A** Phases 1–3: fill four TODOs in the skeleton; pass all 20 tests with your code
- [ ] **Track B** Phases 1–7: environment setup → preview/render checks → extend note 03

Details: [`projects/01-frame-adapter-poc/README.md`](projects/01-frame-adapter-poc/README.md)

### projects/02-shader-transition-poc

> Add a `pixel-dissolve` transition and align **WebGL and Node** implementations so they look the same.

Two tracks:
- **Track A (in this repo, ~1–2 h)**: `bun test` — Node composite only; no WebGL required.
- **Track B (3–5 h, Hyperframes worktree)**: GLSL fragment shader + interactive demo + drift checks.

```bash
# Track A — start here:
cd projects/02-shader-transition-poc
bun install && bun test       # reference impl should pass 18 tests
```

- [ ] **Track A**: implement `pixel-dissolve.ts` skeleton (Buffer + rgb48le); pass 18 tests
- [ ] **Track B** Phases 1–8: GLSL + drift validation + extend note 08

Details: [`projects/02-shader-transition-poc/README.md`](projects/02-shader-transition-poc/README.md)

### Phase D — optional follow-ups

After both PoCs:
- Try other libraries (Theatre.js, popmotion) or shaders (e.g. paper-tear, ink-bleed)
- Patch inaccuracies you find back into these notes
- Add `notes/progress.md` (phase start/end, blockers, fixes)

## Progress notes

- Started: 2026-05-05
- Baseline: hyperframes v0.4.45 (`a57d63b5`, 2026-05-05 source snapshot)
- **Phase A** (skeleton + stubs) — done
- **Phase B** (ten notes + four cheatsheets) — done
- **Phase C** (two PoC skeletons + reference + 38 `bun` tests) — done
- **Phase D** (open items, mermaid, lint-rules, cross-links) — done
- **Phase F** (optional integrations) — done
- Total: ~9000+ lines, 38+ files
