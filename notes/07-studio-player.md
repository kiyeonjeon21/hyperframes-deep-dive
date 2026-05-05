# 07-studio-player

> One-line summary: `<hyperframes-player>` (~1023 lines, one vanilla web component) combines shadow DOM + iframe + an audio proxy fallback. Studio (React + Zustand + ~1486-line `useTimelinePlayer`) **does not** treat the player as an opaque box — it reads iframe globals `__player` / `__clipManifest` / `__timelines` directly. **Neither package imports `@hyperframes/core`**; the page inside the iframe implements the contract.

---

## 1. Boundary between the two packages

```
┌─────────────────────────────────────────────────────────────┐
│ Studio (React + Zustand + Motion + Tailwind v3)             │
│  ├── NLELayout.tsx (~458 lines, preview + timeline chrome)   │
│  ├── App.tsx (source editor + file tree)                    │
│  ├── usePlayerStore (Zustand) + liveTime pub-sub             │
│  └── useTimelinePlayer (~1486 lines, iframe ↔ React bridge)  │
│       │                                                      │
│       ▼ (direct iframeWindow.__player.seek calls)           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼ (React `Player` wraps the web component)
┌─────────────────────────────────────────────────────────────┐
│ Player (vanilla web component, ~1023 lines)                │
│  ├── shadow DOM                                              │
│  ├── iframe (sandbox: allow-scripts allow-same-origin)       │
│  ├── controls (controls.ts module)                           │
│  ├── ResizeObserver                                          │
│  └── audio proxy fallback (mirror media in the parent)       │
│                                                              │
│  Inside iframe: composition HTML + injected runtime           │
│       window.__hf, __player, __timelines, __HF_VIRTUAL_TIME__ │
└─────────────────────────────────────────────────────────────┘
```

**Principle**: studio only uses the player as chrome; it **reads `iframe.contentWindow` globals directly**. The iframe supplies isolation, not an abstraction wall.

---

## 2. `<hyperframes-player>` — `hyperframes-player.ts` (~1023 lines)

### 2.1 Class skeleton (lines 24-119)

```ts
class HyperframesPlayer extends HTMLElement {
  static observedAttributes = ["src", "srcdoc", "width", "height", "controls",
                               "muted", "poster", "playback-rate", "audio-src"];

  // Shadow DOM
  private shadow: ShadowRoot;
  private container: HTMLDivElement;
  private iframe: HTMLIFrameElement;
  private posterEl: HTMLImageElement | null = null;
  private controlsApi: ReturnType<typeof createControls> | null = null;
  private resizeObserver: ResizeObserver;

  // Player state (iframe runtime is source of truth — local fields cache)
  private _ready = false;
  private _duration = 0;
  private _currentTime = 0;
  private _paused = true;
  private _compositionWidth = 1920;
  private _compositionHeight = 1080;

  // Probe loop — poll iframe globals on an interval
  private _probeInterval: ReturnType<typeof setInterval> | null = null;
  private _lastUpdateMs = 0;

  // Audio proxy fallback
  private _parentMedia: Array<{
    el: HTMLMediaElement;
    start: number;
    duration: number;
    driftSamples: number;     // absorbs jitter before resync
  }> = [];
  private _audioOwner: "runtime" | "parent" = "runtime";

  // Helpers
  private _mediaObserver?: MutationObserver;
  private _playbackErrorPosted = false;
}
```

### 2.2 Nine observed attributes

```
src            iframe.src
srcdoc         iframe.srcdoc (inline HTML string)
width          hard px or auto
height         hard px or auto
controls       boolean attribute for chrome visibility
muted          mute audio
poster         pre-play thumbnail
playback-rate  playback speed multiplier
audio-src      external audio track URL (parent proxy)
```

`srcdoc` wins over `src`, matching HTML semantics (mirrored in lines 168-171).

### 2.3 constructor (119-157)

