# Notes — framer-motion adapter PoC

Fill this in as you go. Keep the main note (`notes/03`) polished; this file is for **raw findings** and **false starts**.

## Phase 1 — Environment

- Started at:
- Commands:
- Blockers:

## Phase 2 — Adapter

### Decision 1: instance tracking

Candidates:
- [ ] `window.__hfFramerMotion = []` with user push (Lottie pattern)
- [ ] Poll `motion.running` (anime pattern) — does motion v12 expose `running`?
- [ ] Scan `getAnimations()` like the CSS adapter

Choice: ___  
Why: ___

### Decision 2: time units

Is motion v12 `controls.time` in seconds or ms?  
Experiment:

```js
const a = animate("#x", { opacity: [0,1] }, { duration: 5 });
a.duration   // ?
a.time = 2.5; // halfway through duration?
```

Answer: ___

### Decision 3: blocking autoplay

Is `pause()` right after `animate(...)` enough?  
Or `animate(..., { autoplay: false })`?

Answer: ___

### TODOs 1–4

- [ ] init
- [ ] getDurationFrames
- [ ] seekFrame
- [ ] destroy

## Phase 3 — Test composition

Working checks:
- [ ] `__hf.duration` reports 5
- [ ] `__hf.seek(2.5)` places boxes near expected coordinates
- [ ] No autonomous playback (pause holds)

DevTools captures:
- `__hfFramerMotion` in preview:
- `__hfAdapters` if any:

## Phase 4 — Preview

Scrub latency feel: ___  
Oddities: ___

## Phase 5 — Render determinism

```bash
npx hyperframes render . -o run1.mp4 --workers 1
npx hyperframes render . -o run2.mp4 --workers 1
ffmpeg -i run1.mp4 -f image2 -vf fps=30 r1/%04d.png
ffmpeg -i run2.mp4 -f image2 -vf fps=30 r2/%04d.png
diff <(cd r1 && find . -type f -exec sha256sum {} +) \
     <(cd r2 && find . -type f -exec sha256sum {} +)
```

Result (matching frames / total):

When nondeterministic:
- First differing frame:
- PSNR / visual delta:
- Suspected source:

## Phase 6 — Failure cases

### Case A: seek past duration
- `__hf.seek(5.5)` with duration 5s  
- Outcome: ___  
- Adapter change needed? ___

### Case B: unregister one of two instances
- ___

### Case C: fast seek loop while autoplay on
- ___

## Phase 7 — Note 03 updates

New facts:
1.
2.
3.

→ Add to `../../notes/03-core-runtime-adapters.md` (sections 6 / 10 / etc.)

## Hypothesis table

| Hypothesis | Outcome |
|---|---|
| Engine does not poll `__hfAdapters` (page must fan-out) | |
| `controls.time` setter updates pixels synchronously | |
| External `pause()` can tame `animate()` autoplay | |
| Two renders: all frame SHAs identical | |

## Sign-off

Can you declare the PoC done?
- [ ] All four adapter methods implemented
- [ ] Responsive preview
- [ ] Render determinism pass
- [ ] ≥1 item added to note 03

---

## Troubleshooting

Common stalls — compare to `framer-motion-adapter.reference.ts`.

### Track A (`bun` unit tests)

#### 1. Reference passes, skeleton fails

Typical causes:
- **Missing `fps` validation** — `createFramerMotionAdapter({ fps: 0 })` should throw.
- **Missing `Number.isFinite(frame)`** — `seekFrame(NaN)` leaks NaN time; use `Number.isFinite(frame) ? Math.max(0, frame) : 0`.
- **Instance fallback** — when `options.instances` is absent, read `window.__hfFramerMotion ?? []`.
- **`init` `pause()` throws** — swallow per instance: `try { inst.pause(); } catch {}`.
- **`destroy` skips `cancel`** — tests expect `cancel` on every instance.

#### 2. `time` setter “does nothing”

motion v12+ uses a **setter** on `controls.time` — assign `inst.time = 2.5`; there is no `setTime`. See motion-dom@12.38.0 `AnimationPlaybackControls` (`framer-motion-adapter.reference.ts:37-50`).

### Track_B (real Hyperframes preview/render)

#### 3. Only first frame moves

- Instances never **pushed** to `__hfFramerMotion` after `animate`.
- `__hf.seek` never calls the adapter.
- Instances left **playing** — set `autoplay: false` or pause immediately after `animate`.

#### 4. Two renders differ (`sha256`)

- Run `npx hyperframes lint` for `non_deterministic_code`.
- User code using PRNG / time APIs.
- BeginFrame vs screenshot mode — note 04 §3.2 triple condition; macOS is screenshot-only — compare on Linux Docker with same worker count.

#### 5. No `motion.running` global in v12

Unlike anime.js there is no global running list — users must **`__hfFramerMotion.push(controls)`** explicitly (Lottie-style). See reference `getInstances()` around lines 81–90.

#### 6. Mobile Safari cannot read `iframe.contentWindow.__hfFramerMotion`

- `<hyperframes-player>` uses `sandbox="allow-scripts allow-same-origin"` — should allow same-origin access.
- Confirm iframe `src` is not cross-origin.
- Autoplay blocks may emit `media-autoplay-blocked` — audio proxy handoff (note 07 §2.5).
