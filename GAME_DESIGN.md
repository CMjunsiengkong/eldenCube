# Game Design — The Elden Cube

A one-on-one boss fight that parodies hard "souls-like" games. The hero is extremely clumsy, and the boss is a giant cube wearing a crown. **Two hits kill the player (a flask restores one). The cube takes 20 damage, about five full combos.**

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
            any key / click                  player HP reaches 0
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
| `DYING` | Entered when the player's HP reaches 0 (§4.6). Lasts **2.0 s**. The player breaks apart, the boss stops attacking and turns to look at the remains, "YOU DIED" fades in (§9) | None |
| `BOSS_DEFEATED` | Boss breaks apart (§6.6); slow motion 0.5× for 1.0 s. Lasts 1.5 s | Movement and roll only (no attack, no flask) |
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
- The boss's 1.0 s grace period starts when the fight starts.

**General rules**
- **Reset** means: player back to spawn with 2 HP, full stamina and 3 flask charges, boss back to spawn with full HP in Phase 1, all projectiles, debris and effects removed, all timers cleared. **Never reload the page.**
- **Attempt counter:** increases by 1 each time a fight starts. It is held in memory only and resets on page reload.
- **Page loses focus** (window `blur` or tab hidden) during `FIGHT`: pause the simulation, clear all held keys and show a *"Paused — click to continue"* overlay. A click resumes play.
- Target length per attempt: **30–120 s**. Target for a first-time player: **win in about 3–6 attempts**.

## 2. Screens and HUD (HTML overlay on top of the canvas)

| Element | Shown in | Spec |
|---|---|---|
| Title text | TITLE | **THE ELDEN CUBE**: Cinzel 700, `min(9vw, 120px)`, gold `#E0B84C`, centered, 30% from top, dark text shadow |
| Start prompt | TITLE | *"Press any key to begin"*: system sans-serif, 24px, white, blinking (opacity 1 ↔ 0.3, 1 s cycle) |
| Controls box | TITLE | `WASD Move · Space Roll · Click Attack · R Flask · M Mute`: 18px, white, semi-transparent dark panel, bottom center |
| Boss health bar | FIGHT, DYING, BOSS_DEFEATED | Bottom center, width `min(60vw, 640px)`, height 14px. Label above, left-aligned: **The Elden Cube** in Cinzel 700, 20px, white. 5 equal segments with a 4px gap; each segment holds 4 of the boss's 20 HP and drains from the right. Full = `#C1121F`, empty = `rgba(0,0,0,0.5)`. The part lost by a hit flashes white for 0.15 s before turning empty |
| Player HUD | FIGHT, DYING | Top-left, 24px from the edges. **HP:** 2 pips (22 × 22px squares, 6px gap, 2px white border; full `#C1121F`, empty `rgba(0,0,0,0.5)`); a lost pip flashes white for 0.15 s. **Flask counter** to the right of the pips: an amber `#F4A259` rounded rectangle 14 × 22px and `×N`, 18px, white. **Stamina bar** below the pips: 240 × 8px, full `#6BBF59`, empty `rgba(0,0,0,0.5)`, no numbers; it flashes white for 0.3 s when an action is refused for lack of stamina. The HUD fades with the boss health bar |
| Controls hint | FIGHT | Bottom-left, 14px, 70% opacity: `WASD · Space · Click · R` |
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
| `Space` | Roll (dodge with invincibility, §4.3a) | Costs stamina. Pressed while busy, it may be buffered (§4.3d) |
| Left mouse button (also touchpad click) | Attack (3-hit combo, §4.3) | Costs stamina. Chains into the next combo hit; may be buffered (§4.3d) |
| `F` | Attack | Alternative to clicking |
| `R` | Drink a flask (§4.3c) | Only with HP below 2 and charges left; may be buffered (§4.3d) |
| `M` | Toggle mute | Works in every state; never counts as "any key" |

- Read keys with `KeyboardEvent.code` (`KeyW`, `KeyA`, `KeyS`, `KeyD`, `Space`, `KeyF`, `KeyR`, `KeyM`), so the controls work on any keyboard layout.
- Ignore auto-repeated `keydown` events (`event.repeat`).
- Call `preventDefault()` on `Space` so the page never scrolls.
- Disable the right-click context menu on the canvas.
- No pointer lock and no mouse-look. The camera is automatic (§7).
- Diagonal input is normalized, so moving diagonally is not faster.
- The click that starts the fight from the TITLE screen, and the click that resumes from Pause, must **not** also trigger an attack.

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
| Boss body contact | Whenever the boss is on the ground and not dashing (also during its other attacks), if the player overlaps the boss box, push the player out along the shortest direction and set an outward velocity | push speed 4 m/s |