```ts
constructor() {
  super();
  this.shadow = this.attachShadow({ mode: "open" });   // devtools-friendly

  // Prefer adoptedStyleSheets, fall back to <style>
  const sheet = getSharedSheet();
  if (sheet) {
    this.shadow.adoptedStyleSheets = [sheet];
  } else {
    const style = document.createElement("style");
    style.textContent = PLAYER_STYLES;
    this.shadow.appendChild(style);
  }

  this.container = document.createElement("div");
  this.container.className = "hfp-container";

  this.iframe = document.createElement("iframe");
  this.iframe.className = "hfp-iframe";
  this.iframe.sandbox.add("allow-scripts", "allow-same-origin");  // isolation + same-origin plumbing
  this.iframe.allow = "autoplay; fullscreen";
  this.iframe.referrerPolicy = "no-referrer";

  this.container.appendChild(this.iframe);
  this.shadow.appendChild(this.container);

  // Clicking outside controls toggles play/pause
  this.addEventListener("click", (event) => {
    if (this._isControlsClick(event)) return;          // ignore control chrome hits
    if (this._paused) this.play(); else this.pause();
  });

  this.resizeObserver = new ResizeObserver(() => this._updateScale());
}
```

**`adoptedStyleSheets` first** — older browsers without `CSSStyleSheet` support get inline `<style>`.

**iframe sandbox**: `allow-scripts` + `allow-same-origin`. Together they largely neutralize sandboxing, but listing both documents intent for stricter embedders (CSP / future `sandbox` tokens).

### 2.4 connectedCallback / disconnectedCallback (159-186)

```ts
connectedCallback() {
  this.resizeObserver.observe(this);
  window.addEventListener("message", this._onMessage);
  this.iframe.addEventListener("load", this._onIframeLoad);

  if (this.hasAttribute("controls")) this._setupControls();
  if (this.hasAttribute("poster")) this._setupPoster();
  if (this.hasAttribute("audio-src")) this._setupParentAudioFromUrl(...);
  if (this.hasAttribute("srcdoc")) this.iframe.srcdoc = ...;
  if (this.hasAttribute("src")) this.iframe.src = ...;
}

disconnectedCallback() {
  this.resizeObserver.disconnect();
  window.removeEventListener("message", this._onMessage);
  this.iframe.removeEventListener("load", this._onIframeLoad);
  if (this._probeInterval) clearInterval(this._probeInterval);
  this._teardownMediaObserver();
  this.controlsApi?.destroy();
  for (const m of this._parentMedia) {
    m.el.pause();
    m.el.src = "";          // drop src to help GC
  }
  this._parentMedia = [];
}
```

Aggressive teardown — clearing media `src` avoids leaks.

### 2.5 Audio proxy fallback — most intricate surface

#### Motivation (lines 56-99 comments)

iOS Safari / mobile Chrome throw **NotAllowedError** for `media.play()` inside iframes unless user activation originated there (User Activation v2). Parent gestures do not flow into the iframe, and `postMessage` cannot forward activation.

#### Mitigation: mirror media in the parent

```ts
private _parentMedia: Array<{
  el: HTMLMediaElement;     // <audio>/<video> living in the parent document
  start: number;             // timeline start (seconds)
  duration: number;
  driftSamples: number;
}> = [];

private _audioOwner: "runtime" | "parent" = "runtime";
```

**State machine**:
1. Default `_audioOwner = "runtime"` — iframe plays timed media itself.
2. If `play()` throws `NotAllowedError`, runtime posts `media-autoplay-blocked`.
3. Player receives it → `_audioOwner = "parent"`.
4. Iframe stays muted but timelines advance; `_parentMedia[]` becomes audible.
5. **One-way transition** for the session — the iframe stops retrying `play()` after handoff.

#### Preloading (lines 67-68 comments)

> "Preloading at iframe-load time (rather than lazily on promotion) keeps the audible audio cut-in tight when the promotion fires mid-playback."

Mirror elements are created on iframe load so late promotions do not silence audio.

#### Drift gate

```ts
driftSamples → only resync `currentTime` after MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES
```

Each polling tick measures drift; consecutive violations mean a real desync — single jitter spikes are ignored (slow bridge frames, etc.).

