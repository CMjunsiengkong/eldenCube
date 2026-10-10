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
    '--victory-gold': C.uiGold,
    '--hud-edge': px(U.hudEdge),
    '--pip-size': px(U.pipSize),
    '--pip-gap': px(U.pipGap),
    '--pip-border': px(U.pipBorder),
    '--pip-flash': `${U.pipFlash}s`,
    '--flask-w': px(U.flaskIconWidth),
    '--flask-h': px(U.flaskIconHeight),
    '--flask-text': px(U.flaskTextSize),
    '--flask-color': C.flaskHud,
    '--stamina-w': px(U.staminaWidth),
    '--stamina-h': px(U.staminaHeight),
    '--stamina-full': C.staminaFull,
    '--stamina-flash': `${U.staminaFlash}s`,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}

/** Restarts a one-shot CSS animation class on an element (once per event, never per frame). */
function restartClass(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth; // reflow so the animation runs again
  el.classList.add(cls);
}

const PER_SEG = CONFIG.boss.hp / CONFIG.boss.healthSegments;

/** Which screen layout is shown (GD §2). TO_TITLE keeps the previous one until the reset. */
export type Screen = 'title' | 'fight' | 'dying' | 'defeated' | 'victory';

export class UI {
  private readonly debugEl: HTMLElement;
  private readonly healthEl: HTMLElement;
  private readonly playerHudEl: HTMLElement;
  private readonly fills: HTMLElement[] = [];
  private readonly losts: HTMLElement[] = [];
  private readonly pips: HTMLElement[] = [];
  private readonly flaskText: HTMLElement;
  private readonly staminaBar: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private shownHp: number = CONFIG.boss.hp;
  private shownPlayerHp: number = CONFIG.player.hp;
  private shownFlasks = -1;
  private shownStamina = -1;
  private readonly overlay: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly startPrompt: HTMLElement;
  private readonly attemptsEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly soundEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly resultText: HTMLElement;
  private readonly continuePrompt: HTMLElement;
  private readonly pauseEl: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private shownFade = -1;

