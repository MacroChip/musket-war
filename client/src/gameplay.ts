import {
  AIM_REF_DISTANCE,
  DBNO_AUTO_RES_MS,
  INPUT_SEND_RATE,
  INTERP_DELAY_MS,
  REVIVE_RANGE,
  SPREAD_BASE_DEG,
  SPREAD_MOVING_MULT,
  TRAPS_PER_RETREATER,
} from '../../shared/src/constants';
import { clamp, deg2rad, lerp, lerpAngle } from '../../shared/src/math';
import { stepBody, type MoveMode } from '../../shared/src/movement';
import type { InputStep, ServerMsg } from '../../shared/src/protocol';
import type { SnapPlayer, Snapshot, Team } from '../../shared/src/types';
import * as audio from './audio';
import * as hud from './hud';
import { send } from './net';
import { inRound, mySnap, myParticipant, myTeam, S, serverNow } from './state';
import {
  ddrActive, ddrFrame, ddrKey, initDdr, playPhrase, setDdrActive,
} from './minigames/ddr';
import {
  closeMedic, initMedic, medicActive, medicFrame, medicKey,
  medicMouseDown, medicMouseMove, medicMouseUp, openMedic,
} from './minigames/medic';
import {
  closeReload, initReload, openReload, reloadActive, reloadFrame,
  reloadKey, reloadMouseDown, reloadMouseMove, reloadMouseUp,
} from './minigames/reload';
import {
  bloodlessPoof, clearProjectiles, clearTraps, dirtPuffAt, endProjectile,
  ensureTetherCount, muzzleSmoke, panSpark, resurrectionColumn, spawnProjectile,
  spawnTrap, springTrap, updateParticles, updateProjectiles, updateTether,
} from './world/effects';
import { camera, initScene, renderer, scene } from './world/scene';
import { SoldierView, type SoldierPose } from './world/soldiers';

// ---------- module state ----------

const soldiers = new Map<string, SoldierView>();
const keys = new Set<string>();
let aimYaw = 0;
let aimPitch = 0;
let pointerLocked = false;
let canvasEl: HTMLCanvasElement;

// prediction
const predicted = { x: 0, z: 0, yaw: 0 };
const visual = { x: 0, z: 0 }; // smoothed toward predicted
let seqCounter = 0;
let pendingSteps: InputStep[] = [];
let outbox: InputStep[] = [];
let sendAccum = 0;

// local intent flags (server remains authoritative)
let localLoaded = true;
let localLoadedAt = 0;
let trapsLeft = 0;
let dbnoToastShown = false;

// interpolated remote poses, refreshed each frame
const remotePoses = new Map<string, { x: number; z: number; yaw: number }>();

export function initGameplay(): void {
  canvasEl = document.getElementById('scene') as HTMLCanvasElement;
  initScene(canvasEl);
  initReload(document.getElementById('reload-canvas') as HTMLCanvasElement);
  initMedic(document.getElementById('medic-canvas') as HTMLCanvasElement);
  initDdr(document.getElementById('ddr-canvas') as HTMLCanvasElement);
  hookInput();
}

// ---------- input ----------

function overlayHasMouse(): boolean {
  return reloadActive() || medicActive();
}

function hookInput(): void {
  canvasEl.addEventListener('click', () => {
    audio.unlockAudio();
    if (inRound() && !pointerLocked) canvasEl.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvasEl;
  });

  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    if (reloadActive()) {
      reloadMouseMove(e.movementX, e.movementY);
    } else if (medicActive()) {
      medicMouseMove(e.movementX, e.movementY);
    } else {
      aimYaw -= e.movementX * 0.0026;
      aimPitch = clamp(aimPitch - e.movementY * 0.0022, -0.32, 0.38);
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (reloadActive()) {
      reloadMouseDown();
    } else if (medicActive()) {
      medicMouseDown();
    } else if (pointerLocked) {
      tryFire();
    }
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (reloadActive()) reloadMouseUp();
    else if (medicActive()) medicMouseUp();
  });

  document.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    // Overlays get first claim on keys.
    if (reloadKey(e.code) || medicKey(e.code)) {
      e.preventDefault();
      return;
    }
    if (ddrKey(e.code)) {
      e.preventDefault();
      return;
    }
    keys.add(e.code);
    if (e.code === 'KeyR') tryReload();
    if (e.code === 'KeyE') tryRevive();
    if (e.code === 'KeyF') tryTrap();
    if (e.code === 'KeyM') {
      const muted = audio.toggleMute();
      hud.toast(muted ? 'The fifes fall silent. (M to unmute)' : 'Sound restored.');
    }
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  document.addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
}

