/**
 * Owns everything; the state machine (ARCHITECTURE §4.2).
 *
 * - `FlowMachine` (pure, unit tested) owns the state, its sim / real timers, the input locks and
 *   the fade, and emits commands that `Game` executes.
 * - `Game` orchestrates the world: the fight (combo, boss, attacks, hazards), the player's death
 *   and break-apart, the boss defeat, audio triggers, screens and the return transition.
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
import type { GameClock, LoopTarget } from '../loop';
import { moveDirFromAxis, Player, type MotorInput, type PlayerEvent } from '../entities/Player';
import { Boss, type HitResult } from '../entities/Boss';
import type { Attack, AttackContext, MoveId } from '../attacks/Attack';
import { CubeSlam } from '../attacks/CubeSlam';
import { RoyalCharge } from '../attacks/RoyalCharge';
import { CrownRain } from '../attacks/CrownRain';
import { RoyalRebuke } from '../attacks/RoyalRebuke';
import { Hazards, WAVES } from '../attacks/Hazards';
import { debrisCenter, stepDebris, type DebrisPiece } from '../fx/debris';
import { Puffs } from '../fx/effects';
import { Audio } from '../systems/audio';
import { CameraController } from '../systems/camera';
import { pointInOBB } from '../systems/collision';
import { Input } from '../systems/input';
import { UI } from '../systems/ui';
import { easeInOut, lerp } from '../util/math';
import { createRng } from '../util/rng';
import { Arena } from './Arena';

export type GameState = 'TITLE' | 'FIGHT' | 'DYING' | 'BOSS_DEFEATED' | 'VICTORY_SCREEN' | 'TO_TITLE';

export type FlowCommand =
  | 'startFight' // TITLE → FIGHT (attempt counter already increased)
  | 'breakPlayer' // DYING @0.10
  | 'showYouDied' // DYING @0.60
  | 'showVictory' // BOSS_DEFEATED → VICTORY_SCREEN @1.50
  | 'continueReady' // the victory input lock ended
  | 'beginToTitle' // the return transition starts (fade-out)
  | 'reset' // full black: reset the world exactly once
  | 'titleReady'; // the title input lock ended: show the start prompt

const T = CONFIG.transitions;
const DEATH = CONFIG.fx.death;
const EPS = 1e-9;

/**
 * Pure game flow (GD §1, §9; design §4.1). Gameplay timers (dying, defeat delay) count simulation
 * time in `update`; input locks, the victory auto-return and the fades count real time in
 * `realUpdate`. Commands accumulate in `commands`; the owner processes and clears them.
 */
export class FlowMachine {
  state: GameState = 'TITLE';
  /** Valid only in FIGHT (window blur / hidden tab). */
  paused = false;
  /** Black fade layer opacity 0…1. */
  fade = 0;
  /** Audio duck factor: 1 normal, 0.3 during the fade. */
  duck = 1;
  attempts = 0;
  titleUnlocked = false;
  continueUnlocked = false;
  /** TO_TITLE: the world has been reset (fade-in phase). */
  resetDone = false;
  readonly commands: FlowCommand[] = [];

  private simT = 0;
  private realT = 0;
  private broke = false;
  private youDied = false;

  constructor() {
    this.enterTitle();
  }

  /** Simulation step (not called while paused or during hit-stop). */
  update(dt: number): void {
    if (this.state === 'DYING') {
      this.simT += dt;
      if (!this.broke && this.simT >= DEATH.breakAt - EPS) {
        this.broke = true;
        this.commands.push('breakPlayer');
      }
      if (!this.youDied && this.simT >= DEATH.youDiedAt - EPS) {
        this.youDied = true;
        this.commands.push('showYouDied');
      }
      if (this.simT >= DEATH.duration - EPS) this.beginToTitle();
    } else if (this.state === 'BOSS_DEFEATED') {
      this.simT += dt;
      if (this.simT >= CONFIG.boss.defeat.victoryDelay - EPS) {
        this.state = 'VICTORY_SCREEN';
        this.realT = 0;
        this.continueUnlocked = false;
        this.commands.push('showVictory');
      }
    }
  }

