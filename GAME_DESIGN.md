# Game Design — The Elden Cube

A one-on-one boss fight that parodies hard "souls-like" games. The hero is extremely clumsy, and the boss is a giant cube wearing a crown. **Three hits kill the player (a flask restores one). The cube takes 30 damage, about seven to eight full combos (changed from 20 on 2026-10-11).**

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
- **Reset** means: player back to spawn with 3 HP, full stamina and 3 flask charges, sword sheathed, boss back to spawn with full HP in Phase 1, all projectiles, debris and effects (particles, burn marks) removed, all timers cleared. **Never reload the page.**
- **Attempt counter:** increases by 1 each time a fight starts. It is held in memory only and resets on page reload.
- **Page loses focus** (window `blur` or tab hidden) during `FIGHT`: pause the simulation, clear all held keys and show a *"Paused — click to continue"* overlay. A click resumes play.
- Target length per attempt: **30–120 s**. Difficulty target *(changed 2026-10-12)*: **very hard to clear**. Most first-time players should not win; a skilled, patient player can.

## 2. Screens and HUD (HTML overlay on top of the canvas)

| Element | Shown in | Spec |
|---|---|---|
| Title text | TITLE | **THE ELDEN CUBE**: Cinzel 700, `min(9vw, 120px)`, gold `#E0B84C`, centered, 30% from top, dark text shadow |
| Start prompt | TITLE | *"Press any key to begin"*: system sans-serif, 24px, white, blinking (opacity 1 ↔ 0.3, 1 s cycle) |
| Controls box | TITLE | `WASD Move · Space Roll · Click Attack · R Flask · M Mute`: 18px, white, semi-transparent dark panel, bottom center |
| Boss health bar | FIGHT, DYING, BOSS_DEFEATED | Bottom center, width `min(60vw, 640px)`, height 14px. Label above, left-aligned: **The Elden Cube** in Cinzel 700, 20px, white. 5 equal segments with a 4px gap; each segment holds 6 of the boss's 30 HP and drains from the right. Full = `#C1121F`, empty = `rgba(0,0,0,0.5)`. The part lost by a hit flashes white for 0.15 s before turning empty |
| Player HUD | FIGHT, DYING | Top-left, 24px from the edges. **HP:** 3 pips (22 × 22px squares, 6px gap, 2px white border; full `#C1121F`, empty `rgba(0,0,0,0.5)`); a lost pip flashes white for 0.15 s. **Flask counter** to the right of the pips: an amber `#F4A259` rounded rectangle 14 × 22px and `×N`, 18px, white. **Stamina bar** below the pips: 240 × 8px, full `#6BBF59`, empty `rgba(0,0,0,0.5)`, no numbers; it flashes white for 0.3 s when an action is refused for lack of stamina. The HUD fades with the boss health bar |
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
| `R` | Drink a flask (§4.3c) | Only with HP below 3 and charges left; may be buffered (§4.3d) |
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

*(Reworked 2026-10-11, milestone 1.5b: rounded limbs with elbows and knees, a real sword, sheathed on the back.)*

The model is built from rounded primitives (capsules, spheres, rounded boxes) with flat colors (`MeshStandardMaterial`, roughness 0.8, metalness 0) and no textures. Every material gets the shared **rim light** (a fresnel edge glow, §8) so the silhouette reads at night. Each visible part casts a shadow.

| Part | Geometry (meters) | Color | Attached to | Position (relative to its parent) |
|---|---|---|---|---|
| Root (invisible) | — | — | world | At the feet. Rotates on Y (yaw) to face the facing direction (+Z local = forward) |
| Roll pivot (invisible) | — | — | root | `(0, 0.90, 0)`. **All visible parts are children of this pivot**, so the roll spins the whole body around the waist. Positions below are given relative to the root; subtract 0.90 in Y when parenting to the pivot |
| Torso | Rounded box 0.60 W × 0.80 H × 0.35 D, corner radius 0.08 | `#3A86FF` | roll pivot | center `(0, 1.00, 0)` |
| Belt | Rounded box 0.62 × 0.10 × 0.37 | `#6B4226` | torso | `(0, −0.30, 0)` |
| Head | Sphere r 0.25 | `#FFD6A5` | neck pivot at `(0, 1.40, 0)` on the roll pivot | `(0, 0.30, 0)` from the pivot |
| Eyes | 2 spheres r 0.04 | `#111111` | head | `(±0.09, 0.05, 0.22)` |
| Upper arm (×2) | Capsule r 0.08, total length 0.30 | `#2B66C4` | shoulder pivot at `(±0.40, 1.35, 0)` | hangs down: center `(0, −0.15, 0)` |
| **Elbow pivot** (×2) | — | — | shoulder pivot | `(0, −0.30, 0)` |
| Forearm (×2) | Capsule r 0.075, total length 0.28 | `#2B66C4` | elbow pivot | center `(0, −0.14, 0)` |
| Hand (×2) | Sphere r 0.07 | `#FFD6A5` | elbow pivot | `(0, −0.30, 0)`. The right hand is the **hand socket** of the sword |
| Thigh (×2) | Capsule r 0.10, total length 0.30 | `#1D3557` | hip pivot at `(±0.15, 0.60, 0)` | center `(0, −0.15, 0)` |
| **Knee pivot** (×2) | — | — | hip pivot | `(0, −0.30, 0)` |
| Shin (×2) | Capsule r 0.09, total length 0.26 | `#1D3557` | knee pivot | center `(0, −0.13, 0)` |
| Boot (×2) | Rounded box 0.18 × 0.10 × 0.28 | `#3D2B1F` | knee pivot | `(0, −0.25, 0.04)` (sole at the ground when standing) |
| Scabbard | Rounded box 0.06 × 1.42 × 0.16 | `#4A3426` | back socket | along the sheathed blade |
| **Sword** | One merged mesh (below) | — | the hand socket or the back socket (§4.3) | — |

