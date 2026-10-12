/**
 * Named visual effects (milestone 1.5b; visual only). Owns the two particle pools (additive glow,
 * alpha smoke), the burning marks and a small pool of flat ground flashes, and offers one emitter
 * per effect: Slam impact burst, shockwave embers, fireball trail and explosion, Charge dust, heal
 * aura and torch flames. Uses its own RNG, so effects never change the gameplay random sequence.
 * Everything is preallocated; nothing is allocated per frame.
 */
import { Color, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, type Scene } from 'three';
import { CONFIG } from '../config';
import { createRng, type Rng } from '../util/rng';
import { Burns } from './burns';
import { newSpec, Particles } from './particles';

const V = CONFIG.vfx;
const C = CONFIG.colors;

interface Flash {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  t: number;
  duration: number;
  from: number;
  to: number;
  alpha: number;
}

export class Vfx {
  readonly glow = new Particles(V.particles.glowCapacity, 'glow');
  readonly smoke = new Particles(V.particles.smokeCapacity, 'smoke');
  readonly burns = new Burns();
  private readonly rng: Rng = createRng(0x51ab);
  private readonly spec = newSpec();
  private readonly flashes: Flash[] = [];
  private nextFlash = 0;
  private readonly scene: Scene;
  // Palette (linear working space).
  private readonly cFire = new Color(C.fire);
  private readonly cCore = new Color(C.fireballCore);
  private readonly cFlameCore = new Color(C.flameCore);
  private readonly cShock = new Color(C.shockwave);
  private readonly cShockCore = new Color(C.shockwaveCore);
  private readonly cDust = new Color(C.dust);
  private readonly cSmoke = new Color(C.scorch).lerp(new Color(0x444444), 0.6);
  private readonly cHeal = new Color(C.healFlash);
  private readonly tmp = new Color();

