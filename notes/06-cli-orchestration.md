# 06-cli-orchestration

> The CLI is a lazy `citty` command surface around local render, Studio preview,
> registry install, website capture, cloud rendering, Lambda deployment, auth,
> and AI-adjacent tooling. Current root command count: 29.

## 1. Entrypoint

Read `packages/cli/src/cli.ts`.

Startup sequence:

1. Set bundled worker entry env vars for producer worker pools.
2. Fast-path `--version` before heavy imports.
3. Load `.env` from the current working directory.
4. Define lazy subcommands through dynamic imports.
5. Lazily initialize telemetry/update checks for normal commands.
6. Install exit/beforeExit handlers for telemetry flushing and update notices.
7. Run `citty`.

The first block matters because the published CLI bundles producer code and needs
worker-thread entry files to resolve next to `cli.js`.

## 2. Root commands

`cli.ts` currently defines 29 root commands:

| Group | Commands |
|---|---|
| creation/catalog | `init`, `add`, `catalog`, `capture` |
| preview/render | `play`, `preview`, `publish`, `render` |
| validation/inspection | `lint`, `inspect`, `layout`, `info`, `compositions`, `validate`, `snapshot` |
| tooling | `benchmark`, `browser`, `docs`, `doctor`, `upgrade`, `skills` |
| media/AI | `remove-background`, `transcribe`, `tts` |
| deploy/account | `lambda`, `cloud`, `auth` |
| settings/feedback | `feedback`, `telemetry` |

Root help (`packages/cli/src/help.ts`) intentionally groups only 26 commands.
`play`, `layout`, and `validate` are still callable but absent from the grouped
root help list in the inspected checkout.

## 3. Help renderer

`help.ts` overrides root help with grouped commands and examples. Subcommand help
uses citty's standard usage output plus examples imported from command files.

Important detail: nested examples prefer `commands/<parent>/<name>.js` before
falling back to top-level command files, avoiding collisions such as top-level
`render` vs `lambda render`.

## 4. Local render command

`commands/render.ts` is the local render entry:

- resolves project/entry/output
- parses exact FPS
- parses `--variables` / `--variables-file`
- validates variables against `data-composition-variables`
- maps `--output-resolution` aliases
- handles format/codec/HDR/alpha flags
- calls producer `executeRenderJob`
- prints human or JSON output

Variable strictness:

- default: validation issues are warnings
- `--strict-variables`: validation issues fail the command

## 5. Preview command

`commands/preview.ts` starts the Studio/preview server. It is the interactive
path for:

- live preview
- file watching/reload
- Studio UI
- player iframe bridge
- editor panels and render queue

The preview path is the easiest way to inspect runtime globals in devtools:

```js
const el = document.querySelector("hyperframes-player");
const win = el.iframeElement.contentWindow;
win.__hf;
win.__player;
win.__timelines;
```

## 6. Lambda command

`commands/lambda.ts` is a dispatcher with subcommands:

- `deploy`
- `sites create`
- `render`
- `render-batch`
- `progress`
- `destroy`
- `policies`

The CLI keeps `@hyperframes/aws-lambda` as an opt-in runtime dependency. Lambda
subverbs dynamically import the SDK and print an installation hint if it is not
available.

Lambda render mirrors local render flags where possible:

- `--width`, `--height`
- `--output-resolution`
- `--fps`
- `--format`
- `--quality`
- `--variables`
- `--variables-file`
- `--strict-variables`
- `--wait`

## 7. Cloud and auth commands

`cloud` is the HeyGen cloud render path: render without local Chrome/FFmpeg.
`auth` manages HeyGen credentials. These are product/service surfaces distinct
from the OSS local renderer and the AWS Lambda self-deploy path.

The useful mental split:

| Surface | Who runs rendering |
|---|---|
| `render` | local machine |
| `lambda render` | user's AWS account |
| `cloud render` | HeyGen cloud service |
| MCP `render_video` | hosted product endpoint |

## 8. Registry commands

`add` and `catalog` use `packages/cli/src/registry/`:

- `remote.ts` fetches registry manifests from GitHub raw URLs and caches metadata
  for 24h.
- `resolver.ts` loads top-level and per-item manifests.
- `installer.ts` copies/fetches item files into a project and can insert block
  markers/snippets.

`catalog` can output JSON or run an interactive picker under human-friendly mode.

## 9. Website capture

`capture` powers the website-to-video workflow documented in upstream docs and
skills. It captures:

- screenshots
- design tokens/colors/fonts
- assets
- visible text/sections/CTAs
- animation catalog
- optional Gemini image descriptions

This command is usually driven by the `website-to-hyperframes` skill, but it is
also usable directly for debugging or pre-caching.

## 10. Agent and media helpers

| Command | Role |
|---|---|
| `skills` | install HyperFrames/GSAP skills into supported agent environments |
| `transcribe` | word-level timestamps or transcript import |
| `tts` | local Kokoro speech generation |
| `remove-background` | transparent video/image asset generation |
| `snapshot` | capture timeline frames as PNGs for visual checks |
| `inspect` / `layout` | visual/layout auditing commands |

## 11. Telemetry and update checks

Telemetry is lazy and should never break commands. It is skipped for help,
unknown commands, and telemetry-management flows. Update checks are also
backgrounded and suppressed for JSON output where command output must be
machine-readable.

## 12. Adding a command

1. Add a lazy import in `cli.ts`.
2. Add grouped help in `help.ts` if it should appear in root help.
3. Export `examples` from the command module.
4. Keep command output plain and non-interactive by default.
5. Add `--json` for machine users where useful.
6. Thread auth/profile/region/env behavior explicitly for cloud/deploy commands.
7. Add tests for argument parsing and command-specific helpers.

## 13. Next

Read [07-studio-player.md](07-studio-player.md) for the interactive host side of
the same runtime contract.
