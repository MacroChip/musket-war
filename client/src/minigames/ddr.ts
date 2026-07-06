// The musician's lot: keep the tune going with arrow keys while walking with
// WASD. Notes drift right-to-left; strike them in the ring. Guitar Hero easy
// mode: notes are sparse, and every hit plays the next whole phrase of the
// song — keep hitting and the tune flows without pause.

import {
  HIT_WINDOW_GOOD_MS, HIT_WINDOW_PERFECT_MS, NOTE_SPACING_MS_MAX, NOTE_SPACING_MS_MIN, NOTE_TRAVEL_MS,
  DRUM_SONG, FIFE_SONG, PHRASE_SEGMENTS, PHRASE_STEP_MS,
} from '../../../shared/src/song';
import type { Instrument } from '../../../shared/src/types';
import { audioNow, drumHit, fifeNote, sourNote } from '../audio';
import { send } from '../net';

const W = 720;
const H = 130;
const HIT_X = 90; // center of the hit ring
const ARROWS = ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'] as const;
const GLYPHS = ['◀', '▼', '▲', '▶'];

interface Note {
  idx: number;
  arrow: number; // 0..3
  hitTime: number; // performance.now() ms when it crosses the ring
  state: 'coming' | 'hit' | 'missed';
  grade?: 'good' | 'perfect';
}

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let active = false;
let instrument: Instrument = 'fife';
let notes: Note[] = [];
let nextNoteAt = 0;
let noteCounter = 0;
let flashUntil = 0;
let flashText = '';

export function initDdr(el: HTMLCanvasElement): void {
  canvas = el;
  canvas.width = W;
  canvas.height = H;
  ctx = canvas.getContext('2d')!;
}

export function setDdrActive(on: boolean, inst: Instrument): void {
  if (on && !active) {
    notes = [];
    nextNoteAt = performance.now() + 1200;
    instrument = inst;
  }
  active = on;
  canvas.classList.toggle('hidden', !on);
}

export function ddrActive(): boolean {
  return active;
}

// Where each performer's current phrase ends on the audio clock, so the next
// phrase queues up right behind it instead of talking over it.
const phraseEndAt = new Map<string, number>();

/**
 * Play the whole song phrase for a note index (used for remote echoes too).
 * `chan` identifies the performer ('local', or team:instrument for echoes) so
 * overlapping musicians don't queue behind one another.
 */
export function playPhrase(inst: Instrument, idx: number, vol = 1, chan = 'local'): void {
  const len = PHRASE_SEGMENTS[inst];
  const step = PHRASE_STEP_MS[inst] / 1000;
  const now = audioNow();
  // Chain after this performer's playing phrase, but never lag the battle by
  // more than a beat or two — better a brief overlap than a tune in the past.
  let t = Math.max(now, Math.min(phraseEndAt.get(chan) ?? 0, now + 0.5));
  for (let k = 0; k < len; k++) {
    const s = idx * len + k;
    if (inst === 'fife') fifeNote(FIFE_SONG[s % FIFE_SONG.length]!.freqs, vol, t);
    else drumHit(DRUM_SONG[s % DRUM_SONG.length]!, vol, t);
    t += step;
  }
  phraseEndAt.set(chan, t);
}

/** Returns true if the key was consumed. */
export function ddrKey(code: string): boolean {
  if (!active) return false;
  const arrow = ARROWS.indexOf(code as (typeof ARROWS)[number]);
  if (arrow === -1) return false;

  const now = performance.now();
  let best: Note | null = null;
  let bestDelta = Infinity;
  for (const n of notes) {
    if (n.state !== 'coming' || n.arrow !== arrow) continue;
    const d = Math.abs(n.hitTime - now);
    if (d < bestDelta) {
      bestDelta = d;
      best = n;
    }
  }
  if (best && bestDelta <= HIT_WINDOW_GOOD_MS) {
    best.state = 'hit';
    best.grade = bestDelta <= HIT_WINDOW_PERFECT_MS ? 'perfect' : 'good';
    flashText = best.grade === 'perfect' ? 'PERFECT' : 'GOOD';
    flashUntil = now + 450;
    playPhrase(instrument, best.idx); // local echo; our own server broadcast is skipped
    send({ type: 'note_hit', idx: best.idx, grade: best.grade });
  } else {
    flashText = 'SOUR!';
    flashUntil = now + 350;
    sourNote();
  }
  return true;
}

export function ddrFrame(): void {
  if (!active) return;
  const now = performance.now();

  // Spawn upcoming notes.
  if (now >= nextNoteAt) {
    notes.push({
      idx: noteCounter++,
      arrow: Math.floor(Math.random() * 4),
      hitTime: now + NOTE_TRAVEL_MS,
      state: 'coming',
    });
    nextNoteAt = now + NOTE_SPACING_MS_MIN + Math.random() * (NOTE_SPACING_MS_MAX - NOTE_SPACING_MS_MIN);
  }
  // Cull and mark misses.
  for (const n of notes) {
    if (n.state === 'coming' && now > n.hitTime + HIT_WINDOW_GOOD_MS) n.state = 'missed';
  }
  notes = notes.filter((n) => now - n.hitTime < 900);

  draw(now);
}

function draw(now: number): void {
  ctx.clearRect(0, 0, W, H);

  // Lane
  ctx.strokeStyle = 'rgba(240,230,208,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, H / 2);
  ctx.lineTo(W - 20, H / 2);
  ctx.stroke();

  // Hit ring
  ctx.strokeStyle = '#c9a53f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(HIT_X, H / 2, 26, 0, Math.PI * 2);
  ctx.stroke();

  // Notes
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const n of notes) {
    const t = (n.hitTime - now) / NOTE_TRAVEL_MS; // 1 = spawn edge, 0 = ring
    const x = HIT_X + t * (W - 40 - HIT_X);
    const y = H / 2;
    if (n.state === 'hit') {
      ctx.fillStyle = n.grade === 'perfect' ? '#ffe08a' : '#b8e6a0';
      ctx.globalAlpha = Math.max(0, 1 - (now - n.hitTime + 0) / 400);
    } else if (n.state === 'missed') {
      ctx.fillStyle = '#777';
      ctx.globalAlpha = 0.5;
    } else {
      ctx.fillStyle = '#f0e6d0';
      ctx.globalAlpha = 1;
    }
    ctx.fillText(GLYPHS[n.arrow]!, n.state === 'hit' ? HIT_X : x, y);
  }
  ctx.globalAlpha = 1;

  // Feedback flash
  if (now < flashUntil) {
    ctx.font = 'bold 20px Georgia, serif';
    ctx.fillStyle = flashText === 'SOUR!' ? '#ff9c8a' : '#ffe08a';
    ctx.fillText(flashText, HIT_X, 22);
  }

  ctx.font = 'italic 13px Georgia, serif';
  ctx.fillStyle = 'rgba(240,230,208,0.75)';
  ctx.textAlign = 'right';
  ctx.fillText(`${instrument === 'fife' ? 'Yankee Doodle' : 'field cadence'} — each hit plays the next phrase, WASD still moves you`, W - 16, H - 12);
}
