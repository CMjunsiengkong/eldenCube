# Assets & Resources — The Elden Cube

This document lists every non-code resource the project needs, with how each is made or where it comes from. **Everything the game needs is generated in code or installed from npm**, so it is complete with no downloaded files. Sound files are an optional upgrade that take priority when present (§1.3).

**Rules**
- **Offline:** every asset is bundled into the build (`app/dist/`). The game never loads anything from a third-party server or CDN.
- **Licensing:** only use things generated in code, npm packages with open licenses, or CC0 files. List every asset's source in `app/public/CREDITS.md`.

---

## 1. Sound effects

**How sounds are chosen, per sound ID:**

```
sound file exists in app/src/assets/sfx/<id>.(mp3|ogg|wav)  and decodes OK ?
        ├── yes → play the file
        └── no  → play the code-generated recipe (§1.2)   ← default when the folder is empty
```

- The code-generated recipes are **always implemented for every sound**. They are the default and the fallback.
- Sound files are an **optional upgrade** you can drop in at any time (§1.3).
- You can mix the two freely: for example, only `player_break.mp3` and `victory.mp3` as files, with everything else generated.

### 1.1 Overview

| ID | Priority | Character | Approx. length | Relative loudness |
|---|---|---|---|---|
| `swing` | Must | Clumsy whoosh | 0.20 s | 0.5 |
| `hit` | Must | Heavy thunk | 0.15 s | 0.9 |
| `swing_ground` | Optional | Soft thud | 0.12 s | 0.4 |
| `roll` | Must | Tumbling whoosh | 0.45 s | 0.4 |
| `roll_end` | Should | Dizzy thump plus a tiny "boing" | 0.25 s | 0.35 |
| `footstep` | Optional | Soft tap | 0.04 s | 0.12 |
| `slam_rise` | Should | Rising warning tone | = telegraph time | 0.25 |
| `slam_impact` | Must | Deep BOOM plus rumble (the loudest sound) | 0.8 s | 1.0 |
| `charge_windup` | Should | Rattling shake | = telegraph time | 0.3 |
| `charge_dash` | Should | Fast whoosh / roar | 0.5 s | 0.5 |
| `shard_launch` | Should | Pop pop pop | 0.25 s | 0.4 |
| `shard_land` | Should | Clinks | 0.10 s | 0.3 |
| `rage` | Should | Angry growl | 0.8 s | 0.5 |
| `player_break` | **Must** | Clatter plus a falling slide whistle (the main joke) | 1.0 s | 0.6 |
| `you_died` | Must | Low dramatic "dong" | 2.5 s | 0.8 |
| `boss_break` | Must | Big crash plus small cubes bouncing | 1.2 s | 0.9 |
| `victory` | Must | Short fanfare | 1.1 s | 0.4 |

If time runs short, cut the **Optional** sounds first, then the **Should** sounds. **Never cut a Must sound.**

### 1.2 Code-generated recipes (default and fallback; implement all of them in `systems/sfx.ts`)

Building blocks (helpers in `sfx.ts`):
- **Oscillator** with a frequency ramp: `exponentialRampToValueAtTime`.
- **Noise:** a white-noise `AudioBuffer` (1 s, created once and reused) played through a `BiquadFilterNode`.
- **Envelope:** a gain node with a 5–10 ms attack, then an exponential decay toward 0.0001.
- **Loudness:** "vol" below is the peak gain of each recipe, before the master gain.

