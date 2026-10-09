/**
 * URL flags (GAME_DESIGN §11) and the effective multipliers derived from them.
 * `?easy` and `?debug` are parsed once and may be combined. CONFIG is never mutated:
 * multipliers are applied when values are read.
 */
import { CONFIG } from './config';

export interface Flags {
  readonly easy: boolean;
  readonly debug: boolean;
}

export type BossPhase = 'p1' | 'rage';

/** Pure parser (presence check): '?easy', '?debug', '?easy&debug', '?debug=1', … */
export function parseFlags(search: string): Flags {
  const params = new URLSearchParams(search);
  return { easy: params.has('easy'), debug: params.has('debug') };
}

let cached: Flags | null = null;

/** The page's flags, parsed lazily once (Node/tests: no flags). */
export function getFlags(): Flags {
  if (cached === null) {
    cached = parseFlags(typeof location === 'undefined' ? '' : location.search);
  }
  return cached;
}

/** Multiplier for all boss movement speeds (chase, dash, shockwave, shard flight). */
export function speedMult(phase: BossPhase, flags: Flags = getFlags()): number {
  return (phase === 'rage' ? CONFIG.rage.speedMult : 1) * (flags.easy ? CONFIG.easy.speedMult : 1);
}

/** Multiplier for every telegraph time. */
export function telegraphMult(phase: BossPhase, flags: Flags = getFlags()): number {
  return (phase === 'rage' ? CONFIG.rage.telegraphMult : 1) * (flags.easy ? CONFIG.easy.telegraphMult : 1);
}

/** The attack cooldown for a phase, with ?easy applied (decision D3: the punish works on this value). */
export function cooldownFor(phase: BossPhase, flags: Flags = getFlags()): number {
  return (phase === 'rage' ? CONFIG.rage.cooldown : CONFIG.boss.cooldown) * (flags.easy ? CONFIG.easy.cooldownMult : 1);
}

/** Shard flight time = base / speed multiplier (decision D4). */
export function shardFlightTime(phase: BossPhase, flags: Flags = getFlags()): number {
  return CONFIG.shards.flightTime / speedMult(phase, flags);
}
