# 10-studio-captions-picker

> One-line summary: Studio’s *runtime bidirectional messaging* angle. The captions subsystem (~2.7k LOC, excluding tests) is an absolute-position overlay synced to the iframe DOM plus style-only `caption-overrides.json` serialization. The element picker (~355 lines) has runtime plus exported hooks/APIs, but `App.tsx` does not currently wire `useElementPicker` / `PropertyPanel` (after the `#593` manual-edit revert). So captions live on the Studio UI path today; the picker is a reusable runtime/host API path.

---

## 1. 09 vs 10 — reaffirming responsibility boundaries

```
Note 09:  User edits the timeline
          → sourcePatcher.applyPatch (static HTML mutation)
          → POST /api/projects/:id/files/:path
          → iframe HMR refresh
          → view the result again

Note 10:  User clicks a caption word (or uses element pick)
          → postMessage or direct iframe DOM read
          → studio React state (CaptionStore / pickedElement)
          → live DOM changes (immediate preview reflection)
          → captions: persist caption-overrides.json
          → picker: source HTML patch possible when the host wires the hook
```

**Main difference**: 09 is *async file write then iframe refresh*. The caption path in 10 is *live overlay/DOM updates + background override JSON persistence*. Perceived latency differs a lot (10 feels instant).

---

## 2. Captions subsystem — ~2.7k LOC across 12 runtime/UI files

```
packages/studio/src/captions/
  ├── store.ts          (272 lines) — Zustand
  ├── types.ts          (207 lines) — CaptionModel, CaptionStyle, CaptionAnimation, etc.
  ├── parser.ts         (315 lines) — Parse captions from HTML/JSON
  ├── generator.ts      (383 lines) — Model → HTML/JSON serialization
  ├── keyboard.ts       (8 lines) — Keyboard nudge helper
  ├── index.ts          (10 lines) — Exports
  ├── hooks/useCaptionSync.ts  (173 lines) — caption-overrides.json sync
  └── components/
      ├── CaptionOverlay.tsx          (623 lines) — iframe DOM overlay
      ├── CaptionPropertyPanel.tsx    (275 lines) — Word-level style editor
      ├── CaptionAnimationPanel.tsx   (269 lines) — Phase-based animation
      ├── CaptionTimeline.tsx         (187 lines) — Caption-only timeline track
      └── shared.tsx                  (26 lines) — Panel row/section UI helper
```

Additional *runtime side*: `packages/core/src/runtime/captionOverrides.ts` (171 lines, note 03 §8) — after composition load, reads overrides JSON and applies to word spans/tweens.

### 2.1 Data model — `captions/types.ts`

Core types (read `types.ts` for exact definitions):

```ts
type CaptionModel = {
  groups: Map<string, CaptionGroup>;     // Group = one utterance unit
  segments: Map<string, CaptionSegment>; // Segment = word or phrase
  groupOrder: string[];                  // Temporal order
};

type CaptionGroup = {
  id: string;
  segmentIds: string[];
  // start/end derived from segment timing
  containerStyle: CaptionContainerStyle; // Box position/size
  animation: CaptionAnimationSet;        // entrance / highlight / exit
};

type CaptionSegment = {
  id: string;
  text: string;
  start: number; end: number;
  style: CaptionStyle;                   // word-level: color, fontSize, position offset, etc.
  // wordIndex or wordId — for mapping
};

type CaptionStyle = {
  color, activeColor, dimColor, fontSize, fontWeight, fontFamily,
  x, y,    // word-level position offset
  scaleX, scaleY, rotation, opacity,
};
```

**Immutable Maps** (store lines 12–16): cuts React re-render cost on large captions (1000+ words). set/update builds new Maps.

### 2.2 `useCaptionStore` (272 lines, Zustand)

Mutation API catalog:

| Category | Methods |
|---|---|
| basic | `setEditMode`, `setModel`, `setSourceFilePath` |
| selection | `selectSegment` (additive), `selectGroup`, `selectAll`, `clearSelection` |
| segment | `updateSegmentStyle`, `updateSegmentText`, `updateSegmentTiming` |
| group | `updateGroupStyle`, `updateGroupContainer`, `updateGroupAnimation`, `splitGroup`, `mergeGroups` |
| bulk | `updateSelectedStyle`, `applyAnimationToAll` |
| reset | `reset()` |

