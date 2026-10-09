# Design — elden-cube-game (Stage 0 + Stage 1)

Implements `requirements.md`. The architecture is AR §1–§7 and §13. This document records **how** the modules fit together and the few implementation decisions the source documents leave open. All numbers come from `CONFIG` (GD values); none are repeated here except for illustration.

---

## 1. Overview

```
main.ts ── WebGL check ── fonts.ready ── new Game(renderer) ── Loop.start()
                                             │
 Loop (fixed 1/60, hitStop, timeScale, paused)│ update(STEP) / render()
                                             ▼
 Game ─┬─ FlowMachine (pure: states, timers, locks, fade)  ← unit tested
       ├─ Input            (edges + held keys, blur)
       ├─ CameraController (orbit / lock-on / blend / shake)
       ├─ Arena            (static scene)
       ├─ Player ── PlayerMotor (pure: swing/roll timers, movement) ← unit tested
       ├─ Boss   ── BossBrain  (pure: HP/phase, cooldown, tactics, chooseAttack) ← unit tested
       │            └─ active Attack (CubeSlam | RoyalCharge | CrownShards)
       ├─ Debris list, Effects
       ├─ UI (DOM overlay)
       └─ Audio (file-first, sfx recipe fallback)
```

**Testability principle:** each gameplay module separates a **pure logic core** (no DOM, no WebGL; plain numbers and `three` math types only) from its **view** (meshes). The core is exported from the same file named in AR §3, so no new files are needed. `three` can be imported in Node, so math types and `Object3D` work in Vitest; only `WebGLRenderer` needs a browser. No module touches `window`/`document` at import time.

## 2. Config and flags

### 2.1 `config.ts`
```ts
export const CONFIG = {
  player:  { spawn: [0,0,12], maxSpeed: 6, accel: 10, decel: 4, turnRate: 4, turnMinSpeed: 0.5,
             radius: 0.4, hitSpheres: [{ y: 0.5, r: 0.4 }, { y: 1.3, r: 0.4 }], bossPushSpeed: 4 },
  swing:   { restDeg: 20, windup: { t: 0.20, toDeg: 200 }, active: { t: 0.15, toDeg: 70, lunge: 10 },
             recovery: { t: 0.40, toDeg: 20 }, bladePoints: [0.5, 1.3, 2.1] },
  roll:    { distance: 4.0, duration: 0.55, iStart: 0.05, iEnd: 0.40, turnMult: 3,
             recovery: 0.25, recoverySpeed: 2, swayDeg: 8, cooldown: 0.15, tuckDeg: 70 },
  wobble:  { k: 120, c: 8, clampDeg: 80, legDeg: 35, armDeg: 25, walkHz: 1.8, armLag: -0.03,
             headK: 80, headC: 6, headPush: -0.02, nodDeg: 5, leanDeg: 8 },
  boss:    { hp: 5, halfSize: 2, grace: 2.0, bobAmp: 0.08, bobHz: 1.2, turnRate: 2.0,
             chaseDist: 7, chaseSpeed: 1.5, cooldown: 2.5, invuln: 0.4, clampRadius: 27, knockback: 0.3, … },
  tactics: { closeDist: 4.0, closeTrigger: 3.0, decayMult: 2, annoyedBobAmp: 0.16,
             punishDist: 5.0, punishCut: 0.8, punishFloor: 0.3, glareTime: 0.5, glareBrowDeg: 10, glarePupil: 0.7 },
  rage:    { atHp: 2, transition: 1.0, colorFade: 0.5, shake: 0.1, speedMult: 1.4, telegraphMult: 0.6,
             cooldown: 1.6, camShake: { amp: 0.2, t: 0.6 } },
  rageUpgrades: { doubleSlam: false, chargeUTurn: false, staggeredShards: false,
                  doubleSlamDelay: 0.5, doubleSlamHop: 0.5, doubleSlamVolume: 0.7,
                  uTurnTelegraph: 0.4, staggerExtra: 0.3, centerPulseHz: 1, sidePulseHz: 3 },
  slam:    { telegraph: 1.0, riseHeight: 4, hang: 0.15, drop: 0.20, shadowR: 2.2, shadowOpacity: 0.5,
             ringStart: 2.2, ringEnd: 14, ringSpeed: 8, ringWidth: 1.0, ringHeight: 0.3, camShake: {…} },
  charge:  { telegraph: 1.0, shake: 0.1, speed: 18, maxTime: 2.0, stopRadius: 27, skid: 0.3 },
  shards:  { telegraph: 1.0, circleR: 1.2, sideOffset: 2.5, lead: 0.5, size: 0.6, hitR: 0.35, flight: 0.8 },
  camera, arena, lights, colors, fx, ui, transitions, audio,
  easy:    { speedMult: 0.75, telegraphMult: 1.3, cooldownMult: 1.3 },
} as const;   // typed as DeepReadonly
```
The full object holds every value in GD §1–11, including the UI/transition timings, hit-reaction values, debris ranges and audio levels. The rage shard flight time (0.57 s) is **derived** (`flight / speedMult`), not stored separately (D4).

