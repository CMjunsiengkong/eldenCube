# Game Design — The Elden Cube

A one-on-one boss fight that parodies hard "souls-like" games. The hero is extremely clumsy, and the boss is a giant cube wearing a crown. **One hit kills the player. The cube takes 5 hits.**

This document is the **complete gameplay specification**. Every value an implementer needs is here. Any value marked *(tune)* is a starting value that may change during playtesting. All tunable values must live in `app/src/config.ts` (see ARCHITECTURE.md §6), never hard-coded elsewhere.

**Conventions**
- Units: meters, seconds, radians (degrees are given only for readability).
- Y is up. The arena center is the origin `(0, 0, 0)`.
- "Horizontal" means the XZ plane.
- "Telegraph" means the warning before an attack.
- "Rage" means Phase 2.

---

## 1. Core loop and states

```
            any key / click                     player hit
  ┌──► TITLE ─────────────────► FIGHT ───────────────────────► DYING (2.0 s: body breaks, boss looks, "YOU DIED")
  │    (start screen)             │                                  │
  │                               │ boss HP reaches 0                │
  │                               ▼                                  │
  │                         BOSS_DEFEATED ──(1.5 s)──► VICTORY_SCREEN│
  │                                                       │ any key / click, or 8 s idle
  │                                                       ▼          ▼
  └──────────────────────────────────────────────── TO_TITLE (fade to black → reset → fade in)
```

| State | What happens | Accepts input |
|---|---|---|
| `TITLE` | **The start screen.** Boss idles at the center; camera orbits it; title overlay shown | After its input lock (see below): any key (except `M`) or any mouse click starts the fight. The very first input also unlocks audio (§10) |
| `FIGHT` | Normal play | Gameplay controls (§3) |
| `DYING` | Lasts **2.0 s**. The player breaks apart, the boss stops attacking and turns to look at the remains, "YOU DIED" fades in (§9) | None |
| `BOSS_DEFEATED` | Boss breaks apart (§6.6); slow motion 0.5× for 1.0 s. Lasts 1.5 s | Movement and roll only (no swing) |
| `VICTORY_SCREEN` | "CUBE FELLED" overlay | After an **input lock of 1.0 s**: any key (except `M`) or click → `TO_TITLE`. With no input for **8 s**, it goes to `TO_TITLE` automatically (ready for the next visitor) |
| `TO_TITLE` | The **return transition** (below) | None |

**Return transition (`TO_TITLE`), used after every death and every victory:**

| Step | Duration *(tune)* | What happens |
|---|---|---|
| 1. Fade out | 0.6 s (ease-in-out) | A full-screen black layer goes from opacity 0 to 1. Game audio master volume fades to 30% at the same time |
| 2. Swap (at full black, one frame) | — | **Reset** the world; hide "YOU DIED" / "CUBE FELLED" and the HUD; switch the camera to the title orbit; show the title overlay |
| 3. Fade in | 0.8 s (ease-in-out) | The black layer goes from 1 to 0, revealing the start screen with the boss idling. Audio volume returns to normal |
| 4. Title input lock | 0.5 s after the fade-in ends | Prevents a player who is still pressing keys from starting a new fight by accident. The start prompt appears only when the lock ends |

**Start transition (`TITLE` → `FIGHT`):**
- The title overlay fades out over 0.3 s.
- The camera blends from the orbit to the lock-on camera over 0.8 s (ease-in-out).
- The HUD fades in over 0.3 s.
- The boss's 2.0 s grace period starts when the fight starts.

**General rules**
- **Reset** means: player back to spawn, boss back to spawn with full HP in Phase 1, all projectiles, debris and effects removed, all timers cleared. **Never reload the page.**
- **Attempt counter:** increases by 1 each time a fight starts. It is held in memory only and resets on page reload.
- **Page loses focus** (window `blur` or tab hidden) during `FIGHT`: pause the simulation, clear all held keys and show a *"Paused — click to continue"* overlay. A click resumes play.
- Target length per attempt: **30–120 s**. Target for a first-time player: **win in about 3–6 attempts**.

## 2. Screens and HUD (HTML overlay on top of the canvas)