function tryFire(): void {
  const me = mySnap();
  if (!me || S.phase !== 'battle' || me.st !== 'active') return;
  if (myParticipant()?.cls !== 'infantry') return;
  if (S.reloading || S.reviving) return;
  if (!isLoadedLocally(me)) {
    audio.dryClick();
    hud.toast('Empty! Press R to reload.');
    return;
  }
  localLoaded = false;
  localLoadedAt = performance.now();
  send({ type: 'fire', yaw: aimYaw, pitch: aimPitch });
}

function isLoadedLocally(me: SnapPlayer): boolean {
  // Trust our own recent actions over slightly-stale snapshots.
  if (performance.now() - localLoadedAt < 900) return localLoaded;
  return me.ld === 1;
}

function tryReload(): void {
  const me = mySnap();
  if (!me || S.phase !== 'battle' || me.st !== 'active') return;
  if (myParticipant()?.cls !== 'infantry') return;
  if (S.reloading || S.reviving || isLoadedLocally(me)) return;
  S.reloading = true;
  send({ type: 'reload_start' });
  openReload(
    () => {
      S.reloading = false;
      localLoaded = true;
      localLoadedAt = performance.now();
      send({ type: 'reload_done' });
      hud.toast('Loaded!');
    },
    () => {
      S.reloading = false;
      send({ type: 'reload_cancel' });
    },
  );
}

function tryRevive(): void {
  const me = mySnap();
  if (!me || S.phase !== 'battle' || me.st !== 'active') return;
  if (myParticipant()?.cls !== 'medic' || S.reviving) return;
  const target = nearestDbnoAlly();
  if (!target) return;
  send({ type: 'revive_start', target: target.id });
  // We only freeze and open the QTE when the server confirms with revive_begin.
}

function tryTrap(): void {
  const me = mySnap();
  if (!me || S.phase !== 'retreat' || me.st !== 'active') return;
  if (myTeam() !== S.retreatTeam || trapsLeft <= 0) return;
  trapsLeft--;
  send({ type: 'lay_trap' });
}

function nearestDbnoAlly(): { id: string; name: string } | null {
  const snap = S.latest;
  const team = myTeam();
  if (!snap || !team) return null;
  let best: { id: string; name: string } | null = null;
  let bestDist = REVIVE_RANGE;
  for (const p of snap.players) {
    if (p.id === S.myId || p.st !== 'dbno') continue;
    const part = S.participants.get(p.id);
    if (!part || part.team !== team) continue;
    const pose = remotePoses.get(p.id) ?? p;
    const d = Math.hypot(pose.x - predicted.x, pose.z - predicted.z);
    if (d <= bestDist) {
      bestDist = d;
      best = { id: p.id, name: part.name };
    }
  }
  return best;
}

// ---------- movement mode (mirrors the server's rules for prediction) ----------

function myMode(): MoveMode {
  const me = mySnap();
  const st = me?.st ?? 'active';
  if (S.phase === 'countdown' || S.phase === 'results') return 'frozen';
  if (st === 'out' || st === 'escaped') return 'frozen';
  if (me?.tr) return 'frozen';
  if (S.phase === 'retreat') {
    if (myTeam() === S.retreatTeam) return 'flee';
    return S.retreatStage === 'fixing' ? 'frozen' : 'charge';
  }
  if (st === 'dbno') return 'crawl';
  if (S.reloading || S.reviving) return 'frozen';
  return 'walk';
}

// ---------- server events ----------