### 2.2 `flags.ts`
- `parseFlags(search: string) → { easy: boolean; debug: boolean }`. It is pure and tested. A presence check is enough (`?easy`, `?debug`, `?easy&debug`).
- `FLAGS` is parsed once from `location.search` (lazily, so tests never touch `location`).
- Multipliers (pure, take `phase` and `flags`):
  - `speedMult = (rage ? 1.4 : 1) × (easy ? 0.75 : 1)`
  - `telegraphMult = (rage ? 0.6 : 1) × (easy ? 1.3 : 1)`
  - `cooldownFor(phase) = (rage ? 1.6 : 2.5) × (easy ? 1.3 : 1)`
- Shard flight time = `CONFIG.shards.flight / speedMult` (D4).

## 3. Loop (`loop.ts`)

`class Loop { start(); hitStop(s); setTimeScale(scale, s); paused: boolean }`. It implements AR §4.1 literally. It calls `game.update(STEP)` and `game.realUpdate(frameDt)`; the second is called every frame, **including during hit-stop and pause**, and counts real-time timers (input locks, auto-return, fades, the debug overlay at 4 Hz). It also calls `game.render()`.

## 4. Game flow (`game/Game.ts`)

### 4.1 `FlowMachine` (pure, exported from `Game.ts`)
It owns `state`, its timers and the fade value. It emits **commands** that `Game` executes, so the timing logic can be unit tested without any rendering.

| State | Sim timers | Real timers | Emits |
|---|---|---|---|
| TITLE | — | `lock` 0.5 s after the fade-in | `startFight` on `anyStart` when unlocked |
| FIGHT | — | — | → DYING / BOSS_DEFEATED on events from Game |
| DYING | `t` | — | `breakPlayer` @0.10, `showYouDied` @0.60, → TO_TITLE @2.00 |
| BOSS_DEFEATED | `t` | — | → VICTORY_SCREEN @1.50 (`playVictory`) |
| VICTORY_SCREEN | — | `lock` 1.0, `idle` 8.0 | → TO_TITLE on `anyStart` after lock, or at idle 8.0 |
| TO_TITLE | — | `fade` | `setFade(o)`, `setAudioDuck(…)`; **`reset` exactly once** in the frame opacity reaches 1; → TITLE after the 0.8 s fade-in |

**Timing reference point (design decision):** the death and defeat timelines are measured **from the hit**, matching GD §9/§6.6. The hit-stop freezes simulation time, so the DYING timer is initialised to the hit-stop length (0.10). It then resumes at 0.10 when the freeze ends, which is exactly when the body breaks (GD "0.10 s"). YOU DIED appears at 0.60 and the transition starts at 2.00, all measured from the hit. BOSS_DEFEATED works the same way: the timer starts at 0.20, and the 1.5 s is in simulation time (AR §4.2), so slow motion stretches it in real time.

