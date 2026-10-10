/** Shared attack interface (ARCHITECTURE §4.4, design §8). */
import type { Scene, Vector3 } from 'three';
import type { CONFIG, RageUpgrades } from '../config';
import type { Sphere } from '../entities/Player';
import type { Vec3Like } from '../systems/collision';
import type { Puffs } from '../fx/effects';
import type { Hazards } from './Hazards';
import type { Rng } from '../util/rng';

/** The random attacks (GD §6.5 A–C). The Royal Rebuke (D) is triggered, never picked. */
export type AttackId = 'slam' | 'charge' | 'rain';
export const ATTACK_IDS: readonly AttackId[] = ['slam', 'charge', 'rain'];
export type MoveId = AttackId | 'rebuke';

/** Sound IDs (ASSETS.md §1.1). The real audio arrives in milestone 1.5. */
export type SoundId = keyof typeof CONFIG.audio.volume;

export interface SoundHandle {
  stop(): void;
}

export interface SoundOptions {
  /** For telegraph-length sounds (s). */
  duration?: number;
  /** × the sound's relative loudness. */
  volume?: number;
}

export interface SoundSink {
  play(id: SoundId, opts?: SoundOptions): SoundHandle;
}

const NO_HANDLE: SoundHandle = { stop: () => undefined };
/** Silent sink until audio exists (milestone 1.5) and for tests. */
export const SILENT: SoundSink = { play: () => NO_HANDLE };

/** The yaw-only boss box (GD §5.4). */
export interface BossBox {
  readonly center: Vector3;
  readonly halfSize: number;
  readonly yaw: number;
}

/** What an attack may read and drive on the boss. */
export interface AttackBoss {
  /** Origin (bottom center). Slam drives `y`; Charge drives `x`/`z`. */
  readonly pos: Vector3;
  yaw: number;
  /** True during a Charge dash: no turning, no knockback. */
  dashing: boolean;
  /** Red emissive pulse weight 0…1 (Charge telegraph). */
  pulse: number;
  /** Extra visual shake amplitude in m (Charge telegraph). */
  shake: number;
  /** No turning (Slam punish window, Charge recovery). */
  stuck: boolean;
  /** Attack pose: body squash factors (1 = none). */
  readonly attackSquash: { x: number; y: number; z: number };
  /** White crown glow 0…1. */
  crownGlow: number;
  /** Crown tilt (rad) around the forward axis. */
  crownTilt: number;
  /** Resets everything above (and y = 0). */
  clearAttackPose(): void;
  getBox(): BossBox;
}

/**
 * Everything an attack can use. `Game` owns one instance and refreshes its fields every step,
 * so nothing is allocated per frame.
 */
export interface AttackContext {
  boss: AttackBoss;
  /** Player feet position (y = 0). */
  playerPos: Vec3Like;
  /** Player horizontal velocity (y ignored). */
  playerVel: Vec3Like;
  scene: Scene;
  audio: SoundSink;
  shake(amplitude: number, duration: number): void;
  /** All boss movement speeds: rage × easy. */
  speedMult: number;
  /** All attack telegraph times: rage × easy. */
  telegraphMult: number;
  /** The Rebuke tell (s): × easy only. */
  rebukeTell: number;
  /** Rage phase. Upgrades are honoured only when true (GD §6.5a). */
  rage: boolean;
  upgrades: RageUpgrades;
  rng: Rng;
  effects: Puffs;
  /** Rings, shards, circles and the Rebuke ring: they outlive the attack that spawned them. */
  hazards: Hazards;
}

export interface Attack {
  readonly id: MoveId;
  /** The current internal phase name (debug text). */
  readonly phaseName: string;
  /** Begins the telegraph. */
  start(ctx: AttackContext): void;
  update(dt: number, ctx: AttackContext): void;
  /**
   * The hit source if the boss body / burst hits the player in the current step, else null.
   * Hazards are checked separately. Game calls it only when the player is not invincible.
   */
  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null;
  /** The boss's own animation (incl. its recovery / punish window) has ended: the cooldown starts. */
  isBossFree(): boolean;
  /** Damage now does not count toward poise (Slam window, Charge recovery). */
  inPunishWindow(): boolean;
  /** The attack ended with a Rebuke request (Slam window end with the player close). */
  wantsRebuke(): boolean;
  /** Stops long sounds, removes attack-owned meshes, resets the boss pose. */
  dispose(): void;
}

/** True if this rage upgrade is active for the attack being run (rage AND switched on). */
export const upgradeOn = (ctx: AttackContext, key: 'doubleSlam' | 'chargeUTurn' | 'staggeredShards'): boolean =>
  ctx.rage && ctx.upgrades[key];
