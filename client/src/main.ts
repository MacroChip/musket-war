import type { ServerMsg } from '../../shared/src/protocol';
import { frame, initGameplay, onServerMsg } from './gameplay';
import * as hud from './hud';
import { hideResults, initLobby, renderLobby, setLobbyVisible, showResults } from './lobby';
import { connect } from './net';
import { clearRound, inRound, noteServerTime, pushSnapshot, S } from './state';
import { unlockAudio } from './audio';

const $ = (id: string) => document.getElementById(id)!;

function boot(): void {
  initGameplay();
  initLobby();

  const input = $('name-input') as HTMLInputElement;
  input.value = localStorage.getItem('musket-name') ?? '';
  const go = (): void => {
    const name = input.value.trim() || 'Minuteman';
    localStorage.setItem('musket-name', name);
    unlockAudio();
    $('conn-status').textContent = 'Mustering...';
    ($('name-go') as HTMLButtonElement).disabled = true;
    connect(name, dispatch, onOpen, onClose);
  };
  $('name-go').addEventListener('click', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  input.focus();

  setLobbyVisible(false);

  let last = performance.now();
  const loop = (now: number): void => {
    frame(now - last);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function onOpen(): void {
  $('conn-status').textContent = '';
}

function onClose(): void {
  S.connected = false;
  $('name-entry').classList.remove('hidden');
  ($('name-go') as HTMLButtonElement).disabled = false;
  $('conn-status').textContent = 'Connection lost. The war continues without you — click to rejoin.';
  setLobbyVisible(false);
  hud.showHud(false);
}

function dispatch(msg: ServerMsg): void {
  switch (msg.type) {
    case 'welcome':
      S.myId = msg.id;
      S.myName = msg.name;
      S.connected = true;
      noteServerTime(msg.t);
      $('name-entry').classList.add('hidden');
      setLobbyVisible(true);
      break;

    case 'error':
      hud.toast(msg.msg);
      break;

    case 'lobby':
      S.lobbyPlayers = msg.players;
      renderLobby();
      break;

    case 'phase':
      S.phase = msg.phase;
      S.phaseEndsAt = msg.endsAt ?? 0;
      if (msg.setup) {
        S.setup = msg.setup;
        S.participants.clear();
        for (const part of msg.setup.participants) S.participants.set(part.id, part);
      }
      if (msg.phase === 'retreat') {
        S.retreatTeam = msg.retreatTeam ?? null;
        S.retreatStage = msg.stage ?? 'fixing';
      }
      if (msg.phase === 'results' && msg.stats) {
        S.stats = msg.stats;
        showResults(msg.stats);
      }
      if (msg.phase === 'lobby') {
        clearRound();
        hideResults();
      }
      onServerMsg(msg);
      updateChrome();
      break;

    case 'retreat_stage':
      S.retreatStage = msg.stage;
      onServerMsg(msg);
      break;

    case 'snap':
      pushSnapshot(msg.snap);
      onServerMsg(msg);
      break;

    default:
      onServerMsg(msg);
      break;
  }
}

/** Which full-screen layers are visible for the current phase. */
function updateChrome(): void {
  const playing = inRound();
  hud.showHud(playing);
  const showLobbyPanel =
    S.phase === 'lobby' || (!playing && S.phase !== 'results');
  setLobbyVisible(showLobbyPanel && S.connected);
  if (S.phase !== 'results') hideResults();
  renderLobby();
}

boot();