Pause: `paused` is a flag next to `state`, valid only in FIGHT. While paused, the loop skips `update`. A `pointerdown` resumes play and consumes that click's swing edge (D2).

### 4.2 `Game` (view and orchestration)
- `update(dt)`, in order: input edges → flow → player → boss/attack → collisions (weapon → boss; attack → player if `!player.isInvincible()` and not defeated) → debris/effects → camera → audio triggers → `input.endFrame()`.
- **Start click and resume click never swing:** when Game consumes `anyStartPressed` on TITLE, or a resume click, it also calls `input.consume('swing')` in the same frame (D2). The start key/click also calls `audio.unlock()`.
- `reset()`: player and boss `reset()`; dispose the active attack; clear debris and effects; reset camera shake; set the camera to the fixed orbit start angle; UI to the title layout. It increments nothing; the attempt counter increments in `startFight`.
- Death: `onPlayerHit(source)` → `loop.hitStop(0.10)`, flow → DYING, `attack.dispose()` (which stops long sounds), `boss.gloat()`. At 0.10: `debris.push(...player.breakApart(source))`, `boss.gloatAt(debrisCenter)`, camera look-at → debris center.
- Defeat: `takeHit → 'defeated'` → `loop.hitStop(0.20)`, dispose the attack, set `player.killable = false`, `debris.push(...boss.breakApart())`, `loop.setTimeScale(0.5, 1.0)`, shake, `boss_break`.

## 5. Input (`systems/input.ts`)

```ts
class Input {
  held(code): boolean;                 // KeyW/A/S/D
  moveAxis(): { x: number; z: number }; // raw −1..1 (normalized by Player)
  consume(edge: 'roll'|'swing'|'mute'|'anyStart'|'debug1'|'debug2'|'debug3'|'debugK'|'debugG'|'resumeClick'): boolean;
  endFrame();                          // drop unconsumed edges (no buffering)
  onFocusLost: () => void;
}
```
- `keydown`: ignore `repeat`. `Space` sets `roll` (with `preventDefault`), `KeyF` sets `swing`, `KeyM` sets `mute`, and any code other than `KeyM` sets `anyStart`. Debug keys set their edge only when `FLAGS.debug`.
- `pointerdown` on the canvas, button 0: sets `swing`, `anyStart` and `resumeClick`.
- `contextmenu` is blocked on the canvas.
- `blur` or `visibilitychange` (hidden) clears held keys and edges, then calls `onFocusLost`.
- Edges are cleared at the end of every simulation step, so a press is used at most once and never carries over (no buffering). Edges that arrive during hit-stop or pause are kept until the next simulation step (otherwise clicks during hit-stop would be lost). The exception is the resume click, which is consumed in `realUpdate`.

## 6. Player (`entities/Player.ts`)

### 6.1 `PlayerMotor` (pure core)
State: `pos`, `vel`, `yaw`, `action: 'free' | 'windup' | 'active' | 'recovery' | 'rolling' | 'dizzy'`, `actionT`, `rollCooldown`, `rollDir`, `swingHit`, `godMode`, `killable`.

`step(dt, moveDir /*world, normalized or zero*/, bossPos, wantRoll, wantSwing, canSwing) → events[]`

- **Gating:**
  - A roll starts only when `action === 'free'` and `rollCooldown <= 0`.
  - A swing starts only when `action === 'free'` and `canSwing` (false in BOSS_DEFEATED). Roll cooldown does not block a swing (D1).
- **free:**
  - `vel.xz` moves toward `moveDir × maxSpeed`, at `accel` with input and `decel` without (with a guard against overshoot).
  - `yaw` turns at `turnRate` toward the target from GD §4.2.
- **windup / recovery:** movement and roll input are ignored; `vel` decays at `decel`.
- **active:** `vel = facing × lunge`.
  - At entry: emits `swingStart` (→ `swing` sound).
  - At exit without a hit: emits `swingMiss` (→ `boss.onPlayerMissedSwing`, and the optional `swing_ground` sound).