### 2.6 `_playbackErrorPosted` latch (109-117 comments)

> "Without it, under parent ownership where the parent frame itself lacks activation, every paused→playing transition in the iframe state loop would re-fire `play()` (and its rejection) on each proxy — spamming host subscribers."

Latches so hosts only see one failure when autoplay stays blocked everywhere.

### 2.7 probe loop + postMessage (~line 521+)

Same-origin studio calls `iframeElement.contentWindow.__player.seek(t)` synchronously. Cross-origin calls fall back to:

```ts
this.iframe.contentWindow?.postMessage(
  { source: "hf-parent", type: "control", action, ...extra },
  "*",
);
```

`_onMessage` handles iframe → parent traffic:
- `state` → `{ frame, isPlaying, muted, playbackRate }` updates local cache
- `media-autoplay-blocked` → promote audio proxy
- `analytics`, `perf` → bubble to host instrumentation
- `element-picked-many` → element picker integration for Studio

### 2.8 Two builds (player package.json:14-22)

- `dist/hyperframes-player.global.js` — IIFE for `<script src>` tags. **Runtime is inlined** (~50 KB).
- `dist/hyperframes-player.js` — ESM module for bundlers (tree-shake friendly).

The global build avoids `RUNTIME_CDN_URL`; ESM pulls the shim from `RUNTIME_CDN_URL` (line 21) on jsDelivr unless you self-host.

---

## 3. `studio` package — React + Zustand + Motion

### 3.1 Export surface — `index.ts` (~37 lines)

```ts
// NLE layout
NLELayout, NLEPreview, CompositionBreadcrumb (+ CompositionLevel types)

// Player + timeline
Player, PlayerControls, Timeline, VideoThumbnail, CompositionThumbnail
useTimelinePlayer, resolveIframe, usePlayerStore, liveTime, formatTime
TimelineElement (type)

// Editor
SourceEditor, PropertyPanel, FileTree

// Shell
StudioApp

// Hooks
useElementPicker (+ PickedElement types)

// Utilities
resolveSourceFile, applyPatch (+ PatchOperation types)
parseStyleString, mergeStyleIntoTag, findElementBlock
```

Three themes: NLE chrome / player+timeline / code editor.

### 3.2 Zustand store — `playerStore.ts` (~115 lines)

```ts
interface TimelineElement {
  id, label?, key?, tag,                  // identity
  start, duration, track,                  // timeline placement
  domId?,                                  // backing DOM id
  selector?, selectorIndex?,               // patch targeting
  sourceFile?,                             // owning file
  src?, playbackStart?, playbackStartAttr?, playbackRate?, sourceDuration?, volume?,
  compositionSrc?,                       // sub-comp marker
}

interface PlayerState {
  // Playback
  isPlaying, currentTime, duration, timelineReady,

  // Project
  elements: TimelineElement[],
  selectedElementId: string | null,

  // User prefs (persist across project switches)
  playbackRate, loopEnabled, zoomMode: "fit" | "manual", manualZoomPercent,

  // Typed setters
}
```

### 3.3 `liveTime` pub-sub (lines 61-72) — bypass React render churn

```ts
type TimeListener = (time: number) => void;
const _timeListeners = new Set<TimeListener>();

export const liveTime = {
  notify: (t: number) => _timeListeners.forEach((cb) => cb(t)),
  subscribe: (cb: TimeListener) => {
    _timeListeners.add(cb);
    return () => _timeListeners.delete(cb);
  },
};
```

Driving **60 fps playhead updates** through React would rerender the tree every frame and blow the UI budget. `setCurrentTime` fires rarely (play/pause edges); per-frame motion uses `liveTime.notify(t)` to poke DOM nodes directly.

```tsx
// Typical pattern
useEffect(() => {
  const unsub = liveTime.subscribe((t) => {
    playheadRef.current.style.left = `${t * pxPerSecond}px`;
    timeDisplayRef.current.textContent = formatTime(t);
  });
  return unsub;
}, []);
```

React state tracks *session-level* data (elements, selection, zoom); `liveTime` covers *per-frame* playhead motion.

