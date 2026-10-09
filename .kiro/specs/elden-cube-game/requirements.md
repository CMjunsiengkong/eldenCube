# Requirements — elden-cube-game (Stage 0 + Stage 1)

## Introduction

This spec covers **Stage 0 (Setup)** and **Stage 1 (Game complete and debugged, running locally)** of PROJECT_PLAN.md for "The Elden Cube": a one-on-one browser boss fight (Three.js + TypeScript + Vite) where a clumsy hero fights a crowned cube. One hit kills the player; the cube takes 5 hits.

GAME_DESIGN.md, ARCHITECTURE.md and ASSETS.md are the source of truth. Where this document cites a value, it is the documented value; every tunable value lives in `app/src/config.ts`. Section references like "GD §4.2" mean GAME_DESIGN.md, "AR §8" ARCHITECTURE.md, "AS §1" ASSETS.md, "PP" PROJECT_PLAN.md.

Out of scope (never built): everything in GD §12 and AR §2 "Do not add". Stage 2/3 (AWS deploy, release) belong to the separate spec `elden-cube-deploy`.

---

## Stage 0 — Setup

### Requirement 0.1 — Tools
**User story:** As the builder, I want every required tool installed, so nothing blocks later stages.

1. WHEN Stage 0 starts THEN the agent SHALL check each tool in AR §13.1 (Homebrew, Node.js LTS + npm, git, AWS CLI v2, uv, Google Chrome) and report its version.
2. IF a tool other than Homebrew is missing THEN the agent SHALL explain the install command in one line and install it via Homebrew.
3. IF Homebrew or the Kiro CLI is missing THEN the agent SHALL stop and ask the user to install it (User step).
4. The AWS CDK CLI SHALL NOT be installed globally; it SHALL be a dev dependency of `infra/`.

### Requirement 0.2 — MCP servers
1. The agent SHALL create `eldenCube/.kiro/settings/mcp.json` with exactly the `aws-docs`, `aws-iac` and `chrome-devtools` servers from AR §13.2.
2. WHEN the file is created THEN the agent SHALL stop and ask the user to restart `kiro-cli` from `eldenCube/` and run `/mcp` (User step).
3. Exit: `/mcp` shows all three servers loaded.

### Requirement 0.3 — Scaffold
1. The agent SHALL create `app/` (Vite `vanilla-ts` + `three`, `@fontsource/cinzel`; dev: `vite`, `typescript`, `vitest`, `@types/three` if needed) and `infra/` (CDK TypeScript: `aws-cdk-lib`, `constructs`; dev: `aws-cdk`, `typescript`, `ts-node`, `@types/node`), following the AR §3 layout, with lock files.
2. `app/` SHALL have the scripts and Vite settings of AR §7 and `tsconfig` with `strict: true`; `infra/` SHALL have `cdk.json` per AR §3 with `"context": { "alertEmail": "junsieng55@gmail.com" }` (decision D6), and `synth`/`diff`/`deploy`/`destroy` scripts containing `--profile elden-personal` but no `-c alertEmail` (it comes from `cdk.json`; `-c alertEmail=…` on the command line still overrides it).
3. The agent SHALL add `app/src/assets/sfx/.gitkeep`. Git (decision D7): `git init -b main` in `eldenCube/`, `origin` = https://github.com/CMjunsiengkong/eldenCube.git, `.gitignore` per AR §3, first commit `docs: add project specification`; the user runs `git push -u origin main`. All further git work follows `.kiro/steering/git.md`.
4. `bin/infra.ts` SHALL throw *"Pass -c alertEmail=you@example.com"* when the `alertEmail` context is missing from both `cdk.json` and the command line (AR §9.1), target region `ap-southeast-1` and account from `CDK_DEFAULT_ACCOUNT`.
5. `lib/EldenCubeStack.ts` SHALL be the **full** AR §9.2 stack already in Stage 0 (decision D5): private S3 bucket, CloudFront with OAC, the two BucketDeployments ("Assets", "Site"), the `elden-cube-monthly` USD 5 budget, and the `GameUrl`/`BucketName`/`DistributionId` outputs. (Stage 2 in `elden-cube-deploy` verifies and finalizes it.)
6. Exit: `npm run dev` shows the starter page at `http://localhost:5173`.

