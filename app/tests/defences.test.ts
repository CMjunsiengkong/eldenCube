import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { BounceShove } from '../src/attacks/BounceShove';
import { hopTarget, JellyHop } from '../src/attacks/JellyHop';
import { RoyalRebuke } from '../src/attacks/RoyalRebuke';
import { PlayerMotor } from '../src/entities/Player';
import { makeCtx, spheresAt } from './attackCtx';

const HP = CONFIG.hop;
const SH = CONFIG.shove;
const RB = CONFIG.rebuke;
const LIMIT = CONFIG.arena.radius - HP.edgeMargin;

describe('Jelly Hop-Back (GAME_DESIGN §6.5 H, 1.6)', () => {
  it('lands about 9 m away from the player, through the boss', () => {
    const t = hopTarget(0, 0, 0, 3, { x: 0, z: 0 });
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.z).toBeCloseTo(-HP.distance, 6);
  });

  it('always lands inside the arena; next to the wall it turns toward the open side', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const bx = Math.sin(a) * 26;
      const bz = Math.cos(a) * 26;
      const t = hopTarget(bx, bz, bx * 0.85, bz * 0.85, { x: 0, z: 0 }); // player on the inside
      expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(LIMIT + 1e-9);
      expect(Math.hypot(t.x - bx, t.z - bz)).toBeGreaterThan(HP.distance * 0.6);
    }
  });

  it('tell 0.5 s, air 0.6 s, then lands: crushes only under the body, spawns a 10 m splash ring', () => {
    const ctx = makeCtx();
    ctx.playerPos.set(0, 0, 3);
    const hop = new JellyHop();
    hop.start(ctx);
    let t = 0;
    let landed = -1;
    let maxY = 0;
    while (!hop.isBossFree() && t < 5) {
      hop.update(STEP, ctx);
      t += STEP;
      maxY = Math.max(maxY, ctx.boss.pos.y);
      if (landed < 0 && hop.phaseName === 'recovery') {
        landed = t;
        expect(hop.checkPlayerHit(spheresAt(ctx.boss.pos.x, ctx.boss.pos.z + 1))).not.toBeNull();
        expect(hop.checkPlayerHit(spheresAt(0, 3))).toBeNull(); // 12 m away: only the ring can reach
        expect(ctx.hazards.liveRings([])).toHaveLength(1);
      }
    }
    expect(landed).toBeCloseTo(HP.tell + HP.airTime, 1);
    expect(maxY).toBeCloseTo(HP.height, 1);
    expect(ctx.boss.pos.z).toBeCloseTo(-HP.distance, 6);
    expect(ctx.boss.pos.y).toBe(0);
    expect(t).toBeCloseTo(HP.tell + HP.airTime + HP.recovery, 1);
  });

  it('the splash ring ends at 10 m, smaller than a Slam ring', () => {
    const ctx = makeCtx();
    ctx.hazards.spawnRing(0, 0, HP.ringSpeed, HP.ringEndRadius);
    let max = 0;
    for (let i = 0; i < 120; i++) {
      ctx.hazards.step(STEP);
      for (const r of ctx.hazards.liveRings([])) max = Math.max(max, r);
    }
    expect(max).toBeGreaterThan(HP.ringEndRadius - 0.5);
    expect(max).toBeLessThanOrEqual(HP.ringEndRadius + 1e-9);
    expect(ctx.hazards.liveRings([])).toHaveLength(0);
  });

  it('is airborne (not solid, no turning) between take-off and landing; a cancel drops it to the ground', () => {
    const ctx = makeCtx();
    const hop = new JellyHop();
    hop.start(ctx);
    while (hop.phaseName === 'tell') hop.update(STEP, ctx);
    hop.update(STEP, ctx);
    expect(ctx.boss.dashing).toBe(true);
    expect(ctx.boss.pos.y).toBeGreaterThan(0);
    hop.dispose();
    expect(ctx.boss.pos.y).toBe(0);
    expect(ctx.boss.dashing).toBe(false);
  });
});

describe('Bounce Shove (GAME_DESIGN §6.5 I, 1.6)', () => {
  it('never damages; pushes once during the burst, within 5.5 + 0.4 m only', () => {
    const ctx = makeCtx();
    const sh = new BounceShove();
    sh.start(ctx);
    let t = 0;
    let first = -1;
    while (!sh.isBossFree() && t < 3) {
      sh.update(STEP, ctx);
      t += STEP;
      expect(sh.checkPlayerHit()).toBeNull();
      if (sh.phaseName === 'burst' && first < 0) {
        first = t;
        expect(sh.checkPlayerShove(spheresAt(0, SH.reach + 1))).toBeNull();
        expect(sh.checkPlayerShove(spheresAt(0, 3))).not.toBeNull();
        expect(sh.checkPlayerShove(spheresAt(0, 3))).toBeNull(); // once per Shove
      }
    }
    expect(first).toBeCloseTo(SH.tell, 1);
    expect(t).toBeCloseTo(SH.tell + SH.burst + SH.recovery, 1);
  });

  it('the player is pushed 5 m away and stumbles 0.45 s, keeping all HP; a roll ignores it', () => {
    const m = new PlayerMotor();
    m.x = 0;
    m.z = 3;
    expect(m.shove(0, 0, SH.distance, SH.stumble)).toBe(true);
    expect(m.action).toBe('stagger');
    const input = { moveX: 0, moveZ: 0, wantRoll: false, wantAttack: false, wantFlask: false, allowAttack: true, bossX: 0, bossZ: 0, obstacle: null };
    let t = 0;
    while (m.action === 'stagger') {
      m.step(STEP, input);
      t += STEP;
    }
    expect(t).toBeCloseTo(SH.stumble, 1);
    expect(m.z).toBeCloseTo(3 + SH.distance, 1);
    expect(m.hp).toBe(CONFIG.player.hp);
    m.step(STEP, { ...input, wantRoll: true });
    for (let i = 0; i < 6; i++) m.step(STEP, input); // inside the roll i-frames
    expect(m.shove(0, 0, SH.distance, SH.stumble)).toBe(false);
  });
});

describe('Feint Rebuke (GAME_DESIGN §6.5 D2, 1.6)', () => {
  const burstAt = (rage: boolean, force: boolean, seed = 1): number => {
    const ctx = makeCtx({ rage, seed });
    const r = new RoyalRebuke();
    r.forceFeint = force;
    r.start(ctx);
    let t = 0;
    while (r.phaseName !== 'burst' && t < 3) {
      r.update(STEP, ctx);
      t += STEP;
    }
    return t;
  };

  it('a feint bursts 0.3 s after the normal tell; a normal Rebuke right at the tell', () => {
    expect(burstAt(false, false)).toBeCloseTo(RB.tell, 1);
    expect(burstAt(false, true)).toBeCloseTo(RB.tell + RB.feint.delay, 1);
  });

  it('never feints in Phase 1; about 30% of rage Rebukes feint', () => {
    let p1 = 0;
    let rage = 0;
    for (let seed = 1; seed <= 300; seed++) {
      if (burstAt(false, false, seed) > RB.tell + 0.1) p1++;
      if (burstAt(true, false, seed) > RB.tell + 0.1) rage++;
    }
    expect(p1).toBe(0);
    expect(rage / 300).toBeGreaterThan(0.2);
    expect(rage / 300).toBeLessThan(0.4);
  });
});