**Sword** (local frame: the grip center at the origin, the blade toward −Y, the edges facing ±Z, so the edge leads in every swing):

| Piece | Geometry | Color | Position |
|---|---|---|---|
| Pommel | Sphere r 0.05 | `#D4A017` | `(0, 0.14, 0)` |
| Grip | Cylinder r 0.03, length 0.22 | `#5C3A21` | center `(0, 0, 0)` |
| Crossguard | Rounded box 0.06 × 0.05 × 0.34 | `#D4A017` | `(0, −0.13, 0)` |
| Blade | Diamond cross-section (0.12 wide, 0.035 thick), flat-shaded, tapering from `y = −0.15` to a point at `y = −1.50` | `#CED4DA`, metalness 0.6, roughness 0.35 | — |

With the hand 0.60 m from the shoulder, the tip is **2.1 m** from the shoulder, as before. The **back socket** holds the sword diagonally behind the torso: the grip over the right shoulder at `(−0.22, 1.55, −0.26)` (relative to the root), the blade pointing down toward the left at 35° from vertical, flat against the back.

Total height is about 1.95 m.

### 4.2 Movement (the source of the clumsiness)

The clumsiness comes from **momentum and delay**. Input is **never randomly dropped**; players must feel that mistakes are their own fault.

| Mechanic | Rule | Value *(tune)* |
|---|---|---|
| Spawn | Position `(0, 0, 12)`, facing the boss | — |
| Desired velocity | `input direction (camera-relative, normalized) × maxSpeed` | maxSpeed 6 m/s |
| Acceleration | Horizontal velocity moves toward the desired velocity at `accel` when there is input, or `decel` when there is none | accel 16 m/s² (changed from 10 on 2026-10-11), decel 4 m/s² (this gives the sliding stop) |
| Facing (yaw) | Turns toward a target direction at a limited rate. The target is the movement direction if horizontal speed > 0.5 m/s and there is input; otherwise the direction to the boss | turn rate 4 rad/s |
| Ground | The player always stays on the ground (feet at y = 0). There is no jumping | — |
| Arena wall | The player's horizontal distance from the center is clamped to `arenaRadius − playerRadius`. The outward part of the velocity is removed | 30 − 0.4 = 29.6 m |
| Boss body contact | Whenever the boss is on the ground and not dashing (also during its other attacks), if the player overlaps the boss box, push the player out along the shortest direction and set an outward velocity | push speed 4 m/s |

### 4.3 Attack combo

**Sheathing** *(1.5b)*: when idle, the sword is **sheathed on the back** (§4.1) and the right arm hangs and swings like the left one. Pressing attack starts a **3-hit combo** and draws the sword **inside Hit 1's wind-up**: the hand sweeps up past the right shoulder, and the sword blends from the back socket to the hand socket over 0.08 s *(tune)* when the wind-up is 55% done *(tune)*. **No combat timing changes.** While drawn and free, the sword is held in a **low guard** *(2026-10-11)*: arm θ 35°, ψ 20°, elbow 30°, the tip pointing diagonally at the ground in front, never held up in the air. After the combo ends, once the player has been free for **0.4 s** *(tune)* (an open chain window counts as busy), the sword is put away **in one motion**: over 0.25 s *(tune)* the arm arcs from the low guard up over the right shoulder (θ 200°, ψ 40°) while the sword travels with the hand, and over the last 40% of the arc the sword slides onto the back socket; then the arm drops. Any action interrupts the put-away; an attack then starts from wherever the sword is, and the draw continues smoothly. Rolls, drinks and staggers never draw the sword. Sheathing is visual only.

