import * as THREE from 'three';
import { PROJ_GRAVITY, TETHER_MAX_DIST, TETHER_WARN_DIST } from '../../../shared/src/constants';
import type { Team } from '../../../shared/src/types';
import { scene } from './scene';

// ---------- soft particle texture ----------

let puffTexture: THREE.Texture | null = null;
function getPuffTexture(): THREE.Texture {
  if (!puffTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    puffTexture = new THREE.CanvasTexture(c);
  }
  return puffTexture;
}

// ---------- smoke / flash particles ----------

interface Particle {
  sprite: THREE.Sprite;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  grow: number;
  fadePow: number;
}

const particles: Particle[] = [];
const MAX_PARTICLES = 950;

function spawnParticle(
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  size: number, life: number, color: number, opacity: number,
  grow = 1.6, additive = false,
): void {
  if (particles.length >= MAX_PARTICLES) {
    const oldest = particles.shift()!;
    scene.remove(oldest.sprite);
    oldest.sprite.material.dispose();
  }
  const mat = new THREE.SpriteMaterial({
    map: getPuffTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  sprite.scale.setScalar(size);
  scene.add(sprite);
  particles.push({ sprite, vx, vy, vz, life, maxLife: life, grow, fadePow: 1.4 });
}

/** The good stuff: a proper cloud of powder smoke rolling off the muzzle. */
export function muzzleSmoke(x: number, y: number, z: number, yaw: number): void {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // flash
  spawnParticle(x + fx * 0.45, y, z + fz * 0.45, fx * 2.8, 0.35, fz * 2.8, 1.05, 0.09, 0xffb13b, 1, 3.8, true);
  spawnParticle(x + fx * 0.75, y, z + fz * 0.75, fx * 4.2, 0.15, fz * 4.2, 0.6, 0.08, 0xfff0b0, 0.95, 2.8, true);

  // Dense first cough at the muzzle, then slower rolling smoke behind it.
  for (let i = 0; i < 10; i++) {
    const side = (Math.random() - 0.5) * 0.35;
    spawnParticle(
      x + fx * (0.25 + Math.random() * 0.45) + fz * side,
      y + (Math.random() - 0.35) * 0.28,
      z + fz * (0.25 + Math.random() * 0.45) - fx * side,
      fx * (0.55 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.35,
      0.18 + Math.random() * 0.55,
      fz * (0.55 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.35,
      1.1 + Math.random() * 0.9,
      3.6 + Math.random() * 2.8,
      Math.random() < 0.35 ? 0xbeb9ac : 0xd8d4c8,
      0.64,
      1.9,
    );
  }
  // rolling smoke
  for (let i = 0; i < 26; i++) {
    const spread = 1.05;
    spawnParticle(
      x + fx * (0.5 + Math.random() * 1.2),
      y + (Math.random() - 0.5) * 0.4,
      z + fz * (0.5 + Math.random() * 1.2),
      fx * (1 + Math.random() * 2.2) + (Math.random() - 0.5) * spread,
      0.35 + Math.random() * 0.7,
      fz * (1 + Math.random() * 2.2) + (Math.random() - 0.5) * spread,
      0.9 + Math.random() * 1.45,
      3.8 + Math.random() * 3.3,
      Math.random() < 0.45 ? 0xc9c4b8 : 0xe2ded2,
      0.46,
      1.75,
    );
  }
}

/** Little sputter of sparks at the pan — the "about to go off" tell. */
export function panSpark(x: number, y: number, z: number): void {
  for (let i = 0; i < 14; i++) {
    spawnParticle(
      x, y, z,
      (Math.random() - 0.5) * 2.2, 1.0 + Math.random() * 1.7, (Math.random() - 0.5) * 2.2,
      0.16, 0.28 + Math.random() * 0.2, Math.random() < 0.35 ? 0xffffff : 0xffc23a, 1, 0.75, true,
    );
  }
  spawnParticle(x, y, z, 0, 0.65, 0, 0.44, 0.34, 0xfff2c0, 0.9, 2.2, true);
  spawnParticle(x, y, z, 0.15, 0.18, -0.05, 0.32, 0.7, 0xb8b1a3, 0.38, 1.5);
}

export function dirtPuffAt(x: number, y: number, z: number): void {
  for (let i = 0; i < 5; i++) {
    spawnParticle(
      x, Math.max(0.15, y), z,
      (Math.random() - 0.5) * 1.4, 1 + Math.random(), (Math.random() - 0.5) * 1.4,
      0.4, 0.5, 0x8a7452, 0.8, 1.6,
    );
  }
}

export function bloodlessPoof(x: number, y: number, z: number): void {
  // A gentlemanly puff of wool fibers and dust instead of gore.
  for (let i = 0; i < 6; i++) {
    spawnParticle(
      x, y, z,
      (Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2,
      0.35, 0.45, 0xe8e0c8, 0.85, 1.7,
    );
  }
}

export function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.sprite);
      p.sprite.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.sprite.position.x += p.vx * dt;
    p.sprite.position.y += p.vy * dt;
    p.sprite.position.z += p.vz * dt;
    p.vx *= 1 - 0.8 * dt;
    p.vz *= 1 - 0.8 * dt;
    p.vy *= 1 - 0.5 * dt;
    const t = p.life / p.maxLife;
    p.sprite.material.opacity = Math.pow(t, p.fadePow) * 0.9;
    p.sprite.scale.multiplyScalar(1 + p.grow * dt * 0.5);
  }
}

// ---------- projectiles (client-side ballistic replay of server shots) ----------

interface ProjView {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
}

const projViews = new Map<number, ProjView>();
const ballGeo = new THREE.SphereGeometry(0.09, 6, 6);
const ballMat = new THREE.MeshBasicMaterial({ color: 0x2b2b2b });

export function spawnProjectile(id: number, ox: number, oy: number, oz: number, vx: number, vy: number, vz: number): void {
  const mesh = new THREE.Mesh(ballGeo, ballMat);
  mesh.position.set(ox, oy, oz);
  scene.add(mesh);
  projViews.set(id, { mesh, vx, vy, vz });
}

export function endProjectile(id: number): void {
  const view = projViews.get(id);
  if (view) {
    scene.remove(view.mesh);
    projViews.delete(id);
  }
}

export function clearProjectiles(): void {
  for (const id of [...projViews.keys()]) endProjectile(id);
}

export function updateProjectiles(dt: number): void {
  for (const view of projViews.values()) {
    view.vy -= PROJ_GRAVITY * dt;
    view.mesh.position.x += view.vx * dt;
    view.mesh.position.y += view.vy * dt;
    view.mesh.position.z += view.vz * dt;
    // faint smoke trail
    if (Math.random() < 0.4) {
      spawnParticle(
        view.mesh.position.x, view.mesh.position.y, view.mesh.position.z,
        0, 0.1, 0, 0.12, 0.3, 0xcccccc, 0.3, 1.2,
      );
    }
  }
}

// ---------- formation tethers ----------

interface TetherView {
  line: THREE.Line;
  geo: THREE.BufferGeometry;
  mat: THREE.LineBasicMaterial;
}

const tetherViews: TetherView[] = [];

export function ensureTetherCount(n: number): void {
  while (tetherViews.length < n) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const mat = new THREE.LineBasicMaterial({ color: 0x88ff88, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tetherViews.push({ line, geo, mat });
  }
  for (let i = 0; i < tetherViews.length; i++) tetherViews[i]!.line.visible = i < n;
}

/**
 * Stretch a rope between neighbors, colored by how close it is to snapping.
 * Green: comfortable. Yellow: stretching. Red/blinking: broken.
 */
export function updateTether(
  i: number,
  ax: number, az: number, bx: number, bz: number,
  broken: boolean, timeMs: number,
): void {
  const view = tetherViews[i];
  if (!view) return;
  const dist = Math.hypot(ax - bx, az - bz);
  const pos = view.geo.getAttribute('position') as THREE.BufferAttribute;
  const sag = broken ? 0 : Math.max(0, 0.5 - dist * 0.04);
  pos.setXYZ(0, ax, 1.1, az);
  pos.setXYZ(1, bx, 1.1 - sag, bz);
  pos.needsUpdate = true;
  if (broken) {
    view.mat.color.setHex(0xff4030);
    view.mat.opacity = 0.4 + 0.45 * Math.abs(Math.sin(timeMs / 120));
  } else if (dist > TETHER_WARN_DIST) {
    const t = Math.min(1, (dist - TETHER_WARN_DIST) / (TETHER_MAX_DIST - TETHER_WARN_DIST));
    view.mat.color.setHex(t > 0.6 ? 0xff9d30 : 0xf5e34a);
    view.mat.opacity = 0.9;
  } else {
    view.mat.color.setHex(0x88ff88);
    view.mat.opacity = 0.75;
  }
}

// ---------- bear traps ----------

interface TrapView {
  group: THREE.Group;
  jawA: THREE.Group;
  jawB: THREE.Group;
  sprung: boolean;
}

const trapViews = new Map<number, TrapView>();

export function spawnTrap(id: number, x: number, z: number, team: Team): void {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.06, 12),
    new THREE.MeshLambertMaterial({ color: 0x3a3d40 }),
  );
  base.position.y = 0.04;
  group.add(base);
  const toothMat = new THREE.MeshLambertMaterial({ color: team === 'red' ? 0x59452e : 0x46525e });

  const makeJaw = (): THREE.Group => {
    const jaw = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 4), toothMat);
      const a = (i / 4 - 0.5) * Math.PI * 0.8;
      tooth.position.set(Math.sin(a) * 0.42, 0.14, Math.cos(a) * 0.42 * 0.4);
      jaw.add(tooth);
    }
    return jaw;
  };
  const jawA = makeJaw();
  const jawB = makeJaw();
  jawB.rotation.y = Math.PI;
  jawA.rotation.x = -1.2; // open
  jawB.rotation.x = 1.2;
  group.add(jawA, jawB);
  group.position.set(x, 0, z);
  scene.add(group);
  trapViews.set(id, { group, jawA, jawB, sprung: false });
}