export function onServerMsg(msg: ServerMsg): void {
  switch (msg.type) {
    case 'phase':
      onPhase(msg);
      break;
    case 'snap':
      reconcile(msg.snap);
      break;
    case 'primed': {
      const pose = poseOf(msg.id);
      if (pose) {
        const fx = Math.sin(pose.yaw);
        const fz = Math.cos(pose.yaw);
        // Spark at the flint lock, visibly before the muzzle blast.
        const mx = pose.x + fx * 0.36 + fz * 0.22;
        const mz = pose.z + fz * 0.36 - fx * 0.22;
        panSpark(mx, 1.46, mz);
        audio.panSizzle(audio.falloff(distToMe(pose.x, pose.z)));
      }
      break;
    }
    case 'shot': {
      spawnProjectile(msg.id, msg.ox, msg.oy, msg.oz, msg.vx, msg.vy, msg.vz);
      const yaw = Math.atan2(msg.vx, msg.vz);
      muzzleSmoke(msg.ox, msg.oy, msg.oz, yaw);
      audio.musketBang(audio.falloff(distToMe(msg.ox, msg.oz), 10, 140));
      break;
    }
    case 'proj_end':
      endProjectile(msg.id);
      if (msg.hit) {
        bloodlessPoof(msg.x, msg.y, msg.z);
        audio.bodyThud(audio.falloff(distToMe(msg.x, msg.z)));
      } else if (msg.y <= 0.2) {
        dirtPuffAt(msg.x, msg.y, msg.z);
        audio.dirtPuff(audio.falloff(distToMe(msg.x, msg.z)) * 0.6);
      }
      break;
    case 'downed':
      if (msg.id === S.myId) {
        closeReload(true);
        S.reloading = false;
        hud.setAnnouncement('YOU ARE HIT!', 1800);
        dbnoToastShown = false;
      }
      break;
    case 'revived': {
      const pose = poseOf(msg.id);
      if (msg.auto && pose) resurrectionColumn(pose.x, pose.z);
      if (msg.id === S.myId) {
        audio.reviveChime();
        hud.setAnnouncement(msg.auto ? 'THE HEALER RAISES YOU' : 'BACK ON YOUR FEET!', 2000);
      } else if (pose) {
        audio.reviveChime();
      }
      break;
    }
    case 'revive_begin':
      if (msg.medic === S.myId) {
        S.reviving = true;
        S.reviveTarget = msg.target;
        const name = S.participants.get(msg.target)?.name ?? 'the patient';
        openMedic(
          name,
          () => {
            S.reviving = false;
            S.reviveTarget = null;
            send({ type: 'revive_done', target: msg.target });
          },
          () => {
            S.reviving = false;
            S.reviveTarget = null;
            send({ type: 'revive_cancel' });
          },
        );
      } else if (msg.target === S.myId) {
        hud.toast('The medic is with you. Brace yourself.');
      }
      break;
    case 'revive_abort':
      if (msg.medic === S.myId) {
        S.reviving = false;
        S.reviveTarget = null;
        closeMedic(true);
      }
      break;
    case 'note': {
      // Everyone hears the band; the musician already heard themselves.
      const me = myParticipant();
      const iAmThisMusician = me?.cls === 'musician' && me.team === msg.team && me.instrument === msg.instrument;
      if (!iAmThisMusician) playPhrase(msg.instrument, msg.idx, msg.team === myTeam() ? 0.9 : 0.5, `${msg.team}:${msg.instrument}`);
      if (msg.team === myTeam()) hud.pulseReticle();
      break;
    }
    case 'trap':
      spawnTrap(msg.id, msg.x, msg.z, msg.team);
      break;
    case 'trap_sprung': {
      springTrap(msg.id);
      audio.trapSnap(1);
      audio.ouchYelp(1);
      if (msg.victim === S.myId) hud.setAnnouncement('A BEAR TRAP! YOUR LEG!', 2200);
      break;
    }
    case 'tagged':
      if (msg.id === S.myId) hud.setAnnouncement('CAUGHT AT BAYONET-POINT!', 2600);
      else {
        const pose = poseOf(msg.id);
        if (pose) bloodlessPoof(pose.x, 1.2, pose.z);
      }
      audio.bodyThud(0.8);
      break;
    case 'escaped':
      if (msg.id === S.myId) hud.setAnnouncement('YOU GOT AWAY!', 2600);
      break;
    case 'retreat_stage':
      if (msg.stage === 'charge') audio.whistleBlow();
      break;
    case 'announce':
      hud.setAnnouncement(msg.text);
      if (msg.sting) audio.hornSting();
      break;
    default:
      break;
  }
}

