# Architecture — The Elden Cube

This document is the **complete technical specification**. Together with GAME_DESIGN.md (gameplay) and ASSETS.md (sounds, fonts, icons), an implementer should be able to build, test and deploy the project without further questions.

---

## 1. Summary

The game is a **static web app**. All gameplay runs in the visitor's browser. AWS **hosts and delivers** it:
- Amazon S3 stores the built files.
- Amazon CloudFront serves them over HTTPS.
- The AWS CDK defines everything as code.

Nothing calls AWS (or any network service) while someone plays. As a result:
- the game cannot run up a bill,
- it cannot be abused,
- it does not depend on any API at the booth, and
- the same build also runs fully offline from a local copy.

```
 DEV LAPTOP
 ┌──────────────────────────────┐
 │ app/: vite build → app/dist/ │   (HTML, JS, font, favicon, optional sound files)
 └──────────────┬───────────────┘
                │ infra/: cdk deploy (BucketDeployment + CloudFront invalidation)
                ▼
 RUNTIME
 ┌────────────┐  HTTPS  ┌──────────────────┐  OAC  ┌──────────────────────┐
 │  Browser   │ ──────► │ Amazon CloudFront │ ────► │ Amazon S3 (private)   │
 │ (game runs │         │ *.cloudfront.net  │       │ static files          │
 │  locally)  │         └──────────────────┘       └──────────────────────┘
 └────────────┘
                                  AWS Budgets → email alert at USD 5/month
```

## 2. Tech stack

Use the **latest stable version** of each item at project start, and lock them with `package-lock.json`.

| Layer | Choice | Reason |
|---|---|---|
| Runtime / tooling | Node.js LTS, npm | Standard |
| Language | TypeScript, `strict: true` everywhere | One language for game and infrastructure |
| Build tool | Vite (`vanilla-ts` template) | The official Three.js setup; instant reload; outputs a static `dist/`; `vite preview` doubles as the offline fallback |
| 3D rendering | `three` (plus `@types/three` if needed) | Standard WebGL library with built-in primitive shapes |
| Physics | **None.** Hand-written kinematics (§5) | The scene is a flat floor and a few objects. Hand-written code gives exact control of the clumsy feel and nothing to load or sync |
| Audio | Web Audio API: optional sound files first, code-generated recipes as the default fallback (§4.8, ASSETS.md §1) | Complete with no files and no licensing; real recordings can be dropped in later |
| UI | Plain HTML/CSS overlay above the canvas | Simplest way to build text, a health bar and screens |
| Font | `@fontsource/cinzel` (weight 700) | Bundled into the build, so it works offline |
| Unit tests | Vitest | Same config as Vite |
| Infrastructure | AWS CDK v2 (TypeScript), `aws-cdk-lib` and `constructs` | Infrastructure as code |
| Target browser | Latest desktop Chrome (booth laptop) | Other modern desktop browsers should work but are not required |

**Do not add** a physics engine, a UI framework (React, Vue, etc.), a state library, an analytics SDK or any runtime network call.

## 3. Repository layout

The code lives **next to these documents**, inside `eldenCube/`. `app` and `infra` are two independent npm packages.

