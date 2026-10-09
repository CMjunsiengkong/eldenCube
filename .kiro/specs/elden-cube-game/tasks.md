# Tasks — elden-cube-game (Stage 0 + Stage 1)

Rules: follow `requirements.md` and `design.md`; git per `.kiro/steering/git.md` (one branch per milestone, Conventional Commits, ask before merging with `--no-ff`). After every milestone the game must run (`npm run dev`) and `npm run typecheck && npm run test` must pass. Unit tests are written together with the pure module they cover; milestone 1.6 completes and audits them. Each milestone ends with a report (what was done, how each exit criterion was verified, next User steps). **[User]** = stop and wait for the user.

---

## Stage 0 — Setup (on `main`; setup commits only)

- [x] **0.1 Tools** — Node v24.21.0 (nvm), npm 11.19.0, git 2.50.1, AWS CLI 2.37.11, uv/uvx 0.12.24, Chrome; installed by the user with official installers (no Homebrew, AR §13.1 updated). _Req 0.1_
- [x] **0.2 MCP config** — create `.kiro/settings/mcp.json` exactly per AR §13.2. _Req 0.2_
- [x] **0.3 Scaffold `app/`** — Vite `vanilla-ts` into `app/`; install `three`, `@fontsource/cinzel`; dev `vitest`, `@types/three` (if needed); remove template demo files; `vite.config.ts` (base `./`, es2022, ports 5173/4173, vitest node env); `tsconfig` strict; scripts per AR §7; empty folders per AR §3 incl. `src/assets/sfx/.gitkeep`, `tests/`; placeholder `main.ts` that renders the starter page. Commit `chore(app): scaffold vite app`. _Req 0.3_
- [x] **0.4 Scaffold `infra/`** — (TypeScript pinned to 6.0.3 for ts-node, AR §13.3) CDK TypeScript app per AR §3 (`aws-cdk-lib`, `constructs`; dev `aws-cdk`, `typescript`, `ts-node`, `@types/node`); `cdk.json` with `"context": { "alertEmail": "junsieng55@gmail.com" }`; `bin/infra.ts` (missing-email error, `ap-southeast-1`, `CDK_DEFAULT_ACCOUNT`); full `lib/EldenCubeStack.ts` per AR §9.2; scripts `build`, `synth`, `diff`, `deploy`, `destroy` with `--profile elden-personal`. Commit `feat(infra): add EldenCubeStack`. Also commit `.kiro/` steering + specs as `docs(kiro): add steering and specs`. _Req 0.3.2, 0.3.4, 0.3.5_
- [x] **0.5 Local check** — `npm run dev` → starter page at `http://localhost:5173` (curl check; Chrome check once the MCP is loaded). _Req 0.3.6_
- [x] **0.6 [User]** — restart `kiro-cli` from `eldenCube/`, run `/mcp`, confirm `aws-docs`, `aws-iac`, `chrome-devtools` loaded. _Req 0.2.3_
- [x] **0.7 [User]** — create the `elden-personal` profile (AR §13.4) and confirm `aws sts get-caller-identity --profile elden-personal`. _Req 0.4.1–0.4.2_
- [x] **0.8 Bootstrap + synth** — `npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1 --profile elden-personal`; `npm run synth`. _Req 0.4.3–0.4.4_
- [x] **0.9 Smoke deploy** — deployed; GameUrl https://d376ckm5wji8ku.cloudfront.net serves the starter page (Chrome MCP: 200s, console clean). User confirmed the budget alert email. _Req 0.4.5_
- [x] **0.10 Stage 0 report** — all six Stage 0 exit criteria with evidence.

---

## Milestone 1.1 — Foundation (`feat/1.1-foundation`)

- [x] 1.1.1 `config.ts` — the full `CONFIG` (every GD §1–11 value, DeepReadonly, units in comments, rageUpgrades all false). _Req 1.1_
- [x] 1.1.2 `util/math.ts` (lerp, clamp, easings, `springStep`, `turnToward`, `randRange`) and `util/rng.ts` (mulberry32) + `tests/math.test.ts` (springStep stability). _Req 21.2_
- [x] 1.1.3 `flags.ts` (`parseFlags`, lazy `FLAGS`, `speedMult`, `telegraphMult`, `cooldownFor`, shard flight D4) + `tests/flags.test.ts`. _Req 1.2, 19.1, 21.10_
- [x] 1.1.4 `loop.ts` — fixed step, clamp, 5-step cap, `hitStop`, `setTimeScale`, `paused`, `realUpdate`. _Req 1.3_
- [x] 1.1.5 `main.ts` — WebGL check + error message, renderer per AR §4.6, resize, `fonts.ready`. _Req 1.4, 1.5_
- [x] 1.1.6 `game/Arena.ts` — floor, outer field, edge ring, sky, fog, lights/shadows per GD §8. _Req 1.6_
- [x] 1.1.7 `systems/input.ts` — held keys, edges, repeat/Space/contextmenu handling, blur/visibility. _Req 1.7_
- [x] 1.1.8 `systems/ui.ts` + `styles.css` + `index.html` skeleton (`#overlay`, `#debug`); `Game.ts` shell with a static camera; `?debug` FPS + state at 4 Hz. _Req 1.8_
- [x] 1.1.9 Verify: typecheck, tests; Chrome (MCP) `?debug` screenshot shows the green arena, FPS ≈ 60, console clean. Report. **Ask to merge.** _Req 1.9_