- **rolling:**
  - Position comes from the displacement curve: `p = p0 + dir × distance × easeOut(t / duration)`. Velocity is derived from it for the wall and pushback.
  - `yaw` turns at 3× the turn rate.
  - At the end: `vel = dir × 2` → `dizzy` (emits `rollEnd`).
  - At start: emits `rollStart`.
- **dizzy:** all input is ignored and `vel` decays at `decel`. After 0.25 s → `free`, with `rollCooldown = 0.15`.
- **isInvincible():** `godMode || (action === 'rolling' && 0.05 <= actionT < 0.40)`.
- **Then:** arena clamp (radius 29.6, outward velocity removed), then boss pushback (`sphereOBB` on the lower sphere against the boss box; push out along the returned direction and set the outward velocity to 4 m/s), skipped during boss attacks (GD §4.2). y is always 0.
- **Blade hit:** `markSwingHit()` sets `swingHit`. `isSwingActive()` is `action === 'active' && !swingHit`, which guarantees at most one hit per swing.

The swing angle θ(t) is a pure function `swingAngle(action, actionT)` using the eased curves from GD §4.3.

### 6.2 `Player` (view)
- The hierarchy is built exactly as in GD §4.1. Positions are relative to the roll pivot (y − 0.90). Geometries and materials are created once.
- **Pitch convention:** a pivot pitch of `rotation.x = −θ` turns the arm's local −Y toward +Z. So θ = 0 points down and θ = 90° points forward.
- **Wobble:** `springStep` per limb, with the targets from GD §4.4.
  - The right arm, when not swinging, targets **rest θ 20° + its walk term**. The left arm targets 0° + its walk term.
  - While swinging, the right arm's pitch is set directly from `swingAngle`.
  - While rolling, all limbs target 70°; the roll pivot `rotation.x = 2π × easeInOut(t / 0.55)`.
  - While dizzy, the body sways ±8° on Z.
- **getBladePoints():** call `updateMatrixWorld` on the root first. The points are the right shoulder pivot's `matrixWorld` applied to local `(0, −d, 0)` for d ∈ {0.5, 1.3, 2.1}. Preallocated vectors are reused.
- **getHitSpheres():** 2 preallocated spheres at `pos + (0, 0.5 | 1.3, 0)`.
- **breakApart(source):**
  - Detaches 7 meshes (body, head with eyes, 2 arms, 2 legs, weapon) via `scene.attach()`, which keeps their world transforms.
  - Gives each a velocity away from `source` with the ranges from GD §9, using `rng`.
  - Returns `DebrisPiece[]`.
  - `reset()` re-parents the meshes to their pivots with their original local transforms.
- `?debug`: the material colors lerp 30% toward white while invincible.

## 7. Boss (`entities/Boss.ts`)

### 7.1 Pure exports (unit tested)
```ts
type AttackId = 'slam' | 'charge' | 'shards';
chooseAttack(history: AttackId[], distance: number, closeTimer: number, rng: Rng): AttackId
updateCloseTimer(timer: number, distance: number, dt: number): number
applyMissPunish(remaining: number, alreadyPunished: boolean): { remaining: number; punished: boolean }
class BossBrain { hp; phase: 'p1'|'rage'; invuln; mode; cooldownLeft; history; closeTimer; punished;
                  takeHit(): 'hit'|'rage'|'defeated'|'ignored'; update(dt, distance, …) }
```
- **chooseAttack:**
  - `blocked = history.length >= 2 && history[-1] === history[-2] ? history[-1] : null`.
  - If `closeTimer >= 3`: return `slam`, or `shards` if `slam` is blocked.
  - Otherwise: `valid = [slam, charge(if distance > 6), shards] − blocked`, then pick uniformly with `rng`.