| Element | Shown in | Spec |
|---|---|---|
| Title text | TITLE | **THE ELDEN CUBE**: Cinzel 700, `min(9vw, 120px)`, gold `#E0B84C`, centered, 30% from top, dark text shadow |
| Start prompt | TITLE | *"Press any key to begin"*: system sans-serif, 24px, white, blinking (opacity 1 ↔ 0.3, 1 s cycle) |
| Controls box | TITLE | `WASD Move · Space Roll · Click Swing · M Mute`: 18px, white, semi-transparent dark panel, bottom center |
| Boss health bar | FIGHT, DYING, BOSS_DEFEATED | Bottom center, width `min(60vw, 640px)`, height 14px. Label above, left-aligned: **The Elden Cube** in Cinzel 700, 20px, white. 5 equal segments with a 4px gap. Full segment = `#C1121F`, empty = `rgba(0,0,0,0.5)`. A lost segment flashes white for 0.15 s before turning empty |
| Controls hint | FIGHT | Bottom-left, 14px, 70% opacity: `WASD · Space · Click` |
| Sound indicator | All | Top-right, 14px: `Sound: ON (M)` or `Sound: OFF (M)` |
| Attempt counter | TITLE (only after the first fight) | Below the start prompt: `Attempts: N`, 18px, light grey |
| "YOU DIED" | DYING (from 0.6 s) | Full-screen black dim at 55% opacity, fades in over 0.5 s. Text: Cinzel 700, `min(10vw, 140px)`, color `#A4161A`, letter-spacing 0.1em, centered. It scales from 1.1 to 1.0 while fading in |
| "CUBE FELLED" | VICTORY_SCREEN | Same layout as "YOU DIED", but the text color is gold `#E0B84C` and the dim is 40% |
| Continue prompt | VICTORY_SCREEN | *"Click or press any key to continue"*: 20px, white. Appears only after the 1.0 s input lock ends |
| Fade layer | TO_TITLE | Full-screen `#000000` layer above everything else, opacity driven by the return transition (§1) |
| Pause overlay | Paused | Dim at 55% opacity plus *"Paused — click to continue"*, 28px |
| WebGL error | If WebGL is unavailable | Plain centered message: *"This game needs WebGL. Please use the latest Chrome."* |

## 3. Controls

| Input | Action | Notes |
|---|---|---|
| `W` / `S` | Move toward / away from the boss | Relative to the camera's horizontal forward direction |
| `A` / `D` | Strafe left / right | Relative to the camera, so strafing circles the boss |
| `Space` | Roll (dodge with invincibility, §4.3a) | Ignored during a swing, a roll, the roll recovery or the roll cooldown (no buffering) |
| Left mouse button (also touchpad click) | Swing | Ignored if a swing is already in progress (no buffering) |
| `F` | Swing | Alternative to clicking |
| `M` | Toggle mute | Works in every state; never counts as "any key" |

- Read keys with `KeyboardEvent.code` (`KeyW`, `KeyA`, `KeyS`, `KeyD`, `Space`, `KeyF`, `KeyM`), so the controls work on any keyboard layout.
- Ignore auto-repeated `keydown` events (`event.repeat`).
- Call `preventDefault()` on `Space` so the page never scrolls.
- Disable the right-click context menu on the canvas.
- No pointer lock and no mouse-look. The camera is automatic (§7).
- Diagonal input is normalized, so moving diagonally is not faster.
- The click that starts the fight from the TITLE screen must **not** also trigger a swing.

## 4. Player — "The Tarnished Intern"

### 4.1 Model

The model has 7 primitives with flat colors (`MeshStandardMaterial`, roughness 0.8, metalness 0) and no textures. Each part casts a shadow.

| Part | Geometry (meters) | Color | Attached to | Position (relative to its parent) |
|---|---|---|---|---|
| Root (invisible) | — | — | world | At the feet. Rotates on Y (yaw) to face the facing direction (+Z local = forward) |
| Roll pivot (invisible) | — | — | root | `(0, 0.90, 0)`. **All visible parts are children of this pivot**, so the roll spins the whole body around the waist. Positions below are given relative to the root; subtract 0.90 in Y when parenting to the pivot |
| Body | Box 0.60 W × 0.80 H × 0.35 D | `#3A86FF` | roll pivot | center `(0, 1.00, 0)` |
| Head | Sphere r 0.25 | `#FFD6A5` | neck pivot at `(0, 1.40, 0)` on the roll pivot | `(0, 0.30, 0)` from the pivot |
| Eyes (decorative, optional) | 2 spheres r 0.04 | `#111111` | head | `(±0.09, 0.05, 0.22)` |
| Left / right arm | Box 0.16 × 0.60 × 0.16 | `#2B66C4` | shoulder pivot at `(±0.40, 1.35, 0)` on the roll pivot | `(0, -0.30, 0)` from the pivot (hangs down) |
| Left / right leg | Box 0.20 × 0.60 × 0.20 | `#1D3557` | hip pivot at `(±0.15, 0.60, 0)` on the roll pivot | `(0, -0.30, 0)` from the pivot |
| Weapon (oversized sword) | Box 0.12 × 1.60 × 0.06 | `#CED4DA` | right shoulder pivot (moves with the arm) | center `(0, -1.30, 0)`. The blade runs from 0.5 m to 2.1 m away from the shoulder, continuing in the arm's direction |

