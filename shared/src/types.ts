export type Team = 'red' | 'blue';
export type ClassType = 'infantry' | 'musician' | 'medic';
export type Instrument = 'fife' | 'drum';

export type Phase = 'lobby' | 'countdown' | 'battle' | 'retreat' | 'results';
export type RetreatStage = 'fixing' | 'charge';

// What a player is doing right now, as replicated to everyone.
export type PlayerStatus =
  | 'active'
  | 'dbno' // down but not out, crawling
  | 'out' // bayoneted during the retreat
  | 'escaped'; // fled the field during the retreat

export interface LobbyPlayer {
  id: string;
  name: string;
  team: Team | null;
  cls: ClassType | null;
  instrument: Instrument | null;
  ready: boolean;
  inRound: boolean; // currently participating in a live round
}

// Compact per-player snapshot entry.
export interface SnapPlayer {
  id: string;
  x: number;
  z: number;
  yaw: number;
  st: PlayerStatus;
  ld: 0 | 1; // musket loaded (infantry only)
  rl: 0 | 1; // busy reloading
  rv: 0 | 1; // medic busy doing a revive QTE
  tr: 0 | 1; // held by a bear trap
  dbnoEnd: number; // server time the NPC healer arrives (0 if n/a)
  ack: number; // last input seq the server has applied for this player
}

export interface TeamSnap {
  fife: number; // 0..1 inspiration
  drum: number;
  tethers: number[]; // 1 = broken, index matches lineOrder pairs
  spreadMult: number; // current musket spread multiplier from music
}

export interface Snapshot {
  t: number; // server time ms
  players: SnapPlayer[];
  red: TeamSnap;
  blue: TeamSnap;
}

// Sent at round start so clients know the line and tether pairs.
export interface RoundSetup {
  // Left-to-right ids of the men in each line (musicians at the ends).
  lineOrder: Record<Team, string[]>;
  participants: RoundParticipant[];
}

export interface RoundParticipant {
  id: string;
  name: string;
  team: Team;
  cls: ClassType;
  instrument: Instrument | null;
  x: number;
  z: number;
  yaw: number;
}

export interface RoundStats {
  winner: Team;
  loser: Team;
  downs: Record<string, number>; // by player id
  revives: Record<string, number>;
  notes: Record<string, number>;
  bayonetTags: Record<string, number>;
  escaped: string[];
  caught: string[];
  names: Record<string, string>;
}