| ID | Recipe |
|---|---|
| `swing` | Noise → bandpass (Q 1.2) sweeping 600 → 2400 Hz over 0.18 s. Envelope: attack 0.02 s, decay to 0 by 0.20 s. vol 0.5. Multiply the filter frequencies by a random 0.9–1.1 on each play |
| `hit` | Sine 140 → 60 Hz over 0.15 s (vol 0.9), plus a noise burst → lowpass 1200 Hz lasting 0.08 s (vol 0.5) |
| `swing_ground` | Sine 90 → 50 Hz over 0.12 s. vol 0.4 |
| `roll` | Noise → bandpass (Q 0.8) sweeping 300 → 900 → 400 Hz over 0.45 s (a rise and fall, like tumbling), vol 0.4, plus a soft sine 110 → 70 Hz thump at 0.25 s lasting 0.08 s (vol 0.25) |
| `roll_end` | Sine 120 → 60 Hz over 0.08 s (vol 0.35), then a sine 500 → 700 → 450 Hz wobble (6 Hz vibrato) lasting 0.15 s (vol 0.15): a dizzy landing |
| `footstep` | Noise → lowpass 400 Hz lasting 0.04 s. vol 0.12 |
| `slam_rise` | Sawtooth 80 → 240 Hz over the telegraph time → lowpass 800 Hz. vol 0.25. Stoppable |
| `slam_impact` | Sine 70 → 30 Hz over 0.6 s (vol 1.0), plus noise → lowpass 300 Hz decaying over 0.8 s (vol 0.7) |
| `charge_windup` | Sawtooth 60 Hz whose gain is modulated by an 18 Hz square LFO (the rattle), for the telegraph time. vol 0.3. Stoppable |
| `charge_dash` | Noise → bandpass sweeping 300 → 1200 Hz over 0.5 s. vol 0.5 |
| `shard_launch` | Three "pops" 0.08 s apart: sine 400 → 900 Hz lasting 0.06 s each. vol 0.4 |
| `shard_land` | Triangle 1800 → 1200 Hz lasting 0.08 s, plus triangle 2600 Hz at half volume. vol 0.3 |
| `rage` | Two sawtooths at 110 Hz and 116 Hz (the detune gives the growl) → lowpass sweeping 200 → 1500 Hz over 0.8 s. vol 0.5 |
| `player_break` | **Clatter:** 6 noise bursts → highpass 2000 Hz, 0.03 s each, at random times within 0.4 s (vol 0.4). **Slide whistle:** sine 1400 → 300 Hz (exponential) over 0.9 s, with a 6 Hz vibrato of ±20 Hz (vol 0.35) |
| `you_died` | Sines at 98 Hz (vol 0.8), 196 Hz (0.4) and 294 Hz (0.2), attack 0.01 s, exponential decay over 2.5 s |
| `boss_break` | Noise → lowpass 2000 Hz decaying over 1.0 s (vol 0.9), plus sine 60 → 30 Hz over 0.8 s (vol 0.8), plus 8 `shard_land`-style clinks at random times within 1.0 s (vol 0.25) |
| `victory` | Triangle wave notes C5, E5, G5 (0.12 s each), then C6 held for 0.6 s, each note with a short envelope. vol 0.4 |

The whole mix goes through the master gain (0.8 when sound is on, 0 when muted).

### 1.3 Sound asset files (optional; they take priority when present)

To use a real recording for any sound, **just drop the file in. No code or config change is needed.**

| Rule | Detail |
|---|---|
| Folder | `app/src/assets/sfx/` (the folder exists in the repo and may be empty; keep a `.gitkeep`) |
| File name | Exactly the sound ID from §1.1 plus an extension, e.g. `player_break.mp3`, `victory.ogg`. Lowercase |
| Formats | `.mp3`, `.ogg` or `.wav`. If several exist for one ID, priority is mp3 > ogg > wav |
| Detection | At build time via Vite `import.meta.glob` (ARCHITECTURE.md §4.8). Files are bundled into `dist/` with hashed names. A missing file never causes a network request or a console error |
| Failure | If a file fails to decode, the game logs one warning and uses that sound's recipe |
| Unknown names | Files that don't match an ID are ignored (one info message in the console) |
| Telegraph-length sounds | `slam_rise` and `charge_windup` files are stopped when the attack ends or is cancelled. Make them at least 1.0 s long |
| Loudness | Normalize files so they sound about as loud as the recipe's relative loudness in §1.1 |
| Size | Mono, trimmed short; keep all files together under about 5 MB |
| Remove | Delete the file → that sound goes back to its recipe on the next reload or build |

Good free sources for sound files:
- **Kenney.nl** (CC0, no credit needed): impacts, jingles.
- **Pixabay sound effects** (free, no credit needed): slide whistle, dramatic "dong".
- **jsfxr / sfxr.me** (you generate the sound yourself, so you own it).

Record each file's source in `CREDITS.md`.

## 2. Art and visuals (all built in code)

There are **no textures, 3D models or image files** in the game. Every visual is a Three.js primitive with a flat color. Exact geometry, positions and colors are in GAME_DESIGN.md:

