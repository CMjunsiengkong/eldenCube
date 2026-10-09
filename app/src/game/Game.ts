/**
 * Owns everything; the state machine (ARCHITECTURE §4.2).
 * Milestone 1.1: scene, arena, a static camera on the title orbit pose, input, debug overlay.
 */
import { PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { CONFIG } from '../config';
import { getFlags } from '../flags';
import type { LoopTarget } from '../loop';
import { Input } from '../systems/input';
import { UI } from '../systems/ui';
import { Arena } from './Arena';

export type GameState = 'TITLE' | 'FIGHT' | 'DYING' | 'BOSS_DEFEATED' | 'VICTORY_SCREEN' | 'TO_TITLE';

const CAM = CONFIG.camera;

export class Game implements LoopTarget {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly input: Input;
  state: GameState = 'TITLE';

  private readonly renderer: WebGLRenderer;
  private readonly ui: UI;
  private readonly debug: boolean;

  // debug overlay (real time)
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  constructor(renderer: WebGLRenderer, canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.renderer = renderer;
    this.debug = getFlags().debug;

    this.camera = new PerspectiveCamera(CAM.fov, window.innerWidth / window.innerHeight, CAM.near, CAM.far);
    const o = CAM.orbit;
    this.camera.position.set(Math.sin(o.startAngle) * o.radius, o.height, Math.cos(o.startAngle) * o.radius);
    this.camera.lookAt(o.target.x, o.target.y, o.target.z);

    new Arena(this.scene);
    this.input = new Input(canvas, this.debug);
    this.ui = new UI(overlay, this.debug);
  }

  /** Fixed simulation step. */
  update(_dt: number): void {
    this.input.endStep();
  }

  /** Every frame, real time. */
  realUpdate(frameDt: number): void {
    if (!this.debug) return;
    this.fpsFrames++;
    this.fpsTime += frameDt;
    const period = 1 / CONFIG.ui.debugRefreshHz;
    if (this.fpsTime >= period) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      const info = this.renderer.info.render;
      this.ui.setDebugText(
        [`FPS ${this.fps.toFixed(0)}`, `state ${this.state}`, `draw calls ${info.calls}`].join('\n'),
      );
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
