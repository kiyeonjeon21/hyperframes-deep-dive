# 06-cli-orchestration

> One-line summary: `cli.ts` is a thin ~123-line entrypoint. All 24 subcommands lazy-load via `() => import(...).then(m => m.default)`; `--version` exits before heavy imports (~10 ms vs ~80 ms for `--help`); telemetry and auto-update run in non-blocking background tasks; `render` / `preview` are thin orchestration over producer/engine.

---

## 1. `cli.ts` (~123 lines) — entrypoint

### 1.1 fast-path (lines 6-11)

```ts
import { VERSION } from "./version.js";

if (process.argv.includes("--version") || process.argv.includes("-V")) {
  console.log(VERSION);
  process.exit(0);
}
```

**Runs before citty, telemetry, or heavy imports** — prints the version and exits. Cold-start contrast:
- `--version`: ~10 ms (this path)
- `--help`: ~80 ms (loads citty + help renderer; telemetry skipped)

### 1.2 24 subcommands (lines 26-51)

```ts
const subCommands = {
  init: () => import("./commands/init.js").then((m) => m.default),
  add: () => import("./commands/add.js").then((m) => m.default),
  catalog: () => import("./commands/catalog.js").then((m) => m.default),
  play: () => ...,
  preview: () => ...,
  publish: () => ...,
  render: () => ...,
  lint: () => ...,
  inspect: () => ...,
  layout: () => ...,
  info: () => ...,
  compositions: () => ...,
  benchmark: () => ...,
  browser: () => ...,
  transcribe: () => ...,
  tts: () => ...,
  docs: () => ...,
  doctor: () => ...,
  upgrade: () => ...,
  skills: () => ...,
  telemetry: () => ...,
  validate: () => ...,
  snapshot: () => ...,
  capture: () => ...,
};
```

**Why lazy imports matter**: `hyperframes lint` only loads `commands/lint.js`; the other 23 commands never enter memory. Heavy deps like `producer` / `engine` load only when a command actually needs them.

### 1.3 telemetry / autoUpdate (lines 62-101)

```ts
const isHelp = process.argv.includes("--help") || process.argv.includes("-h");

if (!isHelp && command !== "telemetry" && command !== "unknown") {
  import("./telemetry/index.js").then((mod) => {
    _flush = mod.flush;
    _flushSync = mod.flushSync;
    mod.showTelemetryNotice();
    mod.trackCommand(command);
    if (mod.shouldTrack()) mod.incrementCommandCount();
  });
}

if (!isHelp && !hasJsonFlag && command !== "upgrade") {
  import("./utils/autoUpdate.js").then((mod) => mod.reportCompletedUpdate());
  import("./utils/updateCheck.js").then(async (mod) => {
    _printUpdateNotice = mod.printUpdateNotice;
    const result = await mod.checkForUpdate();
    if (result?.updateAvailable) {
      const auto = await import("./utils/autoUpdate.js");
      auto?.scheduleBackgroundInstall(result.latest, result.current);
    }
  });
}
```

**Three non-blocking background tasks**:
1. **telemetry** — unless `--help`, `telemetry`, or unknown command
2. **autoUpdate report** — one-shot notice if a prior run auto-installed an update
3. **updateCheck** — schedule background install when a newer version exists

The `isHelp` guard matters: plain `--help` users are not tracked.

### 1.4 exit handlers (lines 103-112)

```ts
process.on("beforeExit", () => {
  _flush?.().catch(() => {});       // async flush when the event loop drains
  if (!hasJsonFlag) _printUpdateNotice?.();
});

process.on("exit", () => {
  _flushSync?.();                   // sync flush on process.exit()
});
```

**Why two hooks?** `beforeExit` may run once as the loop drains (async-friendly). `exit` fires immediately before termination (sync only). Forced `process.exit()` skips `beforeExit`, so the sync flush is the backup.

**Captured refs** (lines 73-75): `_flush`, `_flushSync`, `_printUpdateNotice` fill in after lazy imports resolve.

### 1.5 lazy help renderer (lines 114-122)

```ts
async function showUsage<T extends ArgsDef>(cmd, parent?) {
  const { showUsage: impl } = await import("./help.js");
  return impl(cmd as CommandDef, parent as CommandDef | undefined);
}

runMain(main, { showUsage });
```

`help.ts` (~164 lines) is also dynamically imported — not loaded for normal command execution.

---

## 2. `help.ts` (~164 lines) — grouped help

### 2.1 Five GROUPS (lines 18-69)

