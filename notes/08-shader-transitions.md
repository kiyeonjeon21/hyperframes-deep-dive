# 08-shader-transitions

> `@hyperframes/shader-transitions` provides interactive WebGL scene transitions
> and render-mode metadata. The engine owns CPU/rgb48le transition functions for
> deterministic frame compositing.

## 1. Package layout

Start with:

- `packages/shader-transitions/src/index.ts`
- `packages/shader-transitions/src/hyper-shader.ts`
- `packages/shader-transitions/src/shaders/registry.ts`
- `packages/shader-transitions/src/capture.ts`
- `packages/shader-transitions/src/engineModePageComposite.ts`
- `packages/engine/src/utils/shaderTransitions.ts`

The public package exports:

- `init()`
- `TransitionConfig`
- `HyperShaderConfig`
- shader names
- capture support probes
- page-side compositor helpers

## 2. Shader count

Current package shader registry contains 14 shader names:

```text
domain-warp
ridged-burn
whip-pan
sdf-iris
ripple-waves
gravitational-lens
cinematic-zoom
chromatic-split
glitch
swirl-vortex
thermal-distortion
flash-through-white
cross-warp-morph
light-leak
```

Engine `TRANSITIONS` contains those plus `crossfade`, for 15 total engine-side
transition functions.

## 3. Transition config

```ts
interface TransitionConfig {
  time: number;
  shader?: ShaderName; // omitted means CSS crossfade
  duration?: number;
  ease?: string;
}
```

`shader` is optional by design. A missing shader is a CSS crossfade and still
participates in timing/scene pairing. A shader that fails to compile degrades to
the same fallback path.

## 4. Interactive preview path

Interactive mode does the heavy browser-side work:

1. validate scene/transition counts
2. create WebGL context and programs
3. capture outgoing/incoming scene frames
4. cache transition snapshots
5. upload textures lazily
6. render shader output on the overlay canvas during transition windows

The current implementation has a preview snapshot cache backed by IndexedDB:

- cache DB: `hyper-shader-preview-cache`
- cache key includes scene signatures, shader name, time/duration, style
  signature, and `previewCaptureFps`
- texture memory is budgeted; only nearby/active transitions are kept textured
- a loading overlay can be internal or player-controlled

This replaced the earlier simpler "capture on every transition callback" mental
model. Preview now prewarms/caches motion samples to keep animated scene
transitions looking alive.

## 5. Capture backend

`capture.ts` prefers HTML-in-Canvas when available:

- feature probe for `layoutsubtree`
- feature probe for `ctx.drawElementImage`
- native compositor capture when supported

This is better than `html2canvas` because the browser compositor owns CSS,
fonts, backdrop filters, and complex DOM rendering. Fallback behavior still
exists because live preview may run without the required Chrome flag.

## 6. Render mode path

Render mode is detected through the render environment and avoids interactive GL
work. Why:

- async browser-side capture races are bad during frame-by-frame seeking
- producer/engine already capture deterministic page pixels
- CPU/rgb48le transition functions can composite exact FROM/TO buffers

The shader package writes metadata to:

```ts
window.__hf.transitions
```

The producer/engine then know which transition is active for a given frame.

## 7. Page-side compositor

`engineModePageComposite.ts` adds a newer render-mode path: page-side staging for
transition windows.

It can:

- clone FROM/TO scene elements into staging roots
- expose pending composite metadata
- keep CSS crossfade entries aligned with shader transition indices
- cooperate with engine capture/composite hooks

This is why CSS crossfades remain in the transition array even though they do not
need a shader program.

## 8. Engine transition functions

`packages/engine/src/utils/shaderTransitions.ts` ports shader math to rgb48le
buffer operations. Shape:

```ts
type TransitionFn = (
  from: Uint8Array,
  to: Uint8Array,
  out: Uint8Array,
  width: number,
  height: number,
  progress: number,
  options?: ...
) => void
```

The buffer format matters: rgb48le means 16-bit channels, 6 bytes per pixel. PoC
02 is built around internalizing that data path.

## 9. Accent color

Interactive shaders derive:

- `u_accent`
- `u_accent_dark`
- `u_accent_bright`

from a configured accent color. Engine ports need equivalent math or acceptable
visual parity.

## 10. Player integration

Player/shader options:

- `__HF_SHADER_CAPTURE_SCALE`
- `__HF_SHADER_LOADING`
- query params `__hf_shader_capture_scale` and `__hf_shader_loading`

This lets embedded players trade preview quality for speed and coordinate
loading UI with the parent player.

## 11. Failure/fallback ladder

1. Shader omitted -> CSS crossfade.
2. WebGL unavailable -> shader transitions disabled/degraded.
3. Shader compile failure -> CSS crossfade for that transition.
4. Snapshot decode/cache failure -> fallback state and warning.
5. Render mode -> metadata + engine/page compositor path, not interactive GL.

## 12. PoC mapping

`projects/02-shader-transition-poc` teaches the engine-side mental model:

- rgb48le buffers
- deterministic progress clamping
- block/noise masks
- from/to mixing
- parity thinking between GLSL and Node/JS

## 13. Next

Read [09-studio-editing.md](09-studio-editing.md) for the current Studio editing
surface, or jump to PoC 02 for hands-on shader work.