  /** Every frame, real time. `anyStart`: any key except M, or a click, this frame. */
  realUpdate(dt: number, anyStart: boolean): void {
    switch (this.state) {
      case 'TITLE':
        this.realT += dt;
        if (!this.titleUnlocked && this.realT >= T.titleInputLock - EPS) {
          this.titleUnlocked = true;
          this.commands.push('titleReady');
        }
        if (this.titleUnlocked && anyStart) {
          this.state = 'FIGHT';
          this.paused = false;
          this.attempts++;
          this.commands.push('startFight');
        }
        break;
      case 'VICTORY_SCREEN':
        this.realT += dt;
        if (!this.continueUnlocked && this.realT >= T.victoryInputLock - EPS) {
          this.continueUnlocked = true;
          this.commands.push('continueReady');
        }
        if ((this.continueUnlocked && anyStart) || this.realT >= T.victoryIdleReturn - EPS) this.beginToTitle();
        break;
      case 'TO_TITLE': {
        this.realT += dt;
        if (!this.resetDone) {
          const u = Math.min(1, this.realT / T.fadeOut);
          this.fade = easeInOut(u);
          if (u >= 1) {
            this.fade = 1;
            this.resetDone = true;
            this.realT = 0;
            this.commands.push('reset');
          }
        } else {
          const u = Math.min(1, this.realT / T.fadeIn);
          this.fade = 1 - easeInOut(u);
          if (u >= 1) {
            this.fade = 0;
            this.enterTitle();
          }
        }
        this.duck = lerp(1, T.audioDuck, this.fade);
        break;
      }
      default:
        break;
    }
  }

  /** The player's HP reached 0 (hit-stop counted inside the timer, design §4.1). */
  playerDied(hitStop: number): void {
    if (this.state !== 'FIGHT') return;
    this.state = 'DYING';
    this.simT = hitStop;
    this.broke = false;
    this.youDied = false;
  }

  /** The boss's HP reached 0. */
  bossDefeated(hitStop: number): void {
    if (this.state !== 'FIGHT') return;
    this.state = 'BOSS_DEFEATED';
    this.simT = hitStop;
  }

  /** Window blur / hidden tab: pause, only during FIGHT. */
  pause(): boolean {
    if (this.state !== 'FIGHT') return false;
    this.paused = true;
    return true;
  }

  resume(): void {
    this.paused = false;
  }

  private beginToTitle(): void {
    this.state = 'TO_TITLE';
    this.realT = 0;
    this.resetDone = false;
    this.paused = false;
    this.commands.push('beginToTitle');
  }

  private enterTitle(): void {
    this.state = 'TITLE';
    this.realT = 0;
    this.titleUnlocked = false;
    this.fade = 0;
    this.duck = 1;
  }
}

const CAM = CONFIG.camera;
const B = CONFIG.boss;

/** No-op clock until the loop is attached (construction order). */
const NO_CLOCK: GameClock = { paused: false, hitStop: () => undefined, setTimeScale: () => undefined, resetTiming: () => undefined };

/** Which world simulation runs (TO_TITLE keeps the previous one until the reset). */
type World = 'title' | 'fight' | 'dying' | 'lap';

export class Game implements LoopTarget {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly input: Input;
  readonly flow = new FlowMachine();

  private readonly renderer: WebGLRenderer;
  private readonly ui: UI;
  private readonly audio = new Audio();
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
  private time: GameClock = NO_CLOCK;
  private world: World = 'title';
  private lastHit: HitResult | null = null;
  private rebukeMarker = 0;
  private hitboxes: DebugHitboxes | null = null;

  private readonly moveDir = { x: 0, z: 0 };
  private readonly camFwd = { x: 0, z: -1 };
  private readonly playerVel = new Vector3();
  private readonly gloatTarget = new Vector3();
  private readonly deathSource = new Vector3();
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
    this.input.onGesture = () => this.audio.unlock();
    this.input.onFocusLost = () => this.onFocusLost();
    this.ui = new UI(overlay, this.debug);

    this.boss = new Boss(this.rng);
    this.scene.add(this.boss.root);
    this.player = new Player(this.debug);
    this.scene.add(this.player.root);
    this.puffs = new Puffs(this.scene, this.rng);
    this.hazards = new Hazards(this.scene, this.puffs);
    this.hazards.sound = this.audio;
    this.attacks = { slam: new CubeSlam(), charge: new RoyalCharge(), rain: new CrownRain(), rebuke: new RoyalRebuke() };

    this.cameraCtl = new CameraController(this.camera, this.rng);
    this.cameraCtl.setOrbit();

    this.ctx = {
      boss: this.boss,
      playerPos: new Vector3(),
      playerVel: this.playerVel,
      scene: this.scene,
      audio: this.audio,
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
    this.ui.setSound(!this.audio.muted);
    this.ui.setScreen('title');
  }

  /** Legacy name used by the 1.4 debug scripts. */
  get state(): GameState {
    return this.flow.state;
  }

  /** The loop provides hit-stop, time scale, pause and a timing reset (ARCHITECTURE §4.1). */
  setTimeControl(time: GameClock): void {
    this.time = time;
  }

