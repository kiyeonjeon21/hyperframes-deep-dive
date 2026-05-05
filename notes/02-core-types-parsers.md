# 02-core-types-parsers

> One-line summary: `@hyperframes/core` is a package that layers a **single-file type hub** + **DOMParser-based HTML parser** + **regex-based GSAP parser** + **six rule modules in the linter** + **HTML serializer** on top of 11 export domains in the catalog (`index.ts:1-192`). Browser runtime is covered in note 03.

---

## 1. Eleven export domains in `index.ts`

`packages/core/src/index.ts:1-192` is a catalog file. It contains no implementation of its own—only re-exports of other modules grouped by domain.

| Domain | Lines | Key exports |
|---|---|---|
| Types | 2-50 | `TimelineElement`, `Keyframe`, `PlayerAPI`, `CompositionVariable`, `CANVAS_DIMENSIONS`, etc. |
| Templates | 53-61 | `generateBaseHtml`, `BASE_STYLES`, `GSAP_CDN`, etc. |
| Parsers | 63-89 | `parseHtml`, `parseGsapScript`, `SUPPORTED_PROPS`, `SUPPORTED_EASES` |
| Generators | 91-98 | `generateHyperframesHtml`, `generateGsapTimelineScript`, `generateHyperframesStyles` |
| Compiler | 100-114 | `compileTimingAttrs`, `injectDurations` (browser-safe) |
| Lint | 116-128 | `lintHyperframeHtml` + four types + asset path rewriting |
| Inline scripts | 130-158 | Runtime contract, picker API, media parity contract |
| Frame adapters | 160-163 | `FrameAdapter`, `createGSAPFrameAdapter` (15 + 44 lines total) |
| Text measurement | 165-167 | `fitTextFontSize` |
| Registry | 169-191 | `RegistryItem`, `ITEM_TYPES`, `FILE_TYPES` |

**Observation**: “Inline scripts” is split out because the code-inline moment (`generated/runtime-inline.ts`) pulls in artifacts produced at build time. The `build:hyperframes-runtime:modular` script compiles the `runtime/` directory into a single JS string and generates this file.

---

## 2. Type hub — `core.types.ts` in one file

Almost all **cross-package types** live in one ~390-line file. A single-module strategy rather than a deep tree.

### 2.1 `TimelineElement` discriminated union (lines 19, 163–178)

```ts
type TimelineElementType = "video" | "image" | "text" | "audio" | "composition";
type MediaElementType   = "video" | "image" | "audio";  // excludes text/composition

interface TimelineElementBase { id, type, name, startTime, duration, zIndex, x?, y?, scale?, opacity? }

interface TimelineMediaElement extends TimelineElementBase   { type: MediaElementType; src; mediaStartTime?; sourceDuration?; isAroll?; volume?; hasAudio? }
interface TimelineTextElement extends TimelineElementBase    { type: "text"; content; color?; fontSize?; textShadow?; textOutline?; textHighlight?; ... }
interface TimelineCompositionElement extends TimelineElementBase { type: "composition"; src; compositionId; variableValues?; sourceWidth?; sourceHeight? }

type TimelineElement = TimelineMediaElement | TimelineTextElement | TimelineCompositionElement;
```

Three guard functions (`isTextElement`, `isMediaElement`, `isCompositionElement`) are at lines 168–178. Each is a single line `el.type === ...`.

**Subtlety of the discriminator**: `TimelineMediaElement.type` is `MediaElementType` (three variants) but `TimelineElementBase.type` is `TimelineElementType` (five variants). TypeScript narrows so that only video/image/audio are allowed for media.

### 2.2 Five `CompositionVariable` kinds (lines 88–161)

`String|Number|Color|Boolean|Enum` all extend `CompositionVariableBase` (`id`, `type`, `label`, `description?`) with their own type literal and extra fields. Five guards (`isStringVariable`, etc.) sit uniformly at lines 143–161.

Only `NumberVariable` carries extra metadata like `min`/`max`/`step`/`unit` — for slider rendering in the UI.

#### Variable substitution — **iframe URL query params** (verified 2026-05-05)