`selectedSegmentIds: Set<string>` — multi-select (Shift+click). `selectedGroupId: string | null` — the two selections are *mutually exclusive* (segment selection clears group and vice versa).

### 2.3 `CaptionOverlay.tsx` (623 lines) — sync to iframe DOM

The most intricate component. **Draws iframe `.caption-group` elements at absolute positions in the *parent* frame.**

Flow:
```
1. querySelectorAll('.caption-group') in iframe contentDocument
2. getBoundingClientRect per element (composition coordinates)
3. Apply iframe scale (when preview is zoomed down)
4. Add viewport offset → coordinates inside the studio canvas
5. Studio React draws absolute divs at those coords (interactive word boxes)
6. User click / drag / keyboard nudge → CaptionStore mutations
7. Changed styles apply immediately to iframe DOM (live preview)
8. In parallel useCaptionSync serializes caption-overrides.json (debounced)
```

**Cross-origin safety**: wrap all iframe DOM reads in `try { ... } catch {}` — graceful when same-origin isn’t guaranteed (overlay simply hidden).

**Keyboard nudge** (`shouldHandleCaptionNudgeKey` helper): Arrow keys move selected word position ±1px; Shift+arrow ±10px. Fine position tuning.

### 2.4 `CaptionPropertyPanel.tsx` (275 lines)

Right inspector panel (word-level style):
- color picker
- position (x/y) inputs
- scale, rotation, fontSize, fontWeight
- fontFamily dropdown
- opacity slider

Calls `updateSegmentStyle` or `updateSelectedStyle` (when multi-selected) → CaptionStore → immediate iframe DOM reflection + sync.

### 2.5 `CaptionAnimationPanel.tsx` (269 lines)

Per-group animation (3 phases):

```ts
type CaptionAnimationSet = {
  entrance: CaptionAnimation;
  highlight: CaptionAnimation | null;
  exit: CaptionAnimation;
};

type CaptionAnimation = {
  preset: string;
  duration: number;
  ease: string;       // GSAP ease
  stagger: number;
  staggerDirection: "start" | "end" | "center" | "random";
  intensity: number;
};
```

UI: 3 phases (Entrance / Highlight / Exit) × per-phase preset/duration/ease/stagger. Only Highlight has an intensity slider; `applyAnimationToAll` bulk-applies to all groups.

### 2.6 `useCaptionSync.ts` (173 lines) — runtime link

**Most important hook**. Bidirectional sync between CaptionStore Zustand model ↔ `caption-overrides.json`. JSON stores **only word style overrides**, not full animations.

```text
// save: 800ms debounce after model change
PUT /api/projects/:projectId/files/caption-overrides.json
Content-Type: text/plain
[
  { "wordId": "w0", "wordIndex": 0, "x": 12, "activeColor": "#fff", ... }
]

// loadOverrides: GET returns a { content } wrapper; JSON.parse(content)
GET /api/projects/:projectId/files/caption-overrides.json
```

Override entry fields:
- Matching: prefer `wordId`, else global `wordIndex`
- Transform/style: `x`, `y`, `scale`, `rotation`, `activeColor`, `dimColor`, `opacity`, `fontSize`, `fontWeight`, `fontFamily`
- Not persisted: group animation, container style, text edits

**Runtime mapping** (`runtime/captionOverrides.ts` line 171, note 03 §8):
- After composition load, `applyCaptionOverrides()` runs; `fetch("caption-overrides.json")` only when `.caption-group` exists
- Transforms wrap the word span in an inline-block `data-caption-wrapper="true"` wrapper and apply to the wrapper
- Font/opacity apply to the inner word span
- Colors replace the existing GSAP color tween `vars.color` with dim/active and `gsap.set` current dim color
- Refresh-safe: reuse existing wrapper to avoid nested wrappers

This split matters: studio is the *editing UI*, runtime applies overrides *before playback*. They talk via JSON; runtime does not re-read every frame.

---

## 3. Element picker — `useElementPicker.ts` (355 lines)

`packages/studio/src/hooks/useElementPicker.ts`. Studio inspector mode.

**Wiring status (2026-05-05)**: Runtime `picker.ts` and the Studio package’s `useElementPicker` / `PropertyPanel` exist and export, but `packages/studio/src/App.tsx` does not import them. So there is no picker UI in the default Studio surface; an external host or future Studio UI must wire the hook to enable it.