  /** Fixed simulation step. */
  update(dt: number): void {
    this.flow.update(dt);
    this.processCommands();
    switch (this.world) {
      case 'title':
        this.boss.idle(dt);
        break;
      case 'fight':
        if (this.flow.state === 'FIGHT') {
          this.debugKeys();
          this.updateFight(dt, true);
        }
        break;
      case 'dying':
        this.updateDying(dt);
        break;
      case 'lap':
        this.updateFight(dt, false); // free victory lap: move and roll, no attack, no flask
        break;
    }
    stepDebris(this.debris, dt);
    this.puffs.step(dt);
    this.rebukeMarker = Math.max(0, this.rebukeMarker - dt);
    this.syncPlayerHud();
    this.input.endStep();
  }

  /** Every frame, real time (also while paused and during hit-stop). */
  realUpdate(frameDt: number): void {
    if (this.input.consume('mute')) this.ui.setSound(!this.audio.toggleMute());

    if (this.flow.paused) {
      if (this.input.consume('resumeClick')) this.resume();
      if (this.debug) this.updateDebug(frameDt);
      return;
    }
    this.input.consume('resumeClick');

    const s = this.flow.state;
    const anyStart = (s === 'TITLE' || s === 'VICTORY_SCREEN') && this.input.consume('anyStart');
    this.flow.realUpdate(frameDt, anyStart);
    this.processCommands();
    this.ui.setFade(this.flow.fade);
    this.audio.setDuck(this.flow.duck);

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
    // GD §6.3 hit reaction; Hit 3 hits harder.
    const H = heavy ? B.hit.heavy : B.hit;
    this.time.hitStop(H.hitStop);
    this.cameraCtl.shake(H.shake.amplitude, H.shake.duration);
    this.boss.onHit(from, heavy);
    this.audio.play('hit', { pitch: heavy ? 0.85 : 1 });
    if (result === 'rage') {
      // GD §6.4 rage transition.
      this.boss.onRage();
      this.cameraCtl.shake(CONFIG.rage.cameraShake.amplitude, CONFIG.rage.cameraShake.duration);
      this.audio.play('rage');
    }
    return result;
  }

  // --- flow commands ------------------------------------------------------------------------------

  private processCommands(): void {
    const cmds = this.flow.commands;
    for (let i = 0; i < cmds.length; i++) {
      switch (cmds[i]) {
        case 'startFight':
          this.onStartFight();
          break;
        case 'breakPlayer':
          this.debris.push(...this.player.breakApart(this.deathSource, this.scene, this.rng));
          this.audio.play('player_break');
          break;
        case 'showYouDied':
          this.ui.showResult('died');
          this.audio.play('you_died');
          break;
        case 'showVictory':
          this.ui.setScreen('victory');
          this.audio.play('victory');
          break;
        case 'continueReady':
          this.ui.showContinuePrompt(true);
          break;
        case 'beginToTitle':
          break;
        case 'reset':
          this.reset();
          break;
        case 'titleReady':
          this.ui.showStartPrompt(true);
          break;
      }
    }
    cmds.length = 0;
  }

  /** TITLE → FIGHT (GD §1): overlay and HUD fades (CSS), camera blend, grace starts now. */
  private onStartFight(): void {
    // The starting key / click never attacks, rolls or drinks (D2).
    this.input.consume('swing');
    this.input.consume('roll');
    this.input.consume('flask');
    this.ui.setAttempts(this.flow.attempts);
    this.ui.setScreen('fight');
    this.cameraCtl.blendToLockOn(T.cameraBlend, this.player.position, this.boss.pos);
    this.boss.brain.reset();
    this.world = 'fight';
  }

  /** GD §1 reset at full black: everything back to spawn, title orbit and overlay. Never reloads. */
  private reset(): void {
    this.cancelAttack();
    this.hazards.clear(false);
    for (const p of this.debris) p.object.removeFromParent();
    this.debris.length = 0;
    this.puffs.clear();
    this.player.reset();
    this.boss.reset(this.scene);
    this.time.resetTiming();
    this.ui.setHealth(this.boss.brain.hp);
    this.lastHit = null;
    this.rebukeMarker = 0;
    this.syncPlayerHud();
    this.cameraCtl.setOrbit();
    this.ui.setScreen('title');
    this.world = 'title';
  }

  private onFocusLost(): void {
    if (!this.flow.pause()) return;
    this.time.paused = true;
    this.ui.setPaused(true);
  }

  /** The click that resumes never attacks (D2): every pending edge is dropped. */
  private resume(): void {
    this.flow.resume();
    this.time.paused = false;
    this.input.clearAll();
    this.ui.setPaused(false);
  }

