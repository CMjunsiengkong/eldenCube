/**
 * The Elden Cube (GAME_DESIGN §6).
 *
 * - `BossBrain` is the pure core: HP, phase, invulnerability, mode and the rage transition,
 *   including decision D9 (the 3rd hit cancels a running attack and starts rage in the same step).
 *   Attack selection, cooldown and tactics are added in milestone 1.4.
 * - `Boss` is the view and motion: model, idle bob, turning, hit reaction visuals, rage visuals,
 *   break-apart on defeat.
 */
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Scene,
} from 'three';
import { CONFIG } from '../config';
import type { Vec3Like } from '../systems/collision';
import { createPiece, randomSpin, type DebrisPiece } from '../fx/debris';
import { Fade, Squash, Timer } from '../fx/effects';
import { randRange, turnToward } from '../util/math';
import type { Rng } from '../util/rng';
import type { BossPhase } from '../flags';

const B = CONFIG.boss;
const RG = CONFIG.rage;
const EPS = 1e-9;

export type BossMode = 'idle' | 'attacking' | 'rageTransition' | 'defeated';
export type HitResult = 'hit' | 'rage' | 'defeated' | 'ignored';

export class BossBrain {
  hp: number = B.hp;
  phase: BossPhase = 'p1';
  /** Seconds of invulnerability left after a hit. */
  invuln = 0;
  mode: BossMode = 'idle';
  /** Time spent in the rage transition (s). */
  rageT = 0;
  /** Set by takeHit when the running attack must be cancelled (D9); read with consumeCancel(). */
  private cancelRequested = false;

  reset(): void {
    this.hp = B.hp;
    this.phase = 'p1';
    this.invuln = 0;
    this.mode = 'idle';
    this.rageT = 0;
    this.cancelRequested = false;
  }

  /** Marks that an attack is running (milestone 1.4 sets/clears this from the scheduler). */
  setAttacking(attacking: boolean): void {
    if (this.mode === 'idle' || this.mode === 'attacking') this.mode = attacking ? 'attacking' : 'idle';
  }

  canTakeDamage(): boolean {
    return this.mode !== 'defeated' && this.mode !== 'rageTransition' && this.invuln <= EPS;
  }

  /**
   * A weapon hit (GD §5, §6.2–6.4). Returns 'ignored' during invulnerability, the rage transition
   * or after defeat. The hit that brings HP to 2 starts rage and — if an attack is running —
   * requests its cancellation in the same step (D9). Other hits never interrupt an attack.
   */
  takeHit(): HitResult {
    if (!this.canTakeDamage()) return 'ignored';
    this.hp -= 1;
    this.invuln = B.invulnerability;
    if (this.hp <= 0) {
      this.hp = 0;
      this.mode = 'defeated';
      this.cancelRequested = true;
      return 'defeated';
    }
    if (this.phase === 'p1' && this.hp <= RG.hpThreshold) {
      this.phase = 'rage';
      this.cancelRequested = this.mode === 'attacking';
      this.mode = 'rageTransition';
      this.rageT = 0;
      return 'rage';
    }
    return 'hit';
  }

  /** True once if the running attack must be cancelled now. */
  consumeCancel(): boolean {
    const c = this.cancelRequested;
    this.cancelRequested = false;
    return c;
  }

  update(dt: number): void {
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.mode === 'rageTransition') {
      this.rageT += dt;
      if (this.rageT >= RG.transitionDuration - EPS) this.mode = 'idle';
    }
  }
}

export interface BossBox {
  center: Vector3;
  halfSize: number;
  yaw: number;
}

/** The visual boss, positioned and turned by the game. */
export class Boss {
  readonly brain = new BossBrain();
  readonly root = new Group();
  /** Position of the boss origin (bottom center) on the ground. */
  readonly pos = new Vector3(B.spawn.x, B.spawn.y, B.spawn.z);
  yaw = 0;
  /** True during a Charge dash (no turning, no knockback) — set by RoyalCharge in 1.4. */
  dashing = false;

  /** Squashed / bobbing / shaking part (pivot at the ground). */
  private readonly visual = new Group();
  private readonly crown = new Group();
  private readonly bodyMat: MeshStandardMaterial;
  private readonly faceMats: MeshStandardMaterial[] = [];
  private readonly crownMat: MeshStandardMaterial;
  private readonly brows: Mesh[] = [];
  private readonly pupils: Mesh[] = [];
  private readonly bodyColor = new Color(CONFIG.colors.bossPhase1);
  private readonly phase1Color = new Color(CONFIG.colors.bossPhase1);
  private readonly rageColor = new Color(CONFIG.colors.bossRage);

