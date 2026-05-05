# 03-core-runtime-adapters

> One-line summary: `entry.ts` (34 lines) exposes `__timelines` / `__hyperframes` *at script eval time*, and on DOMContentLoaded `init.ts` (1767 lines) bootstraps six deterministic adapters, a PlayerAPI wrapper, media sync, and the composition loader. The heart of determinism.

---

## 1. Two adapter kinds — do not confuse them

The hyperframes codebase has **two adapter abstractions**. They expose different interfaces.

### A. `FrameAdapter` — external / public interface

`packages/core/src/adapters/types.ts:1-15` (15 lines)

```ts
interface FrameAdapterContext { compositionId, fps, width, height, rootElement? }

interface FrameAdapter {
  id: string;
  init?(ctx): Promise<void> | void;
  getDurationFrames(): number;
  seekFrame(frame: number): Promise<void> | void;
  destroy?(): Promise<void> | void;
}
```

- Exported from `index.ts:160-163` — **public API**
- Call unit: **frame number** (integer)
- Usage: today this is mainly public types/helpers. `createGSAPFrameAdapter` (`adapters/gsap.ts:18-44`, 44 lines) is the reference implementation; whether the runtime auto-registers it needs separate verification.

### B. `RuntimeDeterministicAdapter` — internal runtime

`packages/core/src/runtime/types.ts:228-235`

```ts
type RuntimeDeterministicAdapter = {
  name: string;
  discover: () => void;
  seek: (ctx: { time: number }) => void;   // ← seconds (not frames)
  pause: () => void;
  play?: () => void;
  revert?: () => void;
};
```

- **Not exported** — internal only
- Call unit: **time in seconds** (float, `ctx.time`)
- Usage: `init.ts` directly instantiates six adapters inside the composition page

### Differences at a glance

| | `FrameAdapter` (public) | `RuntimeDeterministicAdapter` (internal) |
|---|---|---|
| Location | `core/adapters/types.ts` | `core/runtime/types.ts` |
| Export | yes (`index.ts:161`) | no |
| Time unit | frame (integer) | time in seconds (float) |
| Lifecycle | init / destroy | discover / revert |
| Pause | (none) | pause / play |
| Who uses it | no direct callers in source today (public types/helpers) | sequenced inside `runtime/init.ts` |

**Practical relationship**: the public `FrameAdapter` is closer to exported types/GSAP helpers than to a runtime fan-out extension point; `RuntimeDeterministicAdapter` is the **actual internal interface** that seeks six libraries on the page. When `__hf.seek(time)` runs → the runtime fan-outs `seek({time})` on all six `RuntimeDeterministicAdapter` instances.

---

## 2. Bootstrap sequence

### 2.1 `entry.ts` (34 lines) — immediately on script eval (before DOMContentLoaded)

```ts
// 1. Create global timeline registry early (line 13)
window.__timelines = window.__timelines || {};

// 2. Expose text measurement util (line 17-19)
window.__hyperframes = { fitTextFontSize };

// 3. Call init when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapHyperframeRuntime, { once: true });
} else {
  bootstrapHyperframeRuntime();   // already ready (script arrived after async/defer)
}
```

**Why expose both globals before DOMContentLoaded?** Inline composition scripts may live in `<head>` / `<body>` and during evaluation they may call `window.__timelines` or `__hyperframes.fitTextFontSize`. Font measurement often happens during script eval (auto text sizing).

**Guard on `bootstrapHyperframeRuntime`**: runs once via `__hyperframeRuntimeBootstrapped`. Prevents re-entry when the same page triggers bootstrap multiple times in preview/render (e.g. a late-arriving module).

### 2.2 `initSandboxRuntimeModular()` inside `init.ts` — 1767 lines; first ~150 lines only


