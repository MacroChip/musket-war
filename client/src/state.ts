import type {
  Phase,
  RetreatStage,
  RoundParticipant,
  RoundSetup,
  RoundStats,
  LobbyPlayer,
  SnapPlayer,
  Snapshot,
  Team,
} from '../../shared/src/types';

/**
 * One mutable bag of client state. Modules read and write it directly —
 * this is a small game, not an enterprise; keeping it flat keeps it honest.
 */
export const S = {
  myId: '',
  myName: '',
  connected: false,

  phase: 'lobby' as Phase,
  phaseEndsAt: 0,
  lobbyPlayers: [] as LobbyPlayer[],

  setup: null as RoundSetup | null,
  participants: new Map<string, RoundParticipant>(),
  retreatTeam: null as Team | null,
  retreatStage: 'fixing' as RetreatStage,
  stats: null as RoundStats | null,

  snaps: [] as Snapshot[], // rolling buffer for interpolation
  latest: null as Snapshot | null,
  timeOffset: null as number | null, // serverTime - Date.now()

  // Local, client-owned flags (mirrored server-side by explicit messages).
  reloading: false,
  reviving: false,
  reviveTarget: null as string | null,
};

export function serverNow(): number {
  return Date.now() + (S.timeOffset ?? 0);
}

export function noteServerTime(t: number): void {
  const sample = t - Date.now();
  S.timeOffset = S.timeOffset === null ? sample : S.timeOffset + (sample - S.timeOffset) * 0.1;
}

export function pushSnapshot(snap: Snapshot): void {
  noteServerTime(snap.t);
  S.snaps.push(snap);
  if (S.snaps.length > 40) S.snaps.splice(0, S.snaps.length - 40);
  S.latest = snap;
}

export function mySnap(): SnapPlayer | null {
  return S.latest?.players.find((p) => p.id === S.myId) ?? null;
}

export function myParticipant(): RoundParticipant | null {
  return S.participants.get(S.myId) ?? null;
}

export function myTeam(): Team | null {
  return myParticipant()?.team ?? S.lobbyPlayers.find((p) => p.id === S.myId)?.team ?? null;
}

export function inRound(): boolean {
  return (
    (S.phase === 'countdown' || S.phase === 'battle' || S.phase === 'retreat') &&
    S.participants.has(S.myId)
  );
}

export function clearRound(): void {
  S.setup = null;
  S.participants.clear();
  S.snaps.length = 0;
  S.latest = null;
  S.retreatTeam = null;
  S.reloading = false;
  S.reviving = false;
  S.reviveTarget = null;
}
