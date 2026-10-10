/**
 * Crown Rain (GD §6.5 C): a cast (squash + crown glow; wave 0's "cage" circles appear) → launch
 * (waves 1 "wall" and 2 "scatter" appear; every shard fires). The boss is free at the launch; the
 * shards are hazards that land at T, T + 0.4 and T + 0.8 s (T = 0.8 / speed multiplier, D4).
 * Rage upgrade Staggered Rain: wave 0's center shard flies 0.3 s longer and pulses at 1 Hz.
 */
import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import type { Rng } from '../util/rng';
import { upgradeOn, type Attack, type AttackContext } from './Attack';

const RN = CONFIG.rain;
const U = CONFIG.rageUpgrades;
const EPS = 1e-9;
/** Circle centers stay within this radius so every circle is inside the arena. */
export const RAIN_MAX_R = CONFIG.arena.radius - RN.circleRadius;

function clampInside(v: Vector3): Vector3 {
  const r = Math.hypot(v.x, v.z);
  if (r > RAIN_MAX_R) {
    v.x *= RAIN_MAX_R / r;
    v.z *= RAIN_MAX_R / r;
  }
  v.y = 0;
  return v;
}

/** Unit horizontal direction boss → player (falls back to the boss facing). */
function bossToPlayer(px: number, pz: number, bx: number, bz: number, yaw: number, out: Vector3): Vector3 {
  const dx = px - bx;
  const dz = pz - bz;
  const d = Math.hypot(dx, dz);
  return d > 1e-6 ? out.set(dx / d, 0, dz / d) : out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

/** Wave 0 "cage" (pure): center `P + V·0.5`, plus 6 circles at 3.5 m, the first on boss→player. */
export function placeCage(px: number, pz: number, vx: number, vz: number, bx: number, bz: number, yaw: number, out: Vector3[]): number {
  const dir = bossToPlayer(px, pz, bx, bz, yaw, new Vector3());
  const cx = px + vx * RN.leadTime;
  const cz = pz + vz * RN.leadTime;
  out[0].set(cx, 0, cz);
  const a0 = Math.atan2(dir.z, dir.x);
  for (let i = 0; i < RN.cage.ring; i++) {
    const a = a0 + (i / RN.cage.ring) * Math.PI * 2;
    out[i + 1].set(cx + Math.cos(a) * RN.cage.radius, 0, cz + Math.sin(a) * RN.cage.radius);
  }
  const n = RN.cage.ring + 1;
  for (let i = 0; i < n; i++) clampInside(out[i]);
  return n;
}

/** Wave 1 "wall" (pure): 5 circles 3.0 m apart through `P + V·0.5`, perpendicular to boss→player. */
export function placeWall(px: number, pz: number, vx: number, vz: number, bx: number, bz: number, yaw: number, out: Vector3[]): number {
  const dir = bossToPlayer(px, pz, bx, bz, yaw, new Vector3());
  const cx = px + vx * RN.leadTime;
  const cz = pz + vz * RN.leadTime;
  const n = RN.wall.count;
  for (let i = 0; i < n; i++) {
    const k = (i - (n - 1) / 2) * RN.wall.spacing;
    out[i].set(cx + dir.z * k, 0, cz - dir.x * k);
    clampInside(out[i]);
  }
  return n;
}

/**
 * Wave 2 "scatter" (pure): up to 12 random circles in the arena, each at least 5.0 m from the
 * others (rejection sampling; a circle that can't be placed in 30 tries is skipped).
 */
export function placeScatter(rng: Rng, out: Vector3[]): number {
  let n = 0;
  const min2 = RN.scatter.minSpacing * RN.scatter.minSpacing;
  for (let c = 0; c < RN.scatter.count; c++) {
    for (let t = 0; t < RN.scatter.tries; t++) {
      const r = RAIN_MAX_R * Math.sqrt(rng());
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      let ok = true;
      for (let j = 0; j < n && ok; j++) {
        const dx = out[j].x - x;
        const dz = out[j].z - z;
        if (dx * dx + dz * dz < min2) ok = false;
      }
      if (ok) {
        out[n++].set(x, 0, z);
        break;
      }
    }
  }
  return n;
}

type Phase = 'cast' | 'done';

export class CrownRain implements Attack {
  readonly id = 'rain' as const;
  private phase: Phase = 'done';
  private t = 0;
  private cast = 0;
  private staggered = false;
  private flight = 0;
  private readonly buf: Vector3[] = Array.from({ length: RN.maxPerWave }, () => new Vector3());
  private readonly launch = new Vector3();
  private ctx: AttackContext | null = null;

  get phaseName(): string {
    return this.phase;
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    this.phase = 'cast';
    this.t = 0;
    this.cast = RN.cast * ctx.telegraphMult;
    this.staggered = upgradeOn(ctx, 'staggeredShards');
    this.flight = RN.flightTime / ctx.speedMult; // D4
    const b = ctx.boss;
    const n = placeCage(ctx.playerPos.x, ctx.playerPos.z, ctx.playerVel.x, ctx.playerVel.z, b.pos.x, b.pos.z, b.yaw, this.buf);
    ctx.hazards.placeWave(0, this.buf, n, this.staggered ? U.staggerSidePulseHz : RN.circlePulseHz, this.staggered ? U.staggerCenterPulseHz : undefined);
  }

  update(dt: number, ctx: AttackContext): void {
    if (this.phase !== 'cast') return;
    this.t += dt;
    const u = Math.min(1, this.t / this.cast);
    const b = ctx.boss;
    const sq = RN.castSquash;
    b.attackSquash.x = 1 + (sq.x - 1) * u;
    b.attackSquash.y = 1 + (sq.y - 1) * u;
    b.attackSquash.z = 1 + (sq.z - 1) * u;
    b.crownGlow = u;
    if (this.t < this.cast - EPS) return;

    // Launch: waves 1 and 2 are placed now; every shard fires from the crown.
    const h = ctx.hazards;
    const p = ctx.playerPos;
    const v = ctx.playerVel;
    const n1 = placeWall(p.x, p.z, v.x, v.z, b.pos.x, b.pos.z, b.yaw, this.buf);
    h.placeWave(1, this.buf, n1);
    const n2 = placeScatter(ctx.rng, this.buf);
    h.placeWave(2, this.buf, n2);
    this.launch.set(b.pos.x, b.pos.y + RN.launchHeight, b.pos.z);
    const T = this.flight;
    const extra = this.staggered ? U.staggerExtraFlight : 0;
    h.launchWave(0, this.launch, (i) => T + (i === 0 ? extra : 0));
    h.launchWave(1, this.launch, () => T + RN.waveGap);
    h.launchWave(2, this.launch, () => T + 2 * RN.waveGap);
    ctx.audio.play('shard_launch');
    b.clearAttackPose();
    this.phase = 'done';
  }

  checkPlayerHit(_spheres: readonly Sphere[]): Vector3 | null {
    return null; // the shards are hazards
  }

  isBossFree(): boolean {
    return this.phase === 'done';
  }

  inPunishWindow(): boolean {
    return false;
  }

  wantsRebuke(): boolean {
    return false;
  }

  dispose(): void {
    this.ctx?.boss.clearAttackPose();
    this.phase = 'done';
  }
}
