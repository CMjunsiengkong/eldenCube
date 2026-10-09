/** Bootstrap: WebGL check, renderer, Game, loop start (ARCHITECTURE §4.6). */
import '@fontsource/cinzel/700.css';
import './styles.css';
import { PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';
import { Game } from './game/Game';
import { Loop } from './loop';
import { showWebGLError } from './systems/ui';

/** three r186 renders with WebGL 2 only. */
function hasWebGL(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!hasWebGL()) {
    showWebGLError();
    return;
  }

  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  const overlay = document.querySelector<HTMLElement>('#overlay');
  if (!canvas || !overlay) throw new Error('Missing #game canvas or #overlay');

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true });
  } catch {
    showWebGLError();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  // ARCHITECTURE §4.6 asks for PCFSoftShadowMap; three r186 removed it and falls back to PCFShadowMap
  // with a console warning. Using PCFShadowMap directly gives the same image without the warning.
  renderer.shadowMap.type = PCFShadowMap;

  // Wait for the bundled Cinzel font so the title never flashes in a fallback font.
  await document.fonts.ready;

  const game = new Game(renderer, canvas, overlay);
  window.addEventListener('resize', () => game.onResize(window.innerWidth, window.innerHeight));

  new Loop(game).start();
}

void main();