`generators/hyperframes.ts:533-547`. **Not** inline HTML text substitution — *raw data* is passed via sub-composition iframe URL query params:

```ts
// generateElementHtml(composition element):
if (element.variableValues && Object.keys(element.variableValues).length > 0) {
  const varJson = JSON.stringify(element.variableValues);
  compositionAttrs.push(`data-variable-values='${varJson.replace(/'/g, "&#39;")}'`);
}
let iframeSrc = element.src.split("?")[0];
if (element.variableValues && Object.keys(element.variableValues).length > 0) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(element.variableValues)) {
    params.set(key, String(value));
  }
  iframeSrc = `${iframeSrc}?${params.toString()}`;
}
return `<div ... data-variable-values='...'>
  <iframe src="${iframeSrc}" sandbox="allow-scripts allow-same-origin" ... />
</div>`;
```

**Flow**:
```
Studio UI (or user code)
  → variableValues object updated: { title: "Hello", color: "#ff0000" }
  → HTML rebuild (parseHtml + generateHyperframesHtml)
  → <iframe src="subcomp.html?title=Hello&color=%23ff0000">
  → User script inside sub-composition:
      const params = new URLSearchParams(location.search);
      document.querySelector('h1').textContent = params.get('title');
      document.body.style.backgroundColor = params.get('color');
```

**Meaning**:
- Variables are passed only as *raw string values* (URLs are string-only). Number/Boolean/Enum are stringified (caller parses with parseInt/parseFloat).
- **Caller’s responsibility** to consume them. core/runtime does not auto-substitute — composition authors use `URLSearchParams` directly.
- This applies to sub-composition iframes only. **Top-level composition variable injection is separate** — `extractCompositionMetadata` (`htmlParser.ts:756) exposes definitions via `data-composition-variables`, but *value* injection is cli/studio responsibility.
- Studio spawns variable input UI as a form → user input → on next compile, values flow into query params.

**Relation to `recompileWithResolutions`**: Independent. `recompileWithResolutions` recompiles sub-comp HTML *after duration resolution*. Variable updates go through the *parseHtml ↔ generateHyperframesHtml cycle* (all elements reprocessed each time).

### 2.3 `PlayerAPI` — runtime interface (lines 218–298)

Forty-three methods. Grouped by role:

- **Time / playback**: `play`, `pause`, `seek`, `getTime`, `getDuration`, `isPlaying`, `getMainTimeline`
- **Element lookup / inspection**: `getElementBounds`, `getElementsAtPoint`, `getElementVisibility`, `getVisibleElements`
- **Element position / scale**: `setElementPosition`, `previewElementPosition`, `setElementScale`
- **Text styling**: eight methods (`setElementFontSize`, `setElementTextContent`, `...TextColor`, `...TextShadow`, `...FontWeight`, `...FontFamily`, `...TextOutline`, `...TextHighlight`)
- **Audio**: `setElementVolume`
- **Stage zoom**: `setStageZoom`, `getStageZoom`, `setStageZoomKeyframes`, `getStageZoomKeyframes`
- **Add/remove/timing**: `addElement(AddElementData)`, `removeElement`, `updateElementTiming`, `setElementTiming`, `updateElementSrc`, `updateElementLayer`, `updateElementBasePosition`
- **Timeline lifecycle**: `markTimelineDirty`, `isTimelineDirty`, `rebuildTimeline`, `ensureTimeline`
- **Render mode**: `enableRenderMode`, `disableRenderMode`, `renderSeek` — invoked by the engine for deterministic capture
- **Render state**: `getRenderState()` → `{ time, duration, isPlaying, renderMode, timelineDirty }`

**Important**: The **implementation** of this interface is `core/runtime/init.ts:76-149` (note 03). `core.types.ts` carries *signatures only*.

### 2.4 Three static constants

```ts
CANVAS_DIMENSIONS = { landscape: { 1920, 1080 }, portrait: { 1080, 1920 } }  // lines 24–27
TIMELINE_COLORS   = { video:'#ec4899', image:'#3b82f6', text:'#06b6d4', audio:'#10b981', composition:'#f97316' }  // 192–198
DEFAULT_DURATIONS = { video:5, image:5, text:2, audio:5, composition:5 }  // 200–206
```