### 3.4 `reset()` (lines 106-114) — what survives project switches

```ts
reset: () =>
  set({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    timelineReady: false,
    elements: [],
    selectedElementId: null,
  })
// playbackRate, loopEnabled, zoomMode, manualZoomPercent intentionally preserved
```

**User preferences span projects** — small detail, large UX payoff.

---

## 4. iframe ↔ React bridge — `useTimelinePlayer.ts` (~1486 lines)

Largest file in studio: **bidirectionally syncs iframe globals with React**.

### 4.1 `IframeWindow` typing (lines 45-50)

```ts
type IframeWindow = Window & {
  __player?: PlaybackAdapter;
  __timeline?: TimelineLike;
  __timelines?: Record<string, TimelineLike>;
  __clipManifest?: ClipManifest;
};
```

Runtime `init.ts` (note 03) populates these globals.

### 4.2 Adapter interfaces

```ts
interface PlaybackAdapter {
  play, pause, seek, getTime, getDuration, isPlaying;
}

interface TimelineLike {
  play, pause, seek, time, duration, isActive;
}
```

`PlaybackAdapter` is the external API; `TimelineLike` mirrors GSAP timelines. `wrapTimeline(tl)` (lines 52-64) converts the latter into the former:

```ts
function wrapTimeline(tl: TimelineLike): PlaybackAdapter {
  return {
    play: () => tl.play(),
    pause: () => tl.pause(),
    seek: (t) => {
      tl.pause();      // deterministic seek — pause first
      tl.seek(t);
    },
    getTime: () => tl.time(),
    getDuration: () => tl.duration(),
    isPlaying: () => tl.isActive(),
  };
}
```

If `__player` is missing, fall back to `__timeline` or `__timelines.main` via `wrapTimeline`.

### 4.3 `ClipManifest` — runtime-published metadata (lines 25-43)

```ts
interface ClipManifestClip {
  id: string | null,
  label: string,
  start: number, duration: number, track: number,
  kind: "video" | "audio" | "image" | "element" | "composition",
  tagName: string | null,
  compositionId: string | null,
  parentCompositionId: string | null,
  compositionSrc: string | null,
  assetUrl: string | null,
}

interface ClipManifest {
  clips: ClipManifestClip[],
  scenes: Array<{ id, label, start, duration }>,
  durationInFrames: number,
}
```

`runtime/timeline.ts:collectRuntimeTimelinePayload()` inspects the DOM + GSAP timelines, pushes the struct onto `iframe.contentWindow.__clipManifest`, and Studio paints UI from it.

### 4.4 `parseTimelineFromDOM(doc, rootDuration)` (line 190+)

Fallback when no manifest exists — parse elements with `data-start`. Separate from core `parseHtml` in note 02 (client-side shape).

### 4.5 `applyMediaMetadataFromElement` (lines 77-113)

```ts
const mediaStartAttr = el.getAttribute("data-playback-start") ? "playback-start"
                     : el.getAttribute("data-media-start")  ? "media-start"
                     : undefined;
const mediaStartValue = el.getAttribute("data-playback-start") ?? el.getAttribute("data-media-start");

const mediaEl = resolveMediaElement(el);  // <video>/<audio>/<img> or descendants
const sourceDurationAttr = el.getAttribute("data-source-duration") ?? mediaEl.getAttribute("data-source-duration");
const sourceDuration = parseFloat(sourceDurationAttr) || mediaEl.duration;
```

Reconciles manifest entries with real DOM nodes. `data-playback-start` is canonical; `data-media-start` is legacy (both accepted).

### 4.6 `findTimelineDomNodeForClip` (line 398+)

Maps manifest clips to DOM nodes via selector + zero-based `selectorIndex` so timeline clicks highlight the exact element.

### 4.7 `useTimelinePlayer()` hook (line 672+)

```ts
export function useTimelinePlayer() {
  // ...
  return {
    iframeRef,
    togglePlay,
    seek: (t: number) => { /* ... */ },
    onIframeLoad: (...) => { /* ... */ },
    refreshPlayer,
    saveSeekPosition,
  };
}
```

