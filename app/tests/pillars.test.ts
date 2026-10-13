import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import type { PillarHit } from '../src/attacks/Attack';
import { ConeBreath } from '../src/attacks/ConeBreath';
import { FlameBeam } from '../src/attacks/FlameBeam';
import { RoyalRebuke } from '../src/attacks/RoyalRebuke';
import { BounceShove } from '../src/attacks/BounceShove';
import { PillarField, pillarBlocks } from '../src/game/Pillars';
import { makeCtx } from './attackCtx';

const PL = CONFIG.pillars;
const hit = (): PillarHit => ({ shield: false, ox: 0, oz: 0, life: 0 });

describe('crown pillars (GAME_DESIGN §8a, 1.6)', () => {
  it('four pillars on the diagonals, 15 m from the center, 2.2 m wide (1.6 playtest)', () => {
    expect(PL.radius).toBe(1.1);
    const f = new PillarField();
    expect(f.pillars).toHaveLength(4);
    for (const p of f.pillars) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(PL.distance, 6);
      expect(Math.abs(Math.abs(p.x) - Math.abs(p.z))).toBeLessThan(1e-9);
    }
  });

  it('pillarBlocks: only when the pillar is between the origin and the player', () => {
    expect(pillarBlocks(0, 0, 0, 10, 0, 5, 0.6)).toBe(true);
    expect(pillarBlocks(0, 0, 0, 4, 0, 5, 0.6)).toBe(false); // the player is in front of it
    expect(pillarBlocks(0, 0, 2, 10, 0, 5, 0.6)).toBe(false); // the line misses it
    expect(pillarBlocks(0, 0, 0, 10, 0, -5, 0.6)).toBe(false); // behind the origin
  });

  it('3 health (1.6 playtest): one wave costs 1; the third hit collapses it', () => {
    const f = new PillarField();
    const p = f.pillars[0];
    const c: number[] = [];
    const d: number[] = [];
    expect(f.hit(0, true, 0, 0, 0.3)).toBe('damaged');
    // The same wave touching it again within the cooldown costs nothing.
    for (let t = 0; t < PL.hitCooldown - 0.05; t += STEP) {
      f.step(STEP);
      expect(f.hit(0, true, 0, 0, 0.3)).toBeNull();
    }
    for (let t = 0; t < 0.1; t += STEP) f.step(STEP);
    expect(f.hit(0, false, 0, 0, 0)).toBe('damaged');
    expect(p.health).toBe(1);
    f.takeEvents(c, d);
    expect(d).toEqual([0, 0]);
    expect(c).toEqual([]);
    for (let t = 0; t < PL.hitCooldown + 0.05; t += STEP) f.step(STEP);
    expect(f.hit(0, false, 0, 0, 0)).toBe('collapsed');
    expect(p.standing).toBe(false);
    expect(f.standingCount).toBe(3);
    f.takeEvents(c, d);
    expect(c).toEqual([0]);
    f.reset();
    expect(f.standingCount).toBe(4);
    expect(p.health).toBe(PL.health);
  });

  it('Charge and Beam (instant) collapse it at full health', () => {
    const f = new PillarField();
    expect(f.hit(3, false, 0, 0, 0, true)).toBe('collapsed');
    expect(f.pillars[3].standing).toBe(false);
  });

  it('a shield blocks only that wave and only for its life, while the pillar survives', () => {
    const f = new PillarField();
    const p = f.pillars[0];
    const behindX = p.x * 1.2;
    const behindZ = p.z * 1.2;
    f.hit(0, true, 0, 0, 0.3);
    expect(p.standing).toBe(true);
    expect(f.blocks(0, 0, behindX, behindZ)).toBe(true);
    expect(f.blocks(5, 5, behindX, behindZ)).toBe(false); // another origin: another wave
    for (let t = 0; t < 0.31; t += STEP) f.step(STEP);
    expect(f.blocks(0, 0, behindX, behindZ)).toBe(false);
  });

  it('a hit without a shield (Charge, Beam, Rain, meteors, the body) never blocks', () => {
    const f = new PillarField();
    const p = f.pillars[1];
    f.collapse(1, false, 0, 0);
    expect(f.blocks(0, 0, p.x * 1.1, p.z * 1.1)).toBe(false);
  });

  it('standing pillars push the player out; fallen ones do not', () => {
    const f = new PillarField();
    const p = f.pillars[2];
    const o = { x: 0, z: 0, nx: 0, nz: 0 };
    expect(f.pushOut(p.x + 0.3, p.z, CONFIG.player.radius, o)).toBe(true);
    expect(Math.hypot(o.x - p.x, o.z - p.z)).toBeCloseTo(p.r + CONFIG.player.radius, 6);
    f.collapse(2);
    expect(f.pushOut(p.x + 0.3, p.z, CONFIG.player.radius, o)).toBe(false);
  });
});

describe('what collapses a pillar, and what it shields (1.6)', () => {
  it('a Slam ring reaching it collapses it and shields while the ring lives', () => {
    const ctx = makeCtx();
    ctx.hazards.spawnRing(0, 0, CONFIG.slam.ringSpeed);
    let h: PillarHit | null = null;
    for (let i = 0; i < 120 && !h; i++) {
      ctx.hazards.step(STEP);
      h = ctx.hazards.pillarHit(0, 8, PL.radius, hit());
    }
    expect(h?.shield).toBe(true);
    expect(h?.life).toBeGreaterThan(0);
  });

  it('a meteor landing on it collapses it without shielding', () => {
    const ctx = makeCtx({ seed: 3 });
    ctx.hazards.startMeteors(ctx.rng);
    let found: PillarHit | null = null;
    for (let i = 0; i < 600 && !found; i++) {
      ctx.hazards.step(STEP);
      for (const m of ctx.hazards.landedMeteors([])) {
        found = ctx.hazards.pillarHit(m.x + 1, m.z, PL.radius, hit());
        if (found) break;
      }
    }
    expect(found).not.toBeNull();
    expect(found?.shield).toBe(false);
  });

  it('the Cone shields one blast; the Rebuke and Shove shield; the Beam goes through', () => {
    const run = (a: ConeBreath | RoyalRebuke | BounceShove | FlameBeam, x: number, z: number, rage = false): PillarHit | null => {
      const ctx = makeCtx({ rage });
      ctx.playerPos.set(0, 0, 10);
      a.start(ctx);
      for (let i = 0; i < 400; i++) {
        a.update(STEP, ctx);
        const h = a.pillarHit(x, z, PL.radius, hit());
        if (h) return h;
        if (a.isBossFree()) break;
      }
      return null;
    };
    const cone = run(new ConeBreath(), 0, 8);
    expect(cone?.shield).toBe(true);
    expect(cone?.life).toBeLessThan(CONFIG.cone.blastGap); // the rage 2nd blast is not blocked
    expect(run(new RoyalRebuke(), 0, 4)?.shield).toBe(true);
    expect(run(new RoyalRebuke(), 0, 8)).toBeNull(); // out of reach
    expect(run(new BounceShove(), 0, 5)?.shield).toBe(true);
    const beam = run(new FlameBeam(), 0, 8);
    expect(beam).not.toBeNull();
    expect(beam?.shield).toBe(false);
  });
});
