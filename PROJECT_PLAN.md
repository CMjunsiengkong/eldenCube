# Project Plan — The Elden Cube

This plan covers **building and shipping the game only**. The live demo and booth preparation are separate (see `../liveDemo/`).

The work runs in **stages**. Each stage has a goal, tasks and **exit criteria**:
- A stage is finished only when every exit criterion is met.
- The next stage starts only after that.
- Inside Stage 1, build the milestones in order. Each one leaves the game runnable.

```
Stage 0 ──► Stage 1 ─────────────────────────► Stage 2 ──────────► Stage 3 ─────────────► Stage 4
Setup       Game complete & debugged (local)    Deploy to AWS       Release & freeze       Post-event (optional)
```

---

## Stage 0 — Setup

**Goal:** all tools and accounts work, so nothing blocks later stages.

| # | Task |
|---|---|
| 0.1 | **Agent:** check and install the required tools (ARCHITECTURE.md §13.1). **User:** install the Kiro CLI (`curl -fsSL https://cli.kiro.dev/install \| bash`) and Homebrew if missing |
| 0.1a | **Agent:** create `eldenCube/.kiro/settings/mcp.json` (ARCHITECTURE.md §13.2) and confirm all three MCP servers are connected |
| 0.2 | Create `eldenCube/app` (Vite `vanilla-ts` + `three`) and `eldenCube/infra` (CDK TypeScript), following ARCHITECTURE.md §3. Add `app/src/assets/sfx/.gitkeep`. Initialize git with the `.gitignore` from ARCHITECTURE.md §3 |
| 0.3 | **User:** create the `elden-personal` CLI profile (ARCHITECTURE.md §13.4). **Agent:** run `cdk bootstrap` with `--profile elden-personal` |
| 0.4 | **Recommended: smoke deploy.** Deploy the empty Vite starter page with the real CDK stack (ARCHITECTURE.md §9) and open the `GameUrl`. Confirm the budget alert email subscription. This surfaces account or permission problems early, while there is still time to fix them |

**Exit criteria**
- [ ] All tools in ARCHITECTURE.md §13.1 report a version
- [ ] `/mcp` in `kiro-cli` shows the `aws-docs`, `aws-iac` and `chrome-devtools` MCP servers loaded
- [ ] `aws sts get-caller-identity --profile elden-personal` shows the personal account
- [ ] `npm run dev` shows the starter page locally
- [ ] `npx cdk synth -c alertEmail=<email> --profile elden-personal` succeeds
- [ ] *(if 0.4 was done)* the starter page loads from `https://xxxx.cloudfront.net`

---

## Stage 1 — Game complete and debugged, running locally

**Goal:** the full game, exactly as in GAME_DESIGN.md, playable from start to finish on the booth laptop with **no known bugs**. No AWS work in this stage.

| Milestone | Content | Done when |
|---|---|---|
| **1.1 Foundation** | `config.ts`, `flags.ts`, fixed-step loop with hit-stop and time scale, renderer, Arena (floor, outer field, edge ring, sky, fog, lights), WebGL check, resize, input system, `?debug` FPS counter | Green arena renders at 60 fps; debug overlay shows the state and FPS |
| **1.2 Player** | 7-part model, camera-relative movement with momentum, lazy turning, roll (locked direction, i-frames, dizzy recovery, cooldown, somersault visual), arena wall, limb springs and walk cycle, lock-on camera (aimed at a static placeholder cube), camera shake | Moving around already feels clumsy and funny; no input is ever lost |
| **1.3 Combat core** | Swing (wind-up, active with lunge, recovery), blade points, boss model and crown, HP 5, invulnerability, hit reaction (hit-stop, flash, squash, knockback, shake), health bar, body-contact pushback, defeat (8 cubes plus crown), slow motion | An idle boss can be killed with exactly 5 hits; one swing never counts twice |
| **1.4 Boss AI** | Turning, chasing, cooldown, `chooseAttack`, Cube Slam, Royal Charge, Crown Shards, rage transition, boss tactics (anti-camping, punish rushing in) with their tells, optional rage upgrades (Double Slam, Charge U-turn, Staggered Shards; implemented but **off by default**), `?easy`, debug keys and hitbox wireframes | Every attack can be forced with `1`/`2`/`3` and avoided as designed; both tactics trigger as specified (visible in `?debug`); each rage upgrade works when its switch is turned on, and nothing changes when all are off |
| **1.5 Game flow and feedback** | State machine (all 6 states plus pause), return transition (fade to black → reset → fade in to the start screen), title→fight camera blend, input locks, victory auto-return, reset, attempt counter, all screens and HUD, player break-apart and debris, `audio.ts` (sound file first, recipe fallback) and `sfx.ts` (all recipes), mute, favicon, font | **The full game is playable from start to finish.** This is the most important checkpoint |
| **1.6 Tests, tuning and bug bash** | Unit tests (ARCHITECTURE.md §8); **playtest with at least 3 first-time players**, watching without helping; tune `config.ts` toward winning in 3–6 attempts (if testers win in fewer than 3 attempts, first tighten roll i-frames, roll recovery, cooldowns and telegraphs; only then switch on rage upgrades one at a time, GAME_DESIGN §6.5a); fix every bug found; console and performance checks on the booth laptop | All exit criteria below |