### Requirement 0.4 — AWS profile and bootstrap
1. The user SHALL create the `elden-personal` profile (AR §13.4, User step). The agent SHALL never ask for, write, print or store credentials, and SHALL use only `--profile elden-personal`.
2. Exit: `aws sts get-caller-identity --profile elden-personal` shows the personal account.
3. The agent SHALL run `npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1 --profile elden-personal` after explaining it.
4. Exit: `npx cdk synth --profile elden-personal` (`npm run synth`) succeeds, with the email taken from `cdk.json`.
5. Smoke deploy (PP 0.4, decision D5 — required): build the starter page, `npm run deploy`; exit: the starter page loads from `https://xxxx.cloudfront.net`, and the user confirms the budget alert email subscription (User step).

---

## Stage 1 — Game

### Requirement 1 — Foundation (milestone 1.1)
**User story:** As a visitor, I want the game to open instantly in Chrome and show a green arena, so I can start playing.

1. `config.ts` SHALL export one deeply `readonly` `CONFIG` object with the groups listed in AR §6, containing every value from GD §1–11 with the documented numbers; no tunable number SHALL be hard-coded elsewhere. `rageUpgrades` switches SHALL default to `false`.
2. `flags.ts` SHALL parse `?easy` and `?debug` once (combinable) and expose effective multipliers; `CONFIG` SHALL never be mutated.
3. `loop.ts` SHALL implement the fixed-step loop of AR §4.1: step 1/60 s, frame dt clamped to 0.1 s, max 5 steps per frame (then drop the accumulator), `hitStop(s)` keeps the max of current and new and freezes simulation while rendering continues, `setTimeScale(scale, s)` counts down in real time, and a `paused` flag that only renders.
4. The renderer SHALL follow AR §4.6 (antialias, pixel ratio ≤ 2, `PCFShadowMap`, WebGL 2 check, sRGB, resize handling).
5. IF WebGL is unavailable THEN the page SHALL show only *"This game needs WebGL. Please use the latest Chrome."* and stop.
6. The Arena SHALL match GD §8 exactly (floor r 30 / 64 segments `#6AB04C` receiving shadows, outer field r 200 `#5E9E44` 1 cm lower, edge ring 29.8–30.2 `#4A7F35`, sky `#BFE3FF`, linear fog 60–180, hemisphere light, directional sun with 1024² shadow map, ±35 m shadow camera, bias −0.0005).
7. The input system SHALL follow GD §3 and AR §4.5: `KeyboardEvent.code`, ignore `repeat`, `preventDefault` on Space, no context menu on canvas, edge-triggered `rollPressed`/`swingPressed`/`mutePressed`/`anyStartPressed` (any key except `KeyM`, or click), `pointerdown` button 0 on canvas, held keys cleared on `blur`/hidden.
8. WITH `?debug` the overlay SHALL show the FPS and current state (updated at 4 Hz).
9. Done when: the green arena renders at 60 fps and the debug overlay shows state and FPS.

### Requirement 2 — Player model and movement (milestone 1.2)
**User story:** As a visitor, I want the hero to move clumsily but predictably, so mistakes feel like my own fault.

1. The player model SHALL be built exactly per GD §4.1 (root, roll pivot at 0.90, body, head on neck pivot, optional eyes, two arms on shoulder pivots, two legs on hip pivots, oversized sword on the right shoulder pivot; colors and sizes as given; `MeshStandardMaterial` roughness 0.8 metalness 0; all cast shadows).
2. The player SHALL spawn at `(0, 0, 12)` facing the boss.
3. Movement SHALL be camera-relative (camera forward projected on XZ), diagonals normalized, desired velocity = dir × maxSpeed 6 m/s, approached at accel 10 m/s² with input and decel 4 m/s² without (sliding stop).
4. Facing SHALL turn at 4 rad/s toward the movement direction when speed > 0.5 m/s and input exists, otherwise toward the boss.
5. The player SHALL always stay at y = 0, be clamped to radius 29.6 m with the outward velocity component removed, and be pushed out of the boss box at 4 m/s when overlapping outside boss attacks.
6. Input SHALL never be randomly dropped; only the documented lockouts (swing, roll, recovery, cooldown) ignore input.
7. Hitbox SHALL be exactly two spheres of radius 0.40 at heights 0.50 and 1.30 (GD §4.5); limbs and weapon are not part of it.