`NLELayout` wires this up (lines 87-94). Everything funnels through this hook.

### 4.8 Same-origin synchronous seeks

```ts
const iframeWin = iframeRef.current?.contentWindow as IframeWindow;
iframeWin.__player?.seek(t);   // synchronous, ~0 latency
```

Instead of async `postMessage` round-trips, Studio calls directly — scrubbing on every mouse move stays smooth.

### 4.9 Healing + observers

`autoHealMissingCompositionIds(doc)` (line 573+) injects missing `data-composition-id` attributes.  
`unmutePreviewMedia(iframe)` (line 609+) unmutes media the user never muted.  
`mediaObserver` watches late-loading sub-compositions for fresh media nodes.

---

## 5. `NLELayout.tsx` (~458 lines)

### 5.1 Props (lines 13-60) — slots + callbacks

```ts
interface NLELayoutProps {
  projectId: string,
  portrait?: boolean,

  // Slots
  previewOverlay?: ReactNode,        // cursors, highlights
  timelineToolbar?: ReactNode,       // split/delete/zoom tools
  timelineFooter?: ReactNode,

  // Refresh
  refreshKey?: number,                // bust preview after disk writes
  activeCompositionPath?: string | null,

  // Callbacks
  onIframeRef, onCompositionChange,
  onFileDrop, onDeleteElement, onAssetDrop,
  onMoveElement, onResizeElement,    // timeline edits → source patches
  onBlockedEditAttempt,               // notify when edits are blocked
  onCompIdToSrcChange,                // expose compId → src map
  timelineVisible, onToggleTimeline,  // timeline panel visibility

  // Render hooks
  renderClipContent,                  // thumbnails / waveforms inside clips
}
```

Hosts customize nearly everything via slots and callbacks.

### 5.2 Layout constants (lines 62-64)

```
MIN_TIMELINE_H = 100
DEFAULT_TIMELINE_H = 220
MIN_PREVIEW_H = 120
```

Default timeline height 220 px (user-resizable ≥100), preview never shrinks below 120 px.

### 5.3 Project swap detection (lines 96-100)

```ts
const prevProjectIdRef = useRef(projectId);
if (prevProjectIdRef.current !== projectId) {
  prevProjectIdRef.current = projectId;
  // ... reset logic
}
```

`useRef` + synchronous guard resets faster than waiting for `useEffect`.

---

## 6. Trace — scrubbing in Studio

```
The user drags on the timeline
  │
  ▼ Timeline onMouseMove
mouse.x → time = (mouseX - timelineLeft) / pxPerSecond
  │
  ├── usePlayerStore.setCurrentTime(time)              [Zustand]
  ├── liveTime.notify(time)                            [direct DOM @ 60fps]
  └── iframeRef.current.contentWindow.__player.seek(time)
        │
        ▼ runtime/init.ts createPlayerApiCompat.seek
      basePlayer.seek(time)
        │
        ▼ runtime timeline helpers
      window.__hf.seek(time)
        │
        ├── window.__HF_VIRTUAL_TIME__.seekToTime(time * 1000)  [virtual clock + rAF flush]
        ├── window.__timelines["main"].seek(time)               [GSAP]
        └── six RuntimeDeterministicAdapter.seek({ time })
              │
              ├── CSS Animation.currentTime
              ├── GSAP timeline.totalTime(time)
              ├── animejs instance.seek(time * 1000)
              ├── Lottie anim.goToAndStop(time * 1000, false)
              ├── Three: __hfThreeTime = time + `hf-seek` dispatch
              └── WAAPI animation.currentTime = time * 1000
        │
        ▼ pixels update for the new time
  ▼
Next paint shows the frame
```

End-to-end < 1 ms when same-origin sync calls succeed.

---

## 7. Sharp edges / verification backlog

