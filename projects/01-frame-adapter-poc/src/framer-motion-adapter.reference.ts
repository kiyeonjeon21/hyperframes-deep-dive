/**
 * Framer Motion adapter — REFERENCE implementation (complete, working)
 *
 * Learning goal: fill `framer-motion-adapter.ts` (skeleton) yourself.
 * Compare against this file when stuck or verifying behavior.
 *
 * Verified against motion-dom@12.38.0 d.ts (2026-05-05):
 *   - controls.time       = number, **seconds**
 *   - controls.duration   = number, seconds (core motion segment only)
 *   - controls.iterationDuration = number, seconds (includes delays)
 *   - controls.state      = "idle" | "running" | "paused" | "finished"
 *   - controls.pause()    = stop autoplay
 *   - controls.cancel()   = tear down instance (do not reuse)
 *
 * Decisions (answers for notes.md items 1–3):
 *   1. Instance tracking: `window.__hfFramerMotion` global array (Lottie-style)
 *      - motion v12 has no anime-like `running` global registry
 *      - `getAnimations()` scan only covers CSS animations (when FM falls back to element animations)
 *      - → explicit global array is simplest
 *   2. Time units: `time` setter is seconds; seconds = frame / fps
 *   3. Block autoplay: call `pause()` on every `seekFrame` (once in `init` is not enough — new `animate()` after pause may go running again)
 *
 * Determinism:
 *   - Each `seekFrame` atomically does pause + set time
 *   - Clamp time to [0, iterationDuration] — seeking past end sticks at last frame
 *   - Negative frames clamp to 0
 */

// ── FrameAdapter interface (self-contained in this lab) ──────────────────
// In production: import { FrameAdapter, FrameAdapterContext } from "@hyperframes/core"

export interface FrameAdapterContext {
  compositionId: string;
  fps: number;
  width: number;
  height: number;
  rootElement?: HTMLElement;
}

export interface FrameAdapter {
  id: string;
  init?(ctx: FrameAdapterContext): Promise<void> | void;
  getDurationFrames(): number;
  seekFrame(frame: number): Promise<void> | void;
  destroy?(): Promise<void> | void;
}

// ── Framer Motion v12 type shape (from motion-dom, verified) ─────────────

export interface AnimationPlaybackControls {
  time: number;                  // seconds
  speed: number;
  startTime: number | null;      // ms
  state: "idle" | "running" | "paused" | "finished";
  duration: number;              // seconds (core segment)
  iterationDuration: number;     // seconds (includes delays)
  stop: () => void;
  play: () => void;
  pause: () => void;
  complete: () => void;
  cancel: () => void;
  finished: Promise<unknown>;
}

declare global {
  interface Window {
    __hfFramerMotion?: AnimationPlaybackControls[];
  }
}

// ── Options ──────────────────────────────────────────────────────────────

export interface CreateFramerMotionAdapterOptions {
  id?: string;
  fps: number;
  /**
   * Explicit instance list. If omitted, read `window.__hfFramerMotion`.
   * (Tests pass instances explicitly; real pages use the global array.)
   */
  instances?: AnimationPlaybackControls[];
}

// ── Adapter ─────────────────────────────────────────────────────────────

export function createFramerMotionAdapter(
  options: CreateFramerMotionAdapterOptions,
): FrameAdapter {
  const { fps } = options;
  const adapterId = options.id ?? "framer-motion";

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(
      `[framer-motion adapter] fps must be a positive finite number, got ${fps}`,
    );
  }

  const getInstances = (): AnimationPlaybackControls[] => {
    if (options.instances) return options.instances;
    if (typeof window !== "undefined" && window.__hfFramerMotion) {
      return window.__hfFramerMotion;
    }
    return [];
  };

  /** Max iterationDuration (seconds) across instances. */
  const getMaxDurationSeconds = (): number => {
    let max = 0;
    for (const inst of getInstances()) {
      const d = Number.isFinite(inst.iterationDuration)
        ? inst.iterationDuration
        : Number.isFinite(inst.duration)
          ? inst.duration
          : 0;
      if (d > max) max = d;
    }
    return max;
  };

  return {
    id: adapterId,

    /**
     * Deterministic setup:
     *   - Pause every registered instance immediately (block autoplay)
     *   - Instances registered later are still paused on each `seekFrame`
     */
    init: (_ctx: FrameAdapterContext): void => {
      for (const inst of getInstances()) {
        try {
          inst.pause();
        } catch {
          // motion may throw on pause due to internal races — swallow.
          // Next seekFrame retries pause.
        }
      }
    },

    /**
     * Integer frame count up to end of iterationDuration.
     * Returns 0 with no instances (engine uses external duration).
     */
    getDurationFrames: (): number => {
      const seconds = getMaxDurationSeconds();
      return Math.max(0, Math.ceil(seconds * fps));
    },

    /**
     * Deterministic seek. Each call:
     *   1. Pause all instances (guard against autoplay)
     *   2. Compute clamped seconds
     *   3. Assign `time` (motion updates pixels synchronously)
     */
    seekFrame: (frame: number): void => {
      const safeFrame = Number.isFinite(frame) ? Math.max(0, frame) : 0;
      const targetSeconds = safeFrame / fps;

      for (const inst of getInstances()) {
        try {
          inst.pause();
          const max = Number.isFinite(inst.iterationDuration)
            ? inst.iterationDuration
            : Number.isFinite(inst.duration)
              ? inst.duration
              : Infinity;
          const clamped = Math.min(targetSeconds, max);
          inst.time = clamped;
        } catch {
          // One broken instance must not block others — same pattern as lottie.ts:111, animejs.ts:81.
        }
      }
    },

    /**
     * Cleanup. Instances remain owned by the composition — do not clear globals.
     * Mirrors lottie.ts:133-136 commentary.
     */
    destroy: (): void => {
      for (const inst of getInstances()) {
        try {
          inst.cancel();
        } catch {
          // ignore
        }
      }
    },
  };
}