```ts
export function initSandboxRuntimeModular(): void {
  // 0. State + cleanup setup (24-32)
  const state = createRuntimeState();
  const runtimeWindow = window as Window & { __hfRuntimeTeardown?: ... };

  // 1. Run prior teardown (33-39) — cleanup on HMR / re-entry
  if (typeof runtimeWindow.__hfRuntimeTeardown === "function") {
    try { runtimeWindow.__hfRuntimeTeardown(); } catch { /* resilient */ }
  }

  // 2. Normalize page (44-53) — html/body margin:0, overflow:hidden
  //    closes "preview/render parity gap" — same normalization in both
  document.documentElement.style.margin = "0";
  document.documentElement.style.padding = "0";
  document.documentElement.style.overflow = "hidden";
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.overflow = "hidden";

  // 3. Reassert timeline registry (55)
  window.__timelines = window.__timelines || {};

  // 4. PlayerAPI compatibility wrapper (76-149) — detailed below
  const createPlayerApiCompat = (basePlayer) => ({ ...43-method compat wrapper... });

  // 5. Create six adapters (after imports 3-8; concrete code ~line 200+)
  //    createCssAdapter(), createGsapAdapter({ getTimeline }), createAnimeJsAdapter(),
  //    createLottieAdapter(), createThreeAdapter(), createWaapiAdapter()

  // 6. composition loader, picker, media sync, analytics, bridge, 1000+ more lines
}
```

**What modularization implies**: `init.ts:1-18` imports are effectively a **runtime module catalog**:

```ts
import { installRuntimeControlBridge, postRuntimeMessage } from "./bridge";       // postMessage
import { initRuntimeAnalytics, emitAnalyticsEvent } from "./analytics";           // outbound events
import { createCssAdapter } from "./adapters/css";                                // six adapters
import { createGsapAdapter } from "./adapters/gsap";
import { createAnimeJsAdapter } from "./adapters/animejs";
import { createLottieAdapter } from "./adapters/lottie";
import { createThreeAdapter } from "./adapters/three";
import { createWaapiAdapter } from "./adapters/waapi";
import { refreshRuntimeMediaCache, syncRuntimeMedia } from "./media";             // <video>/<audio>
import { createPickerModule } from "./picker";                                    // element pick UI
import { createRuntimePlayer } from "./player";                                   // internal player
import { createRuntimeState } from "./state";                                     // state object
import { collectRuntimeTimelinePayload } from "./timeline";                       // payload collection
import { createRuntimeStartTimeResolver } from "./startResolver";                 // start time
import { loadExternalCompositions, loadInlineTemplateCompositions } from "./compositionLoader";
import { applyCaptionOverrides } from "./captionOverrides";
```

Line counts per module (under `runtime/`):
- `init.ts`: 1767 (largest bootstrap)
- `timeline.ts`: 685 (timeline payload — studio in note 07)
- `compositionLoader.ts`: 390 (sub-composition load)
- `picker.ts`: 270 (element pick mode)
- `media.ts`: 224 (`<video>` / `<audio>` sync)
- `startResolver.ts`: 210 (start-time inference)
- `player.ts`: 188 (basic player)
- `captionOverrides.ts`: 171 (load-time caption overrides + wrapper reuse)
- `analytics.ts`: 126 (postMessage events)
- `bridge.ts`: 106 (postMessage control rx/tx)
- `state.ts`: 104 (runtime state factory)

---

## 3. PlayerAPI compatibility wrapper — `createPlayerApiCompat` (76-149)

Adapter defined in `init.ts:76-149`. **basePlayer** is the minimal player with seven methods (`runtime/player.ts:188`):

```ts
{
  _timeline: RuntimeTimelineLike | null,
  play, pause, seek, getTime, getDuration, isPlaying, renderSeek
}
```

Those seven are expanded into the full `PlayerAPI` (`core.types.ts:218-298`) with 43 methods. The seven core methods delegate; editing/inspection-style methods are mostly **noops** or return defaults.

```ts
return {
  play: basePlayer.play,                           // delegate
  pause: basePlayer.pause,
  seek: basePlayer.seek,
  // ...

  setElementPosition: () => {},                    // ← noop
  setElementScale: () => {},
  setElementFontSize: () => {},
  // ...
  addElement: () => false,                         // return false
  removeElement: () => false,
  // ...
  getStageZoom: () => defaultStageZoom,            // ← { 1, 960, 540 }
  getStageZoomKeyframes: () => emptyStageZoomKeyframes,
  getVisibleElements: () => emptyVisibleElements,
  getRenderState: () => ({ time: ..., duration: ..., isPlaying: ..., renderMode: false, timelineDirty: false }),

  renderSeek: basePlayer.renderSeek,               // delegate (engine calls for deterministic capture)
};
```

**Why noops?** Studio’s interactive mode wants a richer `PlayerAPI`, but deterministic render (producer) rarely calls these methods and must ignore them if it does. Trade-off: one interface for both modes.

