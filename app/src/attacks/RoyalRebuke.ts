/**
 * Royal Rebuke (GD §6.5 D): the close-range defense. Tell 0.35 s (body squash, the crown flashes
 * white twice, `rebuke_windup`) → burst 0.10 s (a ring expands to 4.5 m; the player is hit within
 * 4.5 + 0.4 m of the boss center) → recovery 0.30 s → free. Triggered (poise, close, window end),
 * never picked at random. The tell is scaled by ?easy only.
 */
import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { horizontalDistance } from '../systems/collision';
import type { Attack, AttackContext, SoundHandle } from './Attack';

const RB = CONFIG.rebuke;
const EPS = 1e-9;

type Phase = 'tell' | 'burst' | 'recovery' | 'done';

export class RoyalRebuke implements Attack {
  readonly id = 'rebuke' as const;
  private phase: Phase = 'done';
  private t = 0;
  private tell = RB.tell;
  private windup: SoundHandle | null = null;
  private readonly source = new Vector3();
  private ctx: AttackContext | null = null;

  get phaseName(): string {
    return this.phase;
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    this.tell = ctx.rebukeTell;
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
        // Two white crown flashes over the tell.
        b.crownGlow = Math.max(0, Math.sin(Math.PI * RB.crownFlashes * u));
        if (this.t >= this.tell - EPS) {
          b.attackSquash.x = b.attackSquash.y = b.attackSquash.z = 1;
          b.crownGlow = 0;
          this.windup = null;
          ctx.hazards.spawnRebuke(b.pos.x, b.pos.z);
          ctx.audio.play('rebuke_burst');
          ctx.shake(RB.shake.amplitude, RB.shake.duration);
          this.next('burst');
        }
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

  /** During the burst: hit if the horizontal distance to the boss center is ≤ 4.5 + 0.4 m. */
  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'burst') return null;
    if (horizontalDistance(spheres[0].center, ctx.boss.pos) <= RB.endRadius + CONFIG.player.radius + EPS) {
      return this.source.set(ctx.boss.pos.x, CONFIG.boss.halfSize, ctx.boss.pos.z);
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
    this.windup?.stop();
    this.windup = null;
    this.ctx?.boss.clearAttackPose();
    this.phase = 'done';
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }
}
