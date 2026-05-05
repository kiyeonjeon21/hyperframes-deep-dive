/**
 * pixel-dissolve transition (Node implementation, REFERENCE)
 *
 * Working implementation — compare while filling `pixel-dissolve.ts`.
 *
 * Verified against engine `shaderTransitions.ts:340-375` crossfade (2026-05-05):
 *
 *   - TransitionFn uses Buffer (NOT Uint8Array).
 *   - 6 bytes per pixel rgb48le (16-bit LE channels).
 *     No alpha — DOM layers emit alpha via separate PNG paths.
 *   - Pixel values 0..65535 (uint16) for HDR PQ/HLG or SDR.
 *   - Read/write with readUInt16LE / writeUInt16LE.
 *
 *   ```ts
 *   export type TransitionFn = (
 *     from: Buffer, to: Buffer, output: Buffer,
 *     width: number, height: number, progress: number,
 *   ) => void;
 *   ```
 *
 * Decisions (answers for notes.md items 1–3):
 *   1. Block grid: 30 columns; rows scaled by aspect (~30 * h/w).
 *   2. Edge: smoothstep(±0.05) — soft boundary aligns with GLSL.
 *   3. Noise: single-octave `vnoise` — fast and sufficient.
 */

// ── TransitionFn signature (matches engine) ─────────────────────────────────

export type TransitionFn = (
  from: Buffer,
  to: Buffer,
  output: Buffer,
  width: number,
  height: number,
  progress: number,
) => void;

// ── GLSL helpers (JS port aligned with common.ts) ────────────────────────────

/** GLSL `fract(x)` */
function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * Port of GLSL `hash(p)`:
 *   fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)
 *
 * Note: GLSL `mediump float` (fp16/fp32) vs JS double may diverge bit-wise.
 * Deterministic within JS; comparing against GPU paths may drift on mask edges
 * (pixels inside the smoothstep band).
 */
export function hash(x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
}

/** GLSL `vnoise(p)` quintic interpolation */
export function vnoise(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let fx = px - ix;
  let fy = py - iy;
  // f = f*f*f*(f*(f*6-15)+10) — quintic C2
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

// ── pixel-dissolve transition ────────────────────────────────────────────────

/**
 * Pixel dissolve — macro blocks pick noise thresholds; once progress crosses a
 * threshold the pixel swaps toward the destination scene. Soft edges keep the
 * dissolve smooth near threshold crossings.
 *
 * Equivalent GLSL:
 *   vec2 b = floor(v_uv * 30.0) / 30.0;
 *   float t = vnoise(b * 50.0);
 *   float m = smoothstep(t - 0.05, t + 0.05, u_progress);
 *   gl_FragColor = mix(texture2D(u_from, v_uv), texture2D(u_to, v_uv), m);
 *
 * Node-specific notes:
 *   - Operate in block-index space instead of raw UV so floor(v_uv * 30)/30 matches blockIdx/30.
 *   - Noise inputs align via blockIdx * 50/30 scaling refinements.
 *   - Edge glow omitted (optional TODO in GLSL).
 */
export const pixelDissolve: TransitionFn = (
  from,
  to,
  output,
  width,
  height,
  progress,
) => {
  if (from.length !== to.length || from.length !== output.length) {
    throw new Error(
      `[pixelDissolve] buffer size mismatch: from=${from.length}, to=${to.length}, output=${output.length}`,
    );
  }
  const expectedBytes = width * height * 6;
  if (from.length !== expectedBytes) {
    throw new Error(
      `[pixelDissolve] buffer size ${from.length} doesn't match width*height*6 = ${expectedBytes}`,
    );
  }

  const safeProgress = Math.max(0, Math.min(1, progress));

  // Boundary short-circuit. Because vnoise(0,0)=0, the top-left block threshold is 0 and
  // smoothstep(-0.05, 0.05, 0)=0.5 mixes 50% at progress 0. Explicitly copy buffers at 0/1.
  if (safeProgress === 0) {
    from.copy(output);
    return;
  }
  if (safeProgress === 1) {
    to.copy(output);
    return;
  }

  const blocksX = 30;
  const blocksY = Math.max(1, Math.round(30 * (height / width)));
  const pxPerBlockX = width / blocksX;
  const pxPerBlockY = height / blocksY;

  // Precompute thresholds once per block (pixels inside share the mask)
  const thresholds = new Float64Array(blocksX * blocksY);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // GLSL: vnoise(b * 50) where b = block UV in [0,1)
      // Node mirrors via scaled indices.
      const noiseInput_x = (bx / blocksX) * 50;
      const noiseInput_y = (by / blocksY) * 50;
      thresholds[by * blocksX + bx] = vnoise(noiseInput_x, noiseInput_y);
    }
  }

  for (let y = 0; y < height; y++) {
    const blockY = Math.min(blocksY - 1, Math.floor(y / pxPerBlockY));
    for (let x = 0; x < width; x++) {
      const blockX = Math.min(blocksX - 1, Math.floor(x / pxPerBlockX));
      const threshold = thresholds[blockY * blocksX + blockX]!;
      const mask = smoothstep(threshold - 0.05, threshold + 0.05, safeProgress);
      const inv = 1 - mask;

      const o = (y * width + x) * 6;
      const fromR = from.readUInt16LE(o);
      const fromG = from.readUInt16LE(o + 2);
      const fromB = from.readUInt16LE(o + 4);
      const toR = to.readUInt16LE(o);
      const toG = to.readUInt16LE(o + 2);
      const toB = to.readUInt16LE(o + 4);

      output.writeUInt16LE(Math.round(fromR * inv + toR * mask), o);
      output.writeUInt16LE(Math.round(fromG * inv + toG * mask), o + 2);
      output.writeUInt16LE(Math.round(fromB * inv + toB * mask), o + 4);
    }
  }
};
