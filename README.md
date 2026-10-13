# The Elden Cube

A small, silly and **very hard** 3D boss fight that runs in the browser.

You are **the Tarnished Intern**: a clumsy little hero with an oversized sword, slow to turn and quick to slide. You face **the Elden Cube**: a giant, angry, crowned slime cube that slams, charges, rains fire from the sky and breathes flame. The game parodies souls-like games: every attack is telegraphed, every mistake is your own, and you will die a lot.

---

## How to play

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move (relative to the camera; `A` / `D` circle the boss) |
| `Space` | Roll: a clumsy dodge with invincibility frames |
| Left click / `F` | Attack: a 3-hit combo (the third hit is a heavy finisher) |
| `R` | Drink a flask (heals 1 HP) |
| `Esc` | Pause / resume |
| `M` | Mute / unmute |

- Press any key or click on the start screen to begin. `Esc` or losing focus pauses the game; `Esc` or a click continues.
- **You:** 3 HP, 3 flasks per fight, and a stamina bar that limits how much you can roll and swing in a row.
- **The boss:** 36 HP. At half health it enters **rage**: it turns red, starts a 10-second meteor shower under a blood-red moon, and everything gets faster.
- **The arena:** an abandoned stone ruin with four crown pillars. A pillar is solid cover: it takes three hits from the boss before it crumbles, and it shields you from a shockwave, spike burst, shove or flame blast if you stand right behind it. The charge and the beam smash straight through.
- Every session is fresh: no accounts, no saves, no leaderboard.

### Tips

- **Roll through attacks, not away from them.** The roll's invincibility beats every attack if you time it.
- **Watch your stamina.** In rage, the double flame breath needs two rolls in a row.
- **Don't get greedy.** Hug the boss or mash attacks and it defends itself: a spike burst, a jump away, or a shove.
- **Use the pillars.** They break, so spend them wisely. Every attempt starts with all four standing.
- The start screen shows a cryptic tip each time. Read them.
- **Punish the openings.** After a Cube Slam the boss is stuck for 2 seconds: that's your window for a full combo.

---

## The boss's moves

| Move | What it does | How to survive |
|---|---|---|
| **Cube Slam** | Stretches up into the air and splats down; a fiery shockwave ring expands outward | Roll through the ring as it reaches you, or be far away; then punish the stuck boss |
| **Royal Charge** | Crouches, glows red, then dashes in a straight line | Strafe or roll out of its path |
| **Crown Rain** | Fireballs rain down in three waves (a cage, a wall, a random scatter) onto red warning circles, leaving burning marks | Leave the cage early and read the gaps; one roll can't dodge two waves |
| **Royal Rebuke** | Its main close-range defence: spikes burst out of its body in every direction. In rage it sometimes holds the wind-up a moment longer (a feint) | Back off when the spike tips poke out, or roll on the tell, and watch for the hold |
| **Jelly Hop-Back** | Another defence: it squats, leaps far away from you and lands with a splash ring | Don't chase straight in; roll through the ring |
| **Bounce Shove** | Another defence: it wobbles and swells, then bounces you far away. No damage, but it costs you time | Roll at the burst |
| **Cone Flame Breath** | A red cone appears on the ground; a white-hot ball compresses in its mouth, then a shotgun blast of flames fills the cone (twice in rage) | Roll through it, or get behind the boss |
| **Flame Beam** | Charges an orb, locks on (the aim line flashes), then fires a beam at your feet and sweeps after you, leaving a burning trail. It never turns back | Sprint sideways the moment the line flashes, or roll against the sweep |
| **Meteor Shower** | In rage: 10 seconds of meteors falling all over the arena while the boss keeps fighting | Watch the warning circles |

The boss picks its moves by your distance: hugging it invites its defences, keeping your distance invites the beam and the charge.

---

## Features

- **Hand-built 3D:** everything is made in code from simple shapes. A rounded hero with elbows and knees and a real sword that he draws from his back. A gelatinous boss that squashes, stretches and wobbles.
- **A moonlit ruin:** stone slab rings reclaimed by grass, breakable crown pillars, fallen columns and flickering torches; it turns blood red during the meteor shower.
- **Effects:** glowing fire (bloom on fire, the beam and embers only), anime-style cel flames, fireballs and meteors with smoke trails, burning ground marks, jelly splashes, a Hyper-Beam-style beam with heat shimmer and a molten scar, impact screen effects, slow motion, camera shake and hit-stop.
- **Sound:** recorded sound effects and fight music, with code-generated fallbacks for every sound, so the game also works with no audio files at all.
- **Clumsy on purpose:** momentum, sliding stops and lazy turning, but never dropped input.

---

## Running it locally

**Requirements:** Node.js (LTS) and npm, and a desktop browser with WebGL 2. Latest Chrome is recommended.

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

| Command (in `app/`) | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript type check |
| `npm run build` | Type check + tests + production build into `app/dist/` |
| `npm run preview` | Serves the production build at http://localhost:4173 (works offline) |

### URL options

| Option | Effect |
|---|---|
| `?easy` | A gentler boss: slower moves, longer warnings, longer pauses |
| `?lowfx` | No post-processing (no glow, no screen effects): for a slow computer |
| `?debug` | Shows FPS, game state and hitboxes, and enables debug keys: `1` Slam, `2` Charge, `3` Crown Rain, `4` Rebuke, `5` Cone Breath, `6` Flame Beam, `7` Meteor Shower, `8` Hop-Back, `9` Shove, `0` Feint Rebuke, `K` damage the boss, `G` god mode |

The options can be combined, for example `?easy&debug`.

---

## Making changes

- **Tuning:** every gameplay and visual number (speeds, timings, damage, HP, colours, effect sizes) lives in [`app/src/config.ts`](app/src/config.ts).
- **Sounds:** drop a file named after a sound ID into [`app/src/assets/sfx/`](app/src/assets/sfx/) (for example `hit.mp3`) and it replaces the generated sound. Delete it and the generated sound comes back. The music lives in `app/src/assets/bgm/bgm.mp3`. The list of sound IDs is in [ASSETS.md](ASSETS.md).

### Project layout

```
app/
├── index.html
├── public/              favicon, CREDITS.md
├── src/
│   ├── main.ts          start-up: WebGL check, renderer, game loop
│   ├── config.ts        every tunable number
│   ├── game/            the game and its state machine, the ruin arena, the pillars
│   ├── entities/        the player and the boss (model, motion, logic)
│   ├── attacks/         every boss move and the hazards they leave
│   ├── fx/              particles, flames, decals, post-processing (bloom), slime motion, materials
│   ├── systems/         input, camera, audio and sound recipes, UI overlay
│   ├── util/            math helpers, seeded random
│   └── assets/          optional sound files and music
└── tests/               unit tests
```

### Design documents

| File | Contents |
|---|---|
| [GAME_DESIGN.md](GAME_DESIGN.md) | The complete gameplay spec: states, controls, player, boss, every attack, camera, arena, audio |
| [ASSETS.md](ASSETS.md) | Sounds (IDs and generated recipes), colour palette, font |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical design: game loop, collision, rendering, effects, testing |

---

## Built with

TypeScript · Three.js · Vite · Vitest · Web Audio API

## Credits

Music by **alkakrab**; sound effects from **Pixabay**; Three.js; the Cinzel font. Full list with licenses: [app/public/CREDITS.md](app/public/CREDITS.md).
