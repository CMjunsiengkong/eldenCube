/**
 * Owns everything; the state machine (ARCHITECTURE §4.2).
 *
 * Milestone 1.4b: the 3-hit combo deals damage; the boss runs Slam / Charge / Crown Rain and the
 * Royal Rebuke; hazards live on after the boss is free; the player has 2 HP (stagger on the first
 * hit). Death leads to a minimal DYING placeholder (2.0 s, then an instant reset back into FIGHT).
 * The full state machine (TITLE → … → TO_TITLE), player break-apart, screens and audio arrive in
 * milestone 1.5.
 */
import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { CONFIG } from '../config';
import { getFlags, rebukeTellFor, speedMult, telegraphMult } from '../flags';
import type { LoopTarget, TimeControl } from '../loop';
import { moveDirFromAxis, Player, type MotorInput, type PlayerEvent } from '../entities/Player';
import { Boss, type HitResult } from '../entities/Boss';
import { SILENT, type Attack, type AttackContext, type MoveId } from '../attacks/Attack';
import { CubeSlam } from '../attacks/CubeSlam';
import { RoyalCharge } from '../attacks/RoyalCharge';
import { CrownRain } from '../attacks/CrownRain';
import { RoyalRebuke } from '../attacks/RoyalRebuke';
import { Hazards, WAVES } from '../attacks/Hazards';
import { disposeDebris, stepDebris, type DebrisPiece } from '../fx/debris';
import { Puffs } from '../fx/effects';
import { CameraController } from '../systems/camera';
import { pointInOBB } from '../systems/collision';
import { Input } from '../systems/input';
import { UI } from '../systems/ui';
import { createRng } from '../util/rng';
import { Arena } from './Arena';

export type GameState = 'TITLE' | 'FIGHT' | 'DYING' | 'BOSS_DEFEATED' | 'VICTORY_SCREEN' | 'TO_TITLE';

const CAM = CONFIG.camera;
const B = CONFIG.boss;
const DEATH = CONFIG.fx.death;

/** No-op time control until the loop is attached (tests / construction order). */
const NO_TIME: TimeControl = { hitStop: () => undefined, setTimeScale: () => undefined };

export class Game implements LoopTarget {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly input: Input;
  state: GameState = 'FIGHT';

  private readonly renderer: WebGLRenderer;
  private readonly ui: UI;
  private readonly debug: boolean;
  private readonly rng = createRng(Date.now());
  private readonly cameraCtl: CameraController;
  private readonly player: Player;
  private readonly boss: Boss;
  private readonly debris: DebrisPiece[] = [];
  private readonly puffs: Puffs;
  private readonly hazards: Hazards;
  private readonly attacks: Record<MoveId, Attack>;
  private attack: Attack | null = null;
  private readonly ctx: AttackContext;
  private time: TimeControl = NO_TIME;
  /** Simulation time in BOSS_DEFEATED (from the 5th hit, design §4.1). */
  private defeatT = 0;
  /** Simulation time in DYING (from the hit; starts at the hit-stop length, design §4.1). */
  private dyingT = 0;
  private lastHit: HitResult | null = null;
  private rebukeMarker = 0;
  private hitboxes: DebugHitboxes | null = null;

  private readonly moveDir = { x: 0, z: 0 };
  private readonly camFwd = { x: 0, z: -1 };
  private readonly playerVel = new Vector3();
  private readonly gloatTarget = new Vector3();
  private readonly motorInput: MotorInput = {
    moveX: 0,
    moveZ: 0,
    wantRoll: false,
    wantAttack: false,
    wantFlask: false,
    allowAttack: true,
    bossX: 0,
    bossZ: 0,
    obstacle: null,
  };

