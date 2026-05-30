# 09-studio-editing

> Studio editing is now split across a smaller `StudioApp`, context providers,
> focused hooks, and editor components. The old "one giant App plus one giant
> Timeline" mental model is no longer accurate.

## 1. Main entrypoints

Start with:

- `packages/studio/src/App.tsx`
- `packages/studio/src/components/StudioPreviewArea.tsx`
- `packages/studio/src/components/StudioLeftSidebar.tsx`
- `packages/studio/src/components/StudioRightPanel.tsx`
- `packages/studio/src/hooks/`
- `packages/studio/src/components/editor/`
- `packages/studio/src/components/renders/`
- `packages/studio/src/components/sidebar/`

`StudioApp` now mostly wires state/hooks/components rather than containing every
editing algorithm inline.

## 2. App shell responsibilities

`StudioApp` coordinates:

- server/project connection
- active composition path and URL state
- preview iframe ref and refresh keys
- file manager
- render queue
- caption sync
- timeline editing
- DOM edit session
- clipboard/history
- panel layout and UI preferences
- telemetry session start
- toast and lint modal state

Then it passes behavior into:

- `StudioLeftSidebar`
- `StudioPreviewArea`
- `StudioRightPanel`
- `TimelineToolbar`
- providers for Studio, panel layout, file manager, and DOM edit context

## 3. File management

`useFileManager` owns project file operations:

- read/write project files
- upload files
- refresh file tree
- source editor integration
- edit history recording
- reload/refresh signaling

Sidebar components split the UI:

- `AssetsTab`
- `BlocksTab`
- `CompositionsTab`
- `FileTree`
- `SourceEditor`

## 4. Preview area

`StudioPreviewArea` composes the NLE layout with overlays:

- `NLELayout` for player/timeline frame
- `CaptionOverlay` in caption edit mode
- `DomEditOverlay` when inspector/manual edit panels are enabled
- block preview overlay while browsing/installing blocks
- `CaptionTimeline` footer in caption mode
- `StudioFeedbackBar`

This component is the visual junction of playback, timeline editing, caption
editing, block preview, and DOM/manual editing.

## 5. Timeline editing

Timeline mutations are handled through `useTimelineEditing` and player timeline
components. Operations include:

- moving clips
- resizing clips
- deleting elements
- asset drops
- block drops
- timeline selection
- z/track placement updates
- reload and pending edit tracking

The source of truth remains project HTML. Timeline operations eventually commit
HTML/source changes and refresh the preview.

## 6. DOM/manual editing session

`useDomEditSession` is the current center of DOM editing. It delegates to:

- `useDomSelection`
- `usePreviewInteraction`
- `useDomEditCommits`
- `useGsapScriptCommits`
- `useAskAgentModal`
- `useGsapTweenCache`

It supports:

- preview hover/selection
- click-to-source
- manual drag/box/path/rotation commits
- style and attribute commits
- text field edits
- GSAP property/meta edits
- agent prompt context for selected elements
- edit history integration

## 7. Source patching

`packages/studio/src/utils/sourcePatcher.ts` still matters, but it is no longer
the whole story. Manual edits often pass through specialized helpers before
becoming a patch:

- DOM selection resolves source target
- edit hook computes mutation
- source patcher applies textual patch
- file manager writes project file
- edit history records before/after
- preview reloads and reapplies manual edits as needed

Textual patching remains pragmatic: preserving author formatting is more useful
than full AST round-trips for common HTML/style edits.

## 8. GSAP editing

GSAP edit support is split into:

- parser/mutation helpers from core subpaths
- Studio cache hooks
- editor panels/sections for motion/ease/animation properties
- commit hooks that patch scripts and invalidate caches

A key limitation remains: unsupported timeline patterns can block automatic
editing, in which case Studio should surface the limitation rather than corrupt
the script.

## 9. Render queue

`components/renders/useRenderQueue.ts` and related UI components manage Studio
renders:

- enqueue render request
- poll status/progress
- show item state
- surface output/error

CLI render and Studio render share producer concepts, but Studio adds UI state
and project context around them.

## 10. Blocks and catalog integration

Studio can install blocks from the registry through:

- `useBlockCatalog`
- `BlocksTab`
- `blockInstaller`
- active block params panel
- preview/block drop handlers

Block insertion is a source edit operation plus optional preview/context
behavior, not a separate hidden project format.

## 11. Sharp edges

- Preview iframe refs are passed through many layers; stale refs cause confusing
  edit failures.
- Pending timeline edit paths exist to avoid treating our own saves as external
  file changes.
- Manual edits must coordinate live DOM changes and source patches; doing only
  one side creates preview/source drift.
- Caption edit mode and DOM edit mode are mutually sensitive because both want
  preview overlay interaction.
- GSAP edits should be conservative when script shape is not recognized.

## 12. Next

Read [10-studio-captions-picker.md](10-studio-captions-picker.md) for caption
and picker/manual edit details.
