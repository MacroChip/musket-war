// Field medicine, 1776 edition: a bracing shot of whiskey, then leeches,
// applied with clinical confidence.

import { corkPop, reviveChime, sourNote } from '../audio';
import { VCursor } from './vcursor';

const W = 560;
const H = 380;

type Stage = 'whiskey' | 'leeches' | 'done';

interface LeechSpot {
  x: number;
  y: number;
  placed: boolean;
}

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let cursor: VCursor;
let active = false;
let stage: Stage = 'whiskey';
let patientName = '';
let pourLevel = 0; // 0..100
let pourHolding = false;
let overfills = 0;
let leeches: LeechSpot[] = [];
let onDone: (() => void) | null = null;
let onCancel: (() => void) | null = null;

const ZONE_LO = 62;
const ZONE_HI = 90;

export function initMedic(el: HTMLCanvasElement): void {
  canvas = el;
  canvas.width = W;
  canvas.height = H;
  ctx = canvas.getContext('2d')!;
  cursor = new VCursor(W, H);
}

export function medicActive(): boolean {
  return active;
}

export function openMedic(name: string, done: () => void, cancel: () => void): void {
  active = true;
  stage = 'whiskey';
  patientName = name;
  pourLevel = 0;
  pourHolding = false;
  overfills = 0;
  leeches = [];
  for (let i = 0; i < 3; i++) {
    leeches.push({
      x: 200 + Math.random() * 220,
      y: 150 + Math.random() * 150,
      placed: false,
    });
  }
  onDone = done;
  onCancel = cancel;
  cursor.center();
  canvas.classList.remove('hidden');
}

export function closeMedic(silent = false): void {
  if (!active) return;
  active = false;
  canvas.classList.add('hidden');
  if (!silent && onCancel) onCancel();
}

export function medicMouseMove(dx: number, dy: number): void {
  cursor.move(dx * 0.9, dy * 0.9);
}

export function medicMouseDown(): void {
  if (stage === 'whiskey') {
    pourHolding = true;
  } else if (stage === 'leeches') {
    const next = leeches.find((l) => !l.placed);
    if (next && Math.hypot(cursor.x - next.x, cursor.y - next.y) < 26) {
      next.placed = true;
      corkPop();
      if (leeches.every((l) => l.placed)) {
        stage = 'done';
        reviveChime();
        active = false;
        canvas.classList.add('hidden');
        onDone?.();
      }
    } else {
      sourNote(); // leech applied to thin air
    }
  }
}

export function medicMouseUp(): void {
  if (stage === 'whiskey' && pourHolding) {
    pourHolding = false;
    if (pourLevel >= ZONE_LO && pourLevel <= ZONE_HI) {
      corkPop();
      stage = 'leeches';
    } else if (pourLevel > ZONE_HI) {
      overfills++;
      sourNote();
      pourLevel = 0;
    } else {
      pourLevel = Math.max(0, pourLevel - 12); // he dribbles it back out
    }
  }
}

export function medicKey(code: string): boolean {
  if (!active) return false;
  if (code === 'Escape') {
    closeMedic();
    return true;
  }
  return false;
}

export function medicFrame(dt: number): void {
  if (!active) return;
  if (stage === 'whiskey') {
    if (pourHolding) pourLevel = Math.min(110, pourLevel + dt * 55);
    if (pourLevel > 108) {
      // He is now extremely revived in spirit only. Start over.
      pourHolding = false;
      overfills++;
      sourNote();
      pourLevel = 0;
    }
  }
  draw();
}

function draw(): void {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f0e6d0';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#2b241a';
  ctx.font = 'bold 19px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Reviving ${patientName}`, W / 2, 32);

  // The patient: a fainted silhouette.
  ctx.fillStyle = '#c9b489';
  ctx.beginPath();
  ctx.ellipse(140, 200, 28, 24, 0, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.fillStyle = stage === 'whiskey' ? '#b3452e' : '#c9b489';
  ctx.beginPath();
  ctx.ellipse(310, 230, 150, 55, 0.06, 0, Math.PI * 2); // torso
  ctx.fillStyle = '#a93226';
  ctx.fill();

  if (stage === 'whiskey') {
    ctx.fillStyle = '#2b241a';
    ctx.font = '16px Georgia, serif';
    ctx.fillText('Hold the mouse to pour whiskey. Release in the green. Do NOT drown him.', W / 2, 60);

    // Bottle at cursor
    ctx.save();
    ctx.translate(cursor.x, cursor.y);
    ctx.rotate(pourHolding ? 1.2 : 0.5);
    ctx.fillStyle = '#5b4a2f';
    ctx.fillRect(-9, -34, 18, 48);
    ctx.fillRect(-4, -48, 8, 16);
    ctx.restore();
    if (pourHolding) {
      ctx.strokeStyle = '#c9852f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cursor.x + 10, cursor.y - 10);
      ctx.quadraticCurveTo(cursor.x + 20, cursor.y + 40, 150, 190);
      ctx.stroke();
    }

    // Pour meter with target zone
    const mx = W / 2 - 110;
    const my = 320;
    ctx.fillStyle = '#d9cdb0';
    ctx.fillRect(mx, my, 220, 18);
    ctx.fillStyle = 'rgba(46,125,50,0.35)';
    ctx.fillRect(mx + (ZONE_LO / 110) * 220, my, ((ZONE_HI - ZONE_LO) / 110) * 220, 18);
    ctx.fillStyle = '#c9852f';
    ctx.fillRect(mx, my, (pourLevel / 110) * 220, 18);
    ctx.strokeStyle = '#2b241a';
    ctx.strokeRect(mx, my, 220, 18);
    if (overfills > 0) {
      ctx.font = 'italic 14px Georgia, serif';
      ctx.fillStyle = '#7a4a3a';
      ctx.fillText(
        overfills === 1 ? 'He coughed it all back up. Again.' : `He's had ${overfills} full bottles. He must live to pay his tab.`,
        W / 2, my + 40,
      );
    }
  } else if (stage === 'leeches') {
    ctx.fillStyle = '#2b241a';
    ctx.font = '16px Georgia, serif';
    ctx.fillText('Now the medicine: CLICK to place each leech on the mark.', W / 2, 60);

    const next = leeches.find((l) => !l.placed);
    for (const l of leeches) {
      if (l.placed) {
        // A settled, content leech.
        ctx.fillStyle = '#2f2a24';
        ctx.beginPath();
        ctx.ellipse(l.x, l.y, 14, 7, 0.6, 0, Math.PI * 2);
        ctx.fill();
      } else if (l === next) {
        ctx.strokeStyle = '#c9a53f';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(l.x, l.y, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const placed = leeches.filter((l) => l.placed).length;
    ctx.font = 'italic 14px Georgia, serif';
    ctx.fillText(`${placed} / 3 leeches placed`, W / 2, 350);
  }

  ctx.font = 'italic 13px Georgia, serif';
  ctx.fillStyle = '#6a5d48';
  ctx.textAlign = 'left';
  ctx.fillText('Esc: abandon patient', 14, 20);

  cursor.draw(ctx);
}
