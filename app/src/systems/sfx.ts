/**
 * Procedural sound recipes (ASSETS.md §1.2), the default and the fallback for every sound.
 * One function per sound ID: `(ctx, out, noise, opts) → SoundHandle`. All nodes are created per
 * play (Web Audio nodes are one-shot) and stopped by their own schedule or by `handle.stop()`.
 */
import type { SoundHandle, SoundId } from '../attacks/Attack';

export interface RecipeOptions {
  /** Telegraph-length sounds (s). */
  duration?: number;
  /** Frequency multiplier (pitch variation). */
  pitch?: number;
  /** × the recipe's own loudness. */
  volume?: number;
}

export type Recipe = (ctx: AudioContext, out: AudioNode, noise: AudioBuffer, opts: RecipeOptions) => SoundHandle;

const FLOOR = 0.0001;
/** Click-free stop ramp for stoppable sounds (s). */
const STOP_RAMP = 0.02;

/** Collects sources so a handle can stop them all, plus a final gain for click-free stops. */
class Voice implements SoundHandle {
  readonly gain: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly ctx: AudioContext;
  private stopped = false;

  constructor(ctx: AudioContext, out: AudioNode, volume: number) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(out);
  }

  add<T extends AudioScheduledSourceNode>(src: T, start: number, stop: number): T {
    src.start(start);
    src.stop(stop);
    this.sources.push(src);
    return src;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, FLOOR), t);
    g.exponentialRampToValueAtTime(FLOOR, t + STOP_RAMP);
    for (const s of this.sources) {
      try {
        s.stop(t + STOP_RAMP + 0.01);
      } catch {
        // already stopped
      }
    }
  }
}

/** Gain envelope: 0 → peak over `attack`, then exponential decay to ~0 at start + attack + decay. */
function env(ctx: AudioContext, dest: AudioNode, peak: number, start: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, start);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, FLOOR), start + attack);
  g.gain.exponentialRampToValueAtTime(FLOOR, start + attack + decay);
  g.connect(dest);
  return g;
}

/** Oscillator with an exponential frequency ramp through `freqs` over `dur` (evenly spaced). */
function osc(v: Voice, ctx: AudioContext, type: OscillatorType, freqs: readonly number[], start: number, dur: number, dest: AudioNode): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freqs[0], start);
  for (let i = 1; i < freqs.length; i++) o.frequency.exponentialRampToValueAtTime(freqs[i], start + (dur * i) / (freqs.length - 1));
  o.connect(dest);
  return v.add(o, start, start + dur + 0.05);
}

function noise(v: Voice, ctx: AudioContext, buf: AudioBuffer, start: number, dur: number, dest: AudioNode): AudioBufferSourceNode {
  const n = ctx.createBufferSource();
  n.buffer = buf;
  n.loop = true;
  n.connect(dest);
  return v.add(n, start, start + dur + 0.05);
}

function filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

/** Frequency vibrato: an LFO at `hz` with ±`depth` Hz on `target`. */
function vibrato(v: Voice, ctx: AudioContext, target: AudioParam, hz: number, depth: number, start: number, dur: number): void {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = hz;
  const g = ctx.createGain();
  g.gain.value = depth;
  lfo.connect(g);
  g.connect(target);
  v.add(lfo, start, start + dur + 0.05);
}

/** `shard_land`-style clink (also used by `boss_break`). */
function clink(v: Voice, ctx: AudioContext, out: AudioNode, start: number, vol: number, p: number): void {
  const e = env(ctx, out, vol, start, 0.005, 0.08);
  osc(v, ctx, 'triangle', [1800 * p, 1200 * p], start, 0.08, e);
  const e2 = env(ctx, out, vol / 2, start, 0.005, 0.08);
  osc(v, ctx, 'triangle', [2600 * p, 2600 * p], start, 0.08, e2);
}

