# notes — pixel-dissolve shader PoC

Fill this in as you progress.

## Phase 1 — Environment

- Start time:
- Worktree path:
- `bun install` outcome:

## Phase 2 — GLSL authoring

### Decision 1: block count

Candidates:

- 20×11 (UV scale 20)
- 30×17 (UV scale 30)
- 50×28 (UV scale 50)

Choice: ___  
Why (visual effect vs pixel precision): ___

### Decision 2: soft vs hard edge

- Hard `step()`: crisp mosaic dissolve  
- Soft `smoothstep(±0.05)`: gradient border  

Choice: ___

### Decision 3: noise function

`vnoise` vs `fbm`:

- `vnoise`: single octave, fast, slightly coarse  
- `fbm`: five octaves, organic but heavier + finer detail  

Choice: ___

### Lines after minify

```ts
"pixel-dissolve": { frag: H + NQ + "..." },
```

Body length: ___ lines  

## Phase 3 — Auto inclusion in `SHADER_NAMES`

```bash
bun run --cwd packages/shader-transitions tsc --noEmit
```

Outcome: ___

## Phase 4 — Interactive validation

- Preview at t=2.5 shows mosaic dissolve? ___  
- Browser deltas (Chrome/Safari/Firefox): ___  
- WebGL context losses observed? ___  

## Phase 5 — Engine Node compositing

### TODO 1–2 progress

- [ ] Compute block sizes  
- [ ] Pixel loop + mask + mix  

### Floating-point parity probes

GLSL `hash(0.5, 0.5)` vs JS `hash(0.5, 0.5)`:

```js
console.log(hash(0.5, 0.5));   // ?
```

To measure GLSL output, render that scalar as color and sample:

```glsl
gl_FragColor = vec4(hash(vec2(0.5)), 0.0, 0.0, 1.0);
```

JS hash result: ___  
GLSL hash (R channel / 255): ___  
Delta: ___  

### Single-pixel matchup

Same `(x=100, y=100)` at `progress=0.5`:

- WebGL R/G/B/A: ___  
- Node R/G/B/A: ___  

## Phase 6 — Drift validation

### PSNR measurement

```bash
ffmpeg -i interactive.mp4 -ss 3 -vframes 1 inter.png
ffmpeg -i deterministic.mp4 -ss 3 -vframes 1 det.png
ffmpeg -i inter.png -i det.png -lavfi psnr -f null - 2>&1 | grep "PSNR"
```

PSNR (dB): ___  
Passes 38 dB? ___  

### If PSNR fails

Options:

- [ ] Force `precision highp float` in GLSL  
- [ ] Replace hash with something stabler (e.g. `pcg2d`) in **both** places  
- [ ] Widen smoothstep band — absorbs drift with subtle visual change  
- [ ] ___  

Chosen approach: ___  

## Phase 7 — Tests

`packages/shader-transitions/src/shaders/registry.test.ts`:

- [ ] pixel-dissolve compiles  
- [ ] appears in `SHADER_NAMES`  

`packages/engine/src/utils/shaderTransitions.test.ts`:

- [ ] progress=0 returns `from`  
- [ ] progress=1 returns `to`  
- [ ] progress=0.5 validates blend ratios on sampled pixels  

Test commands:

```
bun run --cwd packages/shader-transitions test
bun run --cwd packages/engine test
```

## Phase 8 — Extend note 08

Findings:

1.  
2.  
3.  

Where to add:

- [ ] Note 08 §12 “sharp edges” → numeric-precision bullets  
- [ ] New section “shader workflow” or `cheatsheet/05-add-shader.md`  

## Hypothesis matrix

| Hypothesis | Outcome |
|---|---|
| GLSL `mediump` vs JS double hashes diverge bitwise | |
| Smoothstep boundary pixels dominate drift | |
| `precision highp float` removes drift | |
| Engine compositor matches WebGL visually (PSNR > 38 dB) | |