### 4.3 Attack combo

The sword normally **rests on the right shoulder**, pointing up and back (the rest pose), so there is no draw time. Pressing attack starts a **3-hit combo**.

Each hit is a slash in a **swing plane**:
- **θ** is the right shoulder pivot's pitch: 0° means the arm points straight down, +90° forward, 180° straight up.
- **ψ** (plane tilt) rotates the swing plane around the player's forward axis. ψ > 0 puts the high end of the arc on the player's right and the low end on the left. ψ = 0 is a vertical overhead plane.
- The **rest pose** is θ 200°, ψ 40°.
- Every wind-up starts from the arm's current θ and ψ, and blends ψ to the hit's tilt linearly over the wind-up.

| | Hit 1 — *Kesagiri* (right shoulder → left hip) | Hit 2 — rising backhand (left hip → right shoulder) | Hit 3 — overhead finisher |
|---|---|---|---|
| Stamina cost | 20 | 20 | 20 |
| Damage | 1 | 1 | 2 |
| Tilt ψ | 40° | 40° | 0° |
| Wind-up *(tune)* | 0.18 s, θ → 215° (ease-out) | 0.12 s, θ → 30° (ease-out) | 0.25 s, θ → 225° (ease-out) |
| Active (damage) *(tune)* | 0.12 s, θ → 40° (ease-in); lunge 0.8 m | 0.12 s, θ → 200° (ease-in); lunge 0.6 m | 0.15 s, θ → 40° (ease-in); lunge 1.2 m |
| Recovery *(tune)* | 0.35 s: follow-through hold for 0.15 s, then back to rest (ease-in-out) | 0.35 s: hold 0.15 s, then rest | 0.55 s: hold 0.25 s, then rest |
| Chain point | 0.15 s into the recovery | 0.15 s into the recovery | none: the combo ends |

**Rules**
- **Commitment:** wind-up, active and recovery cannot be cancelled by roll, flask or movement. Only taking damage (§4.6) ends them early.
- During every phase, movement input is ignored, horizontal velocity decays at `decel`, and facing turns toward the boss at the normal turn rate.
- **Lunge:** during the active phase, horizontal velocity is set to `facing × lunge distance / active duration`. When the active phase ends, the velocity from before the lunge is restored.
- **Chaining:**
  - At the chain point a **chain window of 0.5 s** *(tune)* opens.
  - An attack input in the window (or one buffered just before it, §4.3d) starts the next hit at once. The rest of the recovery is skipped.
  - This is a combo link, not a cancel: only the next combo hit can follow, and only from the chain point.
- **Reset:** the combo resets to Hit 1 if any of these happens:
  - the window ends without an attack input;
  - the player rolls, drinks or is hit;
  - an input is refused for lack of stamina.
  - Walking after the recovery has ended keeps the window open.
- **After Hit 3** the combo always resets. Its longer recovery is the price of the finisher; there is **no separate attack cooldown**.
- **Stamina:** each hit needs ≥ 20 stamina when it starts (§4.3b).
- **Full combo time** with perfect chaining: 1.79 s. The active phases start 0.18 s, 0.57 s and 1.09 s after the first press (0.39 s and 0.52 s apart); the last damage frame is at 1.24 s.

### 4.3a Roll (Space)

A clumsy forward-roll dodge. Its **invincibility frames** let the player pass *through* attacks, as in souls games. Its committed direction and dizzy ending keep it clumsy.