`as const` preserves literal types. Note that `text` defaults to 2 seconds.

---

## 3. HTML parser — `parseHtml(html)`

`packages/core/src/parsers/htmlParser.ts:140-445`. The whole pipeline is one function. Steps:

### 3.1 Entry and DOM build (140–157)

```ts
const parser = new DOMParser();        // ← environment-dependent (browser or linkedom polyfill)
const doc = parser.parseFromString(html, "text/html");
```

**Note**: `index.ts` does *not* import linkedom directly. Callers (browser or Node) must have a global `DOMParser`.
- Browser runtime → native `DOMParser`
- Node → caller polyfills with linkedom/jsdom (the producer does this)

### 3.2 Discover timed elements (159–177)

```ts
const timedElements = doc.querySelectorAll("[data-start]");
```

**`data-start` marks timeline elements**. Without it, the DOM is static. With it, extraction as a timeline element is attempted.

### 3.3 Infer element type (33–54)

```ts
function getElementType(el: Element): TimelineElementType | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "video") return "video";
  if (tag === "img")   return "image";
  if (tag === "audio") return "audio";

  const dataType = el.getAttribute("data-type");
  if (dataType === "composition") return "composition";
  if (dataType === "text")        return "text";

  // Fallback: div/p/h1/h2/h3/span = text
  if (["div","p","h1","h2","h3","span"].includes(tag)) return "text";
  return null;
}
```

Principle: **prefer standard HTML semantics** (video/img/audio tag names), `data-type` as a hint. Text fallback is for backwards compatibility.

### 3.4 Duration resolution (165–173)

```ts
const start = parseFloat(el.getAttribute("data-start") || "0");
const dataEnd = el.getAttribute("data-end");
let duration: number;
if (dataEnd) {
  duration = Math.max(0, parseFloat(dataEnd) - start);
} else {
  duration = 5;        // ← fallback (not tied to DEFAULT_DURATIONS)
}
```

Only **`data-end`** is read, not `data-duration`. The formal hyperframes surface is `[data-start, data-end]`; `duration` is derived. (Text has `DEFAULT_DURATIONS.text = 2` but this fallback is 5 seconds — slight inconsistency.)

### 3.5 Identify GSAP script (341–353)

```ts
for (const script of scriptTags) {
  const src = script.getAttribute("src");
  if (src && src.includes("gsap")) continue;     // skip gsap CDN script
  const content = script.textContent?.trim();
  if (content && (content.includes("gsap") || content.includes("timeline"))) {
    gsapScript = content;
    break;
  }
}
```

Ignores CDN (`gsap.min.js`) and extracts one inline GSAP block. A second inline GSAP script is ignored.

### 3.6 Merge GSAP `set(...)` positions (356–371)

```ts
if (gsapScript) {
  const positionMap = extractPositionsFromGsap(gsapScript);  // 485–525
  for (const element of elements) {
    const pos = positionMap.get(element.id);
    if (pos) {
      if (pos.x !== undefined) element.x = pos.x;
      if (pos.y !== undefined) element.y = pos.y;
      if (pos.scale !== undefined && /* media or composition */) (...).scale = pos.scale;
    }
  }
}
```

**GSAP `set(target, {x, y, scale}, 0)` is absorbed as the element’s *base position***:

```js
gsap.timeline().set("#title", { x: 100, y: 50, scale: 1.5 }, 0);
```

After `parseHtml`, `elements[i].x === 100, y === 50, scale === 1.5`. Treated as static start position, not a separate keyframe.

### 3.7 Keyframe normalization — absolute vs relative auto-detection (373–386, 527–574)

Tricky part. If an element has a base position (`x=100, y=50, scale=1.5`) and keyframes at `time=0` reuse those absolute values, hyperframes converts them to *relative* (delta) values.

