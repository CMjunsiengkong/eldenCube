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
| `explosion` *(1.6)* | Should | Fireball explosion: deep boom + blast + crackle (meteors, rage Crown Rain) | 1.3 s | 0.8 |
| `rage` | Should | Angry growl | 0.8 s | 0.5 |
| `rebuke_windup` | Must | Short rising crackle (the tell) | 0.35 s | 0.45 |
| `rebuke_burst` | Should | Sharp burst / whip-crack | 0.25 s | 0.7 |
| `hop_jump` *(1.6)* | Should | Rubbery rising "boing" + whoosh | 0.25 s | 0.45 |
| `hop_land` *(1.6)* | Should | Wet splat over a soft thump | 0.4 s | 0.8 |
| `shove` *(1.6)* | Should | Big wobbly "bwoing" + puff of air | 0.35 s | 0.6 |
| `pillar_hit` *(1.6)* | Should | Short stone crack + dull knock | 0.2 s | 0.55 |
| `pillar_break` *(1.6)* | Should | Stone crack + rumble + rock clinks | 0.6 s | 0.75 |
| `beam_charge` | Must | Rising energy charge-up (stoppable; make the file ≥ 1.0 s) | = charge time | 1.0 |
| `beam_fire` | Must | Roaring beam blast, sustained (stoppable; make the file ≥ 3 s) | = firing time | 1.0 |
| `cone_blast` | Must | Shotgun-like fire blast (Cone Breath release) | ≈ 1 s | 0.8 |
| `player_hurt` | Must | Comic "oof" thump | 0.25 s | 0.7 |
| `flask_drink` | Should | Gulp gulp | 0.5 s | 0.4 |
| `flask_heal` | Should | Bright sparkle chime | 0.4 s | 0.4 |
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
| `explosion` *(1.6)* | Sine 90 → 28 Hz over 0.7 s (vol 1.0), noise → lowpass 1800 Hz over 0.6 s (vol 0.8), noise → highpass 2500 Hz from 0.05 s over 0.5 s (vol 0.2); ±10% random pitch |
| `rage` | Two sawtooths at 110 Hz and 116 Hz (the detune gives the growl) → lowpass sweeping 200 → 1500 Hz over 0.8 s. vol 0.5 |
| `rebuke_windup` | Square 300 → 1200 Hz over the tell time (0.35 s) → bandpass Q 4 following the pitch, gain trembling with a 30 Hz LFO. vol 0.45. Stoppable |
| `rebuke_burst` | Noise → highpass 1500 Hz decaying over 0.2 s (vol 0.7), plus sine 220 → 80 Hz over 0.15 s (vol 0.5) |
| `hop_jump` *(1.6)* | Sine 110 → 320 Hz over 0.25 s with a 14 Hz ±25 Hz vibrato (vol 0.8), plus bandpassed noise at 900 Hz over 0.2 s (vol 0.3) |
| `hop_land` *(1.6)* | Sine 90 → 35 Hz over 0.4 s (vol 0.9), plus noise → lowpass 900 Hz (Q 1.5) over 0.3 s (vol 0.6) |
| `pillar_hit` *(1.6)* | Noise → bandpass 1400 Hz (Q 1.2) over 0.18 s (vol 0.8), sine 140 → 60 Hz over 0.15 s (vol 0.6), one low clink at 0.04 s |
| `pillar_break` *(1.6)* | Noise → lowpass 700 Hz over 0.6 s (vol 0.9), sine 80 → 30 Hz over 0.5 s (vol 0.7), three `shard_land`-style clinks at 0.08 / 0.17 / 0.29 s (vol 0.15, low pitch) |
| `shove` *(1.6)* | Triangle 180 → 90 → 140 Hz over 0.35 s with an 18 Hz ±30 Hz vibrato (vol 0.8), plus noise → lowpass 1400 Hz over 0.15 s (vol 0.4) |
| `cone_blast` | Noise → lowpass 2500 Hz decaying over 0.35 s (vol 0.9), plus sine 120 → 40 Hz over 0.25 s (vol 0.8), plus a crackle: noise → highpass 3000 Hz from 0.04 s decaying over 0.3 s (vol 0.25) |
| `beam_charge` | Sawtooth 120 → 900 Hz over the charge time → bandpass following the pitch, gain trembling with a 14 → 40 Hz LFO, plus noise → bandpass rising 400 → 3000 Hz. vol 0.45. Stoppable |
| `beam_fire` | A burst (noise → lowpass 4000 Hz, 0.15 s, vol 0.8), then for the firing time: noise → bandpass 700 Hz (Q 0.8) with a 7 Hz flutter (vol 0.5) plus a 55 Hz sawtooth rumble → lowpass 300 Hz (vol 0.5). Stoppable |
| `player_hurt` | Sine 260 → 120 Hz over 0.18 s with a 12 Hz vibrato (vol 0.7), plus noise → lowpass 800 Hz lasting 0.06 s (vol 0.4) |
| `flask_drink` | Two "gulps" 0.25 s apart: sine 180 → 120 → 200 Hz lasting 0.12 s each, through lowpass 600 Hz. vol 0.4 |
| `flask_heal` | Triangle arpeggio 880, 1175, 1760 Hz, 0.08 s per note, each decaying over 0.15 s. vol 0.4 |
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

### 1.4 Background music (optional file, milestone 1.5c)

