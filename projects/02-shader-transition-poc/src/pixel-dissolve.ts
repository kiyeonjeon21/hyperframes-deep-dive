/**
 * pixel-dissolve transition (Node implementation, SKELETON)
 *
 * After implementation, register this under `TRANSITIONS` in
 * `packages/engine/src/utils/shaderTransitions.ts`.
 *
 * Verified signature (`shaderTransitions.ts:343-350`, 2026-05-05):
 *   - Use **Buffer** (Node.js Buffer, not Uint8Array)
 *   - **6 bytes per pixel**: rgb48le (16-bit LE for each R, G, B)
 *   - Pixel range 0..65535
 *   - **No alpha** — DOM layers supply alpha via separate PNGs
 *   - Read/write with readUInt16LE / writeUInt16LE
 *
 * Stuck? Compare `pixel-dissolve.reference.ts`.
 * Validate with `bun test` — all 18 tests in `pixel-dissolve.test.ts` must pass.
 *
 * Determinism caveats:
 *   - GLSL `mediump float` ≈ fp16/fp32 vs JS fp64
 *   - sin/dot/fract may differ slightly across stacks
 *   - Single-bit hash deltas flip mask boundaries
 *   - `vnoise(0, 0)` = 0 → handle progress=0 edge cases (short-circuit both ends)
 */

// ── TransitionFn signature (matches engine shaderTransitions.ts:343-350) ───

export type TransitionFn = (
  from: Buffer,
  to: Buffer,
  output: Buffer,
  width: number,
  height: number,
  progress: number,
) => void;

// ── JS port of GLSL helpers ───────────────────────────────────────────────

function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * GLSL `hash(p)`:
 *   fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)
 *
 * Note: GLSL mediump sin vs JS Math.sin are not bit-identical.
 */
export function hash(x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
}

/** GLSL `vnoise(p)` — quintic interpolation */
export function vnoise(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let fx = px - ix;
  let fy = py - iy;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── Main transition function ──────────────────────────────────────────────

export const pixelDissolve: TransitionFn = (
  from,
  to,
  output,
  width,
  height,
  progress,
) => {
  // TODO 1: Validate buffer sizes
  //   - from.length === to.length === output.length === width * height * 6
  //   - throw if mismatched

  // TODO 2: Clamp progress + boundary short-circuit
  //   - safeProgress = clamp(progress, 0, 1)
  //   - safeProgress === 0 → from.copy(output); return
  //   - safeProgress === 1 → to.copy(output); return
  //   (Avoid vnoise(0,0)=0 making threshold 0 yield mask 0.5 at progress 0)

  // TODO 3: Define block grid
  //   - blocksX = 30
  //   - blocksY = max(1, round(30 * height/width))  — roughly square blocks
  //   - pxPerBlockX = width / blocksX
  //   - pxPerBlockY = height / blocksY

  // TODO 4: Precompute per-block thresholds
  //   - thresholds[blockIdx] = vnoise(bx * 50/blocksX, by * 50/blocksY)
  //   - Align with GLSL: vnoise(blockUv * 50)

  // TODO 5: Pixel loop + mask + 16-bit RGB mix
  //   for y in [0, height):
  //     blockY = min(blocksY-1, floor(y / pxPerBlockY))
  //     for x in [0, width):
  //       blockX = min(blocksX-1, floor(x / pxPerBlockX))
  //       threshold = thresholds[blockY * blocksX + blockX]
  //       mask = smoothstep(threshold - 0.05, threshold + 0.05, safeProgress)
  //       o = (y * width + x) * 6
  //       For each channel (R, G, B):
  //         out = round(from.readUInt16LE(o) * (1 - mask) + to.readUInt16LE(o) * mask)
  //         output.writeUInt16LE(out, o) (advance offsets +2 per channel)

  void from; void to; void output; void width; void height; void progress;
  void hash; void vnoise; void mix; void smoothstep;
  throw new Error("TODO — implement pixelDissolve");
};