```ts
const treatAsAbsolute = timeZeroKeyframes.some((kf) => {
  return hasBaseCheck(props.x, baseX) ||
         hasBaseCheck(props.y, baseY) ||
         (baseScale !== 1 && hasBaseCheck(props.scale, baseScale));
});

return keyframes.map((kf) => {
  // ...
  if (treatAsAbsolute && key === "x") normalizedProps.x = value - baseX;
  if (treatAsAbsolute && key === "y") normalizedProps.y = value - baseY;
  if (treatAsAbsolute && key === "scale") normalizedProps.scale = value / baseScale;
});
```

**Why?** So that when Studio drags an element and only the base position updates, keyframes can follow automatically. If keyframe values match the base, “absolute coordinate input mode” is inferred. If not, they are treated as already relative and conversion is skipped.

**Bounds**: `valueEpsilon = 0.00001`, `timeEpsilon = 0.001` — float stability.

### 3.8 Extract keyframes from GSAP (408–432)

Without a `data-keyframes` attribute, GSAP animations are converted to keyframes:

```ts
const elementAnimations = getAnimationsForElement(parsed.animations, element.id);
const elementKeyframes = gsapAnimationsToKeyframes(elementAnimations, element.startTime, {
  baseX, baseY, baseScale, clampTimeToZero: true, skipBaseSet: true,
});
```

Conversion lives in `gsapParser.ts` (next section).

### 3.9 Stage zoom keyframes (447–479)

If `#stage-zoom-container` has `data-zoom-keyframes` as a JSON array, it is extracted as-is. Shape validation (id, time, zoom.scale, zoom.focusX, zoom.focusY as string/number) before acceptance.

### 3.10 Secondary exports

- `updateElementInHtml(html, id, updates)` (576–656): attribute updates (`data-start`, `data-end`, `data-name`, `data-layer`, `src`, `content`, `color`, …)
- `addElementToHtml(html, element)` (658–736): add element. Container priority: `#stage-zoom-container` → `.container` → `#stage` → `body`.
- `removeElementFromHtml(html, id)` (738–748): `el.remove()`
- `extractCompositionMetadata(html)` (756–773): read meta from `<html data-composition-id ...>`. Variable definitions via `data-composition-variables` JSON.
- `validateCompositionHtml(html)` (812–865): fast validation separate from linter (blocks inline event handlers / `javascript:` URLs, etc.)

---

## 4. GSAP parser — regex-based

`packages/core/src/parsers/gsapParser.ts`. No AST — regex + brace matching.

### 4.1 `SUPPORTED_PROPS` / `SUPPORTED_EASES` (lines 25–65)

```ts
const SUPPORTED_PROPS = [
  "opacity", "visibility", "x", "y",
  "scale", "scaleX", "scaleY", "rotation",
  "autoAlpha", "width", "height",
];  // 11

const SUPPORTED_EASES = [
  "none",
  "power1.in", "power1.out", "power1.inOut",
  ...power4...,
  "back.in", "back.out", "back.inOut",
  "elastic.in", "elastic.out", "elastic.inOut",
  "bounce.in", "bounce.out", "bounce.inOut",
  "expo.in", "expo.out", "expo.inOut",
];  // 25 (including none)
```

`validateCompositionGsap` returns lint warnings or errors for prop/ease outside these lists.

### 4.2 `parseGsapScript` steps (109–153)

1. **Find timeline variable**: match `(?:const|let|var)\s+(\w+)\s*=\s*gsap\.timeline`. If missing, assume `tl`.
2. **Extract preamble**: text before the timeline declaration (preserved for reserialization)
3. **Method pattern**: global match `${timelineVar}\.(set|to|from|fromTo)\s*\(([^)]+(?:\{[^}]*\}[^)]*)+)\)`
4. **Per match**: call `parseGsapCall(method, argsStr, idNum)`

### 4.3 `parseObjectLiteral(str)` (67–95)

```ts
const propRegex = /(\w+)\s*:\s*("[^"]*"|'[^']*'|[\d.]+|[a-zA-Z_][\w.]*)/g;
```

Regex grabs key:value pairs. Values: double-quoted string, single-quoted, number, or identifier (e.g. `power1.out`). Numbers are coerced with `Number()`.