## Wrap-up checklist

- [ ] Shader registered + compiles  
- [ ] Interactive demo works  
- [ ] Node compositor landed + tested  
- [ ] Drift checks green  
- [ ] Note 08 updated  

---

## Troubleshooting

Common choke points — compare with `pixel-dissolve.reference.ts` when stuck.

### Track A (Node unit tests)

#### 1. `progress=0` yet some pixels are mid-blend (50/50)

**Cause**: `vnoise(0, 0) = hash(0, 0) = fract(sin(0)*…) = 0`. The top-left block’s threshold is exactly 0, so `smoothstep(-0.05, 0.05, 0) = 0.5`.

**Fix**: short-circuit ends — reference lines 119–128:

```ts
if (safeProgress === 0) { from.copy(output); return; }
if (safeProgress === 1) { to.copy(output); return; }
```

Great teaching moment — boundary bugs fall out naturally from the math. Tests like `progress=0 returns from buffer (all red)` catch it immediately.

#### 2. Buffer size mismatch

**Cause**: assuming RGBA8 (4 bytes/pixel). Actual engine buffers are **rgb48le (6 bytes/pixel, no alpha)**.

**Check**: `from.length === width * height * 6`. See notes 04 §6.3 + 05 §4.7.

- Use `output.writeUInt16LE(value, offset)` on 6-byte strides (R@0, G@2, B@4)  
- `writeUInt8` paths assume RGBA8 — wrong for this PoC  

#### 3. Shader registered but missing from `SHADER_NAMES`

**Cause**: stale TS build cache after `Object.keys(shaders)` narrowing.

**Fix**:

```bash
bun run --cwd packages/shader-transitions clean
bun run --cwd packages/shader-transitions tsc --noEmit
```

Or delete `packages/shader-transitions/dist` manually and rebuild.

### Track B (WebGL + full stack)

#### 4. WebGL vs Node PSNR < 30 dB

Deepest debugging lane. Likely causes:

- **`mediump float` vs JS `double`** — `sin`/`fract` differ on mask edges  
- **Mitigations** (cheatsheet/04 patterns):  
  1. Add `precision highp float;` — easiest alignment  
  2. Widen smoothstep from 0.05 → 0.1  
  3. Swap to a stabler hash (pcg2d) in **both** stacks  

Validate:

```bash
ffmpeg -i interactive.mp4 -ss 3 -vframes 1 inter.png
ffmpeg -i deterministic.mp4 -ss 3 -vframes 1 det.png
ffmpeg -i inter.png -i det.png -lavfi psnr -f null - 2>&1 | grep PSNR
```

#### 5. Transitions dead in engine mode

**Cause**: `tl.call()` only fires along motion direction; warmup seeks forward then render rewinds to `t=0`, leaving callback toggles stuck.

**Fix**: prefer `tl.set()` zero-duration tweens — they revert on backward seeks. Mirror `initEngineMode` in `hyper-shader.ts:408-457`.

```ts
// Bad (callback only)
tl.call(() => state.opacity = 1, null, T);

// Good (tween)
tl.set(`#${sceneId}`, { opacity: 1 }, T);
```

#### 6. Capture failures — Safari only

**Cause**: SVG filters (e.g. `<feTurbulence>` grain) + html2canvas ⇒ WebKit tainted canvas ⇒ `gl.texImage2D` SecurityError.

**Automatic fallback**: `hyper-shader.ts:326-353` catches and runs CSS crossfade (`gsap.to`/`gsap.fromTo`) — graceful without user edits.

**Manual mitigation**: remove SVG filters or isolate them.

#### 7. Interactive bundle too large

**Cause**: html2canvas (~150 KB). Confirmed in note 08 §11.

**Reality**: the “5 KB gzip” budget breaks for CDN builds. Engine mode skips html2canvas, so **deterministic renders stay unaffected** — CDN consumers pay the cost.
