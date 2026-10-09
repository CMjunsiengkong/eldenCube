import { describe, expect, it } from 'vitest';
import { edgesForKey, moveAxisFromHeld } from '../src/systems/input';

describe('input mapping (GAME_DESIGN §3)', () => {
  it('M toggles mute and never counts as "any key"', () => {
    expect(edgesForKey('KeyM', false)).toEqual(['mute']);
    expect(edgesForKey('KeyM', true)).toEqual(['mute']);
  });

  it('Space rolls, F swings; both also count as any key', () => {
    expect(edgesForKey('Space', false)).toEqual(['anyStart', 'roll']);
    expect(edgesForKey('KeyF', false)).toEqual(['anyStart', 'swing']);
  });

  it('other keys only count as any key', () => {
    expect(edgesForKey('KeyW', false)).toEqual(['anyStart']);
    expect(edgesForKey('Enter', false)).toEqual(['anyStart']);
  });

  it('debug keys raise their edge only with ?debug', () => {
    expect(edgesForKey('Digit1', false)).toEqual(['anyStart']);
    expect(edgesForKey('Digit1', true)).toEqual(['anyStart', 'debug1']);
    expect(edgesForKey('Digit2', true)).toContain('debug2');
    expect(edgesForKey('Digit3', true)).toContain('debug3');
    expect(edgesForKey('KeyK', true)).toContain('debugK');
    expect(edgesForKey('KeyG', true)).toContain('debugG');
  });

  it('move axis from held WASD (opposites cancel)', () => {
    expect(moveAxisFromHeld(new Set())).toEqual({ x: 0, z: 0 });
    expect(moveAxisFromHeld(new Set(['KeyW']))).toEqual({ x: 0, z: 1 });
    expect(moveAxisFromHeld(new Set(['KeyS', 'KeyD']))).toEqual({ x: 1, z: -1 });
    expect(moveAxisFromHeld(new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS']))).toEqual({ x: 0, z: 0 });
  });
});