**Limitation**: nested objects/arrays and function calls are not parsed. Enough for simple GSAP `set/to/from/fromTo` calls.

### 4.4 `findMatchingBrace(str, startIndex)` (97–107)

Depth counter to find matching braces. Works with the flat object assumption in `parseObjectLiteral`.

### 4.5 `parseGsapCall(method, argsStr, idNum)` (156–200+)

`fromTo` extracts two object literals (from + to); others one object. Also parses timeline position (`,\s*([\d.]+)`) — GSAP’s *absolute time position*.

**`fromTo` handling**:
1. First brace pair → `fromProperties`
2. Second brace pair → `properties`
3. Trailing comma + number → position

### 4.6 `gsapAnimationsToKeyframes` / `keyframesToGsapAnimations`

(Bidirectional helpers later in the file — read source for detail.) Core behavior:
- `set(...)` at position 0 with `skipBaseSet:true` → absorbed as base position only, no keyframe
- `to(...)` → two keyframes between previous anim end and `position`
- `fromTo(...)` → two explicit keyframes between `fromProperties` and `properties`
- `clampTimeToZero:true` → `time = max(0, position - element.startTime)`

---

## 5. HTML serializer — `generators/hyperframes.ts`

`packages/core/src/generators/hyperframes.ts`. Inverse of the parser plus extra decisions.

### 5.1 Stage positioning convention (documented in comments at lines 55–74)

```
1. Every element is absolutely positioned relative to the #stage container
2. #stage is position:relative with fixed dimensions (1920×1080 or 1080×1920)
3. Elements start opacity:0; GSAP reveals them

Media (video, image):
  - position: absolute (relative to #stage)
  - width: 100%, height: 100% (fill stage)
  - object-fit: contain (preserve aspect, centered, no crop)

Text:
  - position: absolute, width/height: 100%
  - child div centers with flexbox

Audio:
  - position: absolute (invisible; timing only)
```

This convention **pins pixel determinism**: coordinates use (0,0) top-left; all elements share the same resolution (1920×1080), so GSAP `set(x, y)` maps directly to pixels.

### 5.2 `sortElements(elements)` (75–82)

```ts
return [...elements].sort((a, b) => {
  if (a.zIndex !== b.zIndex) return (a.zIndex ?? 0) - (b.zIndex ?? 0);
  return a.startTime - b.startTime;
});
```

`zIndex` first; tie-break on `startTime`. **DOM order** affects stacking when `z-index` ties (later DOM wins).

### 5.3 `generateGoogleFontsUrl(fontFamilies)` (28–41)

Builds Google Fonts URLs only for 12 predefined families (`FONT_WEIGHTS`, lines 13–26). Other fonts must be loaded manually.

```ts
FONT_WEIGHTS = {
  Inter: "400;500;600;700;800;900",
  Roboto: "400;500;700;900",
  Montserrat: "400;500;600;700;800;900",
  Poppins: "400;500;600;700;800;900",
  "Bebas Neue": "400",
  Oswald: "400;500;600;700",
  Anton: "400",
  "Playfair Display": "400;500;600;700;800;900",
  Lora: "400;500;600;700",
  Pacifico: "400",
  "Permanent Marker": "400",
  "Fira Code": "400;500;600;700",
};
```

**Inter is always included** (line 101): default typeface.

### 5.4 `generateElementStyles(element)` (120–164)

Per-element CSS lines:

- **text**: child div — font/size/color/shadow/outline/highlight. `box-decoration-break: clone` avoids clipped highlights across line breaks
- **video**: `width:100%; height:100%; object-fit:contain; transform-origin:center center;`
- **image**: `max-width:100%; max-height:100%; transform-origin:center center;` (differs from video)
- **audio**: `position:absolute;` only (invisible)
- **composition**: same as video

**Video vs image**: video stretches with `width/height: 100%`; image keeps small assets small with `max-width/max-height: 100%`.

### 5.5 `generateGsapTimelineScript` (166+)

