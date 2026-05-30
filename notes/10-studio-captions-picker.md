# 10-studio-captions-picker

> Captions and picker/manual editing are separate but adjacent Studio systems:
> both need live preview state, iframe access, source patching, and careful UI
> mode coordination.

## 1. Captions subsystem

Start with `packages/studio/src/captions/`.

Key pieces:

- `types.ts` - caption segment/word/style/animation types
- `store.ts` - Zustand state for caption edit mode, selection, segment edits
- `parser.ts` - transcript parsing
- `generator.ts` - caption HTML/source generation helpers
- `keyboard.ts` - caption edit shortcuts
- `components/CaptionOverlay.tsx`
- `components/CaptionTimeline.tsx`
- `components/CaptionPropertyPanel.tsx`
- `components/CaptionAnimationPanel.tsx`
- `hooks/useCaptionSync.ts`

Caption editing is not just timeline text editing. It has word-level timing,
selection state, overlay geometry, style controls, and animation phases.

## 2. Caption state model

The store tracks:

- edit mode
- caption segments and words
- selected segments/words
- style overrides
- animation settings
- dirty/sync state

The preview overlay reads iframe geometry and paints editing affordances on top
of the player area.

## 3. Caption sync

`useCaptionSync` links Studio state to project/source/runtime:

```text
transcript/caption source
  -> caption store
  -> overlay/property/timeline UI
  -> source generation/patch
  -> preview reload/sync
```

The tricky part is keeping word timing, DOM text, and source patches aligned
without causing playback drift.

## 4. Caption panels

Caption panels expose controls for:

- font and size
- fill/stroke/shadow
- highlight/word emphasis
- layout and positioning
- animation presets/phases
- segment/word selection

They sit in the same right-panel ecosystem as DOM/manual edit controls, so mode
switching matters.

## 5. Picker/manual editing

Picker/manual editing spans core runtime and Studio:

- core runtime exposes picker APIs and element info
- Studio tracks hover/selection/manual edits
- source patch helpers persist changes
- overlays render geometry and gesture handles

Primary Studio files:

- `hooks/useDomEditSession.ts`
- `hooks/useDomSelection.ts`
- `hooks/usePreviewInteraction.ts`
- `hooks/useDomEditCommits.ts`
- `components/editor/DomEditOverlay.tsx`
- `components/editor/domEditing*.ts`
- `components/editor/manualEdits*.ts`

## 6. Selection flow

```text
pointer over preview
  -> resolve element from iframe DOM
  -> build DomEditSelection
  -> update hover/selection state
  -> optional click-to-source
  -> open/right-panel controls
```

Selections prefer stable identifiers:

- `id`
- selector plus index
- source file
- composition path
- bounding box and transform context

Missing IDs remain a practical problem; the linter warns when editable timeline
elements lack stable IDs.

## 7. Commit flow

```text
user drags/edits
  -> apply live DOM preview change
  -> compute source patch
  -> write project file
  -> record edit history
  -> refresh/reapply preview state
```

Manual edit commits include:

- style property
- HTML attribute
- text content
- text field style
- path offset
- grouped path offset
- box size
- rotation
- motion/GSAP property changes

## 8. Agent handoff

`useAskAgentModal` and `domEditingAgentPrompt` can build context from a selected
element: current time, composition path, source target, element geometry, and
nearby project context. This is a bridge between manual inspection and agent-led
source edits.

## 9. Mode conflicts

Captions and picker/manual editing both want preview overlay ownership.

Rules of thumb:

- caption edit mode should show caption overlay/timeline
- DOM manual editing should stay disabled while captions own the overlay
- playback should usually disable hover/manual handles
- block preview overlays should suppress normal editing affordances

## 10. Failure modes

- source target cannot be resolved from a live DOM element
- source patch applies to the wrong duplicate selector
- iframe reload loses a live manual edit before it is committed
- GSAP script shape is unsupported
- caption word timing and DOM text drift after manual source edits
- preview overlay coordinates are stale after zoom/layout changes

## 11. Next

Read [11-aws-lambda-distributed.md](11-aws-lambda-distributed.md) for the new
deployment/distributed axis, or return to [09-studio-editing.md](09-studio-editing.md)
when working on editor behavior.
