// All sound is synthesized with WebAudio — no assets, era-appropriate-ish.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let pourNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let muted = false;

function ac(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function out(): GainNode {
  ac();
  return master!;
}

export function unlockAudio(): void {
  ac();
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

/** 0..1 gain based on distance from the listener. */
export function falloff(dist: number, full = 8, silent = 90): number {
  if (dist <= full) return 1;
  if (dist >= silent) return 0.05;
  return 1 - (dist - full) / (silent - full) * 0.95;
}

function noiseBuffer(seconds: number): AudioBuffer {
  const c = ac();
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function envGain(at: number, peak: number, attack: number, decay: number): GainNode {
  const c = ac();
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(out());
  return g;
}

// ---------- musket ----------

export function panSizzle(vol = 1): void {
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.22);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3800;
  src.connect(hp).connect(envGain(t, 0.36 * vol, 0.002, 0.2));
  src.start(t);

  // A tiny metallic flint tick makes the spark read before the powder catches.
  const tick = c.createOscillator();
  tick.type = 'triangle';
  tick.frequency.setValueAtTime(3200, t);
  tick.frequency.exponentialRampToValueAtTime(1700, t + 0.035);
  tick.connect(envGain(t, 0.12 * vol, 0.001, 0.045));
  tick.start(t);
  tick.stop(t + 0.06);
}

export function musketBang(vol = 1): void {
  const c = ac();
  const t = c.currentTime;
  // Boom: a longer, darker filtered noise burst with extra low-end body.
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.72);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(760, t);
  lp.frequency.exponentialRampToValueAtTime(85, t + 0.58);
  src.connect(lp).connect(envGain(t, 1.05 * vol, 0.002, 0.62));
  src.start(t);
  // Sub thump
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(92, t);
  osc.frequency.exponentialRampToValueAtTime(32, t + 0.34);
  osc.connect(envGain(t, 0.75 * vol, 0.002, 0.4));
  osc.start(t);
  osc.stop(t + 0.48);

  // A short low echo gives the musket more chesty boom without using assets.
  for (const [delay, gain] of [[0.08, 0.22], [0.17, 0.12]] as const) {
    const echo = c.createBufferSource();
    echo.buffer = noiseBuffer(0.28);
    const echoLp = c.createBiquadFilter();
    echoLp.type = 'lowpass';
    echoLp.frequency.value = 210;
    echo.connect(echoLp).connect(envGain(t + delay, gain * vol, 0.004, 0.26));
    echo.start(t + delay);
  }
}

export function dryClick(): void {
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.03);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2500;
  src.connect(bp).connect(envGain(t, 0.3, 0.001, 0.04));
  src.start(t);
}

export function bodyThud(vol = 1): void {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  osc.connect(envGain(t, 0.5 * vol, 0.003, 0.16));
  osc.start(t);
  osc.stop(t + 0.2);
}

export function dirtPuff(vol = 1): void {
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.08);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  src.connect(lp).connect(envGain(t, 0.25 * vol, 0.002, 0.09));
  src.start(t);
}

// ---------- music ----------

/** Current time on the audio clock, for scheduling phrases ahead. */
export function audioNow(): number {
  return ac().currentTime;
}

export function fifeNote(freqs: number[], vol = 1, when?: number): void {
  const c = ac();
  let t = Math.max(when ?? 0, c.currentTime);
  for (const f of freqs) {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, t);
    // A touch of vibrato so it whistles rather than beeps.
    const vib = c.createOscillator();
    vib.frequency.value = 6;
    const vibGain = c.createGain();
    vibGain.gain.value = f * 0.006;
    vib.connect(vibGain).connect(osc.frequency);
    const dur = freqs.length > 1 ? 0.16 : 0.24;
    osc.connect(envGain(t, 0.3 * vol, 0.02, dur));
    osc.start(t);
    osc.stop(t + dur + 0.05);
    vib.start(t);
    vib.stop(t + dur + 0.05);
    t += dur * 0.9;
  }
}

export function drumHit(kind: 'k' | 's' | 'f', vol = 1, when?: number): void {
  const c = ac();
  const t = Math.max(when ?? 0, c.currentTime);
  if (kind === 'k' || kind === 'f') {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    osc.connect(envGain(t, 0.6 * vol, 0.002, 0.22));
    osc.start(t);
    osc.stop(t + 0.28);
  }
  if (kind === 's' || kind === 'f') {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(0.15);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    src.connect(bp).connect(envGain(t, 0.35 * vol, 0.002, 0.13));
    src.start(t);
  }
}