(Long file — 200+ lines) Essentials:
1. Convert keyframes → GSAP animations (relative to each element’s base x/y/scale)
2. `serializeGsapAnimations` → GSAP code string
3. Combine preamble + animations + postamble
4. Register timeline (`window.__timelines[compositionId] = tl`)

---

## 6. Linter — six rule modules

### 6.1 Entry — `lintHyperframeHtml(html, options)` (~228 lines, 20–54)

```ts
const ALL_RULES = [...coreRules, ...mediaRules, ...gsapRules, ...captionRules, ...compositionRules, ...adapterRules];

for (const rule of ALL_RULES) {
  for (const finding of rule(ctx)) {
    const dedupeKey = [code, severity, selector, elementId, message].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey); findings.push(finding);
  }
}
```

Iterate rules + dedupe. Result: `errorCount` / `warningCount` / `infoCount` + `findings`.

### 6.2 Six modules — size

| Module | Lines | Rules | Area |
|---|---|---|---|
| `core.ts` | 322 | 11 | composition meta, timeline registry, determinism, scoped CSS |
| `media.ts` | 465 | 13 | missing src, codec, audio accessibility |
| `gsap.ts` | 846 | 10 | GSAP syntax, prop/ease whitelist, timing conflicts |
| `composition.ts` | 391 | 14 | sub-compositions, deprecated attrs, track management |
| `captions.ts` | 229 | 8 | caption timing, element requirements |
| `adapters.ts` | 53 | 2 | Lottie/Three.js script presence |
| (URL async) | — | 2 | HEAD checks for media/script URLs |
| **Total** | | **60** | |

Full catalog: [`notes/lint-rules.md`](lint-rules.md) — all 60 rules in per-module tables.

### 6.3 Core rules — `core.ts`

Seven important rules (lines 58–322):

- `root_missing_composition_id` / `root_missing_dimensions` (60–83): require `<html data-composition-id>`, `data-width`, `data-height`
- `missing_timeline_registry` / `timeline_registry_missing_init` (85–113): `window.__timelines = window.__timelines || {};` + registration
- `timeline_id_mismatch` (115–140): `window.__timelines["foo"]` key vs `data-composition-id="foo"`
- `invalid_inline_script_syntax` (142–172): bad `</script>` closure or inline JS parse errors
- `host_missing_composition_id` (174–191): sub-composition host missing id
- `scoped_css_missing_wrapper` (193–214): scoped CSS without matching wrapper
- `composition_self_attribute_selector` (216–248): `[data-composition-id="x"]` matches self (leaks to sibling instances)
- `studio_missing_editable_id` (250–272): editable Studio element missing id (drag/scrub stability)
- **`non_deterministic_code` (274–321)**: detects `Math.random()`, `Date.now()`, `new Date()`, `performance.now()`, `crypto.getRandomValues()`. Core to deterministic render.

### 6.4 Async URL checks — `lintMediaUrls`, `lintScriptUrls` (56–228)

Optional, separate from sync lint. HEAD requests for `https://` in `<video|audio|img|source src>` or `<script src>`; non-200 → error.

```ts
const checks = unique.map(async ({ url, ... }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);  // 8s default
  const resp = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
  if (!resp.ok) findings.push({ ... });
});
await Promise.all(checks);
```

**Why split?** Sync lint is fast/deterministic and IDE-friendly. URL checks are network-dependent → separate step.

### 6.5 Adapter rules — lightest module (`adapters.ts`, 53 lines)

Two checks only:
- `missing_lottie_script`: if `data-lottie-src` or `lottie.loadAnimation`, require `src=*lottie*` script
- `missing_three_script`: if `THREE.` is used, require `src=*three*` script

**Observation**: GSAP is not enforced (CDN URLs are common and the generator adds them). Lottie/Three are user responsibility.

---

## 7. Call trace — one composition from parse to serialize

