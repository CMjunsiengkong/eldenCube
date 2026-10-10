/**
 * Fixed-timestep main loop with hit-stop and time scale (ARCHITECTURE.md §4.1).
 *
 * - `update(STEP)` runs the simulation in fixed steps (simulation time).
 * - `realUpdate(frameDt)` runs every frame, even during hit-stop and pause (real-time timers:
 *   input locks, victory auto-return, fades, debug overlay).
 * - `render()` runs every frame.
 */

/** Fixed simulation step (s). */
export const STEP = 1 / 60;
/** Maximum simulation steps per frame (avoids a spiral of death). */
export const MAX_STEPS_PER_FRAME = 5;
/** Long frames (tab switch) are clamped to this (s). */
export const MAX_FRAME_DT = 0.1;

/** What gameplay code may ask of the loop. */
export interface TimeControl {
  hitStop(seconds: number): void;
  setTimeScale(scale: number, seconds: number): void;
}

/** What Game needs from the loop: time control plus pause and a timing reset. */
export interface GameClock extends TimeControl {
  paused: boolean;
  resetTiming(): void;
}

export interface LoopTarget {
  update(dt: number): void;
  realUpdate(frameDt: number): void;
  render(): void;
}

type Scheduler = (cb: (now: number) => void) => unknown;

export class Loop implements GameClock {
  /** While true, only `realUpdate` and `render` run. */
  paused = false;

  private readonly target: LoopTarget;
  private readonly schedule: Scheduler;
  private acc = 0;
  private last: number | null = null;
  private hitStopLeft = 0;
  private timeScale = 1;
  private timeScaleLeft = 0;
  private running = false;

  constructor(target: LoopTarget, schedule: Scheduler = (cb) => requestAnimationFrame(cb)) {
    this.target = target;
    this.schedule = schedule;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(this.onFrame);
  }

  /** Freezes the simulation (rendering continues). Keeps the max of the current and the new value. */
  hitStop(seconds: number): void {
    this.hitStopLeft = Math.max(this.hitStopLeft, seconds);
  }

  /** Runs the simulation at `scale` for `seconds` of real (non-frozen) time, then back to 1. */
  setTimeScale(scale: number, seconds: number): void {
    this.timeScale = scale;
    this.timeScaleLeft = seconds;
  }

  /** Clears hit-stop, time scale and the accumulator (used by Game.reset). */
  resetTiming(): void {
    this.acc = 0;
    this.hitStopLeft = 0;
    this.timeScale = 1;
    this.timeScaleLeft = 0;
  }

  get isHitStopped(): boolean {
    return this.hitStopLeft > 0;
  }

  get currentTimeScale(): number {
    return this.timeScale;
  }

  private readonly onFrame = (now: number): void => {
    this.tick(now);
    this.schedule(this.onFrame);
  };

  /** One frame. Returns the number of simulation steps run (exposed for tests). */
  tick(now: number): number {
    const frameDt = this.last === null ? 0 : Math.min(Math.max((now - this.last) / 1000, 0), MAX_FRAME_DT);
    this.last = now;

    this.target.realUpdate(frameDt);

    let steps = 0;
    if (!this.paused) {
      if (this.hitStopLeft > 0) {
        this.hitStopLeft -= frameDt;
      } else {
        this.acc += frameDt * this.timeScale;
        while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
          this.target.update(STEP);
          this.acc -= STEP;
          steps++;
        }
        if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;

        if (this.timeScaleLeft > 0) {
          this.timeScaleLeft -= frameDt;
          if (this.timeScaleLeft <= 0) {
            this.timeScaleLeft = 0;
            this.timeScale = 1;
          }
        }
      }
    }

    this.target.render();
    return steps;
  }
}
