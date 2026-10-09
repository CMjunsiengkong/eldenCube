/** Static environment: floor, outer field, edge ring, sky, fog, lights (GAME_DESIGN §8). */
import {
  BufferAttribute,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  type Scene,
} from 'three';
import { CONFIG } from '../config';
import { createRng } from '../util/rng';
import { randRange } from '../util/math';

const A = CONFIG.arena;
const L = CONFIG.lights;
const C = CONFIG.colors;

/** Fixed seed so the grass pattern looks the same every session. */
const GRASS_SEED = 7;

export class Arena {
  readonly sun: DirectionalLight;

  constructor(scene: Scene) {
    scene.background = new Color(C.sky);
    scene.fog = new Fog(C.sky, A.fogNear, A.fogFar);

    // Arena floor: radius 30, 64 segments, grass ±6% per vertex (vertex colors, no texture).
    const floorGeo = new CircleGeometry(A.radius, A.segments);
    floorGeo.rotateX(-Math.PI / 2);
    const base = new Color(C.arenaGrass);
    const rng = createRng(GRASS_SEED);
    const count = floorGeo.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const c = new Color();
    for (let i = 0; i < count; i++) {
      c.copy(base).multiplyScalar(1 + randRange(rng, -A.colorVariation, A.colorVariation));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    floorGeo.setAttribute('color', new BufferAttribute(colors, 3));
    const floor = new Mesh(floorGeo, new MeshStandardMaterial({ vertexColors: true }));
    floor.receiveShadow = true;
    scene.add(floor);

    // Outer field: radius 200, 1 cm below the arena, so the horizon is grass everywhere.
    const outerGeo = new CircleGeometry(A.outerRadius, A.segments);
    outerGeo.rotateX(-Math.PI / 2);
    const outer = new Mesh(outerGeo, new MeshStandardMaterial({ color: C.outerField }));
    outer.position.y = -A.outerOffset;
    scene.add(outer);

    // Edge marker 29.8–30.2 m (where the invisible wall is).
    const edgeGeo = new RingGeometry(A.edgeInner, A.edgeOuter, A.segments);
    edgeGeo.rotateX(-Math.PI / 2);
    const edge = new Mesh(edgeGeo, new MeshStandardMaterial({ color: C.arenaEdge }));
    edge.position.y = A.edgeLift;
    edge.receiveShadow = true;
    scene.add(edge);

    // Lights: hemisphere + one shadow-casting sun.
    scene.add(new HemisphereLight(C.hemisphereSky, C.hemisphereGround, L.hemisphereIntensity));

    const sun = new DirectionalLight(C.sun, L.sunIntensity);
    sun.position.set(L.sunPosition.x, L.sunPosition.y, L.sunPosition.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(L.shadowMapSize, L.shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -L.shadowExtent;
    cam.right = L.shadowExtent;
    cam.top = L.shadowExtent;
    cam.bottom = -L.shadowExtent;
    cam.near = L.shadowNear;
    cam.far = L.shadowFar;
    cam.updateProjectionMatrix();
    sun.shadow.bias = L.shadowBias;
    scene.add(sun);
    scene.add(sun.target); // target stays at the origin
    this.sun = sun;
  }
}