**Observation**: the `__player` you see in Studio may not be this compat object but a **richer PlayerAPI built by Studio** — runtime `createPlayerApiCompat` is a *baseline* fallback; Studio may inject its own extensions. See note 07.

---

## 4. Six `RuntimeDeterministicAdapter` instances — pairwise comparison

Each adapter implements `name`, `discover`, `seek`, `pause`, `play?`, `revert?`. On `__hf.seek(time)`, `init.ts` calls every adapter’s `seek({time})` in sequence.

### 4.1 GSAP — 28 lines, simplest

`runtime/adapters/gsap.ts:7-28`

```ts
export function createGsapAdapter(deps: { getTimeline: () => RuntimeTimelineLike | null }) {
  return {
    name: "gsap",
    discover: () => {},                              // no auto-discovery; injected externally
    seek: (ctx) => {
      const timeline = deps.getTimeline();
      if (!timeline) return;
      timeline.pause();
      const safeTime = Math.max(0, Number(ctx.time) || 0);
      if (typeof timeline.totalTime === "function") {
        timeline.totalTime(safeTime, false);         // repeats/yoyo included
      } else {
        timeline.seek(safeTime, false);              // base duration only
      }
    },
    pause: () => deps.getTimeline()?.pause(),
  };
}
```

**Key choice**: prefer `totalTime`. With `repeat: 2, yoyo: true`, total time can be 6× base duration; seek against base duration only reaches the same wall-clock second but *loses which repetition*; `totalTime` preserves that.

### 4.2 CSS animations — 125 lines, most intricate adapter

`runtime/adapters/css.ts:69-125`

```ts
return {
  name: "css",
  discover: () => {
    entries = [];
    const all = document.querySelectorAll("*");                    // walk all elements
    for (const rawEl of all) {
      const style = window.getComputedStyle(rawEl);
      if (!style.animationName || style.animationName === "none") continue;
      entries.push({ el: rawEl, baseDelay: ..., basePlayState: ... });
    }
  },
  seek: (ctx) => {
    const time = Number(ctx.time) || 0;
    for (const entry of entries) {
      const start = params?.resolveStartSeconds?.(entry.el)
                 ?? Number.parseFloat(entry.el.getAttribute("data-start") ?? "0");
      const localTimeMs = Math.max(0, time - start) * 1000;
      const animations = getAnimationsForElement(entry.el);
      if (animations.length > 0) {
        seekAnimations(animations, localTimeMs);                   // WAAPI handles
        continue;
      }
      // fallback: negative animationDelay trick
      entry.el.style.animationPlayState = "paused";
      entry.el.style.animationDelay = `-${(localTimeMs / 1000).toFixed(3)}s`;
    }
  },
  pause / play / revert,
};
```

**Two-step strategy**:
1. Prefer `Element.getAnimations()` for WAAPI handles — set `currentTime` in ms directly.
2. If no handle (older browsers, some environments) use `animation-delay: -Ns` — shift delay so the animation *looks* N seconds in; `animation-play-state: paused` blocks real playback.

**Element-local time**: subtract each element’s `data-start` for a local timeline. If the element starts at 2s and composition time is 5s, local time is 3s.

**`restoreInlineStyles`** (56-67): on pause/play restore original inline styles from `baseDelay` / `basePlayState` captured in `discover`.

### 4.3 anime.js — 140 lines

`runtime/adapters/animejs.ts:44-119`

```ts
return {
  name: "animejs",
  discover: () => {
    const animeGlobal = window.anime;
    if (!animeGlobal?.running) return;
    const existing = window.__hfAnime ?? [];
    const existingSet = new Set(existing);
    for (const instance of animeGlobal.running) {
      if (!existingSet.has(instance)) existing.push(instance);
    }
    window.__hfAnime = existing;
  },
  seek: (ctx) => {
    const timeMs = Math.max(0, (Number(ctx.time) || 0) * 1000);
    const instances = window.__hfAnime;
    for (const instance of instances ?? []) {
      try { instance.seek?.(timeMs); } catch { /* ignore */ }
    }
  },
  pause / play / revert,
};
```

**Discovery pattern**: poll `anime.running` (the library’s active-instance list). Still captures instances even if the user forgets `__hfAnime.push(instance)`.

**Time unit**: anime.js uses ms → multiply seconds by 1000.

### 4.4 Lottie — 190 lines, two libraries unified

