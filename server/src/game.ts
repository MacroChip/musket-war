import type { WebSocket } from 'ws';
import {
  BAYONET_REACH,
  BAYONET_TAG_RADIUS,
  BOT_AIM_ERROR_DEG,
  BOT_DRESS_DEADZONE,
  BOT_DRESS_EASE_DIST,
  BOT_FIRE_RANGE,
  BOT_RELOAD_JITTER_MS,
  BOT_RELOAD_MS,
  BOT_REVIVE_MS,
  BOT_TRAP_INTERVAL_MS,
  BUFF_DECAY_PER_SEC,
  BUFF_PER_NOTE_GOOD,
  BUFF_PER_NOTE_PERFECT,
  COUNTDOWN_MS,
  DBNO_AUTO_RES_MS,
  ESCAPE_Z,
  FIELD_HALF_X,
  FIELD_HALF_Z,
  FIRE_FLASH_DELAY_MS,
  FIX_BAYONETS_MS,
  FORMATION_BREAK_FRACTION,
  HIT_CENTER_Y,
  HIT_RADIUS,
  LINE_SPACING,
  LINE_Z,
  MAX_BOTS,
  MAX_INPUT_DT_MS,
  MEDIC_BACK_OFFSET,
  MUZZLE_HEIGHT,
  MUZZLE_SPEED,
  PROJ_GRAVITY,
  PROJ_LIFETIME_MS,
  RESULTS_MS,
  RETREAT_TIMEOUT_MS,
  REVIVE_RANGE,
  REVIVE_TIMEOUT_MS,
  SNAPSHOT_EVERY_N_TICKS,
  SPREAD_BASE_DEG,
  SPREAD_MOVING_MULT,
  SPREAD_REDUCTION_PER_INSTRUMENT,
  TETHER_MAX_DIST,
  TETHER_WARN_DIST,
  TICK_MS,
  TRAPS_PER_RETREATER,
  TRAP_ARM_MS,
  TRAP_HOLD_MS,
  TRAP_RADIUS,
} from '../../shared/src/constants';
import { clamp, deg2rad, dist2d } from '../../shared/src/math';
import { stepBody, type MoveMode } from '../../shared/src/movement';
import type { ClientMsg, InputStep, ServerMsg } from '../../shared/src/protocol';
import type {
  ClassType,
  Instrument,
  LobbyPlayer,
  Phase,
  PlayerStatus,
  RetreatStage,
  RoundSetup,
  RoundStats,
  SnapPlayer,
  Team,
  TeamSnap,
} from '../../shared/src/types';

const now = () => Date.now();

interface Player {
  id: string;
  name: string;
  ws: WebSocket | null; // null for AI soldiers — the server plays their hand
  bot: boolean;
  joinedAt: number;
  // lobby
  team: Team | null;
  cls: ClassType | null;
  instrument: Instrument | null;
  ready: boolean;
  inRound: boolean;
  // round state
  x: number;
  z: number;
  yaw: number;
  status: PlayerStatus;
  loaded: boolean;
  reloading: boolean;
  reviving: boolean;
  reviveTarget: string | null;
  reviveStartedAt: number;
  beingRevivedBy: string | null;
  dbnoEnd: number;
  trappedUntil: number;
  trapsLeft: number;
  moving: boolean; // last input had movement (widens spread)
  pendingSteps: InputStep[];
  lastSeq: number;
  fireAt: number; // scheduled bang time, 0 if none
  fireYaw: number;
  firePitch: number;
  lastNoteAt: number;
  // bot brain
  botActionAt: number; // when the current timed ritual (reload/revive) completes
  botNextTrapAt: number; // earliest moment to drop the next bear trap
}

interface Projectile {
  id: number;
  shooter: string;
  team: Team;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  diesAt: number;
}

interface Trap {
  id: number;
  x: number;
  z: number;
  team: Team; // who laid it (harms the other team)
  armAt: number;
  sprung: boolean;
}

const otherTeam = (t: Team): Team => (t === 'red' ? 'blue' : 'red');

export class Game {
  private players = new Map<string, Player>();
  private phase: Phase = 'lobby';
  private phaseEndsAt = 0;
  private retreatTeam: Team | null = null;
  private retreatStage: RetreatStage = 'fixing';
  private retreatChargeEndsAt = 0;
  private lineOrder: Record<Team, string[]> = { red: [], blue: [] };
  private lastSetup: RoundSetup | null = null;
  private projectiles: Projectile[] = [];
  private traps: Trap[] = [];
  private nextProjId = 1;
  private nextTrapId = 1;
  private buffs: Record<Team, { fife: number; drum: number }> = {
    red: { fife: 0, drum: 0 },
    blue: { fife: 0, drum: 0 },
  };
  private tetherBroken: Record<Team, number[]> = { red: [], blue: [] };
  private tickCount = 0;
  private lastTickAt = now();
  private stats: RoundStats = emptyStats();

  // ---------- connection lifecycle ----------

  addPlayer(ws: WebSocket, name: string): Player {
    const id = `p${Math.random().toString(36).slice(2, 8)}`;
    const clean = (name || '').trim().slice(0, 16) || 'Minuteman';
    const p: Player = {
      id, name: this.dedupeName(clean), ws, bot: false, joinedAt: now(),
      team: null, cls: null, instrument: null, ready: false, inRound: false,
      x: 0, z: 0, yaw: 0, status: 'active', loaded: false, reloading: false,
      reviving: false, reviveTarget: null, reviveStartedAt: 0, beingRevivedBy: null,
      dbnoEnd: 0, trappedUntil: 0, trapsLeft: 0, moving: false,
      pendingSteps: [], lastSeq: 0, fireAt: 0, fireYaw: 0, firePitch: 0, lastNoteAt: 0,
      botActionAt: 0, botNextTrapAt: 0,
    };
    this.players.set(id, p);
    this.send(p, { type: 'welcome', id, name: p.name, t: now() });
    // Late joiners need to know what they're looking at.
    if (this.phase !== 'lobby' && this.lastSetup) {
      this.send(p, {
        type: 'phase', phase: this.phase, endsAt: this.phaseEndsAt, setup: this.lastSetup,
        retreatTeam: this.retreatTeam ?? undefined,
        stage: this.phase === 'retreat' ? this.retreatStage : undefined,
      });
      for (const t of this.traps) {
        this.send(p, { type: 'trap', id: t.id, x: t.x, z: t.z, team: t.team, armAt: t.armAt });
      }
    }
    this.broadcastLobby();
    return p;
  }

