/**
 * Abandoned-ruin arena floor (GAME_DESIGN §8, 1.6): concentric rings of stone slabs in the crown
 * pillars' grey, with dark cracks, moss, and grass reclaiming about 30% of the floor in random
 * patches (so the fire attacks have something to burn). One procedural `MeshStandardMaterial`
 * (no textures, one draw call, receives the moon shadow). Plus a worn stone curb at the arena
 * edge and a few fallen column drums and wall blocks in the meadow outside the wall (visual only,
 * never inside the play area; two instanced meshes).
 *
 * The grass mask is a value-noise fbm computed identically here (TypeScript, tested) and in GLSL;
 * the threshold is chosen at start-up so the grass covers `grassShare` of the arena disc.
 */
import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type Scene,
} from 'three';
import { CONFIG } from '../config';
import { createRng } from '../util/rng';

const A = CONFIG.arena;
const R = A.ruin;

const fract = (x: number): number => x - Math.floor(x);
/** Lattice hash in [0, 1) (mirrored in GLSL). */
const hash = (x: number, y: number): number => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

/** Pure (tested): smooth value noise in [0, 1). */
export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Pure (tested): the grass field at world (x, z), 3 octaves (mirrored in GLSL). */
export function grassField(x: number, z: number): number {
  const s = R.grassScale;
  return 0.57 * valueNoise(x * s, z * s) + 0.29 * valueNoise(x * s * 2.03 + 17.1, z * s * 2.03 + 3.7) + 0.14 * valueNoise(x * s * 4.11 + 5.3, z * s * 4.11 + 29.9);
}

/** Pure (tested): the threshold above which `share` of the arena disc is grass (sampled on a grid). */
export function grassThreshold(share: number = R.grassShare, radius: number = A.radius): number {
  const values: number[] = [];
  const step = 0.5;
  for (let x = -radius; x <= radius; x += step) {
    for (let z = -radius; z <= radius; z += step) if (x * x + z * z <= radius * radius) values.push(grassField(x, z));
  }
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * (1 - share)))];
}

const GLSL_NOISE = /* glsl */ `
float ruinHash(vec2 p) { return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453); }
float ruinNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = ruinHash(i);
  float b = ruinHash(i + vec2(1.0, 0.0));
  float c = ruinHash(i + vec2(0.0, 1.0));
  float d = ruinHash(i + vec2(1.0, 1.0));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float ruinGrass(vec2 p) {
  float s = uGrassScale;
  return 0.57 * ruinNoise(p * s) + 0.29 * ruinNoise(p * s * 2.03 + vec2(17.1, 3.7)) + 0.14 * ruinNoise(p * s * 4.11 + vec2(5.3, 29.9));
}`;

const GLSL_FLOOR = /* glsl */ `
{
  vec2 p = vRuin;
  float r = length(p);
  float ang = atan(p.y, p.x); // -pi..pi
  // Concentric rings of slabs; a round center stone.
  float ring = floor(max(r - uCenter, 0.0) / uRingWidth);
  float inRing = r < uCenter ? 0.0 : fract((r - uCenter) / uRingWidth);
  float rMid = uCenter + (ring + 0.5) * uRingWidth;
  float slabs = max(6.0, floor(6.2832 * rMid / uSlabLength));
  float a01 = (ang + 3.14159265) / 6.2832 + ruinHash(vec2(ring, 7.0)); // each ring is offset
  float slab = floor(a01 * slabs);
  float inSlab = fract(a01 * slabs);
  // Distance (m) to the nearest joint.
  float dRad = r < uCenter ? (uCenter - r) : min(inRing, 1.0 - inRing) * uRingWidth;
  float dAng = r < uCenter ? 99.0 : min(inSlab, 1.0 - inSlab) * 6.2832 * r / slabs;
  float dJoint = min(dRad, dAng);
  float id = r < uCenter ? 0.5 : ruinHash(vec2(ring * 13.0 + 1.0, slab));
  // Stone: per-slab tone, fine mottling, worn darker edges, a few cracks across slabs.
  float mott = ruinNoise(p * 3.1) * 0.6 + ruinNoise(p * 9.7) * 0.4;
  vec3 stone = mix(uStoneDark, uStone, 0.35 + 0.5 * id + 0.25 * (mott - 0.5));
  stone *= 0.82 + 0.18 * smoothstep(0.0, 0.25, dJoint);
  float crackN = abs(ruinNoise(p * 1.7 + vec2(id * 9.0)) - 0.5);
  float crack = (1.0 - smoothstep(0.0, 0.012, crackN)) * step(0.78, id) * 0.7; // a few thin cracks
  // Grass: patches over ~30% of the floor, thin grass in the joints, moss at patch edges.
  float g = ruinGrass(p);
  float grassPatch = smoothstep(uGrassT - 0.015, uGrassT + 0.015, g);
  float joint = 1.0 - smoothstep(uJoint * 0.5, uJoint, dJoint);
  float moss = smoothstep(uGrassT - 0.09, uGrassT - 0.015, g) * (1.0 - grassPatch);
  vec3 grass = uGrass * (0.8 + 0.4 * ruinNoise(p * 2.3)) * (0.9 + 0.2 * ruinNoise(p * 11.0));
  vec3 col = mix(stone, uMoss, moss * 0.55);
  col = mix(col, uCrack, max(crack, joint * 0.85));
  col = mix(col, uGrassDark, joint * smoothstep(uGrassT - 0.2, uGrassT, g) * 0.8); // grass in the joints
  col = mix(col, grass, grassPatch);
  diffuseColor.rgb = col;
}`;

