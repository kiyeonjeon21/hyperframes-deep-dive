# cheatsheet/02 - `window.*` runtime contract

## Core globals

```ts
window.__hf = {
  duration: number,
  seek(timeSeconds: number): void,
  media?: HfMediaElement[],
  transitions?: HfTransitionMeta[],
}
```

```ts
window.__player      // interactive PlayerAPI bridge
window.__timelines   // GSAP timelines by composition id
window.__hyperframes // runtime helpers
```

## Variables

```ts
window.__hfVariables       // top-level render overrides
window.__hfVariablesByComp // scoped sub-composition values
```

Read in composition scripts:

```js
const vars = window.__hyperframes.getVariables();
```

Precedence:

```text
top-level: declared defaults < window.__hfVariables
sub-comp:  declared defaults < data-variable-values -> __hfVariablesByComp
```

## Virtual time

```ts
window.__HF_VIRTUAL_TIME__ = {
  seekToTime(ms: number): number,
}
```

Injected during render to virtualize:

- `Date.now`
- `performance.now`
- timers
- `requestAnimationFrame`
- deterministic random hooks where configured

## Adapter globals

```ts
window.__hfAnime       // optional anime instances
window.__hfLottie      // optional Lottie instances
window.__hfThreeTime   // Three.js deterministic time
window.__hfTypegpuTime // TypeGPU/WebGPU deterministic time
```

Adapters can also dispatch/listen for:

```js
window.addEventListener("hf-seek", (event) => render(event.detail.time));
```

## Picker/manual edit

```ts
window.__HF_PICKER_API
```

Used by Studio/manual editing to inspect/select elements in the iframe.

## Shader transition globals/options

```ts
window.__hf.transitions
window.__HF_SHADER_CAPTURE_SCALE
window.__HF_SHADER_LOADING
```

Player query params:

```text
__hf_shader_capture_scale
__hf_shader_loading
```

## Devtools snippets

```js
const player = document.querySelector("hyperframes-player");
const win = player.iframeElement.contentWindow;

win.__hf.duration;
win.__hf.seek(1.5);
win.__player;
win.__timelines;
win.__hyperframes.getVariables();
win.__hfVariablesByComp;
```

Timeline key check:

```js
const root = win.document.querySelector("[data-composition-id]");
root?.getAttribute("data-composition-id");
Object.keys(win.__timelines || {});
```

## Related

- [../01-architecture-overview.md](../01-architecture-overview.md)
- [../03-core-runtime-adapters.md](../03-core-runtime-adapters.md)
- [../12-variables-templates.md](../12-variables-templates.md)
