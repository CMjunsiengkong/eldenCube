/**
 * Owns everything; the state machine (ARCHITECTURE §4.2).
 *
 * Milestone 1.3: the player fights an idle boss (no attacks yet — milestone 1.4). Weapon hits,
 * hit reaction, rage transition, defeat with 8 cubes + crown and slow motion. The full state
 * machine (TITLE → … → TO_TITLE) arrives in milestone 1.5; until then the game starts in FIGHT
 * and stops in VICTORY_SCREEN.
 */
import { PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import { CONFIG } from '../config';
import { getFlags } from '../flags';
import type { LoopTarget, TimeControl } from '../loop';
import { moveDirFromAxis, Player, type MotorInput, type PlayerEvent } from '../entities/Player';
import { Boss, type HitResult } from '../entities/Boss';
import { disposeDebris, stepDebris, type DebrisPiece } from '../fx/debris';
import { CameraController } from '../systems/camera';
import { pointInOBB } from '../systems/collision';
import { Input } from '../systems/input';
import { UI } from '../systems/ui';
import { createRng } from '../util/rng';
import { Arena } from './Arena';

export type GameState = 'TITLE' | 'FIGHT' | 'DYING' | 'BOSS_DEFEATED' | 'VICTORY_SCREEN' | 'TO_TITLE';

const CAM = CONFIG.camera;
const B = CONFIG.boss;

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
  private time: TimeControl = NO_TIME;
  /** Simulation time spent in BOSS_DEFEATED (measured from the 5th hit, design §4.1). */
  private defeatT = 0;
  private lastHit: HitResult | null = null;

  private readonly moveDir = { x: 0, z: 0 };
  private readonly camFwd = { x: 0, z: -1 };
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

    this.cameraCtl = new CameraController(this.camera, this.rng);
    this.cameraCtl.snapLockOn(this.player.position, this.boss.pos);
    this.cameraCtl.update(0, this.player.position, this.boss.pos);

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
        this.updateFight(dt, true);
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
    this.input.endStep();
  }

  /** Every frame, real time. */
  realUpdate(frameDt: number): void {
    this.cameraCtl.update(frameDt, this.player.position, this.boss.pos);
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
   * Deals one hit to the boss through the normal path (weapon hit or the `K` debug key, 1.4).
   * Returns the brain's result.
   */
  applyBossHit(from: Vector3): HitResult {
    const result = this.boss.brain.takeHit();
    this.lastHit = result;
    if (result === 'ignored') return result;

    // D9: the 3rd hit / defeat cancels a running attack (attacks arrive in 1.4).
    this.boss.brain.consumeCancel();
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

  private updateFight(dt: number, canSwing: boolean): void {
    const axis = this.input.moveAxis();
    this.cameraCtl.forwardXZ(this.camFwd);
    moveDirFromAxis(axis.x, axis.z, this.camFwd.x, this.camFwd.z, this.moveDir);

    const broken = this.boss.isBroken;
    const mi = this.motorInput;
    mi.moveX = this.moveDir.x;
    mi.moveZ = this.moveDir.z;
    mi.wantRoll = this.input.consume('roll');
    mi.wantSwing = canSwing && this.input.consume('swing');
    mi.bossX = this.boss.pos.x;
    mi.bossZ = this.boss.pos.z;
    mi.obstacle = broken ? null : this.boss.getBox(); // no attacks yet → always solid
    this.onPlayerEvents(this.player.update(dt, mi));

    if (canSwing && !broken) this.checkWeaponHit();
    this.boss.update(dt, broken ? null : this.player.position);
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
    this.defeatT = 0;
  }

  /** Clears debris (used by Game.reset in 1.5). */
  private clearDebris(): void {
    disposeDebris(this.debris, true);
  }

  /** Sound triggers (GD §10). Audio is wired in milestone 1.5. */
  private onPlayerEvents(_events: readonly PlayerEvent[]): void {
    // rollStart → roll, rollEnd → roll_end, footstep → footstep, swingActive → swing,
    // swingMiss → swing_ground (+ boss.onPlayerMissedSwing in 1.4)
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
    this.ui.setDebugText(
      [
        `FPS ${this.fps.toFixed(0)}`,
        `state ${this.state}`,
        `draw calls ${info.calls}`,
        `player ${m.action} t=${m.actionT.toFixed(2)} cd=${m.rollCooldown.toFixed(2)}`,
        `i-frames ${m.isInvincible() ? 'ON' : 'off'}`,
        `speed ${m.speed().toFixed(2)} m/s  pos ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`,
        `boss hp ${b.hp} ${b.phase} ${b.mode} inv=${b.invuln.toFixed(2)} last=${this.lastHit ?? '-'}`,
      ].join('\n'),
    );
  }

  /** Not yet used (milestone 1.5 calls it at full black). */
  protected resetWorld(): void {
    this.clearDebris();
    this.player.reset();
    this.boss.reset(this.scene);
    this.ui.setHealth(this.boss.brain.hp);
  }
}
