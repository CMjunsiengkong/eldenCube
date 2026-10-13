/**
 * Royal Rebuke (GD §6.5 D): the close-range defense. Tell 0.35 s (body squash, the crown flashes
 * white twice, `rebuke_windup`) → burst 0.10 s (a ring expands to 4.5 m; the player is hit within
 * 4.5 + 0.4 m of the boss center) → recovery 0.30 s → free. Triggered (poise, close, window end),
 * never picked at random. The tell is scaled by ?easy only.
 *
 * Feint (GD §6.5 D2, 1.6): in rage, 30% of Rebukes hold the finished tell for another 0.3 s (the
 * body quivers; the windup sound still ends on time) before the burst, to catch reflex rolls.
 */
import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { horizontalDistance } from '../systems/collision';
import { rebukeReach } from './Hazards';
import type { Attack, AttackContext, PillarHit, SoundHandle } from './Attack';

const RB = CONFIG.rebuke;
const FE = RB.feint;
const EPS = 1e-9;

type Phase = 'tell' | 'hold' | 'burst' | 'recovery' | 'done';

export class RoyalRebuke implements Attack {
  readonly id = 'rebuke' as const;
  private phase: Phase = 'done';
  private t = 0;
  private tell = RB.tell;
  private windup: SoundHandle | null = null;
  private readonly source = new Vector3();
  private ctx: AttackContext | null = null;
  /** This Rebuke is a feint (decided at start). */
  feint = false;
  /** Debug: the next Rebuke is a feint regardless of phase and chance. */
  forceFeint = false;

  get phaseName(): string {
    return this.phase;
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    this.tell = ctx.rebukeTell;
    this.feint = this.forceFeint || (ctx.rage && ctx.rng() < FE.rageChance);
    this.forceFeint = false;
    this.next('tell');
    this.windup = ctx.audio.play('rebuke_windup', { duration: this.tell });
  }

  update(dt: number, ctx: AttackContext): void {
    const b = ctx.boss;
    this.t += dt;
    switch (this.phase) {
      case 'tell': {
        const u = Math.min(1, this.t / this.tell);
        const sq = RB.tellSquash;
        b.attackSquash.x = 1 + (sq.x - 1) * u;
        b.attackSquash.y = 1 + (sq.y - 1) * u;
        b.attackSquash.z = 1 + (sq.z - 1) * u;
        // Two white crown flashes over the tell; spike tips poke out (1.5b).
        b.crownGlow = Math.max(0, Math.sin(Math.PI * RB.crownFlashes * u));
        ctx.hazards.rebukeTell(b.pos.x, b.pos.z, u);
        if (this.t >= this.tell - EPS) {
          this.windup = null;
          if (this.feint) this.next('hold');
          else this.burst(ctx);
        }
        break;
      }
      case 'hold': {
        // Feint: fully wound up, the body quivers; the spikes stay poked out.
        const q = FE.quiver * Math.sin(this.t * 90);
        const sq = RB.tellSquash;
        b.attackSquash.x = sq.x + q;
        b.attackSquash.z = sq.z - q;
        b.attackSquash.y = sq.y;
        b.crownGlow = 0.6 + 0.4 * Math.sin(this.t * 40);
        ctx.hazards.rebukeTell(b.pos.x, b.pos.z, 1);
        if (this.t >= FE.delay - EPS) this.burst(ctx);
        break;
      }
      case 'burst':
        if (this.t >= RB.burst - EPS) this.next('recovery');
        break;
      case 'recovery':
        if (this.t >= RB.recovery - EPS) {
          b.clearAttackPose();
          this.phase = 'done';
        }
        break;
      default:
        break;
    }
  }

  /**
   * During the burst: hit if the horizontal distance to the boss center is within the spikes'
   * current reach + 0.4 m (the reach grows 2.0 → 4.5 m, ease-out, as drawn), so the damage never
   * arrives before the spikes do (2026-10-12).
   */
  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'burst') return null;
    const reach = rebukeReach(this.t);
    if (horizontalDistance(spheres[0].center, ctx.boss.pos) <= reach + CONFIG.player.radius + EPS) {
      return this.source.set(ctx.boss.pos.x, CONFIG.boss.halfSize, ctx.boss.pos.z);
    }
    return null;
  }

  /** 1.6: the spikes reaching a pillar collapse it; a player right behind it is shielded. */
  pillarHit(x: number, z: number, r: number, out: PillarHit): PillarHit | null {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'burst') return null;
    const b = ctx.boss.pos;
    if (Math.hypot(x - b.x, z - b.z) > rebukeReach(this.t) + r + EPS) return null;
    out.shield = true;
    out.ox = b.x;
    out.oz = b.z;
    out.life = CONFIG.pillars.shadowLife.rebuke;
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
    this.windup?.stop();
    this.windup = null;
    this.ctx?.boss.clearAttackPose();
    this.phase = 'done';
  }

  private burst(ctx: AttackContext): void {
    const b = ctx.boss;
    b.attackSquash.x = b.attackSquash.y = b.attackSquash.z = 1;
    b.crownGlow = 0;
    ctx.hazards.spawnRebuke(b.pos.x, b.pos.z);
    ctx.audio.play('rebuke_burst');
    ctx.shake(RB.shake.amplitude, RB.shake.duration);
    this.next('burst');
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }
}