| Item | Spec location |
|---|---|
| Player (7 primitives) | GAME_DESIGN §4.1 |
| Boss, crown, face | GAME_DESIGN §6.1 |
| Arena, outer field, edge ring, sky, fog, lights | GAME_DESIGN §8 |
| Shockwave ring, warning circles, shards | GAME_DESIGN §6.5 |
| Debris (player parts, 8 boss cubes, crown) | GAME_DESIGN §6.6, §9 |

**Color palette** (also stored in `CONFIG.colors`):

| Name | Hex |
|---|---|
| Player body | `#3A86FF` |
| Player arms | `#2B66C4` |
| Player legs | `#1D3557` |
| Player head | `#FFD6A5` |
| Weapon | `#CED4DA` |
| Boss (Phase 1) | `#6A4C93` |
| Boss (rage) | `#D62828` |
| Crown / shards | `#FFC300` |
| Eyes / pupils | `#FFFFFF` / `#111111` |
| Shockwave | `#FF7B00` |
| Warning circles | `#FF3B30` |
| Arena grass | `#6AB04C` |
| Outer field | `#5E9E44` |
| Arena edge | `#4A7F35` |
| Sky / fog | `#BFE3FF` |
| UI gold | `#E0B84C` |
| "YOU DIED" red | `#A4161A` |
| Health bar | `#C1121F` |

## 3. Fonts, icon, page

| Item | How |
|---|---|
| Title / result font | **Cinzel 700**, from the npm package `@fontsource/cinzel`. Import `@fontsource/cinzel/700.css` in `main.ts`. SIL Open Font License |
| UI font | `system-ui, -apple-system, "Segoe UI", sans-serif`, no download |
| Favicon | `app/public/favicon.svg`, hand-written SVG: an isometric purple (`#6A4C93`) cube with a small gold (`#FFC300`) three-point crown on top, 64×64 viewBox. Linked from `index.html` |
| Page title | `<title>The Elden Cube</title>` |
| `CREDITS.md` | Lists: Three.js (MIT), Cinzel (OFL), "sound effects procedurally generated", and any sound files in `src/assets/sfx/` with their sources |

## 4. Booth materials (made by hand; not part of the game build plan)

| Item | Purpose | How / source | When |
|---|---|---|---|
| Architecture diagram | Explaining the AWS part | `eldencube.drawio`, sheet 1 (already drawn). Export as PNG/PDF from draw.io | Any time |
| Booth event flow diagram | Your own guide for the booth loop | `eldencube.drawio`, sheet 2 (already drawn) | Any time |
| Poster / signage | Draw visitors in: title, "Built with Kiro · Hosted on AWS", controls | Canva or Figma; print A3/A2. Use AWS and Kiro logos only according to their brand guidelines, or text only | Before the event |
| QR code to `GameUrl` (optional) | Visitors can play later | Any free QR generator, only if the game stays hosted after the event | After game Stage 2 |
| Backup gameplay video | Last-resort fallback | macOS screen recording (Cmd+Shift+5), 1–2 minutes: title → death → win | After game Stage 3 |
| Kiro spec screenshots | "Plan before you build" proof during the Kiro intro | Captured while building the game in Kiro | During game Stage 1 |
| Live demo `prepared/` folder | Live demo fallback | See `../liveDemo/LIVE_DEMO.md` | Before the event |

## 5. Accounts, tools and hardware

| Item | Notes | Needed for |
|---|---|---|
| Node.js LTS + npm | Build and test | Game Stage 0 |
| Kiro, with a plan that has enough usage | Build the game; about 10–20 live demos on the day | Game Stage 0; live demo |
| Chrome (latest) | Target browser | Game Stage 0 |
| Personal AWS account, IAM user `junsiengAdmin` (admin), CLI profile `elden-personal` (ARCHITECTURE.md §13.4) | CDK deploy | Game Stage 0 (bootstrap), Stage 2 |
| AWS CLI v2, configured profile | CDK authentication | Game Stage 0 |
| Email address for budget alerts | `-c alertEmail=…` | Game Stage 0 / 2 |
| Python 3 with tkinter | Live demo game | Live demo |
| draw.io (web or desktop) | Diagrams | Booth materials |
| Booth laptop, charger, mouse (plus spare batteries), HDMI adapter, optional speaker | Event day | Event day |