### Requirement 3 — Roll (milestone 1.2)
1. WHEN Space is pressed and the player is not swinging, rolling, in roll recovery or in roll cooldown THEN a roll SHALL start; otherwise the press SHALL be ignored (no buffering).
2. The roll direction SHALL be the camera-relative input direction at press time, or the facing direction without input, and SHALL be locked for the whole roll.
3. The roll SHALL move 4.0 m over 0.55 s with ease-out displacement; arena wall and boss pushback still apply.
4. The player SHALL be invincible from exactly 0.05 s to 0.40 s after roll start.
5. Facing SHALL turn toward the roll direction at 3× the turn rate.
6. After the roll, a 0.25 s dizzy recovery SHALL ignore movement, roll and swing input, sway the body ±8°, kick the head spring and start velocity at dir × 2 m/s decaying at `decel`.
7. A new roll SHALL be possible 0.15 s after recovery ends (full cycle 0.95 s).
8. The roll pivot SHALL do one 360° forward somersault (local X) over 0.55 s, ease-in-out; limb targets tuck to 70°; the walk cycle pauses.
9. `roll` SHALL play at start and `roll_end` at recovery start.
10. WITH `?debug` the player SHALL be tinted 30% white while invincible.

### Requirement 4 — Visual wobble (milestone 1.2)
1. Limb pitches SHALL follow targets through `springStep` (k 120, damping 8) at the fixed step, clamped to ±80°.
2. Targets SHALL match GD §4.4: legs walk cycle ±35° × s at 1.8 Hz × s phase rate in opposite phase; arms opposite to same-side leg 25° × s plus −0.03 rad per m/s² forward-acceleration lag; head position spring (k 80, damping 6) pushed by −0.02 × horizontal acceleration and nodding ±5° × s; body lean 8° × s; right arm driven directly by the swing curve while swinging.
3. Wobble SHALL have no gameplay effect.

### Requirement 5 — Camera (milestones 1.2, 1.5)
1. Lock-on follow SHALL match GD §7: `player + d × 6.0 + (0, 3.2, 0)`, or distance 7.5 / height 4.2 within 5 m of the boss; look-at `lerp(player, boss, 0.4) + (0, 1.2, 0)`; smoothing factor `1 − exp(−6 × dt)`; Y never below 1.0; FOV 60°, near 0.1, far 300.
2. TITLE orbit SHALL be radius 14, height 6, 0.15 rad/s, looking at `(0, 2, 0)`, always starting at the same angle after a return transition.
3. Title → fight SHALL blend over 0.8 s with an ease-in-out weight.
4. While dying, the look-at point SHALL move toward the player's debris center.
5. Shake SHALL be a random offset decaying linearly over its duration; a new shake replaces the current one only if stronger.

### Requirement 6 — Swing and weapon hit (milestone 1.3)
**User story:** As a visitor, I want a heavy, committed swing, so landing a hit feels earned.

1. WHEN left click (button 0) or `F` is pressed and no swing, roll or roll recovery is in progress THEN a swing SHALL start; otherwise ignored (no buffering). A swing IS allowed during the 0.15 s roll cooldown (decision D1).
2. Phases SHALL be: rest θ 20°; wind-up 0.20 s 20° → 200° ease-out; active 0.15 s 200° → 70° ease-in with lunge velocity facing × 10 m/s; recovery 0.40 s 70° → 20° ease-in-out. During wind-up and recovery, movement and roll input are ignored and velocity decays at `decel`.
3. Only the active phase SHALL test for damage, using 3 blade points at 0.5, 1.3 and 2.1 m from the shoulder, converted into boss local space and tested against half-size 2.0.
4. A swing SHALL deal at most one hit.
5. A hit SHALL be ignored while boss invulnerability > 0; a hit during a boss attack SHALL damage without interrupting the attack.
6. `swing` SHALL play at the start of the active phase; `swing_ground` *(optional)* when the active phase ends without a hit.
7. WHEN the active phase ends without a hit THEN `Player` SHALL report a missed swing to `Game` (for Requirement 12).
8. The click that starts the fight from TITLE SHALL NOT trigger a swing.

