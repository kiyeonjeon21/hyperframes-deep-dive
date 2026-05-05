# 02-shader-transition-poc

> **Goal**: add a custom **`pixel-dissolve`** shader transition. Follow the fourteen existing shaders from note 08 and ensure **both WebGL interactive mode and deterministic producer compositing** behave the same.

## Why pixel-dissolve

- Visually obvious mosaic/dot dissolve — easy to validate
- Straightforward GLSL — ~50–80 lines
- Practice using the noise header (`NQ`)
- Engine mode (`utils/shaderTransitions.ts`) requires **reimplementing the same shader per-pixel in Node** — one of the hardest parts of Hyperframes

## Effect definition

```
progress = 0   → 100% from scene
progress = 0.5 → large pixel blocks (e.g. 64×64) begin swapping to the to scene in pseudo-random order
progress = 1.0 → 100% to scene
```

Swap timing per pixel comes from a noise function (deterministic — same coordinate always swaps at the same time).

## Learning objectives

- [ ] How the `H + NQ` headers stitch into the fragment shader body
- [ ] Match WebGL pixels with engine Node pixels visually
- [ ] Keep two implementations aligned (*same algorithm in two languages*)
- [ ] Trace how producer reads `__hf.transitions` metadata

---

## Step-by-step guide

### Phase 1 — Environment (~15 min)

Fork or clone the upstream Hyperframes monorepo. This PoC **must patch `shader-transitions`**, so adding npm deps alone is not enough.

```bash
# fork or clone
mkdir -p ../scratch
cd ../scratch
git clone git@github.com:heygen-com/hyperframes.git hf-shader-poc
cd hf-shader-poc
bun install
```

Or branch via worktree:

```bash
cd "$HYPERFRAMES_REPO"
git worktree add ../hyperframes-shader-poc HEAD
cd ../hyperframes-shader-poc
bun install
```

### Phase 2 — WebGL fragment shader (~1 h)

Append to the `shaders` map in `packages/shader-transitions/src/shaders/registry.ts`:

```ts
"pixel-dissolve": {
  frag: H + NQ +
    "void main(){" +
    "// TODO 1: coarse pixel grid (e.g. 64×64 blocks)" +
    "// TODO 2: noise-driven timing per block" +
    "// TODO 3: compare progress vs noise — step or smoothstep" +
    "// TODO 4: mix from / to" +
    "}",
},
```

Author readable GLSL under `src/shaders/pixel-dissolve.glsl` (this repo’s skeleton), then minify into `registry.ts`.

Hint:

```glsl
// Block size in UV space
vec2 blockUv = floor(v_uv * 30.0) / 30.0;          // ~30×30 macro blocks
float threshold = vnoise(blockUv * 100.0);           // unique threshold per block
float mask = step(threshold, u_progress);           // 0 or 1
gl_FragColor = mix(texture2D(u_from, v_uv),
                   texture2D(u_to, v_uv),
                   mask);
```

Prefer `smoothstep(threshold - 0.05, threshold + 0.05, u_progress)` for softer edges.

### Phase 3 — Refresh `SHADER_NAMES` (~5 min)

`Object.keys(shaders)` near `registry.ts:240` picks up new entries automatically — **no manual list**. Still verify TypeScript:

```ts
export type ShaderName = keyof typeof shaders;
```

Build once to ensure `"pixel-dissolve"` lands in the union.

### Phase 4 — Interactive validation (~30 min)

Upstream may ship demo HTML under `packages/shader-transitions/demo/` or tests — otherwise add:

```bash
mkdir -p packages/shader-transitions/demo
```

`demo/pixel-dissolve.html`:

```html
<!DOCTYPE html>
<html data-composition-id="demo" data-width="1920" data-height="1080" data-duration="6">
<head><title>pixel-dissolve demo</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3"></script>
<style>
  .scene { position:absolute; inset:0; opacity:1; }
  #s1 { background:#0a0a0a; color:white; font-size:200px; display:flex; align-items:center; justify-content:center; }
  #s2 { background:#ff6600; color:white; font-size:200px; display:flex; align-items:center; justify-content:center; }
</style>
</head>
<body>
  <div id="stage" style="position:relative; width:1920px; height:1080px;">
    <div id="s1" class="scene">SCENE 1</div>
    <div id="s2" class="scene">SCENE 2</div>
  </div>
  <script type="module">
    import { init } from "../dist/index.js";
    window.__timelines = window.__timelines || {};
    const tl = init({
      bgColor: "#0a0a0a",
      accentColor: "#ff6600",
      scenes: ["s1", "s2"],
      transitions: [{ time: 2, shader: "pixel-dissolve", duration: 2 }],
    });
    window.__timelines.demo = tl;
    tl.play();  // interactive mode only
    window.__hf = { duration: 6, seek(t){ tl.pause(); tl.time(t); } };
  </script>
</body>
</html>
```

Run `bun run --cwd packages/shader-transitions build`, open in a browser.

Scrub checklist:

- `tl.time(0)` → SCENE 1 fully visible  
- `tl.time(2)` → dissolve begins  
- `tl.time(3)` → mosaic midpoint  
- `tl.time(4)` → SCENE 2 fully visible  

### Phase 5 — Engine Node compositing (~2–3 h, hardest)

Port the shader to pixels inside `packages/engine/src/utils/shaderTransitions.ts`.