  constructor(overlay: HTMLElement, debug: boolean) {
    applyCssVariables();
    this.overlay = overlay;
    this.titleEl = requireChild(overlay, '#title-screen');
    this.startPrompt = requireChild(overlay, '#start-prompt');
    this.attemptsEl = requireChild(overlay, '#attempts');
    this.hintEl = requireChild(overlay, '#controls-hint');
    this.soundEl = requireChild(overlay, '#sound-indicator');
    this.resultEl = requireChild(overlay, '#result');
    this.resultText = requireChild(this.resultEl, '.result-text');
    this.continuePrompt = requireChild(overlay, '#continue-prompt');
    this.pauseEl = requireChild(overlay, '#pause');
    this.fadeEl = requireChild(overlay, '#fade');
    this.debugEl = requireChild(overlay, '#debug');
    this.debugEl.hidden = !debug;
    this.healthEl = requireChild(overlay, '#boss-health');
    const bar = requireChild(this.healthEl, '.health-bar');
    for (let i = 0; i < CONFIG.boss.healthSegments; i++) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      const fill = document.createElement('div');
      fill.className = 'fill';
      const lost = document.createElement('div');
      lost.className = 'lost';
      seg.append(fill, lost);
      bar.appendChild(seg);
      this.fills.push(fill);
      this.losts.push(lost);
    }
    this.playerHudEl = requireChild(overlay, '#player-hud');
    const pipsEl = requireChild(this.playerHudEl, '.pips');
    for (let i = 0; i < CONFIG.player.hp; i++) {
      const pip = document.createElement('div');
      pip.className = 'pip';
      pipsEl.appendChild(pip);
      this.pips.push(pip);
    }
    this.flaskText = requireChild(this.playerHudEl, '.flask-count');
    this.staminaBar = requireChild(this.playerHudEl, '.stamina');
    this.staminaFill = requireChild(this.staminaBar, '.fill');
  }

  /**
   * GD §2 layout per screen. Boss bar: FIGHT, DYING, BOSS_DEFEATED. Player HUD: FIGHT, DYING.
   * Controls hint: FIGHT. Title overlay: TITLE. Result: VICTORY_SCREEN (YOU DIED via showResult).
   */
  setScreen(screen: Screen): void {
    const fightish = screen === 'fight' || screen === 'dying';
    this.titleEl.classList.toggle('visible', screen === 'title');
    this.healthEl.classList.toggle('visible', fightish || screen === 'defeated');
    this.playerHudEl.classList.toggle('visible', fightish);
    this.hintEl.classList.toggle('visible', screen === 'fight');
    if (screen === 'title') {
      this.showStartPrompt(false);
      this.hideResult();
    }
    if (screen === 'victory') this.showResult('victory');
    this.overlay.dataset.screen = screen;
  }

  /** "YOU DIED" (55 % dim, red) or "CUBE FELLED" (40 % dim, gold), fading in with a 1.1 → 1.0 scale. */
  showResult(kind: 'died' | 'victory'): void {
    this.resultText.textContent = kind === 'died' ? 'YOU DIED' : 'CUBE FELLED';
    this.resultEl.classList.toggle('died', kind === 'died');
    this.resultEl.classList.toggle('victory', kind === 'victory');
    this.showContinuePrompt(false);
    restartClass(this.resultEl, 'visible');
  }

  private hideResult(): void {
    this.resultEl.classList.remove('visible', 'died', 'victory');
    this.showContinuePrompt(false);
  }

  showStartPrompt(visible: boolean): void {
    this.startPrompt.classList.toggle('visible', visible);
  }

  showContinuePrompt(visible: boolean): void {
    this.continuePrompt.classList.toggle('visible', visible);
  }

  /** "Attempts: N", shown on the start screen only after the first fight. */
  setAttempts(n: number): void {
    this.attemptsEl.textContent = n > 0 ? `Attempts: ${n}` : '';
  }

  setSound(on: boolean): void {
    this.soundEl.textContent = on ? 'Sound: ON (M)' : 'Sound: OFF (M)';
  }

  setPaused(paused: boolean): void {
    this.pauseEl.classList.toggle('visible', paused);
  }

  /** The black fade layer (inline opacity, touched only when the value changes). */
  setFade(opacity: number): void {
    const o = Math.round(opacity * 1000) / 1000;
    if (o === this.shownFade) return;
    this.shownFade = o;
    this.fadeEl.style.opacity = String(o);
    this.fadeEl.style.visibility = o > 0 ? 'visible' : 'hidden';
  }

  /**
   * GD §2: 20 HP shown as 5 segments of 4, draining from the right. The part lost by a hit flashes
   * white for 0.15 s before turning empty.
   */
  setHealth(hp: number): void {
    if (hp === this.shownHp) return;
    for (let i = 0; i < this.fills.length; i++) {
      const before = Math.min(1, Math.max(0, (this.shownHp - i * PER_SEG) / PER_SEG));
      const now = Math.min(1, Math.max(0, (hp - i * PER_SEG) / PER_SEG));
      this.fills[i].style.width = `${now * 100}%`;
      const lost = this.losts[i];
      if (now < before) {
        lost.style.left = `${now * 100}%`;
        lost.style.width = `${(before - now) * 100}%`;
        restartClass(lost, 'flash');
      } else if (now > before) {
        lost.classList.remove('flash');
      }
    }
    this.shownHp = hp;
  }

  /** GD §2 player HUD: HP pips (a lost pip flashes), flask counter, stamina bar (0…1). */
  setPlayerHud(hp: number, flasks: number, stamina01: number): void {
    if (hp !== this.shownPlayerHp) {
      for (let i = 0; i < this.pips.length; i++) {
        const full = i < hp;
        const pip = this.pips[i];
        const wasFull = !pip.classList.contains('empty');
        pip.classList.toggle('empty', !full);
        if (wasFull && !full) restartClass(pip, 'flash');
      }
      this.shownPlayerHp = hp;
    }
    if (flasks !== this.shownFlasks) {
      this.flaskText.textContent = `×${flasks}`;
      this.shownFlasks = flasks;
    }
    // Rounded to 0.5% so the DOM is touched only when the bar visibly changes.
    const st = Math.round(stamina01 * 200) / 2;
    if (st !== this.shownStamina) {
      this.staminaFill.style.width = `${st}%`;
      this.shownStamina = st;
    }
  }

  /** GD §4.3b: the stamina bar flashes white for 0.3 s when an action is refused. */
  flashStamina(): void {
    restartClass(this.staminaBar, 'flash');
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