`runtime/adapters/lottie.ts:52-138`

```ts
seek: (ctx) => {
  const time = Math.max(0, Number(ctx.time) || 0);
  for (const anim of window.__hfLottie ?? []) {
    if (isLottieWebAnimation(anim)) {
      // lottie-web (classic): goToAndStop(value, isFrame)
      anim.goToAndStop(time * 1000, false);                        // false = ms
    } else if (isDotLottiePlayer(anim)) {
      if (typeof anim.setCurrentRawFrameValue === "function") {
        // dotlottie-web v2+
        const totalFrames = anim.totalFrames ?? 0;
        const fps = anim.frameRate ?? 30;
        const frame = time * fps;
        if (totalFrames > 0) anim.setCurrentRawFrameValue(Math.min(frame, totalFrames - 1));
      } else if (typeof anim.seek === "function") {
        // dotlottie-web v1
        const duration = anim.duration ?? 1;
        const percentage = Math.min(100, (time / duration) * 100);
        anim.seek(percentage);
      }
    }
  }
}
```

**Type-guard split** (142-157):
- `goToAndStop` → lottie-web
- `pause` + `totalFrames`/`duration` → dotlottie-web

**Three time representations**: lottie-web uses ms; dotlottie v2 uses frames; dotlottie v1 uses percentage. The adapter absorbs all three.

**discover** (56-77): auto-merge from `lottie.getRegisteredAnimations()` (lottie-web global API).

### 4.5 Three.js — 33 lines, most indirect

`runtime/adapters/three.ts:3-33`

```ts
return {
  name: "three",
  discover: () => {},                              // no auto-discovery
  seek: (ctx) => {
    forcedTime = Math.max(0, Number(ctx.time) || 0);
    lastForcedTime = forcedTime;
    window.__hfThreeTime = forcedTime;             // global only
    try {
      window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time: forcedTime } }));
    } catch { /* ignore */ }
  },
  pause / play / revert,
};
```

**Why not drive Three directly?** Three owns its own `requestAnimationFrame` loop and scene graph; the adapter cannot know every camera/mesh/material.

**Approach**: expose time (`__hfThreeTime`) + fire `hf-seek`. **Composition code listens**:

```js
// composition author code
window.addEventListener("hf-seek", (e) => {
  const t = e.detail.time;
  cameraGroup.rotation.y = t * 0.5;
  particleSystem.update(t);
  renderer.render(scene, camera);
});
```

**Ownership**: the Three.js scene is the author’s responsibility; hyperframes only supplies time — a clean split.

### 4.6 WAAPI — 34 lines

`runtime/adapters/waapi.ts:3-34`

```ts
return {
  name: "waapi",
  discover: () => {},
  seek: (ctx) => {
    if (!document.getAnimations) return;
    const timeMs = Math.max(0, (Number(ctx.time) || 0) * 1000);
    for (const animation of document.getAnimations()) {           // whole document
      try { animation.currentTime = timeMs; animation.pause(); } catch { /* ignore */ }
    }
  },
  pause: () => { document.getAnimations()?.forEach(a => { try { a.pause(); } catch {} }); },
};
```

**Difference from CSS adapter**: CSS uses per-element `getAnimations()`; WAAPI uses `document.getAnimations()` (global). Overlap is intentional: CSS applies *element-local* time (`time - start`); WAAPI applies *global* time as-is. JS-created WAAPI animations often use a global timeline; CSS animations often anchor to element start.

---

## 5. Adapter pattern comparison table

| Adapter | Lines | `discover()` | seek unit | auto-discover | pause | revert |
|---|---|---|---|---|---|---|
| GSAP | 28 | noop (external inject) | seconds | no | yes | no |
| CSS | 125 | scan `querySelectorAll("*")` | element-local ms | yes (computed style) | yes | yes (restore styles) |
| anime.js | 140 | poll `anime.running` | ms | yes | yes | no |
| Lottie | 190 | `lottie.getRegisteredAnimations()` | library-specific | yes | yes | no (instances owned by composition) |
| Three.js | 33 | noop | seconds (`__hfThreeTime`) | no | (keeps forcedTime) | yes |
| WAAPI | 34 | noop | global ms | (via `document.getAnimations`) | yes | no |