| Rule | Value *(tune)* |
|---|---|
| Stamina cost | 30 (§4.3b). There is no roll cooldown; stamina limits roll spam |
| Direction | The camera-relative input direction at the moment the roll starts. With no input: the current facing direction. **Locked for the whole roll** (cannot be steered) |
| Distance / duration | **4.0 m over 0.55 s**. Displacement follows ease-out along the roll direction (fast start, slow end). The arena wall and boss body pushback still apply |
| **Invincibility (i-frames)** | From **0.05 s to 0.40 s** after the roll starts (**0.35 s**). While invincible, no attack can hit the player |
| Facing | Turns toward the roll direction at 3× the normal turn rate |
| Dizzy recovery | **0.12 s** after the roll ends. Movement input is ignored (roll, attack and flask can be buffered, §4.3d); the body sways ±8° side to side; the head spring gets a kick. Velocity starts at `direction × 2 m/s` and decays at `decel` |
| Full cycle | 0.67 s from roll start to free |
| Visual | The roll pivot turns one full forward somersault (360° around its local X axis) over 0.55 s, ease-in-out. During the roll, the limb spring targets tuck in to 70° |
| Sounds | `roll` at the start; `roll_end` when the recovery starts |
| Debug | With `?debug`, the player is tinted 30% white while invincible |

Why these numbers: the Slam shockwave band (1.0 m plus the 0.4 m player radius on each side) passes a standing player in about 0.23 s (0.16 s in rage), and the Charge passes in about 0.27 s (0.19 s in rage). A well-timed 0.35 s window beats all of them; a badly timed one doesn't.

### 4.3b Stamina

| Rule | Value *(tune)* |
|---|---|
| Maximum | 90 |
| Costs | Roll 30; each combo hit 20; flask 0 |
| Spending | An action starts only if stamina ≥ its cost. The cost is paid when it starts. Stamina never goes below 0 |
| Budget from full | 3 rolls, **or** 3 hits + 1 roll (in any order). Then it is empty |
| Regeneration | Paused during every action (combo hit including its recovery, roll, dizzy recovery, flask, stagger). Resumes **0.4 s** after the player is free again, at **45 per second** (empty → full in 2.0 s) |
| Refused action | The press is dropped; the stamina bar flashes white for 0.3 s |
| Reset | Full at the start of every fight |

### 4.3c Flask (R)

| Rule | Value *(tune)* |
|---|---|
| Charges | 3 per fight (shown on the HUD) |
| Effect | Restores **1 HP** (never above 2). Does **not** restore stamina |
| Allowed | Only when free (or buffered, §4.3d), with HP below 2 and at least 1 charge. Otherwise the press does nothing |
| Timeline | 0.00 s: a charge is used and the drink starts (`flask_drink`). **0.60 s:** +1 HP, the body flashes gold `#FFD166` for 0.2 s, the HUD pip refills (`flask_heal`). **1.10 s:** done |
| During the drink | Walking is allowed at up to 1.8 m/s (30% of max speed). No roll and no attack (both can be buffered in the last 0.20 s). Stamina regeneration is paused |
| Interrupted | If the player is hit before 0.60 s, the charge is lost and no HP is restored |
| Visual | The left arm is driven to θ 150° (hand at the face). A flask (cylinder r 0.07, height 0.18, `#F4A259`) is attached to the left hand and is visible only while drinking |

### 4.3d Input buffer

The buffer makes controls responsive without allowing cancels:
- **One slot.** An attack, roll or flask press that can't run now because the player is busy is stored only if it arrives within the last **0.20 s** *(tune)* before the moment it becomes possible. Earlier presses are dropped.
- **When an action becomes possible:**
  - For an attack during Hit 1 or 2, it is the chain point.
  - In every other case it is the end of the current action: the combo hit's recovery, the roll's dizzy recovery, the drink, or the stagger.
- **A newer press replaces the stored one.**
- **Running it:** the stored action runs at the first step it becomes possible. Its stamina and flask checks happen at that moment.
- **No shortening:** a buffered action never cancels or shortens the current action (the combo link at the chain point is the only early start, §4.3).
- **Off switch:** `bufferWindow = 0` disables buffering (strict mode).

### 4.4 Visual wobble (secondary motion, no gameplay effect)

Each limb pivot's pitch follows a **target angle through a damped spring**: `k = 120`, `damping = 8`, integrated in the fixed simulation step. Clamp each limb to ±80° so it never spins wildly.

