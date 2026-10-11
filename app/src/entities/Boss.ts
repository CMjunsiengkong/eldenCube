/**
 * The Elden Cube (GAME_DESIGN §6).
 *
 * - `BossBrain` is the pure core: HP (20, damage per hit), phase, mode, the cooldown that starts
 *   when the boss is free, attack selection and the Royal Rebuke triggers (poise, close, window).
 *   The hit that starts rage cancels the running attack and every hazard in the same step.
 * - `Boss` is the view and motion: the gelatinous model (1.5b), idle bob, turning, chase, attack
 *   poses through the slime springs (squash/stretch, lean), crown glow / wobble, hit reaction
 *   visuals, rage visuals, break-apart on defeat.
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import type { Vec3Like } from '../systems/collision';
import { createPiece, randomSpin, type DebrisPiece } from '../fx/debris';
import { Fade, Squash, Timer } from '../fx/effects';
import { addRim, mergePainted, paint, type RimHandle } from '../fx/materials';
import { SlimeBody } from '../fx/slime';
import { randRange, turnToward } from '../util/math';
import type { Rng } from '../util/rng';
import { cooldownFor, getFlags, speedMult, type BossPhase, type Flags } from '../flags';
import { ATTACK_IDS, type AttackBoss, type AttackId, type BossBox } from '../attacks/Attack';

const B = CONFIG.boss;
const RG = CONFIG.rage;
const RB = CONFIG.rebuke;
const WHITE = new Color(0xffffff);
const EPS = 1e-9;

export type BossMode = 'grace' | 'cooldown' | 'attacking' | 'rageTransition' | 'gloat' | 'defeated';
export type HitResult = 'hit' | 'rage' | 'defeated' | 'ignored';
export type RebukeReason = 'poise' | 'close' | 'window' | 'debug';

/**
 * GD §6.5 selection rule (pure). `history` is oldest → newest.
 * - Charge only when the player is farther than 6 m; Crown Rain only when no rain shard is alive.
 * - The attack used for the last `noRepeat` attacks in a row is blocked, unless nothing else is valid.
 */
export function chooseAttack(history: readonly AttackId[], distance: number, rainAlive: boolean, rng: Rng): AttackId {
  const n = history.length;
  let blocked: AttackId | null = null;
  if (n >= B.noRepeat) {
    blocked = history[n - 1];
    for (let i = 2; i <= B.noRepeat; i++) if (history[n - i] !== blocked) blocked = null;
  }
  const valid: AttackId[] = [];
  const collect = (block: AttackId | null): void => {
    valid.length = 0;
    for (const id of ATTACK_IDS) {
      if (id === block) continue;
      if (id === 'charge' && distance <= CONFIG.charge.minDistance) continue;
      if (id === 'rain' && rainAlive) continue;
      valid.push(id);
    }
  };
  collect(blocked);
  if (valid.length === 0) collect(null);
  return valid[Math.min(valid.length - 1, Math.floor(rng() * valid.length))];
}

/** GD §6.2a close timer (pure): +dt while closer than 5 m and waiting, −2·dt otherwise, never below 0. */
export function updateCloseTimer(timer: number, distance: number, waiting: boolean, dt: number): number {
  return waiting && distance < RB.closeDistance ? timer + dt : Math.max(0, timer - RB.closeDecayMult * dt);
}

/** GD §6.2a poise (pure): damage outside punish windows adds up; at 3 it triggers a Rebuke and resets. */
export function addPoise(poise: number, damage: number, inWindow: boolean): { poise: number; trigger: boolean } {
  if (inWindow) return { poise, trigger: false };
  const p = poise + damage;
  return p >= RB.poiseTrigger - EPS ? { poise: 0, trigger: true } : { poise: p, trigger: false };
}

/** What the brain starts: one of the random attacks, or the Royal Rebuke. */
export type BossMove = AttackId | 'rebuke';

