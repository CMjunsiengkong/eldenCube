/**
 * Royal Charge (GD §6.5 B): telegraph (shake + red pulse) → lock → dash → skid → 0.6 s recovery
 * (a small punish window: no turning, damage does not count toward poise) → free.
 * Rage upgrade Charge U-turn: a 0.4 s re-telegraph, re-lock and one more dash + skid.
 */
import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { createSphereOBBResult, sphereOBB } from '../systems/collision';
import { upgradeOn, type Attack, type AttackContext, type SoundHandle } from './Attack';

const C = CONFIG.charge;
const U = CONFIG.rageUpgrades;
const EPS = 1e-9;

type Phase = 'telegraph' | 'dash' | 'skid' | 'uturn' | 'recovery' | 'done';

export class RoyalCharge implements Attack {
  readonly id = 'charge' as const;
  private phase: Phase = 'done';
  private t = 0;
  private telegraph = 0;
  private speed = 0;
  private uTurn = false;
  /** Number of dashes started (1, or 2 with the U-turn). */
  private dashes = 0;
  private readonly dir = new Vector3(0, 0, 1);
  private readonly source = new Vector3();
  private windup: SoundHandle | null = null;
  private ctx: AttackContext | null = null;
  private readonly obb = createSphereOBBResult();

  get phaseName(): string {
    return this.phase;
  }

  /** Dashes started so far (tests). */
  get dashCount(): number {
    return this.dashes;
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    this.telegraph = C.telegraph * ctx.telegraphMult;
    this.speed = C.speed * ctx.speedMult;
    this.uTurn = upgradeOn(ctx, 'chargeUTurn');
    this.dashes = 0;
    this.beginTelegraph(ctx, 'telegraph', this.telegraph);
  }

  update(dt: number, ctx: AttackContext): void {
    const boss = ctx.boss;
    this.t += dt;
    switch (this.phase) {
      case 'telegraph':
      case 'uturn': {
        boss.shake = C.shakeAmplitude;
        boss.pulse = this.pulseAt(this.t);
        const duration = this.phase === 'telegraph' ? this.telegraph : U.uTurnTelegraph;
        if (this.t >= duration - EPS) this.lockAndDash(ctx);
        break;
      }
      case 'dash': {
        boss.pulse = 1;
        this.move(boss.pos, this.speed, dt);
        const r = Math.hypot(boss.pos.x, boss.pos.z);
        const outward = boss.pos.x * this.dir.x + boss.pos.z * this.dir.z > 0;
        if ((r >= C.stopRadius - EPS && outward) || this.t >= C.maxDashTime - EPS) {
          this.clamp(boss.pos);
          boss.dashing = false;
          this.next('skid');
        }
        break;
      }
      case 'skid': {
        // Slow linearly to 0 over the skid time.
        const v = this.speed * Math.max(0, 1 - this.t / C.skid);
        this.move(boss.pos, v, dt);
        this.clamp(boss.pos);
        const keepPulsing = this.uTurn && this.dashes === 1; // tell: another dash is coming
        boss.pulse = keepPulsing ? this.pulseAt(this.t) : Math.max(0, 1 - this.t / C.skid);
        if (this.t >= C.skid - EPS) {
          if (keepPulsing) this.beginTelegraph(ctx, 'uturn', U.uTurnTelegraph);
          else {
            boss.pulse = 0;
            boss.stuck = true;
            this.next('recovery');
          }
        }
        break;
      }
      case 'recovery':
        boss.stuck = true;
        if (this.t >= C.recovery - EPS) this.finish(ctx);
        break;
      default:
        break;
    }
  }

  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'dash') return null;
    const box = ctx.boss.getBox();
    for (const s of spheres) {
      if (sphereOBB(s.center, s.radius, box.center, box.halfSize, box.yaw, this.obb)) {
        return this.source.copy(box.center);
      }
    }
    return null;
  }

  isBossFree(): boolean {
    return this.phase === 'done';
  }

  inPunishWindow(): boolean {
    return this.phase === 'recovery';
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

  private beginTelegraph(ctx: AttackContext, phase: 'telegraph' | 'uturn', duration: number): void {
    this.next(phase);
    this.windup = ctx.audio.play('charge_windup', { duration });
  }

  private lockAndDash(ctx: AttackContext): void {
    const boss = ctx.boss;
    const dx = ctx.playerPos.x - boss.pos.x;
    const dz = ctx.playerPos.z - boss.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) this.dir.set(dx / d, 0, dz / d);
    else this.dir.set(Math.sin(boss.yaw), 0, Math.cos(boss.yaw));
    boss.yaw = Math.atan2(this.dir.x, this.dir.z); // face the dash direction
    boss.shake = 0;
    boss.dashing = true;
    this.windup = null; // the wind-up sound ends with its telegraph
    this.dashes++;
    ctx.audio.play('charge_dash');
    this.next('dash');
  }

  private move(pos: Vector3, speed: number, dt: number): void {
    pos.x += this.dir.x * speed * dt;
    pos.z += this.dir.z * speed * dt;
  }

  private clamp(pos: Vector3): void {
    const r = Math.hypot(pos.x, pos.z);
    if (r > C.stopRadius) {
      pos.x *= C.stopRadius / r;
      pos.z *= C.stopRadius / r;
    }
  }

  private pulseAt(t: number): number {
    return 0.5 * (1 - Math.cos(2 * Math.PI * C.pulseFrequency * t));
  }

  private finish(ctx: AttackContext): void {
    ctx.boss.clearAttackPose();
    this.windup = null;
    this.phase = 'done';
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }
}
