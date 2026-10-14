import * as THREE from 'three';
import { GameMap, canvasTexture, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER, G_WORLD, G_ALL, groups } from '../physics/Physics';
import { grimeTexture, windowsTexture } from './City';
import type { Fighter } from '../characters/Fighter';

// ------------------------------------------------------------
// Mapa 10 — CAMINHÕES
// Dois caminhões de baú lado a lado numa avenida elevada. A briga
// é em cima dos baús. Os caminhões se afastam, se aproximam e um
// passa o outro (vão para frente e para trás). O baú é oco e aberto
// atrás: dá para entrar nele. Placas de trânsito passam por cima,
// cada uma tapando uma faixa: pule para o caminhão do lado livre,
// pendure-se na lateral ou se esconda dentro do baú.
// ------------------------------------------------------------

const SPEED = 22; // velocidade do cenário passando
const HALF_L = 7.5; // meio comprimento do baú (carreta comprida)
const HALF_W = 1.5; // meia largura do baú
const ROAD_Y = -3.6;

interface Truck {
  body: RAPIER.RigidBody;
  side: number; // -1 = lá atrás, 1 = cá na frente
  z: number;
  x: number; // um passa o outro: anda para frente e para trás
}

export class Trucks extends GameMap {
  id = 'caminhoes';
  name = 'Caminhões';
  emoji = '🚚';
  description = 'Dois caminhões de baú correndo lado a lado numa avenida elevada.';
  hazard = 'Pule quando os caminhões encostarem. Placas passam por cima: abaixe-se ou se pendure!';
  music = 'trem' as const;
  killY = -9;
  camera = {
    dir: new THREE.Vector3(0, 0.75, 1),
    minDist: 14,
    maxDist: 25,
    fov: 42,
    center: new THREE.Vector3(0, 0.4, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-7, -1, -2.6), new THREE.Vector3(7, 3, 2.6)),
  };

  private trucks: Truck[] = [];
  private clock = 0;
  private roadTex!: THREE.Texture;
  private moving: THREE.Object3D[] = [];
  private wheels: THREE.Mesh[] = [];
  private signX = 999;
  private signTimer = 12;
  private signWarned = false;
  private sign!: THREE.Group;
  private signHit = new Set<Fighter>();
  private boards: THREE.Mesh[] = [];

  build() {
    this.lights({
      skyTop: 0x5276a8,
      skyBottom: 0xf0c9a4,
      fog: { color: 0xb8aaa8, near: 30, far: 120 },
      sunColor: 0xfff0d8,
      sunIntensity: 2.3,
      sunPos: new THREE.Vector3(-12, 22, 12),
      hemiSky: 0xd4def0,
      hemiGround: 0x5a5048,
      hemiIntensity: 1.25,
      shadowExtent: 15,
    });

    // ---------------- avenida (a textura corre para dar velocidade)
    this.roadTex = canvasTexture(
      256,
      256,
      (g) => {
        g.fillStyle = '#4a4a4f';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 400; i++) {
          g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
          g.fillRect(Math.random() * 256, Math.random() * 256, 3, 2);
        }
        // faixas tracejadas entre as pistas
        g.fillStyle = '#e8e2d0';
        for (const y of [64, 128, 192]) for (let x = 0; x < 256; x += 64) g.fillRect(x, y - 2, 34, 4);
      },
      [20, 1],
    );
    const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 16), new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.95 }));
    road.rotation.x = -Math.PI / 2;
    road.position.y = ROAD_Y;
    this.deco(road, false);
    // laterais do elevado e mureta (o elevado fica no alto da cidade)
    const concrete = new THREE.MeshStandardMaterial({ map: grimeTexture('#8a857e', [40, 1], { dark: 'rgba(0,0,0,0.2)' }), roughness: 1 });
    for (const z of [-8.2, 8.2]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(400, 1, 0.4), concrete);
      wall.position.set(0, ROAD_Y + 0.5, z);
      this.deco(wall, false);
      const side = new THREE.Mesh(new THREE.BoxGeometry(400, 2.5, 0.3), concrete);
      side.position.set(0, ROAD_Y - 1.25, z);
      this.deco(side, false);
    }

    // ---------------- os dois caminhões (cinemáticos: só andam de lado)
    const colors = [0xe63946, 0x2a9d8f];
    for (const [i, side] of [
      [0, -1],
      [1, 1],
    ] as const) {
      const z = side * 2.3;
      const body = this.ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, z));
      const add = (desc: RAPIER.ColliderDesc) => {
        const c = this.ctx.physics.world.createCollider(desc.setFriction(1).setRestitution(0.05).setCollisionGroups(groups(G_WORLD, G_ALL)), body);
        this.ctx.physics.register(c, { kind: 'static', grabbable: true });
      };
      // baú oco, aberto atrás (topo em y = 0; chão por dentro em y = -2.6)
      add(RAPIER.ColliderDesc.cuboid(HALF_L, 0.08, HALF_W).setTranslation(0, -0.08, 0)); // teto
      add(RAPIER.ColliderDesc.cuboid(HALF_L, 0.08, HALF_W).setTranslation(0, -2.72, 0)); // chão
      for (const z of [-1, 1]) add(RAPIER.ColliderDesc.cuboid(HALF_L, 1.4, 0.08).setTranslation(0, -1.4, z * (HALF_W - 0.08))); // paredes
      add(RAPIER.ColliderDesc.cuboid(0.08, 1.4, HALF_W).setTranslation(HALF_L - 0.08, -1.4, 0)); // frente
      add(RAPIER.ColliderDesc.cuboid(1.1, 1.05, HALF_W - 0.05).setTranslation(HALF_L + 1.3, -1.6, 0)); // cabine
      add(RAPIER.ColliderDesc.cuboid(HALF_L, 0.05, 0.05).setTranslation(0, -0.35, side * (HALF_W + 0.06))); // frisos laterais (dá para pendurar)
      this.ctx.links.add(body, this.truckMesh(colors[i], side));
      this.trucks.push({ body, side, z, x: 0 });
    }

    // ---------------- cenário que passa: postes, prédios e placas
    const pole = this.material(0x5f646b, { metalness: 0.5, roughness: 0.5 });
    for (let i = 0; i < 16; i++) {
      for (const z of [-8.2, 8.2]) {
        const g = new THREE.Group();
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 6), pole);
        p.position.y = 3.5;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2), pole);
        arm.position.set(0, 7, -Math.sign(z) * 1);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
        lamp.position.set(0, 6.9, -Math.sign(z) * 1.9);
        g.add(p, arm, lamp);
        g.position.set(-110 + i * 14 + (z > 0 ? 7 : 0), ROAD_Y + 1, z);
        this.deco(g, false);
        this.moving.push(g);
      }
    }
    const walls = ['#5d5763', '#6b6370', '#4f5866', '#625b60', '#70675f'];
    for (let i = 0; i < 28; i++) {
      const side = i % 2 ? 1 : -1;
      const h = 14 + Math.random() * 30;
      const w = 8 + Math.random() * 8;
      const tex = windowsTexture(6, 14, 0.3, walls[i % walls.length]);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, Math.max(1, Math.round(h / 12)));
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 1 }));
      b.position.set(-112 + i * 8, -30 + h / 2 + (Math.random() * 10), side * (16 + w / 2 + Math.random() * 10));
      this.deco(b, false);
      this.moving.push(b);
    }

    // placa de trânsito gigante (pórtico) que passa de vez em quando
    this.sign = new THREE.Group();
    const greenGeo = new THREE.BoxGeometry(0.3, 2, 4.6);
    const greenMat = new THREE.MeshStandardMaterial({
        map: canvasTexture(512, 128, (g) => {
          g.fillStyle = '#1f6f43';
          g.fillRect(0, 0, 512, 128);
          g.strokeStyle = '#ffffff';
          g.lineWidth = 6;
          g.strokeRect(8, 8, 496, 112);
          g.fillStyle = '#ffffff';
          g.font = '900 54px "Lilita One", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('CENTRO  ⬆  SAÍDA 12', 256, 66);
        }),
        roughness: 0.6,
      });
    // uma chapa por faixa: a cada passada, uma (ou as duas) aparecem
    for (const z of [-2.35, 2.35]) {
      const green = new THREE.Mesh(greenGeo, greenMat);
      green.position.set(0, 2.2, z);
      this.sign.add(green);
      this.boards.push(green);
    }
    const truss = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 17), pole);
    truss.position.y = 3.3;
    this.sign.add(truss);
    for (const z of [-8.2, 8.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.2, 0.4), pole);
      leg.position.set(0, -0.2, z);
      this.sign.add(leg);
    }
    this.sign.position.set(this.signX, 0, 0);
    this.deco(this.sign);

    this.prop('caixa', new THREE.Vector3(-2, 0.5, -2.3));
    this.prop('caixa', new THREE.Vector3(2.5, 0.5, 2.3), 0x9c6b3a);
    this.prop('barril', new THREE.Vector3(-5.5, 0.5, 2.3), 0x2b5e8a);
    this.prop('caixa', new THREE.Vector3(5.8, 0.5, -2.3));

    this.spawns = [new THREE.Vector3(-4.5, 0.05, -2.3), new THREE.Vector3(4.5, 0.05, -2.3), new THREE.Vector3(-4.5, 0.05, 2.3), new THREE.Vector3(4.5, 0.05, 2.3)];
  }

  private truckMesh(color: number, side: number) {
    const g = new THREE.Group();
    const white = this.material(0xf1ede4, { roughness: 0.6 });
    const paint = this.material(color, { roughness: 0.45, metalness: 0.2 });
    const dark = this.material(0x22252b, { roughness: 0.8 });
    // baú com nervuras
    // baú oco: teto, chão, paredes e frente (a traseira é aberta)
    const skin = new THREE.MeshStandardMaterial({ map: grimeTexture('#e9e4da', [4, 1], { tiles: 10, dark: 'rgba(0,0,0,0.12)' }), roughness: 0.7, side: THREE.DoubleSide });
    const inside = this.material(0x6b5a48, { roughness: 1 });
    const panel = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
      b.position.set(x, y, z);
      g.add(b);
    };
    panel(HALF_L * 2, 0.16, HALF_W * 2, 0, -0.08, 0, skin);
    panel(HALF_L * 2, 0.16, HALF_W * 2, 0, -2.72, 0, inside);
    for (const z of [-1, 1]) panel(HALF_L * 2, 2.8, 0.16, 0, -1.4, z * (HALF_W - 0.08), skin);
    panel(0.16, 2.8, HALF_W * 2, HALF_L - 0.08, -1.4, 0, skin);
    // portas traseiras abertas (presas nas laterais)
    for (const z of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, HALF_W * 0.95), skin);
      door.position.set(-HALF_L - HALF_W * 0.47, -1.4, z * (HALF_W + 0.05));
      door.rotation.y = z * Math.PI / 2;
      g.add(door);
    }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(HALF_L * 2 + 0.02, 0.5, HALF_W * 2 + 0.02), paint);
    stripe.position.y = -1.6;
    g.add(stripe);
    const top = new THREE.Mesh(new THREE.BoxGeometry(HALF_L * 2 + 0.06, 0.08, HALF_W * 2 + 0.06), white);
    top.position.y = -0.04;
    g.add(top);
    const hs = new THREE.Mesh(new THREE.BoxGeometry(HALF_L * 2, 0.08, 0.06), new THREE.MeshStandardMaterial({ map: hazardStripes([10, 1]) }));
    hs.position.set(0, -0.35, side * (HALF_W + 0.06));
    g.add(hs);
    // cabine
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.1, HALF_W * 2 - 0.1), paint);
    cab.position.set(HALF_L + 1.3, -1.6, 0);
    g.add(cab);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, HALF_W * 2 - 0.3), this.material(0x9fc6e0, { roughness: 0.1, metalness: 0.4 }));
    glass.position.set(HALF_L + 2.41, -1.1, 0);
    g.add(glass);
    // chassi e rodas
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(HALF_L * 2 + 2.6, 0.4, HALF_W * 2 - 0.4), dark);
    chassis.position.set(0.8, -2.95, 0);
    g.add(chassis);
    for (const x of [-HALF_L + 1, -HALF_L + 2.2, HALF_L - 1.5, HALF_L + 1.6])
      for (const z of [-HALF_W + 0.25, HALF_W - 0.25]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16), dark);
        w.rotation.x = Math.PI / 2;
        w.position.set(x, ROAD_Y + 0.5, z);
        g.add(w);
        this.wheels.push(w);
      }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.ctx.root.add(g);
    return g;
  }

  update(dt: number, _time: number, arena: ArenaApi) {
    this.clock += dt;
    const t = this.clock;
    // Os caminhões se afastam e encostam (meia distância entre 1,3 e 2,6)
    const half = 2.3 + Math.sin(t * 0.5) * 0.65 + Math.sin(t * 1.3) * 0.08;
    for (const tr of this.trucks) {
      tr.z = tr.side * half;
      tr.x = tr.side * 2.4 * Math.sin(t * 0.31);
      const sway = Math.sin(t * 2.1 + tr.side) * 0.02;
      tr.body.setNextKinematicTranslation({ x: tr.x, y: Math.abs(Math.sin(t * 3 + tr.side)) * 0.03, z: tr.z });
      tr.body.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(sway, 0, 0)));
    }

    // Cenário passando
    this.roadTex.offset.x += (SPEED * dt) / (400 / 20);
    for (const m of this.moving) {
      m.position.x -= SPEED * dt;
      if (m.position.x < -115) m.position.x += 225;
    }
    for (const w of this.wheels) w.rotation.y += dt * SPEED * 2;

    // Placa de trânsito: avisa, depois passa varrendo os baús
    this.signTimer -= dt;
    if (this.signTimer < 2 && !this.signWarned && this.signX > 900) {
      this.signWarned = true;
      // sorteia que faixa(s) a placa tapa
      const r = Math.random();
      this.boards[0].visible = r < 0.4 || r >= 0.8;
      this.boards[1].visible = r >= 0.4;
      const free = !this.boards[0].visible ? 'o caminhão de TRÁS' : !this.boards[1].visible ? 'o caminhão da FRENTE' : 'dentro do baú';
      arena.announce(`🪧 PLACA chegando! Lugar livre: ${free}!`, 'tip');
      arena.sound('horn', 0.8);
    }
    if (this.signTimer <= 0 && this.signX > 900) {
      this.signX = 40;
      this.signHit.clear();
    }
    if (this.signX < 900) {
      const before = this.signX;
      this.signX -= SPEED * dt;
      for (const f of arena.fighters) {
        if (!f.alive || f.removed || this.signHit.has(f)) continue;
        const h = f.pos('head');
        const board = this.boards[h.z > 0 ? 1 : 0].visible;
        if (board && h.y > 1.1 && h.y < 3.3 && before >= h.x && this.signX < h.x) {
          this.signHit.add(f);
          arena.hazardHit(f, 55, new THREE.Vector3(-1, 0.3, 0).normalize(), 7, 'PLAFT!');
        }
      }
      if (this.signX < -60) {
        this.signX = 999;
        this.signTimer = 13 + Math.random() * 8;
        this.signWarned = false;
      }
    }
    this.sign.position.x = this.signX;
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    // o meio do baú em que estou (o mais perto)
    const tr = this.trucks.reduce((a, b) => (Math.abs(b.z - p.z) < Math.abs(a.z - p.z) ? b : a));
    return new THREE.Vector3(THREE.MathUtils.clamp(p.x, -5.5, 5.5), 0, tr.z);
  }

  deathAt(p: THREE.Vector3): DeathKind {
    // Caiu na avenida: os caminhões vão embora e ele fica para trás
    if (p.y < ROAD_Y + 1.2) return 'left';
    return p.y < this.killY ? 'fall' : 'none';
  }
}