```ts
// engine/src/utils/shaderTransitions.ts (crossfade is the simplest reference)
export const TRANSITIONS: Record<string, TransitionFn> = {
  crossfade,
  // ...existing shaders
};

// Add:
export function pixelDissolve(
  fromBuf: Uint8Array,    // RGBA8 or rgb48le depending on pipeline
  toBuf: Uint8Array,
  outBuf: Uint8Array,
  width: number, height: number,
  progress: number,
): void {
  const blockSize = Math.max(width, height) / 30;  // heuristic for ~30 vertical bands
  // TODO: port hash/vnoise to JS
  // TODO: derive per-pixel mask then mix from/to
}
```

**Hard parts**

1. **Identical noise** — mirror GLSL `hash`:

   ```ts
   function hash(x: number, y: number): number {
     return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
   }
   function fract(x: number): number { return x - Math.floor(x); }
   ```

   Float precision differs: JS doubles vs GLSL `mediump`. Expect possible drift — validate.

2. **Block sizing** — convert UV space (0–1) ↔ pixels accurately.

3. **`mediump` variance** — GPUs disagree; major nondeterminism source vs CPU.

### Phase 6 — Drift validation (~1 h)

Render the same composition twice:

1. **Interactive capture**: headed Chrome → screenshot path (WebGL)  
2. **Deterministic render**: `hyperframes render --workers 1` (engine compositor)

PSNR:

```bash
ffmpeg -i interactive.mp4 -ss 3 -vframes 1 inter.png
ffmpeg -i deterministic.mp4 -ss 3 -vframes 1 det.png
ffmpeg -i inter.png -i det.png -lavfi psnr -f null -
```

PSNR > 38 dB ⇒ visually identical for most observers; otherwise tighten alignment.

### Phase 7 — Registry tests (~30 min)

`packages/shader-transitions/src/shaders/registry.test.ts`:

```ts
test("pixel-dissolve compiles", () => {
  const src = getFragSource("pixel-dissolve");
  expect(src).toContain("u_progress");
  expect(src).toContain("texture2D(u_from");
  expect(src).toContain("texture2D(u_to");
});

test("pixel-dissolve in SHADER_NAMES", () => {
  expect(SHADER_NAMES).toContain("pixel-dissolve");
});
```

Engine compositing tests (`packages/engine/src/utils/shaderTransitions.test.ts`):

```ts
test("pixelDissolve at progress=0 returns from buffer", () => {
  const fromBuf = new Uint8Array([255, 0, 0, 255, ...]); // red
  const toBuf = new Uint8Array([0, 255, 0, 255, ...]);   // green
  const out = new Uint8Array(fromBuf.length);
  pixelDissolve(fromBuf, toBuf, out, 8, 8, 0);
  expect(out).toEqual(fromBuf);
});

test("pixelDissolve at progress=1 returns to buffer", () => {
  // ... progress = 1
  expect(out).toEqual(toBuf);
});
```

### Phase 8 — Extend note 08

Capture PoC findings in `notes/08-shader-transitions.md`:

- Section 12 “sharp edges” → WebGL `mediump` vs JS double drift  
- New mini-section “shader addition workflow” summarizing these eight phases  

---

## Verification checklist

### Track A minimum (Node only)

- [ ] `bun install && bun test` — reference passes 18 tests  
- [ ] Implement every TODO in `src/pixel-dissolve.ts` (`Buffer` + rgb48le)  
- [ ] Point `pixel-dissolve.test.ts` imports at your file and still pass 18 tests  

### Track B extras (WebGL + full stack)

- [ ] Finish `pixel-dissolve.glsl`  
- [ ] Register minified source in `registry.ts`  
- [ ] Confirm `"pixel-dissolve"` appears in `ShaderName` union (TS build)  
- [ ] Interactive demo looks correct  
- [ ] Add Node compositor + `TRANSITIONS["pixel-dissolve"]` wiring  
- [ ] PSNR > 38 dB (interactive vs deterministic)  
- [ ] Shader registry + engine tests green  
- [ ] Feed discoveries back into note 08  

---

## Files

- `README.md` — this guide  
- `src/pixel-dissolve.glsl` — human-readable GLSL skeleton  
- `src/pixel-dissolve.ts` — Node compositor skeleton  
- `src/pixel-dissolve.reference.ts` — working **reference** (signature aligned with engine `crossfade`)  
- `src/pixel-dissolve.test.ts` — 18 `bun` tests (buffers + algorithm)  
- `examples/composition.html` — interactive demo scaffold  
- `package.json` + `tsconfig.json` — local test harness  
- `notes.md` — running lab journal  

## Two learning tracks

### Track A — Node compositing inside this repo (~1–2 h)

No WebGL/Hyperframes install required:

```bash
cd projects/02-shader-transition-poc
bun install
bun test                    # reference should pass all 18 tests
```

You should be able to explain:

- [ ] `TransitionFn` uses **rgb48le** (`Buffer`, 6 bytes/pixel — **not** RGBA8)  
- [ ] `hash`/`vnoise` determinism + float pitfalls  
- [ ] Block coherence (one block ⇒ one mask)  
- [ ] Boundary guarantees at progress 0/1  

### Track B — Full stack (~3–5 h, needs Hyperframes worktree)

Follow phases 1–8 above: WebGL shader + Node compositor + drift validation.

## References

- Note 08: `../../notes/08-shader-transitions.md`  
- Upstream registry: `$HYPERFRAMES_REPO/packages/shader-transitions/src/shaders/registry.ts`  
- Header helpers (`common.ts`): `$HYPERFRAMES_REPO/packages/shader-transitions/src/shaders/common.ts`  
- Engine compositor: `$HYPERFRAMES_REPO/packages/engine/src/utils/shaderTransitions.ts`  
- Simplest shaders to mimic: `flash-through-white` in registry or engine `crossfade`