  private addBot(team: Team, cls: 'infantry' | 'medic'): Player {
    const id = `b${Math.random().toString(36).slice(2, 8)}`;
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!;
    const p: Player = {
      id, name: this.dedupeName(name), ws: null, bot: true, joinedAt: now(),
      team, cls, instrument: null, ready: true, inRound: false,
      x: 0, z: 0, yaw: 0, status: 'active', loaded: false, reloading: false,
      reviving: false, reviveTarget: null, reviveStartedAt: 0, beingRevivedBy: null,
      dbnoEnd: 0, trappedUntil: 0, trapsLeft: 0, moving: false,
      pendingSteps: [], lastSeq: 0, fireAt: 0, fireYaw: 0, firePitch: 0, lastNoteAt: 0,
      botActionAt: 0, botNextTrapAt: 0,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (p.inRound) {
      this.cancelReviveBy(p);
      if (p.beingRevivedBy) this.abortReviveOf(p);
      for (const team of ['red', 'blue'] as Team[]) {
        this.lineOrder[team] = this.lineOrder[team].filter((x) => x !== id);
      }
      if (this.phase === 'countdown' || this.phase === 'battle' || this.phase === 'retreat') {
        const remaining = (t: Team) =>
          [...this.players.values()].filter((q) => q.inRound && q.team === t).length;
        if (p.team && remaining(p.team) === 0) {
          this.announce(`${p.team.toUpperCase()} has quit the field entirely!`, true);
          this.endRound(otherTeam(p.team));
        }
      }
    }
    // With the last human gone there is nobody left to fight for — dismiss
    // the AI soldiers so an empty server doesn't wage war with itself.
    if (![...this.players.values()].some((q) => !q.bot)) {
      this.players.clear();
      this.phase = 'lobby';
      this.lastSetup = null;
      this.projectiles = [];
      this.traps = [];
      this.retreatTeam = null;
    }
    this.broadcastLobby();
    this.maybeStartRound();
  }

  private dedupeName(name: string): string {
    let candidate = name;
    let n = 2;
    while ([...this.players.values()].some((p) => p.name === candidate)) {
      candidate = `${name} ${n++}`;
    }
    return candidate;
  }

  // ---------- message handling ----------

  handleMessageById(id: string, msg: ClientMsg): void {
    const p = this.players.get(id);
    if (p) this.handleMessage(p, msg);
  }

  handleMessage(p: Player, msg: ClientMsg): void {
    switch (msg.type) {
      case 'hello':
        break; // handled at connect
      case 'join_team':
        if (this.phase === 'lobby' || !p.inRound) {
          if (msg.team === 'red' || msg.team === 'blue') {
            p.team = msg.team;
            // Instrument slots are per-team; changing team may collide.
            if (p.cls === 'musician' && p.instrument && this.instrumentTaken(p.team, p.instrument, p.id)) {
              p.cls = null;
              p.instrument = null;
              this.send(p, { type: 'error', msg: 'That instrument is taken on this team — pick again.' });
            }
            p.ready = false;
            this.broadcastLobby();
          }
        }
        break;
      case 'choose_class':
        if (this.phase === 'lobby' || !p.inRound) {
          if (!p.team) {
            this.send(p, { type: 'error', msg: 'Pick a team first.' });
            break;
          }
          if (msg.cls === 'musician') {
            const inst = msg.instrument === 'drum' ? 'drum' : 'fife';
            if (this.instrumentTaken(p.team, inst, p.id)) {
              this.send(p, { type: 'error', msg: `The ${inst} is already taken on your team.` });
              break;
            }
            p.cls = 'musician';
            p.instrument = inst;
          } else if (msg.cls === 'infantry' || msg.cls === 'medic') {
            p.cls = msg.cls;
            p.instrument = null;
          }
          p.ready = false;
          this.broadcastLobby();
        }
        break;
      case 'ready':
        if (this.phase === 'lobby' || !p.inRound) {
          if (msg.ready && (!p.team || !p.cls)) {
            this.send(p, { type: 'error', msg: 'Pick a team and class before readying up.' });
            break;
          }
          p.ready = !!msg.ready;
          this.broadcastLobby();
          this.maybeStartRound();
        }
        break;
      case 'input':
        if (p.inRound && Array.isArray(msg.steps)) {
          for (const s of msg.steps) {
            if (typeof s?.seq === 'number' && typeof s?.dt === 'number') p.pendingSteps.push(s);
          }
          // Sanity cap — a stalled tab shouldn't queue minutes of movement.
          if (p.pendingSteps.length > 90) p.pendingSteps.splice(0, p.pendingSteps.length - 90);
        }
        break;
      case 'fire':
        this.handleFire(p, msg.yaw, msg.pitch);
        break;
      case 'reload_start':
        if (this.canAct(p) && p.cls === 'infantry' && !p.loaded && !p.reloading && !p.fireAt) {
          p.reloading = true;
        }
        break;
      case 'reload_cancel':
        p.reloading = false;
        break;
      case 'reload_done':
        if (p.reloading && this.canAct(p) && p.cls === 'infantry') {
          p.reloading = false;
          p.loaded = true;
        }
        break;
      case 'note_hit':
        this.handleNoteHit(p, msg.idx, msg.grade);
        break;
      case 'revive_start':
        this.handleReviveStart(p, msg.target);
        break;
      case 'revive_cancel':
        this.cancelReviveBy(p);
        break;
      case 'revive_done':
        this.handleReviveDone(p, msg.target);
        break;
      case 'lay_trap':
        this.handleLayTrap(p);
        break;
      case 'add_bot':
        this.handleAddBot(p, msg.team, msg.cls);
        break;
      case 'remove_bot': {
        const bot = this.players.get(msg.id);
        if (bot?.bot) this.removePlayer(bot.id);
        break;
      }
      case 'balance_teams':
        this.handleBalanceTeams(p);
        break;
    }
  }

  private handleAddBot(p: Player, team: Team, cls?: ClassType): void {
    if (team !== 'red' && team !== 'blue') return;
    if (cls === 'musician') {
      this.send(p, { type: 'error', msg: 'Clockwork men have no ear for music — infantry or medic only.' });
      return;
    }
    const botCount = [...this.players.values()].filter((q) => q.bot).length;
    if (botCount >= MAX_BOTS) {
      this.send(p, { type: 'error', msg: `The armory holds only ${MAX_BOTS} clockwork soldiers.` });
      return;
    }
    this.addBot(team, cls === 'medic' ? 'medic' : 'infantry');
    this.broadcastLobby();
    this.maybeStartRound();
  }

  /** Muster AI infantry onto the smaller side until the muster rolls match. */
  private handleBalanceTeams(p: Player): void {
    const ps = [...this.players.values()];
    let red = ps.filter((q) => q.team === 'red').length;
    let blue = ps.filter((q) => q.team === 'blue').length;
    if (red === blue) {
      this.send(p, { type: 'error', msg: 'The sides are already even.' });
      return;
    }
    let botCount = ps.filter((q) => q.bot).length;
    let added = 0;
    while (red !== blue && botCount < MAX_BOTS) {
      if (red < blue) {
        this.addBot('red', 'infantry');
        red++;
      } else {
        this.addBot('blue', 'infantry');
        blue++;
      }
      botCount++;
      added++;
    }
    if (added === 0) {
      this.send(p, { type: 'error', msg: `The armory holds only ${MAX_BOTS} clockwork soldiers.` });
      return;
    }
    if (red !== blue) {
      this.send(p, { type: 'error', msg: 'The armory ran dry before the sides came even.' });
    }
    this.broadcastLobby();
    this.maybeStartRound();
  }

  private instrumentTaken(team: Team, inst: Instrument, exceptId: string): boolean {
    return [...this.players.values()].some(
      (q) => q.id !== exceptId && q.team === team && q.cls === 'musician' && q.instrument === inst,
    );
  }

  /** Standing, in a live battle, and generally able to do class actions. */
  private canAct(p: Player): boolean {
    return (
      this.phase === 'battle' && p.inRound && p.status === 'active' && p.trappedUntil <= now()
    );
  }

  // ---------- muskets ----------

  private handleFire(p: Player, yaw: number, pitch: number): void {
    if (!this.canAct(p) || p.cls !== 'infantry') return;
    if (!p.loaded || p.reloading || p.fireAt) return;
    p.loaded = false;
    p.fireAt = now() + FIRE_FLASH_DELAY_MS;
    p.fireYaw = Number(yaw) || 0;
    p.firePitch = clamp(Number(pitch) || 0, -0.6, 0.6);
    this.broadcast({ type: 'primed', id: p.id });
  }

  private resolveScheduledShots(): void {
    const t = now();
    for (const p of this.players.values()) {
      if (!p.fireAt || t < p.fireAt) continue;
      p.fireAt = 0;
      if (!p.inRound || this.phase !== 'battle' || p.status !== 'active' || !p.team) continue;
      const spreadDeg =
        SPREAD_BASE_DEG * (p.moving ? SPREAD_MOVING_MULT : 1) * this.spreadMult(p.team);
      const dir = perturbDirection(p.fireYaw, p.firePitch, deg2rad(spreadDeg));
      const ox = p.x + Math.sin(p.fireYaw) * 0.9;
      const oz = p.z + Math.cos(p.fireYaw) * 0.9;
      const proj: Projectile = {
        id: this.nextProjId++,
        shooter: p.id,
        team: p.team,
        x: ox, y: MUZZLE_HEIGHT, z: oz,
        vx: dir.x * MUZZLE_SPEED, vy: dir.y * MUZZLE_SPEED, vz: dir.z * MUZZLE_SPEED,
        diesAt: t + PROJ_LIFETIME_MS,
      };
      this.projectiles.push(proj);
      this.broadcast({
        type: 'shot', id: proj.id, shooter: p.id,
        ox: proj.x, oy: proj.y, oz: proj.z,
        vx: proj.vx, vy: proj.vy, vz: proj.vz,
      });
    }
  }

  private spreadMult(team: Team): number {
    const b = this.buffs[team];
    return 1 - SPREAD_REDUCTION_PER_INSTRUMENT * b.fife - SPREAD_REDUCTION_PER_INSTRUMENT * b.drum;
  }

  private stepProjectiles(dt: number): void {
    const t = now();
    const survivors: Projectile[] = [];
    for (const proj of this.projectiles) {
      const px = proj.x, py = proj.y, pz = proj.z;
      proj.vy -= PROJ_GRAVITY * dt;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.z += proj.vz * dt;

      let ended = false;
      // Musket balls only bother the enemy team; crawling men are below the shot.
      for (const q of this.players.values()) {
        if (!q.inRound || q.team === proj.team || q.status !== 'active') continue;
        if (segmentDistToPoint(px, py, pz, proj.x, proj.y, proj.z, q.x, HIT_CENTER_Y, q.z) <= HIT_RADIUS) {
          this.broadcast({ type: 'proj_end', id: proj.id, x: q.x, y: HIT_CENTER_Y, z: q.z, hit: q.id });
          this.downPlayer(q, proj.shooter);
          ended = true;
          break;
        }
      }
      if (!ended && (proj.y <= 0 || t >= proj.diesAt ||
        Math.abs(proj.x) > FIELD_HALF_X + 30 || Math.abs(proj.z) > FIELD_HALF_Z + 30)) {
        this.broadcast({ type: 'proj_end', id: proj.id, x: proj.x, y: Math.max(0, proj.y), z: proj.z, hit: null });
        ended = true;
      }
      if (!ended) survivors.push(proj);
    }
    this.projectiles = survivors;
  }

  private downPlayer(q: Player, by: string | null): void {
    q.status = 'dbno';
    q.dbnoEnd = now() + DBNO_AUTO_RES_MS;
    q.reloading = false;
    q.fireAt = 0;
    this.cancelReviveBy(q); // a shot medic drops his leeches
    if (by) this.stats.downs[by] = (this.stats.downs[by] ?? 0) + 1;
    this.broadcast({ type: 'downed', id: q.id, by });
  }

  // ---------- music ----------

  private handleNoteHit(p: Player, idx: number, grade: 'good' | 'perfect'): void {
    if (!this.canAct(p) || p.cls !== 'musician' || !p.instrument || !p.team) return;
    const t = now();
    if (t - p.lastNoteAt < 220) return; // gentle flood guard
    p.lastNoteAt = t;
    const add = grade === 'perfect' ? BUFF_PER_NOTE_PERFECT : BUFF_PER_NOTE_GOOD;
    const b = this.buffs[p.team];
    b[p.instrument] = clamp(b[p.instrument] + add, 0, 1);
    this.stats.notes[p.id] = (this.stats.notes[p.id] ?? 0) + 1;
    this.broadcast({
      type: 'note', team: p.team, instrument: p.instrument,
      idx: Math.max(0, Math.floor(idx)), grade: grade === 'perfect' ? 'perfect' : 'good',
    });
  }

  // ---------- medic ----------

  private handleReviveStart(p: Player, targetId: string): void {
    if (!this.canAct(p) || p.cls !== 'medic' || p.reviving) return;
    const target = this.players.get(targetId);
    if (!target || !target.inRound || target.team !== p.team || target.status !== 'dbno') return;
    if (target.beingRevivedBy) return; // one medic per patient
    if (dist2d(p.x, p.z, target.x, target.z) > REVIVE_RANGE) return;
    p.reviving = true;
    p.reviveTarget = targetId;
    p.reviveStartedAt = now();
    target.beingRevivedBy = p.id;
    this.broadcast({ type: 'revive_begin', medic: p.id, target: targetId });
  }

  private handleReviveDone(p: Player, targetId: string): void {
    if (!p.reviving || p.reviveTarget !== targetId) return;
    const target = this.players.get(targetId);
    p.reviving = false;
    p.reviveTarget = null;
    if (!target || target.status !== 'dbno' || this.phase !== 'battle') return;
    if (dist2d(p.x, p.z, target.x, target.z) > REVIVE_RANGE * 1.6) return;
    target.beingRevivedBy = null;
    this.revive(target, p.id, false);
    this.stats.revives[p.id] = (this.stats.revives[p.id] ?? 0) + 1;
  }

  private cancelReviveBy(p: Player): void {
    if (!p.reviving) return;
    p.reviving = false;
    const target = p.reviveTarget ? this.players.get(p.reviveTarget) : null;
    if (target && target.beingRevivedBy === p.id) target.beingRevivedBy = null;
    p.reviveTarget = null;
    this.broadcast({ type: 'revive_abort', medic: p.id });
  }

  /** The patient stood up (or vanished) out from under the medic. */
  private abortReviveOf(target: Player): void {
    const medic = target.beingRevivedBy ? this.players.get(target.beingRevivedBy) : null;
    target.beingRevivedBy = null;
    if (medic && medic.reviving) {
      medic.reviving = false;
      medic.reviveTarget = null;
      this.broadcast({ type: 'revive_abort', medic: medic.id });
    }
  }

  private revive(q: Player, by: string | null, auto: boolean): void {
    q.status = 'active';
    q.dbnoEnd = 0;
    this.abortReviveOf(q);
    this.broadcast({ type: 'revived', id: q.id, by, auto });
  }

  // ---------- traps ----------

  private handleLayTrap(p: Player): void {
    if (this.phase !== 'retreat' || !p.inRound || p.status !== 'active' || !p.team) return;
    if (p.team !== this.retreatTeam || p.trapsLeft <= 0) return;
    p.trapsLeft--;
    const trap: Trap = {
      id: this.nextTrapId++,
      x: p.x, z: p.z, team: p.team, armAt: now() + TRAP_ARM_MS, sprung: false,
    };
    this.traps.push(trap);
    this.broadcast({ type: 'trap', id: trap.id, x: trap.x, z: trap.z, team: trap.team, armAt: trap.armAt });
  }

  // ---------- round flow ----------

  private maybeStartRound(): void {
    if (this.phase !== 'lobby') return;
    const ps = [...this.players.values()];
    if (ps.length < 2) return;
    if (!ps.every((p) => p.ready && p.team && p.cls)) return;
    const teamOf = (t: Team) => ps.filter((p) => p.team === t);
    if (teamOf('red').length === 0 || teamOf('blue').length === 0) return;
    if (!teamOf('red').some((p) => p.cls === 'infantry')) return;
    if (!teamOf('blue').some((p) => p.cls === 'infantry')) return;
    this.startCountdown(ps);
  }

  private startCountdown(ps: Player[]): void {
    this.stats = emptyStats();
    this.projectiles = [];
    this.traps = [];
    this.retreatTeam = null;
    this.buffs = { red: { fife: 0, drum: 0 }, blue: { fife: 0, drum: 0 } };

    const setup: RoundSetup = { lineOrder: { red: [], blue: [] }, participants: [] };
    for (const team of ['red', 'blue'] as Team[]) {
      const members = ps.filter((p) => p.team === team);
      const infantry = members.filter((p) => p.cls === 'infantry').sort((a, b) => a.joinedAt - b.joinedAt);
      const fife = members.find((p) => p.instrument === 'fife') ?? null;
      const drum = members.find((p) => p.instrument === 'drum') ?? null;
      const medics = members.filter((p) => p.cls === 'medic');

      const lineZ = team === 'blue' ? -LINE_Z : LINE_Z;
      const yaw = team === 'blue' ? 0 : Math.PI; // face the other line
      const line: Player[] = [...(fife ? [fife] : []), ...infantry, ...(drum ? [drum] : [])];
      const half = ((line.length - 1) / 2) * LINE_SPACING;
      line.forEach((p, i) => {
        p.x = i * LINE_SPACING - half;
        p.z = lineZ;
        p.yaw = yaw;
      });
      const medicZ = team === 'blue' ? -LINE_Z - MEDIC_BACK_OFFSET : LINE_Z + MEDIC_BACK_OFFSET;
      medics.forEach((p, i) => {
        p.x = (i - (medics.length - 1) / 2) * 3;
        p.z = medicZ;
        p.yaw = yaw;
      });
      this.lineOrder[team] = line.map((p) => p.id);
      setup.lineOrder[team] = line.map((p) => p.id);
    }

    for (const p of ps) {
      p.inRound = true;
      p.status = 'active';
      p.loaded = p.cls === 'infantry';
      p.reloading = false;
      p.reviving = false;
      p.reviveTarget = null;
      p.beingRevivedBy = null;
      p.dbnoEnd = 0;
      p.trappedUntil = 0;
      p.trapsLeft = 0;
      p.fireAt = 0;
      p.pendingSteps = [];
      p.moving = false;
      p.botActionAt = 0;
      p.botNextTrapAt = 0;
      this.stats.names[p.id] = p.name;
      setup.participants.push({
        id: p.id, name: p.name, team: p.team!, cls: p.cls!, instrument: p.instrument,
        x: p.x, z: p.z, yaw: p.yaw,
      });
    }

    this.lastSetup = setup;
    this.phase = 'countdown';
    this.phaseEndsAt = now() + COUNTDOWN_MS;
    this.broadcast({ type: 'phase', phase: 'countdown', endsAt: this.phaseEndsAt, setup });
    this.announce('Form ranks!', true);
    this.broadcastLobby();
  }

  private startBattle(): void {
    this.phase = 'battle';
    this.broadcast({ type: 'phase', phase: 'battle' });
    this.announce('Present... FIRE AT WILL!', true);
  }

  private startRetreat(team: Team): void {
    this.phase = 'retreat';
    this.retreatTeam = team;
    this.retreatStage = 'fixing';
    this.phaseEndsAt = now() + FIX_BAYONETS_MS;
    // Panic wipes the field clean: everyone up, nothing mid-flight.
    for (const proj of this.projectiles) {
      this.broadcast({ type: 'proj_end', id: proj.id, x: proj.x, y: proj.y, z: proj.z, hit: null });
    }
    this.projectiles = [];
    for (const p of this.players.values()) {
      if (!p.inRound) continue;
      p.fireAt = 0;
      p.reloading = false;
      this.cancelReviveBy(p);
      if (p.status === 'dbno') {
        // Adrenaline: the wounded find their feet when the line breaks.
        p.status = 'active';
        p.dbnoEnd = 0;
        p.beingRevivedBy = null;
      }
      if (p.team === team) p.trapsLeft = TRAPS_PER_RETREATER;
    }
    this.broadcast({
      type: 'phase', phase: 'retreat', endsAt: this.phaseEndsAt,
      retreatTeam: team, stage: 'fixing',
    });
    this.announce(`THE ${team.toUpperCase()} LINE IS BROKEN! RETREAT!`, true);
  }

  private beginCharge(): void {
    this.retreatStage = 'charge';
    this.retreatChargeEndsAt = now() + RETREAT_TIMEOUT_MS;
    this.broadcast({ type: 'retreat_stage', stage: 'charge' });
    this.announce('CHARGE!', false);
  }

  private endRound(winner: Team): void {
    this.stats.winner = winner;
    this.stats.loser = otherTeam(winner);
    this.phase = 'results';
    this.phaseEndsAt = now() + RESULTS_MS;
    for (const p of this.players.values()) {
      p.inRound = false;
      p.ready = p.bot; // AI soldiers are always game for another round
      p.reloading = false;
      p.reviving = false;
      p.fireAt = 0;
      p.pendingSteps = [];
    }
    this.broadcast({ type: 'phase', phase: 'results', endsAt: this.phaseEndsAt, stats: this.stats });
    this.broadcastLobby();
  }

  private backToLobby(): void {
    this.phase = 'lobby';
    this.lastSetup = null;
    this.projectiles = [];
    this.traps = [];
    this.broadcast({ type: 'phase', phase: 'lobby' });
    this.broadcastLobby();
    this.maybeStartRound(); // everyone may already be re-readied
  }

  // ---------- tick ----------

  tick(): void {
    const t = now();
    const dt = clamp((t - this.lastTickAt) / 1000, 0.001, 0.1);
    this.lastTickAt = t;
    this.tickCount++;

    switch (this.phase) {
      case 'lobby':
        break;
      case 'countdown':
        this.applyInputs(); // frozen, but drain the queue so battle doesn't start with a lurch
        if (t >= this.phaseEndsAt) this.startBattle();
        break;
      case 'battle':
        this.botTick(t);
        this.applyInputs();
        this.resolveScheduledShots();
        this.stepProjectiles(dt);
        this.autoRes(t);
        this.reviveTimeouts(t);
        this.decayBuffs(dt);
        this.updateTethersAndFormation();
        break;
      case 'retreat':
        this.botTick(t);
        this.applyInputs();
        if (this.retreatStage === 'fixing' && t >= this.phaseEndsAt) this.beginCharge();
        if (this.retreatStage === 'charge') this.retreatTick(t);
        break;
      case 'results':
        if (t >= this.phaseEndsAt) this.backToLobby();
        break;
    }

    if (this.phase !== 'lobby' && this.tickCount % SNAPSHOT_EVERY_N_TICKS === 0) {
      this.broadcast({ type: 'snap', snap: this.buildSnapshot(t) });
    }
  }

  private moveModeFor(p: Player, t: number): MoveMode {
    if (this.phase === 'countdown' || this.phase === 'results') return 'frozen';
    if (p.status === 'out' || p.status === 'escaped') return 'frozen';
    if (p.trappedUntil > t) return 'frozen';
    if (this.phase === 'retreat') {
      if (p.team === this.retreatTeam) return 'flee';
      return this.retreatStage === 'fixing' ? 'frozen' : 'charge';
    }
    if (p.status === 'dbno') return 'crawl';
    if (p.reloading || p.reviving) return 'frozen';
    return 'walk';
  }

  private applyInputs(): void {
    const t = now();
    for (const p of this.players.values()) {
      if (!p.inRound) {
        p.pendingSteps.length = 0;
        continue;
      }
      const mode = this.moveModeFor(p, t);
      for (const s of p.pendingSteps) {
        const dt = clamp(s.dt, 0, MAX_INPUT_DT_MS / 1000);
        stepBody(p, { mx: s.mx, my: s.my, yaw: s.yaw }, mode, dt);
        p.lastSeq = Math.max(p.lastSeq, s.seq);
        p.moving = Math.abs(s.mx) + Math.abs(s.my) > 0.1;
      }
      p.pendingSteps.length = 0;
    }
  }

  private autoRes(t: number): void {
    for (const p of this.players.values()) {
      if (p.inRound && p.status === 'dbno' && p.dbnoEnd > 0 && t >= p.dbnoEnd) {
        this.revive(p, null, true); // the circuit rider has arrived
      }
    }
  }

  private reviveTimeouts(t: number): void {
    for (const p of this.players.values()) {
      if (p.reviving && t - p.reviveStartedAt > REVIVE_TIMEOUT_MS) this.cancelReviveBy(p);
    }
  }

  private decayBuffs(dt: number): void {
    for (const team of ['red', 'blue'] as Team[]) {
      const b = this.buffs[team];
      b.fife = Math.max(0, b.fife - BUFF_DECAY_PER_SEC * dt);
      b.drum = Math.max(0, b.drum - BUFF_DECAY_PER_SEC * dt);
    }
  }

  private updateTethersAndFormation(): void {
    const fractions: Record<Team, number> = { red: 0, blue: 0 };
    for (const team of ['red', 'blue'] as Team[]) {
      const order = this.lineOrder[team].map((id) => this.players.get(id)).filter((p): p is Player => !!p && p.inRound);
      const broken: number[] = [];
      for (let i = 0; i + 1 < order.length; i++) {
        const a = order[i]!;
        const b = order[i + 1]!;
        broken.push(dist2d(a.x, a.z, b.x, b.z) > TETHER_MAX_DIST ? 1 : 0);
      }
      this.tetherBroken[team] = broken;
      if (broken.length > 0) {
        fractions[team] = broken.reduce((s, v) => s + v, 0) / broken.length;
      } else {
        // Tiny team with no tethers: the "line" collapses when no line member stands.
        fractions[team] = order.length > 0 && order.every((p) => p.status === 'dbno') ? 1 : 0;
      }
      // A fully-downed line is also a collapsed line even if the tethers hold.
      if (order.length > 0 && order.every((p) => p.status === 'dbno')) fractions[team] = Math.max(fractions[team], 1);
    }
    const redBroke = fractions.red >= FORMATION_BREAK_FRACTION;
    const blueBroke = fractions.blue >= FORMATION_BREAK_FRACTION;
    if (redBroke || blueBroke) {
      let loser: Team;
      if (redBroke && blueBroke) {
        loser = fractions.red === fractions.blue ? (Math.random() < 0.5 ? 'red' : 'blue')
          : fractions.red > fractions.blue ? 'red' : 'blue';
      } else {
        loser = redBroke ? 'red' : 'blue';
      }
      this.startRetreat(loser);
    }
  }

  private retreatTick(t: number): void {
    const retreaters: Player[] = [];
    const pursuers: Player[] = [];
    for (const p of this.players.values()) {
      if (!p.inRound || !p.team) continue;
      (p.team === this.retreatTeam ? retreaters : pursuers).push(p);
    }

    for (const pursuer of pursuers) {
      if (pursuer.status !== 'active' || pursuer.trappedUntil > t) continue;
      // Bear traps bite the careless.
      for (const trap of this.traps) {
        if (trap.sprung || t < trap.armAt || trap.team === pursuer.team) continue;
        if (dist2d(pursuer.x, pursuer.z, trap.x, trap.z) <= TRAP_RADIUS) {
          trap.sprung = true;
          pursuer.trappedUntil = t + TRAP_HOLD_MS;
          this.broadcast({ type: 'trap_sprung', id: trap.id, victim: pursuer.id });
          break;
        }
      }
      if (pursuer.trappedUntil > t) continue;
      // Bayonet tip touch.
      const tipX = pursuer.x + Math.sin(pursuer.yaw) * BAYONET_REACH;
      const tipZ = pursuer.z + Math.cos(pursuer.yaw) * BAYONET_REACH;
      for (const r of retreaters) {
        if (r.status !== 'active') continue;
        if (dist2d(tipX, tipZ, r.x, r.z) <= BAYONET_TAG_RADIUS) {
          r.status = 'out';
          this.stats.bayonetTags[pursuer.id] = (this.stats.bayonetTags[pursuer.id] ?? 0) + 1;
          this.stats.caught.push(r.id);
          this.broadcast({ type: 'tagged', id: r.id, by: pursuer.id });
        }
      }
    }

    const escapeZ = this.retreatTeam === 'red' ? ESCAPE_Z : -ESCAPE_Z;
    for (const r of retreaters) {
      if (r.status !== 'active') continue;
      const past = this.retreatTeam === 'red' ? r.z >= escapeZ : r.z <= escapeZ;
      if (past || t >= this.retreatChargeEndsAt) {
        r.status = 'escaped';
        this.stats.escaped.push(r.id);
        this.broadcast({ type: 'escaped', id: r.id });
      }
    }

    if (!retreaters.some((r) => r.status === 'active')) {
      this.endRound(otherTeam(this.retreatTeam!));
    }
  }

  // ---------- AI soldiers ----------

  private botTick(t: number): void {
    for (const p of this.players.values()) {
      if (!p.bot || !p.inRound || !p.team) continue;
      if (this.phase === 'battle') this.botBattle(p, t);
      else if (this.phase === 'retreat') this.botRetreat(p, t);
    }
  }

  /**
   * Queue one tick of input, expressed as a desired world-space move direction.
   * `throttle` scales the pace (1 = full walk) — the shared movement sim keeps
   * sub-unit input magnitudes, so bots can slow to a stop instead of stomping.
   */
  private botMove(p: Player, yaw: number, wx: number, wz: number, throttle = 1): void {
    let mx = 0;
    let my = 0;
    const len = Math.hypot(wx, wz);
    if (len > 1e-6 && throttle > 0) {
      const nx = (wx / len) * throttle, nz = (wz / len) * throttle;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      my = nx * sin + nz * cos;
      mx = nx * cos - nz * sin;
    }
    p.pendingSteps.push({ seq: p.lastSeq + 1, dt: TICK_MS / 1000, mx, my, yaw, pitch: 0 });
  }

  private nearestEnemy(p: Player): Player | null {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const q of this.players.values()) {
      if (!q.inRound || q.team === p.team || q.status !== 'active') continue;
      const d = dist2d(p.x, p.z, q.x, q.z);
      if (d < bestD) { bestD = d; best = q; }
    }
    return best;
  }