  private readonly flash = new Timer();
  private readonly squash = new Squash();
  private readonly rageFade = new Fade();
  private readonly scaleTmp = { x: 1, y: 1, z: 1 };
  private readonly box: BossBox = { center: new Vector3(), halfSize: B.halfSize, yaw: 0 };
  private readonly pieceGeo = new BoxGeometry(B.defeat.pieceSize, B.defeat.pieceSize, B.defeat.pieceSize);
  private readonly rng: Rng;
  private time = 0;
  private broken = false;

  constructor(rng: Rng) {
    this.rng = rng;
    const M = B.model;
    const C = CONFIG.colors;
    this.root.add(this.visual);

    this.bodyMat = new MeshStandardMaterial({ color: C.bossPhase1, roughness: M.roughness });
    const body = new Mesh(new BoxGeometry(M.bodySize, M.bodySize, M.bodySize), this.bodyMat);
    body.position.y = M.bodyCenterY;
    this.addShadowed(body, this.visual);

    // Face (+Z local looks at the player)
    const eyeMat = this.faceMat(C.eyes);
    const darkMat = this.faceMat(C.pupils);
    const eyeGeo = new BoxGeometry(M.eye.size.x, M.eye.size.y, M.eye.size.z);
    const pupilGeo = new BoxGeometry(M.pupil.size.x, M.pupil.size.y, M.pupil.size.z);
    const browGeo = new BoxGeometry(M.eyebrow.size.x, M.eyebrow.size.y, M.eyebrow.size.z);
    for (const sx of [-1, 1]) {
      const eye = new Mesh(eyeGeo, eyeMat);
      eye.position.set(sx * M.eye.position.x, M.eye.position.y, M.eye.position.z);
      this.addShadowed(eye, this.visual);
      const pupil = new Mesh(pupilGeo, darkMat);
      pupil.position.set(sx * M.pupil.position.x, M.pupil.position.y, M.pupil.position.z);
      this.addShadowed(pupil, this.visual);
      this.pupils.push(pupil);
      const brow = new Mesh(browGeo, darkMat);
      brow.position.set(sx * M.eyebrow.position.x, M.eyebrow.position.y, M.eyebrow.position.z);
      brow.rotation.z = sx * M.eyebrow.tilt; // inner end lower: angry
      this.addShadowed(brow, this.visual);
      this.brows.push(brow);
    }

    // Crown: 5-sided band with a cone on each corner
    const cb = M.crownBand;
    this.crownMat = new MeshStandardMaterial({ color: C.crown, metalness: cb.metalness, roughness: cb.roughness });
    const band = new Mesh(new CylinderGeometry(cb.radius, cb.radius, cb.height, cb.sides), this.crownMat);
    band.position.y = cb.y;
    this.addShadowed(band, this.crown);
    const cp = M.crownPoint;
    const coneGeo = new ConeGeometry(cp.radius, cp.height, cp.segments);
    for (let i = 0; i < cp.count; i++) {
      const a = (i / cp.count) * Math.PI * 2; // CylinderGeometry corners are at sin/cos of k·72°
      const cone = new Mesh(coneGeo, this.crownMat);
      cone.position.set(Math.sin(a) * cb.radius, cp.y, Math.cos(a) * cb.radius);
      this.addShadowed(cone, this.crown);
    }
    this.visual.add(this.crown);
    this.syncTransform();
  }

  reset(scene: Scene): void {
    this.brain.reset();
    this.pos.set(B.spawn.x, B.spawn.y, B.spawn.z);
    this.yaw = 0;
    this.dashing = false;
    this.time = 0;
    this.flash.clear();
    this.squash.clear();
    this.rageFade.clear();
    this.bodyColor.copy(this.phase1Color);
    this.bodyMat.color.copy(this.phase1Color);
    this.bodyMat.emissive.setRGB(0, 0, 0);
    if (this.broken) {
      // Re-attach the crown (it was a debris piece) with its original local transform.
      this.crown.removeFromParent();
      this.crown.position.set(0, 0, 0);
      this.crown.rotation.set(0, 0, 0);
      this.visual.add(this.crown);
      this.broken = false;
    }
    this.root.visible = true;
    if (!this.root.parent) scene.add(this.root);
    this.syncTransform();
  }

  /** Yaw-only hit box (GD §5.4): half-size 2.0, centered 2 m above the boss origin. */
  getBox(): BossBox {
    this.box.center.set(this.pos.x, this.pos.y + B.halfSize, this.pos.z);
    this.box.yaw = this.yaw;
    return this.box;
  }

  get isBroken(): boolean {
    return this.broken;
  }