```
eldenCube/
├── README.md, GAME_DESIGN.md, ARCHITECTURE.md, ASSETS.md, PROJECT_PLAN.md, eldencube.drawio
├── .gitignore                      # node_modules, dist, cdk.out, .DS_Store
├── .kiro/settings/mcp.json         # MCP servers for Kiro (§13.2)
├── app/                            # the game
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html                  # canvas container + overlay root; <title>The Elden Cube</title>
│   ├── public/
│   │   ├── favicon.svg
│   │   └── CREDITS.md
│   ├── src/
│   │   ├── assets/
│   │   │   └── sfx/                # optional sound files named <id>.mp3|.ogg|.wav (ASSETS.md §1.3); may be empty (keep .gitkeep)
│   │   ├── main.ts                 # bootstrap: WebGL check, renderer, Game, loop start
│   │   ├── config.ts               # EVERY tunable number (§6)
│   │   ├── flags.ts                # parses ?easy / ?debug once
│   │   ├── loop.ts                 # fixed-timestep loop, hit-stop, time scale
│   │   ├── game/
│   │   │   ├── Game.ts             # owns everything; the state machine (§4.2)
│   │   │   └── Arena.ts            # floor, outer field, edge ring, sky, fog, lights
│   │   ├── entities/
│   │   │   ├── Player.ts           # model, movement, roll (i-frames), swing, wobble, hitbox, break-apart
│   │   │   └── Boss.ts             # model, HP, phases, chase, hit reaction, attack scheduler, defeat
│   │   ├── attacks/
│   │   │   ├── Attack.ts           # shared interface (§4.4)
│   │   │   ├── CubeSlam.ts
│   │   │   ├── RoyalCharge.ts
│   │   │   └── CrownShards.ts
│   │   ├── systems/
│   │   │   ├── input.ts            # key/mouse state, edge-triggered actions, blur handling
│   │   │   ├── camera.ts           # title orbit, lock-on follow, title→fight blend, shake
│   │   │   ├── collision.ts        # pure math helpers (§5.4)
│   │   │   ├── audio.ts            # AudioContext, master gain, mute; sound file first, recipe fallback
│   │   │   ├── sfx.ts              # procedural sound recipes (ASSETS.md §1.2)
│   │   │   └── ui.ts               # DOM overlay: screens, HUD, health bar, pause, debug
│   │   ├── fx/
│   │   │   ├── debris.ts           # debris pieces (§5.6)
│   │   │   └── effects.ts          # flash, squash springs, warning circles, shockwave mesh
│   │   ├── util/
│   │   │   ├── math.ts             # lerp, clamp, easing, damped spring step, random range
│   │   │   └── rng.ts              # seedable random (seeded in tests)
│   │   └── styles.css              # overlay styles
│   └── tests/                      # Vitest unit tests (§8)
└── infra/                          # AWS CDK app
    ├── package.json
    ├── tsconfig.json
    ├── cdk.json                    # "app": "npx ts-node --prefer-ts-exts bin/infra.ts"
    ├── bin/infra.ts
    └── lib/EldenCubeStack.ts
```

## 4. Game runtime design

### 4.1 Main loop (`loop.ts`)

```
const STEP = 1/60;            // fixed simulation step
let acc = 0, hitStop = 0, timeScale = 1, timeScaleLeft = 0;

onFrame(now):
  frameDt = min((now - last)/1000, 0.1)       // clamp long frames (tab switch)
  if paused: render(); return
  if hitStop > 0: hitStop -= frameDt; render(); return   // freeze sim, keep rendering
  acc += frameDt * timeScale
  steps = 0
  while acc >= STEP and steps < 5: game.update(STEP); acc -= STEP; steps++
  if steps == 5: acc = 0                       // avoid a spiral of death
  timeScale handling: count timeScaleLeft down in real time, then restore 1
  game.render(alpha = acc/STEP)                // interpolation optional
```

- Use `requestAnimationFrame`.
- `hitStop(seconds)` keeps the maximum of the current and the new value.
- `setTimeScale(scale, seconds)` drives the defeat slow motion.

### 4.2 State machine (`Game.ts`)

- States: `TITLE`, `FIGHT`, `DYING`, `BOSS_DEFEATED`, `VICTORY_SCREEN`, `TO_TITLE`, plus a separate `paused` flag. The transitions and timings are exactly as in GAME_DESIGN §1 and §9.
- `TO_TITLE` drives the fade layer (`ui.setFade(opacity)`) and the audio master fade from its own timer, and performs `Game.reset()` plus the switch to the title camera in the single frame where opacity reaches 1. The title→fight camera blend lives in `camera.ts` (`blendToLockOn(0.8)`).
- Each state implements `enter()`, `update(dt)` and `exit()`.
- `Game.reset()` restores the full fight state as described in GAME_DESIGN §1.
- Gameplay timers (dying 2.0 s, defeat delay) count **simulation time**.
- Input locks (title, victory), the victory auto-return (8 s) and the `TO_TITLE` fades count **real time**, so slow motion and hit-stop don't lengthen them.
- `Game` owns:
  - the renderer, scene and camera controller
  - the Player and the Boss
  - the active attack
  - the debris and effects lists
  - the UI
  - audio
  - the attempt counter

