# 12-variables-templates

> Variables let one composition render many personalized outputs. They are typed
> declarations plus runtime values; they are not a custom template language.

## 1. Declaration

Declare variables on the `<html>` root:

```html
<html data-composition-variables='[
  {"id":"title","type":"string","label":"Title","default":"Welcome"},
  {"id":"accent","type":"color","label":"Accent","default":"#ff6600"},
  {"id":"price","type":"number","label":"Price","default":0,"unit":"$"},
  {"id":"featured","type":"boolean","label":"Featured","default":false},
  {"id":"plan","type":"enum","label":"Plan","default":"pro",
   "options":[{"value":"pro","label":"Pro"},{"value":"enterprise","label":"Enterprise"}]}
]'>
```

Supported types:

- `string`
- `number`
- `color`
- `boolean`
- `enum`

## 2. Runtime read

Composition scripts read values:

```html
<script>
  const vars = window.__hyperframes.getVariables();
  document.querySelector(".title").textContent = vars.title || "Welcome";
  document.documentElement.style.setProperty("--accent", vars.accent || "#ff6600");
</script>
```

The helper returns values. Your script still applies them to DOM/CSS/media.

## 3. Top-level precedence

For top-level renders:

```text
declared defaults < CLI/SDK render variables
```

Implementation path:

```text
CLI --variables
  -> RenderConfig.variables
  -> engine evaluateOnNewDocument
  -> window.__hfVariables
  -> getVariables()
```

## 4. Sub-composition precedence

For nested compositions:

```html
<div
  data-composition-id="card-1"
  data-composition-src="compositions/card.html"
  data-variable-values='{"title":"Pro","accent":"#22c55e"}'
></div>
```

The compiler/runtime scopes values per instance:

```text
sub-comp declared defaults < host data-variable-values
```

Internally this is represented through `window.__hfVariablesByComp`.

## 5. CLI overrides

Local render:

```bash
npx hyperframes render \
  --variables '{"title":"Hello Alice","accent":"#ff0000"}' \
  --output alice.mp4
```

From file:

```bash
npx hyperframes render \
  --variables-file ./alice.json \
  --strict-variables \
  --output alice.mp4
```

Without `--strict-variables`, validation issues are warnings. With it, undeclared
keys or type mismatches fail the render.

## 6. Validation

`packages/core/src/runtime/validateVariables.ts` checks:

- undeclared keys
- type mismatches
- enum values outside the allowed option list

The linter checks malformed declarations and malformed `data-variable-values`
JSON. Render-time validation checks actual overrides.

## 7. What variables can drive

Good variable targets:

- text content
- colors/CSS variables
- class names
- media `src` URLs
- data attributes read from live DOM after script execution
- per-render CTA URLs or labels
- chart data serialized as JSON strings

For structured objects, use a `string` variable and parse JSON in the
composition. There is no `object` variable type in the current schema.

## 8. What variables cannot drive

Variables cannot change inputs read only at compile/config time:

- composition dimensions (`data-width`, `data-height`)
- FPS
- output format/codec/quality
- output resolution preset
- sibling/parent composition values except through explicit host overrides

If a value must affect encoder behavior, it belongs in CLI/SDK config, not a
composition variable.

## 9. Media variables

Media URLs are a first-class use case:

```html
<video id="hero" data-start="0" data-track-index="0"></video>
<script>
  const { heroVideo, heroDuration } = __hyperframes.getVariables();
  const el = document.getElementById("hero");
  el.src = heroVideo;
  if (heroDuration !== undefined) {
    el.setAttribute("data-duration", String(heroDuration));
  }
</script>
```

The browser probe reads the live DOM after script execution, so runtime-assigned
media `src` and even `data-duration` can be discovered.

## 10. Lambda templates

Single render:

```bash
hyperframes lambda render ./template \
  --site-id abc123 \
  --variables '{"title":"Hello Alice"}' \
  --wait
```

Batch render:

```bash
hyperframes lambda render-batch ./template \
  --batch ./users.jsonl \
  --width 1920 --height 1080 \
  --max-concurrent 10
```

Each JSONL row carries its own `variables` object and `outputKey`.

## 11. Distributed hashing

Distributed `plan()` writes variables into frozen encoder metadata. This means:

- same source + same variables -> stable plan hash
- same source + different variables -> different plan hash
- chunk workers do not need to re-resolve caller inputs

## 12. Size limits

For Lambda/Step Functions, variables are part of the execution input. Standard
workflows cap input at 256 KiB. Use URLs for media and large payloads; do not
inline base64 assets or large JSON blobs unless you have measured the size.

## 13. Debug checklist

1. Run `hyperframes lint`.
2. Inspect `document.documentElement.getAttribute("data-composition-variables")`.
3. In preview devtools, call `window.__hyperframes.getVariables()`.
4. For render, confirm CLI parsed variables as an object.
5. Use `--strict-variables` in CI.
6. For sub-compositions, inspect `window.__hfVariablesByComp`.
7. For Lambda, keep variables under Step Functions input limits.

## 14. Next

Read [13-agent-catalog-docs.md](13-agent-catalog-docs.md) for how templates,
catalog blocks, and agent workflows fit together.