  // debug overlay (real time)
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  constructor(renderer: WebGLRenderer, canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.renderer = renderer;
    this.debug = getFlags().debug;

    this.camera = new PerspectiveCamera(CAM.fov, window.innerWidth / window.innerHeight, CAM.near, CAM.far);
    new Arena(this.scene);
    this.input = new Input(canvas, this.debug);
    this.ui = new UI(overlay, this.debug);

    this.boss = new Boss(this.rng);
    this.scene.add(this.boss.root);
    this.player = new Player(this.debug);
    this.scene.add(this.player.root);
    this.puffs = new Puffs(this.scene, this.rng);
    this.hazards = new Hazards(this.scene, this.puffs);
    this.attacks = { slam: new CubeSlam(), charge: new RoyalCharge(), rain: new CrownRain(), rebuke: new RoyalRebuke() };

    this.cameraCtl = new CameraController(this.camera, this.rng);
    this.cameraCtl.snapLockOn(this.player.position, this.boss.pos);
    this.cameraCtl.update(0, this.player.position, this.boss.pos);

    this.ctx = {
      boss: this.boss,
      playerPos: new Vector3(),
      playerVel: this.playerVel,
      scene: this.scene,
      audio: SILENT, // milestone 1.5
      shake: (a, d) => this.cameraCtl.shake(a, d),
      speedMult: 1,
      telegraphMult: 1,
      rebukeTell: rebukeTellFor(),
      rage: false,
      upgrades: CONFIG.rageUpgrades,
      rng: this.rng,
      effects: this.puffs,
      hazards: this.hazards,
    };

    if (this.debug) this.hitboxes = new DebugHitboxes(this.scene);
    this.ui.setHealth(this.boss.brain.hp);
    this.syncPlayerHud();
    this.ui.showHealth(true);
  }

  /** The loop provides hit-stop and time scale (ARCHITECTURE §4.1). */
  setTimeControl(time: TimeControl): void {
    this.time = time;
  }

  /** Fixed simulation step. */
  update(dt: number): void {
    switch (this.state) {
      case 'FIGHT':
        this.debugKeys();
        this.updateFight(dt, true);
        break;
      case 'DYING':
        this.updateDying(dt);
        break;
      case 'BOSS_DEFEATED':
        this.updateFight(dt, false); // free victory lap: move and roll, no swing
        this.defeatT += dt;
        if (this.defeatT >= B.defeat.victoryDelay - 1e-9) this.state = 'VICTORY_SCREEN';
        break;
      case 'VICTORY_SCREEN':
        this.updateFight(dt, false);
        break;
      default:
        break;
    }
    stepDebris(this.debris, dt);
    this.puffs.step(dt);
    this.rebukeMarker = Math.max(0, this.rebukeMarker - dt);
    this.syncPlayerHud();
    this.input.endStep();
  }