### Requirement 7 — Boss model, stats, hit reaction, phases (milestones 1.3, 1.4)
1. The boss model SHALL match GD §6.1 (4 m cube `#6A4C93`, 5-sided crown band and 5 cones `#FFC300`, eyes, pupils, angry eyebrows at 20°), casting and receiving shadows.
2. Stats SHALL match GD §6.2: HP 5, spawn `(0,0,0)` facing +Z, 2.0 s grace, idle bob 0.08 × sin(2π·1.2·t), yaw toward player at 2.0 rad/s (except during Charge dash), chase at 1.5 m/s when farther than 7 m between attacks, cooldown 2.5 s (rage 1.6 s), invulnerability 0.4 s after a hit, clamped to radius 27 m.
3. WHEN hit THEN simultaneously: hit-stop 0.08 s, white emissive flash 0.10 s, squash `(1.15, 0.85, 1.15)` springing back over 0.25 s, 0.3 m knockback away from the player (skipped during Charge dash), camera shake 0.15 m / 0.2 s, `hit` sound, and the matching HUD segment flashes white 0.15 s then empties.
4. `takeHit` SHALL return `'hit'`, `'rage'`, `'defeated'` or `'ignored'`; a fresh boss hit 5 times (respecting invulnerability and the rage transition) SHALL yield `hit, hit, rage, hit, defeated`.
5. WHEN the 3rd hit lands, even during an attack, THEN in the same step the running attack SHALL be cancelled (its shockwave ring, shards in flight and warning circles removed with a small puff effect; `slam_rise`/`charge_windup` stopped) and the rage transition SHALL start (decision D9). Hits 1, 2 and 4 never interrupt an attack (6.5). The rage transition SHALL last 1.0 s with no attacks and no damage taken: color fades to `#D62828` over 0.5 s, shake ±0.1 m, `rage` sound, camera shake 0.2 m / 0.6 s. Afterwards all boss movement speeds ×1.4, telegraph times ×0.6, cooldown 1.6 s.
6. The boss box SHALL be yaw-only with half-size 2.0; squash is visual only.

### Requirement 8 — Attack selection (milestone 1.4)
1. `chooseAttack(history, distanceToPlayer, closeTimer, rng)` SHALL be a pure function in `Boss.ts`.
2. IF closeTimer ≥ 3.0 s THEN it SHALL return `slam`, or `shards` when `slam` is blocked by the no-3-in-a-row rule.
3. Otherwise it SHALL pick uniformly at random among valid attacks, where `charge` is valid only when distance > 6 m, and an attack equal to the last two attacks is not valid.
4. The same attack SHALL never occur 3 times in a row; `charge` SHALL never be chosen within 6 m.
5. An upgraded attack SHALL count as one attack in the history.

### Requirement 9 — Cube Slam (milestone 1.4)
1. Telegraph: rise to y = +4 ease-out over 1.0 s (rage 0.6 s), dark ground circle r 2.2 at 50% opacity, `slam_rise` (stoppable, telegraph length). Hang 0.15 s. Drop to 0 ease-in over 0.20 s.
2. Impact: `slam_impact`, camera shake 0.35 m / 0.4 s; a player whose hitbox overlaps the boss footprint dies.
3. Shockwave: flat ring 1.0 m wide, 0.3 m tall, `#FF7B00`, expanding from r 2.2 to 14 m at 8 m/s (rage 11.2), fading near the end; the player dies if horizontal distance is within `[r − 0.9, r + 0.9]`.
4. It SHALL be survivable by rolling through the ring with i-frames, or by being farther than 14 m.

### Requirement 10 — Royal Charge (milestone 1.4)
1. Telegraph 1.0 s (rage 0.6): shake ±0.1 m, pulsing red emissive, `charge_windup` (stoppable).
2. At telegraph end the dash direction SHALL lock toward the player's horizontal position.
3. Dash straight at 18 m/s (rage 25.2) with `charge_dash`, stopping at radius 27 m or after 2.0 s; then skid to 0 over 0.3 s.
4. During the dash, the player dies if either hitbox sphere overlaps the boss box.
5. It SHALL be survivable by strafing, or rolling sideways/through with good timing.

