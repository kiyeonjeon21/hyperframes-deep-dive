# 09-studio-editing

> One-line summary: Studio’s *editing* surface — `App.tsx` (~1748 LOC) is a stateful shell where eight mutation handlers orchestrate timeline edits → source HTML patches. `Timeline.tsx` (~1693 LOC) is canvas-based DOM-less UI. `sourcePatcher.ts` + `timelineEditing.ts` translate clip drags into HTML attribute mutations.

---

## 1. How Studio splits across notes 07 / 09 / 10

Studio is ~18k LOC — too large for one note. Split by responsibility:

| Note | Area | Focus |
|---|---|---|
| **07** | Player + iframe bridge | `<hyperframes-player>` web component + `useTimelinePlayer` (iframe ↔ React) + `playerStore` Zustand |
| **09** (this note) | **Edit workflow** — App + Timeline + files + render queue | Timeline mutations → `sourceHTML` patches, filesystem CRUD, render queue |
| **10** | Bidirectional runtime — captions + element picker | `postMessage` protocol, runtime overrides, live DOM mutation |

**Boundary**: Note 09 is **static file mutation** (timeline edits boil down to editing HTML text). Note 10 is **bidirectional runtime** (`postMessage` + live iframe state).

---

## 2. `App.tsx` — ~1748-line stateful shell

`packages/studio/src/App.tsx` — Studio root component.

### 2.1 State catalog

Local `useState` (~18+):
- `projectId`, `editingFile: { path, content }`, `activeCompPath`
- `compIdToSrc` (Map) — composition id → source path for sub-composition routing
- File tree cache, panel widths, modal flags (`lint`, `mediaPreview`)
- Toast queue, render queue (`useRenderQueue`)

Connected stores: `usePlayerStore` (note 07 §3.2), `useCaptionStore` (note 10).

### 2.2 Eight mutation handlers — clip edits → HTML patches

| Handler | Lines | Trigger | Behavior |
|---|---|---|---|
| `handleTimelineElementMove` | 653–750 | Clip drag (start/track change) | Update `data-start` / `data-track-index` / `z-index` |
| `handleTimelineElementResize` | 752–840 | Left/right resize handles | Update `data-start` / `data-duration` or `data-playback-start` |
| `handleTimelineElementDelete` | 884–996 | Delete key / context menu | Calls `/api/projects/:id/file-mutations/remove-element` then recomputes z-order |
| `handleTimelineAssetDrop` | 1058–1168 | Drag asset from sidebar | Insert `<video>` / `<img>` / `<audio>` with generated ids |
| `handleTimelineFileDrop` | 1170–1206 | OS file drop onto timeline | Multi-asset placement |
| `handleCreateFile` | 1210–1245 | Sidebar button | New `.html` composition skeleton |
| `handleCreateFolder` | (near above) | Sidebar context | New folder |
| `handleDeleteFile` / `handleRenameFile` / `handleDuplicateFile` | 1265–1329 | File context menu | Filesystem mutations |

**Shared pattern** across mutations:

```
1. Resolve targetPath = element.sourceFile || activeCompPath || "index.html"
2. Read that file
3. Patch attributes via sourcePatcher.applyPatchByTarget
4. POST /api/projects/:id/files/:path (or /file-mutations/...)
5. Refresh React elements via usePlayerStore.setElements
6. Recompute z-order across tracks when needed
```

**Key insight**: every mutation is *composition-aware*. If `element.sourceFile` exists, only that file is edited (sub-comp elements touch sub-comp HTML). `activeCompPath` fallback targets the main composition.

### 2.3 External file watch — Vite HMR or SSE (573–586)

```tsx
useEffect(() => {
  const eventSource = new EventSource(`/api/projects/${projectId}/changes`);
  eventSource.addEventListener("file-changed", (e) => {
    const { path } = JSON.parse(e.data);
    refreshFile(path);
  });
  return () => eventSource.close();
}, [projectId]);
```

Vite dev mode may also fire HMR directly — editing in VS Code refreshes Studio automatically while `hyperframes preview` runs.

### 2.4 Keyboard shortcuts (74–81 etc.)

- `Cmd+1` / `Cmd+2` — sidebar tabs (Compositions / Assets)
- Timeline toggle — `getTimelineToggleTitle` + `shouldHandleTimelineToggleHotkey`
- Frame step (←/→) — `PLAYBACK_FRAME_STEP_CODES` (note 07 §4)
- Shuttle speeds — `SHUTTLE_SPEEDS` (note 07 §4)

### 2.5 Toast notifications

`AppToast { message, tone: "error" | "info" }` — simple queue + timed dismiss for mutation failures (“save failed”, “asset missing — re-upload”).

---

## 3. `Timeline.tsx` — ~1693-line canvas UI

`packages/studio/src/player/components/Timeline.tsx`.

### 3.1 Why canvas

DOM timelines (100 clips ⇒ 100 `<div>`s):
- Hard to hit 60fps on scrub (constant rerenders)
- Sub-pixel drift from stacked CSS transforms