**Shared patterns**:
1. `try { ... } catch { /* ignore */ }` — swallow per-instance failures; keep processing others
2. Clamp negative time with `Math.max(0, ...)` consistently
3. `Number(ctx.time) || 0` — safe for NaN/undefined
4. Fallback paths (CSS `animationDelay` trick, two dotlottie versions)

---

## 6. Two paths for authors adding their own library

### Path A — internal adapter via PR

Add `runtime/adapters/<name>.ts`, implement `RuntimeDeterministicAdapter`, register in `init.ts:3-8`. Do not export from `index.ts`. See cheatsheet/01.

### Path B — external `FrameAdapter` is still “types / helper” level

```ts
import { createGSAPFrameAdapter, type FrameAdapter } from "@hyperframes/core";

const myAdapter: FrameAdapter = {
  id: "framer-motion",
  init: (ctx) => { /* ... */ },
  getDurationFrames: () => durationSec * ctx.fps,
  seekFrame: (frame) => {
    const t = frame / ctx.fps;
    motionControls.set({ time: t });
  },
};

// No auto-discovery registration hook in runtime/producer today.
```

**Verified (2026-05-05)**: no `__hfAdapters` global in source. `FrameAdapter` / `createGSAPFrameAdapter` are exported from `@hyperframes/core` and tested, but `runtime/init.ts`, producer, and the engine capture loop show no path that auto-collects user `FrameAdapter` instances. Wiring a new library into the real runtime today matches path A: add `runtime/adapters/<name>.ts`.

---

## 7. `__timelines` global registry

Initialized twice — `init.ts:55` and `entry.ts:13` — both idempotent via `||`.

Uses:
- Compositions populate directly: `window.__timelines["main"] = gsap.timeline({ paused: true })`
- Nested sub-compositions: one timeline per `compositionId`
- Studio scrubbing: `Object.values(window.__timelines).forEach(tl => tl.seek(t))`
- Linter rules: `missing_timeline_registry`, `timeline_id_mismatch` in `core.ts` (see note 02)

**Why a global?** Composition HTML runs *arbitrary* scripts; core cannot introspect them. The agreed global (`__timelines`) is the contract.

---

## 8. Surrounding modules — one line each

Non-adapter modules imported by `init.ts` (imports 1–18):

| Module | Lines | One-liner |
|---|---|---|
| `state.ts` | 104 | Runtime state object factory |
| `player.ts` | 188 | Minimal `RuntimePlayer` (7 methods) — extended by `createPlayerApiCompat` |
| `timeline.ts` | 685 | Timeline payload (`collectRuntimeTimelinePayload`) — clip/scene extraction for studio |
| `compositionLoader.ts` | 390 | External `<iframe>` + inline `<template>` composition load |
| `media.ts` | 224 | `<video>` / `<audio>` sync and cache |
| `picker.ts` | 270 | Element pick mode (studio click → identify element) |
| `bridge.ts` | 106 | Parent `postMessage` control rx/tx |
| `analytics.ts` | 126 | Emit `composition_loaded` / `played` / `seeked` |
| `captionOverrides.ts` | 171 | Apply caption override JSON at load time, reuse transform wrappers (recent commit 8d83d4f1) |
| `startResolver.ts` | 210 | Element start-time resolver factory (used by CSS adapter) |

How these assemble the 1767-line `init` is worth a diagram — out of scope for this note.

---

## 9. Compared to Remotion

| Aspect | Remotion | Hyperframes core/runtime |
|---|---|---|
| Time propagation | React context (`useCurrentFrame`) | Global `window.__hf.seek` + six-adapter fan-out |
| Adapters | Almost none (components take time) | Explicit `RuntimeDeterministicAdapter` per library |
| Pixel determinism | React tree + `delayRender` | Page pixels after adapter `seek()` |
| Multi-library | Awkward (each third party on its own) | Six standard adapters (CSS/GSAP/anime/Lottie/three/WAAPI) |

---

## 10. Tricky areas / verify

