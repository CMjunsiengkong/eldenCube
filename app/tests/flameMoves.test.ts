import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { ConeBreath, inCone } from '../src/attacks/ConeBreath';
import { beamStep, FlameBeam, segmentDistance, sweepSide } from '../src/attacks/FlameBeam';
import { CrownRain } from '../src/attacks/CrownRain';
import { rebukeReach } from '../src/attacks/Hazards';
import { makeCtx, spheresAt } from './attackCtx';

const CN = CONFIG.cone;
const BM = CONFIG.beam;
const R = CONFIG.roll;

describe('Cone Flame Breath (GAME_DESIGN §6.5 E, 2026-10-12)', () => {
  it('cone geometry: inside the arc and range; behind the boss is safe', () => {
    const half = CN.angle / 2;
    expect(inCone(0, 8, 0, 0, 0, CN.range, half)).toBe(true); // straight ahead (+Z)
    expect(inCone(6, 6, 0, 0, 0, CN.range, half)).toBe(true); // 45° off
    expect(inCone(0, -8, 0, 0, 0, CN.range, half)).toBe(false); // behind
    expect(inCone(0, CN.range + 1, 0, 0, 0, CN.range, half)).toBe(false); // out of range
  });

  it('each blast window (0.15 s) fits inside the roll i-frames (0.35 s)', () => {
    expect(CN.blast).toBeLessThan(R.iFrameEnd - R.iFrameStart);
  });

  it("rage: the 2nd blast lands inside a 2nd, buffered roll's i-frames (needs 2 rolls = 60 stamina)", () => {
    const cycle = R.duration + R.recoveryDuration; // roll → next roll at the earliest
    const roll1 = -R.iFrameStart; // started so its i-frames begin with blast 1
    const roll2 = roll1 + cycle;
    expect(roll1 + R.iFrameEnd).toBeGreaterThanOrEqual(CN.blast); // blast 1 covered
    expect(roll2 + R.iFrameStart).toBeLessThanOrEqual(CN.blastGap); // blast 2 covered…
    expect(roll2 + R.iFrameEnd).toBeGreaterThanOrEqual(CN.blastGap + CN.blast);
    expect(2 * CONFIG.stamina.rollCost).toBe(60);
  });

  it('timeline: telegraph 0.9 s, a 0.15 s damage window, 0.8 s recovery (Phase 1)', () => {
    const ctx = makeCtx();
    const cone = new ConeBreath();
    ctx.playerPos.set(0, 0, 8);
    cone.start(ctx);
    let t = 0;
    let firstHit = -1;
    let hitSteps = 0;
    while (!cone.isBossFree() && t < 5) {
      cone.update(STEP, ctx);
      t += STEP;
      if (cone.checkPlayerHit(spheresAt(0, 8))) {
        if (firstHit < 0) firstHit = t;
        hitSteps++;
      }
    }
    expect(firstHit).toBeCloseTo(CN.telegraph, 1);
    expect(hitSteps * STEP).toBeCloseTo(CN.blast, 1);
    expect(t).toBeCloseTo(CN.telegraph + CN.blast + CN.recovery, 1);
  });

  it('rage: two separate damage windows 0.70 s apart', () => {
    const ctx = makeCtx({ rage: true });
    const cone = new ConeBreath();
    cone.start(ctx);
    const starts: number[] = [];
    let was = false;
    let t = 0;
    while (!cone.isBossFree() && t < 5) {
      cone.update(STEP, ctx);
      t += STEP;
      const on = cone.blasting;
      if (on && !was) starts.push(t);
      was = on;
    }
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeCloseTo(CN.blastGap, 1);
  });
});

