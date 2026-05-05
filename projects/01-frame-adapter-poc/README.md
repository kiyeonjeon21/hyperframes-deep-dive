# 01-frame-adapter-poc

> **Goal**: integrate Framer Motion’s `animate()` with Hyperframes’ `FrameAdapter`. By retracing the seven existing adapter patterns from note 03 in your own code, you learn what “determinism” really means in practice.

## Why Framer Motion

- Very widely used (10M+ downloads/month) — realistic integration exercise
- `animate(target, value, options)` is close to GSAP — easy to compare adapter patterns
- Use the **imperative `animate` API only**, not `<motion.div>` (Hyperframes compositions are React-free)
- No built-in timeline object — good practice for “track many instances in a global array” (same as Lottie/anime patterns)

## Learning goals

After this PoC you should be able to answer from your own implementation:
- [ ] Explain in code how `FrameAdapter` (`core/adapters/types.ts:9-15`) differs from `RuntimeDeterministicAdapter` (`core/runtime/types.ts:228-235`)
- [ ] Describe the mechanism that guarantees page pixels match frame **N** right after `seekFrame(N)`
- [ ] Verify two renders of the same composition are pixel-identical (`sha256sum` on `frame_*.png`)
- [ ] Name three+ ways determinism breaks (e.g. autoplay during seek, async load, fp error accumulation)

---

## Step-by-step

### Phase 1 — Environment (~30 min)

Create a sandbox Hyperframes project **outside** this lab repo. **This directory holds study artifacts only**; install the real toolchain elsewhere.

```bash
# Working directory (outside lab)
mkdir -p ../hf-framer-poc
cd ../hf-framer-poc

# hyperframes init (or manual)
npx hyperframes@latest init . --skip-skills
npm install motion           # framer-motion renamed to motion (v12+)
```

*Why not code inside the lab dir?* Hyperframes pulls heavy deps (puppeteer, ffmpeg); the lab keeps notes while experiments live in scratch.

→ Under `01-frame-adapter-poc/` we keep **notes + adapter copy + validation results** only.

### Phase 2 — Write the adapter (~1–2 h)

`src/framer-motion-adapter.ts` is a skeleton. Fill it in:

```ts
// FrameAdapter (core/adapters/types.ts:9-15)
{
  id: "framer-motion",
  init?(ctx) — TODO 1: library readiness checks
  getDurationFrames() — TODO 2: longest duration across registered instances
  seekFrame(frame) — TODO 3: seek every instance
  destroy?() — TODO 4: cleanup
}
```

Key design choices:
1. **Instance tracking** — user pushes to `window.__hfFramerMotion` (Lottie style), or poll `motion.running` (anime style), or scan `getAnimations()` in `discover()` (CSS style)
2. **Time units** — does Framer Motion `animate()` use ms or seconds?
3. **Stop autoplay** — `animate()` may auto-run; you likely need `pause` on every seek
4. **Multiple instances** — should `getDurationFrames()` use max, sum, …?

Document *why* you chose each path in `notes.md`.

### Phase 3 — Test composition (~30 min)

`examples/composition.html` is a skeleton. Two rectangles moving/rotating for five seconds: call `animate()`, register with the adapter, implement `__hf`.

Core contract (see note 04):

```js
window.__hf = {
  duration: 5,
  seek(time) {
    // Call adapter.seekFrame directly (or via your global registration)
    myAdapter.seekFrame(Math.round(time * 30));
  }
};
```

**Caution**: *where* the adapter hooks into runtime/engine is the open question. As of 2026-05-05 source review there is no `window.__hfAdapters` hook — `FrameAdapter` is mainly a public type/helper. Practical PoC split: (a) page fans out inside `__hf.seek` using a global like `__hfFramerMotion`, vs (b) upstream PR adds internal `RuntimeDeterministicAdapter` under `packages/core/src/runtime/adapters/<name>.ts`.

