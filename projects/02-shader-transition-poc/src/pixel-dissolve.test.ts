/**
 * pixel-dissolve Node implementation tests.
 *
 * Run: `bun test` (from this directory)
 *
 * Covers:
 *   - rgb48le buffers (6 bytes/pixel, uint16 LE)
 *   - progress=0 copies `from`
 *   - progress=1 copies `to`
 *   - hash/vnoise determinism
 *   - block coherence (pixels inside a block flip together)
 *   - explicit errors for malformed buffer sizes
 */

import { describe, it, expect } from "bun:test";
import {
  pixelDissolve,
  hash,
  vnoise,
} from "./pixel-dissolve.reference";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Solid rgb48le buffer (R,G,B each uint16 0..65535) */
function solidBuffer(width: number, height: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(width * height * 6);
  for (let i = 0; i < width * height; i++) {
    const o = i * 6;
    buf.writeUInt16LE(r, o);
    buf.writeUInt16LE(g, o + 2);
    buf.writeUInt16LE(b, o + 4);
  }
  return buf;
}

/** Read RGB triple for pixel (x,y) */
function readPx(buf: Buffer, width: number, x: number, y: number): [number, number, number] {
  const o = (y * width + x) * 6;
  return [buf.readUInt16LE(o), buf.readUInt16LE(o + 2), buf.readUInt16LE(o + 4)];
}

// ── Hash determinism ─────────────────────────────────────────────────────

