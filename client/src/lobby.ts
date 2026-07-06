// Lobby and results screens (plain DOM). The 3D field idles behind them.

import type { ClassType, Instrument, LobbyPlayer, RoundStats, Team } from '../../shared/src/types';
import { send } from './net';
import { S } from './state';

const $ = (id: string) => document.getElementById(id)!;

const CLS_LABEL: Record<string, string> = {
  infantry: 'Infantry',
  medic: 'Medic',
  'musician-fife': 'Fifer',
  'musician-drum': 'Drummer',
};

export function initLobby(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.join-btn')) {
    btn.addEventListener('click', () => send({ type: 'join_team', team: btn.dataset.team as Team }));
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#class-row button')) {
    btn.addEventListener('click', () => {
      const v = btn.dataset.cls!;
      if (v === 'fife' || v === 'drum') {
        send({ type: 'choose_class', cls: 'musician', instrument: v as Instrument });
      } else {
        send({ type: 'choose_class', cls: v as ClassType });
      }
    });
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.bot-btn')) {
    btn.addEventListener('click', () =>
      send({ type: 'add_bot', team: btn.dataset.team as Team, cls: btn.dataset.cls as ClassType }),
    );
  }
  $('balance-btn').addEventListener('click', () => send({ type: 'balance_teams' }));
  $('ready-btn').addEventListener('click', () => {
    const me = S.lobbyPlayers.find((p) => p.id === S.myId);
    send({ type: 'ready', ready: !(me?.ready ?? false) });
  });
}

export function renderLobby(): void {
  const me = S.lobbyPlayers.find((p) => p.id === S.myId) ?? null;
  renderTeamCol('red', $('col-red'), me);
  renderTeamCol('blue', $('col-blue'), me);

  // Class buttons reflect selection and per-team instrument availability.
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#class-row button')) {
    const v = btn.dataset.cls!;
    const selected =
      me?.cls === 'infantry' && v === 'infantry' ? true :
      me?.cls === 'medic' && v === 'medic' ? true :
      me?.cls === 'musician' && me.instrument === v;
    btn.classList.toggle('selected', !!selected);
    if (v === 'fife' || v === 'drum') {
      const taken =
        !!me?.team &&
        S.lobbyPlayers.some(
          (p) => p.id !== S.myId && p.team === me.team && p.cls === 'musician' && p.instrument === v,
        );
      btn.disabled = taken;
      btn.title = taken ? 'Taken on your team' : '';
    }
  }

  const balanceBtn = $('balance-btn') as HTMLButtonElement;
  const redCount = S.lobbyPlayers.filter((p) => p.team === 'red').length;
  const blueCount = S.lobbyPlayers.filter((p) => p.team === 'blue').length;
  balanceBtn.disabled = redCount === blueCount;
  balanceBtn.title = redCount === blueCount
    ? 'The sides are already even'
    : 'Muster AI infantry onto the smaller side until the sides are even';

  const readyBtn = $('ready-btn') as HTMLButtonElement;
  readyBtn.textContent = me?.ready ? 'READY ✓ (click to unready)' : 'READY';
  readyBtn.classList.toggle('armed', !!me?.ready);
  readyBtn.disabled = !me?.team || !me?.cls;

  $('lobby-status').textContent = lobbyStatusText(me);
}

function renderTeamCol(team: Team, col: HTMLElement, me: LobbyPlayer | null): void {
  const members = S.lobbyPlayers.filter((q) => q.team === team);

  const infantry = members.filter((q) => q.cls === 'infantry').length;
  const medics = members.filter((q) => q.cls === 'medic').length;
  const fife = members.some((q) => q.cls === 'musician' && q.instrument === 'fife');
  const drum = members.some((q) => q.cls === 'musician' && q.instrument === 'drum');
  const slot = (has: boolean, label: string) =>
    `<span class="${has ? 'taken' : 'open'}" title="${label} ${has ? 'taken' : 'open'}">${label} ${has ? '✓' : '—'}</span>`;
  col.querySelector('.team-summary')!.innerHTML =
    `<span title="Infantrymen">🔫 ${infantry} infantry</span> · ` +
    `<span title="Medics">🩹 ${medics} medic${medics === 1 ? '' : 's'}</span> · ` +
    `${slot(fife, 'fife')} · ${slot(drum, 'drum')}`;

  const list = col.querySelector('ul')!;
  list.innerHTML = '';
  for (const p of members) {
    const li = document.createElement('li');
    const clsKey = p.cls === 'musician' ? `musician-${p.instrument}` : (p.cls ?? '');
    const cls = CLS_LABEL[clsKey] ?? 'undecided';
    const ready = p.inRound
      ? '<span class="rdy">⚔ in battle</span>'
      : p.ready
        ? '<span class="rdy">✓ ready</span>'
        : '<span class="unrdy">…mustering</span>';
    const tag = p.bot ? ' 🤖' : p.id === S.myId ? ' (you)' : '';
    li.innerHTML = `<b>${escapeHtml(p.name)}</b>${tag} — ${cls} ${ready}`;
    if (p.bot) {
      const kick = document.createElement('button');
      kick.className = 'kick-bot';
      kick.textContent = '✕';
      kick.title = 'Dismiss this AI soldier';
      kick.addEventListener('click', () => send({ type: 'remove_bot', id: p.id }));
      li.appendChild(kick);
    }
    list.appendChild(li);
  }
  const joinBtn = col.querySelector<HTMLButtonElement>('.join-btn')!;
  joinBtn.classList.toggle('selected', me?.team === team);
}