  /**
   * The spot this man should hold to keep the line dressed: on the line
   * between his nearest remaining neighbors (his share of the gap), or at
   * proper spacing beside the last man when the line ends with him. As the
   * men next to him move, his station moves — so he moves. Null when nobody
   * else from his line remains (or he was never in it).
   */
  private lineStation(p: Player): { x: number; z: number } | null {
    if (!p.team) return null;
    const order = this.lineOrder[p.team];
    const i = order.indexOf(p.id);
    if (i < 0) return null;
    let left: Player | null = null;
    let leftGap = 0;
    for (let j = i - 1; j >= 0 && !left; j--) {
      const q = this.players.get(order[j]!);
      if (q && q.inRound) { left = q; leftGap = i - j; }
    }
    let right: Player | null = null;
    let rightGap = 0;
    for (let j = i + 1; j < order.length && !right; j++) {
      const q = this.players.get(order[j]!);
      if (q && q.inRound) { right = q; rightGap = j - i; }
    }
    if (left && right) {
      const f = leftGap / (leftGap + rightGap);
      return { x: left.x + (right.x - left.x) * f, z: left.z + (right.z - left.z) * f };
    }
    const anchor = left ?? right;
    if (!anchor) return null;
    // Line indices grow toward +x at setup; an end man keeps spacing outward.
    const gap = left ? leftGap : rightGap;
    return { x: anchor.x + (left ? 1 : -1) * gap * LINE_SPACING, z: anchor.z };
  }

