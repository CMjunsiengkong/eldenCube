/**
 * Shared character style (GD §8 rim light, ARCHITECTURE §4.6, milestone 1.5b):
 * - `addRim`: a fresnel edge glow added to `MeshStandardMaterial` through `onBeforeCompile`, so
 *   player and boss silhouettes read against the night sky. Every patched material shares one
 *   program (`customProgramCacheKey`); the rim color and strength are per-material uniforms.
 * - `paint` / `mergePainted`: flat vertex colors, so several primitives that move together become
 *   one mesh (one draw call) with one shared material.
 */
import { BufferAttribute, Color, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';

const tmpColor = new Color();

/** Gives `geo` a flat vertex color (linear working space). Returns the same geometry. */
export function paint<G extends BufferGeometry>(geo: G, color: number): G {
  tmpColor.set(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = tmpColor.r;
    arr[i * 3 + 1] = tmpColor.g;
    arr[i * 3 + 2] = tmpColor.b;
  }
  geo.setAttribute('color', new BufferAttribute(arr, 3));
  return geo;
}

/**
 * Merges painted geometries into one. Mixed indexed / non-indexed inputs are all converted to
 * non-indexed first; attributes other than position, normal, uv and color are dropped.
 */
export function mergePainted(parts: BufferGeometry[]): BufferGeometry {
  const anyFlat = parts.some((g) => g.index === null);
  const prepared = parts.map((g) => {
    const h = anyFlat && g.index !== null ? g.toNonIndexed() : g;
    for (const name of Object.keys(h.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') h.deleteAttribute(name);
    }
    if (!h.getAttribute('uv')) h.setAttribute('uv', new BufferAttribute(new Float32Array(h.getAttribute('position').count * 2), 2));
    return h;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error('mergePainted: incompatible geometries');
  return merged;
}

export interface RimHandle {
  readonly color: Color;
  /** Live uniform: change `.value` to fade the rim. */
  readonly strength: { value: number };
}

const RIM_PARS = /* glsl */ `
uniform vec3 rimColor;
uniform float rimStrength;
uniform float rimPower;`;

/** Runs after the normal is known, before the lights: adds the rim to the emissive term. */
const RIM_FRAGMENT = /* glsl */ `
#include <emissivemap_fragment>
{
  float rimFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
  totalEmissiveRadiance += rimColor * rimStrength * pow(1.0 - clamp(rimFacing, 0.0, 1.0), rimPower);
}`;

/** Patches `material` with the rim light. Call once per material, before its first render. */
export function addRim(material: MeshStandardMaterial, color: Color | number, strength: number): RimHandle {
  const handle: RimHandle = { color: new Color(color), strength: { value: strength } };
  const power = { value: CONFIG.rim.power };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: handle.color };
    shader.uniforms.rimStrength = handle.strength;
    shader.uniforms.rimPower = power;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${RIM_PARS}`)
      .replace('#include <emissivemap_fragment>', RIM_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'elden-rim';
  return handle;
}