describe('Flame Beam (GAME_DESIGN §6.5 F, 2026-10-12)', () => {
  it("the sweep side follows the player's sideways movement; below the dead zone the fallback decides", () => {
    // Boss → player along +Z; moving toward +X increases yaw (atan2(x, z)).
    expect(sweepSide(0, 1, 5, 0, 0)).toBe(1);
    expect(sweepSide(0, 1, -5, 0, 1)).toBe(-1);
    expect(sweepSide(0, 1, 0.2, 0, 0.9)).toBe(1);
    expect(sweepSide(0, 1, 0.2, 0, 0.1)).toBe(-1);
  });

  it('the beam only sweeps one way, never past the player, and never reverses', () => {
    expect(beamStep(0, 1, 1, 0.1)).toBeCloseTo(0.1); // chases at the max rate
    expect(beamStep(0, 0.05, 1, 0.1)).toBeCloseTo(0.05); // does not overshoot
    expect(beamStep(0.5, 0.2, 1, 0.1)).toBe(0.5); // the player is behind the sweep: it holds
    expect(beamStep(0, -1, -1, 0.1)).toBeCloseTo(-0.1);
  });

  it('segment distance', () => {
    expect(segmentDistance(1, 5, 0, 0, 0, 10)).toBeCloseTo(1);
    expect(segmentDistance(0, -2, 0, 0, 0, 10)).toBeCloseTo(2);
  });

  it('charges, locks onto the player, sweeps after a running player, and keeps firing after it hits (1.6)', () => {
    const ctx = makeCtx();
    const beam = new FlameBeam();
    ctx.playerPos.set(0, 0, 10);
    ctx.playerVel.set(6, 0, 0); // running toward +X
    beam.start(ctx);
    let t = 0;
    while (beam.phaseName === 'charge') {
      beam.update(STEP, ctx);
      t += STEP;
    }
    expect(t).toBeCloseTo(BM.charge, 1);
    expect(beam.sweepDirection).toBe(1);
    expect(beam.groundDistance).toBeCloseTo(10, 6); // aimed at the player's feet
    expect(beam.checkPlayerHit(spheresAt(0, 10))).toBeNull(); // the front has not arrived yet
    ctx.playerVel.set(0, 0, 0);
    let travel = 0;
    while (beam.front < 10 - 1e-9) {
      beam.update(STEP, ctx);
      travel += STEP;
    }
    expect(travel).toBeCloseTo((10 - BM.startOffset) / BM.travelSpeed, 1); // the front travels at 14 m/s
    expect(beam.checkPlayerHit(spheresAt(0, 10))).not.toBeNull();
    beam.update(STEP, ctx);
    expect(beam.phaseName).toBe('fire'); // the hit does not stop it
    expect(beam.checkPlayerHit(spheresAt(0, 10))).not.toBeNull();
  });

  it('a player who rolls against the sweep gets behind it, and the beam does not turn back', () => {
    const ctx = makeCtx();
    const beam = new FlameBeam();
    ctx.playerPos.set(0, 0, 10);
    ctx.playerVel.set(6, 0, 0);
    beam.start(ctx);
    while (beam.phaseName === 'charge') beam.update(STEP, ctx);
    ctx.playerPos.set(-4, 0, 10); // rolled to the other side
    ctx.playerVel.set(0, 0, 0);
    const a0 = beam.angle;
    for (let i = 0; i < 30; i++) beam.update(STEP, ctx);
    expect(beam.angle).toBe(a0);
    expect(beam.checkPlayerHit(spheresAt(-4, 10))).toBeNull();
  });

  it('walking sideways at full speed from the lock flash outruns it at a normal distance (8 m)', () => {
    for (const rage of [false, true]) {
      const ctx = makeCtx({ rage });
      const beam = new FlameBeam();
      const r = 8;
      let a = 0;
      let t = 0;
      const lockAt = (rage ? BM.rageCharge : BM.charge) - BM.lockLead;
      ctx.playerPos.set(0, 0, r);
      beam.start(ctx);
      let hit = false;
      for (let i = 0; i < 300 && beam.phaseName !== 'recovery' && beam.phaseName !== 'done'; i++) {
        t += STEP;
        if (t >= lockAt) {
          a += (6 / r) * STEP; // circle the boss at 6 m/s from the lock flash on
          ctx.playerPos.set(Math.sin(a) * r, 0, Math.cos(a) * r);
          ctx.playerVel.set(Math.cos(a) * 6, 0, -Math.sin(a) * 6);
        }
        beam.update(STEP, ctx);
        if (beam.checkPlayerHit(spheresAt(ctx.playerPos.x, ctx.playerPos.z))) hit = true;
      }
      expect(hit).toBe(false);
    }
  });

  it('standing still at the lock is hit', () => {
    const ctx = makeCtx();
    const beam = new FlameBeam();
    ctx.playerPos.set(0, 0, 8);
    beam.start(ctx);
    let hit = false;
    for (let i = 0; i < 200 && !hit; i++) {
      beam.update(STEP, ctx);
      if (beam.checkPlayerHit(spheresAt(0, 8))) hit = true;
    }
    expect(hit).toBe(true);
  });

  it('beyond ~12 m sprinting is not enough (roll through it)', () => {
    const ctx = makeCtx();
    const beam = new FlameBeam();
    const r = 13;
    let a = 0;
    let t = 0;
    const lockAt = BM.charge - BM.lockLead;
    ctx.playerPos.set(0, 0, r);
    beam.start(ctx);
    let hit = false;
    for (let i = 0; i < 400 && !hit && beam.phaseName !== 'recovery'; i++) {
      t += STEP;
      if (t >= lockAt) {
        a += (6 / r) * STEP;
        ctx.playerPos.set(Math.sin(a) * r, 0, Math.cos(a) * r);
        ctx.playerVel.set(Math.cos(a) * 6, 0, -Math.sin(a) * 6);
      }
      beam.update(STEP, ctx);
      if (beam.checkPlayerHit(spheresAt(ctx.playerPos.x, ctx.playerPos.z))) hit = true;
    }
    expect(hit).toBe(true);
  });

  it('the ground point is clamped to 6–26 m', () => {
    const ctx = makeCtx();
    const beam = new FlameBeam();
    ctx.playerPos.set(0, 0, 3);
    beam.start(ctx);
    while (beam.phaseName === 'charge') beam.update(STEP, ctx);
    expect(beam.groundDistance).toBe(BM.minGround);
  });

  it('the boss taking damage stops the beam', () => {
    const ctx = makeCtx({ rage: true });
    const beam = new FlameBeam();
    beam.start(ctx);
    while (beam.phaseName === 'charge') beam.update(STEP, ctx);
    beam.onBossHit();
    expect(beam.phaseName).toBe('recovery');
  });
});