  /** One fixed step: brain timers, turning toward `face`, visuals. */
  update(dt: number, face: Vec3Like | null): void {
    this.brain.update(dt);
    this.time += dt;

    if (face && !this.dashing && this.brain.mode !== 'defeated') {
      const dx = face.x - this.pos.x;
      const dz = face.z - this.pos.z;
      if (dx * dx + dz * dz > 1e-6) this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), B.turnRate * dt);
    }

    // Rage transition: color fade (0.5 s) and shake (±0.1 m).
    this.rageFade.step(dt);
    this.bodyColor.copy(this.phase1Color).lerp(this.rageColor, this.rageFade.value);
    this.bodyMat.color.copy(this.bodyColor);

    this.flash.step(dt);
    this.squash.step(dt);
    this.applyFlash();
    this.syncTransform();
  }

  private applyFlash(): void {
    const f = this.flash.active ? 1 : 0;
    this.bodyMat.emissive.setRGB(f, f, f);
  }

  /** GD §6.3 hit reaction visuals + knockback. Hit-stop, shake, sound and HUD are done by Game. */
  onHit(from: Vec3Like): void {
    this.flash.start(B.hit.flashDuration);
    this.squash.start();
    // Show the flash and squash immediately, so they are visible during the hit-stop freeze.
    this.applyFlash();
    if (!this.dashing) {
      const dx = this.pos.x - from.x;
      const dz = this.pos.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        this.pos.x += (dx / d) * B.hit.knockback;
        this.pos.z += (dz / d) * B.hit.knockback;
        this.clampToArena();
      }
    }
    this.syncTransform();
  }

  /** GD §6.4: the rage transition begins (color fade starts now). */
  onRage(): void {
    this.rageFade.start(RG.colorFade);
  }

  clampToArena(): void {
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > B.clampRadius) {
      this.pos.x *= B.clampRadius / r;
      this.pos.z *= B.clampRadius / r;
    }
  }

  /**
   * GD §6.6: hide the boss, return 8 cubes of 2 m (2×2×2 split, current body color) flying outward
   * plus the crown as a separate piece. The caller adds them to the scene and the debris list.
   */
  breakApart(scene: Scene): DebrisPiece[] {
    const D = B.defeat;
    const pieces: DebrisPiece[] = [];
    this.root.updateMatrixWorld(true);
    const mat = new MeshStandardMaterial({ color: this.bodyColor.clone(), roughness: B.model.roughness });
    const half = D.pieceSize / 2;
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    for (const lx of [-half, half]) {
      for (const ly of [half, 3 * half]) {
        for (const lz of [-half, half]) {
          const m = new Mesh(this.pieceGeo, mat);
          m.castShadow = true;
          m.receiveShadow = true;
          const wx = this.pos.x + lx * cos + lz * sin;
          const wz = this.pos.z - lx * sin + lz * cos;
          m.position.set(wx, this.pos.y + ly, wz);
          m.rotation.y = this.yaw;
          scene.add(m);
          const p = createPiece(m, half);
          const ox = wx - this.pos.x;
          const oz = wz - this.pos.z;
          const ol = Math.hypot(ox, oz) || 1;
          const out = randRange(this.rng, D.outwardSpeed[0], D.outwardSpeed[1]);
          p.vel.set((ox / ol) * out, randRange(this.rng, D.upwardSpeed[0], D.upwardSpeed[1]), (oz / ol) * out);
          randomSpin(this.rng, D.maxSpin, p.angVel);
          pieces.push(p);
        }
      }
    }

    // The crown falls and rolls (its ground radius is half the band height: it rolls on its side).
    scene.attach(this.crown);
    const a = this.rng() * Math.PI * 2;
    const out = randRange(this.rng, D.crownOutwardSpeed[0], D.crownOutwardSpeed[1]);
    const crownPiece = createPiece(this.crown, B.model.crownBand.height / 2);
    crownPiece.vel.set(Math.sin(a) * out, randRange(this.rng, D.crownUpwardSpeed[0], D.crownUpwardSpeed[1]), Math.cos(a) * out);
    randomSpin(this.rng, D.maxSpin, crownPiece.angVel);
    pieces.push(crownPiece);

    this.root.visible = false;
    this.broken = true;
    return pieces;
  }

  private syncTransform(): void {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    // Idle bob (visual only). Milestone 1.4 doubles it as the anti-camping tell.
    const bob = B.bobAmplitude * Math.sin(2 * Math.PI * B.bobFrequency * this.time);
    let sx = 0;
    let sz = 0;
    if (this.brain.mode === 'rageTransition') {
      sx = (this.rng() * 2 - 1) * RG.shakeAmplitude;
      sz = (this.rng() * 2 - 1) * RG.shakeAmplitude;
    }
    this.visual.position.set(sx, bob, sz);
    this.squash.scale(this.scaleTmp);
    this.visual.scale.set(this.scaleTmp.x, this.scaleTmp.y, this.scaleTmp.z);
  }

  private faceMat(color: number): MeshStandardMaterial {
    const m = new MeshStandardMaterial({ color, roughness: B.model.roughness });
    this.faceMats.push(m);
    return m;
  }

  private addShadowed(m: Mesh, parent: Group): void {
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
  }
}
