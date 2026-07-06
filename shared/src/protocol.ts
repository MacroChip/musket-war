import type {
  ClassType,
  Instrument,
  LobbyPlayer,
  Phase,
  RetreatStage,
  RoundSetup,
  RoundStats,
  Snapshot,
  Team,
} from './types';

// ---------- client -> server ----------

// One predicted simulation step. The client applies these locally every frame
// and ships them to the server in small batches; the server replays them.
export interface InputStep {
  seq: number;
  dt: number; // seconds, clamped server-side
  mx: number; // strafe -1..1
  my: number; // forward -1..1
  yaw: number;
  pitch: number;
}

export type ClientMsg =
  | { type: 'hello'; name: string }
  | { type: 'join_team'; team: Team }
  | { type: 'choose_class'; cls: ClassType; instrument?: Instrument }
  | { type: 'ready'; ready: boolean }
  | { type: 'input'; steps: InputStep[] }
  | { type: 'fire'; yaw: number; pitch: number }
  | { type: 'reload_start' }
  | { type: 'reload_cancel' }
  | { type: 'reload_done' }
  | { type: 'note_hit'; idx: number; grade: 'good' | 'perfect' }
  | { type: 'revive_start'; target: string }
  | { type: 'revive_cancel' }
  | { type: 'revive_done'; target: string }
  | { type: 'lay_trap' }
  // Anyone in the lobby may muster or dismiss AI soldiers for either team.
  | { type: 'add_bot'; team: Team; cls?: ClassType }
  | { type: 'remove_bot'; id: string };

// ---------- server -> client ----------

export type ServerMsg =
  | { type: 'welcome'; id: string; name: string; t: number }
  | { type: 'error'; msg: string }
  | { type: 'lobby'; players: LobbyPlayer[]; phase: Phase }
  | {
      type: 'phase';
      phase: Phase;
      endsAt?: number; // countdown/results
      setup?: RoundSetup; // countdown
      stats?: RoundStats; // results
      retreatTeam?: Team; // retreat
      stage?: RetreatStage;
    }
  | { type: 'retreat_stage'; stage: RetreatStage } // whistle blows -> 'charge'
  | { type: 'snap'; snap: Snapshot }
  // A musket was triggered: spark now, bang comes FIRE_FLASH_DELAY_MS later.
  | { type: 'primed'; id: string }
  | {
      type: 'shot';
      id: number; // projectile id
      shooter: string;
      ox: number; oy: number; oz: number;
      vx: number; vy: number; vz: number;
    }
  | { type: 'proj_end'; id: number; x: number; y: number; z: number; hit: string | null }
  | { type: 'downed'; id: string; by: string | null }
  | { type: 'revived'; id: string; by: string | null; auto: boolean }
  | { type: 'revive_begin'; medic: string; target: string }
  | { type: 'revive_abort'; medic: string }
  | { type: 'note'; team: Team; instrument: Instrument; idx: number; grade: 'good' | 'perfect' }
  | { type: 'trap'; id: number; x: number; z: number; team: Team; armAt: number }
  | { type: 'trap_sprung'; id: number; victim: string }
  | { type: 'tagged'; id: string; by: string }
  | { type: 'escaped'; id: string }
  | { type: 'announce'; text: string; sting?: boolean };

export function parseClientMsg(raw: string): ClientMsg | null {
  try {
    const msg = JSON.parse(raw);
    if (msg && typeof msg.type === 'string') return msg as ClientMsg;
  } catch {
    /* malformed message from a friend's flaky wifi — drop it */
  }
  return null;
}
