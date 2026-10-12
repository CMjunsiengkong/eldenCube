/**
 * Cone Flame Breath (GD §6.5 E, 2026-10-12): telegraph (the boss turns toward the player; a red
 * cone outline pulses on the ground) → blast(s) (the boss is stuck, the cone is fixed; each blast
 * is a 0.25 s damage window, shorter than the roll i-frames) → recovery (a punish window) → free.
 * Rage: a double blast, the second 0.70 s after the first, so it needs 2 rolls (60 stamina).
 */
import { CircleGeometry, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { wrapAngle } from '../util/math';
import type { Attack, AttackContext } from './Attack';

const CN = CONFIG.cone;
const PLAYER_R = CONFIG.player.radius;
const EPS = 1e-9;

/**
 * Pure (tested): is the point (px, pz) inside the cone from (bx, bz) facing `yaw` (atan2(x, z)
 * convention), `range` long and `halfAngle` wide, allowing for the player's radius?
 */
export function inCone(px: number, pz: number, bx: number, bz: number, yaw: number, range: number, halfAngle: number): boolean {
  const dx = px - bx;
  const dz = pz - bz;
  const d = Math.hypot(dx, dz);
  if (d > range + PLAYER_R) return false;
  if (d <= CONFIG.boss.halfSize + PLAYER_R) return true; // touching the boss's mouth
  const margin = Math.asin(Math.min(1, PLAYER_R / d));
  return Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw)) <= halfAngle + margin;
}

/** A flat sector on the ground, centered on local +Z, of unit radius. */
function sectorGeometry(angle: number): CircleGeometry {
  const g = new CircleGeometry(1, 40, -Math.PI / 2 - angle / 2, angle);
  g.rotateX(-Math.PI / 2); // (x, y) → (x, 0, −y): the sector now points along +Z
  return g;
}

type Phase = 'telegraph' | 'blast' | 'recovery' | 'done';

export class ConeBreath implements Attack {
  readonly id = 'cone' as const;
  private phase: Phase = 'done';
  private t = 0;
  private telegraph = 0;
  private range: number = CN.range;
  private half: number = CN.angle / 2;
  private blasts = 1;
  private nextBlast = 0;
  private axis = 0;
  private recovery: number = CN.recovery;
  private wasActive = false;
  private readonly source = new Vector3();
  private ctx: AttackContext | null = null;
  private readonly material = new MeshBasicMaterial({ color: CONFIG.colors.warning, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });
  private readonly geoP1 = sectorGeometry(CN.angle);
  private readonly geoRage = sectorGeometry(CN.rageAngle);
  private readonly outline = new Mesh(this.geoP1, this.material);
  private readonly fire = new MeshBasicMaterial({ color: CONFIG.colors.fire, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });

  constructor() {
    this.outline.renderOrder = 1;
  }

  get phaseName(): string {
    return this.phase;
  }

  /** The cone outline mesh (shader warm-up). */
  get scenePool(): readonly Mesh[] {
    return [this.outline];
  }

  /** A blast's damage window is open now (tests, debug). */
  get blasting(): boolean {
    return this.phase === 'blast' && this.activeAt(this.t);
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    const rage = ctx.rage;
    this.telegraph = (rage ? CN.rageTelegraph : CN.telegraph) * (ctx.easyMult ?? 1);
    this.range = rage ? CN.rageRange : CN.range;
    this.half = (rage ? CN.rageAngle : CN.angle) / 2;
    this.blasts = rage ? CN.rageBlasts : 1;
    this.recovery = rage ? CN.rageRecovery : CN.recovery;
    this.outline.geometry = rage ? this.geoRage : this.geoP1;
    this.outline.material = this.material;
    this.next('telegraph');
    this.placeOutline(ctx, ctx.boss.yaw, CN.outlineOpacity);
  }

