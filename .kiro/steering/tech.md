---
inclusion: always
---

# Tech — The Elden Cube

## Stack (ARCHITECTURE §2)
Latest stable version of each at project start, locked with `package-lock.json`.

| Layer | Choice |
|---|---|
| Runtime / tooling | Node.js LTS, npm |
| Language | TypeScript, `strict: true` everywhere |
| Build | Vite (`vanilla-ts` template) |
| 3D | `three` (+ `@types/three` if needed) |
| Physics | None — hand-written kinematics (ARCHITECTURE §5) |
| Audio | Web Audio API: sound file first, procedural recipe fallback |
| UI | Plain HTML/CSS overlay above the canvas |
| Font | `@fontsource/cinzel` weight 700 (bundled, offline) |
| Unit tests | Vitest (`test.environment: 'node'`) |
| Infra | AWS CDK v2 TypeScript (`aws-cdk-lib`, `constructs`); CDK CLI is a dev dependency, run with `npx cdk` |
| Target | Latest desktop Chrome |

**Do not add:** a physics engine, a UI framework, a state library, an analytics SDK, any runtime network call, any CDN/third-party asset load.

## config.ts rule (ARCHITECTURE §6)
- `app/src/config.ts` exports a single, deeply `readonly` object `CONFIG`, grouped as: `player`, `swing`, `roll`, `wobble`, `boss`, `tactics`, `rage`, `rageUpgrades`, `slam`, `charge`, `shards`, `camera`, `arena`, `lights`, `colors`, `fx`, `ui`, `transitions`, `audio`, `easy`.
- It contains **every** value from GAME_DESIGN §1–11 with exactly the documented numbers. Descriptive names, units in comments (e.g. `maxSpeed: 6, // m/s`).
- No tunable number is hard-coded anywhere else.
- `rageUpgrades.doubleSlam`, `.chargeUTurn`, `.staggeredShards` are all `false` by default.
- `CONFIG` is never mutated. `flags.ts` applies `?easy` multipliers when values are read.
- Values marked *(tune)* change only during playtesting (milestone 1.6), and only in `config.ts`.

## Conventions
- Units: meters, seconds, radians. Y up. Arena center = origin. +Z local = forward.
- Fixed simulation step 1/60 s; max 5 steps per frame; frame dt clamped to 0.1 s.
- Gameplay timers count simulation time; input locks, victory auto-return and `TO_TITLE` fades count real time.
- Pure logic (collision helpers, `springStep`, `chooseAttack`, `updateCloseTimer`, `applyMissPunish`, boss HP/phase, swing/roll timing, state-flow timing, flags parsing, `resolveSfxSources`) must be importable and testable under Vitest in a Node environment (no DOM/WebGL required).
- Seedable RNG (`util/rng.ts`); tests use fixed seeds.
- Rendering: `WebGLRenderer({ antialias: true })`, pixel ratio ≤ 2, `PCFShadowMap`, < 100 draw calls, one shadow-casting light, no post-processing. Reuse geometries/materials; never allocate per frame.
- Keys via `KeyboardEvent.code`; ignore `event.repeat`.
- Never reload the page to reset; `Game.reset()` restores state.

## App configuration (ARCHITECTURE §7)
`app/vite.config.ts`: `base: './'`, `build.target: 'es2022'`, `server.port: 5173`, `preview.port: 4173`, Vitest `test.environment: 'node'`.

## Scripts
`app/package.json`:

| Script | Command |
|---|---|
| `dev` | `vite` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `build` | `npm run typecheck && npm run test && vite build` |
| `preview` | `vite preview` |

The build fails if type checking or tests fail.

`infra/package.json`: `diff`, `deploy`, `destroy` scripts that always include `--profile elden-personal`. `cdk.json` app: `npx ts-node --prefer-ts-exts bin/infra.ts`. Region `ap-southeast-1`. Required context `-c alertEmail=…`.

## Verification
- After each change: `npm run typecheck` and `npm run test` in `app/`.
- In-browser checks via the `chrome-devtools` MCP server (console errors/warnings, screenshots, performance).
