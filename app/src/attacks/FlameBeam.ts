/**
 * Flame Beam (GD §6.5 F, 2026-10-12): charge (the boss turns toward the player; a thin red aiming
 * line) → fire (a 28 m beam that sweeps toward the player on ONE side, decided when it fires, and
 * never reverses) → a short recovery (a punish window) → free. The beam stops at once if the
 * player is hit or the boss takes damage. Counterplay: roll against the sweep through the beam.
 */
import { AdditiveBlending, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { wrapAngle } from '../util/math';
import type { Attack, AttackContext } from './Attack';

const BM = CONFIG.beam;
const PLAYER_R = CONFIG.player.radius;
const EPS = 1e-9;

/**
 * Pure (tested): the sweep side when the beam fires (+1 = toward increasing yaw, atan2(x, z)
 * convention). From the player's sideways velocity across the boss→player line `(dx, dz)` (unit);
 * below the dead zone, `fallback` decides.
 */
export function sweepSide(dx: number, dz: number, vx: number, vz: number, fallback: number): 1 | -1 {
  const lat = vx * dz - vz * dx; // velocity along the direction of increasing yaw
  if (Math.abs(lat) > BM.lateralDeadzone) return lat > 0 ? 1 : -1;
  return fallback >= 0.5 ? 1 : -1;
}

/**
 * Pure (tested): one step of the beam angle `phi` toward `target`, only in direction `side`, at
 * most `maxStep`. It never moves backwards: once the target is behind the sweep, it holds.
 */
export function beamStep(phi: number, target: number, side: 1 | -1, maxStep: number): number {
  const want = side * wrapAngle(target - phi);
  return phi + side * Math.min(maxStep, Math.max(0, want));
}

/** Pure (tested): horizontal distance from (px, pz) to the segment (ax, az)–(bx, bz). */
export function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax;
  const ez = bz - az;
  const len2 = ex * ex + ez * ez;
  const u = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (pz - az) * ez) / len2)) : 0;
  return Math.hypot(px - (ax + ex * u), pz - (az + ez * u));
}

type Phase = 'charge' | 'fire' | 'recovery' | 'done';

export class FlameBeam implements Attack {
  readonly id = 'beam' as const;
  private phase: Phase = 'done';
  private t = 0;
  private charge = 0;
  private fireTime = 0;
  private sweep = 0;
  private recovery = 0;
  private phi = 0;
  private side: 1 | -1 = 1;
  private readonly source = new Vector3();
  private ctx: AttackContext | null = null;
  private readonly beam = new Group();
  private readonly core: Mesh;
  private readonly glow: Mesh;
  private readonly aim: Mesh;
  private readonly aimMat: MeshBasicMaterial;

  constructor() {
    const cyl = new CylinderGeometry(1, 1, 1, 12, 1, true);
    cyl.rotateX(Math.PI / 2); // axis along +Z
    cyl.translate(0, 0, 0.5); // from z = 0 to z = 1
    const add = (color: number, opacity: number): MeshBasicMaterial =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
    this.core = new Mesh(cyl, add(CONFIG.colors.flameCore, 0.95));
    this.glow = new Mesh(cyl, add(CONFIG.colors.fire, 0.45));
    this.core.renderOrder = 6;
    this.glow.renderOrder = 6;
    this.beam.add(this.core, this.glow);
    const line = new BoxGeometry(0.06, 0.06, 1);
    line.translate(0, 0, 0.5);
    this.aimMat = add(CONFIG.colors.warning, 0.6);
    this.aim = new Mesh(line, this.aimMat);
    this.aim.renderOrder = 6;
  }

  get phaseName(): string {
    return this.phase;
  }

  /** The beam's current angle and sweep side (tests, debug). */
  get angle(): number {
    return this.phi;
  }

  get sweepDirection(): 1 | -1 {
    return this.side;
  }

  /** Normally detached meshes (shader warm-up). */
  get scenePool(): readonly (Group | Mesh)[] {
    return [this.beam, this.aim];
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    const rage = ctx.rage;
    this.charge = (rage ? BM.rageCharge : BM.charge) * (ctx.easyMult ?? 1);
    this.fireTime = rage ? BM.rageFire : BM.fire;
    this.sweep = rage ? BM.rageSweep : BM.sweep;
    this.recovery = rage ? BM.rageRecovery : BM.recovery;
    this.next('charge');
    this.placeAim(ctx);
  }