1. **Intent of the two adapter interfaces** — public `FrameAdapter` (frames) is mostly exported types/GSAP helper today; internal `RuntimeDeterministicAdapter` (seconds) actually drives preview/render fan-out. No auto bridge between them is visible in source.
2. **`discover()` patterns differ** — CSS may `querySelectorAll` each init; anime/Lottie poll globals; GSAP/three/WAAPI noop. Confirm call frequency (every seek vs once).
3. **PlayerAPI compat noop surface** — of 43 methods, playback/seek delegate; many edit/inspect methods are noop or defaults. Confirm studio really depends on `seek`/`getDuration`/`__clipManifest`/timeline payload (note 07).
4. ~~**`__hfRuntimeTeardown`**~~ — verified (2026-05-05): `init.ts:1764` **sets itself** (`runtimeWindow.__hfRuntimeTeardown = teardown`). One teardown per init registered globally; the *next* `initSandboxRuntimeModular()` (HMR/re-entry) runs it first (lines 33–39), then re-inits. Lines 1760–1761 are ref-equality guards — do not clear teardown if another init overwrote it. Core to preview hot-reload safety.
5. **Three.js `hf-seek` event** — in preview, autoplay must not run away; composition code should listen or only the first frame shows. Author responsibility.
6. **CSS adapter `data-start` dependency** — without `data-start`, element-local time equals global time. Confirm intended fallback vs bug.

---

## 11. Related notes

- ← [02 types/parsers](02-core-types-parsers.md) §2.3 — `PlayerAPI` signatures live there; this note is the *implementation*
- → [04 engine](04-engine-capture.md) — where `__hf.seek(t)` is invoked *externally* (CDP `page.evaluate`)
- ↗ [05 producer](05-producer-pipeline.md) §3 — how virtual time from VIRTUAL_TIME_SHIM combines with six-adapter fan-out
- ↗ [07 studio + player](07-studio-player.md) §4 — studio’s *synchronous direct* `__player` / `__timelines` pattern
- ↗ [08 shader-transitions](08-shader-transitions.md) §3.3 — `__HF_VIRTUAL_TIME__` branch bypasses adapters (engine mode)
- ⊥ [cheatsheet 01](cheatsheets/01-frame-adapter.md) — seven steps to add an adapter (pattern summary)
- ⊥ [cheatsheet 02](cheatsheets/02-runtime-contract.md) — one-page `window.*` globals + devtools snippets

## 12. `inline-scripts/` — contract vs implementation (verified 2026-05-05)

Six files under `packages/core/src/inline-scripts/` (~251 LOC). **Contract definitions + build-time IIFE bundler**. `runtime/init.ts` is *implementation*; `inline-scripts` is the *externally consumable contract*.

### 12.1 File catalog

| File | Lines | Role |
|---|---|---|
| `runtimeContract.ts` | 25 | Message bridge — global names / sources / control-action constants |
| `parityContract.ts` | 50 | CSS props for preview↔render parity + `quantizeTimeToFrame` |
| `pickerApi.ts` | ~40 | `HyperframePickerApi` type (enable/disable/getHovered) |
| `hyperframe.ts` | ~22 | Runtime artifact names (IIFE / ESM / manifest) |
| `hyperframesRuntime.engine.ts` | 52 | esbuild IIFE builder (build-time) |
| `parityContract.test.ts` | (test) | Drift guard |

### 12.2 `runtimeContract.ts` — globals + message sources

```ts
HYPERFRAME_RUNTIME_GLOBALS = {
  player: "__player",
  playerReady: "__playerReady",
  renderReady: "__renderReady",
  timelines: "__timelines",
  clipManifest: "__clipManifest",
};

HYPERFRAME_BRIDGE_SOURCES = {
  parent: "hf-parent",
  preview: "hf-preview",
};

HYPERFRAME_CONTROL_ACTIONS = [
  "play", "pause", "seek",
  "set-muted", "set-playback-rate",
  "enable-pick-mode", "disable-pick-mode",
];
```

**Meaning**: note 03 §1 globals like `__player` / `__timelines` are the *string-defined single source of truth*. Studio uses these constants when reaching into `iframe.contentWindow["__player"]`. Public `postMessage` actions like `{ source: "hf-parent", action: "seek" }` are enumerated here too. The runtime bridge implementation also handles internal actions such as `set-media-output-muted`, `flash-elements` — `RuntimeBridgeControlAction` in `runtime/types.ts` is wider.

### 12.3 `parityContract.ts` — preview ↔ render visual match

```ts
MEDIA_VISUAL_STYLE_PROPERTIES = [
  "width", "height", "top", "left", "right", "bottom", "inset",
  "object-fit", "object-position", "z-index", "opacity", "visibility",
  "filter", "mix-blend-mode", "backdrop-filter",
  "border-radius", "overflow", "clip-path", "mask", "mask-image",
  "mask-size", "mask-position", "mask-repeat",
  "transform", "transform-origin", "box-sizing",
];
```