describe('Meteor Shower and rage Crown Rain (GAME_DESIGN §6.5 C, G, 2026-10-12)', () => {
  it('falls for 10 s at about 12 per second, all inside the arena, then stops', () => {
    const ctx = makeCtx({ seed: 5 });
    const h = ctx.hazards;
    h.startMeteors(ctx.rng);
    const targets: Vector3[] = [];
    for (let t = 0; t < 12; t += STEP) {
      h.step(STEP);
      h.meteorTargets(targets);
      for (const p of targets) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(CONFIG.arena.radius - CONFIG.meteor.radius + 1e-9);
    }
    expect(h.meteorsSpawned).toBeGreaterThan(CONFIG.meteor.rate * CONFIG.meteor.duration * 0.9);
    expect(h.meteorsActive).toBe(false);
  });

  it('a meteor hits within 1.8 + 0.4 m of its target at impact; clear() removes them', () => {
    const ctx = makeCtx({ seed: 9 });
    const h = ctx.hazards;
    h.startMeteors(ctx.rng);
    const targets: Vector3[] = [];
    let hit = false;
    for (let t = 0; t < 3 && !hit; t += STEP) {
      h.meteorTargets(targets);
      const aim = targets[0]?.clone();
      h.step(STEP);
      if (aim && h.check(spheresAt(aim.x + 2.1, aim.z))) hit = true;
    }
    expect(hit).toBe(true);
    h.clear(false);
    expect(h.meteorsActive).toBe(false);
  });

  it('rage Crown Rain circles use the larger 1.8 m kill radius', () => {
    const ctx = makeCtx({ rage: true });
    const rain = new CrownRain();
    ctx.playerPos.set(0, 0, 10);
    rain.start(ctx);
    const t0 = ctx.hazards.waveTargets(0)[0].clone();
    for (let i = 0; i < 300 && !rain.isBossFree(); i++) rain.update(STEP, ctx);
    let hit = false;
    for (let i = 0; i < 200 && !hit; i++) {
      ctx.hazards.step(STEP);
      if (ctx.hazards.check(spheresAt(t0.x + 2.1, t0.z))) hit = true; // 2.1 < 1.8 + 0.4
    }
    expect(hit).toBe(true);
  });
});

describe('visuals lead the damage (2026-10-12)', () => {
  it('Rebuke: the kill reach follows the drawn spikes (2.0 m at the start, 4.5 m by 70% of the burst)', () => {
    expect(rebukeReach(0)).toBeCloseTo(CONFIG.rebuke.startRadius);
    expect(rebukeReach(CONFIG.rebuke.burst * 0.7)).toBeCloseTo(CONFIG.rebuke.endRadius);
    expect(rebukeReach(STEP)).toBeLessThan(CONFIG.rebuke.endRadius - 1);
  });

  it('Cone: hold 0.12 s, then the release 0.08 s before each damage window (rage: twice, 0.70 s apart)', () => {
    for (const rage of [false, true]) {
      const ctx = makeCtx({ rage });
      const releases: number[] = [];
      let holding = 0;
      let t = 0;
      ctx.vfx = {
        coneHold: () => holding++,
        coneRelease: () => releases.push(t),
        coneAftermath: () => undefined,
        coneWave: () => undefined,
      } as unknown as typeof ctx.vfx;
      const cone = new ConeBreath();
      cone.start(ctx);
      let firstWindow = -1;
      while (!cone.isBossFree() && t < 5) {
        t += STEP;
        cone.update(STEP, ctx);
        if (firstWindow < 0 && cone.blasting) firstWindow = t;
      }
      expect(releases).toHaveLength(rage ? 2 : 1);
      expect(firstWindow - releases[0]).toBeCloseTo(CN.releaseLead, 1);
      if (rage) expect(releases[1] - releases[0]).toBeCloseTo(CN.blastGap, 1);
      expect(holding * STEP).toBeCloseTo(CN.hold * (rage ? 2 : 1), 1);
    }
    expect(CN.hold + CN.releaseLead).toBeLessThan(CN.rageTelegraph);
    expect(CN.hold + CN.releaseLead).toBeLessThan(CN.blastGap - CN.blast);
  });
});