  update(dt: number, ctx: AttackContext): void {
    const b = ctx.boss;
    this.t += dt;
    switch (this.phase) {
      case 'charge': {
        // The boss turns toward the player normally; the crown glows brighter as it charges.
        const u = Math.min(1, this.t / this.charge);
        b.crownGlow = u;
        b.attackSquash.y = 1 + 0.08 * u;
        this.aimMat.opacity = 0.25 + 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 6 * this.t));
        this.placeAim(ctx);
        if (this.t >= this.charge - EPS) this.fire(ctx);
        break;
      }
      case 'fire': {
        const dx = ctx.playerPos.x - b.pos.x;
        const dz = ctx.playerPos.z - b.pos.z;
        this.phi = beamStep(this.phi, Math.atan2(dx, dz), this.side, this.sweep * dt);
        b.yaw = this.phi; // the boss faces its beam
        this.placeBeam(ctx);
        this.sparks(ctx);
        if (this.t >= this.fireTime - EPS) this.stopFiring();
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
    if (!ctx || this.phase !== 'fire') return null;
    const b = ctx.boss.pos;
    const s = Math.sin(this.phi);
    const c = Math.cos(this.phi);
    const p = spheres[0].center;
    const d = segmentDistance(p.x, p.z, b.x + s * BM.startOffset, b.z + c * BM.startOffset, b.x + s * BM.length, b.z + c * BM.length);
    if (d <= BM.hitRadius + PLAYER_R) return this.source.set(b.x, BM.height, b.z);
    return null;
  }

  /** The boss took damage: the beam stops (GD §6.5 F). */
  onBossHit(): void {
    if (this.phase === 'fire') this.stopFiring();
  }

  /** The player was hit: the beam stops. */
  onPlayerHit(): void {
    if (this.phase === 'fire') this.stopFiring();
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
    this.beam.removeFromParent();
    this.aim.removeFromParent();
    this.ctx?.boss.clearAttackPose();
    this.phase = 'done';
  }

  private fire(ctx: AttackContext): void {
    const b = ctx.boss;
    const dx = ctx.playerPos.x - b.pos.x;
    const dz = ctx.playerPos.z - b.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.phi = Math.atan2(dx, dz); // locks exactly onto the player
    this.side = sweepSide(dx / d, dz / d, ctx.playerVel.x, ctx.playerVel.z, ctx.rng());
    b.yaw = this.phi;
    b.stuck = true;
    b.crownGlow = 0;
    b.attackSquash.y = 1;
    this.aim.removeFromParent();
    ctx.audio.play('shard_launch');
    ctx.shake(0.12, 0.25);
    this.next('fire');
    this.placeBeam(ctx);
  }

  private stopFiring(): void {
    this.beam.removeFromParent();
    this.next('recovery');
  }

  private placeAim(ctx: AttackContext): void {
    const b = ctx.boss;
    const s = Math.sin(b.yaw);
    const c = Math.cos(b.yaw);
    this.aim.position.set(b.pos.x + s * BM.startOffset, BM.height, b.pos.z + c * BM.startOffset);
    this.aim.rotation.set(0, b.yaw, 0);
    this.aim.scale.set(1, 1, BM.length - BM.startOffset);
    if (!this.aim.parent) ctx.scene.add(this.aim);
  }

  private placeBeam(ctx: AttackContext): void {
    const b = ctx.boss;
    const s = Math.sin(this.phi);
    const c = Math.cos(this.phi);
    const flick = 1 + 0.12 * Math.sin(this.t * 40) * Math.sin(this.t * 23);
    this.beam.position.set(b.pos.x + s * BM.startOffset, BM.height, b.pos.z + c * BM.startOffset);
    this.beam.rotation.set(0, this.phi, 0);
    const len = BM.length - BM.startOffset;
    this.core.scale.set(BM.radius * flick, BM.radius * flick, len);
    this.glow.scale.set(BM.radius * 2.4 * flick, BM.radius * 2.4 * flick, len);
    if (!this.beam.parent) ctx.scene.add(this.beam);
  }

  private sparks(ctx: AttackContext): void {
    const v = ctx.vfx;
    if (!v) return;
    const b = ctx.boss.pos;
    v.beamSparks(b.x, b.z, this.phi, BM.startOffset, BM.length, BM.height);
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
