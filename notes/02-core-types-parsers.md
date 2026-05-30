# 02-core-types-parsers

> `@hyperframes/core` is the shared language of the system: public types,
> exact FPS parsing, HTML parsing/generation, compiler helpers, runtime helper
> exports, variables, linter rules, and registry item types.

## 1. Export domains in `index.ts`

Start with `packages/core/src/index.ts`. It is mostly a barrel file, but the
grouping tells you what the package considers public:

1. shared types from `core.types.ts`
2. template constants and base HTML generation
3. GSAP serialization helpers
4. HTML parser/update helpers
5. HTML generator helpers
6. timing compiler helpers
7. linter types and `lintHyperframeHtml`
8. asset path rewrite helpers
9. inline runtime scripts and contracts
10. frame adapter types plus `createGSAPFrameAdapter`
11. text measurement helper `fitTextFontSize`
12. runtime-side `getVariables`
13. tooling-side variable validation
14. registry item/manifest types

The Node-heavy GSAP parser is intentionally moved behind the
`@hyperframes/core/gsap-parser` subpath so browser/SSR bundles do not pull
`recast` and Babel parser dependencies through the default entry.

## 2. Type hub

Read `packages/core/src/core.types.ts`.

### 2.1 Exact FPS

FPS is now an exact rational:

```ts
interface Fps {
  num: number;
  den: number;
}
```

Why it matters:

- `30` becomes `{ num: 30, den: 1 }`.
- NTSC can be spelled exactly as `"30000/1001"`.
- Decimal strings like `"29.97"` are rejected as ambiguous.
- `fpsToFfmpegArg` preserves rational form for FFmpeg.

This affects CLI flag parsing, producer time math, BeginFrame intervals, frame
counts, and distributed plan metadata.

### 2.2 Canvas resolution presets

`CANVAS_DIMENSIONS` is the single source of truth for:

- `landscape` / `portrait`
- `landscape-4k` / `portrait-4k`
- `square` / `square-4k`

`normalizeResolutionFlag()` maps aliases such as `1080p`, `4k`, `uhd`, and
square/portrait aliases. Producer uses this through `outputResolution` to derive
Chrome `deviceScaleFactor` without changing the authored layout.

### 2.3 Timeline and media types

`TimelineElement` still represents the editor/player timeline view:

- media elements: `video`, `image`, `audio`
- text elements
- nested composition elements

The type is useful for Studio state and parser output, but the render source of
truth remains HTML attributes, not a separate JSON timeline.

### 2.4 Variables

Variables are now first-class:

```ts
type CompositionVariableType = "string" | "number" | "color" | "boolean" | "enum";
type CompositionVariable =
  | StringVariable
  | NumberVariable
  | ColorVariable
  | BooleanVariable
  | EnumVariable;
```

Declarations live in `data-composition-variables` on the `<html>` root. Runtime
values are read with `window.__hyperframes.getVariables()` or the exported
`getVariables()` helper. Tooling validates overrides with `validateVariables()`.

See [12-variables-templates.md](12-variables-templates.md) for the full flow.

## 3. HTML parser and metadata

Read `packages/core/src/parsers/htmlParser.ts`.

Main responsibilities:

- parse HTML into a `ParsedHtml` shape
- discover timed elements and media clips
- infer composition metadata
- expose update helpers such as `updateElementInHtml`, `addElementToHtml`, and
  `removeElementFromHtml`
- extract composition declarations, including variables

Important mental model: HTML is parsed for structure and metadata, but runtime
state can still be discovered in a browser probe later. For example, a script can
set a media `src` from variables; the browser probe sees the live DOM after the
script runs.

## 4. GSAP parser and serializer

Two layers exist:

- Browser-safe serializer helpers through the default `@hyperframes/core` entry.
- Node-only AST parser/mutation helpers through the `@hyperframes/core/gsap-parser`
  subpath.

This split prevents Studio/browser bundles from paying for Node-only parsing
dependencies unless they explicitly need mutation-level GSAP editing.

## 5. Compiler helpers

