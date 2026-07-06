// All gameplay tuning lives here so both server and client agree on the rules.

export const TICK_RATE = 45; // server simulation ticks per second
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY_N_TICKS = 2; // ~22.5 snapshots/sec, clients interpolate
export const INTERP_DELAY_MS = 130; // how far in the past remote players are rendered

// Field layout. X is along the battle lines, Z is between them.
export const FIELD_HALF_X = 42;
export const FIELD_HALF_Z = 46;
export const LINE_Z = 20; // blue line at -LINE_Z, red line at +LINE_Z
export const ESCAPE_Z = 43; // retreaters crossing this (on their home side) escape
export const LINE_SPACING = 4; // meters between men in the line
export const MEDIC_BACK_OFFSET = 6; // medics start behind the line

// Movement
export const WALK_SPEED = 6;
export const CRAWL_SPEED = 1.9; // down-but-not-out crawl
export const CHARGE_SPEED = 10.5; // bayonet charge auto-sprint
export const CHARGE_TURN_RATE = 1.7; // rad/sec of steering while charging
export const RETREAT_SPEED = 7.2; // fleeing men get a fear bonus
export const PLAYER_RADIUS = 0.55;

// Formation tethers
export const TETHER_MAX_DIST = 7.5; // beyond this a tether is broken
export const TETHER_WARN_DIST = 5.5; // UI starts warning here
export const FORMATION_BREAK_FRACTION = 0.5; // >=50% broken => rout

// Musket
export const MUZZLE_SPEED = 62;
export const PROJ_GRAVITY = 12; // exaggerated drop so arcs read at this scale
export const PROJ_LIFETIME_MS = 2600;
export const FIRE_FLASH_DELAY_MS = 260; // spark in the pan ... then BANG
export const MUZZLE_HEIGHT = 1.5;
export const HIT_CENTER_Y = 1.25; // standing hit sphere center
export const HIT_RADIUS = 0.72; // generous — muskets are mean, aiming is not
export const SPREAD_BASE_DEG = 4.4; // musket ring aimer base half-angle
export const SPREAD_MOVING_MULT = 1.55; // walking makes it worse
export const AIM_REF_DISTANCE = 40; // for translating spread to a screen ring

// Music inspiration buff. Each instrument holds a 0..1 meter that decays;
// each meter shrinks the team's spread by up to SPREAD_REDUCTION_PER_INSTRUMENT.
export const SPREAD_REDUCTION_PER_INSTRUMENT = 0.28;
export const BUFF_PER_NOTE_GOOD = 0.16;
export const BUFF_PER_NOTE_PERFECT = 0.28;
export const BUFF_DECAY_PER_SEC = 0.09;

// Down But Not Out
export const DBNO_AUTO_RES_MS = 25_000; // the circuit-riding NPC healer arrives
export const REVIVE_RANGE = 2.8; // medic must be this close to start/finish
export const REVIVE_TIMEOUT_MS = 25_000; // server gives up on a stuck QTE

// Retreat sequence
export const FIX_BAYONETS_MS = 2600; // pursuers stand still fixing bayonets
export const TRAPS_PER_RETREATER = 2;
export const TRAP_ARM_MS = 900;
export const TRAP_RADIUS = 1.0;
export const TRAP_HOLD_MS = 4200; // how long a sprung trap holds a pursuer
export const BAYONET_REACH = 1.15; // tip extends this far past the body
export const BAYONET_TAG_RADIUS = 0.9;
export const RETREAT_TIMEOUT_MS = 60_000; // stragglers are considered escaped

// Round flow
export const COUNTDOWN_MS = 3500;
export const RESULTS_MS = 10_000;

// Input
export const MAX_INPUT_DT_MS = 60; // clamp any single input step
export const INPUT_SEND_RATE = 30; // client -> server input packets per second