  /** The line neighbor whose tether is stretching, if any. */
  private strayedNeighbor(p: Player): Player | null {
    if (!p.team) return null;
    const order = this.lineOrder[p.team];
    const i = order.indexOf(p.id);
    if (i < 0) return null;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= order.length) continue;
      const q = this.players.get(order[j]!);
      if (q && q.inRound && dist2d(p.x, p.z, q.x, q.z) > TETHER_WARN_DIST) return q;
    }
    return null;
  }

  private botBattle(p: Player, t: number): void {
    if (p.status !== 'active') return; // a downed automaton lies where it fell
    const enemy = this.nearestEnemy(p);
    const faceYaw = enemy ? Math.atan2(enemy.x - p.x, enemy.z - p.z) : p.yaw;

    if (p.cls === 'medic') {
      this.botMedic(p, t, faceYaw);
      return;
    }
    if (p.cls !== 'infantry') return;

    // The reload ritual, performed on a timer instead of a minigame.
    // (Like a human, he cannot move until the ramrod is home.)
    if (p.reloading) {
      if (t >= p.botActionAt) {
        p.reloading = false;
        p.loaded = true;
      }
      this.botMove(p, faceYaw, 0, 0);
      return;
    }

    // A tether at the warn distance is an emergency: close up at a run.
    const strayed = this.strayedNeighbor(p);
    if (strayed) {
      this.botMove(p, faceYaw, strayed.x - p.x, strayed.z - p.z);
      return;
    }

    // Hold the line proactively: dress on the neighbors, so that as the men
    // next to him move, he moves with them — not only once a tether stretches.
    const station = this.lineStation(p);
    if (station) {
      const dx = station.x - p.x;
      const dz = station.z - p.z;
      const off = Math.hypot(dx, dz);
      if (off > BOT_DRESS_DEADZONE) {
        this.botMove(p, faceYaw, dx, dz, clamp(off / BOT_DRESS_EASE_DIST, 0, 1));
        return;
      }
    }

    // In place: see to the musket before anything else.
    if (!p.loaded && !p.fireAt) {
      p.reloading = true;
      p.botActionAt = t + BOT_RELOAD_MS + Math.random() * BOT_RELOAD_JITTER_MS;
      this.botMove(p, faceYaw, 0, 0);
      return;
    }

    if (!enemy) {
      this.botMove(p, faceYaw, 0, 0);
      return;
    }
    const dist = dist2d(p.x, p.z, enemy.x, enemy.z);
    if (p.loaded && !p.fireAt && dist <= BOT_FIRE_RANGE) {
      this.botMove(p, faceYaw, 0, 0); // stand to volley
      const err = deg2rad(BOT_AIM_ERROR_DEG) * (Math.random() * 2 - 1);
      this.handleFire(p, faceYaw + err, ballisticPitch(dist));
      return;
    }
    // Only a man with no line left to dress on advances alone; a formed line
    // holds its ground and lets the enemy come to it.
    if (!station && dist > BOT_FIRE_RANGE) {
      this.botMove(p, faceYaw, enemy.x - p.x, enemy.z - p.z);
      return;
    }
    this.botMove(p, faceYaw, 0, 0);
  }

  private botMedic(p: Player, t: number, faceYaw: number): void {
    if (p.reviving) {
      if (t >= p.botActionAt && p.reviveTarget) this.handleReviveDone(p, p.reviveTarget);
      this.botMove(p, faceYaw, 0, 0);
      return;
    }
    let patient: Player | null = null;
    let bestD = Infinity;
    for (const q of this.players.values()) {
      if (!q.inRound || q.team !== p.team || q.status !== 'dbno' || q.beingRevivedBy) continue;
      const d = dist2d(p.x, p.z, q.x, q.z);
      if (d < bestD) { bestD = d; patient = q; }
    }
    if (!patient) {
      this.botMove(p, faceYaw, 0, 0);
      return;
    }
    const yaw = Math.atan2(patient.x - p.x, patient.z - p.z);
    if (bestD > REVIVE_RANGE * 0.7) {
      this.botMove(p, yaw, patient.x - p.x, patient.z - p.z);
      return;
    }
    this.botMove(p, yaw, 0, 0);
    this.handleReviveStart(p, patient.id);
    if (p.reviving) p.botActionAt = t + BOT_REVIVE_MS;
  }

  private botRetreat(p: Player, t: number): void {
    if (p.status !== 'active') return;
    if (p.team === this.retreatTeam) {
      // Run for home, dropping bear traps behind at a steady trot.
      const homeYaw = p.team === 'red' ? 0 : Math.PI;
      if (p.trapsLeft > 0 && t >= p.botNextTrapAt) {
        if (p.botNextTrapAt === 0) {
          p.botNextTrapAt = t + BOT_TRAP_INTERVAL_MS; // get moving before the first one
        } else {
          this.handleLayTrap(p);
          p.botNextTrapAt = t + BOT_TRAP_INTERVAL_MS;
        }
      }
      this.botMove(p, homeYaw, Math.sin(homeYaw), Math.cos(homeYaw));
      return;
    }
    // Pursuer: steer the charge toward the nearest fleeing man.
    let target: Player | null = null;
    let bestD = Infinity;
    for (const q of this.players.values()) {
      if (!q.inRound || q.team !== this.retreatTeam || q.status !== 'active') continue;
      const d = dist2d(p.x, p.z, q.x, q.z);
      if (d < bestD) { bestD = d; target = q; }
    }
    this.botMove(p, target ? Math.atan2(target.x - p.x, target.z - p.z) : p.yaw, 0, 0);
  }

  // ---------- snapshots & broadcast ----------

  private buildSnapshot(t: number) {
    const players: SnapPlayer[] = [];
    for (const p of this.players.values()) {
      if (!p.inRound) continue;
      players.push({
        id: p.id,
        x: round2(p.x), z: round2(p.z), yaw: round3(p.yaw),
        st: p.status,
        ld: p.loaded ? 1 : 0,
        rl: p.reloading ? 1 : 0,
        rv: p.reviving ? 1 : 0,
        tr: p.trappedUntil > t ? 1 : 0,
        dbnoEnd: p.dbnoEnd,
        ack: p.lastSeq,
      });
    }
    const teamSnap = (team: Team): TeamSnap => ({
      fife: round2(this.buffs[team].fife),
      drum: round2(this.buffs[team].drum),
      tethers: this.tetherBroken[team],
      spreadMult: round3(this.spreadMult(team)),
    });
    return { t, players, red: teamSnap('red'), blue: teamSnap('blue') };
  }

  private broadcastLobby(): void {
    const players: LobbyPlayer[] = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, cls: p.cls,
      instrument: p.instrument, ready: p.ready, inRound: p.inRound, bot: p.bot,
    }));
    this.broadcast({ type: 'lobby', players, phase: this.phase });
  }

  private announce(text: string, sting = false): void {
    this.broadcast({ type: 'announce', text, sting });
  }

  private send(p: Player, msg: ServerMsg): void {
    if (p.ws && p.ws.readyState === p.ws.OPEN) p.ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg): void {
    const raw = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === p.ws.OPEN) p.ws.send(raw);
    }
  }
}

