import * as THREE from 'three';
import { GameMap, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER, G_WORLD, G_ALL, groups } from '../physics/Physics';

// ------------------------------------------------------------
// Mapa 3 — RINGUE DE GELATINA
// Uma arena redonda de gelatina flutuando num mar de calda.
// Ela balança, inclina e de vez em quando dá um "pulo" que joga
// todo mundo para cima. Quem cai na calda, perde.
// ------------------------------------------------------------

const R = 6.4;

export class JellyRing extends GameMap {
  id = 'gelatina';
  name = 'Ringue de Gelatina';
  emoji = '🍮';
  description = 'Um ringue mole sobre um mar de calda de morango.';
  hazard = 'O ringue balança, inclina e quica. Não caia na calda!';
  music = 'gelatina' as const;
  killY = -9;
  camera = {
    dir: new THREE.Vector3(0, 0.85, 1),
    minDist: 12,
    maxDist: 22,
    fov: 42,
    center: new THREE.Vector3(0, 0.3, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-4, -1, -4), new THREE.Vector3(4, 2, 4)),
  };

  private ring!: RAPIER.RigidBody;
  private jelly!: THREE.Mesh;
  private sea!: THREE.Mesh;
  private quakeT = 0;
  private quakeTimer = 12;
  private bounceT = -1;
  private bounceTimer = 7;
  private y = 0;
  private lollies: THREE.Object3D[] = [];

  build() {
    this.lights({
      skyTop: 0x8ec5ff,
      skyBottom: 0xffd6ec,
      fog: { color: 0xffd6ec, near: 40, far: 120 },
      sunColor: 0xffffff,
      sunIntensity: 2.3,
      sunPos: new THREE.Vector3(-8, 20, 10),
      hemiSky: 0xffffff,
      hemiGround: 0xff8fbf,
      hemiIntensity: 1.3,
      shadowExtent: 10,
    });

    // O ringue: um corpo cinemático com o disco e os postes de bala.
    const world = this.ctx.physics.world;
    this.ring = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -0.5, 0));
    const mk = (desc: RAPIER.ColliderDesc, grab: boolean) => {
      const c = world.createCollider(desc.setFriction(1).setRestitution(0.35).setCollisionGroups(groups(G_WORLD, G_ALL)), this.ring);
      this.ctx.physics.register(c, { kind: 'static', grabbable: grab });
    };
    mk(RAPIER.ColliderDesc.cylinder(0.5, R), true);
    const group = new THREE.Group();
    this.jelly = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.92, 1, 48, 1),
      new THREE.MeshPhysicalMaterial({ color: 0x4cc9f0, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0.88, sheen: 0.6 }),
    );
    group.add(this.jelly);
    // Topo com "creme"
    const cream = new THREE.Mesh(new THREE.TorusGeometry(R - 0.15, 0.22, 10, 48), new THREE.MeshStandardMaterial({ color: 0xfff6ee, roughness: 0.6 }));
    cream.rotation.x = Math.PI / 2;
    cream.position.y = 0.5;
    group.add(cream);
    // Postes de bala (dá para agarrar)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = Math.cos(a) * (R - 0.45);
      const z = Math.sin(a) * (R - 0.45);
      mk(RAPIER.ColliderDesc.cylinder(0.65, 0.16).setTranslation(x, 1.15, z), true);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
      post.position.set(x, 1.15, z);
      group.add(post);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshStandardMaterial({ color: [0xffd23f, 0x3a86ff, 0x3ddc84][i % 3], roughness: 0.2 }));
      top.position.set(x, 1.9, z);
      group.add(top);
    }
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.ctx.root.add(group);
    this.ctx.links.add(this.ring, group);

    // Mar de calda
    this.sea = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshPhysicalMaterial({ color: 0xb3123f, roughness: 0.15, clearcoat: 1 }));
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -6;
    this.deco(this.sea, false);

    // Cenário doce: pirulitos gigantes e nuvens
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 18 + Math.random() * 14;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 6;
      if (z > 8) continue;
      const g = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      stick.position.y = 0;
      const candy = new THREE.Mesh(new THREE.TorusGeometry(2, 0.9, 12, 32), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.8, 0.6), roughness: 0.25 }));
      candy.position.y = 6.5;
      g.add(stick, candy);
      g.position.set(x, -3, z);
      g.rotation.y = Math.random() * 3;
      this.deco(g, false);
      this.lollies.push(candy);
    }
    for (let i = 0; i < 10; i++) {
      const cloud = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1.5 + Math.random(), 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
        s.position.set(k * 1.6, Math.random(), Math.random());
        cloud.add(s);
      }
      cloud.position.set((Math.random() - 0.5) * 90, 12 + Math.random() * 10, -30 - Math.random() * 30);
      this.deco(cloud, false);
    }

    this.prop('bola', new THREE.Vector3(-2, 1, -2), 0xffd23f);
    this.prop('bola', new THREE.Vector3(2.5, 1, -1.5), 0x3a86ff);

    this.spawns = [new THREE.Vector3(-3, 0.1, 1.2), new THREE.Vector3(3, 0.1, 1.2), new THREE.Vector3(-1.5, 0.1, -2.6), new THREE.Vector3(1.5, 0.1, -2.6)];
  }

  private clock = 0;

  update(dt: number, _time: number, arena: ArenaApi) {
    // Relógio próprio: começa em zero quando a luta começa (sem trancos).
    this.clock += dt;
    const time = this.clock;
    const ramp = Math.min(1, time / 3);
    // Terremoto de gelatina de vez em quando
    this.quakeTimer -= dt;
    if (this.quakeTimer <= 0) {
      this.quakeTimer = 14 + Math.random() * 6;
      this.quakeT = 4;
      arena.announce('🌀 TREMEDEIRA DE GELATINA!', 'tip');
      arena.sound('boing', 1, 0.5);
      arena.shake(0.3);
    }
    this.quakeT -= dt;
    const amp = this.quakeT > 0 ? 0.26 : 0.1 + Math.min(0.06, time * 0.002);
    const rx = ramp * (Math.sin(time * 0.55) * amp + Math.sin(time * 1.7) * amp * 0.25);
    const rz = ramp * (Math.sin(time * 0.43 + 1.3) * amp + Math.cos(time * 2.1) * amp * 0.2);

    // Pulo: o ringue afunda e sobe de repente
    this.bounceTimer -= dt;
    if (this.bounceTimer <= 0 && this.bounceT < 0) {
      this.bounceT = 0;
      this.bounceTimer = 8 + Math.random() * 5;
      arena.sound('alarm', 0.4);
    }
    let targetY = ramp * Math.sin(time * 1.3) * 0.12;
    if (this.bounceT >= 0) {
      this.bounceT += dt;
      const t = this.bounceT;
      if (t < 0.9) targetY = -0.7 * Math.sin((t / 0.9) * Math.PI * 0.5); // afunda devagar (aviso)
      else if (t < 1.1) {
        targetY = -0.7 + ((t - 0.9) / 0.2) * 1.5; // sobe rápido = lança
        if (t - dt < 0.9) {
          arena.sound('boing', 1, 0.7);
          arena.shake(0.35);
        }
      } else if (t < 1.8) targetY = 0.8 * (1 - (t - 1.1) / 0.7);
      else this.bounceT = -1;
    }
    this.y += (targetY - this.y) * Math.min(1, dt * 20);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, time * 0.15, rz));
    this.ring.setNextKinematicTranslation({ x: 0, y: -0.5 + this.y, z: 0 });
    this.ring.setNextKinematicRotation(q);

    // Visual: a gelatina "treme"
    const wob = Math.sin(time * 9) * (this.quakeT > 0 ? 0.05 : 0.02);
    this.jelly.scale.set(1 + wob, 1 - wob * 2, 1 + wob);
    for (const l of this.lollies) l.rotation.z = time * 0.3;
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < -4.6) return 'water';
    return p.y < this.killY ? 'fall' : 'none';
  }
}