- **applyMissPunish:** if already punished, unchanged. Otherwise `{ remaining: max(0.3, remaining − 0.8), punished: true }`. It receives the already easy-scaled remaining time, because `cooldownLeft` was started from `cooldownFor(phase)` (D3).
- **BossBrain.mode:** `'grace' → 'cooldown' ⇄ 'attacking'`, plus `'rageTransition'`, `'gloat'` and `'defeated'`.
- **takeHit:**
  - `'ignored'` if `invuln > 0` or the mode is `rageTransition`.
  - Otherwise `hp--`, `invuln = 0.4`.
  - `hp === 0` → `'defeated'`. `hp === 2` (the 3rd hit) → `'rage'`: in the same call `BossBrain` sets `mode = 'rageTransition'` and `cancelRequested = true`; `Game` immediately calls `attack.cancel(withPuff = true)` (removes ring/shards/circles with a puff, stops long sounds) and clears the attack (D9). Hits 1, 2, 4 leave the attack running. Otherwise `'hit'`.
- **Cooldown end** (in `update`):
  - Call `chooseAttack`. If the close timer triggered it, reset the close timer to 0.
  - Push the chosen attack to the history and set the mode to `attacking`.
  - `punished` resets each time a new cooldown starts.
  - Debug forcing (`1`/`2`/`3`) overrides the next choice.

### 7.2 `Boss` (view and motion)
- The model is built per GD §6.1. The squash/flash/bob/shake/rage colour are visual state in `fx/effects.ts` helpers. The punish glare tilts the eyebrows +10° and scales the pupils to 0.7 for 0.5 s.
- **Motion:**
  - Yaw toward the player at 2 rad/s, except during a charge dash.
  - Chase at 1.5 m/s × `speedMult` when more than 7 m away and in `cooldown` or `grace` mode.
  - Clamp to radius 27.
  - The bob amplitude is 0.16 when `mode === 'cooldown' && closeTimer >= 3`.
- **Gloat:** cancel the attack and stop moving. Turn toward the target at the normal rate and keep the idle bob.
- **breakApart():**
  - Hide the boss group. Create 8 cubes of 2 m from a shared geometry and a clone of the current body colour, at the octant centres (±1, 1 ± 1, ±1) in boss space.
  - Velocities: outward 4–8 m/s, upward 5–9 m/s, spin up to 6 rad/s.
  - The crown group is detached and given a small velocity and spin, so it falls and then rolls on the debris ground physics.
- `getBox()` returns `{ center: pos + (0, 2, 0) + bob?, halfSize: 2, yaw }`. Only the boss's Y position counts for collision (rise/drop and the hop), not the bob or the squash.

## 8. Attacks (`attacks/*.ts`)

They share `Attack` (AR §4.4). `AttackContext` carries `boss`, `playerPos`, `playerVel`, `scene`, `audio`, `shake`, `speedMult`, `telegraphMult`, `rage: boolean`, `upgrades` (`CONFIG.rageUpgrades`, honoured only when `rage`), `rng`, `effects`. Each attack is a phase list driven by `phaseT`. Meshes come from pooled geometries and materials.

| Attack | Phases | Kill check (`checkPlayerHit`) |
|---|---|---|
| CubeSlam | `rise(T)` → `hang 0.15` → `drop 0.20` → `impact` → `ring` [→ `hop` → `impact2`, upgrade] | On the impact frame: `sphereOBB` of either sphere against the boss box at y = 0 → source = boss center. During the ring: `inRingBand(playerPos, center, r, 0.5 + 0.4)` for each live ring. Finished when every ring has reached r ≥ 14 |
| RoyalCharge | `telegraph(T)` → `lock` → `dash` → `skid 0.3` [→ `uturnTelegraph 0.4` → `lock` → `dash` → `skid`, upgrade, only if the player is alive] | During the dash only: either sphere `sphereOBB` the boss box → source = boss center |
| CrownShards | `telegraph(T)` (circles placed at start) → `flight` (3 ballistic shards; center + 0.3 s with the upgrade) → each `land` → done | In flight: `sphereSphere(shard, 0.35, sphere, 0.4)`. On each landing: `inCircle(player, c, 1.6)` → source = shard/circle center |

