import * as THREE from 'three';
import { GameMap, canvasTexture, type ArenaApi, type DeathKind } from './MapBase';

// ------------------------------------------------------------
// Mapa 4 — TREM EM MOVIMENTO
// A briga é no teto de três vagões. Postes passam rente aos lados
// e, de vez em quando, um túnel varre o teto: quem estiver em pé
// leva uma pancada! Para se salvar: pendure-se na lateral ou
// desça no engate entre os vagões. Quem cai do trem fica para trás.
// ------------------------------------------------------------

const WAGON_LEN = 7;
const GAP = 1.4;
const HALF_W = 1.5;
const WAGONS = [-(WAGON_LEN + GAP), 0, WAGON_LEN + GAP];
const SPEED = 24; // velocidade do cenário passando
const FRONT = WAGONS[2] + WAGON_LEN / 2;
const BACK = WAGONS[0] - WAGON_LEN / 2;

interface Pole {
  obj: THREE.Object3D;
  x: number;
  side: number; // 1 = lado de cá (z+), -1 = lado de lá
  hit: Set<unknown>;
}

export class Train extends GameMap {
  id = 'trem';
  name = 'Trem em Movimento';
  emoji = '🚂';
  description = 'Briga em cima de um trem a toda velocidade pelo interior.';
  hazard = 'Postes passam rente e o túnel varre quem estiver em pé!';
  music = 'trem' as const;
  killY = -8;
  camera = {
    dir: new THREE.Vector3(0.05, 0.62, 1),
    minDist: 11,
    maxDist: 23,
    fov: 42,
    center: new THREE.Vector3(0, 0.6, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-9, 0, -1), new THREE.Vector3(9, 3, 1)),
  };

  private groundTex!: THREE.Texture;
  private scenery: THREE.Object3D[] = [];
  private poles: Pole[] = [];
  private poleTimer = 5;
  private tunnel!: THREE.Group;
  private tunnelX = 999;
  private tunnelTimer = 22;
  private tunnelWarned = false;
  private tunnelHit = new Set<unknown>();
  private wheels: THREE.Object3D[] = [];
  private smokeT = 0;

  build() {
    this.lights({
      skyTop: 0x4fa3ff,
      skyBottom: 0xd8f0ff,
      fog: { color: 0xcfe8ff, near: 40, far: 150 },
      sunColor: 0xfff3d6,
      sunIntensity: 2.6,
      sunPos: new THREE.Vector3(10, 22, 12),
      hemiSky: 0xcfe8ff,
      hemiGround: 0x7a9a4a,
      hemiIntensity: 1.1,
      shadowExtent: 16,
    });

    // Chão que passa (textura andando)
    this.groundTex = canvasTexture(
      256,
      256,
      (g) => {
        g.fillStyle = '#7fb24a';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 300; i++) {
          g.fillStyle = Math.random() < 0.5 ? '#6fa13c' : '#8fc25a';
          g.fillRect(Math.random() * 256, Math.random() * 256, 6, 3);
        }
        // trilhos
        g.fillStyle = '#8a7a66';
        g.fillRect(0, 100, 256, 56);
        g.fillStyle = '#5a4a3a';
        for (let x = 0; x < 256; x += 16) g.fillRect(x, 102, 8, 52);
        g.fillStyle = '#c0c0c0';
        g.fillRect(0, 110, 256, 4);
        g.fillRect(0, 142, 256, 4);
      },
      [30, 1],
    );
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 60), new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -4.4;
    this.deco(ground, false);
    const farGround = new THREE.Mesh(new THREE.PlaneGeometry(600, 400), this.material(0x7fb24a));
    farGround.rotation.x = -Math.PI / 2;
    farGround.position.y = -4.5;
    this.deco(farGround, false);

    // Vagões: o teto é onde a briga acontece (topo em y = 0)
    const colors = [0xd94a3a, 0x2e86ab, 0xf2a541];
    const roofTex = canvasTexture(
      64,
      64,
      (g) => {
        g.fillStyle = '#6b6b70';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#5c5c61';
        g.fillRect(0, 0, 64, 4);
      },
      [1, 8],
    );
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.8, metalness: 0.2 });
    WAGONS.forEach((x, i) => {
      this.box({ x, y: -1.7, z: 0 }, { x: WAGON_LEN, y: 3.2, z: HALF_W * 2 }, this.material(colors[i], { roughness: 0.6 }));
      this.box({ x, y: -0.05, z: 0 }, { x: WAGON_LEN + 0.1, y: 0.1, z: HALF_W * 2 + 0.1 }, roofMat);
      // janelas
      for (let k = -2; k <= 2; k++) {
        for (const z of [HALF_W + 0.01, -HALF_W - 0.01]) {
          const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x335577, roughness: 0.1 }));
          w.position.set(x + k * 1.3, -1.1, z);
          if (z < 0) w.rotation.y = Math.PI;
          this.deco(w, false);
        }
      }
      // Corrimão na lateral do teto (para se pendurar)
      for (const z of [HALF_W + 0.12, -HALF_W - 0.12]) this.box({ x, y: -0.45, z }, { x: WAGON_LEN - 0.6, y: 0.08, z: 0.08 }, this.material(0xdddddd, { metalness: 0.7 }));
      // rodas
      for (const dx of [-2.4, 2.4])
        for (const z of [-1.1, 1.1]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.25, 16), this.material(0x222222, { metalness: 0.6 }));
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(x + dx, -3.6, z);
          this.deco(wheel, false);
          this.wheels.push(wheel);
        }
    });
    // Engates entre vagões (lugar seguro mais baixo!)
    for (let i = 0; i < 2; i++) {
      const gx = (WAGONS[i] + WAGONS[i + 1]) / 2;
      this.box({ x: gx, y: -1.5, z: 0 }, { x: GAP + 0.4, y: 0.25, z: 1.2 }, this.material(0x444444, { metalness: 0.6 }));
    }
    // Locomotiva (na frente)
    const loco = this.material(0x1d3557, { roughness: 0.5 });
    this.box({ x: FRONT + 3, y: -1.7, z: 0 }, { x: 5, y: 3.2, z: 2.8 }, loco);
    this.box({ x: FRONT + 1.4, y: 0.6, z: 0 }, { x: 1.8, y: 1.4, z: 2.6 }, 0x457b9d);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.4, 12), this.material(0x222222));
    chimney.position.set(FRONT + 4.4, 0.6, 0);
    this.deco(chimney);

    // Cenário que passa: árvores e morros
    for (let i = 0; i < 26; i++) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2, 6), this.material(0x7a4a2a));
      trunk.position.y = 1;
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.2, 8), this.material(0x2f7d32));
      top.position.y = 3.2;
      tree.add(trunk, top);
      const side = Math.random() < 0.5 ? -1 : 1;
      tree.position.set(-100 + Math.random() * 200, -4.4, side * (8 + Math.random() * 20));
      this.deco(tree, false);
      this.scenery.push(tree);
    }
    for (let i = 0; i < 8; i++) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(18 + Math.random() * 10, 16, 10), this.material(0x6a9e3a));
      hill.position.set(-150 + i * 45, -18, -70 - Math.random() * 30);
      this.deco(hill, false);
    }

    // Túnel (fica longe até a hora de passar)
    this.tunnel = new THREE.Group();
    const rock = this.material(0x6d6458, { roughness: 1 });
    const len = 30;
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 6, 10), rock);
    top.position.set(len / 2, 1.3 + 3, 0);
    const l = new THREE.Mesh(new THREE.BoxGeometry(len, 8, 2), rock);
    l.position.set(len / 2, -1, 3.2);
    const r = l.clone();
    r.position.z = -3.2;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 6.4), new THREE.MeshStandardMaterial({ color: 0xffcc00 }));
    mouth.position.set(0, 1.45, 0);
    this.tunnel.add(top, l, r, mouth);
    this.tunnel.position.x = 999;
    this.deco(this.tunnel);

    this.prop('caixa', new THREE.Vector3(-8, 0.5, 0.4));
    this.prop('caixa', new THREE.Vector3(8.5, 0.5, -0.4), 0x8fbf5a);
    this.prop('barril', new THREE.Vector3(2.5, 0.5, 0.6));

    this.spawns = [new THREE.Vector3(-2.2, 0.08, 0.3), new THREE.Vector3(2.2, 0.08, -0.3), new THREE.Vector3(-8.6, 0.08, 0), new THREE.Vector3(8.6, 0.08, 0)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    // Cenário passando
    this.groundTex.offset.x += (SPEED * dt) / (400 / 30);
    for (const s of this.scenery) {
      s.position.x -= SPEED * dt;
      if (s.position.x < -110) s.position.x += 220;
    }
    for (const w of this.wheels) w.rotation.y = time * 20;
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.12;
      arena.effects.dust(new THREE.Vector3(FRONT + 4.4, 1.4, 0), 0.2, 0x999999);
    }

    // Vento: quem está no ar é empurrado para trás
    for (const f of arena.fighters) {
      if (f.removed || f.grounded) continue;
      for (const b of f.ragdoll.bodies()) {
        const v = b.linvel();
        b.setLinvel({ x: v.x - 2.2 * dt, y: v.y, z: v.z }, true);
      }
    }

    // ----- postes
    this.poleTimer -= dt;
    if (this.poleTimer <= 0) {
      this.poleTimer = 5 + Math.random() * 4;
      const side = Math.random() < 0.5 ? 1 : -1;
      this.spawnPole(side);
      arena.announce(side > 0 ? '⚠ Poste vindo do lado de CÁ!' : '⚠ Poste vindo do lado de LÁ!', 'tip');
      arena.sound('horn', 0.5);
    }
    for (const p of this.poles) {
      const before = p.x;
      p.x -= SPEED * 1.1 * dt;
      p.obj.position.x = p.x;
      // O braço do poste cobre a faixa da beirada do teto.
      for (const f of arena.fighters) {
        if (!f.alive || f.removed || p.hit.has(f)) continue;
        const c = f.pos('head');
        const inZone = c.z * p.side > HALF_W - 0.75 && c.z * p.side < HALF_W + 1.2 && c.y > 0.6 && c.y < 2.8;
        if (inZone && before >= c.x && p.x < c.x) {
          p.hit.add(f);
          arena.hazardHit(f, 45, new THREE.Vector3(-1, 0.45, p.side * 0.6).normalize(), 9, 'POSTE!');
        }
      }
    }
    this.poles = this.poles.filter((p) => {
      if (p.x < -40) {
        p.obj.parent?.remove(p.obj);
        return false;
      }
      return true;
    });

    // ----- túnel
    this.tunnelTimer -= dt;
    if (this.tunnelTimer < 3.5 && !this.tunnelWarned) {
      this.tunnelWarned = true;
      arena.announce('🚇 TÚNEL! Abaixe-se: pendure-se na lateral ou desça no engate!', 'tip');
      arena.sound('horn', 1);
    }
    if (this.tunnelTimer <= 0 && this.tunnelX > 900) {
      this.tunnelX = FRONT + 22;
      this.tunnelHit.clear();
    }
    if (this.tunnelX < 900) {
      const before = this.tunnelX;
      this.tunnelX -= SPEED * dt;
      this.tunnel.position.x = this.tunnelX;
      for (const f of arena.fighters) {
        if (!f.alive || f.removed || this.tunnelHit.has(f)) continue;
        const h = f.pos('head');
        if (h.y > 1.0 && before >= h.x && this.tunnelX < h.x) {
          this.tunnelHit.add(f);
          arena.hazardHit(f, 60, new THREE.Vector3(-1, 0.25, 0).normalize(), 11, 'TÚNEL!');
        }
      }
      if (this.tunnelX + 30 < BACK - 10) {
        this.tunnelX = 999;
        this.tunnel.position.x = 999;
        this.tunnelTimer = 20 + Math.random() * 8;
        this.tunnelWarned = false;
      }
    }
  }

  private spawnPole(side: number) {
    const g = new THREE.Group();
    const m = this.material(0x6b4a2a);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 7.5, 8), m);
    post.position.set(0, -0.6, side * (HALF_W + 1.9));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 2.2), m);
    arm.position.set(0, 1.5, side * (HALF_W + 0.9));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    lamp.position.set(0, 1.3, side * (HALF_W + 0.1));
    g.add(post, arm, lamp);
    g.position.x = FRONT + 30;
    this.deco(g);
    this.poles.push({ obj: g, x: g.position.x, side, hit: new Set() });
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < -4.2) return 'left';
    const offTrain = Math.abs(p.z) > HALF_W + 0.4 || p.x < BACK - 0.4 || p.x > FRONT + 5.6;
    if (offTrain && p.y < -2.3) return 'left';
    return 'none';
  }
}