function onPhase(msg: Extract<ServerMsg, { type: 'phase' }>): void {
  if (msg.phase === 'countdown' && msg.setup) {
    buildRound();
  }
  if (msg.phase === 'retreat') {
    closeReload(true);
    closeMedic(true);
    S.reloading = false;
    S.reviving = false;
    clearProjectiles();
    trapsLeft = myTeam() === S.retreatTeam ? TRAPS_PER_RETREATER : 0;
  }
  if (msg.phase === 'results' || msg.phase === 'lobby') {
    closeReload(true);
    closeMedic(true);
    setDdrActive(false, 'fife');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  if (msg.phase === 'lobby') {
    for (const s of soldiers.values()) s.dispose();
    soldiers.clear();
    clearProjectiles();
    clearTraps();
    ensureTetherCount(0);
  }
}

function buildRound(): void {
  for (const s of soldiers.values()) s.dispose();
  soldiers.clear();
  clearProjectiles();
  clearTraps();
  for (const part of S.participants.values()) {
    soldiers.set(
      part.id,
      new SoldierView(part.id, part.name, part.team, part.cls, part.instrument),
    );
  }
  const me = myParticipant();
  if (me) {
    predicted.x = me.x;
    predicted.z = me.z;
    predicted.yaw = me.yaw;
    visual.x = me.x;
    visual.z = me.z;
    aimYaw = me.yaw;
    aimPitch = 0;
    localLoaded = me.cls === 'infantry';
    localLoadedAt = 0;
    pendingSteps = [];
    outbox = [];
    dbnoToastShown = false;
  }
}

// ---------- prediction & reconciliation ----------

function reconcile(snap: Snapshot): void {
  const me = snap.players.find((p) => p.id === S.myId);
  if (!me) return;
  pendingSteps = pendingSteps.filter((s) => s.seq > me.ack);
  const replay = { x: me.x, z: me.z, yaw: me.yaw };
  const mode = myMode();
  for (const s of pendingSteps) {
    stepBody(replay, { mx: s.mx, my: s.my, yaw: s.yaw }, mode, s.dt);
  }
  predicted.x = replay.x;
  predicted.z = replay.z;
  // The mouse owns yaw locally, except while charging (server clamps turn rate).
  if (mode === 'charge') predicted.yaw = replay.yaw;
}

// ---------- per-frame update ----------

export function frame(dtMs: number): void {
  const dt = Math.min(0.1, dtMs / 1000);
  const playing = inRound();

  if (playing) {
    updateSelf(dt);
    updateRemotes();
    updateSoldierViews(dt);
    updateTethers();
    updateOverlays(dt);
    updateHudFrame(dt);
    updateCameraPlaying();
  } else {
    // Lobby / results / spectating: a calm look at the field.
    updateRemotes();
    updateSoldierViews(dt);
    updateSpectatorCamera();
    hud.updateHud(emptyHudFrame(), dt);
  }

  updateParticles(dt);
  updateProjectiles(dt);
  renderer.render(scene, camera);
}

function updateSelf(dt: number): void {
  const mode = myMode();
  const mx = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
  const my = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);

  const step: InputStep = { seq: ++seqCounter, dt, mx, my, yaw: aimYaw, pitch: aimPitch };
  stepBody(predicted, { mx, my, yaw: aimYaw }, mode, dt);
  if (mode === 'charge') aimYaw = predicted.yaw; // steering is rate-limited; keep the mouse honest
  pendingSteps.push(step);
  outbox.push(step);
  if (pendingSteps.length > 240) pendingSteps.splice(0, pendingSteps.length - 240);

  sendAccum += dt;
  if (sendAccum >= 1 / INPUT_SEND_RATE && outbox.length > 0) {
    sendAccum = 0;
    send({ type: 'input', steps: outbox });
    outbox = [];
  }

  // Visual smoothing hides small reconciliation corrections.
  const k = 1 - Math.exp(-dt * 18);
  visual.x = lerp(visual.x, predicted.x, k);
  visual.z = lerp(visual.z, predicted.z, k);
}

function updateRemotes(): void {
  remotePoses.clear();
  const snaps = S.snaps;
  if (snaps.length === 0) return;
  const renderT = serverNow() - INTERP_DELAY_MS;
  let s0 = snaps[0]!;
  let s1 = snaps[snaps.length - 1]!;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i]!.t <= renderT) {
      s0 = snaps[i]!;
      s1 = snaps[Math.min(i + 1, snaps.length - 1)]!;
      break;
    }
  }
  const span = s1.t - s0.t;
  const alpha = span > 0 ? clamp((renderT - s0.t) / span, 0, 1) : 1;
  const olderById = new Map(s0.players.map((p) => [p.id, p]));
  for (const p1 of s1.players) {
    const p0 = olderById.get(p1.id) ?? p1;
    remotePoses.set(p1.id, {
      x: lerp(p0.x, p1.x, alpha),
      z: lerp(p0.z, p1.z, alpha),
      yaw: lerpAngle(p0.yaw, p1.yaw, alpha),
    });
  }
}

