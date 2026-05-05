# 08-shader-transitions

> One-line summary: 14 fragment shaders + raw WebGL + a GSAP timeline = the 457-line `hyper-shader.ts`. **`window.__HF_VIRTUAL_TIME__` alone selects two modes (interactive WebGL vs deterministic opacity-only)**; deterministic mode runs no GL at all — only registers `tl.set()` so producer can take over compositing.

> **Verified (2026-05-05)**: shader-transitions `registry.ts` registers **exactly 14** shaders; engine `utils/shaderTransitions.ts:353+` `TRANSITIONS` has **15** — the shader package’s 14 plus `crossfade` only. Unlike older notes, `glitch` is now in the WebGL package too.

---

## 1. Package layout — `index.ts` (~2 lines)

```ts
export { init, type HyperShaderConfig, type TransitionConfig } from "./hyper-shader.js";
export { SHADER_NAMES, type ShaderName } from "./shaders/registry.js";
```

Five files total:
- `hyper-shader.ts` (457 lines) — main `init`
- `shaders/registry.ts` (249 lines) — registers 14 fragment shaders
- `shaders/common.ts` — shared GLSL header (H + NQ)
- `webgl.ts` (143 lines) — raw WebGL helpers
- `capture.ts` (120 lines) — DOM → canvas capture (via html2canvas)

**No** `@hyperframes/core`/`engine` dependency — load from `<script>`, call `HyperShader.init({...})`. CDN-friendly (5KB gzip was a stated target).

---

## 2. The 14 shaders (`shaders/registry.ts:8-240`)

Confirmed 14:

| # | shader | Effect |
|---|---|---|
| 1 | `chromatic-split` | RGB channel shift |
| 2 | `cinematic-zoom` | Motion-blur zoom |
| 3 | `cross-warp-morph` | Perlin cross-morph |
| 4 | `domain-warp` | Perlin-based domain warp + accent-colored edges |
| 5 | `flash-through-white` | White-flash dissolve |
| 6 | `gravitational-lens` | Gravitational lens refraction |
| 7 | `glitch` | Scanline/block glitch + RGB split |
| 8 | `light-leak` | Light leak glow |
| 9 | `ridged-burn` | Ridged noise burn (fire-like) + heat color + sparks |
| 10 | `ripple-waves` | Concentric ripples |
| 11 | `sdf-iris` | Iris/vignette + rings |
| 12 | `swirl-vortex` | Swirl morph |
| 13 | `thermal-distortion` | Heat-shimmer refraction |
| 14 | `whip-pan` | Horizontal motion-blur pan (10-pass accumulation) |

Check with: `rg '^\s+("[a-z-]+"|[a-z][a-z-]+):\s*\{' packages/shader-transitions/src/shaders/registry.ts`

### 2.1 Shared GLSL header — `shaders/common.ts`

```ts
export const H = "..."; // Standard header (precision, uniforms, varying)
export const NQ = "..."; // Noise quintic / fbm helpers
```

Each shader is `H + NQ + "void main(){ ... }"`. Plain string concat — minimal bundle size.

### 2.2 Standard uniforms (shared per shader)

```glsl
uniform sampler2D u_from;   // prior scene capture texture
uniform sampler2D u_to;     // next scene capture texture
uniform float u_progress;   // 0 → 1
uniform vec3 u_accent;      // accent color
uniform vec3 u_accent_dark, u_accent_bright;  // derived colors
varying vec2 v_uv;
```

### 2.3 `getFragSource(name)` (line 242-)

```ts
export function getFragSource(name: string): string {
  const def = shaders[name];
  if (!def) throw new Error(`[HyperShader] Unknown shader: "${name}". Available: ${SHADER_NAMES.join(", ")}`);
  return def.frag;
}

export const SHADER_NAMES = Object.keys(shaders) as ShaderName[];
```

Unknown shaders throw explicitly. `ShaderName` is a 14-entry string-literal union.

---

## 3. `init(config)` — interactive mode

### 3.1 Signature

