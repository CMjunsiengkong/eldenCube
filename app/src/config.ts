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
    accel: 10, // m/s² toward desired velocity with input (tune)
    decel: 4, // m/s² without input → sliding stop (tune)
    turnRate: 4, // rad/s (tune)
    faceMoveMinSpeed: 0.5, // m/s; above this (with input) face the movement direction
    radius: 0.4, // m; arena wall clamp uses arenaRadius − radius = 29.6
    bossPushSpeed: 4, // m/s outward velocity after boss body contact (tune)
    /** GD §4.5: the ONLY shapes that can kill the player. */
    hitSpheres: [
      { height: 0.5, radius: 0.4 }, // m above the feet
      { height: 1.3, radius: 0.4 },
    ],
    /** GD §4.1 model (positions relative to the root, feet at y = 0; +Z = forward). */
    model: {
      roughness: 0.8,
      metalness: 0,
      rollPivotHeight: 0.9, // m
      body: { size: { x: 0.6, y: 0.8, z: 0.35 }, center: { x: 0, y: 1.0, z: 0 } },
      neckPivot: { x: 0, y: 1.4, z: 0 },
      head: { radius: 0.25, offset: { x: 0, y: 0.3, z: 0 } }, // offset from the neck pivot
      eyes: { radius: 0.04, offset: { x: 0.09, y: 0.05, z: 0.22 } }, // ±x, relative to the head
      shoulderPivot: { x: 0.4, y: 1.35, z: 0 }, // ±x
      arm: { size: { x: 0.16, y: 0.6, z: 0.16 }, offset: { x: 0, y: -0.3, z: 0 } },
      hipPivot: { x: 0.15, y: 0.6, z: 0 }, // ±x
      leg: { size: { x: 0.2, y: 0.6, z: 0.2 }, offset: { x: 0, y: -0.3, z: 0 } },
      weapon: { size: { x: 0.12, y: 1.6, z: 0.06 }, offset: { x: 0, y: -1.3, z: 0 } }, // on the right shoulder pivot
      sphereSegments: 16, // head/eye tessellation (visual only) (tune, agent-chosen)
    },
  },

  /** GD §4.3 — swing angle θ on the right shoulder pitch: 0 = down, 90° = forward, 180° = up. */
  swing: {
    restAngle: deg(20),
    windup: { duration: 0.2, toAngle: deg(200) }, // ease-out (tune)
    active: { duration: 0.15, toAngle: deg(70), lungeSpeed: 10 }, // ease-in; m/s along facing (tune)
    recovery: { duration: 0.4, toAngle: deg(20) }, // ease-in-out (tune)
    bladePoints: [0.5, 1.3, 2.1], // m from the shoulder (GD §5)
  },

  /** GD §4.3a — roll (Space). */
  roll: {
    distance: 4.0, // m (tune)
    duration: 0.55, // s, ease-out displacement (tune)
    iFrameStart: 0.05, // s after the roll starts (tune)
    iFrameEnd: 0.4, // s after the roll starts → 0.35 s of i-frames (tune)
    turnRateMult: 3, // × player.turnRate toward the roll direction
    recoveryDuration: 0.25, // s dizzy recovery (tune)
    recoverySpeed: 2, // m/s initial velocity in the recovery, decays at decel
    recoverySway: deg(8), // ± body sway
    recoverySwayCycles: 1, // full side-to-side sways during the recovery (tune, agent-chosen)
    cooldown: 0.15, // s after the recovery before a new roll (tune)
    somersault: Math.PI * 2, // one full forward flip over `duration`, ease-in-out
    tuckAngle: deg(70), // limb spring target during the roll
    debugTint: 0.3, // ?debug: 30% white while invincible
  },

  /** GD §4.4 — visual wobble (no gameplay effect). */
  wobble: {
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
  },

  /** GD §6 — The Elden Cube. */
  boss: {
    hp: 5, // (tune)
    spawn: { x: 0, y: 0, z: 0 }, // facing +Z
    halfSize: 2.0, // m, hit box (yaw-only)
    grace: 2.0, // s before the first attack (tune)
    bobAmplitude: 0.08, // m (visual)
    bobFrequency: 1.2, // Hz
    turnRate: 2.0, // rad/s (tune)
    chaseDistance: 7, // m; chase when farther (tune)
    chaseSpeed: 1.5, // m/s (tune)
    cooldown: 2.5, // s Phase 1 (tune)
    invulnerability: 0.4, // s after a hit (tune)
    clampRadius: 27, // m (ARCHITECTURE §5.3)
    /** GD §6.3 hit reaction. */
    hit: {
      hitStop: 0.08, // s
      flashDuration: 0.1, // s white emissive
      squash: { x: 1.15, y: 0.85, z: 1.15 },
      squashReturn: 0.25, // s spring back to (1,1,1)
      squashWobbles: 1, // damped oscillations while springing back (tune, agent-chosen)
      knockback: 0.3, // m away from the player (skipped during a Charge dash)
      shake: { amplitude: 0.15, duration: 0.2 } as Shake,
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
      shake: { amplitude: 0.4, duration: 0.5 } as Shake,
      timeScale: 0.5,
      timeScaleDuration: 1.0, // s
      victoryDelay: 1.5, // s (simulation time) until VICTORY_SCREEN
    },
    /** GD §6.1 model (boss local; +Z = the face that looks at the player). */
    model: {
      bodySize: 4, // m cube
      bodyCenterY: 2,
      crownBand: { radius: 1.4, height: 0.4, sides: 5, y: 4.2, metalness: 0.6, roughness: 0.3 },
      crownPoint: { radius: 0.3, height: 0.8, y: 4.8, count: 5, segments: 8 }, // segments: tessellation (tune, agent-chosen)
      eye: { size: { x: 0.7, y: 0.7, z: 0.1 }, position: { x: 0.8, y: 2.6, z: 2.01 } }, // ±x
      pupil: { size: { x: 0.3, y: 0.3, z: 0.1 }, position: { x: 0.8, y: 2.5, z: 2.06 } }, // ±x
      eyebrow: { size: { x: 1.0, y: 0.18, z: 0.1 }, position: { x: 0.8, y: 3.15, z: 2.06 }, tilt: deg(20) },
      roughness: 0.8,
    },
  },

  /** GD §6.2a — boss tactics. */
  tactics: {
    closeDistance: 4.0, // m horizontal to the boss center (tune)
    closeTrigger: 3.0, // s of close timer that forces Slam/Shards (tune)
    noRepeat: 2, // the same attack may not be chosen after this many in a row
    closeDecayMult: 2, // timer decreases at 2 × dt while not close
    annoyedBobAmplitude: 0.16, // m (tell)
    punishDistance: 5.0, // m (tune)
    punishReduction: 0.8, // s taken off the remaining cooldown (fixed, not scaled by ?easy)
    punishFloor: 0.3, // s minimum remaining cooldown (fixed)
    glareDuration: 0.5, // s (tell)
    glareBrowTilt: deg(10), // extra eyebrow tilt
    glarePupilScale: 0.7,
  },

  /** GD §6.4 — rage (Phase 2). */
  rage: {
    hpThreshold: 2, // rage when HP ≤ 2 (immediately after the 3rd hit)
    transitionDuration: 1.0, // s, no attacks, no damage taken
    colorFade: 0.5, // s body color → rage color
    shakeAmplitude: 0.1, // m boss shake during the transition
    cameraShake: { amplitude: 0.2, duration: 0.6 } as Shake,
    speedMult: 1.4, // all boss movement speeds (chase, dash, shockwave, shard flight)
    telegraphMult: 0.6,
    cooldown: 1.6, // s (tune)
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
    staggerExtraFlight: 0.3, // s extra flight time for the center shard (tune)
    staggerCenterPulseHz: 1,
    staggerSidePulseHz: 3,
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
    doubleSlamFlashBoost: 0.4, // extra shadow opacity at the top of each tell flash (tune, agent-chosen)
  },

  /** GD §6.5 B — Royal Charge. */
  charge: {
    telegraph: 1.0, // s (rage ×0.6) (tune)
    shakeAmplitude: 0.1, // m
    pulseFrequency: 6, // Hz red emissive pulse (tune, agent-chosen)
    minDistance: 6, // m: Charge is only valid when the player is farther than this
    pulseIntensity: 0.7, // red emissive at the top of a pulse (tune, agent-chosen)
    speed: 18, // m/s (rage ×1.4 = 25.2) (tune)
    maxDashTime: 2.0, // s
    stopRadius: 27, // m boss center radius
    skid: 0.3, // s to slow to 0
  },

  /** GD §6.5 C — Crown Shards. */
  shards: {
    telegraph: 1.0, // s (rage ×0.6) (tune)
    count: 3,
    circleRadius: 1.2, // m
    circleOpacity: 0.5,
    circlePulseHz: 3, // warning circle pulse rate (tune, agent-chosen; GD gives 3 Hz only for the staggered tell)
    circlePulseDepth: 0.4, // opacity dips by up to this fraction while pulsing (tune, agent-chosen)
    circleLift: 0.02, // m above the floor (avoids z-fighting) (tune, agent-chosen)
    leadTime: 0.5, // s: center = P + V × leadTime
    sideOffset: 2.5, // m perpendicular to boss→player
    size: 0.6, // m cube
    hitRadius: 0.35, // m sphere
    flightTime: 0.8, // s at speed ×1 (rage: 0.8 / 1.4 ≈ 0.57) (tune)
    spinRate: 8, // rad/s (visual) (tune, agent-chosen)
    launchHeight: 4.8, // m above the boss origin (crown top)
    landHeight: 0.3, // m (resting on the ground)
    puffPieces: 6, // small debris cubes on landing / on cancel (tune, agent-chosen)
    puffSize: 0.15, // m (tune, agent-chosen)
    puffSpeed: [1, 3] as Range, // m/s (tune, agent-chosen)
    puffLifetime: 0.8, // s before puff pieces disappear (tune, agent-chosen)
    puffPool: 48, // preallocated puff pieces (8 puffs of 6) (tune, agent-chosen)
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
    fogNear: 60,
    fogFar: 180,
  },

  /** GD §8 — lights. */
  lights: {
    hemisphereIntensity: 1.0, // (tune)
    sunPosition: { x: 10, y: 20, z: 8 } as Vec3,
    sunIntensity: 2.0, // (tune)
    shadowMapSize: 1024,
    shadowExtent: 35, // ± m around the origin
    shadowNear: 0.5, // m (tune, agent-chosen)
    shadowFar: 100, // m (tune, agent-chosen)
    shadowBias: -0.0005,
  },

  /** ASSETS.md §2 palette. */
  colors: {
    playerBody: 0x3a86ff,
    playerArms: 0x2b66c4,
    playerLegs: 0x1d3557,
    playerHead: 0xffd6a5,
    weapon: 0xced4da,
    bossPhase1: 0x6a4c93,
    bossRage: 0xd62828,
    crown: 0xffc300,
    eyes: 0xffffff,
    pupils: 0x111111,
    shockwave: 0xff7b00,
    warning: 0xff3b30,
    slamShadow: 0x000000,
    arenaGrass: 0x6ab04c,
    outerField: 0x5e9e44,
    arenaEdge: 0x4a7f35,
    sky: 0xbfe3ff,
    hemisphereSky: 0xffffff,
    hemisphereGround: 0x557733,
    sun: 0xffffff,
    uiGold: '#E0B84C',
    youDiedRed: '#A4161A',
    healthFull: '#C1121F',
    healthEmpty: 'rgba(0,0,0,0.5)',
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
    punishMarker: 1.0, // s the debug "PUNISH!" marker stays visible
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