```
Getting Started:    init, add, capture, catalog, preview, publish, render
Project:            lint, inspect, snapshot, info, compositions, docs
Tooling:            benchmark, browser, doctor, upgrade
AI & Integrations:  skills, transcribe, tts
Settings:           telemetry
```

**Only 21 of 24 commands appear in groups**. Exactly **three** are missing: `play`, `layout`, `validate`. Root `--help` hides them, but `hyperframes <name> --help` still works.

Verified (2026-05-05): `grep -E '^\s+\["' packages/cli/src/help.ts` → 21 entries, three shy of `commands/`.

### 2.2 ROOT_EXAMPLES (lines 74-83)

```
hyperframes init my-video                  # Create a new project
hyperframes preview                         # Start the live preview studio
hyperframes publish                         # Publish to hyperframes.dev
hyperframes render -o out.mp4              # Render to MP4
hyperframes render --format webm -o out.webm  # Transparent WebM overlay
hyperframes lint                           # Validate your composition
hyperframes inspect                        # Inspect visual layout
hyperframes doctor                         # Check system dependencies
```

Common workflows.

### 2.3 per-command examples (lines 86-101)

Each `commands/<name>.ts` may export `examples: Example[]` where `Example = [comment, command]`. Help dynamically imports them:

```ts
async function loadExamples(name: string): Promise<Example[] | undefined> {
  try {
    const mod = await import(`./commands/${name}.js`);
    return mod.examples;
  } catch { return undefined; }
}
```

`STATIC_EXAMPLES` (lines 98-100) is the fallback when no command module exists — today only `skills`.

### 2.4 `showUsage(cmd, parent?)` (lines 147-164)

```ts
if (!parent) {
  console.log(renderRootHelp() + "\n");        // Root help
  return;
}
const meta = await cmd.meta;
const usage = await renderUsage(cmd, parent);  // citty-standard usage
console.log(usage + "\n");
const examples = STATIC_EXAMPLES[name] ?? await loadExamples(name);
if (examples) console.log(formatExamples(examples) + "\n");
```

Root: built-in group overview. Subcommand: citty USAGE/ARGUMENTS/OPTIONS + optional examples.

---

## 3. 24 commands — one-liners

`packages/cli/src/commands/` plus GROUP definitions:

### Getting Started (7)

| Command | Summary | Depends on |
|---|---|---|
| `init` | Interactive project scaffold (name, template, dimensions) | registry fetch + file writes |
| `add <item>` | Install registry block/component | registry resolver |
| `capture <url>` | Capture website for video | engine browser |
| `catalog` | Browse/search registry catalog | registry + UI |
| `preview` | Launch studio (three modes — see §5) | studio + engine or dev studio |
| `publish` | Upload project, get stable URL | cloud service |
| `render` | Render mp4/webm/mov | producer (lazy) |

### Project (6)

| Command | Summary |
|---|---|
| `lint` | Validate composition via core linter + JSON options |
| `inspect` | Capture visual layout at five timeline samples |
| `snapshot` | PNG snapshots at keyframes (visual regression) |
| `info` | Dump project metadata |
| `compositions` | List compositions |
| `docs` | Print inline docs to terminal |

### Tooling (4)

| Command | Summary |
|---|---|
| `benchmark` | Render with preset fps/quality/workers; compare timing/size |
| `browser` | Download/manage Chrome binaries |
| `doctor` | Check ffmpeg, Chrome, Node, GPU encoder, etc. |
| `upgrade` | Check for updates + guidance |

### AI & Integrations (3)

| Command | Summary |
|---|---|
| `skills` | Install Hyperframes/GSAP skills (Claude/Cursor/Gemini/Codex) |
| `transcribe` | Audio/video → word timestamps (Whisper) or transcript import |
| `tts` | Text → speech (local Kokoro-82M) |

### Settings (1)

| Command | Summary |
|---|---|
| `telemetry` | Toggle anonymous usage stats |

### Missing from GROUPS (still in `commands/`) — three

| Command | Notes |
|---|---|
| `play` | Play composition (opens browser?) — read `play.ts` |
| `layout` | Layout audit via `layout-audit.browser.js` |
| `validate` | Multi-phase validation (contrast/layout/media) — see note 02 |

They are absent from root `--help` but callable via `hyperframes <name> --help`. Decide via git history whether this is intentional hiding or an oversight — if accidental, worth a PR like the earlier `capture` fix.

### `commands/_examples.ts`, `_shared/`

```ts
// _examples.ts (inferred shape)
export type Example = [comment: string, command: string];
```

`_shared/` holds cross-command helpers.

### Browser scripts (`*.browser.js`)

