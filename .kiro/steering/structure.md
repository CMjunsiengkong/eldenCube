---
inclusion: always
---

# Structure — The Elden Cube (ARCHITECTURE §3)

The code lives next to the documents inside `eldenCube/`. `app` and `infra` are two independent npm packages. Do not add files or folders outside this layout without asking.

```
eldenCube/
├── README.md, GAME_DESIGN.md, ARCHITECTURE.md, ASSETS.md, PROJECT_PLAN.md, eldencube.drawio
├── .gitignore                      # node_modules, dist, cdk.out, .DS_Store
├── .kiro/settings/mcp.json         # MCP servers (aws-docs, aws-iac, chrome-devtools)
├── .kiro/steering/                 # product.md, tech.md, structure.md, rules.md
├── .kiro/specs/                    # elden-cube-game, elden-cube-deploy
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
│   │   │   └── sfx/                # optional <id>.mp3|.ogg|.wav; may be empty (keep .gitkeep)
│   │   ├── main.ts                 # bootstrap: WebGL check, renderer, Game, loop start
│   │   ├── config.ts               # EVERY tunable number
│   │   ├── flags.ts                # parses ?easy / ?debug once
│   │   ├── loop.ts                 # fixed-timestep loop, hit-stop, time scale
│   │   ├── game/
│   │   │   ├── Game.ts             # owns everything; the state machine
│   │   │   └── Arena.ts            # floor, outer field, edge ring, sky, fog, lights
│   │   ├── entities/
│   │   │   ├── Player.ts           # model, movement, roll, combo, stamina, flask, HP, buffer, wobble, hitbox, break-apart
│   │   │   └── Boss.ts             # model, HP, phases, chase, hit reaction, scheduler, defeat
│   │   ├── attacks/
│   │   │   ├── Attack.ts           # shared interface
│   │   │   ├── Hazards.ts          # rings, shards, circles, Rebuke ring (outlive the attack)
│   │   │   ├── CubeSlam.ts
│   │   │   ├── RoyalCharge.ts
│   │   │   ├── CrownRain.ts
│   │   │   └── RoyalRebuke.ts
│   │   ├── systems/
│   │   │   ├── input.ts            # key/mouse state, edge-triggered actions, blur handling
│   │   │   ├── camera.ts           # title orbit, lock-on, title→fight blend, shake
│   │   │   ├── collision.ts        # pure math helpers
│   │   │   ├── audio.ts            # AudioContext, master gain, mute; file first, recipe fallback
│   │   │   ├── sfx.ts              # procedural sound recipes
│   │   │   └── ui.ts               # DOM overlay: screens, HUD, health bar, pause, debug
│   │   ├── fx/
│   │   │   ├── debris.ts           # debris pieces
│   │   │   └── effects.ts          # flash, squash springs, warning circles, shockwave mesh
│   │   ├── util/
│   │   │   ├── math.ts             # lerp, clamp, easing, springStep, random range
│   │   │   └── rng.ts              # seedable random
│   │   └── styles.css              # overlay styles
│   └── tests/                      # Vitest unit tests
└── infra/                          # AWS CDK app
    ├── package.json
    ├── tsconfig.json
    ├── cdk.json                    # "app": "npx ts-node --prefer-ts-exts bin/infra.ts"
    ├── bin/infra.ts
    └── lib/EldenCubeStack.ts
```

Never place secrets anywhere in `app/` or `infra/`.