/** The stone floor material (procedural; shares the noise with the CPU threshold). */
function floorMaterial(): MeshStandardMaterial {
  const C = CONFIG.colors;
  const mat = new MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const uniforms = {
    uRingWidth: { value: R.ringWidth },
    uSlabLength: { value: R.slabLength },
    uCenter: { value: R.centerRadius },
    uJoint: { value: R.joint },
    uGrassScale: { value: R.grassScale },
    uGrassT: { value: grassThreshold() },
    uStone: { value: new Color(C.ruinStone) },
    uStoneDark: { value: new Color(C.ruinStoneDark) },
    uCrack: { value: new Color(C.ruinCrack) },
    uMoss: { value: new Color(C.ruinMoss) },
    uGrass: { value: new Color(C.arenaGrass) },
    uGrassDark: { value: new Color(C.arenaGrass).multiplyScalar(0.55) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRuin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRuin = position.xz;');
    const decl = Object.keys(uniforms)
      .map((k) => `uniform ${k === 'uStone' || k === 'uStoneDark' || k === 'uCrack' || k === 'uMoss' || k === 'uGrass' || k === 'uGrassDark' ? 'vec3' : 'float'} ${k};`)
      .join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vRuin;\n${decl}\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GLSL_FLOOR}`);
  };
  mat.customProgramCacheKey = () => 'ruin-floor';
  return mat;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();
const UP = new Vector3(0, 1, 0);
const tmpAxis = new Vector3();
const tmpColor = new Color();

/** Builds the floor, the curb and the outside decoration into `scene`. */
export function buildRuins(scene: Scene): void {
  const C = CONFIG.colors;
  // Floor (radius 30, finer tessellation is not needed: the pattern is per pixel).
  const floorGeo = new CircleGeometry(A.radius, A.segments);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new Mesh(floorGeo, floorMaterial());
  floor.receiveShadow = true;
  scene.add(floor);

  // Worn stone curb at the edge: a low rounded profile turned around the arena.
  const c = R.curb;
  const profile = [
    new Vector2(c.inner, 0),
    new Vector2(c.inner, c.height * 0.7),
    new Vector2(c.inner + 0.08, c.height),
    new Vector2(c.outer - 0.08, c.height),
    new Vector2(c.outer, c.height * 0.6),
    new Vector2(c.outer + 0.1, 0),
  ];
  const curbGeo = new LatheGeometry(profile, 96);
  const curb = new Mesh(curbGeo, new MeshStandardMaterial({ color: C.ruinStoneDark, roughness: 0.95 }));
  curb.receiveShadow = true;
  curb.castShadow = false;
  scene.add(curb);

  // Outside decoration: fallen column drums and broken wall blocks in the meadow (never inside).
  const rng = createRng(R.decoSeed);
  const stoneMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const drumGeo = new CylinderGeometry(CONFIG.pillars.radius * 0.9, CONFIG.pillars.radius, 1, 8);
  const drums = new InstancedMesh(drumGeo, stoneMat, R.drums);
  const blocks = new InstancedMesh(new BoxGeometry(1, 1, 1), stoneMat, R.blocks);
  const torchAngles = Array.from({ length: CONFIG.lights.torch.count }, (_, i) => (i / CONFIG.lights.torch.count) * Math.PI * 2 + Math.PI / CONFIG.lights.torch.count);
  const spot = (): { x: number; z: number } => {
    for (let k = 0; k < 40; k++) {
      const a = rng() * Math.PI * 2;
      const r = R.decoRadius[0] + rng() * (R.decoRadius[1] - R.decoRadius[0]);
      // Keep clear of the torches (radius 32) and of the area straight behind the spawn view.
      const nearTorch = torchAngles.some((t) => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))) < 0.18) && r < 36;
      if (!nearTorch) return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    }
    return { x: R.decoRadius[1], z: 0 };
  };
  for (let i = 0; i < R.drums; i++) {
    const { x, z } = spot();
    const len = 1.2 + rng() * 2.2;
    // Lying on its side, rotated randomly around the vertical, slightly sunk.
    tmpQ.setFromAxisAngle(tmpAxis.set(0, 0, 1), Math.PI / 2);
    const yaw = new Quaternion().setFromAxisAngle(UP, rng() * Math.PI);
    tmpQ.premultiply(yaw);
    tmpM.compose(tmpP.set(x, CONFIG.pillars.radius * 0.8, z), tmpQ, tmpS.set(1, len, 1));
    drums.setMatrixAt(i, tmpM);
    drums.setColorAt(i, tmpColor.set(C.ruinStone).multiplyScalar(0.8 + 0.25 * rng()));
  }
  for (let i = 0; i < R.blocks; i++) {
    const { x, z } = spot();
    const w = 0.8 + rng() * 1.4;
    const h = 0.4 + rng() * 0.9;
    tmpQ.setFromAxisAngle(UP, rng() * Math.PI);
    tmpQ.multiply(new Quaternion().setFromAxisAngle(tmpAxis.set(1, 0, 0), (rng() - 0.5) * 0.3));
    tmpM.compose(tmpP.set(x, h * 0.4, z), tmpQ, tmpS.set(w, h, 0.6 + rng() * 0.7));
    blocks.setMatrixAt(i, tmpM);
    blocks.setColorAt(i, tmpColor.set(C.ruinStoneDark).multiplyScalar(0.85 + 0.3 * rng()));
  }
  for (const m of [drums, blocks]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.instanceMatrix.needsUpdate = true;
    scene.add(m);
  }
}
