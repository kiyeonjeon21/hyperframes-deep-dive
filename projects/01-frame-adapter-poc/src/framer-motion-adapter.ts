/**
 * Framer Motion adapter for HyperFrames
 *
 * Goal: Make Framer Motion's `animate()` calls participate in deterministic
 * frame-accurate rendering by implementing the FrameAdapter contract.
 *
 * Reference:
 * - FrameAdapter interface: $HYPERFRAMES_REPO/packages/core/src/adapters/types.ts:9-15
 * - GSAP reference impl: $HYPERFRAMES_REPO/packages/core/src/adapters/gsap.ts
 * - anime.js global array: $HYPERFRAMES_REPO/packages/core/src/runtime/adapters/animejs.ts
 *
 * Phase 2 of the PoC. See README.md for the step-by-step plan.
 */

// ── Type imports (when running inside a real hyperframes project) ─────────
// import type { FrameAdapter, FrameAdapterContext } from "@hyperframes/core";

// ── Local re-declaration so this file stands alone for study ──────────────
interface FrameAdapterContext {
  compositionId: string;
  fps: number;
  width: number;
  height: number;
  rootElement?: HTMLElement;
}

interface FrameAdapter {
  id: string;
  init?(ctx: FrameAdapterContext): Promise<void> | void;
  getDurationFrames(): number;
  seekFrame(frame: number): Promise<void> | void;
  destroy?(): Promise<void> | void;
}

// ── Framer Motion type shape (minimal — no package dependency) ────────────
// motion v12+: import { animate } from "motion"
// motion legacy: import { animate } from "framer-motion"
//
// animate() returns an "AnimationPlaybackControls" object:
export interface AnimationPlaybackControls {
  duration: number;            // seconds
  iterationDuration: number;   // seconds, including delays
  time: number;                // current playhead, seconds — settable
  speed: number;               // playback rate
  startTime: number | null;    // ms
  state: "idle" | "running" | "paused" | "finished";
  play: () => void;
  pause: () => void;
  stop: () => void;
  cancel: () => void;
  complete: () => void;
  finished: Promise<unknown>;
}

// Compositions push their `animate(...)` return values onto this global so the
// adapter can find them. Same pattern as `__hfLottie` and `__hfAnime`.
declare global {
  interface Window {
    __hfFramerMotion?: AnimationPlaybackControls[];
  }
}

// ── Options ───────────────────────────────────────────────────────────────

export interface CreateFramerMotionAdapterOptions {
  id?: string;
  fps: number;
  /**
   * Optional: explicit list of controls. If omitted, the adapter reads from
   * `window.__hfFramerMotion`.
   */
  instances?: AnimationPlaybackControls[];
}

// ── The adapter ───────────────────────────────────────────────────────────

export function createFramerMotionAdapter(
  options: CreateFramerMotionAdapterOptions,
): FrameAdapter {
  const { fps } = options;
  const adapterId = options.id ?? "framer-motion";

  const getInstances = (): AnimationPlaybackControls[] => {
    if (options.instances) return options.instances;
    return (typeof window !== "undefined" && window.__hfFramerMotion) || [];
  };

  return {
    id: adapterId,

    // ──────────────────────────────────────────────────────────────────────
    // TODO 1 — init(ctx)
    // ──────────────────────────────────────────────────────────────────────
    // What should init do?
    //   1. Pause every registered instance (auto-play is on by default).
    //   2. Verify motion library is loaded (warn if window.motion missing — or
    //      is checking the global needed at all? animate() returns a control
    //      object directly, so the adapter doesn't need to import motion).
    //   3. Possibly warn if no instances are registered yet (compositions may
    //      register late).
    //
    // Open question: should init be sync or async? If a composition registers
    // instances inside its async setup, init might run before any are present.
    // Look at how `lottieReadiness.ts` handles late-registered Lottie animations.
    init: async (ctx: FrameAdapterContext): Promise<void> => {
      void ctx; // remove when ctx is used
      throw new Error("TODO 1 — implement init(ctx)");
    },

    // ──────────────────────────────────────────────────────────────────────
    // TODO 2 — getDurationFrames()
    // ──────────────────────────────────────────────────────────────────────
    // Decide: max(duration of all instances) or sum?
    //
    //   - max: most natural — total composition runs as long as the longest
    //     animation. Same as GSAP timeline (gsap.ts:22-25).
    //   - sum: only correct if instances run sequentially, which Framer Motion
    //     instances do NOT by default (each animate() call starts immediately).
    //
    // Hint: just use max. Compositions that need sequencing should chain via
    // .then() and the adapter's GSAP timeline can express the schedule.
    getDurationFrames: (): number => {
      throw new Error("TODO 2 — implement getDurationFrames()");
    },

    // ──────────────────────────────────────────────────────────────────────
    // TODO 3 — seekFrame(frame)
    // ──────────────────────────────────────────────────────────────────────
    // The deterministic core. For each registered instance:
    //   1. Convert frame → seconds: const seconds = frame / fps
    //   2. Pause the instance (must be paused for time setter to be deterministic)
    //   3. Set instance.time = seconds (or clamp to [0, instance.duration])
    //
    // Open questions:
    //   - Does Framer Motion's `time` setter trigger an onUpdate callback? If yes,
    //     the user's animation logic fires. If no, you need to call play() then
    //     pause() to flush... probably not needed, time setter is synchronous.
    //   - What if instance.duration is 0 (immediate complete)? clamp avoids NaN.
    //   - What about negative frame? clamp to 0.
    //
    // Pattern reference: GSAP adapter (gsap.ts:37-42).
    seekFrame: (frame: number): void => {
      void frame;
      throw new Error("TODO 3 — implement seekFrame(frame)");
    },

    // ──────────────────────────────────────────────────────────────────────
    // TODO 4 — destroy()
    // ──────────────────────────────────────────────────────────────────────
    // Optional but recommended.
    //   1. Cancel all instances (free GPU/timer resources)
    //   2. Clear the global array? Or leave to composition? — anime/Lottie
    //      adapters explicitly DO NOT clear (see lottie.ts:133-136 comment):
    //      "Don't clear ... — instances are owned by the composition."
    //   3. So: cancel(), but don't mutate the array.
    destroy: async (): Promise<void> => {
      throw new Error("TODO 4 — implement destroy()");
    },
  };

  // ↑ Suppress lint until TODOs are filled
  void getInstances;
}

// ── Self-test (run in browser devtools console after loading) ─────────────
//
// const adapter = createFramerMotionAdapter({ fps: 30 });
// const ctx = { compositionId: "test", fps: 30, width: 1920, height: 1080 };
//
// 1. Set up a fake instance:
//    window.__hfFramerMotion = [{
//      duration: 5, time: 0, speed: 1, state: "idle",
//      play() {}, pause() {}, stop() {}, cancel() {}, complete() {},
//      then() { return Promise.resolve(); },
//    }];
//
// 2. await adapter.init?.(ctx);
//
// 3. console.log(adapter.getDurationFrames());  // expected: 150 (5s * 30fps)
//
// 4. adapter.seekFrame(60);
//    console.log(window.__hfFramerMotion[0].time);  // expected: 2 (60/30)