## Milestone 1.2 — Player (`feat/1.2-player`)

- [x] 1.2.1 `systems/collision.ts` (all 5 helpers) + `tests/collision.test.ts`. _Req 21.1_
- [x] 1.2.2 `PlayerMotor` — movement (accel/decel, normalized, camera-relative), turning, wall clamp, boss pushback, roll (locked dir, ease-out displacement, i-frames, 3× turn, dizzy, cooldown), action gating (D1), events. _Req 2.3–2.6, 3.1–3.7_
- [x] 1.2.3 `tests/playerMotor.test.ts` — roll timing part (i-frames [0.05, 0.40), direction locked, gating incl. D1). _Req 21.8_
- [x] 1.2.4 `Player` view — 7-part model per GD §4.1, roll somersault, wobble springs and walk cycle, head spring, lean, dizzy sway, hit spheres, debug invincible tint. _Req 2.1, 2.2, 2.7, 3.8, 3.10, 4_
- [x] 1.2.5 `systems/camera.ts` — lock-on follow (aimed at a static placeholder cube at the origin), smoothing, Y ≥ 1, shake, `forwardXZ`. _Req 5.1, 5.5_
- [x] 1.2.6 Wire into `Game` (FIGHT-only for now); temporary `roll`/`roll_end` hooks as no-op audio calls. _Req 3.9 (sound wired in 1.5)_
- [x] 1.2.7 Verify: tests; Chrome — move, slide, roll, wall; screenshots; console clean; debug shows roll phase/i-frames. Report. **Ask to merge.**

## Milestone 1.3 — Combat core (`feat/1.3-combat`)

- [x] 1.3.1 Swing in `PlayerMotor` (phases, `swingAngle`, lunge, one hit per swing, miss event) + swing-timing tests. _Req 6.1–6.4, 6.7, 21.7_
- [x] 1.3.2 `getBladePoints` and weapon → boss test in `Game` (only active phase, invuln check). _Req 6.3, 6.5_
- [x] 1.3.3 `BossBrain` HP/phase/invuln/`takeHit` (incl. D9 cancel request) + `tests/bossBrain.test.ts`. _Req 7.4, 7.5, 21.6_
- [x] 1.3.4 `Boss` view — model per GD §6.1 replacing the placeholder, idle bob, yaw toward the player; `fx/effects.ts` flash, squash spring, rage color fade/shake. _Req 7.1, 7.2 (motion parts), 7.6_
- [x] 1.3.5 Hit reaction (hit-stop, flash, squash, knockback, shake) and HUD health bar with segment flash. _Req 7.3, 17.2 (health bar)_
- [x] 1.3.6 `fx/debris.ts` + boss defeat (hit-stop 0.20, 8 cubes + crown falls and rolls, time scale 0.5 for 1.0 s, shake). _Req 14.1–14.4, 15.6_
- [x] 1.3.7 Verify: kill an idle boss with exactly 5 hits; one swing never counts twice (debug HP display); console clean. Report. **Ask to merge.**

## Milestone 1.4 — Boss AI (`feat/1.4-boss-ai`)