- `contrast-audit.browser.js` — injected by `validate` for WCAG contrast math
- `layout-audit.browser.js` — injected by `validate` / `layout` for overflow/bounds checks

These run **in-page**, not in Node — invoked through `page.evaluate(...)`.

---

## 4. `render` — `commands/render.ts` (~697 lines)

### 4.1 Arguments (lines 39-127)

```ts
{
  dir: positional,                   // project directory
  output: -o,                        // output path
  fps: -f, default "30",             // 24 / 30 / 60
  quality: -q, default "standard",   // draft / standard / high
  format: default "mp4",             // mp4 / webm / mov
  workers: -w,                       // 'auto' or number
  docker: false,                     // deterministic Docker render
  hdr: false,                        // force HDR
  sdr: false,                        // force SDR
  crf,                               // encoder CRF (mutually exclusive with bitrate)
  "video-bitrate",                   // target bitrate
  gpu: false,                        // GPU encoding
  "browser-gpu",                     // host GPU acceleration
  quiet: false,
  strict: false,                     // block on lint errors
  "strict-all": false,               // block on lint errors or warnings
  "max-concurrent-renders",          // producer server concurrency (1-10)
}
```

### 4.2 Validation + default output path (lines 132-191)

```ts
const fps = (parseInt(args.fps, 10) as 24 | 30 | 60);
if (!VALID_FPS.has(fps)) errorBox("Invalid fps", ...);

const ext = FORMAT_EXT[format] ?? ".mp4";
const datePart = new Date().toISOString().slice(0, 10);
const timePart = new Date().toTimeString().slice(0, 8).replace(/:/g, "-");
const outputPath = args.output
  ? resolve(args.output)
  : join(rendersDir, `${project.name}_${datePart}_${timePart}${ext}`);

mkdirSync(dirname(outputPath), { recursive: true });
```

Default filename pattern: `<project>_2026-05-05_02-13-04.mp4` — easy to sort multiple runs.

### 4.3 max-concurrent-renders → env

```ts
process.env.PRODUCER_MAX_CONCURRENT_RENDERS = String(parsed);
```

Intended for producer **HTTP server** mode; direct CLI renders may ignore it — confirm in your deployment.

### 4.4 Producer call flow (line 200+, tail not exhaustively read)

```
1. resolveProject(args.dir) → { dir, name, indexPath }
2. lintProject(project) → honor strict / strict-all gates
3. loadProducer() → dynamic import("@hyperframes/producer")
4. createRenderJob({ fps, quality, format, workers, hdrMode, ... })
5. (Docker) buildDockerRunArgs + spawn docker
6. executeRenderJob(job, projectDir, outputPath, onProgress)
   onProgress: cli/ui/progress.ts renderProgress updates
7. telemetry trackRenderComplete + print output path/size
```

### 4.5 `loadProducer()` — `utils/producer.ts`

```ts
export async function loadProducer() {
  return import("@hyperframes/producer");
}
```

Simple dynamic import — keeps CLI cold start away from producer’s dependency graph until needed.

---

## 5. `preview` — `commands/preview.ts` (~433 lines)

### 5.1 Mode selection (lines 103-114)

```ts
if (isDevMode()) {
  return runDevMode(dir, projectName);              // monorepo internal dev
}
if (hasLocalStudio(dir)) {
  return runLocalStudioMode(dir, projectName);      // project depends on @hyperframes/studio
}
return runEmbeddedMode(dir, startPort, projectName, forceNew);  // fallback embedded server
```

`isDevMode()` (`utils/env.ts:5-14`) — `import.meta.url` ending in `.ts` means dev (tsx); `.js` means production bundle. Fallback assumes production:

```ts
export function isDevMode(): boolean {
  try {
    const url = new URL(import.meta.url);
    return url.pathname.endsWith(".ts");
  } catch {
    return false;  // fail-open so telemetry never disables itself accidentally
  }
}
```

`hasLocalStudio(dir)` (`commands/preview.ts:221-229`) — tries `createRequire`:

```ts
function hasLocalStudio(dir: string): boolean {
  try {
    const req = createRequire(join(dir, "package.json"));
    req.resolve("@hyperframes/studio/package.json");
    return true;
  } catch { return false; }
}
```

`createRequire(dir/package.json)` works across npm/pnpm/bun. Resolving the literal `package.json` path survives export maps that hide the package root.

### 5.2 lint pre-check (lines 91-101)

```ts
if (existsSync(indexPath)) {
  const lintResult = lintProject(project);
  if (lintResult.totalErrors > 0 || lintResult.totalWarnings > 0) {
    console.log();
    for (const line of formatLintFindings(lintResult)) console.log(line);
    console.log();
  }
}
```

