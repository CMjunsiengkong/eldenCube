/** A test AttackContext: a fake boss, a real (headless) Three.js scene, silent audio. */
import { Scene, Vector3 } from 'three';
import { CONFIG, type RageUpgrades } from '../src/config';
import { SILENT, type AttackBoss, type AttackContext, type BossBox } from '../src/attacks/Attack';
import { Puffs } from '../src/fx/effects';
import { createRng } from '../src/util/rng';
import type { Sphere } from '../src/entities/Player';

export class FakeBoss implements AttackBoss {
  readonly pos = new Vector3();
  yaw = 0;
  dashing = false;
  pulse = 0;
  shake = 0;
  private readonly box = { center: new Vector3(), halfSize: CONFIG.boss.halfSize, yaw: 0 };
  getBox(): BossBox {
    this.box.center.set(this.pos.x, this.pos.y + CONFIG.boss.halfSize, this.pos.z);
    this.box.yaw = this.yaw;
    return this.box;
  }
}

export interface TestCtx extends AttackContext {
  boss: FakeBoss;
  playerPos: Vector3;
  playerVel: Vector3;
  effects: Puffs;
  shakes: number[];
}

export function makeCtx(opts: { rage?: boolean; upgrades?: Partial<RageUpgrades>; speedMult?: number; telegraphMult?: number } = {}): TestCtx {
  const scene = new Scene();
  const rng = createRng(42);
  const shakes: number[] = [];
  const rage = opts.rage ?? false;
  return {
    boss: new FakeBoss(),
    playerPos: new Vector3(0, 0, 10),
    playerVel: new Vector3(),
    scene,
    audio: SILENT,
    shake: (a) => shakes.push(a),
    speedMult: opts.speedMult ?? (rage ? CONFIG.rage.speedMult : 1),
    telegraphMult: opts.telegraphMult ?? (rage ? CONFIG.rage.telegraphMult : 1),
    rage,
    // The override path required by the spec: never edit config.ts to test an upgrade.
    upgrades: { ...CONFIG.rageUpgrades, ...opts.upgrades },
    rng,
    effects: new Puffs(scene, rng),
    shakes,
  };
}

/** Player hit spheres at a horizontal position (GD §4.5). */
export function spheresAt(x: number, z: number): Sphere[] {
  return CONFIG.player.hitSpheres.map((s) => ({ center: new Vector3(x, s.height, z), radius: s.radius }));
}