| Rule | Detail |
|---|---|
| Folder and name | `app/src/assets/bgm/bgm.mp3` (or `.ogg` / `.wav`; priority mp3 > ogg > wav). Keep a `.gitkeep` in the folder |
| When it plays | Only during the fight: starts at fight start, fades out on death or victory, never on the start screen (GAME_DESIGN §10) |
| No file | No music. There is no generated fallback |
| Funny tone | Played at playback rate 1.12 (faster and about +2 semitones higher), set in `CONFIG.audio.bgm.rate`. Pick an epic or dramatic boss track; the speed-up makes it silly |
| Loop | The whole file loops. Choose a track that loops cleanly, or trim it to a loop point |
| Size | Stereo is fine; 1–3 minutes; keep it under about 4 MB (128 kbps MP3) |
| Licence | CC0, or free with attribution recorded in `CREDITS.md` |

## 2. Art and visuals (all built in code)

There are **no textures, 3D models or image files** in the game. Every visual is a Three.js primitive (boxes, rounded boxes, capsules, spheres, cones, cylinders) with a flat color, or a small procedural shader effect (particles, burn marks, flames, the shockwave glow, the rim light). Exact geometry, positions and colors are in GAME_DESIGN.md:

| Item | Spec location |
|---|---|
| Player (rounded limbs with elbows and knees, sword, scabbard) | GAME_DESIGN §4.1 |
| Boss, crown, face | GAME_DESIGN §6.1 |
| Arena, outer field, edge ring, night sky, fog, moon, torches | GAME_DESIGN §8 |
| Shockwave band and embers, warning circles, fireballs and burn marks, Rebuke spikes, heal aura | GAME_DESIGN §6.5, §4.3c |
| Player HUD (HP pips, flask counter, stamina bar), flask prop | GAME_DESIGN §2, §4.3c |
| Debris (player parts, 8 boss cubes, crown) | GAME_DESIGN §6.6, §9 |

**Color palette** (also stored in `CONFIG.colors`):

| Name | Hex |
|---|---|
| Player body | `#3A86FF` |
| Player arms | `#2B66C4` |
| Player legs | `#1D3557` |
| Player head | `#FFD6A5` |
| Sword blade | `#CED4DA` |
| Sword pommel / crossguard | `#D4A017` |
| Sword grip | `#5C3A21` |
| Belt / scabbard / boots | `#6B4226` / `#4A3426` / `#3D2B1F` |
| Player rim light | `#9DB7FF` |
| Boss (Phase 1) | `#6A4C93` |
| Boss (rage) | `#D62828` |
| Crown | `#FFC300` |
| Fireball core / fire | `#FFB347` / `#FF6A1A` |
| Scorch mark | `#1A0F08` |
| Eyes / pupils | `#FFFFFF` / `#111111` |
| Shockwave / its core | `#FF7B00` / `#FFD27A` |
| Warning circles | `#FF3B30` |
| Rebuke spikes | `#FFE066` |
| Flask / heal flash | `#F4A259` / `#FFD166` |
| Stamina bar | `#6BBF59` |
| Arena grass | `#6AB04C` |
| Outer field | `#5E9E44` |
| Arena edge | `#4A7F35` |
| Night sky / fog | `#0B1020` |
| Hemisphere sky / ground | `#3B4A7A` / `#141A10` |
| Moonlight | `#A8B8FF` |
| Torch light / flame | `#FF9A3C` / `#FFB347` |
| Torch pole / bowl | `#3B2A1E` / `#2E2E33` |
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

| Item | Purpose | How / source | Status (2026-10-13) |
|---|---|---|---|
| Architecture diagrams (booth TV) | Explaining the AWS and game parts | `eldencube-aws-architecture.drawio` (build → deploy → host on AWS → play, plus the request journey) and `eldencube-game-architecture.drawio` (the game's parts: entities, boss AI, level design, VFX, camera, audio, game loop). Both are 16:9 with real screenshots, each with a one-page PDF export. The full proposal version, with the booth details, is `../eventFlow.drawio`; the detailed developer module map is `../eldencube-gameExplaination.drawio` | Up to date |
| Booth event flow diagram | Your own guide for the booth loop | Sheet 2 of the proposal copy `../eventFlow.drawio` (not in the audience versions) | Up to date |
| Poster / signage | Draw visitors in: title, "Built with Kiro · Hosted on AWS", controls | Canva or Figma; print A3/A2. Use AWS and Kiro logos only according to their brand guidelines, or text only | Done |
| QR code to `GameUrl` (optional) | Visitors can play later | Any free QR generator → https://d376ckm5wji8ku.cloudfront.net (the game stays hosted after the event) | Optional |
| Backup gameplay video | Last-resort fallback | macOS screen recording (Cmd+Shift+5), 1–2 minutes: title → death → win | Optional |
| Kiro spec screenshots | "Plan before you build" proof during the Kiro intro | Captured while building the game in Kiro | Done |
| Live demo fallback games | Live demo fallback | `~/Project/SnakeGame` and `~/Project/Tetris`, built with Kiro; see `../liveDemo/LIVE_DEMO.md` | Done |

## 5. Accounts, tools and hardware

| Item | Notes | Needed for |
|---|---|---|
| Node.js LTS + npm | Build and test | Game Stage 0 |
| Kiro, with a plan that has enough usage | Build the game; about 10–20 live demos on the day | Game Stage 0; live demo |
| Chrome (latest) | Target browser | Game Stage 0 |
| Personal AWS account, IAM user `junsiengAdmin` (admin), CLI profile `elden-personal` (ARCHITECTURE.md §13.4) | CDK deploy | Game Stage 0 (bootstrap), Stage 2 |
| AWS CLI v2, configured profile | CDK authentication | Game Stage 0 |
| Email address for budget alerts | `-c alertEmail=…` | Game Stage 0 / 2 |
| Python 3 with pygame (each demo game has its own `.venv`) | Live demo games | Live demo |
| draw.io (web or desktop) | Diagrams | Booth materials |
| Booth laptop, charger, mouse (plus spare batteries), HDMI adapter, optional speaker | Event day | Event day |