```ts
interface TransitionConfig {
  time: number;       // start time (sec)
  shader: ShaderName;
  duration?: number;  // default 0.7
  ease?: string;      // default "power2.inOut"
}

interface HyperShaderConfig {
  bgColor: string;    // hex (e.g. "#0a0a0a")
  accentColor?: string;
  scenes: string[];   // DOM element ids
  transitions: TransitionConfig[];
  timeline?: GsapTimeline;  // optional external timeline
  compositionId?: string;
}

function init(config: HyperShaderConfig): GsapTimeline
```

**Checks** (lines 101-129):
- `scenes.length === transitions.length + 1` (N scenes + N−1 transitions)
- Every scene id exists
- Every element has class `.scene`

### 3.2 Meta push — `__hf.transitions` (lines 142-155)

```ts
interface HfTransitionMeta {
  time, duration, shader, ease, fromScene, toScene;
}

if (window.__hf) {
  window.__hf.transitions = transitions.map((t, i) => ({
    time: t.time,
    duration: t.duration ?? DEFAULT_DURATION,
    shader: t.shader,
    ease: t.ease ?? DEFAULT_EASE,
    fromScene: scenes[i] ?? "",
    toScene: scenes[i + 1] ?? "",
  }));
}
```

**Matches engine `types.ts:42-55` shape**, but deliberately not imported — see lines 131-133:

> "Locally redeclared (not imported) because @hyperframes/shader-transitions ships as a standalone CDN bundle and must not depend on @hyperframes/engine. Keep this in sync with HfTransitionMeta in packages/engine/src/types.ts."

Intentional duplication — smaller CDN bundle and dependency isolation.

### 3.3 Two-mode split (lines 175-181)

```ts
const isEngineRenderMode =
  typeof window !== "undefined" &&
  Boolean(window.__HF_VIRTUAL_TIME__);

if (isEngineRenderMode) {
  return initEngineMode(config, scenes, transitions, compId, root);
}

// ... else: ordinary interactive mode
```

**Detection**: presence of `__HF_VIRTUAL_TIME__` (virtual time shim from producer fileServer). Interactive preview has none; renders do.

### 3.4 Interactive flow (lines 191-387)

```
1. Create or fetch #gl-canvas (position: absolute, z-index: 100, display: none)
2. createContext(canvas, w, h) → WebGL (on failure GSAP empty-timeline fallback)
3. setupQuad(gl) → full-screen quad VBO
4. Per transition: createProgram(gl, getFragSource(shader)) — reuse same shader programs
5. Per scene: createTexture(gl) — preallocate empty textures
6. tickShader — onUpdate callback:
     state.active && state.prog → renderShader(gl, quad, prog, fromTex, toTex, progress, accent, w, h)
7. Timeline setup:
     If config.timeline: overlay tl.to({t:0}, {t:1, ease:"none", onUpdate:tickShader}, 0)
     Else gsap.timeline({ paused:true, onUpdate:tickShader })
8. Each transition schedules three steps:
     tl.call(asyncCaptureUpload(fromId, toId), T)
     tl.to(proxy, { p: 1, duration: dur, ease, onUpdate: state.progress = proxy.p }, T)
     tl.call(reset(toId), T + dur)
9. registerTimeline(compId, tl, providedTimeline)
10. return tl
```

### 3.5 Async capture race guard (lines 297-322)

```ts
captureScene(fromScene, ...).then((fromCanvas) => {
  uploadTexture(gl, fromTex, fromCanvas);
  return captureIncomingScene(toScene, ...);
}).then((toCanvas) => {
  uploadTexture(gl, toTex, toCanvas);

  // ★ Guard: mutate state only if playhead ∈ [T, T+dur]
  const nowTime = tl.time();
  const inWindow = nowTime >= T && nowTime < T + dur;
  if (inWindow) {
    document.querySelectorAll<HTMLElement>(".scene").forEach((s) => s.style.opacity = "0");
    canvasEl.style.display = "block";
    state.prog = prog; state.fromId = fromId; state.toId = toId;
    state.progress = 0; state.active = true;
  }
  // ...
});
```

**Problem**: scrubbing quickly fires several transitions; async captures resolve 80–200ms later — the last resolver “wins” → all scenes `opacity:0` and a stuck bogus transition state.

**Fix**: on resolve, only apply state if `tl.time()` falls inside *this* transition’s window; otherwise skip. Explained precisely in line 309’s comment.