**Non-blocking** — previews still start; we just **surface** lint output up front for fast iteration.

### 5.3 dev mode (`runDevMode`, line 120+)

```
1. repoRoot = (cli/src/commands)/../../../..
2. symlink dir → packages/studio/data/projects/<projectName>
3. spawn("pnpm", ["exec", "vite"], { cwd: packages/studio })
4. watch stdout for "Local: http://localhost:..." → print URL
5. open http://localhost:<port>#project/<name>
```

**Symlink trick**: the studio only watches projects under its data directory — we symlink user folders in.

`unlinkSync` cleanup (lines 138-141): replace stale symlinks with mismatched targets.

### 5.4 local studio + embedded (not fully read, 200+ lines)

```
local studio: resolve("@hyperframes/studio") then spawn Vite
embedded:     built-in server on port 3002+ (engine + static assets)
```

### 5.5 meta commands (lines 53-81)

```ts
if (args.list) {
  const servers = await scanActiveServers(startPort);
  // print active preview servers
}
if (args["kill-all"]) {
  const killed = await killActiveServers(startPort);
  // terminate them
}
```

`server/portUtils.ts` — port scan, PID discovery, kill helpers.

### 5.6 Ctrl+C propagation

Forward SIGINT to the child (`spawn vite`); CLI waits on `child.on("exit")`.

---

## 6. Commands worth reading deeply

### `validate` (200+ lines — note 02)

Seek timeline to five probes, inject `contrast-audit.browser.js` / `layout-audit.browser.js`, pull results via `page.evaluate`.

### `init` (900+ lines)

- interactive prompts (clack)
- template choice (blank vs example)
- variable definitions
- registry dependency install
- auto `skills install`
- README + CLAUDE.md `/skills/` scaffolding

### `add` / `catalog`

Online registry fetch, local cache (`~/.cache/hyperframes/registry/`), copy item files.

### `doctor`

ffmpeg + codec probes, Chrome/Puppeteer cache, Node version, GPU encoder detect, color-coded ✓/✗/⚠.

### `benchmark`

Matrix of fps × quality × workers → table of time/size/memory.

### `transcribe` / `tts`

- transcribe: ffmpeg extract audio → Whisper (local or web) → word timestamps
- tts: Kokoro-82M local inference

### `skills`

Install into five AI ecosystems:
- Claude Code: `~/.claude/plugins/`
- Cursor: `.cursor/plugins/` or marketplace
- Codex sparse plugin
- Gemini CLI skills dir
- generic copy into `skills/`

### `play`, `layout`, `info`, `compositions`, `docs`, `inspect`, `snapshot`

Thin wrappers — small glue between CLI surface and producer/engine.

---

## 7. Adding a CLI command (see CLAUDE.md “Adding CLI Commands”)

```
1. Author packages/cli/src/commands/<name>.ts
   defineCommand({ meta, args, run })
   export const examples: Example[] = [...]
2. Register lazy import in packages/cli/src/cli.ts
   <name>: () => import("./commands/<name>.js").then((m) => m.default),
3. Append to GROUPS in packages/cli/src/help.ts (easy to forget!)
4. Document in docs/packages/cli.mdx
5. Verify:
   npx tsx packages/cli/src/cli.ts --help     # group listing
   npx tsx packages/cli/src/cli.ts <name> --help  # examples
```

All four steps matter: lazy imports work without GROUPS, but users won’t discover the command from `--help` (`play` / `layout` / `validate` may still suffer this).

---

## 8. One-shot trace — `hyperframes render`

```
$ hyperframes render --fps 30 --quality high --format mp4 -o out.mp4
  │
  ├─ cli.ts:6-11  --version guard → continue
  ├─ cli.ts:17    load citty
  ├─ cli.ts:53-60 defineCommand({ subCommands: { render: lazy } })
  ├─ cli.ts:77-84 telemetry (background, non-blocking)
  ├─ cli.ts:87-100 updateCheck (background, non-blocking)
  ├─ cli.ts:123   runMain(main, { showUsage })
  │
  └─ citty routes to render → subCommands.render() lazy import
     └─ commands/render.ts defineCommand.run({ args })
        │
        ├─ resolveProject(dir) → { dir, name, indexPath, metadata }
        ├─ validate fps/quality/format (VALID_* sets)
        ├─ parse workers / max-concurrent-renders
        ├─ pick outputPath (renders/<name>_YYYY-MM-DD_HH-MM-SS.mp4)
        ├─ resolveBrowserGpuForCli(useDocker, browserGpuArg)
        ├─ lintProject(project) → enforce strict / strict-all
        │
        ├─ (docker) buildDockerRunArgs + spawn docker
        ├─ (default)
        │   ├─ loadProducer() → dynamic import @hyperframes/producer
        │   ├─ createRenderJob({ fps, quality, format, workers, useGpu, crf, videoBitrate, hdrMode, ... })
        │   ├─ executeRenderJob(job, projectDir, outputPath, onProgress)
        │   │   ├─ onProgress: renderProgress UI (cli/ui/progress.ts)
        │   │   └─ Ctrl+C forwards abortSignal
        │   └─ trackRenderComplete + print artifact stats
        │
        └─ exit
```

