# file-refs-audit

> Audit log verifying that `packages/.../*.ts(:line)` references in all lab notes map to real hyperframes source.

## Last audit: 2026-05-05

### Extraction method

```bash
grep -hroE 'packages/[a-z-]+/src/[a-zA-Z0-9_/.-]+\.ts(:[0-9]+(-[0-9]+)?)?' \
  notes/*.md \
  notes/cheatsheets/*.md \
  | sort -u
```

Unique `.ts` references extracted: **45** (`.tsx` tracked separately)

### Verification procedure

For each ref:
1. Confirm `$HYPERFRAMES_REPO/<file>` exists
2. If a line number is present, confirm it is within the file’s line count

```bash
export HYPERFRAMES_REPO=/path/to/hyperframes

while read ref; do
  file="${ref%%:*}"
  if [ ! -f "$HYPERFRAMES_REPO/$file" ]; then
    echo "MISSING: $ref"
  fi
  if [[ "$ref" == *:* ]]; then
    line="${ref#*:}"; line="${line%%-*}"
    max=$(wc -l < "$HYPERFRAMES_REPO/$file" 2>/dev/null)
    if [ "$line" -gt "$max" ] 2>/dev/null; then
      echo "OUT_OF_RANGE: $ref (file has $max lines)"
    fi
  fi
done < /tmp/lab-refs-all.txt
```

### Results (2026-05-05)

| Item | Finding | Action |
|---|---|---|
| MISSING `packages/producer/src/audioRegression.ts` | cheatsheet/04:67 — actual path is `packages/producer/src/utils/audioRegression.ts` | Patched |
| MISSING `packages/studio/src/components/nle/NLELayout.ts` | Regex limitation (actual entry uses `.tsx`) — false positive | (no action) |
| MISSING `packages/studio/src/player/Player.ts` | Same false positive (actual `.tsx`) | (no action) |
| OUT_OF_RANGE | 0 cases | (no action) |

**Real fix needed**: one — correct `audioRegression.ts` → `utils/audioRegression.ts` in cheatsheet/04.

### Separate `.tsx` verification (auxiliary)

Also verify `.tsx` refs:

```bash
grep -hroE 'packages/[a-z-]+/src/[a-zA-Z0-9_/.-]+\.tsx(:[0-9]+(-[0-9]+)?)?' \
  notes/*.md ...
```

NLELayout.tsx, Player.tsx, App.tsx, etc. — all confirmed under `$HYPERFRAMES_REPO/`.

### Recommended periodic audits

- When adding new notes (after Phase F.4 / F.5)
- After hyperframes commits that may shift line numbers
- Possible automation: `bun run audit` npm script (not written yet)

## Open gaps (cases automatic audit cannot catch)

These checks need contextual rereading:
- Function name refs (e.g. `prepareFrameForCapture`) — may be renamed
- Constant names (e.g. `MIRROR_DRIFT_THRESHOLD_SECONDS = 0.05`) — values may change
- Specific commit hashes — OK if history unchanged

Track with explicit `<verified 2026-05-05>` timestamps in notes where relevant.