function poseOf(id: string): { x: number; z: number; yaw: number } | null {
  if (id === S.myId) return { x: visual.x, z: visual.z, yaw: aimYaw };
  return remotePoses.get(id) ?? null;
}

function distToMe(x: number, z: number): number {
  return Math.hypot(x - visual.x, z - visual.z);
}

function updateSoldierViews(dt: number): void {
  const snap = S.latest;
  if (!snap) return;
  const byId = new Map(snap.players.map((p) => [p.id, p]));
  for (const [id, view] of soldiers) {
    const sp = byId.get(id);
    if (!sp) {
      // Player left mid-round.
      view.dispose();
      soldiers.delete(id);
      continue;
    }
    const isSelf = id === S.myId;
    const pose = isSelf ? { x: visual.x, z: visual.z, yaw: aimYaw } : (remotePoses.get(id) ?? sp);
    const isPursuer =
      S.phase === 'retreat' && S.retreatTeam !== null && view.team !== S.retreatTeam;
    const soldierPose: SoldierPose = {
      x: pose.x,
      z: pose.z,
      yaw: pose.yaw,
      status: sp.st,
      reloading: isSelf ? S.reloading : sp.rl === 1,
      reviving: isSelf ? S.reviving : sp.rv === 1,
      trapped: sp.tr === 1,
      charging: isPursuer,
      fixingBayonet: isPursuer && S.retreatStage === 'fixing',
      fleeing: S.phase === 'retreat' && view.team === S.retreatTeam,
    };
    view.update(soldierPose, dt, isSelf, isSelf && reloadActive());
  }
}

function updateTethers(): void {
  const team = myTeam();
  const snap = S.latest;
  if (!team || !snap || !S.setup || S.phase === 'retreat') {
    ensureTetherCount(0);
    return;
  }
  const order = S.setup.lineOrder[team].filter((id) => soldiers.has(id));
  const n = Math.max(0, order.length - 1);
  ensureTetherCount(n);
  const flags = (team === 'red' ? snap.red : snap.blue).tethers;
  const t = performance.now();
  for (let i = 0; i < n; i++) {
    const a = poseOf(order[i]!) ?? null;
    const b = poseOf(order[i + 1]!) ?? null;
    if (a && b) updateTether(i, a.x, a.z, b.x, b.z, flags[i] === 1, t);
  }
}

function updateOverlays(dt: number): void {
  reloadFrame(dt);
  medicFrame(dt);

  const me = mySnap();
  const part = myParticipant();
  const shouldDdr =
    part?.cls === 'musician' &&
    S.phase === 'battle' &&
    me?.st === 'active' &&
    !S.reviving;
  setDdrActive(!!shouldDdr, part?.instrument ?? 'fife');
  ddrFrame();

  // If the server downed or froze us mid-QTE, the overlays fold up.
  if (me && me.st !== 'active') {
    closeReload(true);
    if (S.reloading) {
      S.reloading = false;
    }
  }
}