### 4.3 Entities

| Class | Owns | Key public API |
|---|---|---|
| `Player` | Three.js group, roll pivot, velocity, facing yaw, swing phase/timer, roll phase/timer (rolling → recovery → cooldown), limb springs | `update(dt, input, cameraBasis, bossPos)`; `getHitSpheres(): Sphere[]`; `isInvincible(): boolean` (roll i-frames or debug god mode); `getBladePoints(): Vector3[]`; `isSwingActive()`; `consumeSwingHit()`; `breakApart(hitSource): DebrisPiece[]`; `reset()` |
| `Boss` | Three.js group, HP, phase, invulnerability timer, cooldown, attack history, current attack, close timer, punish flag | `update(dt, playerPos, playerVel)`; `getBox(): {center, halfSize, yaw}`; `takeHit(fromPos): 'hit' \| 'rage' \| 'defeated' \| 'ignored'`; `onPlayerMissedSwing(playerPos)`; `gloatAt(pos)` (stop attacking, face the remains; used in `DYING`); `cancelAttack()`; `breakApart(): DebrisPiece[]`; `reset()` |

### 4.4 Attacks (`attacks/*.ts`)

```ts
interface Attack {
  readonly id: 'slam' | 'charge' | 'shards';
  start(ctx: AttackContext): void;   // begins the telegraph
  update(dt: number, ctx: AttackContext): void;
  checkPlayerHit(spheres: Sphere[]): Vector3 | null; // hit source, or null. Game calls it only when !player.isInvincible()
  isFinished(): boolean;
  dispose(): void;                    // removes meshes (circles, ring, shards) from the scene
}
```

- `AttackContext` gives access to the boss, the player's position and velocity, the scene, audio, the camera shake, the speed multiplier (rage × easy) and the telegraph multiplier.
- The attack **selection rule** (GAME_DESIGN §6.5) is a **pure function** in `Boss.ts`, so it can be unit tested:
  `chooseAttack(history, distanceToPlayer, closeTimer, rng) → id`
- Optional rage upgrades (GAME_DESIGN §6.5a) are implemented **inside** each attack class (`CubeSlam`, `RoyalCharge`, `CrownShards`) as extra phases, enabled when `boss.phase === 'rage'` and the matching `CONFIG.rageUpgrades` switch is `true`. `isFinished()` returns `true` only after the extra phases.
- The two tactics rules (GAME_DESIGN §6.2a) are also pure functions in `Boss.ts`:
  - `updateCloseTimer(timer, distance, dt) → timer`
  - `applyMissPunish(remainingCooldown, alreadyPunished) → { remaining, punished }`
- `Player` reports a missed swing to `Game`, which calls `boss.onPlayerMissedSwing(playerPos)`.

### 4.5 Input (`systems/input.ts`)

- Tracks held keys by `KeyboardEvent.code`.
- Exposes **edge-triggered** actions that are consumed once per press: `rollPressed`, `swingPressed`, `mutePressed`, `anyStartPressed`. `anyStartPressed` is any key except `KeyM`, or a click.
- Listens on `window` for keys and on the canvas for `pointerdown` (button 0).
- On window `blur` or `visibilitychange` (hidden), clears all held keys and notifies `Game`.
- Calls `preventDefault()` for `Space`. Blocks `contextmenu` on the canvas.

### 4.6 Rendering

- `WebGLRenderer({ antialias: true })`.
- `setPixelRatio(min(devicePixelRatio, 2))`.
- `shadowMap.enabled = true`, `type = PCFSoftShadowMap`.
- Output color space sRGB (the Three.js default).
- On window `resize`: update the renderer size and the camera aspect.
- Before creating the renderer, check WebGL support. If it fails, show the WebGL error message (GAME_DESIGN §2) and stop.
- Wait for `document.fonts.ready` before showing the TITLE overlay, so the title doesn't flash in a fallback font.
- Performance budget: under 100 draw calls, a single shadow-casting light, no post-processing. Reuse geometries and materials; never create them per frame.

### 4.7 UI (`systems/ui.ts`, `styles.css`)

