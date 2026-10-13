/**
 * Bounce Shove (GD §6.5 I, 1.6): a close-range defence that never deals damage. Tell 0.4 s (the
 * body wobbles and swells) → burst 0.12 s (`shove`; a player within 5.5 + 0.4 m of the boss center
 * is pushed 5 m away and stumbles for 0.45 s, unless invincible — a roll at the burst avoids it)
 * → recovery 0.4 s → free. The tell is scaled by ?easy only.
 */
import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { horizontalDistance } from '../systems/collision';
import type { Attack, AttackContext, PillarHit } from './Attack';

const SH = CONFIG.shove;
const EPS = 1e-9;

type Phase = 'tell' | 'burst' | 'recovery' | 'done';

export class BounceShove implements Attack {
  readonly id = 'shove' as const;
  private phase: Phase = 'done';
  private t = 0;
  private tell: number = SH.tell;
  private shoved = false;
  private readonly source = new Vector3();
  private ctx: AttackContext | null = null;

  get phaseName(): string {
    return this.phase;
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    this.tell = SH.tell * (ctx.easyMult ?? 1);
    this.shoved = false;
    this.next('tell');
  }

  update(dt: number, ctx: AttackContext): void {
    const b = ctx.boss;
    this.t += dt;
    switch (this.phase) {
      case 'tell': {
        const u = Math.min(1, this.t / this.tell);
        // Growing wobble: the body swells and jiggles faster toward the burst.
        const w = Math.sin(2 * Math.PI * SH.wobbleHz * this.t) * SH.tellScale * u;
        b.attackSquash.x = 1 + SH.tellScale * u + w;
        b.attackSquash.z = 1 + SH.tellScale * u + w;
        b.attackSquash.y = 1 - SH.tellScale * 0.5 * u - w;
        b.crownGlow = 0.5 * u;
        if (this.t >= this.tell - EPS) {
          b.crownGlow = 0;
          b.splat(-4); // the body bulges outward (wide and low), then wobbles back
          ctx.vfx?.slamImpact(b.pos.x, b.pos.z);
          ctx.audio.play('shove');
          ctx.shake(SH.shake.amplitude, SH.shake.duration);
          this.next('burst');
        }
        break;
      }
      case 'burst':
      case 'recovery': {
        // The bulge (wide, low) relaxes back to rest over the burst and recovery.
        const total = SH.burst + SH.recovery;
        const k = 1 - Math.min(1, ((this.phase === 'burst' ? 0 : SH.burst) + this.t) / total);
        const e = k * k;
        b.attackSquash.x = b.attackSquash.z = 1 + SH.burstSwell * e;
        b.attackSquash.y = 1 - SH.burstSwell * 0.6 * e;
        if (this.phase === 'burst') {
          if (this.t >= SH.burst - EPS) this.next('recovery');
          break;
        }
        if (this.t >= SH.recovery - EPS) {
          b.clearAttackPose();
          this.phase = 'done';
        }
        break;
      }
      default:
        break;
    }
  }

  /** Never damages. */
  checkPlayerHit(): Vector3 | null {
    return null;
  }

  /** During the burst, once: the push source if the player is within reach (Game applies the shove). */
  checkPlayerShove(spheres: readonly Sphere[]): Vector3 | null {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'burst' || this.shoved) return null;
    if (horizontalDistance(spheres[0].center, ctx.boss.pos) <= SH.reach + CONFIG.player.radius + EPS) {
      this.shoved = true;
      return this.source.set(ctx.boss.pos.x, 0, ctx.boss.pos.z);
    }
    return null;
  }

  /** 1.6: the burst reaching a pillar collapses it; a player right behind it is not pushed. */
  pillarHit(x: number, z: number, r: number, out: PillarHit): PillarHit | null {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'burst') return null;
    const b = ctx.boss.pos;
    if (Math.hypot(x - b.x, z - b.z) > SH.reach + r + EPS) return null;
    out.shield = true;
    out.ox = b.x;
    out.oz = b.z;
    out.life = CONFIG.pillars.shadowLife.shove;
    return out;
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

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }
}