1. **Sandbox with `allow-same-origin` neutralizes isolation** — partially verified (2026-05-05): no explicit code comment, but `allow-scripts` is required for arbitrary composition JS, and `allow-same-origin` is required for `iframe.contentWindow.__player` (cross-origin → `SecurityError`). Listing both documents embed intent for future CSP/Sandbox negotiations and auto-degrades on true cross-origin embeds (verify via PR history if needed).
2. ~~**Audio proxy resync**~~ — verified (2026-05-05): `MIRROR_DRIFT_THRESHOLD_SECONDS = 0.05`, `MIRROR_REQUIRED_CONSECUTIVE_DRIFT_SAMPLES = 2` → **two consecutive samples >50 ms apart** trigger resync.
3. ~~**Probe interval**~~ — verified (2026-05-05): **200 ms** polling (~5 Hz). Times out after 8 s with “Composition timeline not found…”. Balances cost vs. startup latency (60 Hz probes would be wasteful; 1 Hz feels sluggish).
4. **`__player` vs `__timelines["main"]`** — precedence when both exist? Late `__player` registration vs `wrapTimeline` fallback?
5. ~~**React `Player` component**~~ — verified (2026-05-05): `packages/studio/src/player/Player.tsx`, `forwardRef<HTMLIFrameElement, PlayerProps>`. Imperatively creates `<hyperframes-player>`, mounts inside a div, and **forwards the inner iframe ref** (line 89 comment: bridge for `useTimelinePlayer`). React controls the iframe through the wrapper — the precise mechanism behind “studio does not black-box the player.”
6. **Does `liveTime` run inside an rAF loop?** Which subsystem owns that 60 fps driver?
7. **`__timelines` key collisions** across sub-compositions sharing IDs — validate `_compositionId` uniqueness.
8. **Manifest persistence removed** — commit `26b8e2a9` reverted persistent manifests; studio **reads** manifests only. Edits flow through host-provided HTML patch callbacks (`onMoveElement`, etc.).

---

## 8. Compared to Remotion

| Aspect | Remotion | Hyperframes |
|---|---|---|
| Player | React subtree | vanilla web component + iframe |
| Studio | Single React tree | React shell around real webpages |
| Time updates | React state | `liveTime` pub-sub (non-React 60 fps path) |
| Audio fallback | exists (iOS quirks) | one-way promotion to parent audio |
| Editing | code-first (some declarative tools in v4) | HTML patch callbacks + DOM diff |
| Direct iframe introspection | no | yes (`__player`, `__clipManifest`) |

Hyperframes’ pattern — **peek at the real runtime inside the iframe** — is the largest philosophical gap versus Remotion, enabled because compositions are ordinary web pages.

---

## 9. Related notes

- ← [06 cli](06-cli-orchestration.md) — `preview` tri-mode launcher (dev / local / embedded)
- → [08 shader-transitions](08-shader-transitions.md) — interactive WebGL transitions inside preview (engine mode belongs to producer)
- ↗ [03 runtime + adapters](03-core-runtime-adapters.md) — where `__player` is actually implemented
- ↗ [03 runtime + adapters](03-core-runtime-adapters.md) §3 — how `createPlayerApiCompat` overrides the 43 noop stubs (still TBD deep-read)
- ⊥ [cheatsheet 02](cheatsheets/02-runtime-contract.md) — devtools recipes for globals

## 10. Next → note 08

WebGL shader transitions + deterministic engine mode — largely independent of studio/player.

**Checklist:**
- [ ] After `hyperframes preview`, in devtools:
  ```js
  const player = document.querySelector('hyperframes-player');
  player.iframeElement.contentWindow.__player.seek(2)
  player.iframeElement.contentWindow.__clipManifest.clips
  player.iframeElement.contentWindow.__timelines
  ```
- [ ] Mobile Safari with autoplay blocked → confirm `_audioOwner` flips (`media-autoplay-blocked` message)
- [ ] Scrub timeline with React Profiler — near-zero rerenders at 60 fps thanks to `liveTime`
- [ ] Mount two `<hyperframes-player>` tags → seeks stay isolated per iframe
- [ ] Exercise `getSharedSheet()` fallback (`<style>` tag) on older Firefox builds
