/**
 * Pure collision helpers (ARCHITECTURE §5.4). No allocation in the hot path: results go into
 * caller-provided objects. Works with any {x, y, z} (including THREE.Vector3).
 *
 * Yaw convention (three.js): an object with rotation.y = yaw maps local (x, z) to world
 * (x·cos + z·sin, −x·sin + z·cos). Boxes are yaw-only (they never pitch or roll).
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Converts a world point into box-local coordinates (rotation by −yaw around Y). */
export function toBoxLocal(p: Vec3Like, center: Vec3Like, yaw: number, out: Vec3Like): Vec3Like {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.x = c * dx - s * dz;
  out.y = dy;
  out.z = s * dx + c * dz;
  return out;
}

const tmpLocal: Vec3Like = { x: 0, y: 0, z: 0 };

/** True if `p` is inside (or on the surface of) the yaw-rotated cube box. */
export function pointInOBB(p: Vec3Like, center: Vec3Like, halfSize: number, yaw: number): boolean {
  const l = toBoxLocal(p, center, yaw, tmpLocal);
  return Math.abs(l.x) <= halfSize && Math.abs(l.y) <= halfSize && Math.abs(l.z) <= halfSize;
}

export interface SphereOBBResult {
  hit: boolean;
  /** World-space unit push-out direction (from the box toward the sphere). */
  normal: Vec3Like;
  /** How far the sphere must move along `normal` to stop overlapping (0 if no hit). */
  depth: number;
}

export function createSphereOBBResult(): SphereOBBResult {
  return { hit: false, normal: { x: 0, y: 0, z: 0 }, depth: 0 };
}

/**
 * Sphere vs yaw-rotated cube box. Fills `out` and returns `out.hit`.
 * With `horizontalOnly`, the push-out direction never has a vertical component (used for body
 * contact: the player always stays on the ground).
 */
export function sphereOBB(
  c: Vec3Like,
  r: number,
  center: Vec3Like,
  halfSize: number,
  yaw: number,
  out: SphereOBBResult,
  horizontalOnly = false,
): boolean {
  const l = toBoxLocal(c, center, yaw, tmpLocal);
  const lx = l.x;
  const ly = l.y;
  const lz = l.z;
  const h = halfSize;

  // Closest point of the box to the sphere center (box-local).
  const qx = Math.max(-h, Math.min(h, lx));
  const qy = Math.max(-h, Math.min(h, ly));
  const qz = Math.max(-h, Math.min(h, lz));
  let nx = lx - qx;
  let ny = horizontalOnly ? 0 : ly - qy;
  let nz = lz - qz;
  const inside = lx === qx && ly === qy && lz === qz;

  let depth: number;
  if (!inside) {
    const fullDist2 = (lx - qx) ** 2 + (ly - qy) ** 2 + (lz - qz) ** 2;
    if (fullDist2 > r * r) {
      out.hit = false;
      out.depth = 0;
      out.normal.x = 0;
      out.normal.y = 0;
      out.normal.z = 0;
      return false;
    }
    let len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len === 0) {
      // Touching only vertically (above/below the box) with horizontalOnly: push out sideways
      // along the nearest horizontal face.
      const px = h - Math.abs(lx);
      const pz = h - Math.abs(lz);
      if (px <= pz) {
        nx = lx >= 0 ? 1 : -1;
        nz = 0;
        depth = px + r;
      } else {
        nx = 0;
        nz = lz >= 0 ? 1 : -1;
        depth = pz + r;
      }
      len = 1;
    } else {
      depth = r - Math.sqrt(fullDist2);
      nx /= len;
      ny /= len;
      nz /= len;
    }
  } else {
    // Center inside the box: leave through the face with the smallest penetration.
    const px = h - Math.abs(lx);
    const py = horizontalOnly ? Infinity : h - Math.abs(ly);
    const pz = h - Math.abs(lz);
    nx = 0;
    ny = 0;
    nz = 0;
    if (px <= py && px <= pz) {
      nx = lx >= 0 ? 1 : -1;
      depth = px + r;
    } else if (pz <= py) {
      nz = lz >= 0 ? 1 : -1;
      depth = pz + r;
    } else {
      ny = ly >= 0 ? 1 : -1;
      depth = py + r;
    }
  }

  // Rotate the local normal back to world space (rotation by +yaw).
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  out.normal.x = cs * nx + sn * nz;
  out.normal.y = ny;
  out.normal.z = -sn * nx + cs * nz;
  out.depth = depth;
  out.hit = true;
  return true;
}

/** |c1 − c2|² ≤ (r1 + r2)². */
export function sphereSphere(c1: Vec3Like, r1: number, c2: Vec3Like, r2: number): boolean {
  const dx = c1.x - c2.x;
  const dy = c1.y - c2.y;
  const dz = c1.z - c2.z;
  const rr = r1 + r2;
  return dx * dx + dy * dy + dz * dz <= rr * rr;
}

/** Horizontal distance between two points (XZ plane). */
export function horizontalDistance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** True if the horizontal distance d from `center` satisfies |d − radius| ≤ halfWidth. */
export function inRingBand(p: Vec3Like, center: Vec3Like, radius: number, halfWidth: number): boolean {
  return Math.abs(horizontalDistance(p, center) - radius) <= halfWidth;
}

/** True if `p` is within horizontal distance `r` of `center`. */
export function inCircle(p: Vec3Like, center: Vec3Like, r: number): boolean {
  return horizontalDistance(p, center) <= r;
}
