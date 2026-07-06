// The reload ritual, in real time, with your own clumsy hands.
// Stages: prime the pan -> shut the pan -> (musket uprights itself) ->
// pour the barrel -> seat the cartridge -> (ramrod drawn) -> RAM IT HOME.

import { ding, ramTap, setPouring, corkPop } from '../audio';
import { VCursor } from './vcursor';

const W = 680;
const H = 430;

type Stage = 'pan' | 'shut' | 'upright' | 'barrel' | 'cartridge' | 'ramdraw' | 'ram' | 'done';

interface Grain {
  x: number; y: number; vx: number; vy: number; dead: boolean;
}

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let cursor: VCursor;
let active = false;
let stage: Stage = 'pan';
let stageAge = 0;
let pouring = false;
let panFill = 0;
let barrelFill = 0;
let grains: Grain[] = [];
let cartridgeHeld = false;
let cartridgeX = 0;
let cartridgeY = 0;
let cartridgeSeated = false;
let ramDepth = 0;
let lastRamAt = 0;
let onDone: (() => void) | null = null;
let onCancel: (() => void) | null = null;

// Layout constants
const PAN = { x: 386, y: 268, w: 66, h: 16 }; // the flash pan target (small!)
const MUZZLE = { x: W / 2, y: 168, r: 30 }; // barrel mouth once upright
const CART_HOME = { x: 118, y: 330 };

export function initReload(el: HTMLCanvasElement): void {
  canvas = el;
  canvas.width = W;
  canvas.height = H;
  ctx = canvas.getContext('2d')!;
  cursor = new VCursor(W, H);
}

export function reloadActive(): boolean {
  return active;
}

export function openReload(done: () => void, cancel: () => void): void {
  active = true;
  stage = 'pan';
  stageAge = 0;
  panFill = 0;
  barrelFill = 0;
  grains = [];
  pouring = false;
  cartridgeHeld = false;
  cartridgeSeated = false;
  cartridgeX = CART_HOME.x;
  cartridgeY = CART_HOME.y;
  ramDepth = 0;
  onDone = done;
  onCancel = cancel;
  cursor.center();
  canvas.classList.remove('hidden');
}

export function closeReload(silent = false): void {
  if (!active) return;
  active = false;
  setPouring(false);
  canvas.classList.add('hidden');
  if (!silent && onCancel) onCancel();
}

export function reloadMouseMove(dx: number, dy: number): void {
  cursor.move(dx * 0.9, dy * 0.9);
  if (cartridgeHeld) {
    cartridgeX = cursor.x;
    cartridgeY = cursor.y;
  }
}

export function reloadMouseDown(): void {
  if (stage === 'pan' || stage === 'barrel') {
    pouring = true;
    setPouring(true);
  } else if (stage === 'shut') {
    // Click anywhere near the pan to snap the frizzen shut.
    if (Math.abs(cursor.x - (PAN.x + PAN.w / 2)) < 90 && Math.abs(cursor.y - PAN.y) < 70) {
      corkPop();
      setStage('upright');
    }
  } else if (stage === 'cartridge' && !cartridgeSeated) {
    if (Math.hypot(cursor.x - cartridgeX, cursor.y - cartridgeY) < 44) {
      cartridgeHeld = true;
    }
  }
}

export function reloadMouseUp(): void {
  if (pouring) {
    pouring = false;
    setPouring(false);
  }
  if (stage === 'cartridge' && cartridgeHeld) {
    cartridgeHeld = false;
    if (Math.hypot(cartridgeX - MUZZLE.x, cartridgeY - MUZZLE.y) < MUZZLE.r) {
      cartridgeSeated = true;
      corkPop();
      setStage('ramdraw');
    } else {
      // Dropped it. Back to the belt with a sad little bounce.
      cartridgeX = CART_HOME.x;
      cartridgeY = CART_HOME.y;
    }
  }
}

/** Returns true if the key was consumed. */
export function reloadKey(code: string): boolean {
  if (!active) return false;
  if (code === 'Escape') {
    closeReload();
    return true;
  }
  if (code === 'ArrowDown' && stage === 'ram') {
    const now = performance.now();
    if (now - lastRamAt > 70) {
      lastRamAt = now;
      ramDepth = Math.min(100, ramDepth + 9);
      ramTap(ramDepth / 100);
      if (ramDepth >= 100) {
        ding();
        setStage('done');
        active = false;
        setPouring(false);
        canvas.classList.add('hidden');
        onDone?.();
      }
    }
    return true;
  }
  // Swallow arrows so the page doesn't scroll and DDR doesn't hear them.
  return code.startsWith('Arrow');
}

function setStage(s: Stage): void {
  stage = s;
  stageAge = 0;
  grains = [];
}