**Exit criteria**
- [ ] Every item in the GAME_DESIGN.md §13 acceptance checklist passes on the booth laptop
- [ ] `npm run build` succeeds (type check, unit tests and build)
- [ ] `npm run preview` runs the built game correctly (this is the offline fallback)
- [ ] With `app/src/assets/sfx/` **empty**, every sound plays its code-generated version
- [ ] With a test file dropped in (e.g. `hit.mp3`), that file plays instead; after removing it, the recipe plays again
- [ ] No known bugs remain open

**Cut order** if Stage 1 is at risk of not finishing in time (cut from the top first):
1. The optional rage upgrades (GAME_DESIGN §6.5a). They are off by default anyway
2. Optional sounds (`swing_ground`, `footstep`)
3. Arena vertex-color variation; crown rolling (the crown simply falls)
4. Crown Shards attack (keep Slam and Charge)
5. Limb springs (use a plain walk cycle instead)
6. Should sounds

**Never cut:**
- the clumsy movement
- the one-hit kill and the 5-hit boss
- the "YOU DIED" screen
- the player falling apart on death
- the Must sounds

**Stretch** (only after the exit criteria are met, and only if the death break-apart looks flat in playtesting): a ragdoll for the death moment only, using cannon-es or Rapier. Keep it isolated in `fx/` so it can be removed easily.

---

## Stage 2 — Deploy to AWS

**Goal:** the finished game is served from CloudFront, identical to the local build, with cost guardrails in place.

| # | Task |
|---|---|
| 2.1 | Implement or finish `EldenCubeStack` exactly as in ARCHITECTURE.md §9 |
| 2.2 | `npm run build` in `app`, then `npx cdk deploy -c alertEmail=<email> --profile elden-personal` in `infra` |
| 2.3 | Open `GameUrl` in Chrome on the booth laptop and run the acceptance checklist quickly (flow, all attacks, sounds, 60 fps) |
| 2.4 | Check caching: change something visible, redeploy, reload. The new version appears (`index.html` is `no-cache`; hashed assets are immutable) |
| 2.5 | Check security: the direct S3 object URL returns *AccessDenied*; `http://` redirects to `https://` |
| 2.6 | Confirm the Budgets alert email subscription is active |
| 2.7 | Record `GameUrl`, the deploy command and the teardown command in `README.md` |

**Exit criteria**
- [ ] The game at `GameUrl` behaves the same as `npm run preview`
- [ ] The S3 bucket can't be read directly; HTTPS is enforced
- [ ] The budget alert is in place
- [ ] `npm run diff` (= `cdk diff … --profile elden-personal`) shows no unexpected changes

---

## Stage 3 — Release and freeze

**Goal:** a final, event-ready version is deployed, tagged and protected from last-minute risk.

| # | Task |
|---|---|
| 3.1 | Final `npm run build` and `npm run deploy` (in `infra`, uses `--profile elden-personal`); tag the git commit `v1.0-event` |
| 3.2 | Run the full GAME_DESIGN.md §13 checklist one last time against `GameUrl` |
| 3.3 | Test the offline fallback with Wi-Fi off: `npm run preview` → play a full session |
| 3.4 | Keep a copy of the built `app/dist/` on the booth laptop |
| 3.5 | **Feature freeze.** From now on, only fix critical bugs. Every fix must rerun the §13 checklist before redeploying, and gets a new tag (`v1.0.1-event`, …) |

**Exit criteria**
- [ ] `v1.0-event` is deployed and tagged
- [ ] Online (`GameUrl`) and offline (`npm run preview`) versions both pass the checklist

---

## Stage 4 — Post-event (optional)

| # | Task |
|---|---|
| 4.1 | Choose one: keep the game online (static only, about USD 0/month) **or** run `npx cdk destroy -c alertEmail=<email> --profile elden-personal` to remove everything |
| 4.2 | If keeping it online, leave the Budgets alert in place |
| 4.3 | When done with the personal account on this laptop, remove its credentials (ARCHITECTURE.md §13.5) |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stage 1 takes longer than expected | Med | Less time for deploy and freeze | Milestone order keeps the game runnable at all times; cut order above |
| AWS account or permission problems | Low–Med | Stage 2 is blocked | Stage 0.4 smoke deploy |
| Game too hard, so visitors give up | Med | Bad booth experience | Playtest in 1.6; tuning lives in `config.ts`; `?easy` flag |
| Game too easy, because the roll's i-frames beat every attack | Med | Less tension | Tune roll i-frames, recovery, cooldowns and telegraphs in 1.6; then switch on rage upgrades one at a time (GAME_DESIGN §6.5a) |
| Clumsiness feels broken rather than funny | Med | The core joke fails | Momentum and delay only, no input loss; tune in 1.6 |
| Code-generated sounds sound weak | Low–Med | Less impact | Tune the recipes, or drop sound files into `app/src/assets/sfx/` for the Must sounds (ASSETS.md §1.3) |
| Touchpad ignores clicks while keys are held | Med | Can't swing | Use the mouse; `F` key as an alternative swing |
| Laptop performance drops over a long day | Low | Stutter | Performance budget (ARCHITECTURE.md §4.6); check fps in 1.6 |
| Venue Wi-Fi problems | Low | Game won't load | Offline fallback (Stage 3.3) |
| Unexpected AWS cost | Very low | Money | No runtime APIs; USD 5 budget alert; `cdk destroy` |
