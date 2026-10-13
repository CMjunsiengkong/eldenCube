/**
 * Static environment (GAME_DESIGN §8; 1.5b moonlit dusk): floor, outer field, edge ring, night
 * sky and fog, hemisphere light, the moon (the only shadow caster) and 6 torches outside the
 * arena wall with flickering point lights (no shadows) and particle flames.
 * The light count never changes during play.
 */
import {
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  type Scene,
} from 'three';
import { CONFIG } from '../config';
import { mergePainted, paint } from '../fx/materials';
import { buildRuins } from './Ruins';
import type { Vfx } from '../fx/vfx';

const A = CONFIG.arena;
const L = CONFIG.lights;
const T = L.torch;
const C = CONFIG.colors;

interface Torch {
  readonly light: PointLight;
  readonly x: number;
  readonly z: number;
  readonly phase: number;
  /** Fractional flame particles carried to the next step. */
  acc: number;
}

/** Pure (tested): torch flicker multiplier in [1 − flicker, 1 + flicker] from summed sines. */
export function torchFlicker(t: number, phase: number): number {
  const [a, b, c] = T.flickerHz;
  const n = (Math.sin(2 * Math.PI * a * t + phase) + Math.sin(2 * Math.PI * b * t + phase * 1.7) * 0.6 + Math.sin(2 * Math.PI * c * t + phase * 2.3) * 0.4) / 2;
  return 1 + T.flicker * n;
}

export class Arena {
  readonly moon: DirectionalLight;
  private readonly scene: Scene;
  private readonly hemi: HemisphereLight;
  private readonly baseSky = new Color(C.sky);
  private readonly baseHemi = new Color(C.hemisphereSky);
  private readonly baseMoon = new Color(C.moon);
  private readonly bloodSky = new Color(CONFIG.vfx.bloodMoon.sky);
  private readonly bloodHemi = new Color(CONFIG.vfx.bloodMoon.hemisphereSky);
  private readonly bloodMoon = new Color(CONFIG.vfx.bloodMoon.moon);
  private blood = 0;
  private readonly torches: Torch[] = [];
  private time = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    scene.background = new Color(C.sky);
    scene.fog = new Fog(C.sky, A.fogNear, A.fogFar);

    // 1.6: the abandoned-ruin floor (stone rings, 30% grass), the stone curb and outside decoration.
    buildRuins(scene);

    // Outer field: radius 200, 1 cm below the arena; it fades into the night fog.
    const outerGeo = new CircleGeometry(A.outerRadius, A.segments);
    outerGeo.rotateX(-Math.PI / 2);
    const outer = new Mesh(outerGeo, new MeshStandardMaterial({ color: C.outerField }));
    outer.position.y = -A.outerOffset;
    scene.add(outer);

    // Lights: dim hemisphere + the moon, the only shadow caster.
    this.hemi = new HemisphereLight(C.hemisphereSky, C.hemisphereGround, L.hemisphereIntensity);
    scene.add(this.hemi);
    const moon = new DirectionalLight(C.moon, L.moonIntensity);
    moon.position.set(L.moonPosition.x, L.moonPosition.y, L.moonPosition.z);
    moon.castShadow = true;
    moon.shadow.mapSize.set(L.shadowMapSize, L.shadowMapSize);
    const cam = moon.shadow.camera;
    cam.left = -L.shadowExtent;
    cam.right = L.shadowExtent;
    cam.top = L.shadowExtent;
    cam.bottom = -L.shadowExtent;
    cam.near = L.shadowNear;
    cam.far = L.shadowFar;
    cam.updateProjectionMatrix();
    moon.shadow.bias = L.shadowBias;
    scene.add(moon);
    scene.add(moon.target); // target stays at the origin
    this.moon = moon;

    // Torches: pole + iron bowl (one instanced mesh, no shadows) and a warm point light each.
    const torchGeo = mergePainted([
      paint(new CylinderGeometry(T.poleRadius, T.poleRadius * 1.3, T.poleHeight, 8).translate(0, T.poleHeight / 2, 0), C.torchPole),
      paint(new CylinderGeometry(T.bowlTopRadius, T.bowlBottomRadius, T.bowlHeight, 10).translate(0, T.poleHeight + T.bowlHeight / 2, 0), C.torchBowl),
    ]);
    const props = new InstancedMesh(torchGeo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), T.count);
    const m = new Matrix4();
    for (let i = 0; i < T.count; i++) {
      const a = (i / T.count) * Math.PI * 2 + Math.PI / T.count; // none directly behind the spawn
      const x = Math.cos(a) * T.radius;
      const z = Math.sin(a) * T.radius;
      props.setMatrixAt(i, m.makeTranslation(x, 0, z));
      const light = new PointLight(C.torchLight, T.intensity, T.range, T.decay);
      light.position.set(x, T.lightHeight, z);
      light.castShadow = false;
      scene.add(light);
      this.torches.push({ light, x, z, phase: i * 1.91, acc: 0 });
    }
    props.instanceMatrix.needsUpdate = true;
    scene.add(props);
  }

  /** GD §6.5 blood moon: sky, fog, moon and hemisphere light lerp toward red by `w` (0…1). */
  setBlood(w: number): void {
    if (Math.abs(w - this.blood) < 1e-4) return;
    this.blood = w;
    (this.scene.background as Color).copy(this.baseSky).lerp(this.bloodSky, w);
    (this.scene.fog as Fog).color.copy(this.baseSky).lerp(this.bloodSky, w);
    this.moon.color.copy(this.baseMoon).lerp(this.bloodMoon, w);
    this.hemi.color.copy(this.baseHemi).lerp(this.bloodHemi, w);
  }

  /** Simulation step: flicker the torch lights and feed their flames. */
  step(dt: number, vfx: Vfx): void {
    this.time += dt;
    for (const t of this.torches) {
      t.light.intensity = T.intensity * torchFlicker(this.time, t.phase);
      t.acc += CONFIG.vfx.torch.perSecond * dt;
      while (t.acc >= 1) {
        t.acc -= 1;
        vfx.torchFlame(t.x, T.flameHeight, t.z);
      }
    }
  }
}