Total height is about 1.95 m.

### 4.2 Movement (the source of the clumsiness)

The clumsiness comes from **momentum and delay**. Input is **never randomly dropped**; players must feel that mistakes are their own fault.

| Mechanic | Rule | Value *(tune)* |
|---|---|---|
| Spawn | Position `(0, 0, 12)`, facing the boss | — |
| Desired velocity | `input direction (camera-relative, normalized) × maxSpeed` | maxSpeed 6 m/s |
| Acceleration | Horizontal velocity moves toward the desired velocity at `accel` when there is input, or `decel` when there is none | accel 10 m/s², decel 4 m/s² (this gives the sliding stop) |
| Facing (yaw) | Turns toward a target direction at a limited rate. The target is the movement direction if horizontal speed > 0.5 m/s and there is input; otherwise the direction to the boss | turn rate 4 rad/s |
| Ground | The player always stays on the ground (feet at y = 0). There is no jumping | — |
| Arena wall | The player's horizontal distance from the center is clamped to `arenaRadius − playerRadius`. The outward part of the velocity is removed | 30 − 0.4 = 29.6 m |
| Boss body contact | Outside boss attacks, if the player overlaps the boss box, push the player out along the shortest direction and set an outward velocity | push speed 4 m/s |

### 4.3 Swing

The swing angle **θ** is measured on the right shoulder pivot's pitch: 0° means the arm points straight down, +90° points forward horizontally, and 180° points straight up.

| Phase | Duration *(tune)* | Arm angle θ | Other rules |
|---|---|---|---|
| Rest | — | 20° | — |
| Wind-up | 0.20 s | 20° → 200° (ease-out) | Movement and roll input ignored; horizontal velocity decays at `decel` |
| Active (slash) | 0.15 s | 200° → 70° (ease-in) | **Lunge**: horizontal velocity is set to `facing × 10 m/s` for this phase (about 1.5 m forward). **Only phase that can damage the boss** |
| Recovery | 0.40 s | 70° → 20° (ease-in-out) | Movement and roll input ignored; velocity decays at `decel` |

- Pressing swing during a swing, a roll or the roll recovery does nothing (no input buffering).

### 4.3a Roll (Space)

A clumsy forward-roll dodge. Its **invincibility frames** let the player pass *through* attacks, as in souls games. Its committed direction and dizzy ending keep it clumsy.

| Rule | Value *(tune)* |
|---|---|
| Direction | The camera-relative input direction at the moment `Space` is pressed. With no input: the current facing direction. **Locked for the whole roll** (cannot be steered) |
| Distance / duration | **4.0 m over 0.55 s**. Displacement follows ease-out along the roll direction (fast start, slow end). The arena wall and boss body pushback still apply |
| **Invincibility (i-frames)** | From **0.05 s to 0.40 s** after the roll starts (**0.35 s**). While invincible, no attack can kill the player |
| Facing | Turns toward the roll direction at 3× the normal turn rate |
| Dizzy recovery | **0.25 s** after the roll ends. Movement, roll and swing input are ignored; the body sways ±8° side to side; the head spring gets a kick. Velocity starts at `direction × 2 m/s` and decays at `decel` |
| Cooldown | A new roll can start **0.15 s** after the recovery ends (a full cycle is 0.95 s) |
| Visual | The roll pivot turns one full forward somersault (360° around its local X axis) over 0.55 s, ease-in-out. During the roll, the limb spring targets tuck in to 70° |
| Sounds | `roll` at the start; `roll_end` when the recovery starts |
| Debug | With `?debug`, the player is tinted 30% white while invincible |