### 3.1 Usage scenarios

When a host connects picker UI, a plausible flow:
1. User clicks studio “pick”
2. Hover over an element in the iframe → outline
3. Click → element info (selector, computedStyle, data attrs) in the panel
4. Edit in panel → live DOM change + source patch

### 3.2 `PickedElement` type

```ts
interface PickedElement {
  id: string | null;
  tagName: string;
  selector: string;          // Target for sourcePatcher
  label: string;             // Human-readable label
  boundingBox: { x, y, width, height };
  textContent: string | null;
  src: string | null;        // <img>/<video>/<audio> src
  dataAttributes: Record<string, string>;
  computedStyles: Record<string, string>;
}
```

### 3.3 postMessage protocol

Studio → iframe:
```ts
iframe.contentWindow.postMessage(
  { source: "hf-parent", type: "control", action: "enable-pick-mode" },
  "*"
);
```

Iframe → studio (runtime picker fires):
```ts
parent.postMessage(
  { source: "hf-preview", type: "element-picked", elementInfo: pickedInfo },
  "*"
);
```

Or multi-candidate (several elements hit):
```ts
parent.postMessage(
  { source: "hf-preview", type: "element-pick-candidates", candidates: [...], selectedIndex: 0, point },
  "*"
);
```

Click events first send `element-pick-candidates`. The actual `element-picked` fires when an imperative API like `window.__HF_PICKER_API.pickAtPoint(...)` confirms selection. Also: `element-hovered`, `element-picked-many`, `pick-mode-cancelled`.

Seven public inline contract actions (`HYPERFRAME_CONTROL_ACTIONS`, note 03 §12.2): play / pause / seek / set-muted / set-playback-rate / **enable-pick-mode** / **disable-pick-mode**. The runtime bridge additionally handles internals like `set-media-output-muted`, `flash-elements`.

### 3.4 Hook methods

```ts
{
  isPickMode: boolean,           // Pick mode active?
  pickedElement: PickedElement | null,
  enablePick(): void,            // postMessage enable-pick-mode
  disablePick(): void,           // postMessage disable-pick-mode + ESC handling
  clearPick(): void,             // Clear selection (mode may stay on)
  setStyle(prop, value): void,   // CSS change + source patch
  setDataAttr(attr, value): void,// data-* change + source patch
  setTextContent(text): void,    // textContent change + source patch
  setActiveIframe(el): void,     // Override for multi-iframe (zoomed canvas)
  activeIframeRef: Ref,
}
```

### 3.5 `setStyle` flow — live mutation + source patch

```tsx
const setStyle = (prop, value) => {
  const iframe = getActiveIframe();
  const el = iframe.contentDocument?.querySelector(pickedElement.selector);
  if (!el) return;

  // 1. Live: apply immediately in iframe DOM
  (el as HTMLElement).style.setProperty(prop, value);

  // 2. Persist: patch source HTML
  const targetFile = resolveSourceFile(pickedElement);
  const html = workspaceFiles[targetFile];
  const newHtml = applyPatch(html, [
    { type: "set-attr", target: pickedElement.selector, name: "style",
      value: mergeStyle(currentStyle, { [prop]: value }) }
  ]);
  onSyncFiles({ [targetFile]: newHtml });
};
```

Studio applies changes two ways — **live DOM (instant visual)** + **source patch (persistence)**. Normally the source patch triggers iframe HMR; live DOM covers *latency until then*.

### 3.6 Multi-iframe support

`activeOverrideRef` (lines 53–64). In zoomed-canvas mode, when another iframe is active:

```ts
const getActiveIframe = () => activeOverrideRef.current ?? iframeRef.current;
```

Flexible when multiple views exist (split view, separate zoom panel, etc.).

---

## 4. Two call traces

### 4.1 Caption word-position nudge

```
1. User clicks a word in CaptionOverlay → selectedSegmentIds update
2. Press ←/→
3. shouldHandleCaptionNudgeKey returns true (not inside an input field)
4. updateSegmentStyle(segmentId, { x: currentX + 1 })
5. CaptionStore mutation → React re-render
6. CaptionOverlay redraws word boxes at new positions (live preview)
7. Also apply style.transform = "translate(...)" on .caption-segment in iframe DOM
8. useCaptionSync 800ms debounce → PUT caption-overrides.json
9. SSE notifies external watcher → preview HMR (often noop; iframe DOM already updated)
```

