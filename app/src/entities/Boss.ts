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
import { cooldownFor, getFlags, speedMult, type BossPhase, type Flags } from '../flags';
import { ATTACK_IDS, type AttackBoss, type AttackId, type BossBox } from '../attacks/Attack';

const B = CONFIG.boss;
const RG = CONFIG.rage;
const T = CONFIG.tactics;
const EPS = 1e-9;

export type BossMode = 'grace' | 'cooldown' | 'attacking' | 'rageTransition' | 'gloat' | 'defeated';
export type HitResult = 'hit' | 'rage' | 'defeated' | 'ignored';

/**
 * GD §6.5 selection rule (pure). `history` is oldest → newest.
 * - The attack used for the last `noRepeat` attacks in a row is blocked.
 * - Close timer ≥ 3.0 s: Slam, or Shards if Slam is blocked (anti-camping).
 * - Otherwise uniformly random among slam, charge (only if distance > 6 m), shards, minus the blocked one.
 */
export function chooseAttack(history: readonly AttackId[], distance: number, closeTimer: number, rng: Rng): AttackId {
  const n = history.length;
  let blocked: AttackId | null = null;
  if (n >= T.noRepeat) {
    blocked = history[n - 1];
    for (let i = 2; i <= T.noRepeat; i++) if (history[n - i] !== blocked) blocked = null;
  }
  if (closeTimer >= T.closeTrigger - EPS) return blocked === 'slam' ? 'shards' : 'slam';
  const valid: AttackId[] = [];
  for (const id of ATTACK_IDS) {
    if (id === blocked) continue;
    if (id === 'charge' && distance <= CONFIG.charge.minDistance) continue;
    valid.push(id);
  }
  return valid[Math.min(valid.length - 1, Math.floor(rng() * valid.length))];
}

/** GD §6.2a close timer (pure): +dt while closer than 4 m, −2·dt otherwise, never below 0. */
export function updateCloseTimer(timer: number, distance: number, dt: number): number {
  return distance < T.closeDistance ? timer + dt : Math.max(0, timer - T.closeDecayMult * dt);
}

/** GD §6.2a punish (pure): −0.8 s, never below 0.3 s, at most once per cooldown (D3: fixed values). */
export function applyMissPunish(remaining: number, alreadyPunished: boolean): { remaining: number; punished: boolean } {
  if (alreadyPunished) return { remaining, punished: true };
  return { remaining: Math.max(T.punishFloor, remaining - T.punishReduction), punished: true };
}

/** Pure boss core: HP, phase, invulnerability, mode, cooldown scheduler and tactics. */
export class BossBrain {
  hp: number = B.hp;
  phase: BossPhase = 'p1';
  /** Seconds of invulnerability left after a hit. */
  invuln = 0;
  mode: BossMode = 'grace';
  /** Seconds until the next attack starts (grace or cooldown). */
  cooldownLeft: number = B.grace;
  /** Attacks used so far, oldest first (only the last few matter). */
  readonly history: AttackId[] = [];
  closeTimer = 0;
  /** The miss punish already fired in this cooldown. */
  punished = false;
  /** Debug keys 1/2/3 override the next choice. */
  forceNext: AttackId | null = null;
  /** The current attack (while mode === 'attacking'). */
  current: AttackId | null = null;
  /** Time spent in the rage transition (s). */
  rageT = 0;
  /** Set by takeHit when the running attack must be cancelled (D9); read with consumeCancel(). */
  private cancelRequested = false;
  private readonly rng: Rng;
  private readonly flags: Flags;

  constructor(rng: Rng, flags: Flags = getFlags()) {
    this.rng = rng;
    this.flags = flags;
  }

  reset(): void {
    this.hp = B.hp;
    this.phase = 'p1';
    this.invuln = 0;
    this.mode = 'grace';
    this.cooldownLeft = B.grace;
    this.history.length = 0;
    this.closeTimer = 0;
    this.punished = false;
    this.forceNext = null;
    this.current = null;
    this.rageT = 0;
    this.cancelRequested = false;
  }

