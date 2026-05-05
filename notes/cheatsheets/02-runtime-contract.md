# cheatsheet/02 — `window.*` runtime contract

> One-page summary of the interface between the composition page and hosts (engine/producer/player/studio). Query directly from devtools when debugging.

## Main globals

### `window.__hf` — deterministic time contract

**Defined**: `packages/engine/src/types.ts:68-77`  
**Who sets it**: composition HTML or core runtime  
**Who calls it**: engine (`page.evaluate(() => __hf.seek(t))`)

```ts
interface HfProtocol {
  duration: number;                // seconds
  seek(timeSeconds: number): void; // deterministic visual output
  media?: HfMediaElement[];        // <video>/<audio> metadata
  transitions?: HfTransitionMeta[];// shader-transitions metadata
}
```

**Determinism rule**: after `seek(t)`, DOM/WebGL/canvas pixels must match time `t`. Async completion before resolve is OK (producer still `await`s `page.evaluate(...)`).

---

### `window.__HF_VIRTUAL_TIME__` — virtual time polyfill

**Defined**: `packages/producer/src/services/fileServer.ts:95-190` (injected into page `<head>` by producer)  
**Role**: shim `Date.now()`, `performance.now()`, `setTimeout`, `setInterval`, `requestAnimationFrame` onto a virtual timeline.

```ts
window.__HF_VIRTUAL_TIME__ = {
  seekToTime(nextMs: number): number  // update fake clock + flush pending rAF synchronously
}
```

**Why**: composition code (e.g. `setInterval(..., 1000)`) must fire on *virtual* seconds, not wall clock. Second pillar of determinism (`__hf.seek` is the first).

---

### `window.__player` — interactive PlayerAPI

**Defined**: `packages/core/src/core.types.ts` (interface) + `packages/core/src/runtime/init.ts:76-149` (implementation)  
**Who sets it**: core runtime bootstrap  
**Who calls it**: studio (`useTimelinePlayer.ts`), `<hyperframes-player>` web component

43-method compat wrapper. Categories:
- Time: `seek`, `play`, `pause`, `getCurrentTime`, `getDuration`
- Elements: `addElement`, `removeElement`, `updateElement`, `selectElement`
- Render mode: `setRenderMode('interactive' | 'render')`
- Media: video/audio controls
- Keyframes: `addKeyframe`, `updateKeyframe`, `removeKeyframe`

---

### `window.__timelines` — GSAP registry

**Defined**: composition or core generator (`generators/hyperframes.ts`)  
**Shape**: `{ [compositionId: string]: gsap.timeline.Timeline }`

Nested sub-compositions get separate timelines. Studio scrubs by fanning out to all timelines.

---

### `window.__hyperframes` — text measurement

**Defined**: `packages/core/src/runtime/entry.ts`

```ts
window.__hyperframes = {
  fitTextFontSize(text, options?): { fontSize: number; fits: boolean }
}
```

Auto font sizing; `options` may override `maxWidth`, `baseFontSize`, `minFontSize`, `fontWeight`, `fontFamily`, `step`.

---

### Adapter auto-discovery hooks

```ts
window.__hfAnime     : AnimeInstance[]      // anime.js instances
window.__hfLottie    : LottieAnimation[]    // Lottie instances
window.__hfThreeTime : number               // Three.js virtual time
```

Runtime adapters poll/observe these keys during bootstrap.

### Studio/player auxiliary globals

```ts
window.__clipManifest    // RuntimeTimelineMessage cache
window.__playerReady     // runtime bootstrap complete
window.__renderReady     // render readiness flag
window.__HF_PICKER_API   // element picker imperative API
```

`__clipManifest` is the fast path for Studio timeline extraction; ready flags are used by player/producer harness; `__HF_PICKER_API` is installed by the runtime picker.

---

## Debugging — devtools console

After `hyperframes preview`:

```js
// 0) Grab player iframe
const fr = document.querySelector('hyperframes-player').iframeElement.contentWindow;

// 1) Duration
fr.__hf.duration

// 2) Jump to a time
fr.__hf.seek(2.5)
fr.__player.seek(2.5)  // richer PlayerAPI

// 3) Registered GSAP timelines
Object.keys(fr.__timelines)
fr.__timelines['main'].duration()

// 4) Drive virtual time directly (simulate engine mode)
fr.__HF_VIRTUAL_TIME__?.seekToTime(1500)

// 5) anime/Lottie/Three adapter globals
fr.__hfAnime
fr.__hfLottie
fr.__hfThreeTime

// 6) Studio/player auxiliary contract
fr.__clipManifest
fr.__playerReady
fr.__renderReady
fr.__HF_PICKER_API

// 7) Text measurement util
fr.__hyperframes.fitTextFontSize("Title text", { maxWidth: 800, baseFontSize: 96 })
```

In `render` mode `__HF_VIRTUAL_TIME__` is always defined; in `preview` it is usually undefined.

## Further reading

- Note 01 — deterministic vs interactive split
- Note 03 — bootstrap order for `__player`, `__timelines`, adapter discovery
- Note 05 — where VIRTUAL_TIME_SHIM is injected and hoisted