| Part | Target angle |
|---|---|
| Legs | Walk cycle: `±sin(phase) × 35° × s`, left and right in opposite phase. `s = horizontal speed / maxSpeed`. The phase advances at `2π × 1.8 Hz × s` |
| Left arm (not drinking) | Opposite phase to the same-side leg, `25° × s`, plus a lag of `−0.03 rad per m/s²` of forward acceleration (the arms flail when stopping) |
| Right arm at rest | The rest pose (θ 200°, ψ 40°) through the spring, plus a walk swing of `±5° × s` |
| Right arm while attacking | Driven **directly** by the combo curves (§4.3), with no spring |
| Left arm while drinking | Driven directly to θ 150° (§4.3c) |
| Head | Position offset on a spring (`k = 80`, `damping = 6`) pushed by `−0.02 × horizontal acceleration`; also nods `±5° × s` with the walk cycle |
| Body | Leans forward `8° × s` |
| During a roll | All four limbs target 70° (tucked); the walk cycle pauses |

### 4.5 Hitbox

Two spheres, each with radius 0.40, at heights 0.50 and 1.30 above the feet. These are the **only** shapes that can hurt the player. The limbs and the weapon are not part of the hitbox.

### 4.6 Health and taking damage

| Rule | Value *(tune)* |
|---|---|
| HP | **2**. Every boss attack hit costs 1 HP |
| Non-lethal hit | HP −1; hit-stop 0.10 s; `player_hurt` sound; camera shake 0.25 m for 0.3 s; the lost HUD pip flashes |
| Stagger | **0.5 s.** The current action (combo, roll, flask) ends at once and the combo resets. Input is ignored, except buffering in the last 0.20 s. The player is knocked **3.0 m** horizontally away from the hit source (ease-out over the stagger; the arena wall and boss body still apply). Stamina regeneration is paused |
| Hurt invincibility | **1.0 s** from the hit: nothing can hurt the player. The body blinks (visible ↔ hidden at 10 Hz) |
| Lethal hit | HP reaches 0 → `DYING` (§9) |
| Attacks continue | A non-lethal hit cancels neither the boss's attack nor any hazard |

The hit source is the same as in §9.

## 5. Weapon hit detection