### Requirement 11 — Crown Shards (milestone 1.4)
1. Telegraph 1.0 s (rage 0.6): 3 pulsing red circles (r 1.2, `#FF3B30`, 50%). Center = `P + V × 0.5` (player position/velocity at telegraph start); sides = center ± 2.5 m perpendicular to boss→player; all clamped inside the arena.
2. Launch: 3 spinning gold cubes (0.6 m, `#FFC300`) from the crown on exact ballistic arcs (gravity 20 m/s²) landing at the circle centers simultaneously, flight 0.8 s (rage 0.57 s); `shard_launch`.
3. Kill: a shard (sphere r 0.35) touching a hitbox sphere during flight, or at landing a player within 1.6 m horizontal of a circle center.
4. Land: `shard_land`, small debris puff; shards and circles removed.

### Requirement 12 — Boss tactics (milestone 1.4)
1. `updateCloseTimer(timer, distance, dt)` SHALL be pure: +dt when distance < 4.0 m, −2·dt otherwise, never below 0; updated only in FIGHT.
2. WHEN the cooldown ends with closeTimer ≥ 3.0 s THEN Requirement 8.2 applies and the timer resets to 0.
3. WHILE closeTimer ≥ 3.0 s and the boss is waiting, the idle bounce SHALL double to 0.16 m.
4. `applyMissPunish(remainingCooldown, alreadyPunished)` SHALL be pure: reduce by 0.8 s, floor 0.3 s, at most once per cooldown.
5. Punish SHALL trigger only when a swing's active phase ends without a hit, the player is within 5.0 m of the boss center, and the boss is waiting in cooldown (not telegraphing, attacking or in the rage transition).
6. Punish tell: for 0.5 s the eyebrows tilt a further 10° and the pupils shrink to 70%.
7. With `?easy`, the base cooldown SHALL first be multiplied by 1.3; the punish then applies `max(0.3, remaining − 0.8)` with the fixed (unscaled) 0.8 s and 0.3 s (decision D3).
8. Both tactics SHALL be independent and may both apply in the same cooldown.
9. `?debug` SHALL show the close timer and mark when punish fired.

### Requirement 13 — Optional rage upgrades (milestone 1.4)
1. WITH all `CONFIG.rageUpgrades` switches `false` (default) THEN rage SHALL behave exactly as Requirements 9–11.
2. WITH `doubleSlam` on, in rage: a 0.5 m hop and second landing 0.5 s after the first impact, spawning a second identical ring; `slam_impact` again at 70% volume; tell: the shadow circle flashes twice during the telegraph.
3. WITH `chargeUTurn` on, in rage: after dash and skid, if the player is alive, a 0.4 s re-telegraph (shake, red pulse, `charge_windup`), re-lock, a second dash with the same rules, then skid; at most one U-turn; tell: the red pulse keeps going during the first skid.
4. WITH `staggeredShards` on, in rage: the center shard flies 0.3 s longer; each shard checked at its own landing; tell: center circle pulses at 1 Hz, sides at 3 Hz.
5. Each switch SHALL work independently; the cooldown SHALL start only after the whole upgraded attack ends; death or defeat cancels all parts.

### Requirement 14 — Boss defeat (milestones 1.3, 1.5)
1. On the 5th hit: hit-stop 0.20 s; all shockwaves, shards and circles removed; the player can no longer be killed.
2. The boss SHALL be replaced by 8 cubes of 2 m (2×2×2 split, current body color) with outward 4–8 m/s, upward 5–9 m/s and random spin up to 6 rad/s; the crown becomes a separate piece that falls and rolls.
3. `boss_break`, camera shake 0.4 m / 0.5 s, time scale 0.5 for 1.0 s.
4. During BOSS_DEFEATED the player can move and roll but not swing.
5. `victory` SHALL play when the Victory screen appears (1.5 s after the 5th hit).

### Requirement 15 — Player death (milestone 1.5)
1. At 0.00 s: hit-stop 0.10 s, state DYING, in-flight shockwaves/shards/circles removed, long sounds (`slam_rise`, `charge_windup`) stopped.
2. At 0.10 s: the 7 parts detach keeping world transforms; horizontal 3–6 m/s away from the hit source (boss center for Slam/Charge, shard or circle center for Shards), upward 4–7 m/s, spin up to 10 rad/s; debris physics per AR §5.6; `player_break`.
3. From 0.10 s: the boss cancels attacks/telegraphs, stops moving and turns at its normal rate to face the debris average, keeping its idle bounce.
4. At 0.60 s: "YOU DIED" fades in over 0.5 s with `you_died`.
5. At 2.00 s: the return transition begins.
6. Debris (AR §5.6): gravity 20; on ground contact y = groundRadius, v.y = −v.y × 0.35, v.xz × 0.7, angular velocity × 0.7; sleep under 0.2 m/s on the ground; removed on reset.