- T = base telegraph × `telegraphMult`. Speeds are multiplied by `speedMult`. Shard flight time = 0.8 / `speedMult` (D4).
- **Ballistic shards:** start at the crown top (boss pos + (0, 4.8, 0)), target at the circle center at y = 0.3 (resting on the ground). `v0 = (target − start − ½ g T²) / T` with g = (0, −20, 0), then semi-implicit Euler at the fixed step. With semi-implicit Euler the shards land within a few cm of the circle center. The landing frame snaps each shard to its exact target, so the landing check uses the circle center.
- **Charge:** stops when the horizontal radius reaches 27 or the dash time reaches 2.0. Knockback is skipped while the boss is dashing (`boss.isDashing`).
- **Upgrade tells:**
  - Double Slam: the shadow circle's opacity pulses twice during the telegraph.
  - U-turn: the red pulse stays on through the first skid.
  - Staggered Shards: the center circle pulses at 1 Hz, the side circles at 3 Hz (otherwise all pulse at one default rate).
- `dispose()` removes the meshes and stops `slam_rise`/`charge_windup`. It is called on finish, death, defeat, the rage transition and reset.
- `isFinished()` is true only after all upgrade phases.

## 9. Camera (`systems/camera.ts`)

`CameraController { mode: 'orbit' | 'lockOn'; update(dt, player, boss); blendToLockOn(0.8); setOrbitStart(); shake(amp, t); setLookOverride(pos | null); forwardXZ(): Vector3 }`
- **orbit:** angle += 0.15 × dt. Position `(14 sin a, 6, 14 cos a)`, looking at `(0, 2, 0)`. `setOrbitStart()` resets the angle to a fixed value (0, i.e. behind the player spawn on +Z).
- **lockOn:** desired position and look-at per GD §7, smoothed with `1 − exp(−6 dt)`.
- **Blend:** `w = easeInOut(t / 0.8)`; the result is `lerp(orbitPose, lockOnPose, w)`, and the smoothing starts from the blended pose.
- **Shake:** offset = random unit vector × amp × (1 − t / dur). A new shake replaces the current one only if `newAmp > currentAmp × remainingFraction`.
- The camera Y is clamped to ≥ 1.0 after the shake.
- **forwardXZ():** the camera's world direction with y = 0, normalized. Used as the movement basis.

## 10. Collision, math, RNG

- `collision.ts`: exactly the five functions in AR §5.4. `sphereOBB` returns `{ hit: boolean, normal: Vector3 /*world, horizontal for push-out*/, depth }`. Out-parameters avoid allocation.
- `math.ts`: `lerp`, `clamp`, `easeIn/Out/InOut` (quadratic), `springStep` (returns `[x, v]` or mutates a `{x, v}` struct), `randRange(rng, a, b)`, `turnToward(yaw, target, maxStep)` (shortest arc).
- `rng.ts`: mulberry32 `createRng(seed)`. The game seeds it from `Date.now()`; tests use fixed seeds.

## 11. Effects and debris (`fx/`)

- **debris.ts:** `DebrisPiece { mesh, vel, angVel, groundR, asleep }` and `stepDebris(pieces, dt)` per AR §5.6. `groundR` is half the smallest box dimension (or the radius for spheres). Pieces are removed and their materials disposed on reset; shared geometries are kept.
- **effects.ts:**
  - Reusable meshes: the slam shadow circle, the shockwave ring (a `RingGeometry` band scaled each frame, and a thin `CylinderGeometry` shell for the 0.3 m height; opacity fades over the last 20% of travel), warning circles and shard cubes.
  - Boss visual springs: squash (spring back over ~0.25 s), the flash timer, the emissive pulse.
  - The shard landing puff: 6 tiny debris cubes.
  - All of these are kept within the < 100 draw-call budget.

## 12. UI (`systems/ui.ts`, `styles.css`, `index.html`)