- A single `#overlay` element above the canvas (`position: fixed; inset: 0; pointer-events: none`).
- It contains one child element per screen or HUD item from GAME_DESIGN §2.
- `ui.show(state)` toggles CSS classes. Animations (blink, fade, scale) are CSS transitions and keyframes.
- Clicks always reach the canvas or window (`pointer-events: none` on the overlay), so "click to continue" works anywhere.
- Debug overlay (`?debug`): plain text, top-left. It updates at 4 Hz to avoid layout cost.

### 4.8 Audio (`systems/audio.ts`, `systems/sfx.ts`)

- `audio.unlock()` is called on the first user input; it creates or resumes the `AudioContext`.
- Before unlock, `play()` calls are silently ignored.
- Signal path: every sound → its own gain → `master` gain (0.8, or 0 when muted) → destination.
- **Sound sources: an asset file first, then the code-generated fallback.**
  - `audio.ts` discovers sound files at **build time** with
    `import.meta.glob('./assets/sfx/*.{mp3,ogg,wav}', { eager: true, query: '?url', import: 'default' })`
    (path relative to the importing file).
  - This yields a map of only the files that actually exist, so there are no runtime 404s and no config list.
  - A pure function `resolveSfxSources(globResult) → Map<SfxId, url>` maps each file name (without extension) to a known sound ID. If several formats exist for one ID, prefer `mp3` > `ogg` > `wav`. Unknown file names are ignored with one `console.info`.
  - On `unlock()`, each found file is fetched and decoded into an `AudioBuffer`. If one fails, log one `console.warn` and keep using that sound's recipe.
- `play(id, opts?)`: if a decoded buffer exists for `id`, play it (one-shot; for stoppable sounds, the handle stops the buffer source). Otherwise run the procedural recipe from `sfx.ts`.
  - `opts` may set the duration (for telegraph-length sounds) and a pitch variation. For files, the variation applies as `playbackRate`.
  - A file plays at the same relative loudness as its recipe (ASSETS.md §1.1).
- Adding or removing a file in `src/assets/sfx/` takes effect on the next `npm run dev` reload or build, with **no code change**.
- Long sounds (`charge_windup`, `slam_rise`) return a handle with `stop()`. The attack calls it if it is cancelled (player died, boss defeated).

## 5. Physics and collision (no engine)

### 5.1 Integration
- Semi-implicit Euler at the fixed step: `v += a·dt; p += v·dt`.
- Gravity 20 m/s² for debris and shards (the player never leaves the ground).
- Shards follow an exact ballistic arc solved at launch, so they land on target.

### 5.2 Ground
- The floor is the plane y = 0.
- **Player:** always on the ground (feet at y = 0); there is no jumping. Only the visual roll pivot rotates during a roll.

### 5.3 Arena bound
- Clamp the horizontal radius (GAME_DESIGN §4.2) and remove the outward velocity component.
- The boss is clamped to radius 27 m.

### 5.4 Collision helpers (`collision.ts`, pure functions, unit tested)

| Function | Math |
|---|---|
| `pointInOBB(p, center, halfSize, yaw)` | Rotate `p − center` by `−yaw` around Y; check `|x|,|y|,|z| ≤ halfSize` |
| `sphereOBB(c, r, center, halfSize, yaw)` | Transform `c` into box space; clamp it to the box to find the closest point; intersect if `distance² ≤ r²`. Also return the push-out direction for body contact |
| `sphereSphere(c1, r1, c2, r2)` | `|c1 − c2|² ≤ (r1 + r2)²` |
| `inRingBand(p, center, radius, halfWidth)` | Horizontal distance `d`; `|d − radius| ≤ halfWidth` |
| `inCircle(p, center, r)` | Horizontal distance `≤ r` |

The boss box is **yaw-only**: it never pitches or rolls. Squash is visual only, and the hit box keeps half-size 2.0.

### 5.5 Springs (`util/math.ts`)

`springStep(x, v, target, k, c, dt)`:

```
a = k·(target − x) − c·v
v += a·dt
x += v·dt
```

This is used for the limb pitches, the head offset and the boss squash.

### 5.6 Debris (`fx/debris.ts`)