function updateHudFrame(dt: number): void {
  const me = mySnap();
  const part = myParticipant();
  const team = myTeam();
  const snap = S.latest;
  const teamSnap = team && snap ? (team === 'red' ? snap.red : snap.blue) : null;

  const moving =
    keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD');
  const spreadDeg =
    SPREAD_BASE_DEG * (moving ? SPREAD_MOVING_MULT : 1) * (teamSnap?.spreadMult ?? 1);
  const vfov = deg2rad(camera.fov);
  const ringPx =
    2 * Math.tan(deg2rad(spreadDeg)) * ((innerHeight / 2) / Math.tan(vfov / 2)) *
    (AIM_REF_DISTANCE / AIM_REF_DISTANCE); // spread angle mapped straight to screen angle

  const isInfantry = part?.cls === 'infantry';
  const loaded = me ? isLoadedLocally(me) : false;
  const dbno = me?.st === 'dbno';
  if (dbno && !dbnoToastShown) dbnoToastShown = true;

  let musketText = '';
  let musketClass: '' | 'loaded' | 'empty' = '';
  if (isInfantry && S.phase === 'battle' && me?.st === 'active') {
    if (S.reloading) {
      musketText = '';
    } else if (loaded) {
      musketText = 'LOADED';
      musketClass = 'loaded';
    } else {
      musketText = 'EMPTY — PRESS R TO RELOAD';
      musketClass = 'empty';
    }
  }

  let formationText = '';
  let formationDanger = false;
  if (teamSnap && (S.phase === 'battle' || S.phase === 'countdown') && teamSnap.tethers.length > 0) {
    const broken = teamSnap.tethers.reduce((s, v) => s + v, 0);
    formationText = `LINE: ${broken}/${teamSnap.tethers.length} tethers broken`;
    formationDanger = broken * 2 >= teamSnap.tethers.length && broken > 0;
  }

  let inspirationText = '';
  if (teamSnap && S.phase === 'battle') {
    const parts: string[] = [];
    if (teamSnap.fife > 0.02) parts.push(`fife ${'♪'.repeat(Math.max(1, Math.round(teamSnap.fife * 4)))}`);
    if (teamSnap.drum > 0.02) parts.push(`drum ${'♪'.repeat(Math.max(1, Math.round(teamSnap.drum * 4)))}`);
    inspirationText = parts.length ? `inspiration: ${parts.join('  ')}` : '';
  }

  let trapsText = '';
  if (S.phase === 'retreat' && team === S.retreatTeam && me?.st === 'active') {
    trapsText = trapsLeft > 0 ? `RUN!  Bear traps left: ${trapsLeft} (press F)` : 'RUN FOR THE LINE!';
  }

  let hintText = '';
  if (S.phase === 'battle' && part?.cls === 'medic' && me?.st === 'active' && !S.reviving) {
    const target = nearestDbnoAlly();
    if (target) hintText = `Press E — revive ${target.name}`;
  }
  if (S.phase === 'retreat' && team !== S.retreatTeam) {
    hintText = S.retreatStage === 'fixing' ? 'FIXING BAYONETS...' : 'Run them down! Mind the traps!';
  }
  if (!pointerLocked && S.phase === 'battle') {
    hintText =
      part?.cls === 'infantry' ? 'Click to take command of your musket'
      : part?.cls === 'musician' ? 'Click to take the field (WASD moves, arrows play)'
      : 'Click to take the field';
  }

  let countdownText = '';
  if (S.phase === 'countdown') {
    const secs = Math.max(0, (S.phaseEndsAt - serverNow()) / 1000);
    countdownText = secs > 0.1 ? `${Math.ceil(secs)}` : '';
  }

  hud.updateHud(
    {
      reticlePx: ringPx,
      reticleVisible: !!(isInfantry && S.phase === 'battle' && me?.st === 'active' && !reloadActive() && pointerLocked),
      reticleEmpty: !loaded,
      musketText,
      musketClass,
      formationText,
      formationDanger,
      inspirationText,
      trapsText,
      hintText,
      countdownText,
      dbnoActive: !!dbno,
      dbnoSeconds: me?.dbnoEnd ? (me.dbnoEnd - serverNow()) / 1000 : DBNO_AUTO_RES_MS / 1000,
    },
    dt,
  );
}

function emptyHudFrame(): hud.HudFrame {
  return {
    reticlePx: 0, reticleVisible: false, reticleEmpty: false,
    musketText: '', musketClass: '', formationText: '', formationDanger: false,
    inspirationText: '', trapsText: '', hintText: '', countdownText: '',
    dbnoActive: false, dbnoSeconds: 0,
  };
}

// ---------- cameras ----------

function updateCameraPlaying(): void {
  const me = mySnap();
  const x = visual.x;
  const z = visual.z;

  if (reloadActive()) {
    // First person at eye height: the field stays visible over the minigame.
    const eyeY = 1.62;
    camera.position.set(x, eyeY, z);
    camera.lookAt(
      x + Math.sin(aimYaw) * 8,
      eyeY + Math.tan(aimPitch) * 8 + 0.5,
      z + Math.cos(aimYaw) * 8,
    );
    return;
  }

  const dbno = me?.st === 'dbno';
  const dist = dbno ? 6 : 9.5;
  const height = dbno ? 2.2 : 4.6 - aimPitch * 5.5;
  const back = -dist;
  camera.position.set(
    x + Math.sin(aimYaw) * back,
    Math.max(0.8, height),
    z + Math.cos(aimYaw) * back,
  );
  const lookY = dbno ? 0.6 : 1.5 + Math.tan(aimPitch) * 14;
  camera.lookAt(x + Math.sin(aimYaw) * 10, lookY, z + Math.cos(aimYaw) * 10);
}

let spectatorAngle = 0;

function updateSpectatorCamera(): void {
  spectatorAngle += 0.0006;
  const r = 58;
  camera.position.set(Math.sin(spectatorAngle) * r, 30, Math.cos(spectatorAngle) * r);
  camera.lookAt(0, 0, 0);
}
