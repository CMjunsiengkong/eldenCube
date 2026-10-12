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
  /** Time since the attack started (s): the hold / release events are scheduled on it. */
  private elapsed = 0;
  /** The next blast whose hold / release is still to come. */
  private nextRelease = 0;
  private locked = false;
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
    this.elapsed = 0;
    this.nextRelease = 0;
    this.locked = false;
    this.next('telegraph');
    this.placeOutline(ctx, ctx.boss.yaw, CN.outlineOpacity);
  }

  update(dt: number, ctx: AttackContext): void {
    const b = ctx.boss;
    this.t += dt;
    this.elapsed += dt;
    this.holdAndRelease(ctx);
    switch (this.phase) {
      case 'telegraph': {
        // The boss keeps turning toward the player until the first hold locks the cone.
        const u = Math.min(1, this.t / this.telegraph);
        b.attackSquash.y = 1 - 0.08 * u;
        b.pulse = 0.35 * u;
        const pulse = 0.5 * (1 - Math.cos(2 * Math.PI * 3 * this.t));
        this.placeOutline(ctx, this.locked ? this.axis : b.yaw, CN.outlineOpacity * (0.6 + 0.4 * pulse));
        if (this.t >= this.telegraph - EPS) {
          if (!this.locked) this.lockAxis(ctx);
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
        if (this.nextBlast < this.blasts && this.t >= this.nextBlast * CN.blastGap - EPS) this.nextBlast++;
        const active = this.activeAt(this.t);
        if (this.wasActive && !active) ctx.vfx?.coneAftermath(b.pos.x, b.pos.z, this.axis, this.half, this.range);
        this.wasActive = active;
        // While a damage window is open the cone glows hot on the ground (the flames are brief).
        this.placeOutline(ctx, this.axis, active ? 0.55 : 0.12);
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

  /** The player died from this blast: one more, bigger release, then burning marks. */
  finale(): void {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'blast') return;
    const b = ctx.boss.pos;
    ctx.vfx?.coneRelease(b.x, b.z, this.axis, this.half, this.range, 1.5);
    ctx.vfx?.coneAftermath(b.x, b.z, this.axis, this.half, this.range);
  }

  /**
   * GD §6.5 E (2026-10-12): before each damage window, `hold` seconds of a white-hot ball
   * compressing at the mouth, then the release `releaseLead` seconds before the window: everything
   * fires in one frame (crown flames, flash, ring of fire, sound, camera kick).
   */
  private holdAndRelease(ctx: AttackContext): void {
    if (this.nextRelease >= this.blasts) return;
    const b = ctx.boss;
    const window = this.telegraph + this.nextRelease * CN.blastGap;
    const releaseAt = window - CN.releaseLead;
    const holdAt = releaseAt - CN.hold;
    if (this.elapsed < holdAt - EPS) return;
    if (!this.locked) this.lockAxis(ctx);
    const mx = b.pos.x + Math.sin(this.axis) * CONFIG.boss.halfSize;
    const mz = b.pos.z + Math.cos(this.axis) * CONFIG.boss.halfSize;
    if (this.elapsed < releaseAt - EPS) {
      ctx.vfx?.coneHold(mx, CN.mouthHeight * 0.8, mz, (this.elapsed - holdAt) / CN.hold);
      ctx.shake(0.05, 0.1);
      return;
    }
    ctx.vfx?.coneRelease(b.pos.x, b.pos.z, this.axis, this.half, this.range);
    ctx.audio.play('cone_blast');
    ctx.shake(0.4, 0.18);
    b.splat(-3);
    this.nextRelease++;
  }

  /** The cone stops following the player: fixed from the first hold on. */
  private lockAxis(ctx: AttackContext): void {
    this.axis = ctx.boss.yaw;
    ctx.boss.stuck = true;
    this.locked = true;
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