export function reloadFrame(dt: number): void {
  if (!active) return;
  stageAge += dt;

  // Auto stages advance on a timer.
  if (stage === 'upright' && stageAge > 0.8) setStage('barrel');
  if (stage === 'ramdraw' && stageAge > 0.7) setStage('ram');

  // Pouring spawns powder grains at the horn spout with a wobbly hand.
  if (pouring && (stage === 'pan' || stage === 'barrel')) {
    for (let i = 0; i < 3; i++) {
      grains.push({
        x: cursor.x + 14 + (Math.random() - 0.5) * 7,
        y: cursor.y + 20,
        vx: (Math.random() - 0.5) * 36 + Math.sin(performance.now() / 90) * 22,
        vy: 40 + Math.random() * 30,
        dead: false,
      });
    }
  }

  // Grain physics.
  const catchY = stage === 'pan' ? PAN.y : MUZZLE.y;
  for (const g of grains) {
    if (g.dead) continue;
    g.vy += 560 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    if (stage === 'pan') {
      if (g.y >= PAN.y - 4 && g.x >= PAN.x && g.x <= PAN.x + PAN.w) {
        g.dead = true;
        panFill = Math.min(120, panFill + 1.1);
      } else if (g.y > PAN.y + 30) {
        g.dead = true;
      }
    } else if (stage === 'barrel') {
      if (g.y >= MUZZLE.y - 6 && Math.hypot(g.x - MUZZLE.x, g.y - MUZZLE.y) < MUZZLE.r * 0.8) {
        g.dead = true;
        barrelFill = Math.min(120, barrelFill + 1.1);
      } else if (g.y > MUZZLE.y + 40) {
        g.dead = true;
      }
    } else if (g.y > catchY + 60) {
      g.dead = true;
    }
  }
  grains = grains.filter((g) => !g.dead).slice(-400);

  if (stage === 'pan' && panFill >= 100) setStage('shut');
  if (stage === 'barrel' && barrelFill >= 100) setStage('cartridge');

  draw();
}

// ---------- drawing ----------

function draw(): void {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f0e6d0';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#2b241a';
  ctx.font = 'bold 21px Georgia, serif';
  ctx.textAlign = 'center';

  switch (stage) {
    case 'pan':
      drawMusketSide();
      drawInstruction('Hold the mouse button: pour powder into the PAN. Careful, now.');
      // Show exactly where the powder must land.
      ctx.save();
      ctx.strokeStyle = '#c9a53f';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(PAN.x - 4, PAN.y - 10, PAN.w + 8, PAN.h + 14);
      ctx.setLineDash([]);
      ctx.restore();
      drawHorn();
      drawMeter(PAN.x - 40, PAN.y + 46, panFill, 'pan');
      break;
    case 'shut':
      drawMusketSide();
      drawInstruction('Good. CLICK the pan to snap the frizzen shut.');
      ctx.strokeStyle = '#c9a53f';
      ctx.lineWidth = 3;
      ctx.strokeRect(PAN.x - 14, PAN.y - 30, PAN.w + 28, 52);
      break;
    case 'upright':
      drawInstruction('Musket upright...');
      drawMusketRotating(stageAge / 0.8);
      break;
    case 'barrel':
      drawMusketUpright();
      drawInstruction('Pour powder down the MUZZLE.');
      drawHorn();
      drawMeter(MUZZLE.x - 40, MUZZLE.y + 70, barrelFill, 'barrel');
      break;
    case 'cartridge':
      drawMusketUpright();
      drawInstruction('Drag the CARTRIDGE from your belt into the muzzle.');
      drawCartridge();
      break;
    case 'ramdraw':
      drawMusketUpright();
      drawInstruction('Ramrod drawn...');
      drawRamrod(0);
      break;
    case 'ram':
      drawMusketUpright();
      drawInstruction('MASH ⬇ to ram it home!');
      drawRamrod(ramDepth / 100);
      drawMeter(MUZZLE.x - 40, MUZZLE.y + 70, ramDepth, 'seat');
      break;
    case 'done':
      break;
  }

  // Powder grains
  ctx.fillStyle = '#3a3128';
  for (const g of grains) {
    if (!g.dead) ctx.fillRect(g.x - 1.5, g.y - 1.5, 3, 3);
  }

  ctx.font = 'italic 13px Georgia, serif';
  ctx.fillStyle = '#6a5d48';
  ctx.fillText('Esc: abandon reload', 14, 20);

  if (stage === 'pan' || stage === 'barrel' || stage === 'shut' || stage === 'cartridge') {
    cursor.draw(ctx);
  }
}

function drawInstruction(text: string): void {
  ctx.fillStyle = '#2b241a';
  ctx.font = 'bold 19px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, 46);
}

