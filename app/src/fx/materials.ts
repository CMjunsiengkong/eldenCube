/**
 * Shared character style (GD §8 rim light, ARCHITECTURE §4.6, milestone 1.5b): a fresnel edge glow
 * added to `MeshStandardMaterial` through `onBeforeCompile`, so player and boss silhouettes read
 * against the night sky. Every patched material shares one program (`customProgramCacheKey`); the
 * rim color and strength are per-material uniforms.
 */
import { Color, type MeshStandardMaterial } from 'three';
import { CONFIG } from '../config';

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