export function springTrap(id: number): void {
  const view = trapViews.get(id);
  if (view) {
    view.sprung = true;
    view.jawA.rotation.x = 0;
    view.jawB.rotation.x = 0;
  }
}

export function clearTraps(): void {
  for (const view of trapViews.values()) scene.remove(view.group);
  trapViews.clear();
}

// ---------- healer resurrection column (the graveyard-res fallback) ----------

export function resurrectionColumn(x: number, z: number): void {
  const group = new THREE.Group();

  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff3b0,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.55, 7.2, 24, 1, true), beamMat);
  beam.position.y = 3.6;
  group.add(beam);

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, 8.4, 18, 1, true), coreMat);
  core.position.y = 4.2;
  group.add(core);

  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xfff7c9,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.035, 8, 48), haloMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.18;
  group.add(halo);

  group.position.set(x, 0, z);
  scene.add(group);

  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.72;
    spawnParticle(
      x + Math.cos(a) * r, 0.2 + Math.random() * 1.1, z + Math.sin(a) * r,
      Math.cos(a) * 0.08, 1.6 + Math.random() * 1.7, Math.sin(a) * 0.08,
      0.18 + Math.random() * 0.12, 1.25 + Math.random() * 0.8, 0xfff7c9, 0.95, 0.9, true,
    );
  }

  const born = performance.now();
  const fade = (): void => {
    const age = (performance.now() - born) / 1000;
    if (age > 2.4) {
      scene.remove(group);
      beamMat.dispose();
      coreMat.dispose();
      haloMat.dispose();
      return;
    }
    const rise = Math.min(1, age / 0.7);
    const fadeOut = age < 1.7 ? 1 : 1 - (age - 1.7) / 0.7;
    const pulse = 0.85 + Math.sin(age * 11) * 0.15;
    beamMat.opacity = 0.5 * rise * fadeOut * pulse;
    coreMat.opacity = 0.42 * rise * fadeOut;
    haloMat.opacity = 0.9 * fadeOut;
    beam.scale.setScalar(0.92 + rise * 0.18 + Math.sin(age * 5) * 0.025);
    core.scale.setScalar(0.8 + rise * 0.25);
    halo.scale.setScalar(1 + age * 0.35);
    halo.rotation.z += 0.025;
    requestAnimationFrame(fade);
  };
  fade();
}
