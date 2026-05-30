# cheatsheet/01 - Writing a frame adapter

## Two APIs

| API | Use |
|---|---|
| `FrameAdapter` | public helper shape for adapter-like libraries |
| `RuntimeDeterministicAdapter` | actual runtime integration path |

The current runtime does not auto-discover arbitrary public `FrameAdapter`
instances. To make a library work in preview/render, wire a runtime adapter.

## Runtime adapter contract

Implement under:

```text
packages/core/src/runtime/adapters/
```

Adapter responsibilities:

- `name`
- `discover()` cheap and idempotent
- `seek(ctx)` deterministic
- `pause()` stops wall-clock motion
- `play()` resumes interactive motion
- `revert()` cleans runtime-forced state

## Existing patterns

| Adapter | Pattern |
|---|---|
| GSAP | seek registered `window.__timelines` |
| CSS | control discovered CSS animations |
| anime.js | use running instances / optional global list |
| Lottie | convert seconds to frames and stop |
| Three.js | publish `window.__hfThreeTime` / seek event |
| WAAPI | set animation `currentTime` |
| TypeGPU | publish `window.__hfTypegpuTime` / `hf-seek` event |

## Author contract examples

Three/TypeGPU-style adapters cannot inspect render loops. Authors must listen or
poll:

```js
window.addEventListener("hf-seek", (event) => {
  render(event.detail.time);
});

render(window.__hfTypegpuTime ?? 0);
```

## Add checklist

- [ ] Define the author-facing global/event contract.
- [ ] Implement runtime adapter.
- [ ] Wire adapter into runtime init.
- [ ] Pause/autostop after deterministic `seek`.
- [ ] Add unit tests for discover/seek/play/pause/revert.
- [ ] Add linter rule if a required CDN/global is detectable.
- [ ] Add docs/skill guidance if authors must follow a pattern.
- [ ] Add a small preview/render fixture if visual parity can regress.

## Test commands

```bash
bun run --filter @hyperframes/core test
rg "RuntimeDeterministicAdapter" packages/core/src/runtime/adapters
```

## Related

- [../03-core-runtime-adapters.md](../03-core-runtime-adapters.md)
- [../../projects/01-frame-adapter-poc](../../projects/01-frame-adapter-poc)
