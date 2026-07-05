// DOM-based heads-up display: reticle ring, statuses, announcements, toasts.

const el = {
  hud: () => document.getElementById('hud')!,
  reticle: () => document.getElementById('reticle')!,
  musket: () => document.getElementById('musket-status')!,
  formation: () => document.getElementById('formation-status')!,
  inspiration: () => document.getElementById('inspiration')!,
  traps: () => document.getElementById('trap-status')!,
  hint: () => document.getElementById('hint-line')!,
  announce: () => document.getElementById('announce')!,
  countdown: () => document.getElementById('countdown')!,
  dbno: () => document.getElementById('dbno-overlay')!,
  dbnoTimer: () => document.getElementById('dbno-timer')!,
  toast: () => document.getElementById('toast')!,
};

let announceTimer: ReturnType<typeof setTimeout> | null = null;
let reticlePulse = 0; // 1 = fully pulsed (shrunken), decays to 0

export function showHud(show: boolean): void {
  el.hud().classList.toggle('hidden', !show);
}

export function setAnnouncement(text: string, holdMs = 3200): void {
  const node = el.announce();
  node.textContent = text;
  node.style.opacity = '1';
  if (announceTimer) clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    node.style.opacity = '0';
  }, holdMs);
}

export function pulseReticle(): void {
  reticlePulse = 1;
}

export function toast(text: string): void {
  const node = document.createElement('div');
  node.className = 'toast-msg';
  node.textContent = text;
  el.toast().appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

export interface HudFrame {
  reticlePx: number;
  reticleVisible: boolean;
  reticleEmpty: boolean; // musket not loaded
  musketText: string;
  musketClass: '' | 'loaded' | 'empty';
  formationText: string;
  formationDanger: boolean;
  inspirationText: string;
  trapsText: string; // '' hides
  hintText: string;
  countdownText: string;
  dbnoActive: boolean;
  dbnoSeconds: number;
}

export function updateHud(f: HudFrame, dt: number): void {
  reticlePulse = Math.max(0, reticlePulse - dt * 2.2);
  const ret = el.reticle();
  ret.style.display = f.reticleVisible ? '' : 'none';
  if (f.reticleVisible) {
    const size = Math.max(14, f.reticlePx * (1 - reticlePulse * 0.28));
    ret.style.width = `${size}px`;
    ret.style.height = `${size}px`;
    ret.classList.toggle('empty', f.reticleEmpty);
  }

  const musket = el.musket();
  musket.innerHTML = f.musketText ? `<span class="${f.musketClass}">${f.musketText}</span>` : '';

  const formation = el.formation();
  formation.textContent = f.formationText;
  formation.classList.toggle('danger', f.formationDanger);

  el.inspiration().textContent = f.inspirationText;

  const traps = el.traps();
  traps.classList.toggle('hidden', !f.trapsText);
  traps.textContent = f.trapsText;

  el.hint().textContent = f.hintText;
  el.countdown().textContent = f.countdownText;

  el.dbno().classList.toggle('hidden', !f.dbnoActive);
  if (f.dbnoActive) {
    el.dbnoTimer().textContent =
      f.dbnoSeconds > 0.2
        ? `The circuit healer rides to you in ${Math.ceil(f.dbnoSeconds)}s`
        : 'The healer is upon you...';
  }
}