### 4.2 Element pick + setStyle

```
1. Host UI “Pick” click → enablePick()
2. iframe.postMessage("enable-pick-mode")
3. User hovers element in iframe → runtime outline overlay
4. Click → runtime gathers candidates → parent.postMessage("element-pick-candidates")
5. Studio onMessage handler → setPickedElement(info) → right panel refresh
6. User picks red in color picker → setStyle("color", "#ff0000")
7. live: element.style.color = "#ff0000" in iframe DOM
8. patch: if id exists → sourcePatcher.applyPatch → newHtml; else fallback save full iframe HTML
9. onSyncFiles → POST /api/projects/.../files/:path
10. SSE → iframe HMR → composition reload (same style, no flicker)
```

---

## 5. Tricky spots / verification

1. **Caption sync race** — external edit to sourceHTML → SSE → parser rebuild → possible user-input loss. dirty flag or `isEditMode` gate (sync only while `isEditMode`, lines 108–170).
2. **wordIndex mapping stability** — editing caption text changes word count → wordIndex drift. `wordId` first + wordIndex fallback absorbs some edge cases only.
3. **CaptionOverlay coordinate math** — must combine iframe scale + viewport offset + composition resolution. 1px error misplaces word boxes.
4. **postMessage `*` origin** — `enable-pick-mode` etc. use `"*"`. OK with sandbox + same-origin; weaker if cross-origin embed.
5. **Picker not wired in default App** — runtime/hooks exist; using them in stock Studio needs `App.tsx` to wire `useElementPicker` + `PropertyPanel` again. Manual edit UI gone after `#593` revert.
6. **picker setStyle ordering** — live DOM → source patch → SSE refresh. Slow patch response risks SSE reloading *stale HTML*. Needs dedupe key.
7. **`activeOverrideRef` wrong iframe** — returning to main view without clearing override sends picker messages to a hidden iframe. Verify clear patterns.

---

## 6. vs Remotion

| Aspect | Remotion | Hyperframes |
|---|---|---|
| Caption editing | (none — code only) | Dedicated UI subsystem (overlay + property panel + animation phases) |
| Element picker | (none — code only) | runtime/hook API exists; not in default App UI; host wiring enables postMessage + live DOM + source patch |
| Live preview mutation | React HMR (code reload) | Immediate live DOM updates + background persist |
| iframe isolation | (none — Studio is React tree) | Isolation + postMessage protocol |

Hyperframes’ *iframe isolation + bidirectional postMessage* enables:
1. Studio edits compositions *without owning their code* (runtime introspection)
2. Compositions as *standard web pages*, so iframe isolation fits naturally

Remotion doesn’t isolate the React tree equivalently.

---

## 7. Related notes

- ← [09 studio editing](09-studio-editing.md) — split from *static file mutation*: 09 is backend-oriented; 10 is live runtime.
- ↗ [03 §8 captionOverrides](03-core-runtime-adapters.md) — runtime `applyCaptionOverrides` at load time
- ↗ [03 §12 inline-scripts](03-core-runtime-adapters.md) — `HYPERFRAME_CONTROL_ACTIONS` defines `enable-pick-mode` / `disable-pick-mode`
- ↗ [07 player + iframe](07-studio-player.md) §4 — iframe messaging for *time/playback* (10 is *space/elements*)
- ↗ [02 §3 parser](02-core-types-parsers.md) — caption parser/generator stacks on the same HTML parser

## 8. Next steps

This note is the lab’s last *main* note. After that:
- Track B PoC: pick elements via picker → debug
- Try captions end-to-end: `hyperframes preview` → caption mode → word nudge
- Deep-read runtime `captionOverrides.ts` → document *override JSON shape* in the lab if useful

Verification for this note:
- [ ] In devtools console:
  ```js
  const fr = document.querySelector('hyperframes-player').iframeElement.contentWindow;
  fr.postMessage({ source: "hf-parent", type: "control", action: "enable-pick-mode" }, "*");
  // Outline on iframe element hover?
  ```
- [ ] Inspect CaptionStore (studio React DevTools): `useCaptionStore.getState()`
- [ ] Check file: `cat <project>/caption-overrides.json`
- [ ] Monitor postMessage in studio devtools: `window.addEventListener("message", e => console.log(e.data))`
