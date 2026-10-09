/** Debris pieces with simple ground physics (ARCHITECTURE §5.6). No physics engine. */
import { Vector3, type Mesh, type Object3D } from 'three';
import { CONFIG } from '../config';
import type { Rng } from '../util/rng';
import { randRange } from '../util/math';

const D = CONFIG.fx.debris;
const G = CONFIG.fx.gravity;

export interface DebrisPiece {
  readonly object: Object3D;
  readonly vel: Vector3;
  readonly angVel: Vector3;
  /** Distance from the piece's center to the ground when resting (half its smallest dimension). */
  readonly groundR: number;
  asleep: boolean;
}

export function createPiece(object: Object3D, groundR: number): DebrisPiece {
  return { object, vel: new Vector3(), angVel: new Vector3(), groundR, asleep: false };
}

/** Random spin with a magnitude up to `max` rad/s around a random axis. */
export function randomSpin(rng: Rng, max: number, out: Vector3): Vector3 {
  out.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
  if (out.lengthSq() < 1e-9) out.set(0, 1, 0);
  return out.normalize().multiplyScalar(randRange(rng, 0, max));
}

/** One fixed step for every piece: gravity, bounce, friction, sleep (ARCHITECTURE §5.6). */
export function stepDebris(pieces: readonly DebrisPiece[], dt: number): void {
  for (const p of pieces) {
    if (p.asleep) continue;
    const o = p.object;
    p.vel.y -= G * dt;
    o.position.x += p.vel.x * dt;
    o.position.y += p.vel.y * dt;
    o.position.z += p.vel.z * dt;
    o.rotation.x += p.angVel.x * dt;
    o.rotation.y += p.angVel.y * dt;
    o.rotation.z += p.angVel.z * dt;

    if (o.position.y < p.groundR) {
      o.position.y = p.groundR;
      p.vel.y = -p.vel.y * D.bounce;
      p.vel.x *= D.friction;
      p.vel.z *= D.friction;
      p.angVel.multiplyScalar(D.angularDamping);
      if (p.vel.length() < D.sleepSpeed) {
        p.vel.set(0, 0, 0);
        p.angVel.set(0, 0, 0);
        p.asleep = true;
      }
    }
  }
}

/** Average position of the pieces (the player's "remains", GD §9). */
export function debrisCenter(pieces: readonly DebrisPiece[], out: Vector3): Vector3 {
  out.set(0, 0, 0);
  if (pieces.length === 0) return out;
  for (const p of pieces) out.add(p.object.position);
  return out.multiplyScalar(1 / pieces.length);
}

/** Removes the pieces from the scene and frees their per-piece materials (shared geometry is kept). */
export function disposeDebris(pieces: DebrisPiece[], disposeMaterials: boolean): void {
  for (const p of pieces) {
    p.object.removeFromParent();
    if (disposeMaterials) {
      p.object.traverse((o) => {
        const m = (o as Mesh).material;
        if (m && !Array.isArray(m)) m.dispose();
      });
    }
  }
  pieces.length = 0;
}