### Requirement 16 — State machine and game flow (milestone 1.5)
**User story:** As a booth operator, I want the game to loop back to the start screen by itself, so visitors can rotate without me touching it.

1. States SHALL be `TITLE`, `FIGHT`, `DYING`, `BOSS_DEFEATED`, `VICTORY_SCREEN`, `TO_TITLE` plus a `paused` flag, each with `enter`/`update`/`exit`, with transitions exactly as GD §1.
2. TITLE → FIGHT: after the title input lock, any key except `M` or any click starts the fight; the first input unlocks audio; the starting click does not swing. Title overlay fades out 0.3 s, camera blends 0.8 s, HUD fades in 0.3 s, boss grace (2.0 s) starts.
3. The attempt counter SHALL increase by 1 each time a fight starts, in memory only.
4. BOSS_DEFEATED SHALL last 1.5 s, then VICTORY_SCREEN.
5. VICTORY_SCREEN: after a 1.0 s input lock, any key except `M` or a click → TO_TITLE; with no input for 8 s → TO_TITLE automatically.
6. TO_TITLE: fade-out 0.6 s ease-in-out (black 0 → 1, audio master to 30%); in the single frame at full black, reset the world exactly once, hide result screens and HUD, switch to the title orbit, show the title overlay; fade-in 0.8 s ease-in-out (audio back to normal); then a 0.5 s title input lock, after which the start prompt appears.
7. Reset SHALL restore player and boss spawns, full HP Phase 1, and remove all projectiles, debris, effects and timers. The page SHALL never reload.
8. Gameplay timers (dying 2.0 s, defeat delay 1.5 s) SHALL count simulation time; input locks, the 8 s auto-return and the TO_TITLE fades SHALL count real time.
9. WHEN the window blurs or the tab is hidden during FIGHT THEN the simulation SHALL pause, held keys SHALL clear and *"Paused — click to continue"* SHALL show; a click resumes. The resume click SHALL NOT trigger a swing (decision D2).
10. `M` SHALL toggle mute in every state and never count as "any key".

### Requirement 17 — Screens and HUD (milestone 1.5)
1. The overlay SHALL be a single `#overlay` (`position: fixed; inset: 0; pointer-events: none`) with one element per GD §2 item, toggled by CSS classes; animations are CSS.
2. Every element SHALL match GD §2 exactly: title text, start prompt (blinking 1 s), controls box, boss health bar (5 segments, 4 px gap, label "The Elden Cube"), FIGHT controls hint, sound indicator (all states), attempt counter (TITLE, after the first fight), "YOU DIED" (55% dim, `#A4161A`, scale 1.1 → 1.0), "CUBE FELLED" (40% dim, gold), continue prompt (after the 1.0 s lock), fade layer (above everything), pause overlay, WebGL error.
3. The TITLE overlay SHALL appear only after `document.fonts.ready`.
4. Cinzel 700 SHALL come from `@fontsource/cinzel/700.css`; UI font `system-ui, -apple-system, "Segoe UI", sans-serif`.
5. `index.html` SHALL have `<title>The Elden Cube</title>` and link `favicon.svg` (isometric `#6A4C93` cube with a gold three-point crown, 64×64 viewBox, AS §3). `public/CREDITS.md` SHALL list Three.js (MIT), Cinzel (OFL), procedural sounds, and any sound files with sources.

