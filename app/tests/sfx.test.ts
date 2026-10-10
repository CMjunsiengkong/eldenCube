import { describe, expect, it } from 'vitest';
import { resolveSfxSources, SFX_IDS } from '../src/systems/audio';
import { RECIPE_IDS } from '../src/systems/sfx';

describe('resolveSfxSources (ARCHITECTURE §4.8)', () => {
  it('an empty glob means every sound uses its recipe', () => {
    expect(resolveSfxSources({}).size).toBe(0);
  });

  it('hit.mp3 maps to hit', () => {
    const m = resolveSfxSources({ '../assets/sfx/hit.mp3': '/assets/hit-abc.mp3' });
    expect(m.get('hit')).toBe('/assets/hit-abc.mp3');
  });

  it('mp3 beats ogg beats wav for the same ID, in any order', () => {
    const m = resolveSfxSources({
      '../assets/sfx/victory.wav': 'w',
      '../assets/sfx/victory.ogg': 'o',
      '../assets/sfx/roll.wav': 'rw',
      '../assets/sfx/roll.ogg': 'ro',
      '../assets/sfx/victory.mp3': 'm',
    });
    expect(m.get('victory')).toBe('m');
    expect(m.get('roll')).toBe('ro');
  });

  it('unknown names are ignored with one info message', () => {
    const msgs: string[] = [];
    const m = resolveSfxSources({ '../assets/sfx/boing.mp3': 'x', '../assets/sfx/Hit.mp3': 'y', '../assets/sfx/hit.mp3': 'z' }, (s) => msgs.push(s));
    expect([...m.keys()]).toEqual(['hit']);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('boing.mp3');
  });

  it('every one of the 22 sound IDs has a recipe', () => {
    expect(SFX_IDS).toHaveLength(22);
    expect(new Set(RECIPE_IDS)).toEqual(new Set(SFX_IDS));
  });
});