  /** Every frame, real time. */
  realUpdate(frameDt: number): void {
    this.cameraCtl.update(frameDt, this.player.position, this.boss.pos);
    if (this.hitboxes) this.hitboxes.sync(this.player, this.boss, this.hazards);
    if (this.debug) this.updateDebug(frameDt);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /**
   * `damage` to the boss through the normal path (combo hit, or the `K` debug key). The hit that
   * starts rage cancels the attack and every hazard with a puff; defeat removes everything.
   */
  applyBossHit(from: Vector3, damage = 1, heavy = false): HitResult {
    const inWindow = this.attack?.inPunishWindow() ?? false;
    const result = this.boss.brain.takeHit(damage, inWindow);
    this.lastHit = result;
    if (result === 'ignored') return result;

    if (this.boss.brain.consumeCancel()) {
      this.cancelAttack();
      this.hazards.clear(result === 'rage');
    }
    this.ui.setHealth(this.boss.brain.hp);

    if (result === 'defeated') {
      this.onBossDefeated();
      return result;
    }
    // GD §6.3 hit reaction (sound `hit` in 1.5); Hit 3 hits harder.
    const H = heavy ? B.hit.heavy : B.hit;
    this.time.hitStop(H.hitStop);
    this.cameraCtl.shake(H.shake.amplitude, H.shake.duration);
    this.boss.onHit(from, heavy);
    if (result === 'rage') {
      // GD §6.4 rage transition (sound `rage` in 1.5).
      this.boss.onRage();
      this.cameraCtl.shake(CONFIG.rage.cameraShake.amplitude, CONFIG.rage.cameraShake.duration);
    }
    return result;
  }

  private updateFight(dt: number, fighting: boolean): void {
    const axis = this.input.moveAxis();
    this.cameraCtl.forwardXZ(this.camFwd);
    moveDirFromAxis(axis.x, axis.z, this.camFwd.x, this.camFwd.z, this.moveDir);

    const broken = this.boss.isBroken;
    const mi = this.motorInput;
    mi.moveX = this.moveDir.x;
    mi.moveZ = this.moveDir.z;
    mi.wantRoll = this.input.consume('roll');
    mi.wantAttack = this.input.consume('swing');
    mi.wantFlask = this.input.consume('flask');
    mi.allowAttack = fighting;
    mi.bossX = this.boss.pos.x;
    mi.bossZ = this.boss.pos.z;
    // The boss body is solid while it is on the ground and not dashing (GD §6.2).
    mi.obstacle = this.boss.solid ? this.boss.getBox() : null;
    this.onPlayerEvents(this.player.update(dt, mi));
    if (broken) return;

    if (fighting) this.checkWeaponHit();
    if (this.state !== 'FIGHT') return; // the final hit just happened

    const start = this.boss.update(dt, this.player.position, this.hazards.rainAlive);
    this.refreshContext();
    if (start) {
      this.attack = this.attacks[start];
      this.attack.start(this.ctx);
      if (start === 'rebuke') this.rebukeMarker = CONFIG.ui.rebukeMarker;
    } else if (this.attack) {
      this.attack.update(dt, this.ctx);
    }
    // The cooldown starts when the boss is free, not when its hazards are gone (GD §6.2).
    if (this.attack && this.attack.isBossFree()) {
      if (this.attack.wantsRebuke()) this.boss.brain.requestRebuke('window');
      this.attack.dispose();
      this.attack = null;
      this.boss.brain.attackFree();
    }
    this.hazards.step(dt);

    if (!this.player.isInvincible()) {
      const spheres = this.player.getHitSpheres();
      const source = this.attack?.checkPlayerHit(spheres) ?? this.hazards.check(spheres);
      if (source) this.onPlayerHit(source);
    }
  }

  /**
   * GD §4.6 / §9: a non-lethal hit staggers the player (hit-stop, shake, HUD pip flash); the
   * second hit kills (placeholder DYING until 1.5: cancel everything, the boss gloats, reset after 2.0 s).
   */
  private onPlayerHit(source: Vector3): void {
    const r = this.player.motor.takeHit(source.x, source.z);
    if (r === 'ignored') return;
    if (r === 'hurt') {
      // `player_hurt` sound in 1.5.
      this.time.hitStop(CONFIG.hurt.hitStop);
      this.cameraCtl.shake(CONFIG.hurt.shake.amplitude, CONFIG.hurt.shake.duration);
      return;
    }
    this.time.hitStop(DEATH.hitStop);
    this.cancelAttack();
    this.hazards.clear(false);
    this.boss.brain.gloat();
    this.gloatTarget.copy(this.player.position);
    this.state = 'DYING';
    this.dyingT = DEATH.hitStop;
  }

  private updateDying(dt: number): void {
    this.dyingT += dt;
    if (this.dyingT >= DEATH.breakAt - 1e-9) this.player.root.visible = false; // placeholder for the break-apart
    this.boss.update(dt, this.gloatTarget);
    if (this.dyingT >= DEATH.duration - 1e-9) {
      this.resetWorld();
      this.state = 'FIGHT';
    }
  }

  private refreshContext(): void {
    const ctx = this.ctx;
    const phase = this.boss.brain.phase;
    (ctx.playerPos as Vector3).copy(this.player.position);
    this.playerVel.set(this.player.motor.vx, 0, this.player.motor.vz);
    ctx.rebukeTell = rebukeTellFor();
    ctx.speedMult = speedMult(phase);
    ctx.telegraphMult = telegraphMult(phase);
    ctx.rage = phase === 'rage';
  }

  private cancelAttack(): void {
    if (!this.attack) return;
    this.attack.dispose();
    this.attack = null;
    this.boss.clearAttackPose();
  }

  /** GD §5: 3 blade points vs the boss box, only in active phases, at most one hit per combo hit. */
  private checkWeaponHit(): void {
    const motor = this.player.motor;
    if (!motor.isAttackActive() || !this.boss.brain.canTakeDamage()) return;
    const box = this.boss.getBox();
    for (const p of this.player.getBladePoints()) {
      if (pointInOBB(p, box.center, box.halfSize, box.yaw)) {
        motor.markAttackHit();
        this.applyBossHit(this.player.position, motor.attackDamage(), motor.comboHit === 2);
        return;
      }
    }
  }

  /** GD §6.6: hit-stop 0.20 s, 8 cubes + crown, shake, 0.5× time scale for 1.0 s. */
  private onBossDefeated(): void {
    const D = B.defeat;
    this.time.hitStop(D.hitStop);
    this.debris.push(...this.boss.breakApart(this.scene));
    this.cameraCtl.shake(D.shake.amplitude, D.shake.duration);
    this.time.setTimeScale(D.timeScale, D.timeScaleDuration);
    this.state = 'BOSS_DEFEATED';
    this.defeatT = D.hitStop;
  }

  /** Sound triggers (GD §10) are wired in 1.5; the HUD reacts to refusals now. */
  private onPlayerEvents(events: readonly PlayerEvent[]): void {
    if (events.includes('staminaRefused')) this.ui.flashStamina();
  }

  private syncPlayerHud(): void {
    const m = this.player.motor;
    this.ui.setPlayerHud(m.hp, m.flasks, m.stamina / CONFIG.stamina.max);
  }

  /** GD §11 debug keys (the Input only raises them under ?debug). */
  private debugKeys(): void {
    const brain = this.boss.brain;
    if (this.input.consume('debug1')) brain.forceNext = 'slam';
    if (this.input.consume('debug2')) brain.forceNext = 'charge';
    if (this.input.consume('debug3')) brain.forceNext = 'rain';
    if (this.input.consume('debug4')) brain.requestRebuke('debug');
    if (this.input.consume('debugG')) this.player.motor.godMode = !this.player.motor.godMode;
    if (this.input.consume('debugK')) this.applyBossHit(this.player.position, 1);
  }

  private updateDebug(frameDt: number): void {
    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime < 1 / CONFIG.ui.debugRefreshHz) return;
    this.fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    const m = this.player.motor;
    const b = this.boss.brain;
    const info = this.renderer.info.render;
    const atk = this.attack ? `${this.attack.id}:${this.attack.phaseName}` : '-';
    const win = this.attack instanceof CubeSlam && this.attack.windowLeft > 0 ? ` window ${this.attack.windowLeft.toFixed(2)}` : '';
    const act = m.action === 'attack' ? `hit${m.comboHit + 1}:${m.attackPhase}` : m.action;
    this.ui.setDebugText(
      [
        `FPS ${this.fps.toFixed(0)}`,
        `state ${this.state}`,
        `draw calls ${info.calls}`,
        `player ${act} t=${m.actionT.toFixed(2)} chain=${m.chainNext >= 0 ? m.chainNext + 1 : '-'} buf=${m.buffered ?? '-'}${m.godMode ? ' GOD' : ''}`,
        `hp ${m.hp}  stamina ${m.stamina.toFixed(0)}  flasks ${m.flasks}  i-frames ${m.isInvincible() ? 'ON' : 'off'}`,
        `speed ${m.speed().toFixed(2)} m/s  pos ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`,
        `boss hp ${b.hp} ${b.phase} ${b.mode} last=${this.lastHit ?? '-'}`,
        `attack ${atk}${win}  next in ${b.waiting ? b.cooldownLeft.toFixed(2) : '-'}${b.forceNext ? ` forced=${b.forceNext}` : ''}`,
        `poise ${b.poise}  close ${b.closeTimer.toFixed(2)}${b.annoyed ? ' ANNOYED' : ''}${this.rebukeMarker > 0 ? `  REBUKE(${b.lastRebuke})` : ''}`,
      ].join('\n'),
    );
  }