Why these numbers: the Slam shockwave band (1.0 m plus the 0.4 m player radius on each side) passes a standing player in about 0.23 s (0.16 s in rage), and the Charge passes in about 0.27 s (0.19 s in rage). A well-timed 0.35 s window beats all of them; a badly timed one doesn't.

### 4.4 Visual wobble (secondary motion, no gameplay effect)

Each limb pivot's pitch follows a **target angle through a damped spring**: `k = 120`, `damping = 8`, integrated in the fixed simulation step. Clamp each limb to ±80° so it never spins wildly.

| Part | Target angle |
|---|---|
| Legs | Walk cycle: `±sin(phase) × 35° × s`, left and right in opposite phase. `s = horizontal speed / maxSpeed`. The phase advances at `2π × 1.8 Hz × s` |
| Left arm, and right arm when not swinging | Opposite phase to the same-side leg, `25° × s`, plus a lag of `−0.03 rad per m/s²` of forward acceleration (the arms flail when stopping) |
| Right arm while swinging | Driven **directly** by the swing curve (§4.3), with no spring |
| Head | Position offset on a spring (`k = 80`, `damping = 6`) pushed by `−0.02 × horizontal acceleration`; also nods `±5° × s` with the walk cycle |
| Body | Leans forward `8° × s` |
| During a roll | All four limbs target 70° (tucked); the walk cycle pauses |

### 4.5 Hitbox

Two spheres, each with radius 0.40, at heights 0.50 and 1.30 above the feet. These are the **only** shapes that can kill the player. The limbs and the weapon are not part of the hitbox.

## 5. Weapon hit detection

- Active only during the swing's **active phase**.
- Every simulation step, take 3 points along the blade in world space: 0.5 m, 1.3 m and 2.1 m from the shoulder.
- Convert each point into the boss's local space and test it against the boss box (half-size 2.0). A hit is any point inside.
- **At most one hit per swing.**
- A hit is ignored while the boss's invulnerability timer is above 0.
- A hit during a boss attack still deals damage but **does not interrupt** the attack.

## 6. Boss — "The Elden Cube"

### 6.1 Model

| Part | Geometry | Color | Position (boss local; +Z local = the face that looks at the player) |
|---|---|---|---|
| Cube body | Box 4 × 4 × 4 | `#6A4C93` (Phase 1), turning to `#D62828` in rage | center `(0, 2, 0)` |
| Crown band | Cylinder r 1.4, height 0.4, 5 sides | `#FFC300`, metalness 0.6, roughness 0.3 | `(0, 4.2, 0)` |
| Crown points | 5 cones r 0.30, height 0.8 | `#FFC300` | On the band's 5 corners at y 4.8 |
| Eyes | 2 boxes 0.7 × 0.7 × 0.1 | `#FFFFFF` | `(±0.8, 2.6, 2.01)` |
| Pupils | 2 boxes 0.3 × 0.3 × 0.1 | `#111111` | `(±0.8, 2.5, 2.06)` |
| Eyebrows (angry) | 2 boxes 1.0 × 0.18 × 0.1 | `#111111` | `(±0.8, 3.15, 2.06)`, tilted 20° downward toward the middle |

The whole boss casts and receives shadows.

### 6.2 Stats and general behavior