### Requirement 18 — Audio (milestone 1.5)
1. `audio.unlock()` SHALL create/resume the `AudioContext` on the first key or click; before that, `play()` is silently ignored.
2. Signal path: sound → own gain → master gain (0.8, 0 when muted) → destination. `M` toggles master 0.8 ↔ 0; the indicator shows `Sound: ON (M)` / `Sound: OFF (M)`.
3. Sound files SHALL be discovered at build time via `import.meta.glob('./assets/sfx/*.{mp3,ogg,wav}', { eager: true, query: '?url', import: 'default' })` (path relative to the importing file); a missing file SHALL never cause a network request or console error.
4. `resolveSfxSources(globResult)` SHALL be pure: map file base names to known IDs, prefer mp3 > ogg > wav, ignore unknown names with one `console.info`.
5. On unlock, found files SHALL be fetched and decoded; on failure, one `console.warn` and that sound uses its recipe.
6. `play(id, opts?)` SHALL play the decoded file if present (pitch variation as `playbackRate`), else the recipe; `slam_rise` and `charge_windup` return a handle with `stop()`, called on cancellation.
7. `sfx.ts` SHALL implement every recipe in AS §1.2 (all 17 IDs) with the given waveforms, sweeps, durations and volumes.
8. Each trigger SHALL fire exactly as GD §10 (incl. `footstep` *(optional)* every 0.30 s while walking above 1 m/s).
9. No music.
10. With `app/src/assets/sfx/` empty, every sound SHALL play its recipe; with a dropped-in file (e.g. `hit.mp3`) that file SHALL play instead; after removing it, the recipe plays again — with no code change.

### Requirement 19 — Easy and debug modes (milestone 1.4)
1. `?easy`: boss movement speeds ×0.75, telegraph times ×1.3, cooldowns ×1.3. Shard flight time = base / speed multiplier (easy 0.8 / 0.75 ≈ 1.07 s; rage + easy 0.8 / (1.4 × 0.75) ≈ 0.76 s) (decision D4).
2. `?debug`: FPS counter, state, boss phase and attack, roll phase and i-frame status, close timer and punish marker, and wireframe hitboxes (player spheres, boss box, blade points, shockwave band, shard spheres).
3. `?debug` keys: `1`/`2`/`3` force Slam/Charge/Shards next; `K` deals 1 damage; `G` toggles god mode.
4. Parameters SHALL combine; without them nothing debug-related is visible.

### Requirement 20 — Quality and Stage 1 exit (milestone 1.6)
1. No errors or warnings in the Chrome console during a full session (title → 3 deaths → win), checked via the chrome-devtools MCP.
2. Steady 60 fps on the booth laptop in Chrome; under 100 draw calls; no long frames during attacks or debris (Performance panel).
3. `npm run build` (typecheck + tests + build) SHALL succeed; `npm run preview` SHALL run the built game correctly at `http://localhost:4173`.
4. Playtest with at least 3 first-time players (User step); tune only *(tune)* values in `config.ts` toward a win in 3–6 attempts, following the PP 1.6 tuning order.
5. Every GD §13 checklist item passes on the booth laptop; no known bugs remain open.

### Requirement 21 — Unit tests (milestone 1.6, AR §8)
All with Vitest in a Node environment, seeded RNG where randomness is involved:

1. **collision.ts:** `pointInOBB`, `sphereOBB` (incl. push-out direction), `sphereSphere`, `inRingBand`, `inCircle`, including yawed boxes and boundary cases.
2. **springStep:** settles to the target and never explodes at the 1/60 s step for the documented k/damping values.
3. **chooseAttack:** never 3 in a row; never Charge within 6 m; close timer ≥ 3.0 s forces Slam, or Shards when Slam is blocked; over 1,000 seeded runs every valid attack appears.
4. **updateCloseTimer:** +dt when close, −2·dt when not, never below 0.
5. **applyMissPunish:** −0.8 s, floor 0.3 s, once per cooldown.
6. **Boss HP / phase:** `takeHit` sequence → `hit, hit, rage, hit, defeated`; ignored during invulnerability and during the rage transition; 3rd hit during an attack → attack cancelled and transition starts in the same step, while hits 1, 2 and 4 during an attack leave it running (D9).
7. **Swing timing:** damage only in the active window; at most one hit per swing.
8. **Roll timing:** i-frames exactly 0.05–0.40 s; direction locked; no swing or roll during roll or recovery; no roll during cooldown (swing allowed in cooldown, D1).
9. **State flow:** death → `TO_TITLE` after 2.0 s; victory → `TO_TITLE` on input after 1.0 s or automatically after 8 s; reset happens exactly once, at full black.
10. **flags.ts:** parsing of none / `?easy` / `?debug` / both.
11. **resolveSfxSources:** empty glob → every sound uses its recipe; `hit.mp3` → `hit`; mp3 beats ogg/wav for the same ID; unknown names ignored.