  update(dt: number, ctx: AttackContext): void {
    const b = ctx.boss;
    this.t += dt;
    switch (this.phase) {
      case 'telegraph': {
        // The boss keeps turning toward the player (normal turn rate); the outline follows it.
        const u = Math.min(1, this.t / this.telegraph);
        b.attackSquash.y = 1 - 0.08 * u;
        b.pulse = 0.35 * u;
        const pulse = 0.5 * (1 - Math.cos(2 * Math.PI * 3 * this.t));
        this.placeOutline(ctx, b.yaw, CN.outlineOpacity * (0.6 + 0.4 * pulse));
        // Visuals lead the damage: the fire starts before the window, so it fills the cone in time.
        if (this.t >= this.telegraph - CN.flameLead - EPS) ctx.vfx?.coneFlames(b.pos.x, b.pos.z, b.yaw, this.half, this.range, CN.flamesPerStep);
        if (this.t >= this.telegraph - EPS) {
          this.axis = b.yaw;
          b.stuck = true;
          b.attackSquash.y = 1;
          b.pulse = 0;
          this.nextBlast = 0;
          this.wasActive = false;
          this.outline.material = this.fire;
          this.next('blast');
        }
        break;
      }
      case 'blast': {
        if (this.nextBlast < this.blasts && this.t >= this.nextBlast * CN.blastGap - EPS) {
          ctx.audio.play('shard_launch');
          ctx.shake(0.15, 0.2);
          b.splat(-2);
          ctx.vfx?.coneWave(b.pos.x, b.pos.z, this.axis, this.half, this.range);
          this.nextBlast++;
        }
        const active = this.activeAt(this.t);
        if (this.wasActive && !active) ctx.vfx?.coneAftermath(b.pos.x, b.pos.z, this.axis, this.half, this.range);
        this.wasActive = active;
        this.placeOutline(ctx, this.axis, active ? 0.55 : 0.12);
        if (this.flamesAt(this.t)) ctx.vfx?.coneFlames(b.pos.x, b.pos.z, this.axis, this.half, this.range, CN.flamesPerStep);
        if (this.t >= (this.blasts - 1) * CN.blastGap + CN.blast - EPS) {
          if (this.wasActive) ctx.vfx?.coneAftermath(b.pos.x, b.pos.z, this.axis, this.half, this.range);
          this.outline.removeFromParent();
          this.next('recovery');
        }
        break;
      }
      case 'recovery':
        b.stuck = true;
        if (this.t >= this.recovery - EPS) this.finish(ctx);
        break;
      default:
        break;
    }
  }

  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'blast' || !this.activeAt(this.t)) return null;
    const p = spheres[0].center;
    const b = ctx.boss.pos;
    if (inCone(p.x, p.z, b.x, b.z, this.axis, this.range, this.half)) return this.source.set(b.x, CONFIG.boss.halfSize, b.z);
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
    this.outline.removeFromParent();
    this.ctx?.boss.clearAttackPose();
    this.phase = 'done';
  }

  /** The player died from this blast: the fire fills the whole cone at once, then burns. */
  finale(): void {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'blast') return;
    const b = ctx.boss.pos;
    for (let i = 0; i < 5; i++) ctx.vfx?.coneFlames(b.x, b.z, this.axis, this.half, this.range, CN.flamesPerStep);
    ctx.vfx?.coneAftermath(b.x, b.z, this.axis, this.half, this.range);
  }

  /** Fire is drawn (each window plus the lead before it; the first lead is in the telegraph). */
  private flamesAt(t: number): boolean {
    for (let k = 0; k < this.blasts; k++) {
      const s = k * CN.blastGap;
      if (t >= s - (k === 0 ? 0 : CN.flameLead) - EPS && t < s + CN.blast - EPS) return true;
    }
    return false;
  }

  /** Inside one of the blasts' 0.25 s damage windows at time `t` of the blast phase. */
  private activeAt(t: number): boolean {
    for (let k = 0; k < this.blasts; k++) {
      const s = k * CN.blastGap;
      if (t >= s - EPS && t < s + CN.blast - EPS) return true;
    }
    return false;
  }

  private placeOutline(ctx: AttackContext, yaw: number, opacity: number): void {
    const o = this.outline;
    o.position.set(ctx.boss.pos.x, 0.035, ctx.boss.pos.z);
    o.rotation.set(0, yaw, 0);
    o.scale.setScalar(this.range);
    (o.material as MeshBasicMaterial).opacity = opacity;
    if (!o.parent) ctx.scene.add(o);
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
