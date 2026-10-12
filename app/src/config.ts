/**
 * EVERY tunable number of the game (ARCHITECTURE.md §6).
 *
 * Source: GAME_DESIGN.md (GD) §1–11, ASSETS.md §1.1 (relative loudness), ARCHITECTURE.md §5 (physics).
 * Units: meters, seconds, radians (degrees only as input to `deg()`), m/s, m/s², Hz.
 * Values marked (tune) in GD may change only during playtesting (milestone 1.6), and only here.
 * "(tune, agent-chosen)" marks values the documents did not specify; chosen during the build and
 * approved by the user (2026-10-09). They are tunable in 1.6 like any (tune) value.
 *
 * CONFIG is deeply frozen and never mutated. `?easy` / rage multipliers are applied when values are
 * read (see flags.ts). Tests that need different values (e.g. rage upgrades) inject overrides; they
 * never edit this file.
 */

/** Degrees → radians (for readability of values that GD gives in degrees). */
const deg = (d: number): number => (d * Math.PI) / 180;

export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** A [min, max] range for random values. */
type Range = [number, number];
/** A camera shake: amplitude (m) for a duration (s). */
type Shake = { amplitude: number; duration: number };
type Vec3 = { x: number; y: number; z: number };

const RAW = {
  /** GD §4 — The Tarnished Intern. */
  player: {
    spawn: { x: 0, y: 0, z: 12 }, // m
    maxSpeed: 6, // m/s (tune)
    accel: 16, // m/s² toward desired velocity with input (tune)
    decel: 4, // m/s² without input → sliding stop (tune)
    turnRate: 4, // rad/s (tune)
    faceMoveMinSpeed: 0.5, // m/s; above this (with input) face the movement direction
    radius: 0.4, // m; arena wall clamp uses arenaRadius − radius = 29.6
    bossPushSpeed: 4, // m/s outward velocity after boss body contact (tune)
    hp: 3, // GD §4.6: hits before death (tune; 2 → 3 on 2026-10-11)
    /** GD §4.5: the ONLY shapes that can hurt the player. */
    hitSpheres: [
      { height: 0.5, radius: 0.4 }, // m above the feet
      { height: 1.3, radius: 0.4 },
    ],
    /** GD §4.1 model (1.5b; positions relative to the root, feet at y = 0; +Z = forward). */
    model: {
      roughness: 0.8,
      metalness: 0,
      rollPivotHeight: 0.9, // m
      body: { size: { x: 0.6, y: 0.8, z: 0.35 }, center: { x: 0, y: 1.0, z: 0 }, cornerRadius: 0.08 },
      belt: { size: { x: 0.62, y: 0.1, z: 0.37 }, offset: { x: 0, y: -0.3, z: 0 } }, // relative to the torso
      neck: { radius: 0.09, length: 0.22, offset: 0.42 }, // capsule above the torso center (closes the head gap) (tune, agent-chosen)
      neckPivot: { x: 0, y: 1.4, z: 0 },
      head: { radius: 0.25, offset: { x: 0, y: 0.3, z: 0 } }, // offset from the neck pivot
      eyes: { radius: 0.04, offset: { x: 0.09, y: 0.05, z: 0.22 } }, // ±x, relative to the head
      shoulderPivot: { x: 0.4, y: 1.35, z: 0 }, // ±x
      upperArm: { radius: 0.08, length: 0.3 }, // total capsule length (m)
      elbow: 0.3, // m below the shoulder pivot
      forearm: { radius: 0.075, length: 0.28 },
      hand: { radius: 0.07, offset: 0.3 }, // m below the elbow pivot: the sword's hand socket
      hipPivot: { x: 0.15, y: 0.6, z: 0 }, // ±x
      thigh: { radius: 0.1, length: 0.3 },
      knee: 0.3, // m below the hip pivot
      shin: { radius: 0.09, length: 0.26 },
      boot: { size: { x: 0.18, y: 0.1, z: 0.28 }, offset: { x: 0, y: -0.25, z: 0.04 } }, // relative to the knee pivot
      capsuleCapSegments: 4, // tessellation (visual only) (tune, agent-chosen)
      capsuleRadialSegments: 10,
      roundedBoxSegments: 2,
      sphereSegments: 16, // head/eye tessellation (visual only) (tune, agent-chosen)
      /** GD §4.1 sword (local frame: grip center at the origin, blade toward −Y, edges facing ±Z). */
      sword: {
        pommel: { radius: 0.05, y: 0.14 },
        grip: { radius: 0.03, length: 0.22 },
        guard: { size: { x: 0.06, y: 0.05, z: 0.34 }, y: -0.13 },
        blade: { width: 0.12, thickness: 0.035, from: -0.15, taperFrom: -1.3, taperWidth: 0.85, tip: -1.5 }, // taperWidth: × width at taperFrom (tune, agent-chosen)
        metalness: 0.6,
        roughness: 0.35,
      },
      /** GD §4.1 back socket: grip over the right shoulder, blade down to the left, flat against the back. */
      backSocket: { position: { x: -0.22, y: 1.55, z: -0.26 }, tilt: deg(35) },
      scabbard: { size: { x: 0.06, y: 1.42, z: 0.16 }, offset: -0.84 }, // offset: along the sheathed blade from the grip
      /** GD §4.3c flask prop in the left hand. */
      flask: { radius: 0.07, height: 0.18, offset: { x: 0, y: -0.02, z: 0.08 }, segments: 10 }, // relative to the hand (tune, agent-chosen)
    },
    /** GD §4.3 sheathing (1.5b, visual only). */
    sword: {
      drawAt: 0.55, // fraction of Hit 1's wind-up when the sword leaves the back (tune)
      drawBlend: 0.08, // s back socket → hand (tune)
      sheatheDelay: 0.4, // s free after the combo before putting the sword away (tune; 1.5 → 0.4 on 2026-10-11)
      stowArc: 0.25, // s: one arc from the low guard over the shoulder (tune)
      stowRelease: 0.6, // fraction of the arc after which the sword slides onto the back
      stowAngle: deg(200), // θ at the top of the arc (the old rest pose)
    },
  },

  /**
   * GD §4.3 — 3-hit combo. θ = right shoulder pitch (0 = down, 90° = forward, 180° = up);
   * ψ = swing-plane tilt around the forward axis (> 0: high end on the player's right).
   */
  combo: {
    restAngle: deg(200), // rest pose: sword on the right shoulder
    restTilt: deg(40),
    chainWindow: 0.5, // s from the chain point (tune)
    elbowCock: deg(35), // max elbow bend during a wind-up, sin(π·u) (1.5b) (tune)
    /** 2026-10-11: drawn idle pose — a low guard, the tip toward the ground in front (visual only). */
    guardAngle: deg(35), // θ (tune)
    guardTilt: deg(20), // ψ (tune)
    guardElbow: deg(30), // (tune)
    followThrough: deg(14), // overshoot past the strike's end during the hold, sin(π·u) (tune)
    followElbow: deg(12), // extra elbow flex during the follow-through
    /** Body follow-through (visual only; hit detection ignores it). */
    body: {
      stiffness: 220,
      damping: 20,
      twist: [
        { cock: deg(-14), through: deg(10) }, // Hit 1: cock right, follow through left
        { cock: deg(12), through: deg(-10) }, // Hit 2: the mirror
        { cock: 0, through: 0 }, // Hit 3: overhead, no twist
      ],
      finisherLeanBack: deg(5), // Hit 3 wind-up
      finisherLean: deg(14), // Hit 3 strike: pitches forward into the chop
      finisherKnees: deg(30), // extra knee bend in the chop
      counterArmWindup: deg(30), // left arm forward in the wind-up
      counterArmStrike: deg(-25), // left arm back in the strike
    },
    bladePoints: [0.5, 1.3, 2.1], // m from the shoulder (GD §5)
    hits: [
      {
        // Hit 1 — kesagiri (right shoulder → left hip)
        cost: 20,
        damage: 1,
        tilt: deg(40),
        windup: { duration: 0.18, toAngle: deg(215) }, // ease-out (tune)
        active: { duration: 0.12, toAngle: deg(40), lunge: 0.8 }, // ease-in; lunge in m (tune)
        recovery: { duration: 0.35, hold: 0.15 }, // hold, then back to rest (tune)
        chainAt: 0.15, // s into the recovery
        pitch: 1, // swing sound pitch
      },
      {
        // Hit 2 — rising backhand (left hip → right shoulder)
        cost: 20,
        damage: 1,
        tilt: deg(40),
        windup: { duration: 0.12, toAngle: deg(30) },
        active: { duration: 0.12, toAngle: deg(200), lunge: 0.6 },
        recovery: { duration: 0.35, hold: 0.15 },
        chainAt: 0.15,
        pitch: 1,
      },
      {
        // Hit 3 — overhead finisher
        cost: 20,
        damage: 2,
        tilt: 0,
        windup: { duration: 0.25, toAngle: deg(225) },
        active: { duration: 0.15, toAngle: deg(40), lunge: 1.2 },
        recovery: { duration: 0.55, hold: 0.25 },
        chainAt: -1, // none: the combo ends
        pitch: 0.8,
      },
    ],
  },

  /** GD §4.3b — stamina. */
  stamina: {
    max: 90, // (tune)
    rollCost: 30, // (tune)
    regenDelay: 0.4, // s after the player is free again (tune)
    regenRate: 45, // per second (tune)
  },

  /** GD §4.3c — flask (R). */
  flask: {
    charges: 3, // per fight (tune)
    heal: 1, // HP
    healAt: 0.6, // s into the drink (tune)
    duration: 1.1, // s total (tune)
    maxSpeed: 1.8, // m/s while drinking (30% of max speed)
    drinkShoulder: deg(70), // left shoulder θ while drinking (1.5b) (tune)
    drinkRoll: deg(50), // left arm rolled inward toward the face (GD: 30°; raised so the hand reaches the mouth) (tune)
    drinkElbow: deg(105), // left elbow bend while drinking (GD: 120°) (tune)
    drinkHeadTilt: deg(15), // head tips back
    drinkBlend: 0.15, // s to move into / out of the drink pose (tune, agent-chosen)
    healFlash: 0.2, // s gold body flash
  },

  /** GD §4.6 — taking damage. */
  hurt: {
    hitStop: 0.1, // s
    shake: { amplitude: 0.25, duration: 0.3 } as Shake,
    stagger: 0.5, // s (tune)
    knockback: 3.0, // m away from the hit source, ease-out over the stagger (tune)
    invulnerability: 1.0, // s from the hit (tune)
    blinkHz: 10, // visible ↔ hidden
  },

  /** GD §4.3d — input buffer. */
  buffer: {
    window: 0.2, // s; 0 = strict (no buffering) (tune)
  },

  /** GD §4.3a — roll (Space). */
  roll: {
    distance: 4.0, // m (tune)
    duration: 0.55, // s, ease-out displacement (tune)
    iFrameStart: 0.05, // s after the roll starts (tune)
    iFrameEnd: 0.4, // s after the roll starts → 0.35 s of i-frames (tune)
    turnRateMult: 3, // × player.turnRate toward the roll direction
    recoveryDuration: 0.12, // s dizzy recovery (tune)
    recoverySpeed: 2, // m/s initial velocity in the recovery, decays at decel
    recoverySway: deg(8), // ± body sway
    recoverySwayCycles: 1, // full side-to-side sways during the recovery (tune, agent-chosen)
    somersault: Math.PI * 2, // one full forward flip over `duration`, ease-in-out
    tuckAngle: deg(70), // limb spring target during the roll
    debugTint: 0.3, // ?debug: 30% white while invincible
  },

  /** GD §4.4 — visual wobble (no gameplay effect). */
  wobble: {
    restArmSwing: deg(5), // ± right arm walk swing in the rest pose (GD §4.4)
    limbStiffness: 120, // k
    limbDamping: 8, // c
    limbClamp: deg(80), // ±
    legSwing: deg(35), // × s
    walkFrequency: 1.8, // Hz × s
    armSwing: deg(25), // × s
    armLagPerAccel: -0.03, // rad per m/s² of forward acceleration
    headStiffness: 80,
    headDamping: 6,
    headPush: -0.02, // m per m/s² of horizontal acceleration
    headNod: deg(5), // × s
    headNodPerStride: 2, // nods per walk cycle (tune, agent-chosen)
    dizzyHeadKick: 0.6, // m/s sideways velocity kick on the head spring at the dizzy landing (tune, agent-chosen)
    bodyLean: deg(8), // × s
    /** 1.5b joints (GD §4.4): spring targets in radians. */
    jointStiffness: 140, // (tune, agent-chosen)
    jointDamping: 11, // (tune, agent-chosen)
    jointMax: deg(130), // elbows and knees never bend further
    elbowRest: deg(12),
    elbowWalk: deg(20), // × s on the forward swing
    elbowTuck: deg(100),
    elbowStagger: deg(60),
    kneeRest: deg(4),
    kneeWalk: deg(45), // × s, the leg behind
    kneeTuck: deg(110),
    kneeBent: deg(25), // dizzy and stagger
    staggerLean: deg(12), // leans back during a stagger (tune)
    staggerArmRaise: deg(55), // arms flail up during a stagger (tune, agent-chosen)
    breatheAmplitude: 0.015, // torso scale Y ± when idle
    breatheFrequency: 0.3, // Hz
  },

  /** GD §6 — The Elden Cube. */
  boss: {
    hp: 30, // (tune; 20 → 30 on 2026-10-11 with accel 16); the health bar shows 5 segments of 6
    healthSegments: 5,
    spawn: { x: 0, y: 0, z: 0 }, // facing +Z
    halfSize: 2.0, // m, hit box (yaw-only)
    grace: 1.0, // s before the first attack (tune)
    bobAmplitude: 0.08, // m (visual)
    bobFrequency: 1.2, // Hz
    turnRate: 2.0, // rad/s (tune)
    chaseDistance: 5, // m; chase when farther, stop at this distance (tune)
    chaseSpeed: 3.5, // m/s (tune)
    cooldown: 1.0, // s Phase 1, from the moment the boss is free (tune)
    noRepeat: 2, // the same attack may not be chosen after this many in a row
    clampRadius: 27, // m (ARCHITECTURE §5.3)
    /** GD §6.1 slime motion (1.5b, visual only). */
    slime: {
      stiffness: 180, // stretch spring k (tune)
      damping: 9, // (tune)
      minScale: 0.55,
      maxScale: 1.45,
      leanPerAccel: 0.012, // shear per m/s² (tune)
      leanPerSpeed: 0.008, // shear per m/s: the top trails fast moves (tune, agent-chosen)
      leanStiffness: 120,
      leanDamping: 7,
      maxLean: 0.35,
      breatheAmplitude: 0.03, // ± vertical scale while waiting
      breatheFrequency: 0.8, // Hz
      hitLeanKick: 0.9, // shear/s away from the player on a hit (tune, agent-chosen)
      hitStretchKick: -1.5, // stretch velocity on a hit (tune, agent-chosen)
      slamRiseStretch: 1.3, // sy target during the Slam rise
      slamDropStretch: 1.4, // sy target during the drop
      slamSplatKick: -6, // stretch velocity at the impact (tune)
      chargeCrouch: 0.85, // sy target during the Charge telegraph
    },
    /** GD §6.3 hit reaction. */
    hit: {
      hitStop: 0.08, // s
      flashDuration: 0.1, // s white emissive
      squash: { x: 1.15, y: 0.85, z: 1.15 },
      squashReturn: 0.25, // s spring back to (1,1,1)
      squashWobbles: 1, // damped oscillations while springing back (tune, agent-chosen)
      knockback: 0.3, // m away from the player (skipped during a Charge dash)
      shake: { amplitude: 0.15, duration: 0.2 } as Shake,
      /** Hit 3 (the finisher) hits harder. */
      heavy: { hitStop: 0.12, knockback: 0.6, shake: { amplitude: 0.25, duration: 0.25 } as Shake },
    },
    /** GD §6.6 defeat. */
    defeat: {
      hitStop: 0.2, // s
      pieceSize: 2, // m (2×2×2 split of the 4 m cube)
      outwardSpeed: [4, 8] as Range, // m/s
      upwardSpeed: [5, 9] as Range, // m/s
      maxSpin: 6, // rad/s
      crownOutwardSpeed: [1, 2] as Range, // m/s (crown falls and rolls) (tune, agent-chosen)
      crownUpwardSpeed: [3, 4] as Range, // m/s (tune, agent-chosen)
      pieceCornerRadius: 0.3, // m rounded gel chunks (1.5b)
      shake: { amplitude: 0.4, duration: 0.5 } as Shake,
      timeScale: 0.5,
      timeScaleDuration: 1.0, // s
      victoryDelay: 1.5, // s (simulation time) until VICTORY_SCREEN
    },
    /** GD §6.1 model (boss local; +Z = the face that looks at the player). */
    model: {
      bodySize: 4, // m cube
      bodyCenterY: 2,
      bodyCornerRadius: 0.5, // m (1.5b gel cube)
      bodySegments: 5, // rounded-box tessellation (visual only) (tune, agent-chosen)
      bodyRoughness: 0.35,
      faceCornerRadius: 0.04, // m
      crownGlow: 0.15, // faint gold emissive (night)
      bodyGlow: 0.18, // faint gel self-glow in the body color (night) (tune, agent-chosen)
      crownBand: { radius: 1.4, height: 0.4, sides: 5, y: 4.2, metalness: 0.6, roughness: 0.3 },
      crownPoint: { radius: 0.3, height: 0.8, y: 4.8, count: 5, segments: 8 }, // segments: tessellation (tune, agent-chosen)
      eye: { size: { x: 0.7, y: 0.7, z: 0.1 }, position: { x: 0.8, y: 2.6, z: 2.01 } }, // ±x
      pupil: { size: { x: 0.3, y: 0.3, z: 0.1 }, position: { x: 0.8, y: 2.5, z: 2.06 } }, // ±x
      eyebrow: { size: { x: 1.0, y: 0.18, z: 0.1 }, position: { x: 0.8, y: 3.15, z: 2.06 }, tilt: deg(20) },
      roughness: 0.8,
    },
  },

  /** GD §6.2a + §6.5 D — Royal Rebuke and its triggers. */
  rebuke: {
    poiseTrigger: 3, // damage outside punish windows (tune)
    windowEndDistance: 5.0, // m: Rebuke when the Slam window ends this close (tune)
    tell: 0.35, // s (× easy only, never × rage) (tune)
    burst: 0.1, // s
    recovery: 0.3, // s (tune)
    startRadius: 2.0, // m
    endRadius: 4.5, // m; kill if distance ≤ endRadius + player radius during the burst
    tellSquash: { x: 1.1, y: 0.85, z: 1.1 },
    /** 1.5b spike burst (visual; the kill rule above is unchanged). */
    spikes: {
      perRow: 24,
      rows: [0.5, 1.4], // m heights (the player's hit spheres are at 0.5 and 1.3)
      innerRadius: 1.5, // m: spikes start inside the body
      tellTip: 2.35, // m: tips poke out during the tell (≈ 0.3 m beyond the flat sides)
      baseRadius: 0.2, // m cone base (tune, agent-chosen)
      radialSegments: 6,
      glow: 0.6, // emissive intensity (reads at night)
      pitchJitter: 0.12, // rad (tune, agent-chosen)
      overshoot: 0.15, // m past endRadius at the end of the burst, settling back (tune, agent-chosen)
      hold: 0.1, // s at full length after the burst, then retract over the rest of the recovery
    },
    crownFlashes: 2, // white flashes during the tell
    shake: { amplitude: 0.2, duration: 0.2 } as Shake,
  },

  /** GD §6.4 — rage (Phase 2). */
  rage: {
    hpThreshold: 15, // rage when HP ≤ 15 (50% of max; changed 2026-10-12)
    transitionDuration: 1.0, // s, no attacks, no damage taken
    colorFade: 0.5, // s body color → rage color
    shakeAmplitude: 0.1, // m boss shake during the transition
    cameraShake: { amplitude: 0.2, duration: 0.6 } as Shake,
    speedMult: 1.4, // all boss movement speeds (chase, dash, shockwave, shard flight)
    telegraphMult: 0.6, // attack telegraphs only (not the Rebuke tell, not the Slam window)
    cooldown: 0.6, // s (tune)
  },

  /** GD §6.5a — optional rage upgrades. ALL OFF by default. */
  rageUpgrades: {
    doubleSlam: false,
    chargeUTurn: false,
    staggeredShards: false,
    doubleSlamDelay: 0.5, // s after the first impact (tune)
    doubleSlamHop: 0.5, // m
    doubleSlamVolume: 0.7, // × slam_impact volume for the second impact
    doubleSlamTellFlashes: 2, // shadow circle pulses during the telegraph
    uTurnTelegraph: 0.4, // s (tune)
    staggerExtraFlight: 0.3, // s extra flight time for wave 0's center shard (tune)
    staggerCenterPulseHz: 1,
    staggerSidePulseHz: 3,
  },

  /** GD §6.5 selection (2026-10-12): distance bands and weights. All (tune). */
  ai: {
    bands: [4.5, 8, 16], // m: extreme close | close | mid | far
    repeatKeep: 0.25, // weight kept by the attack used last time (the last two: 0)
    /** Weights per band [extreme close, close, mid, far]. */
    weights: {
      p1: {
        rebuke: [80, 0, 0, 0],
        slam: [8, 30, 20, 10],
        charge: [0, 10, 25, 35],
        rain: [4, 15, 20, 25],
        cone: [8, 45, 25, 0],
        beam: [0, 0, 10, 30],
      },
      rage: {
        rebuke: [80, 0, 0, 0],
        slam: [6, 20, 15, 5],
        charge: [0, 10, 20, 25],
        rain: [4, 15, 15, 20],
        cone: [10, 55, 30, 0],
        beam: [0, 0, 20, 50],
      },
    },
  },

  /** GD §6.5 E — Cone Flame Breath (2026-10-12). All (tune). */
  cone: {
    telegraph: 0.9, // s (P1)
    rageTelegraph: 0.7, // s (rage; not × the rage telegraph factor)
    angle: deg(110),
    rageAngle: deg(130),
    range: 12, // m
    rageRange: 13,
    blast: 0.25, // s damage window per blast (< the 0.35 s roll i-frames)
    rageBlasts: 2,
    blastGap: 0.7, // s between blast starts (rage double)
    recovery: 0.8, // s
    rageRecovery: 0.6,
    outlineOpacity: 0.35,
    flamesPerStep: 26, // particles per step during a blast (visual)
    mouthHeight: 2.0, // m
  },

  /** GD §6.5 F — Flame Beam (2026-10-12). All (tune). */
  beam: {
    charge: 1.0, // s
    rageCharge: 0.7,
    fire: 3.0, // s
    rageFire: 2.0,
    sweep: 1.0, // rad/s
    rageSweep: 2.4,
    length: 28, // m
    hitRadius: 0.5, // m from the beam segment to a hit sphere
    lateralDeadzone: 1.0, // m/s: below this the sweep side comes from the offset
    recovery: 0.5,
    rageRecovery: 0.4,
    height: 1.1, // m (beam axis above the ground)
    startOffset: 2.1, // m from the boss center (its face)
    radius: 0.35, // m visual core
  },

  /** GD §6.5 G — Meteor Shower (once, from the rage transition; 2026-10-12). All (tune). */
  meteor: {
    duration: 10, // s
    rate: 12, // meteors per second (dense)
    warning: 0.9, // s from the circle appearing to impact
    radius: 1.8, // m (= the rage Crown Rain radius)
    minSeparation: 2.0, // m between live targets
    tries: 12,
    pool: 24, // live meteors at once
    fallHeight: 26, // m
    fallOffset: 7, // m horizontal offset of the start point (slanted fall)
    soundGap: 0.15, // s minimum between impact sounds
  },

  /** GD §6.5 A — Cube Slam. */
  slam: {
    telegraph: 1.0, // s rise (rage ×0.6) (tune)
    riseHeight: 4, // m, ease-out
    hang: 0.15, // s
    drop: 0.2, // s, ease-in
    shadowRadius: 2.2, // m
    shadowOpacity: 0.5,
    impactShake: { amplitude: 0.35, duration: 0.4 } as Shake,
    ringStartRadius: 2.2, // m
    ringEndRadius: 14, // m
    ringSpeed: 8, // m/s (rage ×1.4 = 11.2) (tune)
    ringWidth: 1.0, // m (kill band = r ± (width/2 + player radius))
    ringHeight: 0.3, // m
    ringFadeStart: 0.8, // fraction of travel after which the ring fades out (tune, agent-chosen)
    ringSegments: 64, // tessellation (tune, agent-chosen)
    shadowLift: 0.02, // m above the floor (tune, agent-chosen)
    outlineWidth: 0.18, // m glowing telegraph outline (1.5b) (tune, agent-chosen)
    outlineOpacity: 0.9,
    outlinePulseHz: 3,
    doubleSlamFlashBoost: 0.4, // extra shadow opacity at the top of each tell flash (tune, agent-chosen)
    window: 2.0, // s punish window from the (last) impact (tune)
    windowCrownWobble: deg(10), // ± crown wobble while stuck
    windowCrownWobbleHz: 3,
  },

  /** GD §6.5 B — Royal Charge. */
  charge: {
    telegraph: 0.7, // s (rage ×0.6) (tune)
    recovery: 0.6, // s after the skid: a small punish window (tune)
    shakeAmplitude: 0.1, // m
    pulseFrequency: 6, // Hz red emissive pulse (tune, agent-chosen)
    minDistance: 6, // m: Charge is only valid when the player is farther than this
    pulseIntensity: 0.7, // red emissive at the top of a pulse (tune, agent-chosen)
    speed: 18, // m/s (rage ×1.4 = 25.2) (tune)
    maxDashTime: 2.0, // s
    stopRadius: 27, // m boss center radius
    skid: 0.3, // s to slow to 0
  },

  /** GD §6.5 C — Crown Rain (3 waves). */
  rain: {
    cast: 1.0, // s (rage ×0.6) (tune)
    waveGap: 0.4, // s between wave landings (tune)
    flightTime: 0.8, // s for wave 0 at speed ×1 (D4: / speed multiplier) (tune)
    leadTime: 0.5, // s: aim point = P + V × leadTime
    cage: { ring: 6, radius: 3.5 }, // + 1 center circle
    wall: { count: 5, spacing: 3.0 },
    scatter: { count: 12, minSpacing: 5.0, rageMinSpacing: 6.2, tries: 30 }, // rage spacing keeps 1.8 m gaps (2026-10-12)
    maxPerWave: 12,
    circleRadius: 1.2, // m
    rageCircleRadius: 1.8, // m: rage circles and kill radius (2026-10-12) (tune)
    circleOpacity: 0.5,
    circlePulseHz: 3, // (tune, agent-chosen)
    circlePulseDepth: 0.4, // opacity dips by up to this fraction (tune, agent-chosen)
    circleLift: 0.02, // m above the floor (tune, agent-chosen)
    hitRadius: 0.35, // m sphere
    spinRate: 8, // rad/s (visual) (tune, agent-chosen)
    launchHeight: 4.8, // m above the boss origin (crown top)
    landHeight: 0.3, // m (resting on the ground)
    landPuffPieces: 2, // debris cubes per landing shard
    castSquash: { x: 1.08, y: 0.9, z: 1.08 }, // body squash during the cast (tune, agent-chosen)
  },

  /** GD §7 — camera. */
  camera: {
    fov: 60, // degrees (three.js PerspectiveCamera convention)
    near: 0.1,
    far: 300,
    orbit: { radius: 14, height: 6, speed: 0.15, startAngle: 0, target: { x: 0, y: 2, z: 0 } as Vec3 },
    follow: {
      distance: 6.0,
      height: 3.2,
      closeThreshold: 5, // m player↔boss
      closeDistance: 7.5,
      closeHeight: 4.2,
      lookBlend: 0.4, // lerp(player, boss, 0.4)
      lookHeight: 1.2,
    },
    smoothing: 6, // lerp factor 1 − exp(−6 × dt)
    minY: 1.0,
  },

  /** GD §8 — arena and environment. */
  arena: {
    radius: 30,
    segments: 64,
    colorVariation: 0.06, // ± per vertex (vertex colors, no texture)
    outerRadius: 200,
    outerOffset: 0.01, // m below the arena
    edgeInner: 29.8,
    edgeOuter: 30.2,
    edgeLift: 0.005, // m above the floor (avoids z-fighting) (tune, agent-chosen)
    fogNear: 35, // m (1.5b night) (tune)
    fogFar: 110, // (tune)
  },

  /** GD §8 — lights (1.5b: moonlit dusk, torches). */
  lights: {
    hemisphereIntensity: 0.95, // (tune)
    moonPosition: { x: -14, y: 26, z: 12 } as Vec3,
    moonIntensity: 2.2, // (tune)
    shadowMapSize: 1024,
    shadowExtent: 35, // ± m around the origin
    shadowNear: 0.5, // m (tune, agent-chosen)
    shadowFar: 100, // m (tune, agent-chosen)
    shadowBias: -0.0005,
    exposure: 1.15, // ACES filmic tone mapping exposure (tune)
    torch: {
      count: 6,
      radius: 32, // m from the center: outside the arena wall
      intensity: 60, // point light (candela) (tune)
      range: 26, // m light distance (tune)
      decay: 2,
      flicker: 0.15, // ± intensity fraction (tune)
      flickerHz: [2.3, 5.7, 9.1] as [number, number, number], // summed sines (tune, agent-chosen)
      poleRadius: 0.08,
      poleHeight: 2.2,
      bowlTopRadius: 0.3, // (tune, agent-chosen)
      bowlBottomRadius: 0.14,
      bowlHeight: 0.25,
      flameHeight: 2.42, // m: particles start here, the light sits a little above
      lightHeight: 2.9,
    },
  },

  /** ASSETS.md §2 palette. */
  colors: {
    playerBody: 0x3a86ff,
    playerArms: 0x2b66c4,
    playerLegs: 0x1d3557,
    playerHead: 0xffd6a5,
    weapon: 0xced4da,
    swordGold: 0xd4a017,
    swordGrip: 0x5c3a21,
    belt: 0x6b4226,
    scabbard: 0x4a3426,
    boots: 0x3d2b1f,
    playerRim: 0x9db7ff,
    bossPhase1: 0x6a4c93,
    bossRage: 0xd62828,
    crown: 0xffc300,
    eyes: 0xffffff,
    pupils: 0x111111,
    shockwave: 0xff7b00,
    shockwaveCore: 0xffd27a,
    fireballCore: 0xffb347,
    fire: 0xff6a1a,
    flameCore: 0xfff1c1,
    scorch: 0x1a0f08,
    dust: 0x8a8f7a,
    rebukeRing: 0xffe066,
    flask: 0xf4a259,
    healFlash: 0xffd166,
    warning: 0xff3b30,
    slamShadow: 0x000000,
    arenaGrass: 0x6ab04c,
    outerField: 0x5e9e44,
    arenaEdge: 0x4a7f35,
    sky: 0x0b1020, // night (1.5b)
    hemisphereSky: 0x3b4a7a,
    hemisphereGround: 0x141a10,
    moon: 0xb8c4ff,
    torchLight: 0xff9a3c,
    torchPole: 0x3b2a1e,
    torchBowl: 0x2e2e33,
    uiGold: '#E0B84C',
    youDiedRed: '#A4161A',
    healthFull: '#C1121F',
    healthEmpty: 'rgba(0,0,0,0.5)',
    staminaFull: '#6BBF59',
    flaskHud: '#F4A259',
  },

  /** GD §8 (1.5b) — shared rim light (fresnel edge glow) on character materials. */
  rim: {
    power: 2.5, // fresnel exponent (tune, agent-chosen)
    playerStrength: 0.45, // (tune)
    bossStrength: 0.75, // (tune)
    bossTint: 0.45, // boss rim = body color lerped this far toward white (tune, agent-chosen)
  },

  /** 1.5b visual effects (ARCHITECTURE §4.6). Visual only. */
  vfx: {
    particles: {
      glowCapacity: 4096, // additive pool (tune, agent-chosen)
      smokeCapacity: 512, // alpha-blended pool (tune, agent-chosen)
      floor: 0.03, // m; particles never sink below this height
      glowSoftness: 0.0, // radial falloff start (0 = soft disc)
      smokeSoftness: 0.25,
    },
    /** GD §6.5 C burning marks. */
    burns: {
      capacity: 48, // marks in the ring buffer (2 overlapping Crown Rains)
      life: 3.0, // s
      fadeStart: 1.8, // s; smooth fade to 0 at `life` (tune)
      growTime: 0.12, // s pop-in (tune, agent-chosen)
      scorchRadius: 0.9, // m
      scorchAlpha: 0.8,
      lift: 0.025, // m above the floor
      flamesPerMark: 3,
      flameSpread: 0.45, // m max offset of a flame from the mark center (tune, agent-chosen)
      flameWidth: 0.45, // m (tune, agent-chosen)
      flameHeight: 0.75, // m (tune, agent-chosen)
      flameStagger: 0.05, // s between a mark's flames appearing (tune, agent-chosen)
    },
    /** Flat additive ground rings (Slam impact flash, heal ring). All (tune, agent-chosen). */
    flash: { pool: 4, innerRatio: 0.82, lift: 0.04 },
    /** GD §6.5 A impact burst (≈ 60 particles). All (tune, agent-chosen). */
    slamImpact: {
      count: 60,
      radius: 2.0, // m: spawned on the footprint edge
      emberSpeed: [5, 10] as Range,
      emberUp: [3, 7] as Range,
      emberLife: [0.4, 0.8] as Range,
      emberSize: 0.28,
      emberGravity: 12,
      dustSpeed: [3, 7] as Range,
      dustUp: [1, 3] as Range,
      dustLife: [0.8, 1.2] as Range,
      dustSize: [0.7, 1.6] as Range,
      dustGravity: 2,
      dustAlpha: 0.55,
      flashFrom: 1.5, // m ground flash ring radius
      flashTo: 5.0,
      flashTime: 0.3, // s
    },
    /** GD §6.5 A embers riding the shockwave front. (tune, agent-chosen) */
    ringEmbers: { perSecond: 110, up: [1, 3] as Range, life: [0.25, 0.4] as Range, size: 0.32, gravity: 6 },
    /** GD §6.5 C fireball trail. (tune, agent-chosen) */
    fireball: {
      coreRadius: 0.35, // m, unlit glowing core
      trailLife: [0.22, 0.34] as Range,
      trailSize: 0.85,
      smokeChance: 0.25, // per step
      smokeSize: [0.35, 0.9] as Range,
      smokeLife: 0.6,
      smokeAlpha: 0.35,
    },
    /** GD §6.5 C fireball explosion (≈ 14 sparks + flash + smoke). (tune, agent-chosen) */
    explosion: {
      sparks: 14,
      sparkSpeed: [2, 5] as Range,
      sparkUp: [3, 6] as Range,
      sparkLife: [0.35, 0.6] as Range,
      sparkSize: 0.3,
      sparkGravity: 10,
      flashLife: 0.18,
      flashSize: 2.2,
      smoke: 4,
      smokeUp: [0.8, 1.6] as Range,
      smokeLife: 0.9,
      smokeSize: [0.5, 1.3] as Range,
      smokeAlpha: 0.45,
    },
    /** GD §6.5 B dust behind the dash and skid. (tune, agent-chosen) */
    chargeDust: { perStep: 2, behind: 2.0, halfWidth: 1.8, speed: [1, 3] as Range, up: [0.5, 1.5] as Range, life: [0.5, 0.8] as Range, size: [0.6, 1.4] as Range, alpha: 0.5 },
    /** GD §4.3c heal aura (≈ 36 particles + ground ring). (tune, agent-chosen) */
    heal: {
      count: 36,
      radius: [0.45, 0.65] as Range,
      height: [0.2, 1.6] as Range,
      swirl: 0.9, // m/s tangential
      up: [1.2, 2.2] as Range,
      life: [0.8, 1.1] as Range,
      size: 0.2,
      gravity: -0.5,
      ringFrom: 0.3,
      ringTo: 1.6,
      ringTime: 0.4,
    },
    /** GD §8 torch flame particles. (tune, agent-chosen) */
    torch: { perSecond: 32, jitter: 0.18, up: [1.0, 1.6] as Range, life: [0.35, 0.55] as Range, size: 0.55 },
  },

  /** Physics and effects (ARCHITECTURE §5, GD §9). */
  fx: {
    gravity: 20, // m/s² for debris and shards
    debris: {
      bounce: 0.35, // v.y = −v.y × bounce on ground contact
      friction: 0.7, // v.xz ×= friction on ground contact
      angularDamping: 0.7, // angularVelocity ×= on ground contact
      sleepSpeed: 0.2, // m/s on the ground → sleep
    },
    /** GD §9 — player death timeline (from the hit). */
    death: {
      hitStop: 0.1, // s
      breakAt: 0.1, // s parts detach
      youDiedAt: 0.6, // s
      duration: 2.0, // s then TO_TITLE
      horizontalSpeed: [3, 6] as Range, // m/s away from the hit source
      upwardSpeed: [4, 7] as Range, // m/s
      maxSpin: 10, // rad/s
    },
    /** Small debris puffs (shard landing, hazards removed by a cancel). */
    puff: {
      pieces: 6, // per removed object (tune, agent-chosen)
      size: 0.15, // m (tune, agent-chosen)
      speed: [1, 3] as Range, // m/s (tune, agent-chosen)
      lifetime: 0.8, // s (tune, agent-chosen)
      pool: 96, // preallocated pieces (tune, agent-chosen)
    },
  },

  /** GD §2 — overlay (sizes in px unless noted; applied as CSS variables by ui.ts). */
  ui: {
    titleSize: 'min(9vw, 120px)',
    titleTop: '30%',
    startPromptSize: 24,
    blinkPeriod: 1.0, // s
    blinkMinOpacity: 0.3,
    controlsBoxSize: 18,
    healthBarWidth: 'min(60vw, 640px)',
    healthBarHeight: 14,
    healthLabelSize: 20,
    healthSegmentGap: 4,
    healthSegmentFlash: 0.15, // s white before turning empty
    controlsHintSize: 14,
    controlsHintOpacity: 0.7,
    soundIndicatorSize: 14,
    attemptsSize: 18,
    resultTextSize: 'min(10vw, 140px)',
    resultLetterSpacing: '0.1em',
    resultFadeIn: 0.5, // s
    resultScaleFrom: 1.1,
    youDiedDim: 0.55,
    victoryDim: 0.4,
    continuePromptSize: 20,
    pauseDim: 0.55,
    pauseTextSize: 28,
    debugRefreshHz: 4,
    rebukeMarker: 1.0, // s the debug "REBUKE (reason)" marker stays visible
    /** GD §2 player HUD. */
    hudEdge: 24, // px from the top-left edges
    pipSize: 22,
    pipGap: 6,
    pipBorder: 2,
    pipFlash: 0.15, // s
    flaskIconWidth: 14,
    flaskIconHeight: 22,
    flaskTextSize: 18,
    staminaWidth: 240,
    staminaHeight: 8,
    staminaFlash: 0.3, // s white flash when an action is refused
    /** ?debug hitbox wireframes (agent-chosen, debug only). */
    debugHitbox: {
      playerColor: 0x00ffff,
      bossColor: 0xffff00,
      attackColor: 0xff00ff, // blade points, shockwave band, shard spheres, Rebuke band
      bladePointRadius: 0.06, // m
      bandThickness: 0.005, // fraction of the radius
    },
  },

  /** GD §1 — state transitions (real time unless noted). */
  transitions: {
    fadeOut: 0.6, // s black 0 → 1, ease-in-out (tune)
    fadeIn: 0.8, // s black 1 → 0, ease-in-out (tune)
    titleInputLock: 0.5, // s after the fade-in ends (tune)
    audioDuck: 0.3, // master volume fraction during the fade
    victoryInputLock: 1.0, // s
    victoryIdleReturn: 8, // s with no input → TO_TITLE
    titleOverlayFade: 0.3, // s
    hudFade: 0.3, // s
    cameraBlend: 0.8, // s orbit → lock-on, ease-in-out
  },

  /** GD §10 + ASSETS.md §1.1 — audio. */
  audio: {
    masterVolume: 0.8, // 0 when muted
    /** GD §10 background music (1.5c): fight only, sped up for a funny tone. */
    bgm: {
      volume: 0.35, // relative to the sound effects (tune)
      rate: 1.12, // playback rate: faster and ≈ +2 semitones (tune)
      fadeIn: 0.5, // s at fight start (tune)
      fadeOut: 1.5, // s on death or victory (tune)
      pausedLevel: 0.3, // × volume while paused
    },
    swingPitchJitter: [0.88, 1.14] as Range, // × pitch, random on every swing (1.5d) (tune)
    footstepInterval: 0.3, // s while walking (not rolling)
    footstepMinSpeed: 1, // m/s
    /** Relative loudness per sound ID (ASSETS.md §1.1); a sound file plays at this gain. */
    volume: {
      swing: 0.5,
      hit: 0.9,
      swing_ground: 0.4,
      roll: 0.4,
      roll_end: 0.35,
      footstep: 0.12,
      slam_rise: 0.25,
      slam_impact: 1.0,
      charge_windup: 0.3,
      charge_dash: 0.5,
      shard_launch: 0.4,
      shard_land: 0.3,
      rage: 0.5,
      player_break: 0.6,
      you_died: 0.8,
      boss_break: 0.9,
      victory: 0.4,
      rebuke_windup: 0.45,
      rebuke_burst: 0.7,
      player_hurt: 0.7,
      flask_drink: 0.4,
      flask_heal: 0.4,
    },
  },

  /** GD §11 — ?easy multipliers. */
  easy: {
    speedMult: 0.75, // boss movement speeds
    telegraphMult: 1.3,
    cooldownMult: 1.3,
  },
};

export type Config = DeepReadonly<typeof RAW>;

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object' && !Object.isFrozen(obj)) {
    for (const value of Object.values(obj)) deepFreeze(value);
    Object.freeze(obj);
  }
  return obj;
}

export const CONFIG: Config = deepFreeze(RAW);

/** The rage-upgrade switches, so attacks can receive them (and tests can override them). */
export type RageUpgrades = Config['rageUpgrades'];