/** Pure boss core: HP, phase, mode, cooldown scheduler and the Rebuke triggers. */
export class BossBrain {
  hp: number = B.hp;
  phase: BossPhase = 'p1';
  mode: BossMode = 'grace';
  /** Seconds until the next attack starts (grace or cooldown). */
  cooldownLeft: number = B.grace;
  /** Random attacks used so far, oldest first (the Rebuke is not recorded). */
  readonly history: AttackId[] = [];
  closeTimer = 0;
  poise = 0;
  /** A Rebuke to perform as soon as the boss is free (and why). */
  pendingRebuke: RebukeReason | null = null;
  /** The reason of the last Rebuke started (debug text). */
  lastRebuke: RebukeReason | null = null;
  /** Debug keys 1/2/3 override the next random choice. */
  forceNext: AttackId | null = null;
  /** The running move (while mode === 'attacking'). */
  current: BossMove | null = null;
  /** Time spent in the rage transition (s). */
  rageT = 0;
  /** Set by takeHit when the running attack and all hazards must go (rage, defeat); see consumeCancel(). */
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
    this.mode = 'grace';
    this.cooldownLeft = B.grace;
    this.history.length = 0;
    this.closeTimer = 0;
    this.poise = 0;
    this.pendingRebuke = null;
    this.lastRebuke = null;
    this.forceNext = null;
    this.current = null;
    this.rageT = 0;
    this.cancelRequested = false;
  }

  /** Waiting for the next attack (grace or cooldown): chase, close timer and tells apply. */
  get waiting(): boolean {
    return this.mode === 'grace' || this.mode === 'cooldown';
  }

  /** The close-timer tell is showing (doubled bounce). */
  get annoyed(): boolean {
    return this.waiting && this.closeTimer >= RB.annoyedAt - EPS;
  }

  canTakeDamage(): boolean {
    return this.mode !== 'defeated' && this.mode !== 'rageTransition' && this.mode !== 'gloat';
  }

  /**
   * A weapon hit of `damage` (GD §5, §6.2a, §6.4). `inWindow`: the boss is in a punish window, so
   * the damage does not count toward poise. The hit that brings HP to ≤ 8 starts rage and requests
   * cancelling the attack and every hazard in the same step; no other hit interrupts an attack.
   */
  takeHit(damage: number, inWindow = false): HitResult {
    if (!this.canTakeDamage()) return 'ignored';
    this.hp = Math.max(0, this.hp - damage);
    if (this.hp <= 0) {
      this.mode = 'defeated';
      this.current = null;
      this.pendingRebuke = null;
      this.cancelRequested = true;
      return 'defeated';
    }
    if (this.phase === 'p1' && this.hp <= RG.hpThreshold) {
      this.phase = 'rage';
      this.mode = 'rageTransition';
      this.current = null;
      this.rageT = 0;
      this.poise = 0;
      this.closeTimer = 0;
      this.pendingRebuke = null;
      this.cancelRequested = true;
      return 'rage';
    }
    const p = addPoise(this.poise, damage, inWindow);
    this.poise = p.poise;
    if (p.trigger && !this.pendingRebuke) this.pendingRebuke = 'poise';
    return 'hit';
  }

  /** True once if the running attack and the hazards must be removed now. */
  consumeCancel(): boolean {
    const c = this.cancelRequested;
    this.cancelRequested = false;
    return c;
  }

  /** Requests a Rebuke (Slam window end, debug key 4). */
  requestRebuke(reason: RebukeReason): void {
    if (this.mode === 'gloat' || this.mode === 'defeated' || this.mode === 'rageTransition') return;
    if (!this.pendingRebuke) this.pendingRebuke = reason;
  }

  /** Starts a move now (used by `update`, and by tests). */
  beginAttack(id: BossMove): void {
    if (id !== 'rebuke') {
      this.history.push(id);
      if (this.history.length > 8) this.history.shift();
    }
    this.current = id;
    this.mode = 'attacking';
  }

  /** The running move's boss animation has ended (hazards may still fly): the cooldown starts. */
  attackFree(): void {
    if (this.mode !== 'attacking') return;
    this.current = null;
    this.startCooldown();
  }

  /** Player died (DYING): stop attacking and gloat. */
  gloat(): void {
    if (this.mode === 'defeated') return;
    this.cancelRequested = false;
    this.current = null;
    this.pendingRebuke = null;
    this.mode = 'gloat';
  }

  /**
   * One fixed step during FIGHT. `distance` is the horizontal player distance to the boss center.
   * Returns the move to start now, or null.
   */
  update(dt: number, distance: number, rainAlive: boolean): BossMove | null {
    if (this.mode === 'gloat' || this.mode === 'defeated') return null;
    this.closeTimer = updateCloseTimer(this.closeTimer, distance, this.waiting, dt);

    if (this.mode === 'rageTransition') {
      this.rageT += dt;
      // D10: a fresh rage cooldown starts when the transition ends.
      if (this.rageT >= RG.transitionDuration - EPS) this.startCooldown();
      return null;
    }
    if (!this.waiting) return null;

    if (this.closeTimer >= RB.closeTrigger - EPS) {
      this.closeTimer = 0;
      if (!this.pendingRebuke) this.pendingRebuke = 'close';
    }
    if (this.pendingRebuke) {
      this.lastRebuke = this.pendingRebuke;
      this.pendingRebuke = null;
      this.poise = 0;
      this.beginAttack('rebuke');
      return 'rebuke';
    }

    this.cooldownLeft -= dt;
    if (this.cooldownLeft > EPS) return null;
    let id: AttackId;
    if (this.forceNext) {
      id = this.forceNext;
      this.forceNext = null;
    } else {
      id = chooseAttack(this.history, distance, rainAlive, this.rng);
    }
    this.beginAttack(id);
    return id;
  }

  private startCooldown(): void {
    this.mode = 'cooldown';
    this.cooldownLeft = cooldownFor(this.phase, this.flags);
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
  /** No turning (Slam punish window, Charge recovery). */
  stuck = false;
  /** Attack pose: body squash (1 = none) and crown effects. */
  readonly attackSquash = { x: 1, y: 1, z: 1 };
  /** White crown glow 0…1 (Rebuke tell, Rain cast). */
  crownGlow = 0;
  /** Crown tilt (rad) around the forward axis (Slam window wobble). */
  crownTilt = 0;

  /** Squashed / sheared / bobbing / shaking part (pivot at the ground); its matrix is set by hand. */
  private readonly visual = new Group();
  private readonly crown = new Group();
  private readonly bodyMat: MeshStandardMaterial;
  private readonly bodyRim: RimHandle;
  private readonly crownMat: MeshStandardMaterial;
  private readonly bodyColor = new Color(CONFIG.colors.bossPhase1);
  private readonly phase1Color = new Color(CONFIG.colors.bossPhase1);
  private readonly rageColor = new Color(CONFIG.colors.bossRage);
  private readonly crownGold = new Color(CONFIG.colors.crown);

  private readonly flash = new Timer();
  private readonly squash = new Squash();
  private readonly slime = new SlimeBody();
  private readonly rageFade = new Fade();
  private readonly scaleTmp = { x: 1, y: 1, z: 1 };
  private readonly box: { center: Vector3; halfSize: number; yaw: number } = { center: new Vector3(), halfSize: B.halfSize, yaw: 0 };
  private readonly pulseColor = new Color(CONFIG.colors.warning);
  private readonly flags: Flags;
  private readonly pieceGeo = new RoundedBoxGeometry(B.defeat.pieceSize, B.defeat.pieceSize, B.defeat.pieceSize, 3, B.defeat.pieceCornerRadius);
  private readonly rng: Rng;
  private time = 0;
  private broken = false;
  /** The cloned body material of the last break-apart (disposed on reset). */
  private debrisMat: MeshStandardMaterial | null = null;

  constructor(rng: Rng, flags: Flags = getFlags()) {
    this.rng = rng;
    this.flags = flags;
    this.brain = new BossBrain(rng, flags);
    const M = B.model;
    const C = CONFIG.colors;
    this.root.add(this.visual);
    this.visual.matrixAutoUpdate = false;

    // Gel body: a rounded cube with the shared rim light in a lighter tint of the body color.
    this.bodyMat = new MeshStandardMaterial({ color: C.bossPhase1, roughness: M.bodyRoughness });
    this.bodyRim = addRim(this.bodyMat, this.bodyColor.clone().lerp(WHITE, CONFIG.rim.bossTint), CONFIG.rim.bossStrength);
    const body = new Mesh(new RoundedBoxGeometry(M.bodySize, M.bodySize, M.bodySize, M.bodySegments, M.bodyCornerRadius), this.bodyMat);
    body.position.y = M.bodyCenterY;
    this.addShadowed(body, this.visual);

    // Face (+Z local looks at the player): eyes, pupils and angry brows merged into one mesh.
    const r = M.faceCornerRadius;
    const faceParts: BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const e = M.eye;
      faceParts.push(paint(new RoundedBoxGeometry(e.size.x, e.size.y, e.size.z, 2, r).translate(sx * e.position.x, e.position.y, e.position.z), C.eyes));
      const pu = M.pupil;
      faceParts.push(paint(new RoundedBoxGeometry(pu.size.x, pu.size.y, pu.size.z, 2, r).translate(sx * pu.position.x, pu.position.y, pu.position.z), C.pupils));
      const b = M.eyebrow;
      const brow = new RoundedBoxGeometry(b.size.x, b.size.y, b.size.z, 2, r);
      brow.rotateZ(sx * b.tilt); // inner end lower: angry
      faceParts.push(paint(brow.translate(sx * b.position.x, b.position.y, b.position.z), C.pupils));
    }
    const faceMat = new MeshStandardMaterial({ vertexColors: true, roughness: M.roughness });
    this.addShadowed(new Mesh(mergePainted(faceParts), faceMat), this.visual);

    // Crown: 5-sided band with a cone on each corner, merged into one mesh.
    const cb = M.crownBand;
    this.crownMat = new MeshStandardMaterial({ color: C.crown, metalness: cb.metalness, roughness: cb.roughness });
    const crownParts: BufferGeometry[] = [new CylinderGeometry(cb.radius, cb.radius, cb.height, cb.sides).translate(0, cb.y, 0)];
    const cp = M.crownPoint;
    for (let i = 0; i < cp.count; i++) {
      const a = (i / cp.count) * Math.PI * 2; // CylinderGeometry corners are at sin/cos of k·72°
      crownParts.push(new ConeGeometry(cp.radius, cp.height, cp.segments).translate(Math.sin(a) * cb.radius, cp.y, Math.cos(a) * cb.radius));
    }
    const crownGeo = mergeGeometries(crownParts.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (!crownGeo) throw new Error('crown geometry merge failed');
    this.addShadowed(new Mesh(crownGeo, this.crownMat), this.crown);
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
    this.clearAttackPose();
    this.time = 0;
    this.flash.clear();
    this.squash.clear();
    this.slime.reset();
    this.rageFade.clear();
    this.bodyColor.copy(this.phase1Color);
    this.bodyMat.color.copy(this.phase1Color);
    this.bodyRim.color.copy(this.phase1Color).lerp(WHITE, CONFIG.rim.bossTint);
    this.bodyMat.emissive.setRGB(0, 0, 0);
    this.debrisMat?.dispose();
    this.debrisMat = null;
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
  update(dt: number, target: Vec3Like | null, rainAlive = false): BossMove | null {
    const brain = this.brain;
    const dx = target ? target.x - this.pos.x : 0;
    const dz = target ? target.z - this.pos.z : 0;
    const dist = target ? Math.hypot(dx, dz) : Infinity;
    const start = brain.update(dt, dist, rainAlive);
    this.time += dt;

    if (target && !this.dashing && !this.stuck && brain.mode !== 'defeated' && dist > 1e-3) {
      this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), B.turnRate * dt);
    }
    // Chase between attacks (grace or cooldown) when farther than 5 m, stopping at 5 m.
    if (target && brain.waiting && dist > B.chaseDistance) {
      const step = Math.min(dist - B.chaseDistance, B.chaseSpeed * speedMult(brain.phase, this.flags) * dt);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
      this.clampToArena();
    }

    // Rage transition: color fade (0.5 s) and shake (±0.1 m).
    this.rageFade.step(dt);
    this.bodyColor.copy(this.phase1Color).lerp(this.rageColor, this.rageFade.value);
    this.bodyMat.color.copy(this.bodyColor);
    this.bodyRim.color.copy(this.bodyColor).lerp(WHITE, CONFIG.rim.bossTint);

    this.flash.step(dt);
    this.squash.step(dt);
    this.stepSlime(dt, brain.waiting);
    this.applyFlash();
    this.syncTransform();
    return start;
  }

  /** TITLE: only the idle visuals run (bob, springs); no brain, no turning, no attacks. */
  idle(dt: number): void {
    this.time += dt;
    this.flash.step(dt);
    this.squash.step(dt);
    this.stepSlime(dt, true);
    this.applyFlash();
    this.syncTransform();
  }

  /** Kicks the slime stretch spring (negative = splat down; the Slam impact). */
  splat(velocity: number): void {
    this.slime.kick(velocity);
  }

  /** GD §6.1: the attack pose (× breathing while waiting) is the stretch target. */
  private stepSlime(dt: number, waiting: boolean): void {
    const SL = B.slime;
    const breathe = waiting ? 1 + SL.breatheAmplitude * Math.sin(2 * Math.PI * SL.breatheFrequency * this.time) : 1;
    this.slime.step(dt, this.attackSquash.y * breathe, this.pos.x, this.pos.z, this.yaw);
  }

  /** The boss body is solid for the player while it is on the ground and not dashing (GD §6.2). */
  get solid(): boolean {
    return !this.broken && !this.dashing && this.pos.y < 0.01;
  }

  /** Clears everything an attack may have set (on finish, cancel, reset). */
  clearAttackPose(): void {
    this.dashing = false;
    this.stuck = false;
    this.pulse = 0;
    this.shake = 0;
    this.attackSquash.x = 1;
    this.attackSquash.y = 1;
    this.attackSquash.z = 1;
    this.crownGlow = 0;
    this.crownTilt = 0;
    this.pos.y = 0;
  }

  /** White hit flash wins over the red Charge pulse. */
  private applyFlash(): void {
    if (this.flash.active) {
      this.bodyMat.emissive.setRGB(1, 1, 1);
    } else {
      // A faint gel self-glow in the body color (reads at night), plus the red Charge pulse.
      const w = this.pulse * CONFIG.charge.pulseIntensity;
      const g = B.model.bodyGlow;
      const bc = this.bodyColor;
      this.bodyMat.emissive.setRGB(bc.r * g + this.pulseColor.r * w, bc.g * g + this.pulseColor.g * w, bc.b * g + this.pulseColor.b * w);
    }
    // Faint gold glow at night, plus the white tell glow (Rebuke, Crown Rain).
    const g = B.model.crownGlow;
    this.crownMat.emissive.setRGB(this.crownGold.r * g + this.crownGlow, this.crownGold.g * g + this.crownGlow, this.crownGold.b * g + this.crownGlow);
  }

  /** GD §6.3 hit reaction visuals + knockback (Hit 3: heavier). Hit-stop, shake, sound, HUD: Game. */
  onHit(from: Vec3Like, heavy = false): void {
    this.flash.start(B.hit.flashDuration);
    this.squash.start();
    // Jelly reaction: a small splat and a lean kick away from the player (boss local frame).
    const SL = B.slime;
    this.slime.kick(SL.hitStretchKick * (heavy ? 1.6 : 1));
    {
      const dx = this.pos.x - from.x;
      const dz = this.pos.z - from.z;
      const d = Math.hypot(dx, dz) || 1;
      const c = Math.cos(this.yaw);
      const sn = Math.sin(this.yaw);
      const k = SL.hitLeanKick * (heavy ? 1.6 : 1);
      this.slime.kickLean(((dx * c - dz * sn) / d) * k, ((dx * sn + dz * c) / d) * k);
    }
    // Show the flash and squash immediately, so they are visible during the hit-stop freeze.
    this.applyFlash();
    if (!this.dashing) {
      const dx = this.pos.x - from.x;
      const dz = this.pos.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        const k = heavy ? B.hit.heavy.knockback : B.hit.knockback;
        this.pos.x += (dx / d) * k;
        this.pos.z += (dz / d) * k;
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
    this.debrisMat = mat;
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
    // Idle bob (visual only); the close-timer tell doubles it (GD §6.2a).
    const amp = this.brain.annoyed ? RB.annoyedBobAmplitude : B.bobAmplitude;
    const bob = amp * Math.sin(2 * Math.PI * B.bobFrequency * this.time);
    const shake = this.brain.mode === 'rageTransition' ? RG.shakeAmplitude : this.shake;
    let sx = 0;
    let sz = 0;
    if (shake > 0) {
      sx = (this.rng() * 2 - 1) * shake;
      sz = (this.rng() * 2 - 1) * shake;
    }
    // Visual matrix = translation (bob, shake) × shear (slime lean) × scale (hit squash × slime).
    this.squash.scale(this.scaleTmp);
    const sl = this.slime;
    const kx = this.scaleTmp.x * sl.scaleXZ;
    const ky = this.scaleTmp.y * sl.scaleY;
    const kz = this.scaleTmp.z * sl.scaleXZ;
    const lx = sl.leanX.x;
    const lz = sl.leanZ.x;
    this.visual.matrix.set(kx, lx * ky, 0, sx, 0, ky, 0, bob, 0, lz * ky, kz, sz, 0, 0, 0, 1);
    this.visual.matrixWorldNeedsUpdate = true;
    this.crown.rotation.z = this.crownTilt;
  }

  private addShadowed(m: Mesh, parent: Group): void {
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
  }
}
