# lint-rules — full rule catalog

> Companion to note 02 §6. Tables of 56+ rules registered under `packages/core/src/lint/rules/*.ts`, grouped by module.  
> **Verification**: `grep -nE 'code:.*"' packages/core/src/lint/rules/*.ts | grep -v test`  
> **Updated**: 2026-05-05

Severity: **[E]** error · **[W]** warning · **[I]** info

---

## core.ts — 12 rules (322 lines)

Composition metadata / timeline registry / determinism / scoped CSS.

| code | sev | Summary |
|---|---|---|
| `root_missing_composition_id` | E | Root missing `data-composition-id` |
| `root_missing_dimensions` | E | Root missing `data-width` / `data-height` |
| `missing_timeline_registry` | E | `window.__timelines` not registered |
| `timeline_registry_missing_init` | E | Direct `window.__timelines[…] = …` without prior `__timelines = __timelines \|\| {}` |
| `timeline_id_mismatch` | E | `window.__timelines["foo"]` key ≠ `data-composition-id="foo"` |
| `invalid_inline_script_syntax` | E | (two triggers) bad `<script>` close / inline JS parse error |
| `host_missing_composition_id` | E | Sub-composition host (`data-composition-src`) missing id |
| `scoped_css_missing_wrapper` | W | Scoped CSS targets composition ID but no matching wrapper |
| `composition_self_attribute_selector` | W | `[data-composition-id="x"]` matches self → sibling instance bleed |
| `studio_missing_editable_id` | W | Timeline-editable element lacks id → Studio cannot pick stable edit target |
| `non_deterministic_code` | E | Detects `Math.random()` / `Date.now()` / `new Date()` / `performance.now()` / `crypto.getRandomValues()` |

Takeaway: `non_deterministic_code` is the first line of defense for deterministic renders.

---

## media.ts — 13 rules (465 lines)

Video/audio/image handling.

| code | sev | Summary |
|---|---|---|
| `imperative_media_control` | E | Inline `<script>` calls `media.play/pause/seek` — runtime must own media for determinism |
| `duplicate_media_id` | E | Duplicate media id definitions |
| `duplicate_media_discovery_risk` | W | Multiple media elements with same source/start/duration |
| `video_missing_muted` | E | `<video data-start>` without muted — use `data-has-audio="true"` or keep muted |
| `video_muted_with_declared_audio` | E | `data-has-audio="true"` + `muted` contradict — silent Studio preview |
| `video_nested_in_timed_element` | E | `<video data-start>` nested under another `data-start` parent → frozen in render |
| `self_closing_media_tag` | E | Self-closing `<video/>` invalid HTML — swallows following DOM → invisible composition |
| `placeholder_media_url` | E | Placeholder URL (likely 404) → render failure |
| `base64_media_prohibited` | E | Inline base64 audio/video — bloated files, render failures |
| `media_missing_data_start` | E | `<video src=...>` without `data-start` — preview/render mismatch |
| `media_missing_id` | E | Has `data-start` but no id — discovery fails → frozen/silent |
| `media_missing_src` | E | Has `data-start` but no src |
| `media_preload_none` | W | `preload="none"` blocks media load during render (compiler may strip; preview risk) |

Takeaway: media ownership = runtime. Imperative user control breaks determinism.

---

## gsap.ts — 10 rules (846 lines, largest module)

GSAP syntax / prop·ease whitelist / timing conflicts.

| code | sev | Summary |
|---|---|---|
| `overlapping_gsap_tweens` | W | Same selector + props with overlapping tweens |
| `gsap_exit_missing_hard_kill` | W | Exit lacks `visibility: hidden` or `opacity:0` hard kill → ghosting next scene |
| `gsap_animates_clip_element` | E | GSAP drives clip visibility/opacity — trespasses framework-managed layer |
| `unscoped_gsap_selector` | W | Selector matches other compositions when bundled |
| `gsap_css_transform_conflict` | W | CSS transform conflicts with GSAP transform |
| `missing_gsap_script` | E | GSAP usage detected but no GSAP CDN script |
| `audio_reactive_single_tween_per_group` | W | Multiple audio-reactive tweens per group — unstable sync |
| `gsap_infinite_repeat` | E | `repeat: -1` — infinite timeline breaks deterministic renders |
| `gsap_repeat_ceil_overshoot` | W | repeat × duration exceeds element duration |
| `scene_layer_missing_visibility_kill` | W | Scene transition missing visibility hard kill |

Takeaway: GSAP sits on note 03’s adapter pattern. Infinite repeat and unscoped selectors are common pitfalls.

---

## composition.ts — 14 rules (391 lines)

Sub-compositions / timing attrs / tracks.