Core contains compiler-facing modules, but producer owns orchestration.

Key files:

- `compiler/timingCompiler.ts` - resolves timing attributes, media duration
  defaults, and clamping rules.
- `compiler/htmlBundler.ts` - inlines sub-compositions, scopes IDs/selectors,
  carries variable values, and guards runtime injection.
- `compiler/compositionScoping.ts` - wraps sub-composition scripts so selectors
  and timeline registration target the scoped instance.
- `compiler/rewriteSubCompPaths.ts` - rewrites asset paths after composition
  inlining.

The variable-related detail to keep in mind: sub-compositions can get
per-instance values through `data-variable-values`; bundling materializes the
scoped values into `window.__hfVariablesByComp`.

## 6. Runtime helpers exported from core

The default entry exports:

- `getVariables()` - composition-side variable resolution.
- `fitTextFontSize()` - text fitting helper exposed through
  `window.__hyperframes`.
- runtime contract constants and inline runtime source helpers.
- picker API types.

`getVariables()` merges declared defaults with render-time overrides:

```text
declared defaults < window.__hfVariables
```

For sub-compositions, the wrapper shadows `__hyperframes.getVariables()` with a
scoped variant backed by:

```text
window.__hfVariablesByComp[compositionId]
```

## 7. Linter

Read `packages/core/src/lint/hyperframeLinter.ts` and `packages/core/src/lint/rules/`.

The linter now composes eight rule modules:

| Module | Main concerns |
|---|---|
| `core.ts` | root metadata, timeline registry, inline script syntax, deterministic code, pointer-events |
| `media.ts` | media IDs/src/timing, imperative media control, duplicate media, base64, preload |
| `gsap.ts` | GSAP script presence, selector scoping, hard-kill exits, repeat hazards |
| `captions.ts` | caption root/transcript/style pitfalls |
| `composition.ts` | timing density, deprecated attrs, variable declarations/values, rAF hints |
| `adapters.ts` | Lottie and Three script presence |
| `textures.ts` | texture class/mask/drop-shadow hazards |
| `fonts.ts` | Google Fonts import and font-family without `@font-face` |

Async URL checks are separate helpers:

- `lintMediaUrls()`
- `lintScriptUrls()`

They are not part of the synchronous rule loop because they perform network
`HEAD` checks.

## 8. Registry types

Read `packages/core/src/registry/types.ts` and `packages/cli/src/registry/`.

Registry item hierarchy:

| Type | Meaning |
|---|---|
| `hyperframes:example` | full runnable example project |
| `hyperframes:block` | reusable composition/block installed into a project |
| `hyperframes:component` | snippet/effect/component installed into an existing composition |

The default remote registry is still GitHub raw content:

```text
https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry
```

The top-level `registry/registry.json` lists names/types. Per-item manifests
live under `registry/examples`, `registry/blocks`, and `registry/components`.
Schemas are mirrored under `docs/schema/`.

## 9. Call trace: variable render

```text
CLI render --variables / --variables-file
  -> parse JSON object
  -> validate against data-composition-variables
  -> producer RenderConfig.variables
  -> engine createCaptureSession
  -> page.evaluateOnNewDocument sets window.__hfVariables
  -> composition script calls __hyperframes.getVariables()
```

Distributed mode freezes the same variables into `meta/encoder.json`, so
different variable values produce different `planHash` values.

## 10. Sharp edges

- Do not treat `CompositionVariable` as automatic DOM substitution. User script
  still applies values to text, styles, media `src`, or attributes.
- Do not use decimal FPS strings. Use integers or exact rationals.
- Do not load Node-only parser helpers from browser bundles; use the subpath.
- Do not assume linter rule counts are stable. Read `hyperframeLinter.ts` to see
  the active module list.
- Registry schemas live under `docs/schema/`, not under `packages/core/schemas`
  in the current checkout.

## 11. Next

Continue with [03-core-runtime-adapters.md](03-core-runtime-adapters.md), which
shows how these types become runtime behavior inside the composition iframe.