Canvas:
- Single draw call per frame
- Pixel-accurate drag positioning
- Implicit viewport culling when zoomed out

Trade-offs: weaker accessibility, no native text selection, manual hit-testing.

### 3.2 Major features (read source for exact lines — high-level list)

- Clip rendering per track (`TIMELINE_COLORS` from core)
- Drag workflow (`mousedown` → `mousemove` → `mouseup`)
- Resize handles adjust duration
- Zoom (`Cmd` + wheel / slider) adjusts `pxPerSecond`
- Scrubbing updates `currentTime`
- Time ruler with adaptive tick spacing
- Multi-select (`Shift`+click or marquee)

### 3.3 `liveTime` bridge (note 07 §3.3)

```tsx
useEffect(() => {
  const unsub = liveTime.subscribe((t) => {
    // repaint playhead directly (canvas redraw / transform)
    canvas.getContext("2d").drawImage(playheadOverlay, t * pxPerSecond, 0);
  });
  return unsub;
}, [pxPerSecond]);
```

React `currentTime` updates coarsely; per-frame paint flows through `liveTime`.

---

## 4. `sourcePatcher.ts` — DOM edits → HTML text (~296 LOC)

`packages/studio/src/utils/sourcePatcher.ts` — translation layer for edits.

### 4.1 Exports

- `resolveSourceFile(elementId, selector, files)` — resolve via id → `data-composition-id` → class → `index.html`
- `applyPatch(html, elementId, op)` — id-based patch
- `applyPatchByTarget(html, target, op)` — id or selector patch
- `readAttributeByTarget(html, target, attrName)` — read current `data-*` values

### 4.2 `PatchOperation`

```ts
interface PatchOperation {
  type: "inline-style" | "attribute" | "text-content";
  property: string;
  value: string;
}

interface PatchTarget {
  id?: string | null;
  selector?: string;
  selectorIndex?: number;
}
```

`attribute` maps Studio concepts (`property: "start"`) onto `data-*` attrs. This is not a general DOM diff engine — only the patterns Studio needs.

### 4.3 Selector formats

`findTagByTarget` supports:

1. `#id` wins when `id` provided  
2. `[data-composition-id="..."]`  
3. Single-class selectors `.headline` with optional `selectorIndex` for duplicates  

Complex combinators / `nodePath` are unsupported — `useTimelinePlayer` must emit selectors within these constraints.

### 4.4 Text patching vs AST

linkedom exists elsewhere, but preserving author formatting (indentation, comments) is hard with full AST round-trips. Regex surgical replacements:

- Keep comments/styles intact  
- Predictable diffs when reopening files in an IDE  

Trade-off: cannot patch arbitrary CSS selectors — rely on ids / occurrence indexes.

---

## 5. `timelineEditing.ts` — z-index helpers (~353 LOC)

`packages/studio/src/player/components/timelineEditing.ts`.

### 5.1 Exports

- `buildTrackZIndexMap(elements)` — track 0 ⇒ z=10, track 1 ⇒ z=20, …
- `formatTimelineAttributeNumber(n)` — stable formatting for `data-start="2.5"` etc.
- Additional helpers for overlap detection, snapping, hit tests

### 5.2 Automatic z-index maintenance

Moving a clip between tracks:

1. Update element `track`
2. Recompute z-order via `buildTrackZIndexMap`
3. Mutation handler writes fresh `z-index` inline styles for every affected element

Matches note 02 §3 generator ordering (`sortElements` by zIndex + startTime) so runtime compositing stays consistent.

---

## 6. File management

### 6.1 `FileTree.tsx` (~944 LOC)

Recursive browser (`packages/studio/src/components/editor/FileTree.tsx`):

- Depth-first rendering  
- Expanded-path `Set<string>`  
- Context menus — New File/Folder, Rename, Delete, Duplicate  
- Drag-and-drop moves (when enabled)  
- Shortcut hooks (`Cmd+Shift+N`, etc.)

### 6.2 `SourceEditor.tsx` — CodeMirror 6

`packages/studio/src/components/editor/SourceEditor.tsx`:

- HTML/CSS/JS/TS highlighting, One Dark theme  
- Bracket matching, search (`Cmd+F`)  
- `onChange` → `handleSourceChange` → debounced saves  

800 ms debounce + immediate `Cmd+S`.

### 6.3 `AssetsTab.tsx` (~397 LOC) + `LeftSidebar.tsx` (~224 LOC)

Tabs: Compositions / Assets / Code (persisted via `localStorage`). Assets drag onto timeline → `handleTimelineAssetDrop`. Upload via picker + drag-drop.

### 6.4 `LintModal.tsx` + `MediaPreview.tsx`

- LintModal surfaces CLI lint findings (`LintFinding` from note 02 §6.4).  
- MediaPreview modal for tree-selected audio/video/image (`isMediaFile` helper).

---

## 7. Render queue

### 7.1 `useRenderQueue.ts` (~199 LOC)

`packages/studio/src/components/renders/useRenderQueue.ts`:

