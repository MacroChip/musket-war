import * as THREE from 'three';
import type { ClassType, Instrument, PlayerStatus, Team } from '../../../shared/src/types';
import { scene } from './scene';

const TEAM_COAT: Record<Team, number> = { red: 0xa93226, blue: 0x2a4d8f };
const SKIN = 0xd9b18c;
const BREECHES = 0xe8e0c8;
const HAT = 0x2b241a;
const WOOD = 0x6e4a2f;
const STEEL = 0x9ea6ad;

export interface SoldierPose {
  x: number;
  z: number;
  yaw: number;
  status: PlayerStatus;
  reloading: boolean;
  reviving: boolean;
  trapped: boolean;
  charging: boolean; // bayonet out, leaning in
  fixingBayonet: boolean;
  fleeing: boolean;
}

/**
 * A low-poly toy-soldier: boxes, a tricorn, and a musket. All animation is
 * cheap transform posing — no skeletons, no assets.
 */
export class SoldierView {
  readonly group = new THREE.Group();
  private body: THREE.Group; // torso+head+hat, tilts when prone
  private musket: THREE.Group | null = null;
  private bayonet: THREE.Mesh | null = null;
  private instrumentMesh: THREE.Group | null = null;
  private label: THREE.Sprite;
  private wobble = Math.random() * Math.PI * 2;

  constructor(
    readonly id: string,
    name: string,
    readonly team: Team,
    readonly cls: ClassType,
    instrument: Instrument | null,
  ) {
    this.body = new THREE.Group();
    const coat = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.78, 0.36),
      new THREE.MeshLambertMaterial({ color: TEAM_COAT[team] }),
    );
    coat.position.y = 1.05;
    coat.castShadow = true;
    this.body.add(coat);

    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.66, 0.3),
      new THREE.MeshLambertMaterial({ color: BREECHES }),
    );
    legs.position.y = 0.33;
    legs.castShadow = true;
    this.body.add(legs);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.34, 0.32),
      new THREE.MeshLambertMaterial({ color: SKIN }),
    );
    head.position.y = 1.63;
    head.castShadow = true;
    this.body.add(head);

    // Tricorn: squashed cone with a brim disc. Close enough at 40 paces.
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.05, 3),
      new THREE.MeshLambertMaterial({ color: HAT }),
    );
    brim.position.y = 1.84;
    // Face one tricorn point forward so it reads as the soldier's nose direction.
    brim.rotation.y = Math.PI / 2;
    this.body.add(brim);
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.18, 6),
      new THREE.MeshLambertMaterial({ color: HAT }),
    );
    crown.position.y = 1.94;
    this.body.add(crown);

    this.musket = buildMusket();
    this.musket.position.set(0.34, 1.15, 0.1);
    this.bayonet = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.5, 5),
      new THREE.MeshLambertMaterial({ color: STEEL }),
    );
    this.bayonet.rotation.x = Math.PI / 2;
    this.bayonet.position.set(0, 0, 1.05);
    this.bayonet.visible = false;
    this.musket.add(this.bayonet);
    this.body.add(this.musket);

    if (cls === 'musician') {
      this.instrumentMesh = instrument === 'drum' ? buildDrum() : buildFife();
      this.body.add(this.instrumentMesh);
    } else if (cls === 'medic') {
      // Medic satchel with a chalk cross
      const satchel = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.24, 0.14),
        new THREE.MeshLambertMaterial({ color: 0xf0e6d0 }),
      );
      satchel.position.set(-0.38, 0.95, 0.12);
      this.body.add(satchel);
      const cross = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.05, 0.02),
        new THREE.MeshLambertMaterial({ color: 0xa93226 }),
      );
      cross.position.set(-0.38, 0.95, 0.2);
      this.body.add(cross);
      const cross2 = cross.clone();
      cross2.rotation.z = Math.PI / 2;
      this.body.add(cross2);
    }

    this.group.add(this.body);
    this.label = makeLabel(name, team);
    this.label.position.y = 2.45;
    this.group.add(this.label);
    scene.add(this.group);
  }

  update(pose: SoldierPose, dt: number, isSelf: boolean, hideBody: boolean): void {
    this.group.position.set(pose.x, 0, pose.z);
    this.group.rotation.y = pose.yaw;
    this.wobble += dt * 9;
    this.label.visible = !isSelf && pose.status !== 'escaped';
    this.group.visible = pose.status !== 'escaped' && !hideBody;

    if (pose.status === 'dbno') {
      // Prone, dragging himself along with as much dignity as remains.
      this.body.rotation.x = -Math.PI / 2 + 0.12;
      this.body.position.y = 0.28 + Math.sin(this.wobble * 0.5) * 0.03;
      if (this.musket) this.musket.rotation.set(0, 0, 0);
    } else if (pose.status === 'out') {
      // Sat down, captured, contemplating his choices.
      this.body.rotation.x = -0.9;
      this.body.position.y = 0.1;
    } else {
      this.body.position.y = 0;
      this.body.rotation.x = pose.charging ? 0.22 : pose.fleeing ? 0.15 : 0;
      if (pose.trapped) {
        // Struggling in the trap
        this.body.rotation.z = Math.sin(this.wobble) * 0.08;
        this.body.rotation.x = 0.1;
      } else {
        this.body.rotation.z = 0;
      }
      if (this.musket) {
        this.musket.visible = this.cls === 'infantry' || pose.charging;
        this.bayonet!.visible = pose.charging;
        if (pose.fixingBayonet) {
          // Knead the socket around the muzzle so the fixing pause visibly means bayonets.
          const twist = Math.sin(this.wobble * 2.2) * 0.45;
          this.musket.rotation.set(-0.72 + Math.sin(this.wobble * 1.4) * 0.08, twist, 0.18);
          this.musket.position.set(0.22, 1.03 + Math.sin(this.wobble * 2.8) * 0.04, 0.38);
          this.bayonet!.rotation.set(Math.PI / 2, 0, twist);
          this.bayonet!.position.z = 0.92 + Math.sin(this.wobble * 3.2) * 0.09;
        } else {
          this.bayonet!.rotation.set(Math.PI / 2, 0, 0);
          this.bayonet!.position.z = 1.05;
          if (pose.reloading) {
            // Musket held vertical at the muzzle-loading position.
            this.musket.rotation.set(-Math.PI / 2 + 0.08, 0, 0);
            this.musket.position.set(0.3, 1.0, 0.35);
          } else if (pose.charging) {
            this.musket.rotation.set(0.05, 0, 0);
            this.musket.position.set(0.3, 1.0, 0.3);
          } else {
            // Shouldered, level, pointing where the man looks.
            this.musket.rotation.set(0, 0, 0);
            this.musket.position.set(0.34, 1.32, 0.25);
          }
        }
      }
      if (this.instrumentMesh) {
        this.instrumentMesh.rotation.z = pose.reviving ? 0 : Math.sin(this.wobble * 0.4) * 0.02;
      }
    }
  }

  dispose(): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
      if (o instanceof THREE.Sprite) o.material.map?.dispose();
    });
  }
}