Two hypotheses:
- **A**: engine never polls `__hfAdapters` — page-level `__hf.seek` fan-out to Framer Motion is enough.
- **B**: merging upstream requires implementing `RuntimeDeterministicAdapter` internally.

Validate A/B in Phase 3.

### Phase 4 — Preview check (~30 min)

```bash
cd ../hf-framer-poc
npx hyperframes preview .
```

DevTools:

```js
const fr = document.querySelector('hyperframes-player').iframeElement.contentWindow;
fr.__hf.seek(2.5)              // does seek work?
fr.__hf.duration               // correct duration?
fr.__hfFramerMotion             // your tracking array?
fr.__hfAdapters                 // expect undefined in current upstream
```

Scrub: rectangles should track smoothly; jumps should snap (no stretch from autoplay fighting you).

### Phase 5 — Render determinism (~1 h)

Render twice and compare pixels.

```bash
npx hyperframes render . -o run1.mp4 --workers 1
sleep 60 && npx hyperframes render . -o run2.mp4 --workers 1

mkdir frames1 frames2
ffmpeg -i run1.mp4 frames1/%04d.png
ffmpeg -i run2.mp4 frames2/%04d.png

diff <(cd frames1 && find . -name '*.png' -exec sha256sum {} +) \
     <(cd frames2 && find . -name '*.png' -exec sha256sum {} +)
# empty diff ⇒ determinism pass
```

If nondeterminism shows up (common):
- Does `core/lint/rules/core.ts:274-321` `non_deterministic_code` fire?
- Which adapter method introduces nondeterminism?
- Remove `Math.random`, `Date.now`, rAF dependence where inappropriate.

### Phase 6 — Break it on purpose (~30 min)

- Seek to 5.1s after `animate(..., { duration: 5 })` — what happens?
- Register two instances, unregister one — seek behavior?
- Tight seek loop while autoplay is on

Log what breaks and how you’d harden it in `notes.md`.

### Phase 7 — Extend note 03 (~30 min)

Add findings to `../../notes/03-core-runtime-adapters.md`:
- Section 6 “two paths for custom libraries” — concrete registration story
- Section 10 “tricky spots” — anything new you found

---

## Done checklist

### Track A minimum
- [ ] `bun install && bun test` — reference passes 20 tests
- [ ] Implement all four TODOs in `src/framer-motion-adapter.ts`
- [ ] Switch `adapter.test.ts` imports to your file and pass 20 tests

### Track B extra
- [ ] `examples/composition.html` works in preview (responsive scrub)
- [ ] Two renders: every frame `sha256sum` matches
- [ ] `notes.md` has phases 1–7 notes, hypotheses, results
- [ ] At least one addition merged into note 03

---

## Files

- `README.md` — this file
- `src/framer-motion-adapter.ts` — **skeleton** adapter (four TODOs)
- `src/framer-motion-adapter.reference.ts` — working **reference** (compare when stuck; motion-dom@12.38.0 typings)
- `src/adapter.test.ts` — 20 `bun` tests (mocks; no Hyperframes install)
- `examples/composition.html` — composition skeleton
- `package.json` + `tsconfig.json` — test runner wiring
- `notes.md` — your running log

## Two learning tracks

### Track A — Self-contained in repo (~30–60 min)

```bash
cd projects/01-frame-adapter-poc
bun install
bun test                    # reference should pass 20 tests
```

Then: fill TODOs, switch imports from `.reference` to `./framer-motion-adapter`, rerun `bun test`.

This validates **interface + determinism mechanics only**, not full Hyperframes render.

### Track B — Full stack (~1–3 h, needs Hyperframes)

Follow Phase 1–7 above: preview scrub + render determinism.

## References

- Note 03: `../../notes/03-core-runtime-adapters.md`
- Cheatsheet: `../../notes/cheatsheets/01-frame-adapter.md`
- Upstream GSAP adapter: `$HYPERFRAMES_REPO/packages/core/src/adapters/gsap.ts`
- Upstream anime adapter (global array pattern): `$HYPERFRAMES_REPO/packages/core/src/runtime/adapters/animejs.ts`