```
User HTML: composition.html
  │
  ▼ parseHtml(html)
ParsedHtml { elements, gsapScript, styles, resolution, keyframes, stageZoomKeyframes }
  │
  ├── validateCompositionHtml(html) → ValidationResult (fast path)
  │       or
  ├── lintHyperframeHtml(html) → six modules fan-out → HyperframeLintResult
  │
  ├── element edits (Studio):
  │     updateElementInHtml(html, id, updates) → new html string
  │     addElementToHtml(html, element)        → { html, id }
  │     removeElementFromHtml(html, id)        → new html
  │
  ▼ generateHyperframesHtml(parsed) — no single export; combination of:
generateHyperframesStyles(elements, resolution, customStyles)  → { coreCss, customCss, googleFontsLink }
generateGsapTimelineScript(elements, totalDuration, options)     → "const tl = gsap.timeline...; ..."
templates/base.ts: generateBaseHtml(...)                         → skeleton HTML

  ▼
Final HTML (browser deliverable)
```

The producer uses this flow when compiling a composition (note 05).

---

## 8. Registry — schemas + remote fetch (verified 2026-05-05)

`packages/core/src/registry/types.ts` (~174 lines) + `packages/cli/src/registry/remote.ts` (~144 lines). Registry uses **GitHub raw URL conventions** — no separate server.

### 8.1 Three-tier item hierarchy

```ts
type ItemType = "hyperframes:example" | "hyperframes:block" | "hyperframes:component";
```

| Type | Purpose | Install command | dimensions/duration |
|---|---|---|---|
| `ExampleItem` | Full project (composition + assets) | `hyperframes init --example <name>` | required |
| `BlockItem` | One sub-composition (standalone HTML) | `hyperframes add <name>` | required |
| `ComponentItem` | effect/snippet (merge into host) | `hyperframes add <name>` | **none** (inherited from host) |

Three type guards: `isExampleItem`, `isBlockItem`, `isComponentItem` (lines 164–174).

### 8.2 Five `FileTarget` kinds — installer behavior

```ts
type FileType =
  | "hyperframes:composition"  // .html — composition file
  | "hyperframes:asset"        // .mp4/.png/.svg/etc — media
  | "hyperframes:snippet"      // .js/.ts — script code
  | "hyperframes:style"        // .css — stylesheet
  | "hyperframes:timeline";    // .json — GSAP timeline meta
```

- `composition` → `compositions/` (or `hyperframes.json#paths` override)
- `asset` → `assets/`
- `snippet` → `<script>` inject or separate file
- `style` → `styles/` or inline
- `timeline` → sidecar `*.timeline.json`

### 8.3 GitHub conventions fetch — `cli/registry/remote.ts:26-27`

```ts
const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry";
```

URL layout:
```
<base>/registry.json                               ← top-level index (~50-line JSON)
<base>/<type-dir>/<name>/registry-item.json        ← item metadata
<base>/<type-dir>/<name>/<file.path>               ← individual files
```

`<type-dir>` = `examples` / `blocks` / `components` (`ITEM_TYPE_DIRS`, lines 144–148).

### 8.4 24h cache (`~/.hyperframes/cache/`)

`remote.ts:35-36`:
```ts
const CACHE_DIR = join(homedir(), ".hyperframes", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
```

**Cached**: `registry.json` + each item’s `registry-item.json`. **Not cached**: actual files (assets/HTML/etc.) — always fresh on install.

Cache miss fail-open (offline / 404 → `undefined`).

### 8.5 Call trace — `hyperframes add lower-third`

```
cli/commands/add.ts:run()
  ├─ fetchRegistryManifest(baseUrl)           remote.ts:85-99
  │     readCache → immediate return on hit
  │     fetch <baseUrl>/registry.json (10s timeout)
  │     writeCache + return
  │
  ├─ match name + type from manifest.items
  │
  ├─ fetchItemManifest(name, type)             remote.ts:105-119
  │     ITEM_TYPE_DIRS[type] → "components"
  │     fetch <baseUrl>/components/lower-third/registry-item.json
  │
  ├─ for file in item.files:
  │     remap target by hyperframes.json#paths
  │     assertSafeTarget (no path traversal)
  │     fetchItemFile(item, file, destPath)    remote.ts:125-143
  │           assert no `..` in file.path
  │           fetch raw bytes (NOT cached)
  │           writeFileSync(destPath)
  │
  └─ for dep in item.registryDependencies:
        recursive install
```