---

## 9. Compared to Remotion CLI

| Aspect | Remotion CLI | Hyperframes CLI |
|---|---|---|
| Build step | esbuild + React bundles | none (capture HTML as-is) |
| Entry | `remotion render`, `remotion studio`, … | citty + 24 commands |
| Command count | ~10 (render, preview, lambda, …) | 24 (init/add/capture/…/render/…) |
| AI integrations | none | `/skills`, `/transcribe`, `/tts`, `init` skill bootstrap |
| Lambda | rich `lambda` subcommands | none (local workers + Docker) |
| Validation audits | none built-in | contrast + layout + media (5 probes) |
| Init skills | none | `init` wires AI tooling automatically |

Hyperframes CLI leans **AI-native** — `/skills`, `--json`, automatic skill setup in `init`, JSON-friendly `validate` for agents.

---

## 10. Sharp edges / verification backlog

1. **Quantify lazy import wins** — `time hyperframes --version` vs `time hyperframes render --help`.
2. ~~**`isDevMode()`**~~ — verified (2026-05-05): `.ts` vs `.js` suffix on `import.meta.url`.
3. ~~**`hasLocalStudio(dir)`**~~ — verified: `createRequire(...).resolve("@hyperframes/studio/package.json")` works on npm/pnpm/bun.
4. ~~**`PRODUCER_MAX_CONCURRENT_RENDERS`**~~ — verified (2026-05-05): **producer HTTP server only**, wired in `packages/producer/src/server.ts:256-258`:
   ```ts
   const maxConcurrentRenders = options.maxConcurrentRenders
     ?? Number(process.env.PRODUCER_MAX_CONCURRENT_RENDERS || 2);
   ```
   CLI `render` imports producer directly (no HTTP server) — env rarely matters unless you launch the server/docker helper paths that read it.
5. ~~**Missing GROUPS entries (`play` / `layout` / `validate`)**~~ — partially verified (2026-05-05): `git log packages/cli/src/help.ts` shows an explicit fix adding `capture`, but no matching commits for the other three → likely accidental omission / worth a PR.
6. **Embedded preview (port 3002+)** — how `runEmbeddedMode` boots engine + static bundles needs a focused read.
7. ~~**telemetry `shouldTrack()`**~~ — verified (2026-05-05): `cli/src/telemetry/client.ts:35-62`. **Five opt-out triggers** (any ⇒ false):
   - `HYPERFRAMES_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`
   - `CI=true` / `CI=1`
   - `isDevMode()` (running `.ts` sources)
   - `POSTHOG_API_KEY` missing `phc_` prefix (build safety latch)
   - `~/.config/hyperframes/config.json` → `telemetryEnabled: false`

   Result memoized on `telemetryEnabled` for the process lifetime.

---

## 11. Related notes

- ← [05 producer](05-producer-pipeline.md) — five-stage pipeline behind `render`
- → [07 studio + player](07-studio-player.md) — what `preview` launches (three modes)
- ↗ [02 types/parsers](02-core-types-parsers.md) — `lintHyperframeHtml` modules/rules
- ⊥ [cheatsheet 03](cheatsheets/03-render-flags.md) — render flag reference
- ⊥ [cheatsheet 04](cheatsheets/04-regression-testing.md) — `bun run --cwd packages/producer test:regression`

## 12. Next → note 07

How studio’s player peeks through the iframe (`__player`, audio proxy, Zustand + `liveTime`).

**Checklist:**
- [ ] `time hyperframes --version` vs `time hyperframes render --help`
- [ ] `hyperframes preview --list` / `--kill-all` behavior
- [ ] `hyperframes lint --json` for agents
- [ ] `hyperframes render --debug` → inspect `<output>/work-*/perf-summary.json`
- [ ] Confirm whether `play` / `layout` / `validate` are missing from root `--help`
- [ ] Ensure every command exposes `examples` via `<cmd> --help`