- [ ] 1.4.1 `chooseAttack`, `updateCloseTimer`, `applyMissPunish` + `tests/attackSelection.test.ts`, `tests/tactics.test.ts` (incl. D3). _Req 8, 12.1, 12.4, 12.7, 21.3–21.5_
- [ ] 1.4.2 Scheduler in `BossBrain`/`Boss` — grace, cooldown (phase × easy), chase, history, forced attacks, anti-camping trigger + bigger bounce, punish trigger + glare. _Req 7.2, 12.2–12.6, 12.8_
- [ ] 1.4.3 `attacks/Attack.ts` + `CubeSlam` (rise, hang, drop, impact kill, shockwave ring, cancel with puff). _Req 9_
- [ ] 1.4.4 `RoyalCharge` (telegraph, lock, dash, stop rules, skid, dash kill, no knockback while dashing). _Req 10_
- [ ] 1.4.5 `CrownShards` (circle placement, ballistic flight with D4, flight/landing kill, puff). _Req 11_
- [ ] 1.4.6 Player death hook (minimal: player hit → DYING placeholder → reset) so attacks can be tested; rage transition with D9 cancel; rage multipliers. _Req 7.5_
- [ ] 1.4.7 Rage upgrades (doubleSlam, chargeUTurn, staggeredShards) with tells, off by default. _Req 13_
- [ ] 1.4.7a `tests/rageUpgrades.test.ts` — one test per variant, injecting the switch through the `AttackContext.upgrades` override (never by editing `config.ts`): doubleSlam spawns a 2nd ring 0.5 s after the first impact; chargeUTurn re-telegraphs 0.4 s and dashes once more (max one U-turn); staggeredShards lands the center shard 0.3 s after the sides; and each is ignored outside rage. Plus one test asserting all three `CONFIG.rageUpgrades` switches are `false` by default. _Req 13_
- [ ] 1.4.8 `?easy`; debug keys `1/2/3/K/G`; debug text (phase, attack, close timer, punish marker); hitbox wireframes. _Req 19_
- [ ] 1.4.9 Verify in Chrome: force each attack, avoid it by moving and by roll i-frames; both tactics visible in `?debug`; each upgrade on individually (temporary local edit, reverted) vs all off; console clean. Report. **Ask to merge.**

## Milestone 1.5 — Game flow and feedback (`feat/1.5-flow`)

- [ ] 1.5.1 `FlowMachine` (all states, sim vs real timers, locks, auto-return, fade, reset-once, pause flag) + `tests/flow.test.ts`. _Req 16.1, 16.4–16.8, 21.9_
- [ ] 1.5.2 `Game` orchestration — start transition (overlay fade, camera blend, HUD fade, grace), start/resume click never swings (D2), attempt counter, `reset()`, pause on blur. _Req 16.2, 16.3, 16.7, 16.9, 5.2, 5.3_
- [ ] 1.5.3 Player death — 7-part break-apart, boss gloat at debris center, camera look-at to debris, YOU DIED timing. _Req 15, 5.4_
- [ ] 1.5.4 All screens and HUD per GD §2 (title, prompts, controls box, hint, sound indicator, attempts, YOU DIED, CUBE FELLED, continue prompt, fade layer, pause). Victory timing. _Req 17.1–17.3, 14.5_
- [ ] 1.5.5 `systems/sfx.ts` — all 17 recipes per AS §1.2. _Req 18.7_
- [ ] 1.5.6 `systems/audio.ts` — unlock, master/duck gains, mute (`M` everywhere), `resolveSfxSources` + `tests/sfx.test.ts`, file loading with fallback, stoppable handles; wire every GD §10 trigger (incl. optional footstep, swing_ground). _Req 18.1–18.6, 18.8, 18.9, 16.10, 21.11_
- [ ] 1.5.7 Font import, `public/favicon.svg`, `public/CREDITS.md`, `<title>`. _Req 17.4, 17.5_
- [ ] 1.5.8 Verify in Chrome: full session title → death → title → win → title with keyboard and click only, no reload; locks; blur pause; mute; console clean. Report. **Ask to merge.**

## Milestone 1.6 — Tests, tuning, bug bash (`feat/1.6-tuning`)

- [ ] 1.6.1 Audit unit tests against AR §8 / Req 21 (all 11 groups present and passing); `npm run build` passes. _Req 21, 20.3_
- [ ] 1.6.2 Sound checks: empty `sfx/` → recipes; drop a test `hit.mp3` → file plays; remove → recipe again (test file not committed). _Req 18.10_
- [ ] 1.6.3 Performance on this Mac: `?debug` FPS steady 60; Chrome Performance trace during attacks/debris shows no long frames; draw calls < 100 (`renderer.info`). _Req 20.2_
- [ ] 1.6.4 Console hygiene: full session title → 3 deaths → win with zero errors/warnings (MCP console read). _Req 20.1_
- [ ] 1.6.5 **[User]** playtest with ≥ 3 first-time players; report attempts-to-win. Tune only *(tune)* values in `config.ts` per PP 1.6 order (i-frames, recovery, cooldowns, telegraphs; then rage upgrades one at a time). _Req 20.4_
- [ ] 1.6.6 Fix every bug found (`fix/<name>` branches as needed).
- [ ] 1.6.7 `npm run preview` → built game correct at `http://localhost:4173`. _Req 20.3_
- [ ] 1.6.8 Walk the full GD §13 checklist on this Mac with evidence per item. _Req 20.5_
- [ ] 1.6.9 Stage 1 report with every exit criterion. **Ask to merge.** Then start the `elden-cube-deploy` spec.
