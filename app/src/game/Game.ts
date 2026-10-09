/**
 * Owns everything; the state machine (ARCHITECTURE §4.2).
 *
 * Milestone 1.4: the boss schedules and runs its three attacks (with tactics and optional rage
 * upgrades). A player hit leads to a minimal DYING placeholder (2.0 s, then an instant reset back
 * into FIGHT). The full state machine (TITLE → … → TO_TITLE), the player break-apart, screens and
 * audio arrive in milestone 1.5.
 */
import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
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
import { getFlags, speedMult, telegraphMult } from '../flags';
import type { LoopTarget, TimeControl } from '../loop';
import { moveDirFromAxis, Player, type MotorInput, type PlayerEvent } from '../entities/Player';
import { Boss, type HitResult } from '../entities/Boss';
import { SILENT, type Attack, type AttackContext, type AttackId } from '../attacks/Attack';
import { CubeSlam } from '../attacks/CubeSlam';
import { RoyalCharge } from '../attacks/RoyalCharge';
import { CrownShards } from '../attacks/CrownShards';
import { disposeDebris, stepDebris, type DebrisPiece } from '../fx/debris';
import { Puffs } from '../fx/effects';
import { CameraController } from '../systems/camera';
import { horizontalDistance, pointInOBB } from '../systems/collision';
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
  private readonly attacks: Record<AttackId, Attack>;
  private attack: Attack | null = null;
  private readonly ctx: AttackContext;
  private time: TimeControl = NO_TIME;
  /** Simulation time in BOSS_DEFEATED (from the 5th hit, design §4.1). */
  private defeatT = 0;
  /** Simulation time in DYING (from the hit; starts at the hit-stop length, design §4.1). */
  private dyingT = 0;
  private lastHit: HitResult | null = null;
  private punishMarker = 0;
  private hitboxes: DebugHitboxes | null = null;

  private readonly moveDir = { x: 0, z: 0 };
  private readonly camFwd = { x: 0, z: -1 };
  private readonly playerVel = new Vector3();
  private readonly gloatTarget = new Vector3();
  private readonly motorInput: MotorInput = {
    moveX: 0,
    moveZ: 0,
    wantRoll: false,
    wantSwing: false,
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
    this.attacks = { slam: new CubeSlam(), charge: new RoyalCharge(), shards: new CrownShards() };

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
      rage: false,
      upgrades: CONFIG.rageUpgrades,
      rng: this.rng,
      effects: this.puffs,
    };

    if (this.debug) this.hitboxes = new DebugHitboxes(this.scene);
    this.ui.setHealth(this.boss.brain.hp);
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
    this.punishMarker = Math.max(0, this.punishMarker - dt);
    this.input.endStep();
  }

  /** Every frame, real time. */
  realUpdate(frameDt: number): void {
    this.cameraCtl.update(frameDt, this.player.position, this.boss.pos);
    if (this.hitboxes) this.hitboxes.sync(this.player, this.boss, this.attack);
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

  /** One hit to the boss through the normal path (weapon hit or the `K` debug key). */
  applyBossHit(from: Vector3): HitResult {
    const result = this.boss.brain.takeHit();
    this.lastHit = result;
    if (result === 'ignored') return result;

    // D9: the 3rd hit cancels a running attack (with a puff); defeat removes everything (GD §6.6).
    if (this.boss.brain.consumeCancel()) this.cancelAttack(result === 'rage');
    this.ui.setHealth(this.boss.brain.hp);

    if (result === 'defeated') {
      this.onBossDefeated();
      return result;
    }
    // GD §6.3 hit reaction (sound `hit` in 1.5).
    this.time.hitStop(B.hit.hitStop);
    this.cameraCtl.shake(B.hit.shake.amplitude, B.hit.shake.duration);
    this.boss.onHit(from);
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
    mi.wantSwing = fighting && this.input.consume('swing');
    mi.bossX = this.boss.pos.x;
    mi.bossZ = this.boss.pos.z;
    // The boss body is solid only while it is not attacking (design §6).
    mi.obstacle = broken || this.attack ? null : this.boss.getBox();
    this.onPlayerEvents(this.player.update(dt, mi));
    if (broken) return;

    if (fighting) this.checkWeaponHit();
    if (this.state !== 'FIGHT') return; // the 5th hit just happened

    const start = this.boss.update(dt, this.player.position);
    this.refreshContext();
    if (start) {
      this.attack = this.attacks[start];
      this.attack.start(this.ctx);
    } else if (this.attack) {
      this.attack.update(dt, this.ctx);
      if (this.attack.isFinished()) {
        this.attack.dispose();
        this.attack = null;
        this.boss.brain.attackFinished();
      }
    }
    if (this.attack && !this.player.isInvincible()) {
      const source = this.attack.checkPlayerHit(this.player.getHitSpheres());
      if (source) this.onPlayerHit(source);
    }
  }

  /** GD §9 (placeholder until 1.5): hit-stop, cancel the attack, the boss gloats; reset after 2.0 s. */
  private onPlayerHit(source: Vector3): void {
    this.time.hitStop(DEATH.hitStop);
    this.cancelAttack(false);
    this.boss.brain.gloat();
    this.gloatTarget.copy(this.player.position);
    this.state = 'DYING';
    this.dyingT = DEATH.hitStop;
    void source; // the break-apart direction (milestone 1.5)
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
    ctx.speedMult = speedMult(phase);
    ctx.telegraphMult = telegraphMult(phase);
    ctx.rage = phase === 'rage';
  }

  private cancelAttack(puff: boolean): void {
    if (!this.attack) return;
    this.attack.dispose(puff);
    this.attack = null;
  }

  /** GD §5: 3 blade points vs the boss box, only in the active phase, at most one hit per swing. */
  private checkWeaponHit(): void {
    const motor = this.player.motor;
    if (!motor.isSwingActive() || !this.boss.brain.canTakeDamage()) return;
    const box = this.boss.getBox();
    for (const p of this.player.getBladePoints()) {
      if (pointInOBB(p, box.center, box.halfSize, box.yaw)) {
        motor.markSwingHit();
        this.applyBossHit(this.player.position);
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

  /** Sound triggers (GD §10) are wired in 1.5; the missed swing feeds the punish rule now. */
  private onPlayerEvents(events: readonly PlayerEvent[]): void {
    for (const e of events) {
      if (e !== 'swingMiss' || this.state !== 'FIGHT' || this.boss.isBroken) continue;
      const d = horizontalDistance(this.player.position, this.boss.pos);
      if (this.boss.brain.onPlayerMissedSwing(d)) {
        this.boss.glare();
        this.punishMarker = CONFIG.ui.punishMarker;
      }
    }
  }

  /** GD §11 debug keys (the Input only raises them under ?debug). */
  private debugKeys(): void {
    const brain = this.boss.brain;
    if (this.input.consume('debug1')) brain.forceNext = 'slam';
    if (this.input.consume('debug2')) brain.forceNext = 'charge';
    if (this.input.consume('debug3')) brain.forceNext = 'shards';
    if (this.input.consume('debugG')) this.player.motor.godMode = !this.player.motor.godMode;
    if (this.input.consume('debugK')) this.applyBossHit(this.player.position);
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
    this.ui.setDebugText(
      [
        `FPS ${this.fps.toFixed(0)}`,
        `state ${this.state}`,
        `draw calls ${info.calls}`,
        `player ${m.action} t=${m.actionT.toFixed(2)} cd=${m.rollCooldown.toFixed(2)}${m.godMode ? ' GOD' : ''}`,
        `i-frames ${m.isInvincible() ? 'ON' : 'off'}`,
        `speed ${m.speed().toFixed(2)} m/s  pos ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`,
        `boss hp ${b.hp} ${b.phase} ${b.mode} inv=${b.invuln.toFixed(2)} last=${this.lastHit ?? '-'}`,
        `attack ${atk}  next in ${b.waiting ? b.cooldownLeft.toFixed(2) : '-'}${b.forceNext ? ` forced=${b.forceNext}` : ''}`,
        `close ${b.closeTimer.toFixed(2)}${b.annoyed ? ' ANNOYED' : ''}${this.punishMarker > 0 ? '  PUNISH!' : ''}`,
      ].join('\n'),
    );
  }

  /** Placeholder reset (milestone 1.5 calls it at full black during TO_TITLE). */
  private resetWorld(): void {
    this.cancelAttack(false);
    disposeDebris(this.debris, true);
    this.puffs.clear();
    this.player.reset();
    this.player.root.visible = true;
    this.boss.reset(this.scene);
    this.ui.setHealth(this.boss.brain.hp);
    this.lastHit = null;
    this.punishMarker = 0;
    this.cameraCtl.snapLockOn(this.player.position, this.boss.pos);
  }
}

/** ?debug wireframes (GD §11): player spheres, boss box, blade points, shockwave band, shard spheres. */
class DebugHitboxes {
  private readonly group = new Group();
  private readonly playerSpheres: Mesh[];
  private readonly bossBox: LineSegments;
  private readonly blade: Mesh[];
  private readonly bandInner: Mesh[];
  private readonly bandOuter: Mesh[];
  private readonly shardSpheres: Mesh[];
  private readonly radii: number[] = [];
  private readonly shardPos: Vector3[] = [];

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
    this.blade = CONFIG.swing.bladePoints.map(() => this.add(new Mesh(bladeGeo, red)));
    // A unit ring scaled to r ± (half width + player radius).
    const ringGeo = new RingGeometry(1 - D.bandThickness, 1, CONFIG.slam.ringSegments);
    ringGeo.rotateX(-Math.PI / 2);
    this.bandInner = [0, 1].map(() => this.add(new Mesh(ringGeo, red)));
    this.bandOuter = [0, 1].map(() => this.add(new Mesh(ringGeo, red)));
    const shardGeo = new SphereGeometry(CONFIG.shards.hitRadius, 8, 6);
    this.shardSpheres = Array.from({ length: CONFIG.shards.count }, () => this.add(new Mesh(shardGeo, red)));
    for (const o of this.group.children) o.renderOrder = 10;
    scene.add(this.group);
  }

  sync(player: Player, boss: Boss, attack: Attack | null): void {
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

    const rings = attack instanceof CubeSlam ? attack.liveRings(this.radii) : ((this.radii.length = 0), this.radii);
    const half = CONFIG.slam.ringWidth / 2 + CONFIG.player.radius;
    for (let i = 0; i < 2; i++) {
      const on = i < rings.length;
      for (const [m, r] of [
        [this.bandInner[i], on ? rings[i] - half : 1],
        [this.bandOuter[i], on ? rings[i] + half : 1],
      ] as const) {
        m.visible = on;
        if (!on) continue;
        const c = (attack as CubeSlam).ringCenter;
        m.position.set(c.x, 0.05, c.z);
        m.scale.setScalar(Math.max(0.01, r));
      }
    }
    const shards = attack instanceof CrownShards ? attack.flyingShards(this.shardPos) : ((this.shardPos.length = 0), this.shardPos);
    this.shardSpheres.forEach((m, i) => {
      m.visible = i < shards.length;
      if (m.visible) m.position.copy(shards[i]);
    });
  }

  private add(m: Mesh): Mesh {
    this.group.add(m);
    return m;
  }
}