### 3.6 Capture failure fallback (lines 326-353)

```ts
.catch((e) => {
  // Safari strict canvas-taint + SVG filter (e.g. <feTurbulence> grain):
  // html2canvas yields tainted canvas → gl.texImage2D SecurityError
  console.warn("[HyperShader] Capture failed, CSS crossfade fallback:", e);
  const inWindow = tl.time() >= T && tl.time() < T + dur;
  if (inWindow) {
    gsap.to(fromEl, { opacity: 0, duration: dur, ease });
    gsap.fromTo(toEl, { opacity: 0 }, { opacity: 1, duration: dur, ease });
  }
});
```

**Graceful fallback**: shader transition degrades to a simple CSS crossfade — users may not notice (looks like a light fade); even if they do, beats a frozen broken frame.

---

## 4. `initEngineMode` — deterministic mode (lines 408-457)

### 4.1 Core difference

```
Interactive mode: WebGL + html2canvas + async capture + compiling 14 shaders
Engine mode:      no GL at all — only opacity toggles on the timeline
```

WebGL/canvas/capture **all skipped**. Why?

1. Engine deterministically captures the page via BeginFrame; when async captures would resolve the engine may already be seeking the next frame.
2. Engine reads `__hf.transitions` meta and *composites itself* (`TRANSITIONS[shader]` in `packages/engine/src/utils/shaderTransitions.ts`).
3. The shader-transitions package’s only job in-page is to keep **each scene’s effective opacity deterministic** — so `queryElementStacking()` sees correct visibility.

### 4.2 Implementation (lines 408-457)

```ts
function initEngineMode(config, scenes, transitions, compId, root): GsapTimeline {
  const tl: GsapTimeline = config.timeline || gsap.timeline({ paused: true });

  // When an external timeline is injected, anchor length with a no-op tween
  if (config.timeline) {
    const duration = Number(root?.getAttribute("data-duration") || "40");
    tl.to({ t: 0 }, { t: 1, duration, ease: "none" }, 0);
  }

  // Initial: first scene opacity:1, all others 0
  for (let i = 1; i < scenes.length; i++) {
    tl.set(`#${scenes[i]}`, { opacity: 0 }, 0);
  }

  // Each transition: toId appears at T, fromId disappears at T+dur
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const dur = t.duration ?? DEFAULT_DURATION;
    const T = t.time;
    tl.set(`#${scenes[i + 1]}`, { opacity: 1 }, T);     // bring in toId
    tl.set(`#${scenes[i]}`, { opacity: 0 }, T + dur); // hide fromId
  }

  registerTimeline(compId, tl, config.timeline);
  return tl;
}
```

**During an active transition both scenes have opacity:1** — engine captures both layers then composites with its own shader. After the transition, `from` is opacity:0 (no engine composite needed).

### 4.3 `tl.set()` vs `tl.call()` — key detail (lines 401-407 comment)

```
Why use tl.set() (zero-duration tweens)?
- tl.call fires only along forward motion direction
- engine warmup seeks forward into transition start →
  main render loop then backward-seeks to t=0 →
  callback-set state sticks (won’t revert)
- tl.set tweens revert cleanly on backward seek
```

`call` is a one-shot trigger; `set` is part of timeline state — backward seeks apply opposing effects automatically. Mandatory for deterministic mode.

---

## 5. registerTimeline — registering `window.__timelines`

### 5.1 Lines 389-399

```ts
function registerTimeline(compId, tl, provided): void {
  if (!provided) {
    window.__timelines = window.__timelines || {};
    window.__timelines[compId] = tl;
  }
}
```

**If `provided` is set we skip registering** — an externally injected timeline is owned by the caller; re-registering would collide.

Same global **`__timelines` registry** as notes 02/03/07: studio reads it while scrubbing; runtime adapters fan out.

---

## 6. Call traces — deterministic vs interactive

### 6.1 Interactive (preview)

```
After load the composition calls HyperShader.init({...})
  │
  ├── isEngineRenderMode = false (no window.__HF_VIRTUAL_TIME__)
  ├── create #gl-canvas + WebGL context
  ├── compile only the shaders actually used among 14
  ├── preallocate per-scene textures
  ├── timeline setup (onUpdate: tickShader)
  ├── each transition: call(captureUpload, T) + to(progress, T) + call(reset, T+dur)
  └── return timeline
       ↓
