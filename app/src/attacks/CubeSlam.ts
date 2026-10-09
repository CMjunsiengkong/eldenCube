/**
 * Cube Slam (GD §6.5 A, design §8): rise (telegraph) → hang → drop → impact → shockwave ring.
 * Rage upgrade Double Slam: a 0.5 m hop and a second impact + ring 0.5 s after the first impact.
 */
import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { discGeometry, GroundDisc, ShockwaveRing } from '../fx/effects';
import { inRingBand, sphereOBB, createSphereOBBResult } from '../systems/collision';
import { easeIn, easeOut } from '../util/math';
import { upgradeOn, type Attack, type AttackContext, type SoundHandle } from './Attack';

const S = CONFIG.slam;
const U = CONFIG.rageUpgrades;
const PLAYER_R = CONFIG.player.radius;
const EPS = 1e-9;

type Phase = 'rise' | 'hang' | 'drop' | 'ring' | 'hop' | 'done';

interface LiveRing {
  readonly mesh: ShockwaveRing;
  radius: number;
  alive: boolean;
}

export class CubeSlam implements Attack {
  readonly id = 'slam' as const;
  private phase: Phase = 'done';
  private t = 0;
  private telegraph = 0;
  private ringSpeed = 0;
  private double = false;
  /** Time since the first impact (Double Slam timing). */
  private sinceImpact = 0;
  private impactNow = false;
  private readonly center = new Vector3();
  private readonly source = new Vector3();
  private readonly shadow = new GroundDisc(discGeometry(S.shadowRadius), CONFIG.colors.slamShadow, S.shadowLift);
  private readonly rings: LiveRing[] = [
    { mesh: new ShockwaveRing(), radius: 0, alive: false },
    { mesh: new ShockwaveRing(), radius: 0, alive: false },
  ];
  private ringsSpawned = 0;
  private riseSound: SoundHandle | null = null;
  private ctx: AttackContext | null = null;
  private readonly obb = createSphereOBBResult();

  get phaseName(): string {
    return this.phase;
  }

  /** Live ring radii (debug wireframes, tests). */
  liveRings(out: number[]): number[] {
    out.length = 0;
    for (const r of this.rings) if (r.alive) out.push(r.radius);
    return out;
  }

  get ringCenter(): Vector3 {
    return this.center;
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    this.phase = 'rise';
    this.t = 0;
    this.telegraph = S.telegraph * ctx.telegraphMult;
    this.ringSpeed = S.ringSpeed * ctx.speedMult;
    this.double = upgradeOn(ctx, 'doubleSlam');
    this.sinceImpact = 0;
    this.impactNow = false;
    this.ringsSpawned = 0;
    for (const r of this.rings) r.alive = false;
    this.shadow.show(ctx.scene, ctx.boss.pos.x, ctx.boss.pos.z, S.shadowOpacity);
    this.riseSound = ctx.audio.play('slam_rise', { duration: this.telegraph });
  }

  update(dt: number, ctx: AttackContext): void {
    this.impactNow = false;
    const boss = ctx.boss;
    this.t += dt;
    if (this.ringsSpawned > 0) this.sinceImpact += dt;

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
        this.shadow.show(ctx.scene, boss.pos.x, boss.pos.z, S.shadowOpacity);
        if (this.t >= S.hang - EPS) this.next('drop');
        break;
      case 'drop': {
        boss.pos.y = S.riseHeight * (1 - easeIn(Math.min(1, this.t / S.drop)));
        this.shadow.show(ctx.scene, boss.pos.x, boss.pos.z, S.shadowOpacity);
        if (this.t >= S.drop - EPS) {
          this.impact(ctx, 1);
          this.next(this.double ? 'hop' : 'ring');
        }
        break;
      }
      case 'hop': {
        // A small 0.5 m hop that lands exactly doubleSlamDelay after the first impact.
        const u = Math.min(1, this.sinceImpact / U.doubleSlamDelay);
        boss.pos.y = 4 * U.doubleSlamHop * u * (1 - u);
        if (this.sinceImpact >= U.doubleSlamDelay - EPS) {
          this.impact(ctx, U.doubleSlamVolume);
          this.next('ring');
        }
        break;
      }
      default:
        break;
    }
    this.stepRings(dt);
    if (this.phase === 'ring' && !this.rings.some((r) => r.alive)) this.finish();
  }

  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const p = spheres[0].center;
    if (this.impactNow) {
      // At the moment of impact: either sphere overlapping the boss footprint dies.
      const box = ctx.boss.getBox();
      for (const s of spheres) {
        if (sphereOBB(s.center, s.radius, box.center, box.halfSize, box.yaw, this.obb)) {
          return this.source.set(ctx.boss.pos.x, box.center.y, ctx.boss.pos.z);
        }
      }
    }
    for (const r of this.rings) {
      if (r.alive && inRingBand(p, this.center, r.radius, S.ringWidth / 2 + PLAYER_R)) {
        return this.source.set(this.center.x, CONFIG.boss.halfSize, this.center.z);
      }
    }
    return null;
  }

  isFinished(): boolean {
    return this.phase === 'done';
  }

  dispose(puff = false): void {
    const ctx = this.ctx;
    this.riseSound?.stop();
    this.riseSound = null;
    if (ctx) {
      if (puff) {
        if (this.shadow.visible) ctx.effects.spawn(ctx.boss.pos.x, 0, ctx.boss.pos.z, 'shockwave');
        for (const r of this.rings) {
          if (!r.alive) continue;
          // Four puffs around the ring so its removal reads clearly.
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2;
            ctx.effects.spawn(this.center.x + Math.cos(a) * r.radius, S.ringHeight, this.center.z + Math.sin(a) * r.radius, 'shockwave');
          }
        }
      }
      // Cancelled mid-air: the boss drops back to the ground.
      ctx.boss.pos.y = 0;
    }
    this.shadow.hide();
    for (const r of this.rings) {
      r.alive = false;
      r.mesh.hide();
    }
    this.phase = 'done';
  }

  private impact(ctx: AttackContext, volume: number): void {
    ctx.boss.pos.y = 0;
    this.impactNow = true;
    this.shadow.hide();
    if (this.ringsSpawned === 0) this.center.set(ctx.boss.pos.x, 0, ctx.boss.pos.z);
    const ring = this.rings[this.ringsSpawned++];
    ring.alive = true;
    ring.radius = S.ringStartRadius;
    ring.mesh.setRadius(ring.radius);
    ring.mesh.show(ctx.scene, this.center.x, this.center.z);
    ctx.audio.play('slam_impact', { volume });
    ctx.shake(S.impactShake.amplitude, S.impactShake.duration);
    this.riseSound = null;
  }

  private stepRings(dt: number): void {
    const travel = S.ringEndRadius - S.ringStartRadius;
    for (const r of this.rings) {
      if (!r.alive) continue;
      r.radius += this.ringSpeed * dt;
      if (r.radius >= S.ringEndRadius - EPS) {
        r.alive = false;
        r.mesh.hide();
        continue;
      }
      r.mesh.setRadius(r.radius);
      const u = (r.radius - S.ringStartRadius) / travel;
      r.mesh.material.opacity = u <= S.ringFadeStart ? 1 : Math.max(0, 1 - (u - S.ringFadeStart) / (1 - S.ringFadeStart));
    }
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }

  private finish(): void {
    this.dispose(false);
  }
}