- `index.html` contains `<canvas id="game">` and `<div id="overlay">` with one child per GD §2 element (static markup). It links `favicon.svg` and sets the title.
- `UI` API: `show(state)`, `setHealth(hp, flashIndex?)`, `setAttempts(n)`, `setSound(on)`, `setPaused(b)`, `setFade(o)`, `showStartPrompt(b)`, `showContinuePrompt(b)`, `showYouDied()`, `showVictory()`, `showWebGLError()`, `debug(text)`.
- State changes only toggle classes. The fade layer is set through the inline `opacity` style each frame, and only when the value changes.
- CSS: the blink keyframes (1 s, 1 ↔ 0.3), 0.3 s opacity transitions for the title and HUD, the 0.5 s fade + scale 1.1 → 1.0 for the result text, the segment flash (white for 0.15 s via an `.flash` class), and `z-index` order: canvas < HUD < screens < pause < fade.
- The `#debug` element is updated at 4 Hz from `realUpdate`.

## 13. Audio (`systems/audio.ts`, `systems/sfx.ts`)

- `SFX_IDS` is a const tuple of the 17 IDs from AS §1.1.
- **resolveSfxSources(glob: Record<string, string>):** pure.
  - It takes the base name without the extension. Unknown names go into a list, logged once with `console.info`.
  - Priority is mp3 > ogg > wav. Returns `Map<SfxId, url>`.
- **Audio:**
  - `unlock()` creates or resumes the `AudioContext`, builds `master` (0.8) and `duck` gain nodes (the duck is used for the TO_TITLE fade to 30%), creates the shared 1 s noise buffer, then fetches and decodes the files (one `console.warn` per failure, then that sound falls back to its recipe).
  - `play(id, { duration?, pitch?, volume? })` returns a `SoundHandle { stop() }`.
  - `toggleMute()`.
  - Before `unlock`, everything is a no-op.
- **File playback:** a `BufferSource` → gain (the relative loudness from AS §1.1 × the `volume` option) → `duck` → `master` → destination. Pitch variation is applied as `playbackRate`.
- **sfx.ts:** one function per ID, `(ctx, out: AudioNode, noise: AudioBuffer, opts) → SoundHandle`, implementing AS §1.2 exactly, with shared `osc`, `noiseSrc` and `env` helpers. The stoppable recipes (`slam_rise`, `charge_windup`) ramp to 0.0001 over 20 ms on `stop()` to avoid clicks.
- Footstep timing (every 0.30 s while walking above 1 m/s) is kept in `Player` and emitted as an event.

## 14. Debug (`?debug`)

- **Text (4 Hz):** FPS (frames counted over the last 0.25 s window), state, boss phase/mode/attack/HP, roll phase and i-frames, close timer, `PUNISH!` marker (shown for 1 s).
- **Wireframes:** a `LineSegments`/wireframe material that reuses the hit spheres, the boss box (`BoxHelper`-style, yaw only), the blade points (small spheres), the shockwave band (two thin rings at r ± 0.9) and the shard spheres. Created only when `debug` is on.
- **Keys:** `1`/`2`/`3` set `boss.forceNext`; `K` calls `game.applyBossHit()` (the same path as a weapon hit, including invulnerability); `G` toggles `player.godMode`.

## 15. Error handling

- WebGL check: try to create a canvas with `getContext('webgl2') || getContext('webgl')`. On failure, show the error message and do not create `Game`.
- An audio decode failure gives one warning and the recipe is used. `AudioContext` errors on unlock are caught, and the game continues silently.
- No runtime network requests other than the bundled same-origin sound files.
- No `console.log` in production paths. Debug output goes to the overlay only.

## 16. Testing (`app/tests/`)