| Property | Value *(tune)* |
|---|---|
| HP | 5 |
| Spawn | Position `(0, 0, 0)`, facing +Z (toward the player's spawn) |
| Grace period at fight start | 2.0 s before the first attack |
| Idle bounce (visual) | Body bobs `0.08 × sin(2π × 1.2 Hz × t)` in Y |
| Turning | Always yaws toward the player at 2.0 rad/s, except during a Charge dash |
| Chasing | Between attacks, if horizontal distance to the player is greater than 7 m, moves toward the player at 1.5 m/s |
| Attack cooldown | Time from the end of one attack to the start of the next: 2.5 s (Phase 1), 1.6 s (rage) |
| Invulnerability after a hit | 0.4 s |

### 6.2a Boss tactics (fair counter-play rules)

The boss has two small tactical rules. They stop players from winning with one cheap tactic, and both are **readable**, so a player can learn them within a few attempts.

**Anti-camping (punishes hugging the boss)**

| Rule | Value *(tune)* |
|---|---|
| "Close" means | The player's horizontal distance to the boss center is under **4.0 m** (about 2 m from its face) |
| Close timer | Increases by `dt` while the player is close (FIGHT state only). Decreases by `2 × dt` while not close. Never below 0 |
| Trigger | When the cooldown ends and the close timer is **≥ 3.0 s**, the boss chooses **Cube Slam** instead of a random attack. If Slam is blocked by the "no 3 in a row" rule, it chooses **Crown Shards** |
| After it triggers | The close timer resets to 0 |
| Readable tell | While the timer is ≥ 3.0 s and the boss is waiting, its idle bounce doubles in size (`0.16 m`). It visibly "gets annoyed" |

**Punish rushing in (punishes missing a swing right in front of it)**

| Rule | Value *(tune)* |
|---|---|
| Trigger | A player swing's active phase ends **without hitting the boss**, while the player is within **5.0 m** of the boss center, and the boss is **waiting in cooldown** (not telegraphing or attacking, not in the rage transition) |
| Effect | The remaining cooldown is reduced by **0.8 s**, but never below **0.3 s**. So the next attack comes sooner |
| Limit | At most **once per cooldown** |
| Readable tell | For 0.5 s the eyebrows tilt a further 10° and the pupils shrink to 70%: a "you missed" glare |
| Interaction with anti-camping | Independent. Both can apply in the same cooldown |

`?easy` mode also applies its cooldown multiplier to the result. The debug overlay (`?debug`) shows the close timer and marks when "punish" fired.

### 6.3 Hit reaction

All of these happen together when the boss is hit:
- **Hit-stop:** freeze the simulation for 0.08 s (rendering continues).
- **Flash:** set the body's emissive color to white for 0.10 s.
- **Squash:** scale `(1.15, 0.85, 1.15)`, springing back to `(1, 1, 1)` over 0.25 s.
- **Knockback:** move 0.3 m horizontally away from the player. Skip this during a Charge dash.
- **Camera shake:** amplitude 0.15 m for 0.2 s.
- **Sound:** `hit` (§10).
- **HUD:** the matching health bar segment flashes, then empties.

### 6.4 Phases

| Phase | When | Changes |
|---|---|---|
| Phase 1 | HP 5–3 | Base values |
| **Rage** | Immediately after the 3rd hit (HP ≤ 2) | **Transition (1.0 s, no attacks, boss cannot take damage):** body color fades `#6A4C93` → `#D62828` over 0.5 s, the boss shakes ±0.1 m, `rage` sound plays, camera shake 0.2 m for 0.6 s. **Afterward:** all boss movement speeds (chase, dash, shockwave, shard flight) ×1.4; telegraph times ×0.6; cooldown 1.6 s |

### 6.5 Attacks

Every attack is **telegraphed**, and every attack **kills the player in one hit**, unless the player is **invincible** (roll i-frames, §4.3a, or debug god mode). An invincible player simply passes through; the attack continues normally.

**Selection rule:** when the cooldown ends:
1. If the anti-camping trigger applies (§6.2a), choose **Slam**, or **Shards** if Slam is blocked by the "no 3 in a row" rule.
2. Otherwise pick an attack at random from the valid ones:
   - Charge is only valid when the player is more than 6 m away.
   - If the last two attacks were the same, that attack is not allowed this time.

#### A. Cube Slam
| Step | Phase 1 | Rage |
|---|---|---|
| Telegraph: the boss rises to y = +4 (ease-out); a dark circle (r 2.2, 50% opacity) stays on the ground under it; `slam_rise` sound | 1.0 s | 0.6 s |
| Hang at the top | 0.15 s | 0.15 s |
| Drop to y = 0 (ease-in) | 0.20 s | 0.20 s |
| Impact: `slam_impact` sound, camera shake 0.35 m for 0.4 s, the shockwave ring spawns | — | — |
| Shockwave: a ring band centered on the boss expands from radius 2.2 to 14 m. It is drawn as a flat ring 1.0 m wide and 0.3 m tall, color `#FF7B00`, fading out near the end | 8 m/s | 11.2 m/s |

**Kill rules:**
- At the moment of impact, a player whose hitbox overlaps the boss footprint dies.
- While the ring is expanding, the player dies if the horizontal distance from the boss center is within `[r − 0.5 − 0.4, r + 0.5 + 0.4]`.

**How to survive:** **roll through the ring** as it reaches you (i-frames), or be farther than 14 m away.

#### B. Royal Charge
| Step | Phase 1 | Rage |
|---|---|---|
| Telegraph: the boss shakes ±0.1 m and its emissive color pulses red; `charge_windup` sound | 1.0 s | 0.6 s |
| Lock: at the end of the telegraph, fix the dash direction toward the player's current horizontal position | — | — |
| Dash in a straight line (`charge_dash` sound). It stops when the boss center reaches radius 27 m, or after 2.0 s | 18 m/s | 25.2 m/s |
| Skid: slow to 0 | 0.3 s | 0.3 s |

**Kill rule:** during the dash, the player dies if either hitbox sphere overlaps the boss box.

**How to survive:** strafe sideways, or roll sideways or through the boss with good timing.

#### C. Crown Shards
| Step | Phase 1 | Rage |
|---|---|---|
| Telegraph: 3 red warning circles (r 1.2, `#FF3B30`, 50% opacity, pulsing) appear on the ground | 1.0 s | 0.6 s |
| Launch: 3 gold cubes (0.6 m, `#FFC300`, spinning) fire from the boss's crown on arcs that land **exactly** at the circle centers at the same time; `shard_launch` sound | flight time 0.8 s | 0.57 s |
| Land: `shard_land` sound and a small puff of debris; the shards and circles are removed | — | — |

**Circle placement**, using the player's position at the start of the telegraph:
- Center circle: `P + V × 0.5`, where P is the player's horizontal position and V their horizontal velocity.
- Two side circles: the center circle position ±2.5 m along the direction perpendicular to boss→player.
- All circles are clamped to inside the arena.

**Kill rules:**
- During flight: a shard (sphere r 0.35) touches a player hitbox sphere.
- At landing: the player's horizontal distance to a circle center is under `1.2 + 0.4`.

**How to survive:** move or roll out of the circles, or be mid-roll (invincible) at the moment they land.

### 6.5a Optional rage upgrades (off by default)

Three harder variants of the attacks. They are used **only in rage** (HP ≤ 2), and **only if switched on** in `CONFIG.rageUpgrades`. **By default all three are off**, and the game behaves exactly as in §6.5. Switch them on only if playtesting shows the game is too easy (PROJECT_PLAN.md, milestone 1.6). Each one can be switched on independently.

| Config switch | Upgrade | Behavior *(values: tune)* | Readable tell |
|---|---|---|---|
| `doubleSlam` | **Double Slam** | After the normal Slam impact, the boss does a small 0.5 m hop and lands again **0.5 s after the first impact**, spawning a **second shockwave ring** from the same center with the same speed and kill rule. `slam_impact` plays again at 70% volume | During the Slam telegraph, the shadow circle under the boss **flashes twice** (two quick pulses) instead of staying steady |
| `chargeUTurn` | **Charge U-turn** | After the dash and skid, if the player is alive, the boss telegraphs again for **0.4 s** (shake plus red pulse, `charge_windup`), re-locks its direction toward the player, and **dashes once more** with the same speed and stop rules, then skids. At most one U-turn per Charge | During the first skid, the red emissive pulse **keeps going** instead of fading, signalling another dash |
| `staggeredShards` | **Staggered Shards** | The **center** shard's flight time is **0.3 s longer**, so it lands after the two side shards. Kill rules are unchanged (each shard is checked at its own landing) | The center circle **pulses slower** (1 Hz) than the side circles (3 Hz) |

General rules for upgrades:
- An upgraded attack still counts as **one** attack for the attack history (§6.5) and the "no 3 in a row" rule.
- The cooldown starts only after the **whole** upgraded attack has finished (the second ring has expired, the second dash has stopped, all shards have landed).
- Roll i-frames, god mode and boss defeat behave as with normal attacks. If the boss is defeated or the player dies mid-attack, all parts of the attack are cancelled.

### 6.6 Defeat

On the 5th hit:
1. Hit-stop for 0.20 s.
2. All shockwaves, shards and warning circles are removed.
3. The player can no longer be killed.
4. The boss is replaced by **8 cubes of 2 m each** (a 2×2×2 split, in the current body color). Each gets an outward velocity of 4–8 m/s plus 5–9 m/s upward, and a random spin up to 6 rad/s.
5. The crown becomes a separate piece that falls and rolls.
6. `boss_break` sound; camera shake 0.4 m for 0.5 s; simulation time scale 0.5 for 1.0 s.
7. `victory` sound when the Victory screen appears (1.5 s after the 5th hit).
8. The player can still move and roll during `BOSS_DEFEATED` (a free victory lap), but cannot swing.

## 7. Camera

| Mode | Rule *(tune)* |
|---|---|
| TITLE | Orbits the boss at radius 14 m, height 6 m, 0.15 rad/s, looking at `(0, 2, 0)`. Always starts at the same orbit angle after the return transition |
| FIGHT / DYING / BOSS_DEFEATED / VICTORY_SCREEN | **Lock-on follow:** let `d` = the horizontal unit vector from the boss to the player. Desired position = `player + d × 6.0 + (0, 3.2, 0)`. When the player is within 5 m of the boss, use distance 7.5 and height 4.2 instead. Look-at point = `lerp(player, boss, 0.4) + (0, 1.2, 0)` |
| Smoothing | Position and look-at point both use `lerp` with factor `1 − exp(−6 × dt)` |
| Title → fight blend | Over 0.8 s, blend from the orbit camera to the lock-on camera with an ease-in-out weight |
| While dying | The look-at point moves toward the center of the player's debris |
| Ground limit | Camera Y is never below 1.0 |
| Lens | Perspective, FOV 60°, near 0.1, far 300 |
| Shake | Random offset with an amplitude that decays linearly to 0 over its duration. A new shake replaces the old one only if it is stronger |
| Movement basis | "Forward" for WASD is the camera's forward vector projected onto the XZ plane |

## 8. Arena and environment

| Item | Spec |
|---|---|
| Arena floor | Circle with radius 30 m and 64 segments, color `#6AB04C`, receives shadows. Optional: vary the green ±6% per vertex using vertex colors (still no texture) |
| Outer field | Circle with radius 200 m, color `#5E9E44`, 1 cm below the arena, so the horizon is green grass in every direction |
| Arena edge marker | Flat ring from radius 29.8 to 30.2 m, color `#4A7F35` (shows where the invisible wall is) |
| Sky | Background color `#BFE3FF`; linear fog in the same color, from 60 m to 180 m |
| Lights | Hemisphere light (sky `#FFFFFF`, ground `#557733`, intensity 1.0 *(tune)*). Directional "sun" from `(10, 20, 8)`, intensity 2.0 *(tune)*, casting shadows with a 1024² map. The shadow camera covers ±35 m around the origin; bias −0.0005 |

## 9. Player death (state `DYING`, 2.0 s total)

| Time after the hit | What happens |
|---|---|
| 0.00 s | Hit-stop for 0.10 s. State becomes `DYING`. Shockwaves, shards and circles in flight are removed. Long sounds (`slam_rise`, `charge_windup`) stop |
| 0.10 s | The 7 parts detach from the hierarchy and keep their world positions and rotations. Each part gets a horizontal velocity of 3–6 m/s away from the hit source, an upward velocity of 4–7 m/s, and a random spin of up to 10 rad/s. Debris physics applies (ARCHITECTURE.md §5.6). `player_break` sound (clatter plus a falling slide whistle) |
| 0.10 s → | The boss cancels any attack or telegraph, stops moving, and turns at its normal rate to **face the remains** (the average position of the debris). It keeps its idle bounce, as if it is gloating |
| 0.60 s | "YOU DIED" fades in over 0.5 s (§2), with the `you_died` sound |
| 2.00 s | The **return transition** to the start screen begins (§1, `TO_TITLE`) |

**Hit source:** the boss center for Slam and Charge; the shard or circle center for Shards.

## 10. Audio

Every sound works in two layers (ASSETS.md §1):
1. **Asset file first:** if an audio file for that sound ID exists in `app/src/assets/sfx/`, the game plays that file.
2. **Code-generated fallback (the default):** if there is no file, or it fails to load, the game plays the Web Audio recipe.

The game must therefore be complete and fully audible with **no sound files at all**. Files can be added or removed at any time without code changes.

| ID | Trigger |
|---|---|
| `swing` | Start of the swing's active phase |
| `hit` | Weapon hits the boss |
| `swing_ground` *(optional)* | Active phase ends without a hit while on the ground |
| `roll` | Roll starts |
| `roll_end` | Roll recovery starts (the dizzy landing) |
| `footstep` *(optional)* | Every 0.30 s while walking (not rolling) with horizontal speed above 1 m/s |
| `slam_rise` | Slam telegraph starts |
| `slam_impact` | Slam impact |
| `charge_windup` | Charge telegraph starts |
| `charge_dash` | Charge dash starts |
| `shard_launch` | Shards launch |
| `shard_land` | Shards land |
| `rage` | Rage transition starts |
| `player_break` | The player's body breaks apart (0.10 s into `DYING`, §9) |
| `you_died` | "YOU DIED" appears (0.6 s into `DYING`) |
| `boss_break` | Boss defeat |
| `victory` | Victory screen appears |

- Browsers block audio until the user interacts, so create or resume the `AudioContext` on the **first key press or click** (the TITLE screen's "press any key").
- `M` toggles a master gain between 0.8 and 0.
- There is no music by default.

## 11. Difficulty and debug options (URL parameters)

| Parameter | Effect |
|---|---|
| `?easy` | Boss movement speeds ×0.75, telegraph times ×1.3, cooldowns ×1.3. A hidden helper for visitors who struggle |
| `?debug` | Shows an FPS counter, the current state, the boss phase and attack, wireframe hitboxes (player spheres, boss box, blade points, shockwave band, shard spheres). Debug keys: `1`/`2`/`3` force Slam / Charge / Shards next; `K` deals 1 damage to the boss; `G` toggles player invulnerability (god mode). The debug text also shows the roll phase and whether i-frames are active |

These parameters can be combined. Without them, nothing from the debug mode is visible.

## 12. Out of scope

Do **not** build any of these:
- Multiplayer, leaderboards, accounts, saving, analytics, any network calls
- Mobile or touch controls, gamepad support
- Settings menus, difficulty selection UI
- Textures, imported 3D models, terrain, trees, skyboxes
- Boss voice, taunts, dialogue, subtitles, AI-generated content
- A physics engine (see ARCHITECTURE.md §5). The one exception is the optional ragdoll stretch item in PROJECT_PLAN.md

## 13. Acceptance checklist (definition of "done")

**Flow**
- [ ] TITLE → FIGHT → (DYING or BOSS_DEFEATED → VICTORY_SCREEN) → TO_TITLE → TITLE works with keyboard and click only, with no page reload
- [ ] On death: the boss stops and looks at the remains, "YOU DIED" appears at 0.6 s, and at 2.0 s the screen fades to black and back into the start screen smoothly
- [ ] Victory returns to the start screen on any key/click (after its 1.0 s lock) or by itself after 8 s, with the same fade
- [ ] The first input on TITLE starts the fight, unlocks audio and does not trigger a swing
- [ ] The title input lock (0.5 s after the fade-in) and the victory input lock work; `M` never counts as "any key"
- [ ] The title → fight camera blend is smooth
- [ ] The attempt counter shows on the start screen after the first fight and increases with every fight
- [ ] Losing focus pauses the game and clears held keys; clicking resumes

**Player**
- [ ] Movement has visible acceleration, a sliding stop and lazy turning, with no input loss
- [ ] The roll covers about 4 m in a locked direction, has 0.35 s of i-frames, a dizzy recovery and a cooldown; the arena wall holds
- [ ] The swing has a wind-up, a lunge and a recovery; only the active phase damages; one hit at most per swing

**Boss**
- [ ] All 3 attacks are telegraphed and can be avoided as described (roll through the ring, strafe or roll past the charge, leave the circles); each can also be survived purely with well-timed roll i-frames
- [ ] Attack selection never repeats the same attack 3 times in a row; Charge is never chosen within 6 m
- [ ] Anti-camping: staying within 4 m for 3 s makes the next attack a Slam (or Shards), with the bigger-bounce tell beforehand
- [ ] Punish rushing in: a missed swing within 5 m during cooldown brings the next attack 0.8 s sooner (never below 0.3 s, once per cooldown), with the glare tell
- [ ] Rage starts after hit 3 with its transition; the boss dies on hit 5
- [ ] Hit reactions (hit-stop, flash, squash, shake, sound, HUD) all play
- [ ] With all `rageUpgrades` off (the default), rage behaves exactly as §6.5; with each upgrade switched on individually, it behaves as in §6.5a, including its tell

**Feedback**
- [ ] The player falls apart on death; the boss breaks into 8 cubes plus the crown on defeat
- [ ] All Must and Should sounds play (ASSETS.md §1); `M` mutes everything

**Quality**
- [ ] `?easy` and `?debug` work as specified
- [ ] No errors or warnings in the browser console during a full session (title → 3 deaths → win)
- [ ] Holds a steady 60 fps on the booth laptop in Chrome
- [ ] At least 3 first-time testers each win within about 6 attempts