- Each piece has a mesh, velocity, angular velocity and a "ground radius" (half its smallest dimension).
- Each step: apply gravity. When `y < groundRadius`:
  - set `y = groundRadius`
  - `v.y = −v.y × 0.35` (bounce)
  - `v.xz ×= 0.7`
  - `angularVelocity ×= 0.7`
- When speed is under 0.2 m/s on the ground, the piece goes to sleep (stops updating).
- Pieces are removed on `Game.reset()`.

## 6. `config.ts`

- A single exported, deeply `readonly` object `CONFIG`, grouped as: `player`, `swing`, `roll`, `wobble`, `boss`, `tactics`, `rage`, `rageUpgrades` (three booleans, all `false` by default, plus their values), `slam`, `charge`, `shards`, `camera`, `arena`, `lights`, `colors`, `fx`, `ui`, `transitions`, `audio`, `easy`.
- It contains **every** value marked or listed in GAME_DESIGN.md sections 1–11 (including transitions, UI timings, tactics and rage upgrades), with the same numbers. Use descriptive names with units in comments, e.g.:
  `player: { maxSpeed: 6, /* m/s */ accel: 10, /* m/s² */ ... }`.
- `flags.ts` applies `?easy` multipliers when values are read (e.g. `effectiveTelegraph = CONFIG.slam.telegraph × telegraphMult`). `CONFIG` itself is never mutated.

## 7. App configuration and scripts

`app/vite.config.ts`:
- `base: './'`, so the build works from CloudFront's root and from a local folder.
- `build.target: 'es2022'`.
- `server.port: 5173`, `preview.port: 4173`.
- Vitest `test.environment: 'node'`.

`app/package.json` scripts:

| Script | Command |
|---|---|
| `dev` | `vite` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `build` | `npm run typecheck && npm run test && vite build` |
| `preview` | `vite preview` |

The build fails if type checking or tests fail.

## 8. Testing strategy

| Level | What | Tool / method |
|---|---|---|
| Unit | `collision.ts` helpers; `springStep` stability (settles, no explosion at the fixed step); `chooseAttack` (no 3 in a row; no Charge within 6 m; close timer ≥ 3.0 s forces Slam, or Shards when Slam is blocked; over 1,000 seeded runs every valid attack appears); `updateCloseTimer` (+dt when close, −2·dt when not, never below 0); `applyMissPunish` (−0.8 s, floor 0.3 s, once per cooldown); boss HP / phase transitions (`takeHit` sequence → `hit, hit, rage, hit, defeated`; ignored during invulnerability and during the rage transition); swing phase timing (damage only in the active window, at most one hit per swing); roll timing (i-frames exactly 0.05–0.40 s; direction locked; no swing or roll during roll or recovery; no roll during cooldown); state flow (death → `TO_TITLE` after 2.0 s; victory → `TO_TITLE` on input after 1.0 s or automatically after 8 s; reset happens exactly once, at full black); `flags.ts` parsing; `resolveSfxSources` (an empty glob means every sound uses its recipe; `hit.mp3` maps to `hit`; mp3 beats ogg/wav for the same ID; unknown names are ignored) | Vitest |
| Debug visual | Hitbox wireframes, forced attacks, god mode, instant damage (`?debug`) | Manual, in the browser |
| Acceptance | The full GAME_DESIGN §13 checklist | Manual, on the booth laptop |
| Console hygiene | No errors or warnings during a full session | Chrome DevTools |
| Performance | Steady 60 fps with `?debug` FPS counter; Chrome Performance panel shows no long frames during attacks or debris | Manual |

## 9. AWS infrastructure (CDK stack `EldenCubeStack`)

### 9.1 Environment
- Region **`ap-southeast-1`** (Singapore). Account from `CDK_DEFAULT_ACCOUNT`.
- One-time per account and region: bootstrap (command in §9.3).
- Required CDK context `alertEmail` (the email for budget alerts). If it is missing, `bin/infra.ts` throws a clear error: *"Pass -c alertEmail=you@example.com"*.

### 9.2 Resources

