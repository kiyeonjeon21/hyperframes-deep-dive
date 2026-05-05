/**
 * Adapter unit tests.
 *
 * Run: `bun test` (from this directory)
 *
 * Goals:
 *   - Reference implementation satisfies `FrameAdapter`
 *   - Determinism on mock instances (same frame → same result)
 *   - Edge cases (negative frame, seek past end, zero instances)
 *
 * Passing these while filling your own skeleton is the learning signal.
 *
 * To validate your skeleton, switch the import from `.reference` to `.ts`:
 *   import { createFramerMotionAdapter } from "./framer-motion-adapter";  // skeleton
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  createFramerMotionAdapter,
  type AnimationPlaybackControls,
  type FrameAdapterContext,
} from "./framer-motion-adapter.reference";

// ── Mock factory ──────────────────────────────────────────────────────────

interface MockInstance extends AnimationPlaybackControls {
  // Counters for test assertions
  _pauseCalls: number;
  _cancelCalls: number;
  _timeWrites: number[];
}

function mockInstance(durationSec: number): MockInstance {
  let _time = 0;
  const inst = {
    get time() {
      return _time;
    },
    set time(v: number) {
      _time = v;
      inst._timeWrites.push(v);
    },
    speed: 1,
    startTime: 0 as number | null,
    state: "idle" as const,
    duration: durationSec,
    iterationDuration: durationSec,
    stop() {},
    play() {
      inst.state = "running" as never;
    },
    pause() {
      inst._pauseCalls++;
      inst.state = "paused" as never;
    },
    complete() {},
    cancel() {
      inst._cancelCalls++;
    },
    finished: Promise.resolve(),
    _pauseCalls: 0,
    _cancelCalls: 0,
    _timeWrites: [] as number[],
  };
  return inst as unknown as MockInstance;
}

const ctx: FrameAdapterContext = {
  compositionId: "test",
  fps: 30,
  width: 1920,
  height: 1080,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("createFramerMotionAdapter — interface", () => {
  it("returns FrameAdapter with required fields", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [] });
    expect(adapter.id).toBe("framer-motion");
    expect(typeof adapter.init).toBe("function");
    expect(typeof adapter.getDurationFrames).toBe("function");
    expect(typeof adapter.seekFrame).toBe("function");
    expect(typeof adapter.destroy).toBe("function");
  });

  it("accepts custom id", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, id: "fm-v12", instances: [] });
    expect(adapter.id).toBe("fm-v12");
  });

  it("throws on invalid fps", () => {
    expect(() => createFramerMotionAdapter({ fps: 0, instances: [] })).toThrow();
    expect(() => createFramerMotionAdapter({ fps: -1, instances: [] })).toThrow();
    expect(() => createFramerMotionAdapter({ fps: NaN, instances: [] })).toThrow();
  });
});

describe("getDurationFrames", () => {
  it("returns 0 with no instances", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [] });
    expect(adapter.getDurationFrames()).toBe(0);
  });

  it("returns ceil(longest * fps)", () => {
    const a = mockInstance(2.0); // 60 frames
    const b = mockInstance(3.5); // 105 frames
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [a, b] });
    expect(adapter.getDurationFrames()).toBe(Math.ceil(3.5 * 30));
  });

  it("uses iterationDuration over duration when delays present", () => {
    const inst = mockInstance(2.0);
    inst.duration = 2.0;
    inst.iterationDuration = 5.0; // 3s delay + 2s main motion
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [inst] });
    expect(adapter.getDurationFrames()).toBe(150); // 5 * 30
  });
});

describe("init pauses all instances", () => {
  it("calls pause() on every instance", async () => {
    const a = mockInstance(2);
    const b = mockInstance(2);
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [a, b] });
    await adapter.init?.(ctx);
    expect(a._pauseCalls).toBeGreaterThanOrEqual(1);
    expect(b._pauseCalls).toBeGreaterThanOrEqual(1);
  });

  it("survives an instance whose pause() throws", async () => {
    const a = mockInstance(2);
    const bad = mockInstance(2);
    bad.pause = () => {
      throw new Error("simulated pause failure");
    };
    const c = mockInstance(2);
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [a, bad, c] });
    await adapter.init?.(ctx); // must not throw
    expect(a._pauseCalls).toBe(1);
    expect(c._pauseCalls).toBe(1);
  });
});

describe("seekFrame — deterministic", () => {
  let inst: MockInstance;
  beforeEach(() => {
    inst = mockInstance(5); // 5s = 150 frames @ 30fps
  });

  it("seekFrame(0) sets time to 0", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [inst] });
    adapter.seekFrame(0);
    expect(inst.time).toBe(0);
    expect(inst._pauseCalls).toBeGreaterThanOrEqual(1);
  });

  it("seekFrame(75) at 30fps sets time to 2.5", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [inst] });
    adapter.seekFrame(75);
    expect(inst.time).toBeCloseTo(2.5);
  });

  it("clamps negative frame to 0", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [inst] });
    adapter.seekFrame(-10);
    expect(inst.time).toBe(0);
  });

  it("clamps frame past iterationDuration to max", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [inst] });
    adapter.seekFrame(300); // 10s = 2× duration
    expect(inst.time).toBe(5); // iterationDuration cap
  });

  it("treats NaN/Infinity as 0", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [inst] });
    adapter.seekFrame(NaN);
    expect(inst.time).toBe(0);
  });

  it("idempotent — same frame twice yields same time", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [inst] });
    adapter.seekFrame(45);
    const first = inst.time;
    adapter.seekFrame(45);
    expect(inst.time).toBe(first);
  });

  it("pauses on every seek (defensive)", () => {
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [inst] });
    adapter.seekFrame(10);
    adapter.seekFrame(20);
    adapter.seekFrame(30);
    expect(inst._pauseCalls).toBe(3); // init not called — exactly three pauses
  });

  it("propagates seek to all instances", () => {
    const a = mockInstance(5);
    const b = mockInstance(5);
    const c = mockInstance(5);
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [a, b, c] });
    adapter.seekFrame(60);
    expect(a.time).toBeCloseTo(2);
    expect(b.time).toBeCloseTo(2);
    expect(c.time).toBeCloseTo(2);
  });

  it("survives an instance whose pause throws — others still seek", () => {
    const good = mockInstance(5);
    const bad = mockInstance(5);
    bad.pause = () => {
      throw new Error("boom");
    };
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [good, bad] });
    adapter.seekFrame(60);
    expect(good.time).toBeCloseTo(2);
    // bad.time is not updated when pause throws (intentional catch behavior)
  });
});

describe("destroy — cleanup", () => {
  it("calls cancel on every instance", async () => {
    const a = mockInstance(5);
    const b = mockInstance(5);
    const adapter = createFramerMotionAdapter({ fps: 30, instances: [a, b] });
    await adapter.destroy?.();
    expect(a._cancelCalls).toBe(1);
    expect(b._cancelCalls).toBe(1);
  });

  it("does not clear external instances array", () => {
    const inst = mockInstance(5);
    const list = [inst];
    const adapter = createFramerMotionAdapter({ fps: 30, instances: list });
    adapter.destroy?.();
    // Adapter only calls cancel; does not clear the external array
    expect(list.length).toBe(1);
  });
});

describe("global window.__hfFramerMotion path", () => {
  it("falls back to global when instances option omitted", () => {
    // Assumes happy-dom for bun:test or provides a stub
    const inst = mockInstance(3);
    (globalThis as unknown as { window?: Window }).window =
      (globalThis as unknown as { window?: Window }).window ??
      ({} as Window);
    (globalThis as unknown as { window: { __hfFramerMotion?: AnimationPlaybackControls[] } })
      .window.__hfFramerMotion = [inst];

    const adapter = createFramerMotionAdapter({ fps: 30 });
    adapter.seekFrame(30);
    expect(inst.time).toBeCloseTo(1);

    // cleanup
    delete (globalThis as unknown as { window: { __hfFramerMotion?: unknown } })
      .window.__hfFramerMotion;
  });
});