---

## Traceability — GD §13 acceptance checklist

| GD §13 item | Requirement |
|---|---|
| Full flow with keyboard/click, no reload | 16.1, 16.2, 16.4–16.7 |
| Death: boss looks at remains, YOU DIED at 0.6 s, fade at 2.0 s | 15.3–15.5, 16.6 |
| Victory returns on input after 1.0 s or after 8 s, same fade | 16.5, 16.6 |
| First TITLE input starts, unlocks audio, no swing | 16.2, 6.8, 18.1 |
| Title lock 0.5 s, victory lock, `M` never "any key" | 16.5, 16.6, 16.10 |
| Smooth title → fight blend | 5.3, 16.2 |
| Attempt counter | 16.3, 17.2 |
| Blur pauses, clears keys, click resumes | 16.9, 1.7 |
| Acceleration, sliding stop, lazy turning, no input loss | 2.3, 2.4, 2.6 |
| Roll ~4 m locked, 0.35 s i-frames, dizzy, cooldown, wall holds | 3.1–3.7, 2.5 |
| Swing wind-up/lunge/recovery; only active damages; one hit max | 6.2–6.4 |
| 3 attacks telegraphed and avoidable; survivable by roll timing | 9, 10, 11 |
| No 3 in a row; no Charge within 6 m | 8.3, 8.4 |
| Anti-camping with bigger-bounce tell | 12.1–12.3 |
| Punish rushing in with glare tell | 12.4–12.6 |
| Rage after hit 3; dies on hit 5 | 7.4, 7.5, 14 |
| Hit reactions all play | 7.3 |
| Rage upgrades off = §6.5; each on = §6.5a with tell | 13 |
| Player falls apart; boss breaks into 8 cubes + crown | 15.2, 14.2 |
| All Must and Should sounds; `M` mutes everything | 18.2, 18.7, 18.8 |
| `?easy` and `?debug` work | 19 |
| No console errors/warnings | 20.1 |
| Steady 60 fps | 20.2 |
| 3 first-time testers win within ~6 attempts | 20.4 |

## Traceability — AR §8 unit tests

| AR §8 test | Requirement |
|---|---|
| collision helpers | 21.1 |
| springStep stability | 21.2 |
| chooseAttack (4 properties) | 21.3 |
| updateCloseTimer | 21.4 |
| applyMissPunish | 21.5 |
| boss HP / phase transitions | 21.6 |
| swing phase timing | 21.7 |
| roll timing | 21.8 |
| state flow | 21.9 |
| flags.ts parsing | 21.10 |
| resolveSfxSources | 21.11 |

---

## Decisions (answered by the user, 2026-10-09)

- **D1 — Swing during roll cooldown:** allowed. Only a new roll is blocked in the 0.15 s cooldown. AR §8 wording fixed to "no roll during cooldown".
- **D2 — Resume click:** the click that resumes from Paused does not swing (same rule as the start click).
- **D3 — `?easy` with punish:** base cooldown × 1.3 first, then `max(0.3, remaining − 0.8)`; 0.8 s and 0.3 s are fixed.
- **D4 — Shard flight time:** base / speed multiplier (easy ≈ 1.07 s; rage + easy ≈ 0.76 s).
- **D5 — Stage 0 infra:** write the full AR §9 stack in Stage 0 and do the smoke deploy.
- **D6 — Alert email:** `junsieng55@gmail.com`, stored in `infra/cdk.json` context; `-c alertEmail=…` still overrides; npm scripts need no `-c`.
- **D7 — Git:** the agent commits, the user pushes; rules in `.kiro/steering/git.md`.
- **D8 — Booth laptop:** this Mac is the booth laptop; 60 fps and §13 checks run here.
- **D9 — 3rd hit during an attack:** deliberate exception to GD §5 for the 3rd hit only: the attack is cancelled immediately (spawned ring/shards/circles removed with a small puff; long sounds stop) and the 1.0 s rage transition starts in the same step; the boss cannot take damage during it. Hits 1, 2, 4 never interrupt. GD §5 and §6.4 updated.
