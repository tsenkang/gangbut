import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi } from './MapBase';
import { RAPIER, G_WORLD, G_ALL, groups } from '../physics/Physics';
import { grimeTexture, hazeBelow } from './City';

// ------------------------------------------------------------
// Mapa 11 — TELEFÉRICO
// Duas estações no alto de montanhas nevadas, ligadas por dois
// cabos. Em cada cabo vai e volta uma cabine; a briga é em cima do
// teto delas. As cabines se cruzam no meio do caminho (dá para
// pular de uma para a outra) e encostam nas estações.
// ------------------------------------------------------------

const ROPE_Y = 3.2; // altura do cabo
const LINES = [-2, 2]; // z de cada cabo
const STATION_X = 10.5; // onde começa cada estação
const TRAVEL = 7.2; // até onde a cabine vai (x)
const CW = 2.2; // meia largura da cabine (x)
const CD = 1.4; // meia profundidade (z)

interface Cabin {
  body: RAPIER.RigidBody;
  z: number;
  dir: number;
  x: number;
  wait: number;
  speed: number;
}

export class CableCars extends GameMap {
  id = 'teleferico';
  name = 'Teleférico';
  emoji = '🚡';
  description = 'Cabines de teleférico indo e voltando entre duas estações nas montanhas.';
  hazard = 'As cabines balançam e se cruzam no meio. Não fique para trás quando ela sair!';
  music = 'gelatina' as const;
  killY = -12;
  botDetours = false; // espera a cabine chegar
  camera = {
    dir: new THREE.Vector3(0, 0.55, 1),
    minDist: 15,
    maxDist: 32,
    fov: 44,
    center: new THREE.Vector3(0, 0.6, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-12, -1, -2), new THREE.Vector3(12, 3, 2)),
  };

  private cabins: Cabin[] = [];
  private wheels: THREE.Mesh[] = [];

  build() {
    this.lights({
      // céu frio de montanha
      skyTop: 0x4f7fc0,
      skyBottom: 0xe6eef5,
      fog: { color: 0xd8e2ec, near: 30, far: 130 },
      sunColor: 0xfff6e8,
      sunIntensity: 2.4,
      sunPos: new THREE.Vector3(-10, 24, 12),
      hemiSky: 0xe0ecff,
      hemiGround: 0x8090a8,
      hemiIntensity: 1.35,
      shadowExtent: 20,
    });

    // ---------------- estações (uma de cada lado, no topo de um pico)
    const deck = new THREE.MeshStandardMaterial({ map: grimeTexture('#8b8176', [3, 2], { tiles: 6, cracks: true }), roughness: 1 });
    const wood = this.material(0x7a4f32, { roughness: 0.9 });
    const roofMat = this.material(0xb5332e, { roughness: 0.7 });
    const snow = this.material(0xf4f8fc, { roughness: 0.9 });
    const rock = this.material(0x6c7480, { roughness: 1 });
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([3, 1]) });
    for (const s of [-1, 1]) {
      const x = s * (STATION_X + 4);
      this.box({ x, y: -0.4, z: 0 }, { x: 8, y: 0.8, z: 8 }, deck);
      this.box({ x: s * (STATION_X + 0.06), y: 0.01, z: 0 }, { x: 0.12, y: 0.03, z: 8 }, stripes, { collide: false, shadow: false });
      // parede do fundo e telhado (o telhado dá para subir)
      this.box({ x, y: 2.1, z: -3.8 }, { x: 8, y: 4.2, z: 0.4 }, wood);
      this.box({ x, y: 4.35, z: -1.2 }, { x: 8.4, y: 0.3, z: 5.6 }, roofMat);
      this.box({ x, y: 4.52, z: -1.2 }, { x: 8.2, y: 0.06, z: 5.4 }, snow, { collide: false });
      this.box({ x: s * (STATION_X + 7.6), y: 2.1, z: 1.4 }, { x: 0.3, y: 4.2, z: 0.3 }, wood);
      // banco de espera (dá para subir)
      this.box({ x: s * (STATION_X + 5.5), y: 0.4, z: -2.8 }, { x: 2.4, y: 0.8, z: 0.8 }, wood);
      // polia grande (onde o cabo dá a volta)
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.12, 8, 32), this.material(0x6a737e, { metalness: 0.7, roughness: 0.35 }));
      wheel.rotation.x = Math.PI / 2;
      for (let k = 0; k < 4; k++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 0.08), this.material(0x6a737e, { metalness: 0.7 }));
        spoke.rotation.z = (k * Math.PI) / 4;
        wheel.add(spoke);
      }
      wheel.position.set(s * (STATION_X + 1.6), ROPE_Y, 0);
      this.deco(wheel);
      this.wheels.push(wheel);
      // pico de pedra e neve embaixo da estação
      const peak = new THREE.Mesh(new THREE.ConeGeometry(9, 40, 7), rock);
      peak.position.set(s * (STATION_X + 4), -21, -1);
      this.deco(peak, false);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(6.2, 6, 7), snow);
      cap.position.set(s * (STATION_X + 4), -3.4, -1);
      this.deco(cap, false);
    }
    this.box({ x: -STATION_X - 3, y: 0.5, z: 2.6 }, { x: 1, y: 1, z: 1 }, this.material(0x2f6f4e));

    // ---------------- cabos (só desenho)
    const cableMat = this.material(0x1a1a1a, { metalness: 0.5 });
    for (const z of LINES) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, (STATION_X + 1.6) * 2, 6), cableMat);
      c.rotation.z = Math.PI / 2;
      c.position.set(0, ROPE_Y, z);
      this.deco(c, false);
    }

    // ---------------- cabines (cinemáticas)
    const colors = [0xd62828, 0xf2b705];
    LINES.forEach((z, i) => {
      const x = i === 0 ? -TRAVEL : TRAVEL;
      const body = this.ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0, z));
      const add = (desc: RAPIER.ColliderDesc) => {
        const c = this.ctx.physics.world.createCollider(desc.setFriction(1).setRestitution(0.05).setCollisionGroups(groups(G_WORLD, G_ALL)), body);
        this.ctx.physics.register(c, { kind: 'static', grabbable: true });
      };
      add(RAPIER.ColliderDesc.cuboid(CW, 1.1, CD).setTranslation(0, -1.1, 0)); // cabine (teto em y = 0)
      add(RAPIER.ColliderDesc.cylinder(1.6, 0.07).setTranslation(0, 1.6, 0)); // haste até o cabo (dá para agarrar)
      add(RAPIER.ColliderDesc.cuboid(CW, 0.04, 0.04).setTranslation(0, 0.1, CD)); // grade do teto (frente)
      add(RAPIER.ColliderDesc.cuboid(CW, 0.04, 0.04).setTranslation(0, 0.1, -CD)); // grade do teto (fundo)
      this.ctx.links.add(body, this.cabinMesh(colors[i]));
      this.cabins.push({ body, z, dir: i === 0 ? 1 : -1, x, wait: 3, speed: 0 });
    });

    // ---------------- montanhas ao fundo e vale com neblina
    for (let i = 0; i < 14; i++) {
      const h = 30 + Math.random() * 40;
      const m = new THREE.Mesh(new THREE.ConeGeometry(14 + Math.random() * 14, h, 7), rock);
      m.position.set(-90 + i * 14 + Math.random() * 6, -30 + h / 2, -50 - Math.random() * 40);
      this.deco(m, false);
      const c = new THREE.Mesh(new THREE.ConeGeometry((14 + 6) * 0.38, h * 0.3, 7), snow);
      c.position.set(m.position.x, m.position.y + h * 0.36, m.position.z);
      this.deco(c, false);
    }
    // pinheirinhos nas encostas lá embaixo
    const pine = this.material(0x2f4f3a, { roughness: 1 });
    for (let i = 0; i < 40; i++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3, 6), pine);
      t.position.set((Math.random() - 0.5) * 80, -18 - Math.random() * 6, (Math.random() - 0.5) * 50 - 10);
      this.deco(t, false);
    }
    hazeBelow(this.ctx.root, 0xe8eef4, [
      [-10, 0.45],
      [-19, 0.7],
    ]);

    this.prop('caixa', new THREE.Vector3(-STATION_X - 1.5, 0.5, -1.5));
    this.prop('barril', new THREE.Vector3(STATION_X + 2, 0.5, 1.2), 0x2b5e8a);
    this.prop('caixa', new THREE.Vector3(STATION_X + 5, 0.5, 2.5));
    this.prop('barril', new THREE.Vector3(-STATION_X - 6, 0.5, 1), 0xd95f2b);

    // dois começam em cada estação; a cabine de cada cabo começa encostada
    this.spawns = [
      new THREE.Vector3(-STATION_X - 1.6, 0.05, 0.6),
      new THREE.Vector3(STATION_X + 1.6, 0.05, 0.6),
      new THREE.Vector3(-TRAVEL, 0.08, LINES[0]),
      new THREE.Vector3(TRAVEL, 0.08, LINES[1]),
    ];
  }

  private cabinMesh(color: number) {
    const g = new THREE.Group();
    const paint = this.material(color, { roughness: 0.45, metalness: 0.2 });
    const white = this.material(0xf1ede4, { roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(CW * 2, 2.2, CD * 2), paint);
    body.position.y = -1.1;
    g.add(body);
    const band = new THREE.Mesh(new THREE.BoxGeometry(CW * 2 + 0.02, 0.85, CD * 2 + 0.02), this.material(0xbfdcef, { roughness: 0.1, metalness: 0.5 }));
    band.position.y = -0.85;
    g.add(band);
    const top = new THREE.Mesh(new THREE.BoxGeometry(CW * 2 + 0.1, 0.1, CD * 2 + 0.1), white);
    top.position.y = -0.05;
    g.add(top);
    for (const z of [-CD, CD]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(CW * 2, 0.06, 0.06), white);
      rail.position.set(0, 0.1, z);
      g.add(rail);
    }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), this.material(0x333a44, { metalness: 0.6 }));
    rod.position.y = 1.6;
    g.add(rod);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.3), this.material(0x333a44, { metalness: 0.6 }));
    grip.position.y = ROPE_Y;
    g.add(grip);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.ctx.root.add(g);
    return g;
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    // Em cima de uma cabine: fica no meio dela. Senão, a estação mais perto.
    for (const c of this.cabins) {
      const t = c.body.translation();
      if (Math.abs(p.x - t.x) < CW + 0.3 && Math.abs(p.z - t.z) < CD + 0.3 && p.y > t.y - 0.5) return new THREE.Vector3(t.x, 0, t.z);
    }
    return new THREE.Vector3(Math.sign(p.x || 1) * (STATION_X + 3.5), 0, 0.5);
  }

  update(dt: number, time: number, arena: ArenaApi) {
    for (const c of this.cabins) {
      if (c.wait > 0) {
        // parada na estação (dá tempo de subir/descer)
        c.wait -= dt;
        c.speed = 0;
        if (c.wait <= 0) arena.sound('clank', 0.5);
      } else {
        // acelera, anda e freia perto da ponta
        const left = c.dir > 0 ? TRAVEL - c.x : c.x + TRAVEL;
        const want = Math.min(3.2, 0.5 + left * 0.8);
        c.speed += (want - c.speed) * Math.min(1, dt * 2);
        c.x += c.dir * c.speed * dt;
        if (left <= 0.02) {
          c.x = c.dir * TRAVEL;
          c.dir *= -1;
          c.wait = 2.5;
        }
      }
      // balança mais quando anda e quando freia
      const swing = Math.sin(time * 1.7 + c.z) * (0.03 + c.speed * 0.012);
      const pivot = new THREE.Vector3(c.x, ROPE_Y, c.z);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, swing));
      // a cabine gira em volta do ponto preso no cabo
      const pos = new THREE.Vector3(0, -ROPE_Y, 0).applyQuaternion(q).add(pivot);
      c.body.setNextKinematicTranslation(pos);
      c.body.setNextKinematicRotation(q);
    }
    for (const w of this.wheels) w.rotation.z = time * 0.8;
  }
}