function buildMusket(): THREE.Group {
  const g = new THREE.Group();
  const stock = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.09, 1.0),
    new THREE.MeshLambertMaterial({ color: WOOD }),
  );
  stock.position.z = 0.1;
  g.add(stock);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 1.15, 6),
    new THREE.MeshLambertMaterial({ color: STEEL }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.05, 0.35);
  g.add(barrel);
  return g;
}

function buildDrum(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, 0.3, 10),
    new THREE.MeshLambertMaterial({ color: 0xb3452e }),
  );
  shell.position.set(0, 0.85, 0.4);
  g.add(shell);
  const skinTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.27, 0.03, 10),
    new THREE.MeshLambertMaterial({ color: 0xf0e6d0 }),
  );
  skinTop.position.set(0, 1.0, 0.4);
  g.add(skinTop);
  return g;
}

function buildFife(): THREE.Group {
  const g = new THREE.Group();
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6),
    new THREE.MeshLambertMaterial({ color: 0x4a3520 }),
  );
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0.15, 1.55, 0.25);
  g.add(pipe);
  return g;
}

function makeLabel(name: string, team: Team): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 56;
  const c = canvas.getContext('2d')!;
  c.font = 'bold 30px Georgia, serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 6;
  c.strokeStyle = 'rgba(0,0,0,0.75)';
  c.strokeText(name, 128, 28);
  c.fillStyle = team === 'red' ? '#ffb0a0' : '#a8c4ff';
  c.fillText(name, 128, 28);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  sprite.scale.set(2.4, 0.52, 1);
  return sprite;
}