GSAP timeline starts playing
  ↓
At T capture fires → html2canvas async → uploadTexture
  ↓
From T…T+dur every frame runs onUpdate → tickShader → renderShader (one of 14)
  ↓
At T+dur reset → state.active=false, canvas hidden
```

### 6.2 Deterministic (engine render)

```
producer fileServer injects VIRTUAL_TIME_SHIM → window.__HF_VIRTUAL_TIME__ exists
  ↓
Composition calls HyperShader.init({...})
  │
  ├── isEngineRenderMode = true
  ├── initEngineMode … return
  │
  └── tweens placed on timeline:
        tl.set(scenes[i+1], opacity:1, T)   ← all transitions
        tl.set(scenes[i],   opacity:0, T+dur)
        (no interactive callback/capture code runs at all)
       ↓
When producer captures frame N:
  ├── __hf.seek(frame/fps)
  ├── timeline.totalTime(frame/fps) → every tl.set applies exactly
  ├── engine `queryElementStacking()` → each scene’s effective opacity
  ├── engine `groupIntoLayers()` → split scene layers
  ├── engine `TRANSITIONS[shader](from, to, progress)` → Node compositing
  └── write result pixels into the frame buffer
```

Clearest illustration of hyperframes **“two modes, one contract”**: same `init()` runs *completely different code* yet aims for visually matching output.

---

## 7. Host integration — how producer discovers transitions

### 7.1 Compile phase — `htmlCompiler.ts:130`

```ts
/\b(?:(?:window|globalThis)\s*\.\s*)?HyperShader\s*\.\s*init\s*\(|\b__hf\s*\.\s*transitions\s*=/
```

Regex detects `HyperShader.init(...)` or assignments to `__hf.transitions = ...`. Producer then:
1. Enables multipass composite codepaths
2. Turns on `queryElementStacking` + `groupIntoLayers`
3. Applies extra logic for HDR + transitions together

### 7.2 Runtime phase — `__hf.transitions`

During bootstrap `init()` pushes meta; before capture engine runs `page.evaluate(() => window.__hf.transitions)` so it knows *when and where* each transition lives.

### 7.3 Composite phase — `engine/utils/shaderTransitions.ts:353+`

`TRANSITIONS: Record<string, TransitionFn>` — **15 entries, not 14**:

```
crossfade                        // ← not present in shader-transitions package table
flash-through-white
chromatic-split
sdf-iris
glitch
light-leak
cross-warp-morph
whip-pan
cinematic-zoom
gravitational-lens
ripple-waves
swirl-vortex
thermal-distortion
domain-warp
ridged-burn
```

Inspect with:
```bash
grep -E '^TRANSITIONS\["' packages/engine/src/utils/shaderTransitions.ts
```

**Why the asymmetry**:
- `crossfade`: minimal baseline fallback when the page names no shader. The shader-transitions CDN bundle has no separate WebGL “crossfade”; CSS opacity tweens approximate it interactively.
- `glitch`: now also in `shaders/registry.ts:142`, so implementations exist both for interactive WebGL and engine compositing. Older “engine-only glitch” notes are stale.

Shows hyperframes’ *practical design* — engine keeps an extra `crossfade` for render fallback; shader-transitions exposes rich WebGL scene transitions interactively.

No WebGL in-engine — composites at pixel-buffer level; `crossfade(from, to, progress)` is the simplest reference implementation.

---

## 8. Tricky interactive-mode details

### 8.1 Anchor tween (lines 252-253)

```ts
if (config.timeline) {
  const duration = Number(root?.getAttribute("data-duration") || "40");
  tl.to({ t: 0 }, { t: 1, duration, ease: "none", onUpdate: tickShader }, 0);
}
```

Pins a no-op tween onto external timelines because:
1. Guarantees timeline length when the user defines only transitions (otherwise length stops at last T+dur)
2. **Centralizes onUpdate** — tickShader fires every frame even *outside* transition windows (`state.active=false` ⇒ no GL work)

### 8.2 tickShader during transition windows (lines 229-247)

```ts
const tickShader = () => {
  if (state.active && state.prog) {
    const fromTex = textures.get(state.fromId);
    const toTex = textures.get(state.toId);
    if (fromTex && toTex) {
      renderShader(gl, quadBuf, state.prog, fromTex, toTex, state.progress,
                   accentColors, compWidth, compHeight);
    }
  }
};
```

When `state.active` is false the GL path never runs — capture completion sets `active=true`.

### 8.3 Progress proxy (lines 359-371)

```ts
const proxy = { p: 0 };
tl.to(
  proxy,
  { p: 1, duration: dur, ease,
    onUpdate: () => { state.progress = proxy.p; }
  },
  T
);
```

GSAP cannot tween `state.progress` directly, so tween a proxy and copy inside `onUpdate` — idiomatic GSAP.

---

## 9. Accent-color system (lines 89-96)

```ts
function deriveAccentColors(hex: string): AccentColors {
  const [r, g, b] = parseHex(hex);
  return {
    accent: [r, g, b],
    dark: [r * 0.35, g * 0.35, b * 0.35],
    bright: [Math.min(1, r * 1.5 + 0.2), Math.min(1, g * 1.5 + 0.2), Math.min(1, b * 1.5 + 0.2)],
  };
}
```

Supplying only `accentColor: "#ff6600"` derives *dark shading* plus *bright glow* automatically — shaders such as ridged-burn and domain-warp share a cohesive palette.

Default (line 159): `accent=[1, 0.6, 0.2]` (orange-ish) plus derived colors.

---

## 10. WebGL code — `webgl.ts` (143 lines)

(Helpers not deeply read yet):
- `createContext(canvas, w, h)`: `getContext("webgl")` + viewport
- `setupQuad(gl)`: quad VBO filling the screen
- `createProgram(gl, frag)`: standard fullscreen vertex shader + compile/link fragment
- `createTexture(gl)`: empty RGBA textures
- `uploadTexture(gl, tex, source)`: HTML images/canvas → GL texture
- `renderShader(...)`: uniforms + drawArrays

Classical textbook pattern — worthwhile read (raw WebGL in ~143 lines).

---

## 11. `capture.ts` — DOM → canvas (120 lines)

Verified (2026-05-05): depends on **`html2canvas@^1.4.1`** (`package.json:43`, import at top of `capture.ts`). Comments lines 45-58 explain:
- `allowTaint: false` avoids Safari shrinking tainted canvases oddly
- `useCORS: true` for cross-origin images
- `onclone` adjusts transient effects captured right before a transition fires

Separates `captureScene` (state just before the cut) vs `captureIncomingScene` (true incoming scene pixels) → uploaded as `u_from`/`u_to`.

**The 5KB gzip target is shattered**: html2canvas alone is ~150KB min+gzip — interactive bundles balloon. **Engine mode** (note 08 §4) never invokes html2canvas, so deterministic renders stay lighter. CDN consumers should weigh bundle size impact.

`initCapture()` primes GPU/context/canvas pooling (needs its own focused read).

---

## 12. Tricky spots / verification

1. ~~**Exact shader counts**~~ — verified (2026-05-05): `registry.ts` 14, engine `TRANSITIONS` 15 (`crossfade` only extra).
2. **`__HF_VIRTUAL_TIME__` timing** — fileServer injects at the page head — could `HyperShader.init()` theoretically run sooner? Producer injects at the earliest load stage anyway.
3. **Engine-vs-WebGL fidelity** — are engine `TRANSITIONS[shader]` outputs visually identical to WebGL `getFragSource(shader)`? Separate implementations can drift.
4. **Capture-fallback edge cases** — Safari + SVG filter is documented; cross-origin imagery or iframe sandboxes likely add more triggers.
5. **html2canvas dependency reality** — confirm `capture.ts` always proxies through html2canvas; bundle impact.
6. **Anchor tween collateral** — injecting `tl.to({t:0},{t:1, ease:"none", onUpdate:tickShader}, 0)` can pollute a caller-managed timeline/`onUpdate` expectations.
7. **WebGL context loss** — no obvious recovery logic when GPUs reset or run out of memory.
8. ~~**5KB gzip claim**~~ — verified broken (2026-05-05): `package.json:43` locks `html2canvas@^1.4.1`; that dependency alone dominates size. Interactive mode bundles absorb it — deterministic/engine mode skips html2canvas and follows a lighter path. CDN embeds noticeably enlarge host pages.

---

## 13. vs Remotion

| Aspect | Remotion `<TransitionSeries>` | shader-transitions |
|---|---|---|
| Where declared | React JSX | page script (`HyperShader.init`) |
| Transition breadth | nine simple fades/wipes/slides | 14 flashy geometric/noise/lens/chromatic/glitch shaders |
| GL usage | none (CSS/Canvas2D) | raw fragment shaders |
| Determinism | React tree consumes frames | engine mode hops out (`tl.set` only) |
| Dependencies | Remotion core | standalone (CDN-able) |
| Bundle size target | unknown | marketed ~5KB gzip (now unrealistic with html2canvas) |
| Shader authoring | declarative React | imperative + GSAP timelines |
| Compositing implementations | single React interpolation path | **two implementations** — page WebGL + engine Node shaders |

shader-transitions’ **dual implementations** embody hyperframes’ “two modes, one contract” motto.

---

## 14. Related notes

- ← [07 studio + player](07-studio-player.md) — iframe environment where shaders run interactively
- ↗ [04 engine](04-engine-capture.md) §6.3 — `TransitionFn` shape (rgb48le buffer, 6 bytes/pixel), verified
- ↗ [05 producer](05-producer-pipeline.md) §4.2 — producer detection via `detectShaderTransitionUsage` → multipass
- ↗ [05 producer](05-producer-pipeline.md) §4.7 — engine applying transitions atop rgb48le buffers
- ⊥ [PoC 02 pixel-dissolve](../projects/02-shader-transition-poc/) — hands-on custom shader authoring (Node tests)
- asymmetry recap: shader-transitions package counts 14; engine counts 15 with `crossfade`. See §7.3 above.

## 15. Closing

This was the **eighth canonical deep-dive note**. Next hops:

1. skim **cheatsheets/01-frame-adapter** for adapter authoring practice
2. **`projects/01-frame-adapter-poc/`** — implement an adapter yourself (Framer Motion `animate`, popmotion, Theatre.js, …)
3. **`projects/02-shader-transition-poc/`** — mimic `shaders/registry.ts` to add shaders

Verification checklist:
- [ ] After `import { SHADER_NAMES } from "@hyperframes/shader-transitions"`, sanity-check lengths
- [ ] DevTools: call `HyperShader.init({...})` manually → confirm meta lands on `window.__hf.transitions`
- [ ] Preview mode: scrub through transitions watching `gl.getError()` stays clean
- [ ] Diff `hyperframes preview` (interactive) vs `hyperframes render` (deterministic) for the same composition — pixels identical or extremely close?
- [ ] Force WebGL failure → CSS crossfade fallback still looks acceptable
- [ ] `bun run --cwd packages/shader-transitions build` then inspect `dist` sizes

---

## All eight canonical notes mapped

| # | Topic | Essence |
|---|---|---|
| 01 | architecture overview | Dependency graph, render/preview traces, contracts-at-a-glance |
| 02 | core types/parsers | Types hub, DOMParser HTML lint path, regex GSAP parser, six lint modules |
| 03 | core runtime/adapters | Two adapter flavors, bootstrap, six `RuntimeDeterministicAdapter`s |
| 04 | engine capture | Granular services, BeginFrame probe + nine flags, FrameReorderBuffer, parallel coordinator |
| 05 | producer pipeline | Five stages, `VIRTUAL_TIME_SHIM` (95-line IIFE), HDR multipass, regression harness |
| 06 | cli orchestration | citty + lazy subcommands, 24 commands |
| 07 | studio + player | Web component audio proxy bridge, React + Zustand + `liveTime`, direct iframe peeking |
| 08 | shader-transitions | 14 shaders + raw WebGL dual-mode init, handoff into engine composites |

Companion cheatsheets (`frame-adapter`, `runtime-contract`, `render-flags`, `regression-testing`) stay separate.

Projects `01`/`02` are where you bolt on adapters or shaders manually.
