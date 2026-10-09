/**
 * Crown Shards (GD §6.5 C, design §8): telegraph (3 pulsing warning circles) → ballistic flight
 * of 3 gold cubes landing exactly on the circle centers → land (puff, remove).
 * Rage upgrade Staggered Shards: the center shard flies 0.3 s longer.
 */
import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { discGeometry, GroundDisc } from '../fx/effects';
import { inCircle, sphereSphere } from '../systems/collision';
import { upgradeOn, type Attack, type AttackContext } from './Attack';

const S = CONFIG.shards;
const U = CONFIG.rageUpgrades;
const G = CONFIG.fx.gravity;
const PLAYER_R = CONFIG.player.radius;
const EPS = 1e-9;
/** Index of the center circle/shard; 1 and 2 are the sides. */
const CENTER = 0;

type Phase = 'telegraph' | 'flight' | 'done';

interface Shard {
  readonly mesh: Mesh;
  readonly circle: GroundDisc;
  readonly target: Vector3;
  readonly vel: Vector3;
  flightTime: number;
  t: number;
  flying: boolean;
  /** Landed in the current step (landing kill check). */
  landedNow: boolean;
  pulseHz: number;
}

/** Circle centers from the player's position and velocity at the start of the telegraph (pure). */
export function placeCircles(
  playerX: number,
  playerZ: number,
  velX: number,
  velZ: number,
  bossX: number,
  bossZ: number,
  bossYaw: number,
  out: Vector3[],
): Vector3[] {
  const cx = playerX + velX * S.leadTime;
  const cz = playerZ + velZ * S.leadTime;
  let dx = playerX - bossX;
  let dz = playerZ - bossZ;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) {
    dx /= d;
    dz /= d;
  } else {
    dx = Math.sin(bossYaw);
    dz = Math.cos(bossYaw);
  }
  // Perpendicular to boss→player on the XZ plane.
  const px = dz;
  const pz = -dx;
  out[CENTER].set(cx, 0, cz);
  out[1].set(cx + px * S.sideOffset, 0, cz + pz * S.sideOffset);
  out[2].set(cx - px * S.sideOffset, 0, cz - pz * S.sideOffset);
  // Clamp every circle to lie fully inside the arena.
  const maxR = CONFIG.arena.radius - S.circleRadius;
  for (const c of out) {
    const r = Math.hypot(c.x, c.z);
    if (r > maxR) c.multiplyScalar(maxR / r);
  }
  return out;
}

export class CrownShards implements Attack {
  readonly id = 'shards' as const;
  private phase: Phase = 'done';
  private t = 0;
  private telegraph = 0;
  private staggered = false;
  private readonly shards: Shard[] = [];
  private readonly targets: Vector3[];
  private readonly source = new Vector3();
  private ctx: AttackContext | null = null;

  constructor() {
    const geo = new BoxGeometry(S.size, S.size, S.size);
    const band = CONFIG.boss.model.crownBand; // shards are pieces of the crown: same material look
    const mat = new MeshStandardMaterial({ color: CONFIG.colors.crown, metalness: band.metalness, roughness: band.roughness });
    const circleGeo = discGeometry(S.circleRadius);
    for (let i = 0; i < S.count; i++) {
      const mesh = new Mesh(geo, mat);
      mesh.castShadow = true;
      this.shards.push({
        mesh,
        circle: new GroundDisc(circleGeo, CONFIG.colors.warning, S.circleLift),
        target: new Vector3(),
        vel: new Vector3(),
        flightTime: 0,
        t: 0,
        flying: false,
        landedNow: false,
        pulseHz: S.circlePulseHz,
      });
    }
    this.targets = this.shards.map((s) => s.target);
  }

  get phaseName(): string {
    return this.phase;
  }

  /** Shards currently in flight (debug wireframes, tests). */
  flyingShards(out: Vector3[]): Vector3[] {
    out.length = 0;
    for (const s of this.shards) if (s.flying) out.push(s.mesh.position);
    return out;
  }

  /** Circle centers (tests). */
  get circleCenters(): readonly Vector3[] {
    return this.targets;
  }