| Resource | Configuration |
|---|---|
| S3 bucket | `blockPublicAccess: BLOCK_ALL`, `encryption: S3_MANAGED`, `enforceSSL: true`, `versioned: false`, `removalPolicy: DESTROY`, `autoDeleteObjects: true` |
| CloudFront distribution | Origin: `S3BucketOrigin.withOriginAccessControl(bucket)` (OAC; CDK creates the bucket policy). `defaultRootObject: 'index.html'`. `viewerProtocolPolicy: REDIRECT_TO_HTTPS`. `cachePolicy: CACHING_OPTIMIZED`. `compress: true`. `httpVersion: HTTP2_AND_3`. `priceClass: PRICE_CLASS_200` (includes Asia). `responseHeadersPolicy: SECURITY_HEADERS`. Default `*.cloudfront.net` certificate; no custom domain |
| BucketDeployment "Assets" | Source `../app/dist`, `include: ['assets/*']` with `exclude: ['*']`, `cacheControl: public, max-age=31536000, immutable`, `prune: false` |
| BucketDeployment "Site" | Source `../app/dist`, `exclude: ['assets/*']`, `cacheControl: no-cache`, `prune: false`, `distribution` and `distributionPaths: ['/*']` (invalidates on every deploy). Must depend on "Assets", so new hashed files exist before the new `index.html` |
| AWS Budgets (`CfnBudget`) | Name `elden-cube-monthly`, type COST, MONTHLY, limit USD 5. Email notifications to `alertEmail` at 80% ACTUAL and 100% FORECASTED |
| Outputs | `GameUrl` = `https://<distributionDomainName>`, `BucketName`, `DistributionId` |

`prune: false` means old hashed files stay in the bucket. That is harmless (a few MB) and avoids the two deployments deleting each other's files.

### 9.3 Commands (run in `infra/`)

Every AWS command uses the **named profile `elden-personal`** (§13.4). The `default` profile is never used, so a company profile on the same laptop is never touched.

| Action | Command |
|---|---|
| Build the game first | `cd ../app && npm run build` |
| Bootstrap (once) | `npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-1 --profile elden-personal` |
| Preview changes | `npx cdk diff -c alertEmail=<email> --profile elden-personal` |
| Deploy / update | `npx cdk deploy -c alertEmail=<email> --profile elden-personal` (prints `GameUrl`) |
| Teardown | `npx cdk destroy -c alertEmail=<email> --profile elden-personal`. Removes the bucket, its files, the distribution and the budget |

Add npm scripts in `infra/package.json` (`diff`, `deploy`, `destroy`) that include `--profile elden-personal`, so the profile is never forgotten.

Deployer permissions: an IAM identity that can assume the CDK bootstrap roles (e.g. AdministratorAccess on a personal or sandbox account).

## 10. Cost estimate

| Item | Estimate |
|---|---|
| S3 storage (a few MB) | Under USD 0.01 / month |
| CloudFront transfer and requests | Booth plus light public traffic should fit in CloudFront's free monthly allowance |
| CDK bootstrap resources (staging bucket, roles) | Cents per month at most |
| **Total expected** | **About USD 0 / month** |

Guardrail: the Budgets alert at USD 5. If it fires, run `cdk destroy`.

## 11. Security

- The bucket is private. Only CloudFront can read it, through OAC (signed requests).
- HTTPS only. Managed security headers are added to responses.
- There is no backend, no credentials in the app, no user data and no cookies.
- The build contains only static files. Secrets must never be placed in `app/`.

## 12. Offline fallback (booth)

- Keep a built copy of `app/dist/` on the booth laptop.
- `cd app && npm run preview` serves it at `http://localhost:4173` with no internet needed. Everything, including the font and sounds, is bundled.
- Bookmark both the `GameUrl` and `http://localhost:4173`.

## 13. Development environment and agent tooling

The **coding agent sets up this environment itself** (it asks for approval before running terminal commands). The only things the agent must **not** do are in §13.4 and §13.5.

### 13.1 Required tools

| Tool | Check | Install (macOS, via Homebrew) |
|---|---|---|
| Homebrew | `brew --version` | If missing, ask the user to install it from brew.sh (it needs their password) |
| Node.js LTS + npm | `node -v` (an LTS major), `npm -v` | `brew install node@24` (the LTS line in late 2026; use whichever line is LTS at the time), then make sure it is on `PATH` |
| git | `git --version` | `brew install git` |
| AWS CLI v2 | `aws --version` | `brew install awscli` |
| uv (runs the AWS MCP servers) | `uv --version` | `brew install uv` |
| Google Chrome | Installed in `/Applications` | `brew install --cask google-chrome` |