  /** Waiting for the next attack (grace or cooldown): chase, tells and punish apply. */
  get waiting(): boolean {
    return this.mode === 'grace' || this.mode === 'cooldown';
  }

  /** The anti-camping tell is showing (the boss "gets annoyed"). */
  get annoyed(): boolean {
    return this.mode === 'cooldown' && this.closeTimer >= T.closeTrigger - EPS;
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
      this.cancelRequested = this.mode === 'attacking';
      this.mode = 'defeated';
      this.current = null;
      return 'defeated';
    }
    if (this.phase === 'p1' && this.hp <= RG.hpThreshold) {
      this.phase = 'rage';
      this.cancelRequested = this.mode === 'attacking';
      this.mode = 'rageTransition';
      this.current = null;
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

  /** Starts an attack now (used by `update` at the end of a cooldown, and by tests). */
  beginAttack(id: AttackId): void {
    this.history.push(id);
    if (this.history.length > 8) this.history.shift();
    this.current = id;
    this.mode = 'attacking';
  }

  /** The running attack has finished: start the cooldown (rage × easy, D3). */
  attackFinished(): void {
    if (this.mode !== 'attacking') return;
    this.current = null;
    this.startCooldown();
  }

  /** Player died (DYING): stop attacking and gloat. */
  gloat(): void {
    if (this.mode === 'defeated') return;
    this.cancelRequested = false;
    this.current = null;
    this.mode = 'gloat';
  }

  /**
   * GD §6.2a punish rushing in: a missed swing within 5 m while waiting shortens the remaining
   * cooldown once. Returns true if the punish fired.
   */
  onPlayerMissedSwing(distance: number): boolean {
    if (!this.waiting || this.punished || distance >= T.punishDistance) return false;
    const r = applyMissPunish(this.cooldownLeft, this.punished);
    this.cooldownLeft = r.remaining;
    this.punished = r.punished;
    return true;
  }

  /**
   * One fixed step during FIGHT. `distance` is the horizontal player distance to the boss center.
   * Returns the attack to start now, or null.
   */
  update(dt: number, distance: number): AttackId | null {
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.mode === 'gloat' || this.mode === 'defeated') return null;
    this.closeTimer = updateCloseTimer(this.closeTimer, distance, dt);

    if (this.mode === 'rageTransition') {
      this.rageT += dt;
      // After the transition a fresh rage cooldown starts (design decision D10, see report).
      if (this.rageT >= RG.transitionDuration - EPS) this.startCooldown();
      return null;
    }
    if (!this.waiting) return null;

    this.cooldownLeft -= dt;
    if (this.cooldownLeft > EPS) return null;
    let id: AttackId;
    if (this.forceNext) {
      id = this.forceNext;
      this.forceNext = null;
    } else {
      const camping = this.closeTimer >= T.closeTrigger - EPS;
      id = chooseAttack(this.history, distance, this.closeTimer, this.rng);
      if (camping) this.closeTimer = 0;
    }
    this.beginAttack(id);
    return id;
  }

  private startCooldown(): void {
    this.mode = 'cooldown';
    this.cooldownLeft = cooldownFor(this.phase, this.flags);
    this.punished = false;
  }
}

/** The visual boss: model, motion (turn, chase), tells, hit reaction, break-apart. */
export class Boss implements AttackBoss {
  readonly brain: BossBrain;
  readonly root = new Group();
  /** Position of the boss origin (bottom center). Slam drives y, Charge drives x/z. */
  readonly pos = new Vector3(B.spawn.x, B.spawn.y, B.spawn.z);
  yaw = 0;
  /** True during a Charge dash (no turning, no knockback). */
  dashing = false;
  /** Red emissive pulse 0…1 (Charge telegraph). */
  pulse = 0;
  /** Extra shake amplitude from the running attack (m). */
  shake = 0;

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
  private readonly box: { center: Vector3; halfSize: number; yaw: number } = { center: new Vector3(), halfSize: B.halfSize, yaw: 0 };
  private readonly pulseColor = new Color(CONFIG.colors.warning);
  private readonly flags: Flags;
  private glareLeft = 0;
  private readonly pieceGeo = new BoxGeometry(B.defeat.pieceSize, B.defeat.pieceSize, B.defeat.pieceSize);
  private readonly rng: Rng;
  private time = 0;
  private broken = false;