Each hit is a slash in a **swing plane**:
- **θ** is the right shoulder pivot's pitch: 0° means the arm points straight down, +90° forward, 180° straight up.
- **ψ** (plane tilt) rotates the swing plane around the player's forward axis. ψ > 0 puts the high end of the arc on the player's right and the low end on the left. ψ = 0 is a vertical overhead plane.
- The **rest pose** (θ 200°, ψ 40°) is now only the top of the put-away arc; the drawn idle pose is the low guard above.
- Every wind-up starts from the arm's current θ and ψ, and blends ψ to the hit's tilt linearly over the wind-up.
- **Elbow** *(1.5b)*: during each wind-up the elbow cocks (a bend of up to 35° *(tune)*, `sin(π·u)` over the wind-up) and blends from its starting bend to straight; it is **exactly straight during every active phase**, so the blade lies along the shoulder→hand axis and the hit detection of §5 is unchanged. In the recovery it flexes slightly with the follow-through (up to 12°), then blends to the low-guard bend (30°).
- **Follow-through** *(2026-10-11, visual only)*: the recovery's hold is no longer frozen. The blade carries its momentum past the strike's end angle by up to 14° *(tune)* (`sin(π·u)` over the hold) and comes back, then the arm blends into the low guard. Hits 1 and 3 already end low, so the sword just settles; Hit 2's high finish drops down into the guard.
- **Body follow-through** *(2026-10-11, visual only)*: an upper-body pivot at the waist twists into each slash and unwinds after it (Hit 1: cocks 14° to the right, follows through 10° to the left; Hit 2: the mirror; Hit 3: leans back 5° in the wind-up, then pitches forward 14° into the chop with the knees bending 30°), driven by springs (k 220, damping 20). The left arm counterbalances (forward 30° in the wind-up, back 25° in the strike). Hit detection (§5) uses the arm without the upper-body twist and lean, so this never changes reach.

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
| Effect | Restores **1 HP** (never above 3). Does **not** restore stamina |
| Allowed | Only when free (or buffered, §4.3d), with HP below 3 and at least 1 charge. Otherwise the press does nothing |
| Timeline | 0.00 s: a charge is used and the drink starts (`flask_drink`). **0.60 s:** +1 HP, the body flashes gold `#FFD166` for 0.2 s, the HUD pip refills (`flask_heal`). **1.10 s:** done |
| During the drink | Walking is allowed at up to 1.8 m/s (30% of max speed). No roll and no attack (both can be buffered in the last 0.20 s). Stamina regeneration is paused |
| Interrupted | If the player is hit before 0.60 s, the charge is lost and no HP is restored |
| Visual | *(1.5b)* The left arm is driven to the drink pose: shoulder θ 70°, rolled 50° inward, elbow bent 105° *(tune)*, so the hand reaches the face; the head tips back 15°. A flask (cylinder r 0.07, height 0.18, `#F4A259`) sits in the left hand, visible only while drinking. **Heal aura** at 0.60 s: about 36 gold `#FFD166` glowing particles rise and swirl around the body for about 1 s, plus a soft gold ring expanding on the ground (0.4 s). Visual only |

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
| Right arm, sword sheathed | Like the left arm (opposite phase to the right leg, `25° × s`) |
| Right arm, sword drawn and free | The low guard (θ 35°, ψ 20°, elbow 30°) through the spring, plus a walk swing of `±5° × s`; driven directly along the put-away arc while sheathing |
| Elbows *(1.5b)* | Spring targets: rest bend 12°; walking adds `20° × s` on the forward swing; roll tuck 100°; stagger 60° (arms flail); left elbow 120° while drinking (driven directly) |
| Knees *(1.5b)* | Spring targets: rest bend 4°; walking bends the knee of the swinging-back leg by up to `45° × s` (`max(0, −sin(phase)) × 45° × s` for the left leg, opposite phase for the right); roll tuck 110°; dizzy and stagger 25° |
| Right arm while attacking | Driven **directly** by the combo curves (§4.3), with no spring |
| Left arm while drinking | Driven directly to θ 150° (§4.3c) |
| Head | Position offset on a spring (`k = 80`, `damping = 6`) pushed by `−0.02 × horizontal acceleration`; also nods `±5° × s` with the walk cycle |
| Body | Leans forward `8° × s`; leans back 12° during a stagger *(tune)*; breathes when idle (torso scale Y `1 ± 0.015`, 0.3 Hz) |
| During a roll | All four limbs target 70° (tucked), elbows 100° and knees 110°; the walk cycle pauses |

### 4.5 Hitbox

Two spheres, each with radius 0.40, at heights 0.50 and 1.30 above the feet. These are the **only** shapes that can hurt the player. The limbs and the weapon are not part of the hitbox.

### 4.6 Health and taking damage

| Rule | Value *(tune)* |
|---|---|
| HP | **3** *(changed from 2 on 2026-10-11)*. Every boss attack hit costs 1 HP |
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