| code | sev | Summary |
|---|---|---|
| `composition_file_too_large` | W | HTML very long — split sub-compositions (agent-friendly) |
| `timeline_track_too_dense` | W | Too many timed elements on one track |
| `timed_element_missing_visibility_hidden` | I | `data-start` without initial `class="clip"` / `visibility:hidden` / `opacity:0` |
| `deprecated_data_layer` | W | Prefer `data-track-index` over `data-layer` |
| `deprecated_data_end` | W | Prefer `data-duration` over `data-end` |
| `split_data_attribute_selector` | E | Split data-attribute selector matches wrongly |
| `template_literal_selector` | E | Template-literal-built selectors invisible to runtime |
| `external_script_dependency` | I | External CDN scripts — bundler hoists; custom pipelines may need manual steps |
| `timed_element_missing_clip_class` | W | Timing attrs without `class="clip"` — always visible |
| `overlapping_clips_same_track` | E | Two clips overlap on same track → render collision |
| `root_composition_missing_data_start` | W | Root lacks `data-start` (usually should be 0) |
| `standalone_composition_wrapped_in_template` | W | Standalone composition wrapped in `<template>` |
| `root_composition_missing_html_wrapper` | E | Root lacks `<html>` wrapper (linkedom returns null head/body) |
| `requestanimationframe_in_composition` | W | Raw `requestAnimationFrame()` — may bypass VIRTUAL_TIME_SHIM |

Takeaway: `requestanimationframe_in_composition` feeds into producer captureMode triple-condition (note 04).

---

## captions.ts — 8 rules (229 lines)

Caption timing / element requirements.

| code | sev | Summary |
|---|---|---|
| `caption_exit_missing_hard_kill` | W | Caption exit lacks hard kill |
| `caption_text_overflow_risk` | W | `white-space: nowrap` without max-width — long phrases clip |
| `caption_transcript_not_inline` | W | Transcript JSON not inline `<script type="application/json">` |
| `caption_transcript_parse_error` | W | Transcript JSON parse error |
| `caption_container_relative_position` | W | Caption container `position: relative` — stacking breaks |
| `caption_overflow_clips_scaled_words` | W | `overflow: hidden` + GSAP scale > 1 — scaled emphasis words clip |
| `caption_textshadow_on_group_container` | W | textShadow on group container breaks per-word glow |
| `caption_fittext_scale_mismatch` | W | `fitTextFontSize` conflicts with GSAP scale |

Takeaway: all warnings — captions are often wrong but rarely brick the whole composition.

---

## adapters.ts — 2 rules (53 lines, smallest module)

External library dependencies.

| code | sev | Summary |
|---|---|---|
| `missing_lottie_script` | E | With `data-lottie-src` or `lottie.loadAnimation`, require lottie CDN script |
| `missing_three_script` | E | With `THREE.`, require three.js CDN script |

GSAP is checked in `gsap.ts`. CSS/anime/WAAPI lack deep import analysis.

---

## Async URL checks — separate exports in `hyperframeLinter.ts`

| function | purpose |
|---|---|
| `lintMediaUrls(html, { timeoutMs })` | HEAD every `<video|audio|img|source src="https://...">` |
| `lintScriptUrls(html, { timeoutMs })` | HEAD every `<script src="https://...">` |

Findings:
- `inaccessible_media_url` (E) — non-2xx or timeout
- `inaccessible_script_url` (E) — non-2xx or timeout

Default timeout 8s. Concurrent fetch (`Promise.all`). Dedup by URL. **Core lint is synchronous**; URL checks are separate async calls.

---

## Usage patterns

```ts
// Synchronous (immediate)
const result = lintHyperframeHtml(html, { filePath: "index.html" });
if (!result.ok) {
  for (const f of result.findings) console.error(`[${f.severity}] ${f.code}: ${f.message}`);
}

// Async (network)
const mediaFindings = await lintMediaUrls(html, { timeoutMs: 8000 });
const scriptFindings = await lintScriptUrls(html);
const all = [...result.findings, ...mediaFindings, ...scriptFindings];
```

CLI `lint` is sync-only; `validate` adds sync + URL checks + contrast/layout audit (browser).

---

## Strict mode mapping (CLI)

`hyperframes render --strict` (`render.ts:198-199`):
- ≥1 error severity → block render

`hyperframes render --strict-all`:
- ≥1 error or warning → block render

Info severity always passes — guidance only.

---

## Stats — severity distribution

| module | E | W | I | total |
|---|---|---|---|---|
| core.ts | 8 | 3 | 0 | 11 (unique codes; `invalid_inline_script_syntax` counted once) |
| media.ts | 11 | 2 | 0 | 13 |
| gsap.ts | 3 | 7 | 0 | 10 |
| composition.ts | 4 | 8 | 2 | 14 |
| captions.ts | 0 | 8 | 0 | 8 |
| adapters.ts | 2 | 0 | 0 | 2 |
| URL (async) | 2 | 0 | 0 | 2 |
| **total** | **30** | **28** | **2** | **60** |

Mostly errors or warnings; only two info hints.

---

## Related

- ← [Note 02 §6](02-core-types-parsers.md) — six module categories + entrypoints
- ↗ [Note 04 §3.4 / 05 §4.2](04-engine-capture.md) — `requestanimationframe_in_composition` in captureMode triple
- ↗ [Note 06](06-cli-orchestration.md) — `lint` / `validate` invoke these rules
- ↗ [PoC 01](../projects/01-frame-adapter-poc/) — update `adapters.ts` when adding adapters
