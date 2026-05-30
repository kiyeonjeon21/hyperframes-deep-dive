# file-refs-audit

> Audit log for local source references in these notes. The notes intentionally
> prefer file-level references over brittle line numbers.

## Last audit: 2026-05-30

Baseline source checkout:

```text
/Users/kiyeonjeon/dev/oss/hyperframes
branch: feat/registry-news-ticker-preview
commit: a5f3b5b2
package version: 0.6.61
```

## Extraction method

From this repo:

```bash
rg -o 'packages/[A-Za-z0-9_./-]+\\.(tsx|ts|mjs|json|js|mdx|md)(:[0-9]+)?' README.md notes \
  | sed 's/.*packages/packages/' \
  | sort -u
```

Then check each path against:

```text
/Users/kiyeonjeon/dev/oss/hyperframes/<path>
```

Important regex detail: longer suffixes must appear before shorter overlapping
suffixes (`tsx` before `ts`, `json` before `js`) or paths can be partially
matched.

## Results

Current audit after the v0.6.61 refresh:

- README and notes source references resolve against the local checkout.
- Old stale references to removed/moved Studio paths were eliminated.
- Old stale references to the former producer audio regression helper path were
  eliminated; the current helper lives under `packages/producer/src/utils/`.
- The notes now avoid line-specific references except in code examples or
  user-facing commands.

## Stale-claim scan

Commands:

Search for the old baseline version, old command-count claims, old package-count
claims, old large-file LOC claims, and the old linter rule count.

Expected remaining matches:

- README progress metadata may mention the original v0.4.45 baseline as history.
- Architecture note may say package count grew from seven to eight as historical
  context.

Anything else should be treated as stale and rechecked against the source.

## Limits

This audit only proves that referenced files exist. It does not prove:

- a prose claim is semantically correct
- a symbol still has the same behavior
- a generated docs page matches generated source
- a public docs URL is live
- a line number remains accurate

For behavioral claims, rerun targeted `rg`, source reads, and package tests.

## Recommended periodic audit

After pulling upstream:

```bash
cd /Users/kiyeonjeon/dev/oss/hyperframes
git log -1 --oneline
jq -r '.version' packages/core/package.json

cd /Users/kiyeonjeon/dev/personal/labs/hyperframe-deep-dive
rg -n 'v0\\.4\\.45|old command count|old rule count' README.md notes
```

Then rerun the path existence check above.