// ---------- helpers ----------

const BOT_NAMES = [
  'Pvt. Cogsworth', 'Pvt. Mainspring', 'Cpl. Pendulum', 'Pvt. Ratchet',
  'Sgt. Flintlock', 'Pvt. Tinwhistle', 'Pvt. Windup', 'Cpl. Gearbottom',
];

/** Elevation to land a ball `dist` meters out on level ground (low-arc solution). */
function ballisticPitch(dist: number): number {
  return 0.5 * Math.asin(clamp((PROJ_GRAVITY * dist) / (MUZZLE_SPEED * MUZZLE_SPEED), 0, 1));
}

function emptyStats(): RoundStats {
  return {
    winner: 'red', loser: 'blue',
    downs: {}, revives: {}, notes: {}, bayonetTags: {},
    escaped: [], caught: [], names: {},
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Random direction within a cone of half-angle `spreadRad` around (yaw, pitch). */
function perturbDirection(yaw: number, pitch: number, spreadRad: number): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fx = Math.sin(yaw) * cp, fy = sp, fz = Math.cos(yaw) * cp;
  // Basis vectors perpendicular to forward.
  const rx = Math.cos(yaw), ry = 0, rz = -Math.sin(yaw);
  const ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;
  const theta = spreadRad * Math.sqrt(Math.random());
  const phi = Math.random() * Math.PI * 2;
  const st = Math.sin(theta), ct = Math.cos(theta);
  const ca = Math.cos(phi) * st, sa = Math.sin(phi) * st;
  return {
    x: fx * ct + rx * ca + ux * sa,
    y: fy * ct + ry * ca + uy * sa,
    z: fz * ct + rz * ca + uz * sa,
  };
}

/** Distance from segment AB to point P in 3D. */
function segmentDistToPoint(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  px: number, py: number, pz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 > 1e-9 ? clamp((apx * abx + apy * aby + apz * abz) / len2, 0, 1) : 0;
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}