const RECIPES: Record<SoundId, Recipe> = {
  swing(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const r = (o.pitch ?? 1) * (0.9 + Math.random() * 0.2);
    const e = env(ctx, v.gain, 0.5, t, 0.02, 0.18);
    const f = filter(ctx, 'bandpass', 600 * r, 1.2, e);
    f.frequency.setValueAtTime(600 * r, t);
    f.frequency.exponentialRampToValueAtTime(2400 * r, t + 0.18);
    noise(v, ctx, nb, t, 0.2, f);
    return v;
  },
  hit(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const p = o.pitch ?? 1;
    osc(v, ctx, 'sine', [140 * p, 60 * p], t, 0.15, env(ctx, v.gain, 0.9, t, 0.005, 0.15));
    noise(v, ctx, nb, t, 0.08, filter(ctx, 'lowpass', 1200, 0.7, env(ctx, v.gain, 0.5, t, 0.003, 0.08)));
    return v;
  },
  swing_ground(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    osc(v, ctx, 'sine', [90, 50], t, 0.12, env(ctx, v.gain, 0.4, t, 0.005, 0.12));
    return v;
  },
  roll(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const f = filter(ctx, 'bandpass', 300, 0.8, env(ctx, v.gain, 0.4, t, 0.03, 0.42));
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.2);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.45);
    noise(v, ctx, nb, t, 0.45, f);
    osc(v, ctx, 'sine', [110, 70], t + 0.25, 0.08, env(ctx, v.gain, 0.25, t + 0.25, 0.005, 0.08));
    return v;
  },
  roll_end(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    osc(v, ctx, 'sine', [120, 60], t, 0.08, env(ctx, v.gain, 0.35, t, 0.005, 0.08));
    const w = osc(v, ctx, 'sine', [500, 700, 450], t + 0.08, 0.15, env(ctx, v.gain, 0.15, t + 0.08, 0.01, 0.14));
    vibrato(v, ctx, w.frequency, 6, 30, t + 0.08, 0.15);
    return v;
  },
  footstep(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    noise(v, ctx, nb, t, 0.04, filter(ctx, 'lowpass', 400, 0.7, env(ctx, v.gain, 0.12, t, 0.003, 0.04)));
    return v;
  },
  slam_rise(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const d = o.duration ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.05);
    g.gain.setValueAtTime(0.25, t + Math.max(0.05, d - 0.05));
    g.gain.exponentialRampToValueAtTime(FLOOR, t + d);
    g.connect(v.gain);
    osc(v, ctx, 'sawtooth', [80, 240], t, d, filter(ctx, 'lowpass', 800, 0.7, g));
    return v;
  },
  slam_impact(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    osc(v, ctx, 'sine', [70, 30], t, 0.6, env(ctx, v.gain, 1.0, t, 0.005, 0.6));
    noise(v, ctx, nb, t, 0.8, filter(ctx, 'lowpass', 300, 0.7, env(ctx, v.gain, 0.7, t, 0.005, 0.8)));
    return v;
  },
  charge_windup(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const d = o.duration ?? 1;
    // Rattle: the gain swings 0 … 0.3 with an 18 Hz square LFO.
    const g = ctx.createGain();
    g.gain.value = 0.15;
    g.connect(v.gain);
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 18;
    const lg = ctx.createGain();
    lg.gain.value = 0.15;
    lfo.connect(lg);
    lg.connect(g.gain);
    v.add(lfo, t, t + d + 0.05);
    const s = ctx.createOscillator();
    s.type = 'sawtooth';
    s.frequency.value = 60;
    s.connect(g);
    v.add(s, t, t + d);
    return v;
  },
  charge_dash(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const f = filter(ctx, 'bandpass', 300, 1, env(ctx, v.gain, 0.5, t, 0.02, 0.48));
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1200, t + 0.5);
    noise(v, ctx, nb, t, 0.5, f);
    return v;
  },
  shard_launch(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.08;
      osc(v, ctx, 'sine', [400, 900], s, 0.06, env(ctx, v.gain, 0.4, s, 0.005, 0.055));
    }
    return v;
  },
  shard_land(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    clink(v, ctx, v.gain, ctx.currentTime, 0.3, o.pitch ?? 1);
    return v;
  },
  rage(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const f = filter(ctx, 'lowpass', 200, 1, env(ctx, v.gain, 0.5, t, 0.05, 0.75));
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.8);
    const half = ctx.createGain();
    half.gain.value = 0.5; // two saws summed stay within the 0.5 peak
    half.connect(f);
    osc(v, ctx, 'sawtooth', [110, 110], t, 0.8, half);
    osc(v, ctx, 'sawtooth', [116, 116], t, 0.8, half);
    return v;
  },
  rebuke_windup(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const d = o.duration ?? 0.35;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    g.connect(v.gain);
    // Tremble: a 30 Hz LFO swings the gain 0.15 … 0.45.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 30;
    const lg = ctx.createGain();
    lg.gain.value = 0.15;
    lfo.connect(lg);
    lg.connect(g.gain);
    v.add(lfo, t, t + d + 0.05);
    const f = filter(ctx, 'bandpass', 300, 4, g);
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1200, t + d);
    osc(v, ctx, 'square', [300, 1200], t, d, f);
    return v;
  },
  rebuke_burst(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    noise(v, ctx, nb, t, 0.2, filter(ctx, 'highpass', 1500, 0.7, env(ctx, v.gain, 0.7, t, 0.003, 0.2)));
    osc(v, ctx, 'sine', [220, 80], t, 0.15, env(ctx, v.gain, 0.5, t, 0.005, 0.15));
    return v;
  },
  player_hurt(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const s = osc(v, ctx, 'sine', [260, 120], t, 0.18, env(ctx, v.gain, 0.7, t, 0.005, 0.18));
    vibrato(v, ctx, s.frequency, 12, 20, t, 0.18);
    noise(v, ctx, nb, t, 0.06, filter(ctx, 'lowpass', 800, 0.7, env(ctx, v.gain, 0.4, t, 0.003, 0.06)));
    return v;
  },
  flask_drink(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const lp = filter(ctx, 'lowpass', 600, 0.7, v.gain);
    for (const s of [t, t + 0.25]) osc(v, ctx, 'sine', [180, 120, 200], s, 0.12, env(ctx, lp, 0.4, s, 0.01, 0.11));
    return v;
  },
  flask_heal(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    [880, 1175, 1760].forEach((f, i) => {
      const s = t + i * 0.08;
      osc(v, ctx, 'triangle', [f, f], s, 0.15, env(ctx, v.gain, 0.4, s, 0.005, 0.15));
    });
    return v;
  },
  player_break(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const s = t + Math.random() * 0.4;
      noise(v, ctx, nb, s, 0.03, filter(ctx, 'highpass', 2000, 0.7, env(ctx, v.gain, 0.4, s, 0.002, 0.03)));
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.setValueAtTime(0.35, t + 0.8);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.9);
    g.connect(v.gain);
    const w = osc(v, ctx, 'sine', [1400, 300], t, 0.9, g);
    vibrato(v, ctx, w.frequency, 6, 20, t, 0.9);
    return v;
  },
  you_died(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    for (const [f, vol] of [
      [98, 0.8],
      [196, 0.4],
      [294, 0.2],
    ] as const) {
      osc(v, ctx, 'sine', [f, f], t, 2.5, env(ctx, v.gain, vol, t, 0.01, 2.5));
    }
    return v;
  },
  boss_break(ctx, out, nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    noise(v, ctx, nb, t, 1.0, filter(ctx, 'lowpass', 2000, 0.7, env(ctx, v.gain, 0.9, t, 0.005, 1.0)));
    osc(v, ctx, 'sine', [60, 30], t, 0.8, env(ctx, v.gain, 0.8, t, 0.005, 0.8));
    for (let i = 0; i < 8; i++) clink(v, ctx, v.gain, t + Math.random() * 1.0, 0.25, 0.9 + Math.random() * 0.2);
    return v;
  },
  victory(ctx, out, _nb, o) {
    const v = new Voice(ctx, out, o.volume ?? 1);
    const t = ctx.currentTime;
    const notes: Array<[number, number]> = [
      [523.25, 0.12],
      [659.25, 0.12],
      [783.99, 0.12],
      [1046.5, 0.6],
    ];
    let s = t;
    for (const [f, d] of notes) {
      osc(v, ctx, 'triangle', [f, f], s, d, env(ctx, v.gain, 0.4, s, 0.01, d));
      s += d;
    }
    return v;
  },
};

export function playRecipe(id: SoundId, ctx: AudioContext, out: AudioNode, noiseBuf: AudioBuffer, opts: RecipeOptions = {}): SoundHandle {
  return RECIPES[id](ctx, out, noiseBuf, opts);
}

/** Every sound ID that has a recipe (all of them, ASSETS.md §1.1). */
export const RECIPE_IDS = Object.keys(RECIPES) as SoundId[];