- Active only during a combo hit's **active phase**.
- Every simulation step, take 3 points along the blade in world space: 0.5 m, 1.3 m and 2.1 m from the shoulder.
- Convert each point into the boss's local space and test it against the boss box (half-size 2.0). A hit is any point inside.
- **At most one hit per combo hit.** It deals that hit's damage (1, 1 or 2).
- The boss has **no invulnerability timer** between hits (combo hits land 0.39–0.52 s apart). Hits are ignored during the rage transition and after defeat.
- A hit during a boss attack still deals damage but **does not interrupt** the attack. **Exception:** the hit that starts rage (§6.4) cancels the running attack and removes all hazards immediately.

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
| HP | 20 (the health bar shows 5 segments of 4) |
| Spawn | Position `(0, 0, 0)`, facing +Z (toward the player's spawn) |
| Grace period at fight start | 1.0 s before the first attack |
| Idle bounce (visual) | Body bobs `0.08 × sin(2π × 1.2 Hz × t)` in Y |
| Turning | Yaws toward the player at 2.0 rad/s, except during a Charge dash, the Charge recovery and the Slam punish window |
| Chasing | While waiting (grace or cooldown), if the horizontal distance to the player is greater than 5 m, moves toward the player at 3.5 m/s, stopping at 5 m |
| Attack cooldown | From the moment the boss is **free** (its own attack animation, including that attack's recovery or punish window, has ended) to the start of the next attack: **1.0 s** (Phase 1), **0.6 s** (rage). Hazards still in flight (shockwave rings, shards) do **not** delay it |
| Body | Solid for the player (§4.2) whenever the boss is on the ground and not dashing |

### 6.2a Royal Rebuke triggers (fair counter-play rules)

The boss punishes greed with its close-range **Royal Rebuke** (§6.5 D). Every trigger is readable.

| Trigger | Rule *(tune)* |
|---|---|
| **Poise** (punishes mashing) | Damage taken **outside a punish window** (§6.5 A and B) adds to a poise counter. When it reaches **3**, the boss performs Rebuke as soon as it is free: immediately if waiting, otherwise right after its current attack. The counter then resets to 0. So outside a window, two hits are safe and the third triggers Rebuke |
| **Close** (punishes hugging) | A close timer increases by `dt` while the player's horizontal distance to the boss center is under **5.0 m** and the boss is waiting. It decreases by `2 × dt` otherwise and never goes below 0. At **1.0 s**: Rebuke immediately, and the timer resets to 0. Tell: while the timer is ≥ 0.5 s, the idle bounce doubles (0.16 m) |
| **Window end** | When the Slam punish window ends with the player within 5.0 m: Rebuke |

- Only one Rebuke runs at a time.
- Rebuke is not part of the attack history (§6.5) and cannot be forced into the random pick.
- After its recovery the boss is free and the cooldown starts.

### 6.3 Hit reaction

All of these happen together when the boss is hit:
- **Hit-stop:** freeze the simulation for 0.08 s (Hit 3: 0.12 s). Rendering continues.
- **Flash:** set the body's emissive color to white for 0.10 s.
- **Squash:** scale `(1.15, 0.85, 1.15)`, springing back to `(1, 1, 1)` over 0.25 s.
- **Knockback:** move 0.3 m (Hit 3: 0.6 m) horizontally away from the player. Skip this during a Charge dash.
- **Camera shake:** amplitude 0.15 m for 0.2 s (Hit 3: 0.25 m for 0.25 s).
- **Sound:** `hit` (§10).
- **HUD:** the lost part of the health bar flashes, then empties.

### 6.4 Phases

| Phase | When | Changes |
|---|---|---|
| Phase 1 | HP 20–9 | Base values |
| **Rage** | Immediately after the hit that brings HP to **8 or below** | **Transition (1.0 s, no attacks, boss cannot take damage):** starts in the same step as that hit, even mid-attack. The running attack is cancelled, and **all hazards** (shockwave rings, shards in flight, warning circles, the Rebuke ring) are removed with a small puff effect. Long sounds (`slam_rise`, `charge_windup`, `rebuke_windup`) stop. No other hit interrupts an attack (§5). The poise counter and close timer reset. Body color fades `#6A4C93` → `#D62828` over 0.5 s, the boss shakes ±0.1 m, `rage` sound plays, camera shake 0.2 m for 0.6 s. **When the transition ends**, the rage cooldown (0.6 s) starts. **Afterward:** all boss movement speeds (chase, dash, shockwave, shard flight) ×1.4; attack telegraph times ×0.6 (not the Rebuke tell, not the Slam punish window); cooldown 0.6 s |

### 6.5 Attacks

Every attack is **telegraphed**, and every attack hit costs the player **1 HP** (§4.6), unless the player is **invincible** (roll i-frames §4.3a, hurt invincibility §4.6, or debug god mode). An invincible player simply passes through; the attack continues normally.

**Hazards.** Shockwave rings, shards and warning circles live on their own after they spawn. The boss can be free (and its cooldown can run) while they are still moving. They are all removed by the rage transition, by defeat, by the player's death and by reset.

**Selection rule:** when the cooldown ends:
1. If a poise Rebuke is pending, do **Rebuke**.
2. Otherwise pick at random from the valid attacks:
   - Charge is only valid when the player is more than 6 m away.
   - Crown Rain is only valid when no Crown Rain shard is still in the air.
   - If the last two attacks were the same, that attack is not allowed this time.
   - If no attack is valid, ignore the "last two" rule.

#### A. Cube Slam (the main punish window)
| Step | Phase 1 | Rage |
|---|---|---|
| Telegraph: the boss rises to y = +4 (ease-out); a dark circle (r 2.2, 50% opacity) stays on the ground under it; `slam_rise` sound | 1.0 s | 0.6 s |
| Hang at the top | 0.15 s | 0.15 s |
| Drop to y = 0 (ease-in) | 0.20 s | 0.20 s |
| Impact: `slam_impact` sound, camera shake 0.35 m for 0.4 s, the shockwave ring spawns (a hazard) | — | — |
| Shockwave: a ring band centered on the impact point expands from radius 2.2 to 14 m. It is drawn as a flat ring 1.0 m wide and 0.3 m tall, color `#FF7B00`, fading out near the end | 8 m/s | 11.2 m/s |
| **Punish window:** the boss is stuck. It does not turn or move, and its crown wobbles ±10° at 3 Hz. Damage taken now does not count toward poise. At the end: Rebuke if the player is within 5.0 m, otherwise the boss is free | 2.0 s from the impact | 2.0 s |

**Kill rules:**
- At the moment of impact, a player whose hitbox overlaps the boss footprint is hit.
- While the ring is expanding, the player is hit if the horizontal distance from the ring center is within `[r − 0.5 − 0.4, r + 0.5 + 0.4]`.

**How to survive and punish:** roll through the ring as it reaches you (i-frames), or be farther than 14 m away. Then run in and land a full combo before the window ends (a combo started about 0.7 s after the impact lands all 3 hits).

#### B. Royal Charge
| Step | Phase 1 | Rage |
|---|---|---|
| Telegraph: the boss shakes ±0.1 m and its emissive color pulses red; `charge_windup` sound | 0.7 s | 0.42 s |
| Lock: at the end of the telegraph, fix the dash direction toward the player's current horizontal position | — | — |
| Dash in a straight line (`charge_dash` sound). It stops when the boss center reaches radius 27 m, or after 2.0 s | 18 m/s | 25.2 m/s |
| Skid: slow to 0 | 0.3 s | 0.3 s |
| Recovery (a small punish window): no turning; damage taken does not count toward poise; then the boss is free | 0.6 s | 0.6 s |

**Kill rule:** during the dash, the player is hit if either hitbox sphere overlaps the boss box.

**How to survive:** strafe sideways, or roll sideways or through the boss with good timing.

#### C. Crown Rain
| Step | Phase 1 | Rage |
|---|---|---|
| Cast: the boss squashes down and its crown glows; wave 0's warning circles appear | 1.0 s | 0.6 s |
| Launch (end of the cast): every shard fires from the crown (`shard_launch`), and waves 1 and 2's circles appear. **The boss is free at launch** (its cooldown starts) | — | — |
| Landing: wave 0 after the flight time T, wave 1 at T + 0.4 s, wave 2 at T + 0.8 s, where T = 0.8 s / speed multiplier | 0.8 / 1.2 / 1.6 s | 0.57 / 0.97 / 1.37 s |

**Waves.** P is the player's horizontal position and V their horizontal velocity, at the moment the wave is placed:
- **Wave 0, "cage"** (placed at the cast start): a center circle at `P + V × 0.5`, plus 6 circles evenly around it at 3.5 m. The first of them lies on the boss→player direction. 7 shards.
- **Wave 1, "wall"** (placed at launch): 5 circles 3.0 m apart on a line through `P + V × 0.5`, perpendicular to boss→player. 5 shards.
- **Wave 2, "scatter"** (placed at launch): 12 circles at random positions in the arena. Each is at least 5.0 m from every other wave-2 circle (rejection sampling; a circle that can't be placed in 30 tries is skipped). 12 shards.
- All circles are kept inside the arena (center at most 28.8 m from the arena center).
- Circles: r 1.2, `#FF3B30`, 50% opacity, pulsing. Each wave pulses together.
- Shards: gold cubes (0.6 m, `#FFC300`, spinning) on ballistic arcs that land **exactly** on their circle centers.
- Landing: `shard_land` plays once per wave. Each landing shard makes a small puff (2 debris cubes) and is removed with its circle.

Why: the waves land 0.4 s apart, longer than the 0.35 s of roll i-frames, so one roll can't dodge two waves. The 5 m scatter spacing leaves gaps of at least 1.8 m between kill zones.

**Kill rules (each shard):**
- In flight: the shard (sphere r 0.35) touches a player hitbox sphere.
- At its landing: the player's horizontal distance to its circle center is under `1.2 + 0.4`.

**How to survive:** leave the cage before wave 0 lands (or roll at the landing), step forward or back from the wall, and read the gaps in the scatter.

#### D. Royal Rebuke (close-range defense; triggered by §6.2a, never random)
| Step | Both phases *(tune)* |
|---|---|
| Tell: the body squashes to `(1.1, 0.85, 1.1)`, the crown flashes white twice, `rebuke_windup` sound | 0.35 s (×1.3 with `?easy`; not scaled by rage) |
| Burst: a flat ring `#FFE066` expands from radius 2.0 to 4.5 m around the boss center (0.3 m tall); `rebuke_burst` sound; camera shake 0.2 m for 0.2 s | 0.10 s |
| Recovery, then the boss is free | 0.30 s |

**Kill rule:** during the burst, the player is hit if their horizontal distance from the boss center is at most `4.5 + 0.4` m.

**How to survive:** roll on the tell (the 0.35 s of i-frames cover the whole 0.10 s burst), or be farther than 4.9 m away. A player stuck in a combo recovery can't react to the 0.35 s tell: that is the price of greed.

### 6.5a Optional rage upgrades (off by default)

Three harder variants of the attacks. They are used **only in rage**, and **only if switched on** in `CONFIG.rageUpgrades`. **By default all three are off**, and the game behaves exactly as in §6.5. Switch them on only if playtesting shows the game is too easy (PROJECT_PLAN.md, milestone 1.6). Each one can be switched on independently.

| Config switch | Upgrade | Behavior *(values: tune)* | Readable tell |
|---|---|---|---|
| `doubleSlam` | **Double Slam** | After the normal Slam impact, the boss does a small 0.5 m hop and lands again **0.5 s after the first impact**, spawning a **second shockwave ring** from the same center with the same speed and kill rule. `slam_impact` plays again at 70% volume. The punish window starts at the second impact | During the Slam telegraph, the shadow circle under the boss **flashes twice** (two quick pulses) instead of staying steady |
| `chargeUTurn` | **Charge U-turn** | After the dash and skid, if the player is alive, the boss telegraphs again for **0.4 s** (shake plus red pulse, `charge_windup`), re-locks its direction toward the player, and **dashes once more** with the same speed and stop rules, then skids. At most one U-turn per Charge. The recovery follows the last skid | During the first skid, the red emissive pulse **keeps going** instead of fading, signalling another dash |
| `staggeredShards` | **Staggered Rain** | Wave 0's **center** shard flies **0.3 s longer**, so it lands after its cage. Kill rules are unchanged (each shard is checked at its own landing) | Wave 0's center circle **pulses slower** (1 Hz) than the other circles (3 Hz) |

General rules for upgrades:
- An upgraded attack still counts as **one** attack for the attack history (§6.5) and the "no 3 in a row" rule.
- The boss becomes free only after the **whole** upgraded attack animation (the second impact's punish window ends, or the recovery after the second skid ends). Hazards don't hold it.
- Roll i-frames, hurt invincibility, god mode and boss defeat behave as with normal attacks. If the boss is defeated or the player dies mid-attack, all parts of the attack and all hazards are cancelled.

### 6.6 Defeat

On the hit that brings HP to 0:
1. Hit-stop for 0.20 s.
2. All hazards (shockwave rings, shards, warning circles, the Rebuke ring) are removed.
3. The player can no longer be killed.
4. The boss is replaced by **8 cubes of 2 m each** (a 2×2×2 split, in the current body color). Each gets an outward velocity of 4–8 m/s plus 5–9 m/s upward, and a random spin up to 6 rad/s.
5. The crown becomes a separate piece that falls and rolls.
6. `boss_break` sound; camera shake 0.4 m for 0.5 s; simulation time scale 0.5 for 1.0 s.
7. `victory` sound when the Victory screen appears (1.5 s after the final hit).
8. The player can still move and roll during `BOSS_DEFEATED` (a free victory lap), but cannot attack or drink.

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

## 9. Player death (HP reaches 0; state `DYING`, 2.0 s total)

| Time after the hit | What happens |
|---|---|
| 0.00 s | Hit-stop for 0.10 s. State becomes `DYING`. All hazards are removed. Long sounds (`slam_rise`, `charge_windup`, `rebuke_windup`) stop |
| 0.10 s | The 7 parts detach from the hierarchy and keep their world positions and rotations. Each part gets a horizontal velocity of 3–6 m/s away from the hit source, an upward velocity of 4–7 m/s, and a random spin of up to 10 rad/s. Debris physics applies (ARCHITECTURE.md §5.6). `player_break` sound (clatter plus a falling slide whistle) |
| 0.10 s → | The boss cancels any attack or telegraph, stops moving, and turns at its normal rate to **face the remains** (the average position of the debris). It keeps its idle bounce, as if it is gloating |
| 0.60 s | "YOU DIED" fades in over 0.5 s (§2), with the `you_died` sound |
| 2.00 s | The **return transition** to the start screen begins (§1, `TO_TITLE`) |

**Hit source** (also for non-lethal hits, §4.6): the boss center for Slam, Charge and Rebuke (the ring center for a shockwave); the shard or circle center for Crown Rain.

## 10. Audio

Every sound works in two layers (ASSETS.md §1):
1. **Asset file first:** if an audio file for that sound ID exists in `app/src/assets/sfx/`, the game plays that file.
2. **Code-generated fallback (the default):** if there is no file, or it fails to load, the game plays the Web Audio recipe.

The game must therefore be complete and fully audible with **no sound files at all**. Files can be added or removed at any time without code changes.

| ID | Trigger |
|---|---|
| `swing` | Start of each combo hit's active phase (Hit 3 at pitch ×0.8) |
| `hit` | Weapon hits the boss |
| `swing_ground` *(optional)* | A combo hit's active phase ends without a hit |
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
| `rebuke_windup` | Royal Rebuke tell starts (stoppable) |
| `rebuke_burst` | Royal Rebuke burst |
| `player_hurt` | The player takes a non-lethal hit |
| `flask_drink` | A drink starts |
| `flask_heal` | The drink restores 1 HP (0.60 s) |
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
| `?easy` | Boss movement speeds ×0.75, telegraph times ×1.3 (including the Rebuke tell), cooldowns ×1.3. A hidden helper for visitors who struggle |
| `?debug` | Shows an FPS counter, the current state, the boss phase and attack, wireframe hitboxes (player spheres, boss box, blade points, shockwave band, shard spheres). Debug keys: `1`/`2`/`3` force Slam / Charge / Crown Rain next; `4` triggers a Rebuke now; `K` deals 1 damage to the boss; `G` toggles player invulnerability (god mode). The debug text also shows the player action, combo hit and buffered input, i-frames, HP, stamina and flask charges, and the boss's poise counter, close timer and punish-window time |

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
- [ ] The first input on TITLE starts the fight, unlocks audio and does not trigger an attack; the click that resumes from Pause does not attack either
- [ ] The title input lock (0.5 s after the fade-in) and the victory input lock work; `M` never counts as "any key"
- [ ] The title → fight camera blend is smooth
- [ ] The attempt counter shows on the start screen after the first fight and increases with every fight
- [ ] Losing focus pauses the game and clears held keys; clicking resumes

**Player**
- [ ] Movement has visible acceleration, a sliding stop and lazy turning, with no input loss
- [ ] The roll covers about 4 m in a locked direction, has 0.35 s of i-frames and a short dizzy recovery; the arena wall holds
- [ ] Attacking chains a 3-hit combo (kesagiri, rising backhand, overhead finisher) through the 0.5 s chain window; mashing produces a fluid combo; nothing cancels a committed hit; only active phases damage, one hit at most per combo hit
- [ ] Buffered inputs (last 0.20 s of an action) run at the first legal moment and never cancel anything
- [ ] Stamina allows exactly 3 rolls, or 3 hits + 1 roll, from full; refused actions flash the bar; it refills in about 2 s after a 0.4 s pause
- [ ] The player survives the first hit (stagger, knockback, 1.0 s blinking invincibility) and dies on the second; a flask restores 1 HP after 0.6 s, can be interrupted, and has 3 charges

**Boss**
- [ ] All 4 attacks are telegraphed and can be avoided as described (roll through the ring, strafe or roll past the charge, read the Crown Rain waves, roll the Rebuke); each can also be survived with well-timed roll i-frames
- [ ] The boss stays busy: its cooldown starts when it is free, never while waiting for hazards; it chases beyond 5 m
- [ ] Attack selection never repeats the same attack 3 times in a row; Charge is never chosen within 6 m; Crown Rain never overlaps itself
- [ ] Slam opens a 2.0 s punish window that fits one full combo, followed by a Rebuke if the player is still close
- [ ] Rebuke triggers on poise 3 (outside windows), after 1.0 s close, and at the end of the Slam window, always with its 0.35 s tell
- [ ] Rage starts when HP falls to 8 or below, with its transition (cancelling the attack and all hazards); the boss dies at 0 HP (20 damage)
- [ ] Hit reactions (hit-stop, flash, squash, shake, sound, HUD) all play
- [ ] With all `rageUpgrades` off (the default), rage behaves exactly as §6.5; with each upgrade switched on individually, it behaves as in §6.5a, including its tell

**Feedback**
- [ ] The player falls apart on death; the boss breaks into 8 cubes plus the crown on defeat
- [ ] The player HUD (HP pips, flask counter, stamina bar) and the 20-HP boss bar read clearly
- [ ] All Must and Should sounds play (ASSETS.md §1); `M` mutes everything

**Quality**
- [ ] `?easy` and `?debug` work as specified
- [ ] No errors or warnings in the browser console during a full session (title → 3 deaths → win)
- [ ] Holds a steady 60 fps on the booth laptop in Chrome
- [ ] At least 3 first-time testers each win within about 6 attempts