export function sourNote(): void {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.linearRampToValueAtTime(180, t + 0.15);
  osc.connect(envGain(t, 0.12, 0.01, 0.18));
  osc.start(t);
  osc.stop(t + 0.25);
}

// ---------- events ----------

export function whistleBlow(): void {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(2100, t);
  osc.frequency.linearRampToValueAtTime(2600, t + 0.1);
  osc.frequency.linearRampToValueAtTime(2200, t + 0.35);
  osc.frequency.linearRampToValueAtTime(2700, t + 0.5);
  const warble = c.createOscillator();
  warble.frequency.value = 22;
  const wg = c.createGain();
  wg.gain.value = 180;
  warble.connect(wg).connect(osc.frequency);
  osc.connect(envGain(t, 0.35, 0.02, 0.8));
  osc.start(t);
  osc.stop(t + 0.9);
  warble.start(t);
  warble.stop(t + 0.9);
}

export function hornSting(): void {
  const c = ac();
  const t = c.currentTime;
  for (const [i, f] of [262, 392].entries()) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    osc.connect(lp).connect(envGain(t + i * 0.18, 0.22, 0.03, 0.4));
    osc.start(t + i * 0.18);
    osc.stop(t + i * 0.18 + 0.5);
  }
}

export function trapSnap(vol = 1): void {
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.05);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  src.connect(hp).connect(envGain(t, 0.7 * vol, 0.001, 0.06));
  src.start(t);
  // Metallic ring
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 640;
  osc.connect(envGain(t + 0.01, 0.15 * vol, 0.001, 0.2));
  osc.start(t + 0.01);
  osc.stop(t + 0.25);
}

export function ouchYelp(vol = 1): void {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(380, t);
  osc.frequency.exponentialRampToValueAtTime(700, t + 0.08);
  osc.frequency.exponentialRampToValueAtTime(240, t + 0.3);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  osc.connect(lp).connect(envGain(t, 0.25 * vol, 0.01, 0.3));
  osc.start(t);
  osc.stop(t + 0.36);
}

export function reviveChime(): void {
  const c = ac();
  const t = c.currentTime;
  const chord = [523.25, 659.25, 783.99, 1046.5];
  for (const [i, f] of chord.entries()) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.connect(envGain(t + i * 0.06, 0.16, 0.08, 1.15));
    osc.start(t + i * 0.06);
    osc.stop(t + i * 0.06 + 1.3);

    const shimmer = c.createOscillator();
    shimmer.type = 'triangle';
    shimmer.frequency.value = f * 2;
    shimmer.connect(envGain(t + 0.12 + i * 0.045, 0.055, 0.03, 0.75));
    shimmer.start(t + 0.12 + i * 0.045);
    shimmer.stop(t + 0.95 + i * 0.045);
  }

  const breath = c.createBufferSource();
  breath.buffer = noiseBuffer(1.35);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(3200, t);
  bp.frequency.exponentialRampToValueAtTime(5200, t + 0.9);
  bp.Q.value = 0.45;
  breath.connect(bp).connect(envGain(t, 0.055, 0.35, 0.95));
  breath.start(t);
}

export function corkPop(): void {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.04);
  osc.connect(envGain(t, 0.4, 0.002, 0.07));
  osc.start(t);
  osc.stop(t + 0.1);
}

export function ramTap(progress: number): void {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 220 + progress * 260; // rises in pitch as the ball seats
  osc.connect(envGain(t, 0.3, 0.001, 0.09));
  osc.start(t);
  osc.stop(t + 0.12);
}

export function ding(): void {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 1046;
  osc.connect(envGain(t, 0.25, 0.005, 0.6));
  osc.start(t);
  osc.stop(t + 0.65);
}

export function setPouring(on: boolean): void {
  const c = ac();
  if (on && !pourNode) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(1);
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.value = 0.12;
    src.connect(bp).connect(g).connect(out());
    src.start();
    pourNode = { src, gain: g };
  } else if (!on && pourNode) {
    pourNode.src.stop();
    pourNode = null;
  }
}