  // --- fight --------------------------------------------------------------------------------------

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
    if (this.flow.state !== 'FIGHT') return; // the final hit just happened

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

  /** GD §4.6 / §9: the first hit staggers the player; the second one kills (DYING). */
  private onPlayerHit(source: Vector3): void {
    const r = this.player.motor.takeHit(source.x, source.z);
    if (r === 'ignored') return;
    if (r === 'hurt') {
      this.time.hitStop(CONFIG.hurt.hitStop);
      this.cameraCtl.shake(CONFIG.hurt.shake.amplitude, CONFIG.hurt.shake.duration);
      this.audio.play('player_hurt');
      return;
    }
    // Death @0.00: hit-stop, all hazards removed, long sounds stopped (attack.dispose), boss gloats.
    this.time.hitStop(DEATH.hitStop);
    this.cancelAttack();
    this.hazards.clear(false);
    this.boss.brain.gloat();
    this.deathSource.copy(source);
    this.gloatTarget.copy(this.player.position);
    this.flow.playerDied(DEATH.hitStop);
    this.ui.setScreen('dying');
    this.world = 'dying';
  }

  /** GD §9: the boss stops and turns to face the remains; the camera looks at them. */
  private updateDying(dt: number): void {
    if (this.player.isBroken) {
      debrisCenter(this.debris, this.gloatTarget);
      this.cameraCtl.setLookOverride(this.gloatTarget);
    }
    this.boss.update(dt, this.gloatTarget);
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

  /** GD §6.6: hit-stop 0.20 s, 8 cubes + crown, shake, 0.5× time scale for 1.0 s, `boss_break`. */
  private onBossDefeated(): void {
    const D = B.defeat;
    this.time.hitStop(D.hitStop);
    this.debris.push(...this.boss.breakApart(this.scene));
    this.cameraCtl.shake(D.shake.amplitude, D.shake.duration);
    this.time.setTimeScale(D.timeScale, D.timeScaleDuration);
    this.audio.play('boss_break');
    this.flow.bossDefeated(D.hitStop);
    this.ui.setScreen('defeated');
    this.world = 'lap';
  }

  /** GD §10 sound triggers from the player, and the stamina refusal flash. */
  private onPlayerEvents(events: readonly PlayerEvent[]): void {
    const m = this.player.motor;
    for (const e of events) {
      switch (e) {
        case 'rollStart':
          this.audio.play('roll');
          break;
        case 'rollEnd':
          this.audio.play('roll_end');
          break;
        case 'footstep':
          this.audio.play('footstep');
          break;
        case 'attackActive':
          this.audio.play('swing', { pitch: CONFIG.combo.hits[m.comboHit].pitch });
          break;
        case 'attackMiss':
          this.audio.play('swing_ground');
          break;
        case 'drinkStart':
          this.audio.play('flask_drink');
          break;
        case 'flaskHeal':
          this.audio.play('flask_heal');
          break;
        case 'staminaRefused':
          this.ui.flashStamina();
          break;
        default:
          break;
      }
    }
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
    const f = this.flow;
    this.ui.setDebugText(
      [
        `FPS ${this.fps.toFixed(0)}`,
        `state ${f.state}${f.paused ? ' (paused)' : ''}  attempts ${f.attempts}  fade ${f.fade.toFixed(2)}`,
        `draw calls ${info.calls}`,
        `player ${act} t=${m.actionT.toFixed(2)} chain=${m.chainNext >= 0 ? m.chainNext + 1 : '-'} buf=${m.buffered ?? '-'}${m.godMode ? ' GOD' : ''}`,
        `hp ${m.hp}  stamina ${m.stamina.toFixed(0)}  flasks ${m.flasks}  i-frames ${m.isInvincible() ? 'ON' : 'off'}`,
        `speed ${m.speed().toFixed(2)} m/s  pos ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`,
        `boss hp ${b.hp} ${b.phase} ${b.mode} last=${this.lastHit ?? '-'}`,
        `attack ${atk}${win}  next in ${b.waiting ? b.cooldownLeft.toFixed(2) : '-'}${b.forceNext ? ` forced=${b.forceNext}` : ''}`,
        `poise ${b.poise}  close ${b.closeTimer.toFixed(2)}${b.annoyed ? ' ANNOYED' : ''}${this.rebukeMarker > 0 ? `  REBUKE(${b.lastRebuke})` : ''}`,
        `sound ${this.audio.muted ? 'OFF' : 'ON'}${this.audio.unlocked ? '' : ' (locked)'}`,
      ].join('\n'),
    );
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