  constructor(scene: Scene) {
    this.scene = scene;
    this.glow.addTo(scene);
    this.smoke.addTo(scene);
    this.burns.addTo(scene);
    const geo = new RingGeometry(V.flash.innerRatio, 1, 48);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < V.flash.pool; i++) {
      const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });
      const mesh = new Mesh(geo, material);
      mesh.renderOrder = 6;
      mesh.visible = false;
      scene.add(mesh);
      this.flashes.push({ mesh, material, t: 0, duration: 1, from: 0, to: 1, alpha: 1 });
    }
  }

  /** Simulation step: particle clocks, burn marks, ground flashes. */
  step(dt: number): void {
    this.glow.step(dt);
    this.smoke.step(dt);
    this.burns.step(dt);
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      const u = Math.min(1, f.t / f.duration);
      const r = f.from + (f.to - f.from) * (1 - (1 - u) * (1 - u));
      f.mesh.scale.setScalar(Math.max(0.01, r));
      f.material.opacity = f.alpha * (1 - u);
      if (u >= 1) f.mesh.visible = false;
    }
  }

  /** Reset: every particle, mark and flash removed. */
  clear(): void {
    this.glow.clear();
    this.smoke.clear();
    this.burns.clear();
    for (const f of this.flashes) f.mesh.visible = false;
  }

  /** Objects that are normally hidden (shader warm-up). */
  get scenePool(): readonly Mesh[] {
    return [this.glow.mesh, this.smoke.mesh, this.burns.scorch, this.burns.flames, ...this.flashes.map((f) => f.mesh)];
  }

  // --- emitters ------------------------------------------------------------------------------------

  /** GD §6.5 A impact: dust and embers from the boss footprint. */
  slamImpact(x: number, z: number): void {
    const S = V.slamImpact;
    const r = this.rng;
    const s = this.spec;
    for (let i = 0; i < S.count; i++) {
      const a = r() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ember = i % 2 === 0;
      s.x = x + ca * S.radius;
      s.y = 0.2 + r() * 0.4;
      s.z = z + sa * S.radius;
      const out = ember ? this.range(S.emberSpeed) : this.range(S.dustSpeed);
      s.vx = ca * out;
      s.vz = sa * out;
      s.vy = ember ? this.range(S.emberUp) : this.range(S.dustUp);
      s.life = ember ? this.range(S.emberLife) : this.range(S.dustLife);
      s.size0 = ember ? S.emberSize : S.dustSize[0];
      s.size1 = ember ? 0 : S.dustSize[1];
      s.gravity = ember ? S.emberGravity : S.dustGravity;
      s.alpha = ember ? 1 : S.dustAlpha;
      if (ember) {
        s.color.copy(this.cShock).lerp(this.cShockCore, r());
        this.glow.spawn(s);
      } else {
        s.color.copy(this.cDust);
        this.smoke.spawn(s);
      }
    }
    this.flash(x, z, V.slamImpact.flashFrom, V.slamImpact.flashTo, V.slamImpact.flashTime, this.cShockCore, 0.9);
  }

  /** Embers riding a shockwave front of `radius` around (cx, cz), moving outward at `speed`. */
  ringEmbers(cx: number, cz: number, radius: number, speed: number, count: number): void {
    const E = V.ringEmbers;
    const r = this.rng;
    const s = this.spec;
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rr = radius + (r() - 0.5) * CONFIG.slam.ringWidth;
      s.x = cx + ca * rr;
      s.y = 0.05 + r() * CONFIG.slam.ringHeight;
      s.z = cz + sa * rr;
      s.vx = ca * speed;
      s.vz = sa * speed;
      s.vy = this.range(E.up);
      s.life = this.range(E.life);
      s.size0 = E.size;
      s.size1 = 0;
      s.gravity = E.gravity;
      s.alpha = 1;
      s.color.copy(this.cShock).lerp(this.cShockCore, r() * 0.8);
      this.glow.spawn(s);
    }
  }

  /** One step of a fireball's trail at its current position. */
  fireballTrail(x: number, y: number, z: number): void {
    const T = V.fireball;
    const r = this.rng;
    const s = this.spec;
    s.x = x + (r() - 0.5) * 0.15;
    s.y = y + (r() - 0.5) * 0.15;
    s.z = z + (r() - 0.5) * 0.15;
    s.vx = (r() - 0.5) * 0.6;
    s.vy = (r() - 0.5) * 0.6;
    s.vz = (r() - 0.5) * 0.6;
    s.life = this.range(T.trailLife);
    s.size0 = T.trailSize;
    s.size1 = 0.05;
    s.gravity = -1;
    s.alpha = 0.9;
    s.color.copy(this.cCore).lerp(this.cFire, r());
    this.glow.spawn(s);
    if (r() < T.smokeChance) {
      s.size0 = T.smokeSize[0];
      s.size1 = T.smokeSize[1];
      s.life = T.smokeLife;
      s.gravity = -0.8;
      s.alpha = T.smokeAlpha;
      s.color.copy(this.cSmoke);
      this.smoke.spawn(s);
    }
  }

  /** GD §6.5 C: a fireball explodes where it lands and leaves a 3 s burning mark. */
  fireExplosion(x: number, z: number): void {
    const X = V.explosion;
    const r = this.rng;
    const s = this.spec;
    for (let i = 0; i < X.sparks; i++) {
      const a = r() * Math.PI * 2;
      const out = this.range(X.sparkSpeed);
      s.x = x;
      s.y = 0.3;
      s.z = z;
      s.vx = Math.cos(a) * out;
      s.vz = Math.sin(a) * out;
      s.vy = this.range(X.sparkUp);
      s.life = this.range(X.sparkLife);
      s.size0 = X.sparkSize;
      s.size1 = 0;
      s.gravity = X.sparkGravity;
      s.alpha = 1;
      s.color.copy(this.cFlameCore).lerp(this.cFire, r());
      this.glow.spawn(s);
    }
    // Core flash
    s.x = x;
    s.y = 0.5;
    s.z = z;
    s.vx = s.vy = s.vz = 0;
    s.life = X.flashLife;
    s.size0 = X.flashSize;
    s.size1 = X.flashSize * 0.3;
    s.gravity = 0;
    s.alpha = 1;
    s.color.copy(this.cCore);
    this.glow.spawn(s);
    for (let i = 0; i < X.smoke; i++) {
      s.x = x + (r() - 0.5) * 0.6;
      s.y = 0.3;
      s.z = z + (r() - 0.5) * 0.6;
      s.vx = (r() - 0.5) * 1.2;
      s.vz = (r() - 0.5) * 1.2;
      s.vy = this.range(X.smokeUp);
      s.life = X.smokeLife;
      s.size0 = X.smokeSize[0];
      s.size1 = X.smokeSize[1];
      s.gravity = -0.5;
      s.alpha = X.smokeAlpha;
      s.color.copy(this.cSmoke);
      this.smoke.spawn(s);
    }
    this.burns.spawn(x, z, r());
  }

  /** Dust kicked up behind the dashing / skidding boss. `dir`: the dash direction. */
  chargeDust(x: number, z: number, dirX: number, dirZ: number): void {
    const D = V.chargeDust;
    const r = this.rng;
    const s = this.spec;
    for (let i = 0; i < D.perStep; i++) {
      const side = (r() - 0.5) * 2 * D.halfWidth;
      s.x = x - dirX * D.behind + -dirZ * side;
      s.y = 0.15;
      s.z = z - dirZ * D.behind + dirX * side;
      s.vx = -dirX * this.range(D.speed) + (r() - 0.5);
      s.vz = -dirZ * this.range(D.speed) + (r() - 0.5);
      s.vy = this.range(D.up);
      s.life = this.range(D.life);
      s.size0 = D.size[0];
      s.size1 = D.size[1];
      s.gravity = 1.5;
      s.alpha = D.alpha;
      s.color.copy(this.cDust);
      this.smoke.spawn(s);
    }
  }

  /** GD §4.3c heal aura: gold particles swirling up around the player + a gold ground ring. */
  healAura(x: number, z: number): void {
    const H = V.heal;
    const r = this.rng;
    const s = this.spec;
    for (let i = 0; i < H.count; i++) {
      const a = (i / H.count) * Math.PI * 2 + r() * 0.3;
      const rad = this.range(H.radius);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      s.x = x + ca * rad;
      s.y = this.range(H.height);
      s.z = z + sa * rad;
      // Tangential + slightly inward: the cloud swirls around the body while rising.
      s.vx = -sa * H.swirl - ca * 0.15;
      s.vz = ca * H.swirl - sa * 0.15;
      s.vy = this.range(H.up);
      s.life = this.range(H.life);
      s.size0 = H.size;
      s.size1 = 0;
      s.gravity = H.gravity;
      s.alpha = 1;
      s.color.copy(this.cHeal).lerp(this.tmp.setRGB(1, 1, 1), r() * 0.4);
      this.glow.spawn(s);
    }
    this.flash(x, z, H.ringFrom, H.ringTo, H.ringTime, this.cHeal, 0.8);
  }

  /** GD §6.5 E: fire filling the cone from the boss's mouth (one step of a blast). */
  coneFlames(bx: number, bz: number, yaw: number, half: number, range: number, count: number): void {
    const r = this.rng;
    const s = this.spec;
    const mouth = CONFIG.boss.halfSize;
    for (let i = 0; i < count; i++) {
      const a = yaw + (r() * 2 - 1) * half;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      const speed = range / 0.38;
      s.x = bx + sa * mouth;
      s.y = CONFIG.cone.mouthHeight * (0.5 + 0.5 * r());
      s.z = bz + ca * mouth;
      s.vx = sa * speed * (0.7 + 0.3 * r());
      s.vz = ca * speed * (0.7 + 0.3 * r());
      s.vy = -1.5 - r() * 2;
      s.life = 0.3 + r() * 0.12;
      s.size0 = 0.7;
      s.size1 = 2.0;
      s.gravity = -2;
      s.alpha = 0.55;
      s.color.copy(this.cFlameCore).lerp(this.cFire, 0.5 + r() * 0.5);
      this.glow.spawn(s);
    }
  }

  /** GD §6.5 F: embers flying off the beam (one step). */
  beamSparks(bx: number, bz: number, yaw: number, from: number, to: number, height: number): void {
    const r = this.rng;
    const s = this.spec;
    const sa = Math.sin(yaw);
    const ca = Math.cos(yaw);
    for (let i = 0; i < 8; i++) {
      const d = from + r() * (to - from);
      s.x = bx + sa * d;
      s.y = height + (r() - 0.5) * 0.4;
      s.z = bz + ca * d;
      s.vx = (r() - 0.5) * 3;
      s.vz = (r() - 0.5) * 3;
      s.vy = 1 + r() * 2;
      s.life = 0.25 + r() * 0.2;
      s.size0 = 0.45;
      s.size1 = 0;
      s.gravity = 4;
      s.alpha = 1;
      s.color.copy(this.cFlameCore).lerp(this.cFire, r());
      this.glow.spawn(s);
    }
  }

  /** One flame particle of a torch at (x, y, z). */
  torchFlame(x: number, y: number, z: number): void {
    const T = V.torch;
    const r = this.rng;
    const s = this.spec;
    s.x = x + (r() - 0.5) * T.jitter;
    s.y = y;
    s.z = z + (r() - 0.5) * T.jitter;
    s.vx = (r() - 0.5) * 0.3;
    s.vz = (r() - 0.5) * 0.3;
    s.vy = this.range(T.up);
    s.life = this.range(T.life);
    s.size0 = T.size;
    s.size1 = 0.04;
    s.gravity = -0.6;
    s.alpha = 0.95;
    s.color.copy(this.cFlameCore).lerp(this.cFire, 0.3 + r() * 0.7);
    this.glow.spawn(s);
  }

  // --- helpers -------------------------------------------------------------------------------------

  private flash(x: number, z: number, from: number, to: number, duration: number, color: Color, alpha: number): void {
    const f = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    f.mesh.position.set(x, V.flash.lift, z);
    f.material.color.copy(color);
    f.t = 0;
    f.duration = duration;
    f.from = from;
    f.to = to;
    f.alpha = alpha;
    f.mesh.scale.setScalar(from);
    f.material.opacity = alpha;
    f.mesh.visible = true;
    if (!f.mesh.parent) this.scene.add(f.mesh);
  }

  private range(r: readonly [number, number] | readonly number[]): number {
    return r[0] + (r[1] - r[0]) * this.rng();
  }
}