The AWS CDK CLI is **not** installed globally. It is a dev dependency of `infra/` and is run with `npx cdk`.

### 13.2 MCP servers for Kiro

The project is driven with the **Kiro CLI** (`kiro-cli`), always started from inside the `eldenCube/` folder, which is the workspace. The agent creates the workspace MCP config **`eldenCube/.kiro/settings/mcp.json`** with:

```json
{
  "mcpServers": {
    "aws-docs": {
      "command": "uvx",
      "args": ["awslabs.aws-documentation-mcp-server@latest"],
      "env": { "FASTMCP_LOG_LEVEL": "ERROR", "AWS_DOCUMENTATION_PARTITION": "aws" }
    },
    "aws-iac": {
      "command": "uvx",
      "args": ["awslabs.aws-iac-mcp-server@latest"],
      "env": { "FASTMCP_LOG_LEVEL": "ERROR", "AWS_PROFILE": "elden-personal", "AWS_REGION": "ap-southeast-1" }
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--isolated"]
    }
  }
}
```

| Server | Used for | Stage |
|---|---|---|
| `aws-docs` | Looking up current AWS documentation (CloudFront OAC, Budgets, BucketDeployment) | 2 |
| `aws-iac` | CDK best practices and template checks | 2 |
| `chrome-devtools` | Opening the game in Chrome, reading console errors, taking screenshots, checking performance. `--isolated` uses a temporary browser profile, so personal Chrome data is never touched | 1 |

After creating the file, the user restarts `kiro-cli` (from `eldenCube/`) and runs `/mcp` to check that all three servers are loaded. If a server fails, check that `uv` / `npx` are on `PATH`, then restart `kiro-cli`. Steering files go in `eldenCube/.kiro/steering/` (the Kiro CLI reads workspace steering).

### 13.3 Project dependencies

- **`app/`:** `three`, `@fontsource/cinzel`; dev: `vite`, `typescript`, `vitest`, `@types/three` (if the `three` version needs it).
- **`infra/`:** `aws-cdk-lib`, `constructs`; dev: `aws-cdk`, `typescript`, `ts-node`, `@types/node`.
- Use `npm ci` once the lock files exist.

### 13.4 AWS credentials (done by the user, never by the agent)

**Account used:** the user's personal AWS account, IAM user **`junsiengAdmin`** (AdministratorAccess policy). CLI profile name: **`elden-personal`**.

**Secrets rule:** the console password, access keys and MFA codes are **never** written in any project file, chat or commit. The agent must never ask for, write or print them. If a command needs credentials, the agent uses `--profile elden-personal` and nothing else.

The user creates the access key and the profile:
1. AWS console → IAM → Users → `junsiengAdmin` → **Security credentials** → **Create access key** → use case **Command Line Interface (CLI)** → copy both values (the secret is shown only once).
2. In the terminal:

```bash
aws configure --profile elden-personal      # access key of the personal admin IAM user; region ap-southeast-1; output json
aws sts get-caller-identity --profile elden-personal   # verify: shows the personal account ID
```

- Use a dedicated **IAM user with MFA**, not the root user.
- **Do not** use `aws configure` without `--profile` (that writes the `default` profile).
- **Do not** export `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in the shell. Environment variables override every profile.

### 13.5 Removing the personal credentials afterwards

When the project is finished, or before switching the laptop back to company use:
1. `npx cdk destroy … --profile elden-personal` (optional: also delete the `CDKToolkit` stack in the CloudFormation console).
2. Delete the `[elden-personal]` section from `~/.aws/credentials` and the `[profile elden-personal]` section from `~/.aws/config`.
3. In the IAM console of the personal account, **deactivate and delete that access key**. Even if a copy remains somewhere, it no longer works.
4. Verify: `aws sts get-caller-identity --profile elden-personal` now fails with "profile not found".
5. Change `AWS_PROFILE` in `.kiro/settings/mcp.json` if the project moves to another account.

