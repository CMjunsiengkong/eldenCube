/**
 * Cube Slam (GD §6.5 A): rise (telegraph) → hang → drop → impact (shockwave ring hazard) →
 * 2.0 s punish window (stuck, crown wobble; damage does not count toward poise) → free, with a
 * Rebuke request if the player is still within 5 m.
 * Rage upgrade Double Slam: a 0.5 m hop and a second impact + ring 0.5 s after the first; the
 * window starts at the second impact.
 */
import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { discGeometry, GroundDisc } from '../fx/effects';
import { createSphereOBBResult, horizontalDistance, sphereOBB } from '../systems/collision';
import { easeIn, easeOut } from '../util/math';
import { upgradeOn, type Attack, type AttackContext, type SoundHandle } from './Attack';

const S = CONFIG.slam;
const U = CONFIG.rageUpgrades;
const EPS = 1e-9;

type Phase = 'rise' | 'hang' | 'drop' | 'hop' | 'window' | 'done';

export class CubeSlam implements Attack {
  readonly id = 'slam' as const;
  private phase: Phase = 'done';
  private t = 0;
  private telegraph = 0;
  private ringSpeed = 0;
  private double = false;
  private impacts = 0;
  private impactNow = false;
  private rebuke = false;
  private readonly source = new Vector3();
  private readonly shadow = new GroundDisc(discGeometry(S.shadowRadius), CONFIG.colors.slamShadow, S.shadowLift);
  private riseSound: SoundHandle | null = null;
  private ctx: AttackContext | null = null;
  private readonly obb = createSphereOBBResult();

  get phaseName(): string {
    return this.phase;
  }

  /** Time left in the punish window (debug text), else 0. */
  get windowLeft(): number {
    return this.phase === 'window' ? Math.max(0, S.window - this.t) : 0;
  }

  /** Impacts so far (tests). */
  get impactCount(): number {
    return this.impacts;
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    this.phase = 'rise';
    this.t = 0;
    this.telegraph = S.telegraph * ctx.telegraphMult;
    this.ringSpeed = S.ringSpeed * ctx.speedMult;
    this.double = upgradeOn(ctx, 'doubleSlam');
    this.impacts = 0;
    this.impactNow = false;
    this.rebuke = false;
    this.shadow.show(ctx.scene, ctx.boss.pos.x, ctx.boss.pos.z, S.shadowOpacity);
    this.riseSound = ctx.audio.play('slam_rise', { duration: this.telegraph });
  }

  update(dt: number, ctx: AttackContext): void {
    this.impactNow = false;
    const boss = ctx.boss;
    this.t += dt;
    switch (this.phase) {
      case 'rise': {
        const u = Math.min(1, this.t / this.telegraph);
        boss.pos.y = S.riseHeight * easeOut(u);
        let opacity = S.shadowOpacity;
        if (this.double) {
          // Tell: the shadow flashes twice during the telegraph instead of staying steady.
          opacity += S.doubleSlamFlashBoost * 0.5 * (1 - Math.cos(2 * Math.PI * U.doubleSlamTellFlashes * u));
        }
        this.shadow.show(ctx.scene, boss.pos.x, boss.pos.z, opacity);
        if (this.t >= this.telegraph - EPS) this.next('hang');
        break;
      }
      case 'hang':
        boss.pos.y = S.riseHeight;
        if (this.t >= S.hang - EPS) this.next('drop');
        break;
      case 'drop':
        boss.pos.y = S.riseHeight * (1 - easeIn(Math.min(1, this.t / S.drop)));
        if (this.t >= S.drop - EPS) {
          this.impact(ctx, 1);
          this.next(this.double ? 'hop' : 'window');
          ctx.boss.stuck = !this.double;
        }
        break;
      case 'hop': {
        // A 0.5 m hop that lands exactly doubleSlamDelay after the first impact.
        const u = Math.min(1, this.t / U.doubleSlamDelay);
        boss.pos.y = 4 * U.doubleSlamHop * u * (1 - u);
        if (this.t >= U.doubleSlamDelay - EPS) {
          this.impact(ctx, U.doubleSlamVolume);
          this.next('window');
          ctx.boss.stuck = true;
        }
        break;
      }
      case 'window':
        boss.stuck = true;
        boss.crownTilt = S.windowCrownWobble * Math.sin(2 * Math.PI * S.windowCrownWobbleHz * this.t);
        if (this.t >= S.window - EPS) {
          this.rebuke = horizontalDistance(ctx.playerPos, boss.pos) < CONFIG.rebuke.windowEndDistance;
          this.finish(ctx);
        }
        break;
      default:
        break;
    }
  }

  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null {
    const ctx = this.ctx;
    if (!ctx || !this.impactNow) return null;
    // At the moment of impact: either sphere overlapping the boss footprint is hit.
    const box = ctx.boss.getBox();
    for (const s of spheres) {
      if (sphereOBB(s.center, s.radius, box.center, box.halfSize, box.yaw, this.obb)) {
        return this.source.set(ctx.boss.pos.x, box.center.y, ctx.boss.pos.z);
      }
    }
    return null;
  }

  isBossFree(): boolean {
    return this.phase === 'done';
  }

  inPunishWindow(): boolean {
    return this.phase === 'window';
  }

  wantsRebuke(): boolean {
    return this.rebuke;
  }

  dispose(): void {
    this.riseSound?.stop();
    this.riseSound = null;
    this.shadow.hide();
    this.ctx?.boss.clearAttackPose();
    if (this.phase !== 'done') this.phase = 'done';
  }

  private impact(ctx: AttackContext, volume: number): void {
    ctx.boss.pos.y = 0;
    this.impactNow = true;
    this.impacts++;
    this.shadow.hide();
    ctx.hazards.spawnRing(ctx.boss.pos.x, ctx.boss.pos.z, this.ringSpeed);
    ctx.audio.play('slam_impact', { volume });
    ctx.shake(S.impactShake.amplitude, S.impactShake.duration);
    this.riseSound = null;
  }

  private finish(ctx: AttackContext): void {
    ctx.boss.clearAttackPose();
    this.phase = 'done';
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }
}