  /** Placeholder reset (milestone 1.5 calls it at full black during TO_TITLE). */
  private resetWorld(): void {
    this.cancelAttack();
    this.hazards.clear(false);
    disposeDebris(this.debris, true);
    this.puffs.clear();
    this.player.reset();
    this.player.root.visible = true;
    this.boss.reset(this.scene);
    this.ui.setHealth(this.boss.brain.hp);
    this.lastHit = null;
    this.rebukeMarker = 0;
    this.syncPlayerHud();
    this.cameraCtl.snapLockOn(this.player.position, this.boss.pos);
  }
}

/** ?debug wireframes (GD §11): player spheres, boss box, blade points, shockwave bands, shard spheres. */
class DebugHitboxes {
  private readonly group = new Group();
  private readonly playerSpheres: Mesh[];
  private readonly bossBox: LineSegments;
  private readonly blade: Mesh[];
  private readonly bandInner: Mesh[];
  private readonly bandOuter: Mesh[];
  private readonly shardSpheres: InstancedMesh;
  private readonly radii: number[] = [];
  private readonly centers: Vector3[] = [];
  private readonly shardPos: Vector3[] = [];
  private readonly m4 = new Matrix4();

  constructor(scene: Scene) {
    const D = CONFIG.ui.debugHitbox;
    const wire = new MeshBasicMaterial({ color: D.playerColor, wireframe: true, depthTest: false });
    const red = new MeshBasicMaterial({ color: D.attackColor, wireframe: true, depthTest: false });
    const P = CONFIG.player;
    this.playerSpheres = P.hitSpheres.map((s) => this.add(new Mesh(new SphereGeometry(s.radius, 10, 6), wire)));
    const box = B.halfSize * 2;
    this.bossBox = new LineSegments(new EdgesGeometry(new BoxGeometry(box, box, box)), new LineBasicMaterial({ color: D.bossColor, depthTest: false }));
    this.group.add(this.bossBox);
    const bladeGeo = new SphereGeometry(D.bladePointRadius, 6, 4);
    this.blade = CONFIG.combo.bladePoints.map(() => this.add(new Mesh(bladeGeo, red)));
    // A unit ring scaled to r ± (half width + player radius).
    const ringGeo = new RingGeometry(1 - D.bandThickness, 1, CONFIG.slam.ringSegments);
    ringGeo.rotateX(-Math.PI / 2);
    this.bandInner = [0, 1, 2].map(() => this.add(new Mesh(ringGeo, red)));
    this.bandOuter = [0, 1, 2].map(() => this.add(new Mesh(ringGeo, red)));
    const max = WAVES * CONFIG.rain.maxPerWave;
    this.shardSpheres = new InstancedMesh(new SphereGeometry(CONFIG.rain.hitRadius, 8, 6), red, max);
    this.shardSpheres.frustumCulled = false;
    this.group.add(this.shardSpheres);
    for (const o of this.group.children) o.renderOrder = 10;
    scene.add(this.group);
  }

