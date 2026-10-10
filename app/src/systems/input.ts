/**
 * Keyboard and mouse input (GAME_DESIGN §3, ARCHITECTURE §4.5).
 *
 * - Held keys are tracked by `KeyboardEvent.code`; auto-repeat is ignored.
 * - Edges ("pressed this step") are consumed at most once. Edges not consumed by the end of a
 *   simulation step are dropped (no input buffering). Edges that arrive during hit-stop or pause
 *   survive until the next simulation step.
 * - On blur / hidden tab, everything is cleared and `onFocusLost` fires.
 */

export type InputEdge =
  | 'roll'
  | 'swing'
  | 'flask'
  | 'mute'
  | 'anyStart'
  | 'resumeClick'
  | 'debug1'
  | 'debug2'
  | 'debug3'
  | 'debug4'
  | 'debugK'
  | 'debugG';

const MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const;

const DEBUG_KEYS: Readonly<Record<string, InputEdge>> = {
  Digit1: 'debug1',
  Digit2: 'debug2',
  Digit3: 'debug3',
  Digit4: 'debug4',
  KeyK: 'debugK',
  KeyG: 'debugG',
};

/** Pure: maps one keydown to the edges it raises (exported for tests). */
export function edgesForKey(code: string, debug: boolean): InputEdge[] {
  if (code === 'KeyM') return ['mute']; // M never counts as "any key"
  const edges: InputEdge[] = ['anyStart'];
  if (code === 'Space') edges.push('roll');
  else if (code === 'KeyF') edges.push('swing');
  else if (code === 'KeyR') edges.push('flask');
  else if (debug && DEBUG_KEYS[code] !== undefined) edges.push(DEBUG_KEYS[code]);
  return edges;
}

/** Pure: raw camera-relative axis from held keys (x = right, z = forward), not normalized. */
export function moveAxisFromHeld(held: ReadonlySet<string>): { x: number; z: number } {
  return {
    x: (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0),
    z: (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0),
  };
}

export class Input {
  /** Called on window blur or when the tab becomes hidden. */
  onFocusLost: () => void = () => undefined;
  /** Called synchronously inside every key / click handler (audio unlock needs a user gesture). */
  onGesture: () => void = () => undefined;

  private readonly held = new Set<string>();
  private readonly edges = new Set<InputEdge>();
  private readonly debug: boolean;
  private readonly cleanup: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, debug: boolean) {
    this.debug = debug;

    this.listen(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => this.held.delete((e as KeyboardEvent).code));
    this.listen(canvas, 'pointerdown', (e) => {
      if ((e as PointerEvent).button !== 0) return;
      this.onGesture();
      this.edges.add('swing');
      this.edges.add('anyStart');
      this.edges.add('resumeClick');
    });
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'blur', () => this.focusLost());
    this.listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.focusLost();
    });
  }

  /** True while a movement key is held. */
  isHeld(code: (typeof MOVE_CODES)[number]): boolean {
    return this.held.has(code);
  }

  /** Raw axis (x = strafe right, z = toward the boss / camera forward). */
  moveAxis(): { x: number; z: number } {
    return moveAxisFromHeld(this.held);
  }

  /** Returns true once per press if the edge is pending, and consumes it. */
  consume(edge: InputEdge): boolean {
    return this.edges.delete(edge);
  }

  /** True if the edge is pending (does not consume). */
  peek(edge: InputEdge): boolean {
    return this.edges.has(edge);
  }

  /** Drops all unconsumed edges. Called at the end of every simulation step (no buffering). */
  endStep(): void {
    this.edges.clear();
  }

  /** Clears held keys and pending edges. */
  clearAll(): void {
    this.held.clear();
    this.edges.clear();
  }

  dispose(): void {
    for (const off of this.cleanup) off();
    this.cleanup.length = 0;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') e.preventDefault(); // never scroll the page
    if (e.repeat) return;
    this.onGesture();
    if ((MOVE_CODES as readonly string[]).includes(e.code)) this.held.add(e.code);
    for (const edge of edgesForKey(e.code, this.debug)) this.edges.add(edge);
  }

  private focusLost(): void {
    this.clearAll();
    this.onFocusLost();
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void): void {
    target.addEventListener(type, handler);
    this.cleanup.push(() => target.removeEventListener(type, handler));
  }
}