```tsx
const useRenderQueue = (projectId: string) => {
  const [jobs, setJobs] = useState<RenderJob[]>([]);

  const startRender = async (config: RenderConfig) => {
    const res = await fetch(`/api/projects/${projectId}/render`, {
      method: "POST", body: JSON.stringify(config)
    });
    const { jobId } = await res.json();

    const es = new EventSource(`/api/render/${jobId}/progress`);
    es.addEventListener("progress", (e) => {
      const { stage, progress } = JSON.parse(e.data);
      setJobs(prev => prev.map(j => j.jobId === jobId ? { ...j, stage, progress } : j));
    });
    es.addEventListener("complete", (e) => {
      const { outputPath } = JSON.parse(e.data);
      // ...
    });
  };

  // ...
};
```

States mirror producer `RenderStatus`: `queued` → `rendering` → `complete | failed | cancelled` (note 05 §2.2).

### 7.2 `RenderQueue.tsx` + `RenderQueueItem.tsx`

Progress bars, ETA (remaining frames × avg frame time), textual stages (`preprocessing/rendering/encoding/assembling`), cancel buttons.

Fallback copy recommends `hyperframes render` CLI when HTTP APIs fail (non-server modes).

---

## 8. Trace — dragging a timeline clip

```
1. User mousedown → mousemove on clip
2. Timeline canvas hit-test identifies element
3. Each mousemove maps coords → newStart/newTrack
4. mouseup invokes onMoveElement(element, { start, track })
5. App.handleTimelineElementMove
   ├─ targetPath = element.sourceFile ?? activeCompPath ?? "index.html"
   ├─ html = await fetchFile(targetPath)
   ├─ applyPatchByTarget(... start ...)
   ├─ applyPatchByTarget(... track-index ...)
   ├─ Possibly patch z-index for every affected element in that file
   ├─ PUT /api/projects/:id/files/:targetPath (text/plain body)
   ├─ If CodeMirror shows same file, sync editor buffer
   └─ Bump refresh key → preview reload
6. iframe HMR/manual reload recomposes page
7. Runtime calls __player.seek(currentTime) → visuals snap to new layout
```

Steps 5–7 represent **one mutation ⇒ one patch + one React refresh + one iframe reload**, optionally echoed via SSE watchers.

---

## 9. Sharp edges / validation ideas

1. **`element.sourceFile` resolution** — editing nested sub-composition clips: confirm behavior via `useTimelinePlayer.ts:298 getTimelineElementSourceFile`.  
2. **z-order fan-out cost** — moving tracks may rewrite dozens of `z-index` attributes — consider batching.  
3. **Canvas hit-testing** — ±1 px errors near clip edges; snapping strategies?  
4. **External watch echo loops** — SSE after local patches; dedupe with timestamps/`lastSavedAt`.  
5. **CodeMirror debounce vs timeline edits** — simultaneous edits race; define precedence.  
6. **SSE reconnects** — `/api/render/:jobId/progress` drops on flaky networks; need retry UX?

---

## 10. Compared with Remotion Studio

| Aspect | Remotion Studio | Hyperframes Studio |
|---|---|---|
| Composition edits | Code-only | Code + visual timeline (bidirectional) |
| Timeline UI | None (tree inspector) | ~1693 LOC canvas timeline |
| Source mutation | Manual editor | `sourcePatcher` attribute surgery |
| Render trigger | CLI / cloud | Studio UI + CLI |
| File watching | Vite HMR (React) | Vite HMR + SSE for mutation echo |

Hyperframes’ **visual timeline ⇒ HTML patch** pipeline exists because compositions are plain HTML — Remotion’s React tree makes similar tooling far harder.

---

## 11. Related notes

- ← [07 studio + player](07-studio-player.md) — iframe/React bridge feeding these editors  
- → [10 captions + picker](10-studio-captions-picker.md) — runtime bidirectionality  
- ↗ [02 §3 parser](02-core-types-parsers.md) — `parseHtml` extraction vs `sourcePatcher` inverse  
- ↗ [02 §6 lint](02-core-types-parsers.md) — surfacing lint output in `LintModal`  
- ↗ [05 producer](05-producer-pipeline.md) — HTTP APIs consumed by `useRenderQueue`  
- ↗ [06 CLI](06-cli-orchestration.md) §11.1 open item — `PRODUCER_MAX_CONCURRENT_RENDERS` applies to embedded server mode

## 12. Next → note 10

This note covered **static file mutation**. Next: **runtime bidirectional paths** — caption overlays (absolute positioning synced to iframe DOM) + element picker hooks / `postMessage` contracts (default App wiring pending upstream reversions).

Manual verification checklist:

- [ ] Confirm eight mutation handlers still live near lines 653–1329 in `App.tsx`  
- [ ] Exercise `sourcePatcher.applyPatchByTarget` on tiny HTML fixtures  
- [ ] Watch `/api/projects/.../files/...` traffic while dragging clips  
- [ ] `curl`/browser devtools against `/api/render/:jobId/progress` SSE stream  