  sync(player: Player, boss: Boss, hazards: Hazards): void {
    const spheres = player.getHitSpheres();
    spheres.forEach((s, i) => {
      this.playerSpheres[i].position.copy(s.center);
      this.playerSpheres[i].visible = player.root.visible;
    });
    const box = boss.getBox();
    this.bossBox.position.copy(box.center);
    this.bossBox.rotation.y = box.yaw;
    this.bossBox.visible = !boss.isBroken;
    const pts = player.getBladePoints();
    pts.forEach((p, i) => {
      this.blade[i].position.copy(p);
      this.blade[i].visible = player.root.visible;
    });

    const rings = hazards.liveRings(this.radii, this.centers);
    const half = CONFIG.slam.ringWidth / 2 + CONFIG.player.radius;
    for (let i = 0; i < this.bandInner.length; i++) {
      const on = i < rings.length;
      for (const [m, r] of [
        [this.bandInner[i], on ? rings[i] - half : 1],
        [this.bandOuter[i], on ? rings[i] + half : 1],
      ] as const) {
        m.visible = on;
        if (!on) continue;
        m.position.set(this.centers[i].x, 0.05, this.centers[i].z);
        m.scale.setScalar(Math.max(0.01, r));
      }
    }
    const shards = hazards.flyingShards(this.shardPos);
    for (let i = 0; i < this.shardSpheres.count; i++) {
      if (i < shards.length) this.m4.makeTranslation(shards[i].x, shards[i].y, shards[i].z);
      else this.m4.makeScale(0, 0, 0);
      this.shardSpheres.setMatrixAt(i, this.m4);
    }
    this.shardSpheres.instanceMatrix.needsUpdate = true;
  }

  private add(m: Mesh): Mesh {
    this.group.add(m);
    return m;
  }
}
