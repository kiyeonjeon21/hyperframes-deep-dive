# lint-rules

> Current baseline: v0.6.61. `lintHyperframeHtml()` composes eight synchronous
> rule modules plus two async URL check helpers. Unique lint codes found in the
> inspected checkout: 73.

## Rule modules

| Module | File | Main concern |
|---|---|---|
| core | `packages/core/src/lint/rules/core.ts` | root composition contract, timeline registry, deterministic JS, pointer events |
| media | `packages/core/src/lint/rules/media.ts` | video/audio/image timing, media IDs/src, imperative media control |
| gsap | `packages/core/src/lint/rules/gsap.ts` | GSAP script/timeline/selector/hard-kill patterns |
| captions | `packages/core/src/lint/rules/captions.ts` | caption root/transcript/text style pitfalls |
| composition | `packages/core/src/lint/rules/composition.ts` | timing density, deprecated attrs, variables, rAF hints |
| adapters | `packages/core/src/lint/rules/adapters.ts` | required Lottie/Three scripts |
| textures | `packages/core/src/lint/rules/textures.ts` | texture masks/classes/drop-shadow hazards |
| fonts | `packages/core/src/lint/rules/fonts.ts` | Google Fonts import and missing `@font-face` |

Async helpers in `hyperframeLinter.ts` add:

- `inaccessible_media_url`
- `inaccessible_script_url`

## Core

| Code | Meaning |
|---|---|
| `root_missing_composition_id` | root missing `data-composition-id` |
| `root_missing_dimensions` | root missing `data-width` / `data-height` |
| `missing_timeline_registry` | `window.__timelines` registry missing |
| `timeline_registry_missing_init` | timeline assignment without registry initialization |
| `timeline_id_mismatch` | registered timeline key does not match composition id |
| `invalid_inline_script_syntax` | inline script parse failure |
| `host_missing_composition_id` | sub-composition host missing id |
| `scoped_css_missing_wrapper` | scoped CSS target has no matching wrapper |
| `composition_self_attribute_selector` | self selector pattern risks scoping bugs |
| `studio_missing_editable_id` | Studio-editable element lacks a stable id |
| `non_deterministic_code` | code uses non-deterministic APIs |
| `pointer_events_none` | pointer-events can break picker/manual editing |

## Media

| Code | Meaning |
|---|---|
| `imperative_media_control` | script manually controls media playback/time |
| `duplicate_media_id` | duplicate media element id |
| `duplicate_media_discovery_risk` | ambiguous media discovery |
| `video_missing_muted` | video timing without muted/audio declaration |
| `video_muted_with_declared_audio` | contradictory muted/audio state |
| `video_nested_in_timed_element` | video inside another timed element |
| `self_closing_media_tag` | invalid self-closing media tag |
| `placeholder_media_url` | placeholder media URL |
| `base64_media_prohibited` | embedded base64 media |
| `media_missing_data_start` | media missing timing start |
| `media_missing_id` | timed media missing id |
| `media_missing_src` | media missing source |
| `media_preload_none` | preload blocks render readiness |
| `video_audio_double_source` | video/audio source duplication risk |

## GSAP

| Code | Meaning |
|---|---|
| `overlapping_gsap_tweens` | same property animated by overlapping tweens |
| `gsap_exit_missing_hard_kill` | exit animation lacks visibility/opacity hard kill |
| `gsap_animates_clip_element` | animation targets clip wrapper directly in risky way |
| `unscoped_gsap_selector` | selector can escape composition scope |
| `gsap_css_transform_conflict` | CSS transform and GSAP transform conflict |
| `missing_gsap_script` | GSAP usage without GSAP script |
| `audio_reactive_single_tween_per_group` | audio-reactive tween grouping hazard |
| `gsap_infinite_repeat` | infinite repeat breaks finite duration |
| `gsap_repeat_ceil_overshoot` | repeat math overshoots duration |
| `scene_layer_missing_visibility_kill` | scene transition lacks visibility hard kill |
| `gsap_timeline_not_registered` | timeline not registered in `window.__timelines` |
| `gsap_from_opacity_noop` | `from` opacity pattern likely no-ops |

## Captions

| Code | Meaning |
|---|---|
| `caption_exit_missing_hard_kill` | caption exit lacks hard kill |
| `caption_text_overflow_risk` | caption text may overflow |
| `caption_transcript_not_inline` | transcript source pattern not render-stable |
| `caption_transcript_parse_error` | transcript JSON parse failed |
| `caption_container_relative_position` | container positioning can break overlay math |
| `caption_overflow_clips_scaled_words` | overflow can clip scaled word effects |
| `caption_textshadow_on_group_container` | shadow applied to wrong caption layer |
| `caption_fittext_scale_mismatch` | fitText + transform scale mismatch |

## Composition

| Code | Meaning |
|---|---|
| `invalid_capture_path` | capture artifact path is invalid |
| `composition_file_too_large` | composition file is too large |
| `timeline_track_too_dense` | too many overlapping/tight clips on a track |
| `timed_element_missing_visibility_hidden` | timed element lacks initial hidden state |
| `deprecated_data_layer` | deprecated `data-layer` usage |
| `deprecated_data_end` | deprecated `data-end` usage |
| `split_data_attribute_selector` | split data-attribute selector risks parser mismatch |
| `template_literal_selector` | template literal selector cannot be safely analyzed |
| `external_script_dependency` | external script dependency risk |
| `timed_element_missing_clip_class` | visible timed element missing `class="clip"` |
| `overlapping_clips_same_track` | clips overlap on one track |
| `root_composition_missing_data_start` | root composition missing `data-start` |
| `standalone_composition_wrapped_in_template` | standalone composition wrapped in template |
| `root_composition_missing_html_wrapper` | missing full HTML wrapper |
| `requestanimationframe_in_composition` | rAF usage may require screenshot mode |
| `invalid_variable_values_json` | malformed `data-variable-values` |
| `invalid_composition_variables_declaration` | malformed `data-composition-variables` |

## Adapters, Textures, Fonts

| Code | Meaning |
|---|---|
| `missing_lottie_script` | Lottie usage without Lottie script |
| `missing_three_script` | Three usage without Three script |
| `texture_drop_shadow_on_text` | drop-shadow applied directly to texture text |
| `texture_class_missing_base` | texture class missing base texture setup |
| `texture_text_missing_mask` | texture text lacks required mask |
| `texture_class_unknown` | unknown texture class |
| `google_fonts_import` | Google Fonts import is non-deterministic for render |
| `font_family_without_font_face` | font family referenced without local `@font-face` |

## Async URL Checks

`lintMediaUrls(html)` and `lintScriptUrls(html)` perform network `HEAD` checks.
They are intentionally separate from the synchronous linter because they can be
slow or unavailable in offline CI.

## Usage patterns

```ts
import { lintHyperframeHtml } from "@hyperframes/core";

const result = await lintHyperframeHtml(html, { filePath: "index.html" });
```

CLI:

```bash
npx hyperframes lint
npx hyperframes render --strict-variables --variables-file vars.json
```

## Related

- [02-core-types-parsers.md](02-core-types-parsers.md)
- [12-variables-templates.md](12-variables-templates.md)
- upstream `docs/guides/common-mistakes.mdx`