  /** Flight time of each shard (tests). */
  flightTimes(): number[] {
    return this.shards.map((s) => s.flightTime);
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    this.phase = 'telegraph';
    this.t = 0;
    this.telegraph = S.telegraph * ctx.telegraphMult;
    this.staggered = upgradeOn(ctx, 'staggeredShards');
    const b = ctx.boss;
    placeCircles(ctx.playerPos.x, ctx.playerPos.z, ctx.playerVel.x, ctx.playerVel.z, b.pos.x, b.pos.z, b.yaw, this.targets);
    const flight = S.flightTime / ctx.speedMult; // D4
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      s.target.y = S.landHeight;
      s.flying = false;
      s.landedNow = false;
      s.t = 0;
      s.flightTime = flight + (this.staggered && i === CENTER ? U.staggerExtraFlight : 0);
      s.pulseHz = this.staggered ? (i === CENTER ? U.staggerCenterPulseHz : U.staggerSidePulseHz) : S.circlePulseHz;
      s.circle.show(ctx.scene, s.target.x, s.target.z, S.circleOpacity);
    }
  }

  update(dt: number, ctx: AttackContext): void {
    this.t += dt;
    for (const s of this.shards) s.landedNow = false;

    // Pulsing warning circles (telegraph and flight).
    for (const s of this.shards) {
      if (!s.circle.visible) continue;
      const pulse = 0.5 * (1 - Math.cos(2 * Math.PI * s.pulseHz * this.t));
      s.circle.setOpacity(S.circleOpacity * (1 - S.circlePulseDepth * pulse));
    }

    if (this.phase === 'telegraph') {
      if (this.t >= this.telegraph - EPS) this.launch(ctx);
      return;
    }
    if (this.phase !== 'flight') return;

    let anyLeft = false;
    let landed = false;
    for (const s of this.shards) {
      if (!s.flying) continue;
      s.t += dt;
      if (s.t >= s.flightTime - EPS) {
        // Land: snap to the exact target, puff, remove shard and circle.
        s.mesh.position.copy(s.target);
        s.flying = false;
        s.landedNow = true;
        s.mesh.removeFromParent();
        s.circle.hide();
        ctx.effects.spawn(s.target.x, S.landHeight, s.target.z, 'crown');
        landed = true;
        continue;
      }
      anyLeft = true;
      // Semi-implicit Euler (design §8); the landing frame snaps to the target.
      s.vel.y -= G * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += S.spinRate * dt;
      s.mesh.rotation.y += S.spinRate * dt;
    }
    if (landed) ctx.audio.play('shard_land'); // once per landing moment
    if (!anyLeft) this.phase = 'done';
  }

  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null {
    const p = spheres[0].center;
    for (const s of this.shards) {
      if (s.flying) {
        for (const sp of spheres) {
          if (sphereSphere(s.mesh.position, S.hitRadius, sp.center, sp.radius)) return this.source.copy(s.mesh.position);
        }
      } else if (s.landedNow && inCircle(p, s.target, S.circleRadius + PLAYER_R)) {
        return this.source.set(s.target.x, 0, s.target.z);
      }
    }
    return null;
  }

  isFinished(): boolean {
    return this.phase === 'done';
  }

  dispose(puff = false): void {
    const ctx = this.ctx;
    for (const s of this.shards) {
      if (puff && ctx) {
        if (s.flying) ctx.effects.spawn(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z, 'crown');
        if (s.circle.visible) ctx.effects.spawn(s.target.x, 0, s.target.z, 'warning');
      }
      s.flying = false;
      s.landedNow = false;
      s.mesh.removeFromParent();
      s.circle.hide();
    }
    this.phase = 'done';
  }

  private launch(ctx: AttackContext): void {
    const b = ctx.boss;
    for (const s of this.shards) {
      const T = s.flightTime;
      s.mesh.position.set(b.pos.x, b.pos.y + S.launchHeight, b.pos.z);
      s.mesh.rotation.set(0, 0, 0);
      // v0 = (target − start − ½ g T²) / T with g = (0, −G, 0).
      s.vel.set(
        (s.target.x - s.mesh.position.x) / T,
        (s.target.y - s.mesh.position.y + 0.5 * G * T * T) / T,
        (s.target.z - s.mesh.position.z) / T,
      );
      s.t = 0;
      s.flying = true;
      ctx.scene.add(s.mesh);
    }
    ctx.audio.play('shard_launch');
    this.phase = 'flight';
  }
}