function lobbyStatusText(me: LobbyPlayer | null): string {
  const battleOn = S.phase !== 'lobby' && S.phase !== 'results';
  if (battleOn && !S.participants.has(S.myId)) {
    return 'A battle rages behind this parchment. Ready up to join the next round.';
  }
  if (!me?.team) return 'Choose a side.';
  if (!me?.cls) return 'Choose your post.';
  const unready = S.lobbyPlayers.filter((p) => !p.ready && !p.inRound).length;
  const teams = new Set(S.lobbyPlayers.map((p) => p.team).filter(Boolean));
  if (S.lobbyPlayers.length < 2) return 'Waiting for at least one opponent to muster...';
  if (teams.size < 2) return 'Both sides need at least one soul.';
  const noInf = (['red', 'blue'] as Team[]).filter(
    (t) => !S.lobbyPlayers.some((p) => p.team === t && p.cls === 'infantry'),
  );
  if (noInf.length > 0) return `${noInf.map((t) => (t === 'red' ? 'Redcoats' : 'Continentals')).join(' and ')} need at least one infantryman.`;
  if (unready > 0) return `Waiting on ${unready} ${unready === 1 ? 'man' : 'men'} to ready up...`;
  return 'All ready — forming ranks!';
}

export function setLobbyVisible(show: boolean): void {
  $('lobby').classList.toggle('hidden', !show);
}

export function showResults(stats: RoundStats): void {
  const panel = $('results-panel');
  const name = (id: string) => escapeHtml(stats.names[id] ?? 'a departed soul');
  const best = (rec: Record<string, number>): [string, number] | null => {
    let bestId: string | null = null;
    let bestVal = 0;
    for (const [id, v] of Object.entries(rec)) {
      if (v > bestVal) {
        bestVal = v;
        bestId = id;
      }
    }
    return bestId ? [bestId, bestVal] : null;
  };

  const lines: string[] = [];
  const winLabel = stats.winner === 'red' ? 'THE REDCOATS' : 'THE CONTINENTALS';
  lines.push(`<h1 class="win-${stats.winner}">${winLabel} TAKE THE FIELD</h1>`);
  lines.push(`<p class="tagline">The ${stats.loser} line broke and ran.</p>`);

  const downs = best(stats.downs);
  if (downs) lines.push(`<p class="superlative">🎯 Sharpest shot: <b>${name(downs[0])}</b> — ${downs[1]} men downed</p>`);
  const revives = best(stats.revives);
  if (revives) lines.push(`<p class="superlative">🩹 Angel of the battlefield: <b>${name(revives[0])}</b> — ${revives[1]} revived</p>`);
  const notes = best(stats.notes);
  if (notes) lines.push(`<p class="superlative">🎵 Virtuoso: <b>${name(notes[0])}</b> — ${notes[1]} notes struck</p>`);
  const tags = best(stats.bayonetTags);
  if (tags) lines.push(`<p class="superlative">🔱 Terror of the rout: <b>${name(tags[0])}</b> — ${tags[1]} caught</p>`);
  if (stats.escaped.length > 0) {
    lines.push(`<p class="superlative">🏃 Lived to fight again: ${stats.escaped.map(name).join(', ')}</p>`);
  }
  if (stats.caught.length > 0) {
    lines.push(`<p class="superlative">⛓ Captured: ${stats.caught.map(name).join(', ')}</p>`);
  }
  lines.push('<p class="dim">Back to the muster in a moment...</p>');
  panel.innerHTML = lines.join('');
  $('results').classList.remove('hidden');
}

export function hideResults(): void {
  $('results').classList.add('hidden');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