describe("hash function", () => {
  it("is deterministic for same input", () => {
    expect(hash(0.5, 0.5)).toBe(hash(0.5, 0.5));
    expect(hash(12.3, 45.6)).toBe(hash(12.3, 45.6));
  });

  it("returns values in [0, 1)", () => {
    for (const [x, y] of [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [10, 20],
      [100, 200],
      [1.7, 9.2],
    ]) {
      const v = hash(x!, y!);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs for different inputs (in general)", () => {
    expect(hash(0, 0)).not.toBe(hash(1, 0));
    expect(hash(0, 0)).not.toBe(hash(0, 1));
  });
});

describe("vnoise function", () => {
  it("is deterministic", () => {
    expect(vnoise(2.5, 3.5)).toBe(vnoise(2.5, 3.5));
  });

  it("returns values in [0, 1] (with quintic interpolation)", () => {
    for (let x = 0; x < 5; x += 0.3) {
      for (let y = 0; y < 5; y += 0.3) {
        const v = vnoise(x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("interpolates smoothly between grid points", () => {
    // At integer points, vnoise == hash
    const at_2_3 = vnoise(2, 3);
    const at_3_3 = vnoise(3, 3);
    const halfway = vnoise(2.5, 3);
    // halfway should be between the two endpoints
    const min = Math.min(at_2_3, at_3_3);
    const max = Math.max(at_2_3, at_3_3);
    expect(halfway).toBeGreaterThanOrEqual(min - 0.001);
    expect(halfway).toBeLessThanOrEqual(max + 0.001);
  });
});

// ── pixelDissolve algorithm ───────────────────────────────────────────────

describe("pixelDissolve — boundaries", () => {
  const W = 90;
  const H = 60;
  const RED = solidBuffer(W, H, 65535, 0, 0);
  const GREEN = solidBuffer(W, H, 0, 65535, 0);

  it("progress=0 returns from buffer (all red)", () => {
    const out = Buffer.alloc(W * H * 6);
    pixelDissolve(RED, GREEN, out, W, H, 0);
    expect(readPx(out, W, 0, 0)).toEqual([65535, 0, 0]);
    expect(readPx(out, W, W - 1, H - 1)).toEqual([65535, 0, 0]);
    expect(readPx(out, W, 45, 30)).toEqual([65535, 0, 0]);
  });

  it("progress=1 returns to buffer (all green)", () => {
    const out = Buffer.alloc(W * H * 6);
    pixelDissolve(RED, GREEN, out, W, H, 1);
    expect(readPx(out, W, 0, 0)).toEqual([0, 65535, 0]);
    expect(readPx(out, W, W - 1, H - 1)).toEqual([0, 65535, 0]);
  });

  it("progress=0.5 mixes — some pixels still red, some already green", () => {
    const out = Buffer.alloc(W * H * 6);
    pixelDissolve(RED, GREEN, out, W, H, 0.5);
    let redPixels = 0;
    let greenPixels = 0;
    let mixedPixels = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [r, g] = readPx(out, W, x, y);
        if (r > 50000 && g < 5000) redPixels++;
        else if (g > 50000 && r < 5000) greenPixels++;
        else mixedPixels++;
      }
    }
    expect(redPixels).toBeGreaterThan(0);
    expect(greenPixels).toBeGreaterThan(0);
    // mid-progress should have some still-red, some already-green pixels
    expect(redPixels + greenPixels).toBeGreaterThan(W * H * 0.5);
  });

  it("clamps negative progress to 0 (returns from)", () => {
    const out = Buffer.alloc(W * H * 6);
    pixelDissolve(RED, GREEN, out, W, H, -0.5);
    expect(readPx(out, W, 10, 10)).toEqual([65535, 0, 0]);
  });

  it("clamps progress > 1 to 1 (returns to)", () => {
    const out = Buffer.alloc(W * H * 6);
    pixelDissolve(RED, GREEN, out, W, H, 1.5);
    expect(readPx(out, W, 10, 10)).toEqual([0, 65535, 0]);
  });
});

describe("pixelDissolve — determinism", () => {
  const W = 90;
  const H = 60;
  const FROM = solidBuffer(W, H, 30000, 10000, 50000);
  const TO = solidBuffer(W, H, 5000, 60000, 25000);

  it("idempotent — same input produces same output", () => {
    const out1 = Buffer.alloc(W * H * 6);
    const out2 = Buffer.alloc(W * H * 6);
    pixelDissolve(FROM, TO, out1, W, H, 0.5);
    pixelDissolve(FROM, TO, out2, W, H, 0.5);
    expect(out1.equals(out2)).toBe(true);
  });

  it("different progress produces different output", () => {
    const out1 = Buffer.alloc(W * H * 6);
    const out2 = Buffer.alloc(W * H * 6);
    pixelDissolve(FROM, TO, out1, W, H, 0.3);
    pixelDissolve(FROM, TO, out2, W, H, 0.7);
    expect(out1.equals(out2)).toBe(false);
  });
});

describe("pixelDissolve — block consistency", () => {
  const W = 300; // 30 blocks × 10 px/block
  const H = 30;  // 3 blocks × 10 px/block (30 * H/W = 3)
  const FROM = solidBuffer(W, H, 65535, 0, 0);
  const TO = solidBuffer(W, H, 0, 65535, 0);

  it("all pixels within a block have the same mask value (same color)", () => {
    const out = Buffer.alloc(W * H * 6);
    pixelDissolve(FROM, TO, out, W, H, 0.5);

    // Block (0,0) spans x:0–9, y:0–9 — noise mask constant ⇒ uniform color
    const colors = new Set<string>();
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const [r, g, b] = readPx(out, W, x, y);
        colors.add(`${r},${g},${b}`);
      }
    }
    expect(colors.size).toBe(1); // One block → one color
  });

  it("different blocks may have different colors at mid-progress", () => {
    const out = Buffer.alloc(W * H * 6);
    pixelDissolve(FROM, TO, out, W, H, 0.5);

    // Sample top-left pixel of each horizontal block — noise spreads colors
    const blockColors = new Set<string>();
    for (let bx = 0; bx < 30; bx++) {
      const x = bx * 10;
      const y = 5;
      const [r, g, b] = readPx(out, W, x, y);
      blockColors.add(`${r},${g},${b}`);
    }
    // Expect multiple mixtures (red-ish, green-ish, mid-tones)
    expect(blockColors.size).toBeGreaterThan(1);
  });
});

describe("pixelDissolve — error handling", () => {
  it("throws on buffer size mismatch", () => {
    const W = 30, H = 20;
    const from = Buffer.alloc(W * H * 6);
    const to = Buffer.alloc(W * H * 6);
    const wrongOut = Buffer.alloc(W * H * 4); // wrong size
    expect(() => pixelDissolve(from, to, wrongOut, W, H, 0.5)).toThrow();
  });

  it("throws on width*height*6 mismatch", () => {
    const from = Buffer.alloc(100); // not 30*20*6
    const to = Buffer.alloc(100);
    const out = Buffer.alloc(100);
    expect(() => pixelDissolve(from, to, out, 30, 20, 0.5)).toThrow();
  });
});

describe("pixelDissolve — uint16 range", () => {
  it("output values are valid uint16 (0..65535)", () => {
    const W = 60;
    const H = 30;
    const FROM = solidBuffer(W, H, 65535, 65535, 65535);
    const TO = solidBuffer(W, H, 0, 0, 0);
    const out = Buffer.alloc(W * H * 6);
    pixelDissolve(FROM, TO, out, W, H, 0.5);

    for (let i = 0; i < W * H; i++) {
      const o = i * 6;
      const r = out.readUInt16LE(o);
      const g = out.readUInt16LE(o + 2);
      const b = out.readUInt16LE(o + 4);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(65535);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(65535);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(65535);
    }
  });
});
