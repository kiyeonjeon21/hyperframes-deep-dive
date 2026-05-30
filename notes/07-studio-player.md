# 07-studio-player

> The player package is a vanilla custom element. Studio wraps and reaches into
> it through a same-origin iframe bridge. The current code is more modular than
> the original notes: player internals are split across helper modules, and
> Studio playback logic lives under `packages/studio/src/player/`.

## 1. Boundary

| Package | Role |
|---|---|
| `@hyperframes/player` | embeddable `<hyperframes-player>` custom element, controls, iframe setup |
| `@hyperframes/studio` | React UI, NLE layout, timeline state, editing, captions, render queue |
| composition iframe | actual runtime globals: `__hf`, `__player`, `__timelines`, DOM |

The player is not a React component. Studio uses React components around it.

## 2. Player package

Start with:

- `packages/player/src/hyperframes-player.ts`
- `packages/player/src/composition-probe.ts`
- `packages/player/src/timeline-adapters.ts`
- `packages/player/src/direct-timeline-clock.ts`
- `packages/player/src/runtime-message-handler.ts`
- `packages/player/src/controls.ts`
- `packages/player/src/shader-options.ts`

`HyperframesPlayer` owns:

- shadow DOM and controls
- iframe creation and URL/srcdoc handling
- runtime injection decision
- direct same-origin seek fast path
- postMessage fallback
- playback rate/volume state
- shader loading options
- timeline probing

## 3. Runtime injection decision

The player tries to avoid double-injecting runtime code. `shouldInjectRuntime`
checks whether the iframe already exposes:

- `window.__hf`
- `window.__player`
- `window.__timelines`

If a plain composition lacks runtime, the player can inject it. If a composition
already registered a GSAP timeline, the player can drive it directly.

## 4. Direct timeline fallback

The player can control same-origin compositions even when `__player` is absent:

- detect `window.__timelines`
- wrap a GSAP-like timeline
- seek/play/pause directly
- use a direct timeline clock for controls

This is useful for authored demos and partial runtime states, but the full
runtime bridge is still the richer path.

## 5. Shader loading options

Player supports query/global options for shader transition preview:

- `__hf_shader_capture_scale`
- `__hf_shader_loading`
- corresponding globals injected into `srcdoc`

These let player-controlled previews show shader snapshot/loading progress
without each composition manually wiring UI.

## 6. Studio playback module

Read `packages/studio/src/player/`.

Important files:

- `store/playerStore.ts` - Zustand state plus `liveTime` pub-sub
- `hooks/useTimelinePlayer.ts` - iframe bridge and playback loop
- `lib/playbackAdapter.ts` - adapter wrappers
- `lib/timelineDOM.ts` - parse timeline elements from live DOM
- `lib/timelineIframeHelpers.ts` - same-origin iframe helpers
- `components/Timeline.tsx` and related timeline UI modules

The `liveTime` channel is important: it updates high-frequency playback time
without forcing React to rerender the whole Studio tree every frame.

## 7. `useTimelinePlayer` mental model

`useTimelinePlayer` maintains an iframe ref and repeatedly resolves the best
playback adapter:

1. prefer `window.__player` if duration is usable
2. fall back to `window.__timeline`
3. fall back to `window.__timelines[rootCompositionId]`
4. if document duration exceeds adapter duration, wrap the adapter with a static
   seek playback adapter so the slider covers the full document range

It also:

- synchronizes timeline elements into Zustand
- probes media duration cheaply with mediabunny helpers
- applies preview mute/playback-rate state
- supports reverse/shuttle playback
- installs playback keyboard shortcuts
- keeps the timeline ready state in sync

## 8. Timeline discovery

Studio timeline elements are derived from the live DOM, not from a separate
author-maintained JSON file. That means:

- timing attrs matter (`data-start`, `data-duration`, `data-track-index`)
- media metadata may be enriched asynchronously
- sub-composition timeline/duration can be resolved through iframe globals
- DOM edits can immediately reflect in the timeline after refresh

## 9. Player vs Studio responsibilities

| Concern | Player | Studio |
|---|---|---|
| iframe creation | yes | consumes ref |
| basic controls | yes | enhanced NLE controls |
| playback adapter probing | yes | deeper bridge and timeline sync |
| source file editing | no | yes |
| DOM selection/manual edits | no | yes |
| caption editing | no | yes |
| render queue | no | yes |

## 10. Sharp edges

- Same-origin iframe access is central to Studio. Cross-origin embeds need
  postMessage-style fallbacks and cannot support every manual editing feature.
- A `__player` object without usable duration may be worse than a direct timeline
  fallback; both player and Studio probe capabilities defensively.
- Timeline key ordering can be misleading when sub-compositions exist. Prefer the
  root `data-composition-id` when choosing `window.__timelines[key]`.
- High-frequency time updates should go through `liveTime`, not broad React
  state churn.

## 11. Next

Read [08-shader-transitions.md](08-shader-transitions.md), then return to
[09-studio-editing.md](09-studio-editing.md) for the editing side.
