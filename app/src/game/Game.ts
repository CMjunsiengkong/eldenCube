/**
 * Owns everything; the state machine (ARCHITECTURE §4.2).
 *
 * Milestone 1.2: the player moves and rolls in FIGHT around a static placeholder cube at the
 * boss spawn; the lock-on camera follows. The full state machine (TITLE → … → TO_TITLE) arrives
 * in milestone 1.5; until then the game starts directly in FIGHT.
 */
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import { CONFIG } from '../config';
import { getFlags } from '../flags';
import type { LoopTarget } from '../loop';
import { moveDirFromAxis, Player, type BodyObstacle, type MotorInput, type PlayerEvent } from '../entities/Player';
import { CameraController } from '../systems/camera';
import { Input } from '../systems/input';
import { UI } from '../systems/ui';
import { createRng } from '../util/rng';
import { Arena } from './Arena';

export type GameState = 'TITLE' | 'FIGHT' | 'DYING' | 'BOSS_DEFEATED' | 'VICTORY_SCREEN' | 'TO_TITLE';

const CAM = CONFIG.camera;
const B = CONFIG.boss;

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

  /** Milestone 1.2 stand-in for the boss: a static 4 m cube at the spawn (replaced in 1.3). */
  private readonly bossPos = new Vector3(B.spawn.x, B.spawn.y, B.spawn.z);
  private readonly bossBox: BodyObstacle = {
    center: { x: B.spawn.x, y: B.spawn.y + B.halfSize, z: B.spawn.z },
    halfSize: B.halfSize,
    yaw: 0,
  };

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

    const placeholder = new Mesh(
      new BoxGeometry(B.model.bodySize, B.model.bodySize, B.model.bodySize),
      new MeshStandardMaterial({ color: CONFIG.colors.bossPhase1, roughness: B.model.roughness }),
    );
    placeholder.position.set(B.spawn.x, B.model.bodyCenterY, B.spawn.z);
    placeholder.castShadow = true;
    placeholder.receiveShadow = true;
    this.scene.add(placeholder);

    this.player = new Player(this.debug);
    this.scene.add(this.player.root);

    this.cameraCtl = new CameraController(this.camera, this.rng);
    this.cameraCtl.snapLockOn(this.player.position, this.bossPos);
    this.cameraCtl.update(0, this.player.position, this.bossPos);
  }

  /** Fixed simulation step. */
  update(dt: number): void {
    if (this.state === 'FIGHT') this.updateFight(dt);
    this.input.endStep();
  }

  /** Every frame, real time. */
  realUpdate(frameDt: number): void {
    this.cameraCtl.update(frameDt, this.player.position, this.bossPos);
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

  private updateFight(dt: number): void {
    const axis = this.input.moveAxis();
    this.cameraCtl.forwardXZ(this.camFwd);
    moveDirFromAxis(axis.x, axis.z, this.camFwd.x, this.camFwd.z, this.moveDir);

    const mi = this.motorInput;
    mi.moveX = this.moveDir.x;
    mi.moveZ = this.moveDir.z;
    mi.wantRoll = this.input.consume('roll');
    mi.bossX = this.bossPos.x;
    mi.bossZ = this.bossPos.z;
    mi.obstacle = this.bossBox; // the placeholder never attacks
    this.onPlayerEvents(this.player.update(dt, mi));
  }

  /** Sound triggers (GD §10). Audio is wired in milestone 1.5. */
  private onPlayerEvents(_events: readonly PlayerEvent[]): void {
    // 'rollStart' → roll, 'rollEnd' → roll_end, 'footstep' → footstep (milestone 1.5)
  }

  private updateDebug(frameDt: number): void {
    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime < 1 / CONFIG.ui.debugRefreshHz) return;
    this.fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    const m = this.player.motor;
    const info = this.renderer.info.render;
    this.ui.setDebugText(
      [
        `FPS ${this.fps.toFixed(0)}`,
        `state ${this.state}`,
        `draw calls ${info.calls}`,
        `player ${m.action} t=${m.actionT.toFixed(2)} cd=${m.rollCooldown.toFixed(2)}`,
        `i-frames ${m.isInvincible() ? 'ON' : 'off'}`,
        `speed ${m.speed().toFixed(2)} m/s  pos ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`,
      ].join('\n'),
    );
  }
}