  constructor(rng: Rng, flags: Flags = getFlags()) {
    this.rng = rng;
    this.flags = flags;
    this.brain = new BossBrain(rng, flags);
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
    this.pulse = 0;
    this.shake = 0;
    this.glareLeft = 0;
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

  /**
   * One fixed step. `target` is the player during FIGHT, or the player's remains while gloating
   * (null after defeat). Returns the attack to start now, or null.
   */
  update(dt: number, target: Vec3Like | null): AttackId | null {
    const brain = this.brain;
    const dx = target ? target.x - this.pos.x : 0;
    const dz = target ? target.z - this.pos.z : 0;
    const dist = target ? Math.hypot(dx, dz) : Infinity;
    const start = brain.update(dt, dist);
    this.time += dt;

    if (target && !this.dashing && brain.mode !== 'defeated' && dist > 1e-3) {
      this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), B.turnRate * dt);
    }
    // Chase between attacks (grace or cooldown) when farther than 7 m.
    if (target && brain.waiting && dist > B.chaseDistance) {
      const step = Math.min(dist - B.chaseDistance, B.chaseSpeed * speedMult(brain.phase, this.flags) * dt);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
      this.clampToArena();
    }
    this.glareLeft = Math.max(0, this.glareLeft - dt);

    // Rage transition: color fade (0.5 s) and shake (±0.1 m).
    this.rageFade.step(dt);
    this.bodyColor.copy(this.phase1Color).lerp(this.rageColor, this.rageFade.value);
    this.bodyMat.color.copy(this.bodyColor);

    this.flash.step(dt);
    this.squash.step(dt);
    this.applyFlash();
    this.applyGlare();
    this.syncTransform();
    return start;
  }

  /** GD §6.2a "you missed" glare: eyebrows +10°, pupils 70% for 0.5 s. */
  glare(): void {
    this.glareLeft = CONFIG.tactics.glareDuration;
    this.applyGlare();
  }

  get glaring(): boolean {
    return this.glareLeft > 0;
  }

  private applyGlare(): void {
    const on = this.glareLeft > 0;
    const tilt = B.model.eyebrow.tilt + (on ? CONFIG.tactics.glareBrowTilt : 0);
    const ps = on ? CONFIG.tactics.glarePupilScale : 1;
    for (let i = 0; i < this.brows.length; i++) {
      const sx = i === 0 ? -1 : 1;
      this.brows[i].rotation.z = sx * tilt;
      this.pupils[i].scale.set(ps, ps, 1);
    }
  }

  /** White hit flash wins over the red Charge pulse. */
  private applyFlash(): void {
    if (this.flash.active) {
      this.bodyMat.emissive.setRGB(1, 1, 1);
    } else {
      const w = this.pulse * CONFIG.charge.pulseIntensity;
      this.bodyMat.emissive.setRGB(this.pulseColor.r * w, this.pulseColor.g * w, this.pulseColor.b * w);
    }
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
    // The anti-camping tell doubles the bob (GD §6.2a).
    const amp = this.brain.annoyed ? CONFIG.tactics.annoyedBobAmplitude : B.bobAmplitude;
    const bob = amp * Math.sin(2 * Math.PI * B.bobFrequency * this.time);
    const shake = this.brain.mode === 'rageTransition' ? RG.shakeAmplitude : this.shake;
    let sx = 0;
    let sz = 0;
    if (shake > 0) {
      sx = (this.rng() * 2 - 1) * shake;
      sz = (this.rng() * 2 - 1) * shake;
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
