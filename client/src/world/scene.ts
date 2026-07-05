import * as THREE from 'three';
import { ESCAPE_Z, FIELD_HALF_X, FIELD_HALF_Z } from '../../../shared/src/constants';
import { mulberry32 } from '../../../shared/src/math';

export let scene: THREE.Scene;
export let camera: THREE.PerspectiveCamera;
export let renderer: THREE.WebGLRenderer;

export function initScene(canvas: HTMLCanvasElement): void {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9db8d2); // hazy colonial morning
  scene.fog = new THREE.Fog(0x9db8d2, 90, 220);

  camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, 30, 60);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xdfeaf5, 0x4a5d3a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
  sun.position.set(40, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 70;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 160;
  scene.add(sun);

  buildField();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function buildField(): void {
  const rng = mulberry32(1776);

  // Meadow
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_HALF_X * 2 + 120, FIELD_HALF_Z * 2 + 120, 40, 40),
    new THREE.MeshLambertMaterial({ color: 0x6a8f4d }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Trampled dirt strip between the lines
  const dirt = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_HALF_X * 2, 26),
    new THREE.MeshLambertMaterial({ color: 0x7d6a4a }),
  );
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.02;
  dirt.receiveShadow = true;
  scene.add(dirt);

  // Escape lines (chalky boundary the routed run for)
  for (const z of [ESCAPE_Z, -ESCAPE_Z]) {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD_HALF_X * 2, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xe8e0c8, transparent: true, opacity: 0.5 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.03, z);
    scene.add(line);
  }

  // Split-rail fences down the flanks
  const railMat = new THREE.MeshLambertMaterial({ color: 0x6e563a });
  for (const x of [-FIELD_HALF_X - 3, FIELD_HALF_X + 3]) {
    for (let z = -FIELD_HALF_Z; z <= FIELD_HALF_Z; z += 6) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 6.4), railMat);
      rail.position.set(x + (rng() - 0.5) * 0.4, 0.85, z);
      rail.rotation.y = (rng() - 0.5) * 0.12;
      rail.castShadow = true;
      scene.add(rail);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), railMat);
      post.position.set(x, 0.55, z - 3);
      scene.add(post);
    }
  }

  // A few procedural trees beyond the fences
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5b4630 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x4f7038 });
  for (let i = 0; i < 26; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * (FIELD_HALF_X + 8 + rng() * 30);
    const z = (rng() - 0.5) * (FIELD_HALF_Z * 2 + 60);
    const h = 4 + rng() * 4;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h * 0.5, 6), trunkMat);
    trunk.position.y = h * 0.25;
    trunk.castShadow = true;
    tree.add(trunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.6 + rng() * 1.4, h * 0.8, 7), leafMat);
    crown.position.y = h * 0.5 + h * 0.35;
    crown.castShadow = true;
    tree.add(crown);
    tree.position.set(x, 0, z);
    tree.rotation.y = rng() * Math.PI;
    scene.add(tree);
  }

  // A modest farmhouse on one flank, for the geese to flee toward
  const house = new THREE.Group();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(8, 4, 6),
    new THREE.MeshLambertMaterial({ color: 0xb8a888 }),
  );
  walls.position.y = 2;
  walls.castShadow = true;
  house.add(walls);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(6.4, 3, 4),
    new THREE.MeshLambertMaterial({ color: 0x7a4a3a }),
  );
  roof.position.y = 5.4;
  roof.rotation.y = Math.PI / 4;
  house.add(roof);
  house.position.set(-FIELD_HALF_X - 24, 0, 8);
  scene.add(house);
}
