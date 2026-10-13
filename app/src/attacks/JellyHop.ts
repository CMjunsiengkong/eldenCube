/**
 * Jelly Hop-Back (GD §6.5 H, 1.6): a close-range defence. Tell 0.5 s (the body squats low,
 * `hop_jump` at take-off) → air 0.6 s (÷ rage speed; a parabolic jump about 9 m away from the
 * player, landing inside the arena) → land (crushes whoever is under it; a small splash ring
 * hazard expands to 10 m; `hop_land`) → recovery 0.5 s → free. The tell is scaled by ?easy only.
 */
import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { horizontalDistance } from '../systems/collision';
import type { Attack, AttackContext } from './Attack';

const HP = CONFIG.hop;
const EPS = 1e-9;

type Phase = 'tell' | 'air' | 'recovery' | 'done';

/**
 * Pure (tested): where the boss lands, `distance` away from the player through the boss, inside
 * a circle of `limit` around the arena center. When the wall is in the way, the direction turns
 * (±45°, ±90°) toward the open side; the landing is always inside the limit.
 */
export function hopTarget(bx: number, bz: number, px: number, pz: number, out: { x: number; z: number }, distance: number = HP.distance, limit: number = CONFIG.arena.radius - HP.edgeMargin): { x: number; z: number } {
  let dx = bx - px;
  let dz = bz - pz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    dx = bx === 0 && bz === 0 ? 0 : -bx;
    dz = bx === 0 && bz === 0 ? 1 : -bz;
  }
  const base = Math.atan2(dx, dz);
  let best = -1;
  let bestX = bx;
  let bestZ = bz;
  for (const off of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const a = base + off;
    let x = bx + Math.sin(a) * distance;
    let z = bz + Math.cos(a) * distance;
    const r = Math.hypot(x, z);
    if (r > limit) {
      x *= limit / r;
      z *= limit / r;
    }
    const travel = Math.hypot(x - bx, z - bz);
    if (travel >= distance * 0.7 - EPS) {
      out.x = x;
      out.z = z;
      return out;
    }
    if (travel > best) {
      best = travel;
      bestX = x;
      bestZ = z;
    }
  }
  out.x = bestX;
  out.z = bestZ;
  return out;
}

export class JellyHop implements Attack {
  readonly id = 'hop' as const;
  private phase: Phase = 'done';
  private t = 0;
  private tell: number = HP.tell;
  private airTime: number = HP.airTime;
  private readonly from = new Vector3();
  private readonly to = { x: 0, z: 0 };
  private landNow = false;
  private readonly source = new Vector3();
  private ctx: AttackContext | null = null;

  get phaseName(): string {
    return this.phase;
  }

  /** Landing point (tests, debug). */
  get target(): { readonly x: number; readonly z: number } {
    return this.to;
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    this.tell = HP.tell * (ctx.easyMult ?? 1);
    this.airTime = HP.airTime / ctx.speedMult;
    this.landNow = false;
    this.next('tell');
  }

  update(dt: number, ctx: AttackContext): void {
    const b = ctx.boss;
    this.t += dt;
    this.landNow = false;
    switch (this.phase) {
      case 'tell': {
        const u = Math.min(1, this.t / this.tell);
        const e = u * u * (3 - 2 * u);
        const sq = HP.tellSquash;
        b.attackSquash.x = 1 + (sq.x - 1) * e;
        b.attackSquash.y = 1 + (sq.y - 1) * e;
        b.attackSquash.z = 1 + (sq.z - 1) * e;
        if (this.t >= this.tell - EPS) {
          // Take-off: the landing point is fixed now.
          this.from.copy(b.pos);
          hopTarget(b.pos.x, b.pos.z, ctx.playerPos.x, ctx.playerPos.z, this.to);
          b.attackSquash.x = b.attackSquash.z = 0.9;
          b.attackSquash.y = 1.25; // stretched in the air
          b.dashing = true; // no turning, no knockback, not solid while airborne
          b.splat(6);
          ctx.audio.play('hop_jump');
          ctx.vfx?.chargeDust(b.pos.x, b.pos.z, this.from.x - this.to.x, this.from.z - this.to.z);
          this.next('air');
        }
        break;
      }
      case 'air': {
        const u = Math.min(1, this.t / this.airTime);
        b.pos.x = this.from.x + (this.to.x - this.from.x) * u;
        b.pos.z = this.from.z + (this.to.z - this.from.z) * u;
        b.pos.y = 4 * HP.height * u * (1 - u);
        if (u >= 1 - EPS) this.land(ctx);
        break;
      }
      case 'recovery':
        if (this.t >= HP.recovery - EPS) {
          b.clearAttackPose();
          this.phase = 'done';
        }
        break;
      default:
        break;
    }
  }

  /** At the landing step only: crushed if within the body (half size + 0.4 m) of the boss center. */
  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null {
    const ctx = this.ctx;
    if (!ctx || !this.landNow) return null;
    if (horizontalDistance(spheres[0].center, ctx.boss.pos) <= CONFIG.boss.halfSize + HP.landKill + CONFIG.player.radius + EPS) {
      return this.source.set(ctx.boss.pos.x, 0, ctx.boss.pos.z);
    }
    return null;
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
    const b = this.ctx?.boss;
    if (b && this.phase === 'air') {
      // Cancelled mid-air (rage, defeat, death): drop to the ground where it is.
      b.pos.y = 0;
    }
    b?.clearAttackPose();
    this.phase = 'done';
  }

  private land(ctx: AttackContext): void {
    const b = ctx.boss;
    b.pos.set(this.to.x, 0, this.to.z);
    b.dashing = false;
    b.attackSquash.x = b.attackSquash.y = b.attackSquash.z = 1;
    b.splat(HP.landSplat);
    this.landNow = true;
    ctx.hazards.spawnRing(b.pos.x, b.pos.z, HP.ringSpeed * ctx.speedMult, HP.ringEndRadius);
    ctx.vfx?.slamImpact(b.pos.x, b.pos.z);
    ctx.audio.play('hop_land');
    ctx.shake(HP.landShake.amplitude, HP.landShake.duration);
    this.next('recovery');
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }
}