| File | Covers (req 21.x) |
|---|---|
| `collision.test.ts` | 21.1: each helper, yawed OBB at 0/45/90°, edge-inclusive bounds, sphereOBB push-out normal |
| `math.test.ts` | 21.2: springStep with (120, 8) and (80, 6) at 1/60 settles within tolerance after 3 s, never exceeds 2× the initial error |
| `attackSelection.test.ts` | 21.3: no 3-in-a-row over 1,000 seeded sequences; never charge at d ≤ 6; close-timer forcing incl. the blocked-slam → shards case; every valid attack appears in 1,000 runs |
| `tactics.test.ts` | 21.4, 21.5: updateCloseTimer and applyMissPunish (incl. the easy-scaled input, D3) |
| `bossBrain.test.ts` | 21.6: hit sequence, ignored during invuln and rageTransition; 3rd hit mid-attack → cancel requested + `rageTransition` in the same step; hits 1, 2, 4 mid-attack → attack keeps running (D9) |
| `playerMotor.test.ts` | 21.7, 21.8: swing active window, one hit max; i-frames exactly [0.05, 0.40); roll direction locked despite input change; roll/swing blocked in roll and dizzy; roll blocked but swing allowed in cooldown (D1) |
| `flow.test.ts` | 21.9: DYING → TO_TITLE at 2.0 s; victory lock 1.0 s and auto 8 s; `reset` emitted exactly once, at opacity 1 |
| `flags.test.ts` | 21.10 |
| `sfx.test.ts` | 21.11: resolveSfxSources cases |

- **Browser verification per milestone** (chrome-devtools MCP): open `http://localhost:5173/?debug`, read the console (must be empty of errors and warnings), take screenshots, check FPS in the debug text, and use a Performance trace for 1.6.
- **Manual playtests:** done by the user (User step).

## 17. Stage 0 infrastructure (`infra/`)

- **cdk.json:**
  - `"app": "npx ts-node --prefer-ts-exts bin/infra.ts"`
  - `"context": { "alertEmail": "junsieng55@gmail.com", …CDK defaults }`
  - A `-c alertEmail=…` on the CLI overrides it (standard CDK context precedence).
- **bin/infra.ts:** `const email = app.node.tryGetContext('alertEmail')`. If it is missing, throw `Pass -c alertEmail=you@example.com`. Then `new EldenCubeStack(app, 'EldenCubeStack', { env: { account: CDK_DEFAULT_ACCOUNT, region: 'ap-southeast-1' }, alertEmail })`.
- **lib/EldenCubeStack.ts:** exactly AR §9.2:
  - an S3 `Bucket`
  - a `Distribution` with `S3BucketOrigin.withOriginAccessControl`
  - the `Assets` and `Site` `BucketDeployment`s, with `site.node.addDependency(assets)`
  - a `CfnBudget` with two `EMAIL` subscribers (80% ACTUAL, 100% FORECASTED)
  - three `CfnOutput`s
- **infra scripts:** `synth`, `diff`, `deploy`, `destroy` = `cdk <cmd> --profile elden-personal`, plus `build` = `tsc`. `BucketDeployment` reads `../app/dist`, so `app` must be built first (`cd ../app && npm run build`, AR §9.3). The scripts don't build implicitly.

## 18. Decisions taken in this design (beyond the documents)

These are implementation details that don't change any documented behaviour. Flag any you disagree with.

1. Pure cores (`FlowMachine`, `PlayerMotor`, `BossBrain`) are exported from the existing files instead of new files.
2. Death and defeat timelines are measured from the hit, with the hit-stop counted inside the timer (§4.1).
3. Input edges survive hit-stop and pause until the next simulation step. Otherwise they are dropped at the end of each step (no buffering).
4. The right arm's resting wobble target is 20° (the swing rest angle) plus the walk term.
5. The title orbit start angle is 0 (camera on +Z, behind the player spawn).
6. Easing curves are quadratic.
7. Shards target y = 0.3 (resting on the ground) and snap to the target on landing.

## 19. Resolved: 3rd hit during an attack (D9)

The 3rd hit cancels the running attack and starts the rage transition in the same simulation step. Spawned objects are removed with a small puff (6-cube debris puff per object, reusing the shard landing puff); `slam_rise`/`charge_windup` stop; the boss is untouchable for the 1.0 s transition. `Attack.dispose()` gains an optional `puff` flag. Unit test in `bossBrain.test.ts`.