**Role**: when replacing a `<video>` with a capture PNG, **copy all of these** so preview and render look identical. `copyMediaVisualStyles(target, source)` copies the 26 properties above.

**`quantizeTimeToFrame(t, fps)`** (line 32-37):
```ts
const frameIndex = Math.floor(safeTime * safeFps + 1e-9);
return frameIndex / safeFps;
```

`+ 1e-9` absorbs float error. Example: `1.0 / 30 * 30` = 0.99999… → `floor(29.99…)` = 29 → 29/30 = 0.9666…; the epsilon avoids that off-by-one-frame bug.

Re-exported from core at `packages/engine/src/index.ts:154` — `frameCapture.ts:563` calls it every frame.

### 12.4 `hyperframesRuntime.engine.ts` — esbuild IIFE builder

`buildHyperframesRuntimeScript(options)` (line 28-52):
```ts
buildSync({
  entryPoints: [resolve(__dirname, "../runtime/entry.ts")],
  bundle: true, write: false,
  platform: "browser", format: "iife", target: ["es2020"],
  minify: options.minify ?? true,
  legalComments: "none",
});
```

**Three options**:
- `defaultParityMode`: text-replace `var _parityModeEnabled = false;` to `true` inside the bundle (lines 12–19) so parity mode starts enabled in the runtime
- `sourceUrl`: append debug `//# sourceURL=...`
- `minify`: default true

**Fallback**: if `entry.ts` is missing, return `null` (bundled/publish layouts that ship `dist/` only). Callers fall back to `generated/runtime-inline.ts` or an inlined constant.

### 12.5 Build flow — injecting the IIFE into the page

```
[build time — npm run build:hyperframes-runtime:modular]
buildHyperframesRuntimeScript()
  ├── esbuild buildSync(runtime/entry.ts, IIFE)
  ├── minify + comment-strip + legalComments:none
  └── return string (~50KB)
       ↓
Embed string in generated/runtime-inline.ts (`export const HYPERFRAME_RUNTIME_SCRIPT = "..."`)
       ↓
[runtime — producer/htmlCompiler.ts compileForRender]
Inject <script>${HYPERFRAME_RUNTIME_SCRIPT}</script> into page HTML <head>
       ↓
Page load runs the IIFE immediately → window.__hf, __player, __timelines, etc.
```

**Not “paste HTML by hand” but *embed a string inside the package bundle***. After core builds, `dist/runtime-inline.js` exports a ~50KB processed IIFE string; producer/studio inject that string into the page. Author pages start the runtime with *zero external fetch*.

### 12.6 Why split contract and implementation?

```
inline-scripts/  →  importable contracts for other packages
                    global names, message shapes, parity props, time quantize
                    states what the implementation *must* satisfy

runtime/init.ts →  *implementation* running in the page
                   satisfies inline-scripts contracts
                   (e.g. __player global = HYPERFRAME_RUNTIME_GLOBALS.player)
```

**Why separate?**
1. Producer/engine/studio avoid *hardcoding* global strings — import constants to prevent typos/drift.
2. Parity contract is also used when *compositing PNGs* (engine HDR pass) — standalone file usable in non-runtime contexts.
3. esbuild builder lives in its own file — shipping `dist/` keeps the builder as a dev dependency; only the string lands in `generated/runtime-inline.ts`.

### 12.7 Use in other packages

- `engine/src/index.ts:154` — re-exports `quantizeTimeToFrame` from `parityContract`
- `producer/services/htmlCompiler.ts` — `runtimeContract` + inject bundled IIFE
- Studio imports indirectly — iframe runtime exposes globals

## 13. Next → 04

How `__hf.seek(t)` is invoked from outside (engine worker over CDP), how that pairs with BeginFrame, and how `fileServer.ts` injects VIRTUAL_TIME_SHIM — covered in note 04.

Checklist for this note:
- [ ] In devtools: inspect `window.__hfThreeTime`, `window.__hfLottie`, `window.__hfAnime`
- [ ] On a composition page: call `__hf.seek(2)` and confirm every adapter lands at true t=2s
- [ ] CSS adapter experiment: `data-start="1"`, 2s animation → observe pixels at seek(0), seek(1), seek(2)
- [ ] Call `__hfRuntimeTeardown` manually and observe what tears down