function drawMusketSide(): void {
  // Stock and barrel, side-on, lock centered.
  ctx.fillStyle = '#6e4a2f';
  ctx.beginPath();
  ctx.moveTo(80, 300);
  ctx.lineTo(560, 282);
  ctx.lineTo(560, 296);
  ctx.lineTo(140, 322);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#9ea6ad';
  ctx.fillRect(150, 274, 460, 9);
  // Lock plate + pan
  ctx.fillStyle = '#7d848c';
  ctx.beginPath();
  ctx.ellipse(PAN.x + PAN.w / 2, PAN.y + 14, 62, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b636b';
  ctx.fillRect(PAN.x, PAN.y - 4, PAN.w, PAN.h); // the pan itself
  ctx.fillStyle = '#3a3128';
  const fillW = (Math.min(panFill, 100) / 100) * (PAN.w - 8);
  ctx.fillRect(PAN.x + 4, PAN.y - 2, fillW, 8);
  // Cock with flint
  ctx.strokeStyle = '#4a5057';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(PAN.x + PAN.w + 26, PAN.y + 18);
  ctx.quadraticCurveTo(PAN.x + PAN.w + 44, PAN.y - 26, PAN.x + PAN.w + 18, PAN.y - 34);
  ctx.stroke();
}

function drawMusketUpright(): void {
  ctx.fillStyle = '#9ea6ad';
  ctx.fillRect(MUZZLE.x - 13, MUZZLE.y, 26, 240);
  ctx.fillStyle = '#6e4a2f';
  ctx.fillRect(MUZZLE.x - 20, MUZZLE.y + 150, 40, 90);
  // muzzle mouth
  ctx.fillStyle = '#2b241a';
  ctx.beginPath();
  ctx.ellipse(MUZZLE.x, MUZZLE.y, MUZZLE.r * 0.75, MUZZLE.r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7d848c';
  ctx.lineWidth = 5;
  ctx.stroke();
}

function drawMusketRotating(t: number): void {
  const a = Math.min(1, t) * -Math.PI / 2;
  ctx.save();
  ctx.translate(W / 2, 290);
  ctx.rotate(a);
  ctx.fillStyle = '#6e4a2f';
  ctx.fillRect(-230, -8, 460, 16);
  ctx.fillStyle = '#9ea6ad';
  ctx.fillRect(-230, -12, 460, 6);
  ctx.restore();
}

function drawHorn(): void {
  ctx.save();
  ctx.translate(cursor.x, cursor.y);
  ctx.rotate(pouring ? 0.9 : 0.4);
  ctx.fillStyle = '#d9c9a3';
  ctx.beginPath();
  ctx.moveTo(-6, 26);
  ctx.quadraticCurveTo(-38, -6, -10, -30);
  ctx.quadraticCurveTo(6, -14, 8, 18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8a7452';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawCartridge(): void {
  ctx.save();
  ctx.translate(cartridgeX, cartridgeY);
  ctx.rotate(cartridgeHeld ? 0.15 : 0.6);
  ctx.fillStyle = '#e8ddc0';
  ctx.fillRect(-11, -26, 22, 52);
  ctx.strokeStyle = '#8a7452';
  ctx.lineWidth = 2;
  ctx.strokeRect(-11, -26, 22, 52);
  // twisted paper top
  ctx.beginPath();
  ctx.moveTo(-8, -26);
  ctx.quadraticCurveTo(0, -40, 8, -26);
  ctx.stroke();
  ctx.restore();
  if (!cartridgeHeld) {
    ctx.font = 'italic 13px Georgia, serif';
    ctx.fillStyle = '#6a5d48';
    ctx.textAlign = 'center';
    ctx.fillText('your belt', CART_HOME.x, CART_HOME.y + 44);
  }
}

function drawRamrod(depth: number): void {
  const topY = MUZZLE.y - 130 + depth * 120;
  ctx.fillStyle = '#c9b489';
  ctx.fillRect(MUZZLE.x - 4, topY, 8, 150);
  ctx.beginPath();
  ctx.arc(MUZZLE.x, topY, 9, 0, Math.PI * 2);
  ctx.fill();
}

function drawMeter(x: number, y: number, value: number, label: string): void {
  ctx.fillStyle = '#d9cdb0';
  ctx.fillRect(x, y, 80, 12);
  ctx.fillStyle = value >= 100 ? '#2e7d32' : '#8a6d3b';
  ctx.fillRect(x, y, Math.min(1, value / 100) * 80, 12);
  ctx.strokeStyle = '#2b241a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, 80, 12);
  ctx.font = '12px Georgia, serif';
  ctx.fillStyle = '#2b241a';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 86, y + 10);
}
