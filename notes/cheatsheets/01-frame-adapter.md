# cheatsheet/01 — Writing a frame adapter

> Seven steps to integrate a new JS animation library (e.g. Framer Motion, popmotion, Theatre.js) into deterministic rendering.

## 1. Interface (16 lines)

`packages/core/src/adapters/types.ts`

```ts
interface FrameAdapter {
  id: string;
  init?(ctx: FrameAdapterContext): Promise<void> | void;
  getDurationFrames(): number;
  seekFrame(frame: number): Promise<void> | void;
  destroy?(): Promise<void> | void;
}

interface FrameAdapterContext {
  compositionId: string;
  fps: number;
  width: number;
  height: number;
  rootElement?: HTMLElement;
}
```

## 2. Reference implementation (44 lines, smallest example)

`packages/core/src/adapters/gsap.ts` — deterministic GSAP timeline seeking:

```ts
seekFrame(frame: number) {
  const clamped = Math.max(0, Math.min(frame, getDurationFrames()));
  const seconds = clamped / fps;
  timeline.pause();           // stop autoplay
  timeline.seek(seconds);     // deterministic jump
}
```

Core rule: **after `seekFrame(N)`, page pixels must match frame N**. Async delays or scheduled work break determinism.

## 3. Registration path

**Actual runtime path today: register in core** (PR-worthy) — add `packages/core/src/runtime/adapters/<name>.ts` and wire import + adapter factory in `packages/core/src/runtime/init.ts:3-8`.

`FrameAdapter` / `createGSAPFrameAdapter` are public exports from `@hyperframes/core`, but there is no ad-hoc `window.__hfAdapters` hook in current source. PoCs may experiment with the interface; to attach to preview/render runtime you typically add an internal `RuntimeDeterministicAdapter`.

## 4. Library-specific seeking strategies (six existing runtime adapters)

| Library | Seek API |
|---|---|
| GSAP | `timeline.pause().seek(t)` |
| CSS Animations | `Element.getAnimations().forEach(a => { a.pause(); a.currentTime = ms })` |
| anime.js | `anime.timeline().seek(t)` |
| Lottie | `anim.goToAndStop(frame, true)` |
| Three.js | `window.__hfThreeTime = t; window.dispatchEvent(new Event('hf-seek'))` (indirect) |
| WAAPI | `Animation.currentTime = ms` (same pattern as CSS) |

New libraries usually fit one of the patterns above.

## 5. Tricky areas

- **Autoplay libraries**: if `seek` flips back to `play`, frames advance between captures. Always end `seekFrame` with `pause` where needed.
- **Async loads**: e.g. Lottie JSON — await readiness in `init()` (`lottieReadiness.ts` pattern).
- **External page state**: WebGL contexts, video `currentTime` — if `seek` does not synchronously flush pixels, force an extra refresh.

## 6. How to test

1. Author a composition using your library under `projects/01-frame-adapter-poc/`.
2. `npx hyperframes preview` — interactive sanity check.
3. `npx hyperframes render --fps 30` — deterministic output.
4. Render twice — every frame must match (`ffmpeg -i out.mp4 ... | sha256sum` comparison).

## 7. PR checklist

- [ ] Add `packages/core/src/runtime/adapters/<name>.ts`
- [ ] Import + register in `packages/core/src/runtime/init.ts:4-8`
- [ ] Add lint rule in `packages/core/src/lint/rules/adapters.ts`
- [ ] One paragraph in CLAUDE.md or docs
- [ ] Optional: `/<name>` skill under skills/

## Further reading

- Note 03 — runtime bootstrap sequence + comparison of seven existing adapters
- Cheatsheet 02 — full `window.*` contract the page must expose