### 8.6 Security

- **Path traversal**: both `file.path` and `file.target` block `..` (lines 131–134 + `installer.ts`).
- **Timeout**: all fetches 10s (`AbortSignal.timeout(10_000)`).
- **JSON Schema**: `packages/core/schemas/{registry,registry-item}.json`. `$schema` URLs hosted at `https://hyperframes.heygen.com/schema/...` (IDE autocomplete).

### 8.7 Compile-time exhaustiveness guard (`types.ts:153-160`)

```ts
type _AssertItemTypesExhaustive =
  Exclude<ItemType, (typeof ITEM_TYPES)[number]> extends never ? true : never;
const _itemTypesExhaustive: _AssertItemTypesExhaustive = true;
```

Adding a case to `ItemType` without updating `ITEM_TYPES` → **TypeScript compile error**. JSON Schema enum drift is guarded in `types.test.ts`.

### 8.8 Relation to `hyperframe-deep-dive` lab

Skill `hyperframes-registry` (note 01, section 8.5) ↔ lab note 02, section 8 — two views:
- skill: how users run `hyperframes add` / `catalog`
- lab: internals (cache, fetch, install)

For PoC track B you can run `hyperframes catalog --search` or `hyperframes add` to feel the cache/fetch flow.

---

## 9. Contrast with Remotion

| Aspect | Remotion | Hyperframes core |
|---|---|---|
| Composition definition | React components + Zod | HTML + data attrs + JSON schema |
| Types | inferred from code | declared in `core.types.ts` |
| Time API | `useCurrentFrame()` | `data-start` / `data-end` |
| Variables | Zod → composition props | `CompositionVariable` (five kinds) → JSON attrs |
| Styling | free (React + CSS-in-JS, etc.) | stage positioning convention |
| Determinism checks | mostly developer responsibility | `non_deterministic_code` lint |

---

## 10. Tricky areas — recheck list

1. **DOMParser fallback**: Node callers without polyfill throw immediately. core does not import linkedom (bundle size + browser compatibility); producer/cli own that responsibility.
2. **Keyframe absolute→relative heuristic**: float comparison; “absolute-looking” keyframes could mis-convert in theory (e.g. accidental match with base) — rare in practice.
3. **GSAP parser is regex**: fancier GSAP calls break parsing; `gsap.ts` lint (~846 lines) largely cages users to `SUPPORTED_PROPS` / `SUPPORTED_EASES`.
4. **`data-end` vs `data-duration`**: parser only reads `data-end`. Updates also use `data-end` (`updateElementInHtml` strips legacy `data-duration`). Prefer `data-end` in new HTML.
5. **`extractPositionsFromGsap` only ingests `set(...)` at position 0**: non-zero `set` or `to(...)` start times are not merged into base position. If the first frame is `to(...)` only, base position may look empty.

---

## 11. Related notes

- ← [01 architecture](01-architecture-overview.md) — where this package sits in the system
- → [03 runtime + adapters](03-core-runtime-adapters.md) — how `PlayerAPI` / `FrameAdapter` are *implemented* in the browser
- ↗ [05 producer](05-producer-pipeline.md) section 4.2 — how `compileForRender` wires parser/linter/generator (14 steps)
- ↗ [06 cli](06-cli-orchestration.md) — `lint` / `validate` calling `lintHyperframeHtml`
- ⊥ [cheatsheet 01](cheatsheets/01-frame-adapter.md) — adding adapters (update lint rules too)

## 12. Next → 03

`PlayerAPI` signatures end here. Note 03 covers how `runtime/init.ts` implements them and exposes a 43-method compat layer on top of seven core player methods.

Verification for this note:
- [ ] Call `parseHtml` on a tiny HTML snippet and inspect `ParsedHtml`
- [ ] Run `lintHyperframeHtml` on empty HTML and list findings
- [ ] Trigger `non_deterministic_code` with `Math.random()` in script
- [ ] Call `extractPositionsFromGsap` on `gsap.timeline().set("#x", {x:100, y:50}, 0).to(...)`.