*(Reworked 2026-10-11, milestone 1.5b: a gelatinous "slime cube" that matches the player's rounded style.)*

| Part | Geometry | Color | Position (boss local; +Z local = the face that looks at the player) |
|---|---|---|---|
| Cube body | **Rounded box** 4 × 4 × 4, corner radius 0.5 | `#6A4C93` (Phase 1), turning to `#D62828` in rage; roughness 0.35, plus the shared rim light (§8) in a lighter tint of the body color | center `(0, 2, 0)` |
| Crown band | Cylinder r 1.4, height 0.4, 5 sides | `#FFC300`, metalness 0.6, roughness 0.3, faint emissive glow 0.15 | `(0, 4.2, 0)` |
| Crown points | 5 cones r 0.30, height 0.8 | `#FFC300` | On the band's 5 corners at y 4.8 |
| Eyes | 2 rounded boxes 0.7 × 0.7 × 0.1 | `#FFFFFF` | `(±0.8, 2.6, 2.01)` |
| Pupils | 2 rounded boxes 0.3 × 0.3 × 0.1 | `#111111` | `(±0.8, 2.5, 2.06)` |
| Eyebrows (angry) | 2 rounded boxes 1.0 × 0.18 × 0.1 | `#111111` | `(±0.8, 3.15, 2.06)`, tilted 20° downward toward the middle |

The whole boss casts and receives shadows. The **hit box stays the 4 m box** of §5; every deformation below is visual only.

**Slime motion** (visual only; all values *(tune)*). The body, face and crown deform together (one transform on the boss's visual group, pivot at the ground):
- **Squash and stretch with constant volume:** a vertical scale `sy` follows its target through an underdamped spring (k 180, damping 9); the horizontal scale is `1 / √sy`. `sy` is clamped to [0.55, 1.45]. Attack poses set the target (§6.5); impacts kick the spring.
- **Lean (shear):** the top lags behind the boss's horizontal acceleration (`−0.012 m per m/s²` of shear per meter of height, spring k 120, damping 7, max 0.35), so dashes, skids and knockbacks make it wobble like jelly. A hit also kicks the lean away from the player.
- **Breathing:** while waiting, `sy` targets `1 + 0.03 · sin(2π · 0.8 Hz · t)`, on top of the idle bounce.
- The hit squash of §6.3 multiplies on top.
- **Defeat:** the 8 pieces of §6.6 are rounded 2 m cubes in the body color.

### 6.2 Stats and general behavior

| Property | Value *(tune)* |
|---|---|
| HP | 30 (the health bar shows 5 segments of 6; changed from 20 on 2026-10-11) |
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
| **Close** (punishes hugging) *(changed 2026-10-12)* | No timer any more: when the cooldown ends with the player in the **extreme-close band (< 4.5 m)**, the weighted pick (§6.5) chooses Rebuke with **80%** probability |
| **Window end** | When the Slam punish window ends with the player within 5.0 m: Rebuke |

- Only one Rebuke runs at a time.
- Rebuke is not part of the attack history (§6.5). Outside the extreme-close band it is never picked at random.
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
| Phase 1 | HP 30–16 | Base values |
| **Rage** | Immediately after the hit that brings HP to **15 or below** (50%; changed 2026-10-12) | **Transition (1.0 s, no attacks, boss cannot take damage):** starts in the same step as that hit, even mid-attack. The running attack is cancelled, and **all hazards** (shockwave rings, shards in flight, warning circles, the Rebuke ring) are removed with a small puff effect. Long sounds (`slam_rise`, `charge_windup`, `rebuke_windup`) stop. No other hit interrupts an attack (§5). The poise counter resets. Body color fades `#6A4C93` → `#D62828` over 0.5 s, the boss shakes ±0.1 m, `rage` sound plays, camera shake 0.2 m for 0.6 s. **The Meteor Shower (§6.5 G) starts at the beginning of the transition** (after the old hazards are cleared) and keeps falling for 10 s, while the boss fights normally once the transition ends. **When the transition ends**, the rage cooldown (0.6 s) starts. **Afterward:** all boss movement speeds (chase, dash, shockwave, shard flight) ×1.4; attack telegraph times ×0.6 (not the Rebuke tell, not the Slam punish window); cooldown 0.6 s |

### 6.5 Attacks

Every attack is **telegraphed**, and every attack hit costs the player **1 HP** (§4.6), unless the player is **invincible** (roll i-frames §4.3a, hurt invincibility §4.6, or debug god mode). An invincible player simply passes through; the attack continues normally.

**Hazards.** Shockwave rings, shards and warning circles live on their own after they spawn. The boss can be free (and its cooldown can run) while they are still moving. They are all removed by the rage transition, by defeat, by the player's death and by reset.

**Selection rule** *(changed 2026-10-12: distance-weighted probabilities)*: when the cooldown ends:
1. If a Rebuke is pending (poise, Slam window end), do **Rebuke**.
2. Otherwise find the **distance band** of the player (horizontal distance to the boss center) and pick at random by the band's weights *(tune)*:

| Move | Extreme close < 4.5 m | Close 4.5–8 m | Mid 8–16 m | Far > 16 m |
|---|---|---|---|---|
| **Phase 1** Royal Rebuke | **80** | – | – | – |
| Cube Slam | 8 | 30 | 20 | 10 |
| Royal Charge | – | 10 | 25 | 35 |
| Crown Rain | 4 | 15 | 20 | 25 |
| Cone Flame Breath | 8 | 45 | 25 | – |
| Flame Beam | – | 10 | 25 | 30 |
| **Rage** Royal Rebuke | **80** | – | – | – |
| Cube Slam | 6 | 20 | 15 | 5 |
| Royal Charge | – | 10 | 20 | 25 |
| Crown Rain | 4 | 15 | 15 | 20 |
| Cone Flame Breath (double) | 10 | 55 | 30 | – |
| Flame Beam | – | 10 | 30 | 50 |

   - Not allowed (weight 0): Charge within 6 m; Crown Rain while one of its shards is still in the air.
   - Repeats: an attack used last time keeps 25% of its weight; one used the last two times is not allowed. If nothing is allowed, the repeat rule is ignored.
   - The weights of the allowed moves are renormalized before the roll, so in the extreme-close band Rebuke is exactly 80% and the other 20% is shared by the allowed attacks.
3. **After a Crown Rain** the cooldown is **0**: the next pick happens right away, while the shards are still falling.

#### A. Cube Slam (the main punish window)
| Step | Phase 1 | Rage |
|---|---|---|
| Telegraph: the boss rises to y = +4 (ease-out) and **stretches upward** (`sy` target 1.30); a dark circle (r 2.2, 50% opacity) with a glowing orange outline that pulses at 3 Hz stays on the ground under it; `slam_rise` sound | 1.0 s | 0.6 s |
| Hang at the top | 0.15 s | 0.15 s |
| Drop to y = 0 (ease-in), stretched further (`sy` target 1.40) | 0.20 s | 0.20 s |
| Impact: the body **splats** (the stretch spring is kicked down to about `sy` 0.6 and wobbles back during the window), `slam_impact` sound, camera shake 0.35 m for 0.4 s, a burst of about 60 dust and ember particles from the footprint, the shockwave ring spawns (a hazard) | — | — |
| Shockwave: a ring band centered on the impact point expands from radius 2.2 to 14 m. It is drawn as a glowing energy band exactly 1.0 m wide and 0.3 m tall (additive, color `#FF7B00` with a hot `#FFD27A` core, flickering streaks, fading out near the end). Embers ride its front (spawned on the current radius, moving outward at the ring speed), so the effect never hides where the kill band is | 8 m/s | 11.2 m/s |
| **Punish window:** the boss is stuck. It does not turn or move, and its crown wobbles ±10° at 3 Hz. Damage taken now does not count toward poise. At the end: Rebuke if the player is within 5.0 m, otherwise the boss is free | 2.0 s from the impact | 2.0 s |

**Kill rules:**
- At the moment of impact, a player whose hitbox overlaps the boss footprint is hit.
- While the ring is expanding, the player is hit if the horizontal distance from the ring center is within `[r − 0.5 − 0.4, r + 0.5 + 0.4]`.

**How to survive and punish:** roll through the ring as it reaches you (i-frames), or be farther than 14 m away. Then run in and land a full combo before the window ends (a combo started about 0.7 s after the impact lands all 3 hits).

#### B. Royal Charge
| Step | Phase 1 | Rage |
|---|---|---|
| Telegraph: the boss shakes ±0.1 m, its emissive color pulses red and it crouches (`sy` target 0.85); `charge_windup` sound | 0.7 s | 0.42 s |
| Lock: at the end of the telegraph, fix the dash direction toward the player's current horizontal position | — | — |
| Dash in a straight line (`charge_dash` sound), stretched along the dash by the slime lean; dust kicks up behind it. It stops when the boss center reaches radius 27 m, or after 2.0 s | 18 m/s | 25.2 m/s |
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
- **Rage** *(2026-10-12)*: every circle (and its kill radius) grows from r 1.2 to **r 1.8**; the scatter spacing grows from 5.0 to **6.2 m**, so the gaps between kill zones stay at least 1.8 m.
- Circles: r 1.2, `#FF3B30`, 50% opacity, pulsing. Each wave pulses together.
- Shards: **fireballs** *(1.5b)*: a glowing core (r 0.35, `#FFB347`, unlit) with a trail of fire particles, on ballistic arcs that land **exactly** on their circle centers.
- Landing: `shard_land` plays once per wave. Each landing shard **explodes** in a burst of about 14 fire particles and leaves a **burning mark** (a dark scorch r 0.9 with 3 small flame tongues) that lasts **3.0 s** and fades out smoothly from 1.8 s *(tune)*. Burning marks are purely cosmetic (no damage), look nothing like the red warning circles, are smaller than the kill radius, and are removed only by reset (they fade out on their own after a rage transition, a death or a defeat).

Why: the waves land 0.4 s apart, longer than the 0.35 s of roll i-frames, so one roll can't dodge two waves. The 5 m scatter spacing leaves gaps of at least 1.8 m between kill zones.

**Kill rules (each shard):**
- In flight: the shard (sphere r 0.35) touches a player hitbox sphere.
- At its landing: the player's horizontal distance to its circle center is under `1.2 + 0.4`.

**How to survive:** leave the cage before wave 0 lands (or roll at the landing), step forward or back from the wall, and read the gaps in the scatter.

#### D. Royal Rebuke (close-range defense; triggered by §6.2a, never random)
| Step | Both phases *(tune)* |
|---|---|
| Tell: the body squashes to `(1.1, 0.85, 1.1)`, the crown flashes white twice, `rebuke_windup` sound | 0.35 s (×1.3 with `?easy`; not scaled by rage) |
| Burst *(1.5b)*: a **360° spike burst**: 2 staggered rows of 24 spikes (cones, `#FFE066`, glowing) shoot out of the body horizontally at heights 0.5 m and 1.4 m, their tips reaching **4.5 m** from the boss center. The rows are offset by half a spike, so the gaps at 4.5 m (about 0.6 m) are narrower than the player. `rebuke_burst` sound; camera shake 0.2 m for 0.2 s. During the tell, short spike tips (0.3 m) poke out of the body as an extra warning | 0.10 s |
| Recovery (the spikes hold for 0.10 s, then retract into the body), then the boss is free | 0.30 s |

**Kill rule:** during the burst, the player is hit if their horizontal distance from the boss center is at most the spikes' current reach `+ 0.4` m (the reach grows from 2.0 to 4.5 m over the first 70% of the burst, ease-out, exactly as drawn; *2026-10-12*), so damage never arrives before the spikes.

**How to survive:** roll on the tell (the 0.35 s of i-frames cover the whole 0.10 s burst), or be farther than 4.9 m away. A player stuck in a combo recovery can't react to the 0.35 s tell: that is the price of greed.

#### E. Cone Flame Breath *(added 2026-10-12)*
| Step | Phase 1 | Rage |
|---|---|---|
| Telegraph: the boss turns toward the player normally; its mouth glows orange and a red cone outline (110°, 12 m; rage 130°, 13 m) pulses on the ground in front of it. `shard_launch` plays at each blast | 0.9 s | 0.7 s (not scaled by the rage telegraph factor) |
| Blast (the boss is stuck; the cone is fixed): a wide burst of fire fills the cone, a ring of fire rushes outward across the cone on the ground, the boss light flares, and about **8 burning marks** (§6.5 C) are left scattered in the cone; smoke follows | 1 blast, damage window **0.25 s** | **2 blasts**: the second starts **0.70 s** after the first (each 0.25 s), timed to the second roll's i-frames |
| Recovery (a punish window: no turning, damage does not count toward poise) | 0.8 s | 0.6 s |

**Visuals lead the damage** *(2026-10-12)*: each blast starts **0.1 s before** its damage window with a muzzle flash at the boss's mouth and a **shotgun-like spray of fast fire sparks** (streaks) that crosses the cone in that 0.1 s, so the fire is on screen before it hurts.
**Kill rule:** during a blast's damage window, the player is hit if their horizontal distance to the boss center is at most `range + 0.4` and the angle from the boss's facing to the player is within half the cone angle (plus the player's radius).
**How to survive:** the cone is too wide to run out of during the telegraph: **roll through it** (the 0.25 s window fits inside the 0.35 s i-frames), or already be **behind the boss** (outside the cone). In rage you need **2 rolls (60 stamina)**; without enough stamina, one hit is guaranteed. Hurt invincibility means the double blast deals at most 1 damage.

#### F. Flame Beam *(added 2026-10-12)*
| Step | Phase 1 | Rage |
|---|---|---|
| Charge: `beam_charge` sound; the boss turns toward the player; a thin red aiming line shows the path; sparks rush into a growing glowing orb at the boss's mouth and the screen edges darken. **0.3 s before firing the beam locks** onto the player, **aimed down at their feet** (ground distance clamped to 6–26 m): the aiming line stops following and flashes bright. A player who starts walking at the flash gets clear | 1.0 s | 0.7 s |
| Fire *(reworked 2026-10-12, like Hyper Beam)*: `beam_fire` sound (lasts while firing), a short white flash, a hard camera shake and a low rumble. The beam slants from the boss's mouth down to the ground at the locked distance; its **front travels out at 28 m/s** (it is only dangerous up to its front). Where it meets the ground it explodes constantly and leaves a **trail of burning marks** (§6.5 C). A glowing stripe on the ground shows its path. **Sweep side:** decided once when it fires, from the player's sideways velocity across the boss→player line (above 1.0 m/s: the side the player moves to; otherwise random). The beam fires straight at where the player was and **starts sweeping once its front reaches the ground**; it then only sweeps that way, at up to **ω** toward the player, and **never reverses**. **Walking sideways at full speed outruns it** within about 15 m (rage: 10 m); rolling against the sweep also works. The boss faces the beam | 3.0 s, ω 0.40 rad/s | 2.0 s, ω 0.60 rad/s |
| The beam stops at once if the player is hit, or if the boss takes damage | — | — |
| Recovery (short, to reward the counter-roll; a punish window) | 0.5 s | 0.4 s |

**Kill rule:** while firing, the player is hit if the beam (radius **1.0 m**, wider since 2026-10-12, from the boss's face to its front, at most the ground point) touches a hit sphere (horizontal distance from the sphere center to that segment ≤ 1.0 + 0.4 m).
**How to survive:** walk or sprint away from the sweep (works at normal fight distances), or **roll against the sweep** as the beam reaches you: the i-frames carry you through it and it cannot turn back. Players beyond the ground point are safe. Then punish the boss from the side.

#### G. Meteor Shower *(added 2026-10-12; once per fight)*
- Starts at the beginning of the rage transition (§6.4) and lasts **10 s**. It is a hazard: the boss is free to fight normally while it falls.
- About **12 meteors per second** (about 120 in total), at random positions over the whole arena (each target at least 2 m from the other live targets, inside the arena). Unaimed.
- Each target shows a red warning circle (r **1.8**, the rage Crown Rain radius) **0.9 s** before impact; a fireball falls from the sky onto it and explodes, leaving a burning mark (§6.5 C). `shard_land` at impacts (at most every 0.15 s).
- **Kill rule:** at impact, the player is hit if their horizontal distance to the target is under `1.8 + 0.4`.
- Removed by the player's death, defeat and reset.

#### Cinematic effects *(added 2026-10-12, visual only)*
- **Boss light:** one orange point light that always exists (so the light count never changes) at the boss's mouth, normally off. It flares during the Flame Beam (sustained, flickering), each Cone blast and the Slam impact, lighting the arena orange.
- **Blood moon:** during the Meteor Shower the sky, fog, moon and hemisphere light turn dark red (0.6 s in), and fade back over the last 1.5 s.
- **Rage slow motion:** when rage starts, time runs at 0.3× for 0.5 s (real time), with a strong camera shake and the camera looking up toward the sky as the first meteors appear.
- **Camera lift during the Flame Beam:** the lock-on camera rises to 6.5 m and pulls back to 7.5 m (smoothly) while the beam charges and fires, so the beam is seen from above instead of end-on. The beam fades out within 3 m of the camera.
- Flashes are short (≤ 0.1 s) and soft; nothing strobes.

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

*(Reworked 2026-10-11, milestone 1.5b: a moonlit dusk arena lit by torches. Values *(tune)*.)*

| Item | Spec |
|---|---|
| Arena floor | Circle with radius 30 m and 64 segments, color `#6AB04C`, receives shadows. Vary the green ±6% per vertex using vertex colors (still no texture) |
| Outer field | Circle with radius 200 m, color `#5E9E44`, 1 cm below the arena; it fades into the night fog |
| Arena edge marker | Flat ring from radius 29.8 to 30.2 m, color `#4A7F35` (shows where the invisible wall is) |
| Sky | **Moonlit dusk, nearly dark:** background `#0B1020`; linear fog in the same color, from 35 m to 110 m |
| Ambient | Hemisphere light (sky `#3B4A7A`, ground `#141A10`, intensity 0.9) |
| Moon | Directional light `#A8B8FF` from `(−14, 26, 12)`, intensity 1.3, the **only** shadow caster: 1024² map, the shadow camera covers ±35 m around the origin, bias −0.0005 |
| Torches | **6 torches** evenly around the arena at radius 32 m (outside the wall, never in the way): a dark wooden pole (cylinder r 0.08, 2.2 m), an iron bowl on top, and a flickering flame (additive glowing billboards). Each has a warm point light `#FF9A3C` (intensity 40, range 22 m, decay 2) **without shadows**, flickering ±15% with smooth noise. Lights are never added or removed during play |
| Rim light | Every character material adds a fresnel edge glow (player: cool `#9DB7FF`, strength 0.35; boss: a light tint of its body color, strength 0.45), so silhouettes read against the dark |
| Tone mapping | ACES filmic, exposure 1.0. Telegraph and UI-like effects (warning circles, slam outline, shockwave, rebuke spikes' glow, particles) are unlit and not tone mapped, so they stay vivid |
| Readability | Every telegraph is unlit or emissive, so it reads at night. Check on the booth laptop in a bright hall |

## 9. Player death (HP reaches 0; state `DYING`, 2.0 s total)

| Time after the hit | What happens |
|---|---|
| 0.00 s | Hit-stop for 0.10 s. State becomes `DYING`. The running attack ends with a final burst of its effect (e.g. the Cone's fire fills the cone, the Flame Beam bursts along its line), so the killing blow is always visible. Hazards no longer hurt but **finish their animation** (rings expand and fade, shards and meteors land and explode, spikes retract); the Meteor Shower spawns no new meteors. Reset removes everything *(changed 2026-10-12)*. Long sounds (`slam_rise`, `charge_windup`, `rebuke_windup`) stop |
| 0.10 s | The 12 parts (torso, head, upper arms, forearms with hands, thighs, shins with boots, scabbard, sword) detach from the hierarchy and keep their world positions and rotations. Each part gets a horizontal velocity of 3–6 m/s away from the hit source, an upward velocity of 4–7 m/s, and a random spin of up to 10 rad/s. Debris physics applies (ARCHITECTURE.md §5.6). `player_break` sound (clatter plus a falling slide whistle) |
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
| `swing` | Start of each combo hit's active phase (Hit 3 at pitch ×0.8), with a random pitch ×0.88–1.14 on every swing *(1.5d, tune)* so it never sounds repetitive |
| `hit` | Weapon hits the boss |
| `swing_ground` *(removed in 1.5d)* | Not played: a miss is just the normal swing |
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
| `beam_charge` *(2026-10-12)* | Flame Beam charge starts (stoppable, lasts the charge) |
| `beam_fire` *(2026-10-12)* | Flame Beam fires (stoppable, lasts while firing) |
| `player_hurt` | The player takes a non-lethal hit |
| `flask_drink` | A drink starts |
| `flask_heal` | The drink restores 1 HP (0.60 s) |
| `player_break` | The player's body breaks apart (0.10 s into `DYING`, §9) |
| `you_died` | "YOU DIED" appears (0.6 s into `DYING`) |
| `boss_break` | Boss defeat |
| `victory` | Victory screen appears |

- Browsers block audio until the user interacts, so create or resume the `AudioContext` on the **first key press or click** (the TITLE screen's "press any key").
- `M` toggles a master gain between 0.8 and 0.
- **Background music** *(added 2026-10-11, milestone 1.5c)*: one looping track, used only if a music file exists (ASSETS.md §1.4); there is no generated fallback, so without a file the game has no music.
  - **TITLE:** no music.
  - **Fight start** (TITLE → FIGHT): the track starts from the beginning and fades in over 0.5 s *(tune)*.
  - **DYING or BOSS_DEFEATED:** the music fades out over 1.5 s *(tune)* and stops. It stays off through VICTORY_SCREEN, TO_TITLE and TITLE.
  - **Funny tone:** the track plays **sped up and pitched up** (playback rate 1.12, about +2 semitones, *(tune)*), so even an epic boss theme sounds slightly silly, matching the clumsy hero.
  - Loudness 0.35 *(tune)* relative to the sound effects, through the master gain, so `M` mutes it too. While paused it drops to 30% and comes back on resume.

## 11. Difficulty and debug options (URL parameters)

| Parameter | Effect |
|---|---|
| `?easy` | Boss movement speeds ×0.75, telegraph times ×1.3 (including the Rebuke tell), cooldowns ×1.3. A hidden helper for visitors who struggle |
| `?debug` | Shows an FPS counter, the current state, the boss phase and attack, wireframe hitboxes (player spheres, boss box, blade points, shockwave band, shard spheres). Debug keys: `1`/`2`/`3` force Slam / Charge / Crown Rain next; `4` triggers a Rebuke now; `5`/`6` force Cone Breath / Flame Beam next; `7` starts a Meteor Shower; `K` deals 1 damage to the boss; `G` toggles player invulnerability (god mode). The debug text also shows the player action, combo hit and buffered input, i-frames, HP, stamina and flask charges, and the boss's poise counter, the player's distance band, the Meteor Shower state and punish-window time |

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
- [ ] The player survives the first two hits (stagger, knockback, 1.0 s blinking invincibility) and dies on the third; a flask restores 1 HP after 0.6 s, can be interrupted, and has 3 charges

**Boss**
- [ ] All 4 attacks are telegraphed and can be avoided as described (roll through the ring, strafe or roll past the charge, read the Crown Rain waves, roll the Rebuke); each can also be survived with well-timed roll i-frames
- [ ] The boss stays busy: its cooldown starts when it is free, never while waiting for hazards; it chases beyond 5 m
- [ ] Attack selection never repeats the same attack 3 times in a row; Charge is never chosen within 6 m; Crown Rain never overlaps itself
- [ ] Slam opens a 2.0 s punish window that fits one full combo, followed by a Rebuke if the player is still close
- [ ] Rebuke triggers on poise 3 (outside windows), after 1.0 s close, and at the end of the Slam window, always with its 0.35 s tell
- [ ] Rage starts when HP falls to 15 or below (50%), with its transition (cancelling the attack and all hazards) and the 10 s Meteor Shower; the boss dies at 0 HP (30 damage)
- [ ] *(2026-10-12)* Moves follow the distance-weighted table (Rebuke 80% when extremely close); Crown Rain is followed immediately by another attack; the Cone Breath can only be rolled through (double in rage, 60 stamina); the Flame Beam sweeps after the player, never reverses and can be beaten by rolling against it; it stops when either side takes damage
- [ ] Hit reactions (hit-stop, flash, squash, shake, sound, HUD) all play
- [ ] With all `rageUpgrades` off (the default), rage behaves exactly as §6.5; with each upgrade switched on individually, it behaves as in §6.5a, including its tell

**Feedback**
- [ ] The player falls apart on death; the boss breaks into 8 cubes plus the crown on defeat
- [ ] *(1.5b)* Elbows and knees bend in every animation; the sword is sheathed on the back when idle, drawn during Hit 1's wind-up and put away 0.4 s after the combo; the boss squashes, stretches and wobbles like jelly; the Slam splats; the Rebuke is a spike burst; Crown Rain shards are fireballs that leave fading burn marks; the flask shows a heal aura
- [ ] *(1.5b)* The night arena is readable: every telegraph is clearly visible, the torches flicker, draw calls stay under 100
- [ ] The player HUD (HP pips, flask counter, stamina bar) and the 30-HP boss bar read clearly
- [ ] All Must and Should sounds play (ASSETS.md §1); `M` mutes everything

**Quality**
- [ ] `?easy` and `?debug` work as specified
- [ ] No errors or warnings in the browser console during a full session (title → 3 deaths → win)
- [ ] Holds a steady 60 fps on the booth laptop in Chrome
- [ ] Very hard to clear (2026-10-12): first-time testers struggle; a practiced player can win
