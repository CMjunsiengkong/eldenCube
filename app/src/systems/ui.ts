/**
 * DOM overlay above the canvas (ARCHITECTURE §4.7, GAME_DESIGN §2).
 * Milestone 1.1: CSS variables from CONFIG.ui, the debug overlay and the WebGL error.
 * Screens and HUD are added in milestone 1.5.
 */
import { CONFIG } from '../config';

const U = CONFIG.ui;
const C = CONFIG.colors;

const px = (v: number): string => `${v}px`;

/** Publishes CONFIG.ui / colors as CSS variables so styles.css never hard-codes a tunable value. */
export function applyCssVariables(root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--title-size': U.titleSize,
    '--title-top': U.titleTop,
    '--start-prompt-size': px(U.startPromptSize),
    '--blink-period': `${U.blinkPeriod}s`,
    '--blink-min-opacity': String(U.blinkMinOpacity),
    '--controls-box-size': px(U.controlsBoxSize),
    '--health-width': U.healthBarWidth,
    '--health-height': px(U.healthBarHeight),
    '--health-label-size': px(U.healthLabelSize),
    '--health-gap': px(U.healthSegmentGap),
    '--health-flash': `${U.healthSegmentFlash}s`,
    '--hint-size': px(U.controlsHintSize),
    '--hint-opacity': String(U.controlsHintOpacity),
    '--sound-size': px(U.soundIndicatorSize),
    '--attempts-size': px(U.attemptsSize),
    '--result-size': U.resultTextSize,
    '--result-spacing': U.resultLetterSpacing,
    '--result-fade': `${U.resultFadeIn}s`,
    '--result-scale-from': String(U.resultScaleFrom),
    '--died-dim': String(U.youDiedDim),
    '--victory-dim': String(U.victoryDim),
    '--continue-size': px(U.continuePromptSize),
    '--pause-dim': String(U.pauseDim),
    '--pause-size': px(U.pauseTextSize),
    '--overlay-fade': `${CONFIG.transitions.titleOverlayFade}s`,
    '--hud-fade': `${CONFIG.transitions.hudFade}s`,
    '--gold': C.uiGold,
    '--died-red': C.youDiedRed,
    '--health-full': C.healthFull,
    '--health-empty': C.healthEmpty,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}

export class UI {
  private readonly debugEl: HTMLElement;
  private readonly healthEl: HTMLElement;
  private readonly segments: HTMLElement[];
  private shownHp: number = CONFIG.boss.hp;

  constructor(overlay: HTMLElement, debug: boolean) {
    applyCssVariables();
    this.debugEl = requireChild(overlay, '#debug');
    this.debugEl.hidden = !debug;
    this.healthEl = requireChild(overlay, '#boss-health');
    const bar = requireChild(this.healthEl, '.health-bar');
    this.segments = [];
    for (let i = 0; i < CONFIG.boss.hp; i++) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      bar.appendChild(seg);
      this.segments.push(seg);
    }
  }

  /** Shows/hides the boss health bar (FIGHT, DYING, BOSS_DEFEATED). */
  showHealth(visible: boolean): void {
    this.healthEl.classList.toggle('visible', visible);
  }

  /**
   * GD §2: 5 equal segments; a lost segment flashes white for 0.15 s before turning empty
   * (CSS animation on `.lost`). Segments are lost from the right.
   */
  setHealth(hp: number): void {
    if (hp === this.shownHp) return;
    for (let i = 0; i < this.segments.length; i++) {
      const lost = i >= hp;
      const seg = this.segments[i];
      if (lost && !seg.classList.contains('lost')) {
        seg.classList.add('lost'); // the flash animation runs once on add
      } else if (!lost) {
        seg.classList.remove('lost');
      }
    }
    this.shownHp = hp;
  }

  /** Sets the debug overlay text (caller throttles to CONFIG.ui.debugRefreshHz). */
  setDebugText(text: string): void {
    if (this.debugEl.textContent !== text) this.debugEl.textContent = text;
  }
}

/** Replaces the page with the plain WebGL error message (GAME_DESIGN §2). */
export function showWebGLError(): void {
  const el = document.createElement('div');
  el.className = 'webgl-error';
  el.textContent = 'This game needs WebGL. Please use the latest Chrome.';
  document.body.replaceChildren(el);
}

function requireChild(parent: HTMLElement, selector: string): HTMLElement {
  const el = parent.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing overlay element ${selector}`);
  return el;
}
