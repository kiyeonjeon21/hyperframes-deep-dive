# 03-core-runtime-adapters

> The core runtime turns an authored HTML page into a seekable composition. It
> creates the browser globals that hosts depend on, discovers animation/media
> surfaces, and dispatches deterministic time to adapters.

## 1. Two adapter kinds

Do not conflate these two APIs.

| Adapter | Location | Who uses it | Purpose |
|---|---|---|---|
| `FrameAdapter` | `packages/core/src/adapters/` | public helper surface | library authors can model init/duration/seek/destroy semantics |
| `RuntimeDeterministicAdapter` | `packages/core/src/runtime/adapters/` | runtime bootstrap | built-in deterministic seek/play/pause/revert implementations |

The runtime does not auto-collect arbitrary user `FrameAdapter` instances. Real
render/preview integration currently means adding or using a runtime adapter.

## 2. Runtime bootstrap

Start with:

- `packages/core/src/runtime/entry.ts`
- `packages/core/src/runtime/init.ts`
- `packages/core/src/runtime/types.ts`
- `packages/core/src/runtime/window.d.ts`

The runtime performs three jobs:

1. establish globals early enough for authored scripts
2. discover timelines/media/adapters after the DOM is available
3. expose a PlayerAPI-style bridge for hosts

Core globals:

```ts
window.__timelines = window.__timelines || {};
window.__hyperframes = {
  fitTextFontSize,
  getVariables,
}
window.__player = createPlayerApiCompat(...)
window.__hf = { duration, seek, media, transitions }
```

## 3. PlayerAPI compatibility wrapper

`window.__player` is the interactive surface used by the player and Studio. It
wraps the runtime's current composition state and supports:

- play/pause/seek
- render-time seek path (`renderSeek`)
- duration/time queries
- element selection and mutation helpers
- media sync
- timeline and composition inspection

Producer render mode ultimately needs deterministic `__hf.seek(t)`, but Studio
mostly talks to `__player` when it is available.

## 4. Runtime deterministic adapters

Read `packages/core/src/runtime/adapters/`.

| Adapter | Discovery/contract | Seek strategy |
|---|---|---|
| GSAP | `window.__timelines` | call timeline `time/seek`, pause after seek |
| CSS animations | DOM computed styles | set animation play state/current time equivalents |
| anime.js | `anime.running` and optional `window.__hfAnime` | pause and seek instances |
| Lottie | `window.__hfLottie` and lottie runtime state | `goToAndStop` / frame conversion |
| Three.js | `window.__hfThreeTime` + seek event | author render loop reads deterministic time |
| WAAPI | discovered animations | set `currentTime` / pause |
| TypeGPU/WebGPU | `window.__hfTypegpuTime` + `hf-seek` event | author render loop updates GPU uniforms |

The TypeGPU adapter is intentionally minimal because WebGPU pipelines are not
externally introspectable. It dispatches time and leaves pipeline ownership to
the composition.

## 5. Seek dispatch pattern

The cross-library invariant is:

```text
runtime receives t
  -> clamp/normalize t
  -> update runtime state
  -> ask each adapter to seek
  -> sync media
  -> update globals/events for host tools
```

Adapters should not let wall-clock playback keep advancing after a deterministic
seek. When a library has autoplay behavior, the adapter must pause or force a
single-frame render.

## 6. `__timelines` registry

`window.__timelines` remains the most important authored-script contract for
GSAP compositions:

```js
window.__timelines = window.__timelines || {};
window.__timelines["my-composition-id"] = tl;
```

The key must match `data-composition-id`. This is validated by linter rules and
relied on by:

- runtime bootstrap
- player direct-timeline fallback
- Studio timeline discovery
- producer/browser readiness checks
- sub-composition scoping

## 7. Variables in runtime

Runtime-side variable resolution is intentionally simple:

```js
const vars = window.__hyperframes.getVariables();
```

Top-level variables:

```text
data-composition-variables defaults + window.__hfVariables
```

Sub-composition variables:

```text
compiled/scoped defaults + data-variable-values -> window.__hfVariablesByComp
```

The runtime returns values; author code applies them to DOM, CSS variables, media
`src`, or timing attributes.

## 8. Picker/manual edit bridge

The picker runtime lives in core, while Studio uses hooks/components around it.
The bridge is intentionally global/postMessage-friendly:

- runtime exposes picker operations through `window.__HF_PICKER_API`
- Studio tracks hover/selection/manual edit state
- source patches are committed through Studio file APIs

This is part of why the Studio needs same-origin iframe access in local preview.

## 9. Runtime vs render-mode host

Preview/Studio:

- real clock
- direct player operations
- native media feedback
- UI-driven selection/editing

Render:

- virtualized time
- host calls `window.__hf.seek(t)`
- media frames are injected/pre-extracted
- output is captured by engine

The runtime must support both without letting preview-only behavior pollute
deterministic frames.

## 10. How to add a runtime adapter

1. Implement `RuntimeDeterministicAdapter` under `runtime/adapters/`.
2. Define a discovery contract that is cheap and deterministic.
3. Ensure `seek` is idempotent and pauses autoplay.
4. Wire the adapter into runtime initialization.
5. Add tests for discovery, seek, pause/play, and teardown.
6. Add linter/docs guidance if authors must include a CDN script or global.
7. Add a minimal composition fixture if preview/render parity can regress.

For public helper ergonomics, consider also adding a `FrameAdapter` helper under
`packages/core/src/adapters/`, but do not assume that alone makes the runtime use
the adapter.

## 11. Next

Continue with [04-engine-capture.md](04-engine-capture.md), which shows how the
producer/engine drive this runtime from outside the page.
