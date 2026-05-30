# 13-agent-catalog-docs

> HyperFrames is no longer just packages and a CLI. The repo also contains
> skills, catalog/registry content, generated docs pages, and hosted-product
> documentation for MCP/cloud workflows. This matters because many users arrive
> through agents rather than hand-written HTML.

## 1. Main surfaces

| Surface | Location | Purpose |
|---|---|---|
| skills | `skills/` | instructions/assets/scripts for AI coding agents |
| registry | `registry/` | installable examples, blocks, components |
| docs | `docs/` | Mintlify docs source |
| catalog docs | `docs/catalog/` | generated pages for registry items |
| CLI capture | `packages/cli/src/capture/` | website-to-video source capture |
| MCP docs | `docs/guides/mcp.mdx` | hosted agent product docs |

## 2. Skills

The repo ships skills for:

- core HyperFrames composition authoring
- CLI usage
- registry/catalog contributions
- website-to-hyperframes
- remotion-to-hyperframes
- animation libraries such as GSAP/anime/WAAPI/Lottie/Three/TypeGPU
- media/caption/audio guidance

Skills are agent instructions plus optional references, scripts, templates, and
assets. They are not runtime package code, but they strongly shape generated
HyperFrames projects.

## 3. Website-to-video workflow

The public docs describe a seven-step pipeline:

```text
capture -> design -> script -> storyboard -> VO/timing -> build -> validate
```

The CLI `capture` command produces the source material:

- screenshots
- design tokens
- fonts
- assets
- text/sections/CTAs
- animation catalog
- optional Gemini vision descriptions

The skill turns those artifacts into a storyboard and compositions.

## 4. Registry/catalog

Registry source lives under:

```text
registry/registry.json
registry/examples/
registry/blocks/
registry/components/
```

CLI install path:

```text
hyperframes add <name>
  -> registry resolver
  -> per-item manifest
  -> installer fetches/copies files
  -> optional snippet/block insertion
```

Docs generation scripts create catalog pages and preview assets from registry
metadata. Treat registry item JSON as a public interface because agents and users
both consume it.

## 5. Docs

Important docs source files:

- `docs/introduction.mdx`
- `docs/quickstart.mdx`
- `docs/concepts/compositions.mdx`
- `docs/concepts/data-attributes.mdx`
- `docs/concepts/variables.mdx`
- `docs/concepts/determinism.mdx`
- `docs/concepts/frame-adapters.mdx`
- `docs/guides/rendering.mdx`
- `docs/guides/hdr.mdx`
- `docs/guides/4k-rendering.mdx`
- `docs/guides/html-in-canvas.mdx`
- `docs/guides/website-to-video.mdx`
- `docs/deploy/aws-lambda.mdx`
- `docs/deploy/templates-on-lambda.mdx`
- `docs/guides/mcp.mdx`

The public docs are now detailed enough that these deep-dive notes should focus
on internal architecture and source-reading maps instead of duplicating user
guides.

## 6. MCP vs OSS CLI

The hosted MCP and local CLI are different surfaces:

| Surface | User experience | Render owner |
|---|---|---|
| OSS CLI | local project, source files, local/deployed render commands | user machine or user AWS |
| `hyperframes cloud` | CLI call to HeyGen cloud | HeyGen cloud |
| MCP | compose/edit/render inside Claude.ai or ChatGPT | hosted HeyGen product |

MCP tools listed in docs include:

- `compose`
- `list_compositions`
- `get_composition`
- `render_video`
- `get_render_status`
- `get_credits`

The MCP agent has HyperFrames-specific authoring skills baked in. That does not
change the OSS runtime contract; it changes the authoring entrypoint.

## 7. Agent-friendly CLI design

Patterns visible across commands:

- non-interactive defaults
- plain text output
- `--json` where machine parsing matters
- flags over prompts
- fail-fast validation
- `.env` auto-load for common API keys
- skills/capture/template flows that produce explicit artifacts

This is why the CLI is useful to agents even without MCP.

## 8. Catalog contribution flow

Relevant scripts:

- `scripts/generate-registry-items.ts`
- `scripts/generate-catalog-pages.ts`
- `scripts/generate-catalog-previews.ts`
- `scripts/generate-template-previews.ts`
- `scripts/sync-schemas.ts`
- `scripts/verify-packed-manifests.mjs`

Expected contribution loop:

1. add or update registry item files
2. validate item JSON against schemas
3. generate/refresh previews and docs pages
4. verify packed manifests
5. run lint/tests relevant to the changed package

## 9. Why this belongs in a deep dive

HyperFrames' architecture is agent-native in two senses:

1. Runtime source is plain HTML, which agents can generate and edit.
2. The repo includes the agent instructions and catalog assets that steer those
   generated projects toward working compositions.

Ignoring `skills/`, `registry/`, and docs misses a major part of why the package
APIs look the way they do.

## 10. Next

Use this note as a map when a source question crosses package boundaries into
docs, skills, registry content, or hosted-product behavior.
