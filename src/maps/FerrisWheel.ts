import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi } from './MapBase';
import { RAPIER, G_WORLD, G_ALL, groups } from '../physics/Physics';
import { cityBackdrop, grimeTexture, hazeBelow } from './City';

// ------------------------------------------------------------
// Mapa 3 — RODA-GIGANTE
// Um parque de diversões velho no alto de um prédio. A briga é na
// plataforma de embarque e dentro das cabines, que sobem e descem
// devagar. Pular de cabine em cabine é o jeito de fugir... ou de
// cair na neblina lá embaixo. De vez em quando a roda dispara!
// ------------------------------------------------------------

const C = new THREE.Vector3(0, 9.4, 0); // centro da roda
const R = 6.8; // raio (até o ponto onde a cabine fica pendurada)
const N = 8; // número de cabines
const HANG = 2.6; // distância do ponto de pendurar até o piso da cabine
const GW = 1.3; // meia largura da cabine (x)
const GD = 1.05; // meia profundidade da cabine (z)
const CAB_COLORS = [0xe63946, 0xffb703, 0x2a9d8f, 0x3a86ff];

interface Gondola {
  body: RAPIER.RigidBody;
  offset: number; // ângulo da cabine na roda
}

export class FerrisWheel extends GameMap {
  id = 'rodagigante';
  name = 'Roda-Gigante';
  emoji = '🎡';
  description = 'Um parque de diversões velho no terraço de um arranha-céu.';
  hazard = 'As cabines sobem e descem. Pule de uma para outra... e não caia na neblina!';
  music = 'gelatina' as const;
  killY = -10;
  camera = {
    dir: new THREE.Vector3(0, 0.4, 1),
    minDist: 15,
    maxDist: 30,
    fov: 44,
    center: new THREE.Vector3(0, 3, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-8, 0.5, -1), new THREE.Vector3(8, 12, 1)),
  };

  private gondolas: Gondola[] = [];
  private wheel = new THREE.Group();
  private bulbs: THREE.Mesh[] = [];
  private angle = 0;
  private speed = 0.15;
  private rushT = 0;
  private rushTimer = 16;
  private blink: THREE.Mesh[] = [];

  build() {
    this.lights({
      // fim de tarde enevoado sobre a cidade
      skyTop: 0x34476e,
      skyBottom: 0xf2a77e,
      fog: { color: 0xb59a9f, near: 28, far: 115 },
      sunColor: 0xffd2a8,
      sunIntensity: 2.2,
      sunPos: new THREE.Vector3(-12, 22, 14),
      hemiSky: 0xc9d4ea,
      hemiGround: 0x5a4a48,
      hemiIntensity: 1.25,
      shadowExtent: 15,
    });

    // ---------------- plataformas de embarque (dos dois lados)
    const deck = new THREE.MeshStandardMaterial({ map: grimeTexture('#6f6a66', [4, 1], { tiles: 8, cracks: true }), roughness: 0.95 });
    const rail = this.material(0xd9d2c3, { roughness: 0.5, metalness: 0.3 });
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([3, 1]) });
    for (const s of [-1, 1]) {
      const x = s * 6.9;
      this.box({ x, y: -0.4, z: 0 }, { x: 7, y: 0.8, z: 4.4 }, deck);
      // borda pintada (perto da roda)
      this.box({ x: s * 3.45, y: 0.01, z: 0 }, { x: 0.12, y: 0.03, z: 4.4 }, stripes, { collide: false, shadow: false });
      // corrimão no fundo (dá para agarrar)
      this.box({ x, y: 1.0, z: -2.1 }, { x: 7, y: 0.09, z: 0.09 }, rail);
      for (let k = 0; k < 5; k++) this.box({ x: x - 3.2 + k * 1.6, y: 0.5, z: -2.1 }, { x: 0.08, y: 1, z: 0.08 }, rail, { collide: false });
      // pilar que segura a plataforma, descendo para a neblina
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 60, 2.4), this.material(0x4a4a52));
      pillar.position.set(x, -30.8, 0);
      this.deco(pillar);
    }
    // Bilheteria (dá para subir no telhado)
    const booth = this.material(0xe76f51, { roughness: 0.7 });
    this.box({ x: -9.2, y: 0.9, z: -1.2 }, { x: 1.8, y: 1.8, z: 1.6 }, booth);
    this.box({ x: -9.2, y: 1.9, z: -1.2 }, { x: 2.2, y: 0.2, z: 2 }, this.material(0xf4e9d8));
    const ticket = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.5),
      new THREE.MeshBasicMaterial({
        map: (() => {
          const c = document.createElement('canvas');
          c.width = 256;
          c.height = 96;
          const g = c.getContext('2d')!;
          g.fillStyle = '#fff3d6';
          g.fillRect(0, 0, 256, 96);
          g.fillStyle = '#c1121f';
          g.font = '900 54px "Lilita One", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('INGRESSOS', 128, 50);
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          return t;
        })(),
      }),
    );
    ticket.position.set(-9.2, 1.45, -0.39);
    this.deco(ticket, false);

    // ---------------- a roda (só desenho; gira inteira)
    const white = this.material(0xf1ece2, { roughness: 0.45, metalness: 0.35 });
    const red = this.material(0xd62828, { roughness: 0.5, metalness: 0.3 });
    for (const z of [-1.5, 1.5]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.16, 8, 72), white);
      rim.position.z = z;
      this.wheel.add(rim);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(R * 0.62, 0.1, 6, 56), red);
      inner.position.z = z;
      this.wheel.add(inner);
      for (let i = 0; i < N * 2; i++) {
        const a = (i / (N * 2)) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, R, 6), i % 2 ? red : white);
        spoke.position.set((Math.cos(a) * R) / 2, (Math.sin(a) * R) / 2, z);
        spoke.rotation.z = a - Math.PI / 2;
        this.wheel.add(spoke);
      }
    }
    // travessas entre as duas faces (onde as cabines ficam penduradas)
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 8), white);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      this.wheel.add(bar);
    }
    // lâmpadas no aro
    const bulbGeo = new THREE.SphereGeometry(0.11, 8, 6);
    const bulbCols = [0xfff1a8, 0xff8fab, 0x9bf6ff];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const b = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: bulbCols[i % 3], toneMapped: false }));
      b.position.set(Math.cos(a) * (R + 0.2), Math.sin(a) * (R + 0.2), 1.62);
      this.wheel.add(b);
      this.bulbs.push(b);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.6, 20), red);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);
    this.wheel.position.copy(C);
    this.deco(this.wheel);
    // pernas (cavalete em "A") descendo até a neblina
    for (const z of [-2.4]) {
      // (só as pernas de trás, para não tapar a câmera)
      for (const s of [-1, 1]) {
        const top = new THREE.Vector3(0, C.y, z);
        const foot = new THREE.Vector3(s * 9, -40, z * 2.5);
        const len = top.distanceTo(foot);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, len, 0.5), white);
        leg.position.copy(top).add(foot).multiplyScalar(0.5);
        leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().sub(top).normalize());
        this.deco(leg);
      }
    }

    // ---------------- cabines (cinemáticas: sobem e descem com a roda)
    for (let i = 0; i < N; i++) {
      const offset = -Math.PI / 2 + (i / N) * Math.PI * 2; // a 0 fica embaixo
      this.gondolas.push({ body: this.makeGondola(CAB_COLORS[i % CAB_COLORS.length], this.gondolaPos(offset)), offset });
    }

    // ---------------- cidade e neblina lá embaixo
    const city = cityBackdrop(this.ctx.root, { below: 60, radius: [40, 120], count: 40, walls: ['#5d5763', '#6b6370', '#4f5866', '#625b60'] });
    this.blink.push(...city.blink);
    hazeBelow(this.ctx.root, 0xd8c4c4, [
      [-9, 0.55],
      [-16, 0.7],
    ]);

    this.prop('caixa', new THREE.Vector3(-5.2, 0.5, 1));
    this.prop('barril', new THREE.Vector3(7.5, 0.5, -1), 0x2a9d8f);
    this.prop('bola', new THREE.Vector3(5, 0.6, 1), 0xffb703);

    this.spawns = [new THREE.Vector3(-5.6, 0.05, 0.3), new THREE.Vector3(5.6, 0.05, 0.3), new THREE.Vector3(0, 0.08, 0), new THREE.Vector3(-8, 0.05, 1.2)];
  }

  /** Piso da cabine para um ângulo da roda. */
  private gondolaPos(a: number, out = new THREE.Vector3()) {
    return out.set(C.x + Math.cos(a) * R, C.y + Math.sin(a) * R - HANG, 0);
  }

  private makeGondola(color: number, pos: THREE.Vector3) {
    const world = this.ctx.physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
    const add = (desc: RAPIER.ColliderDesc, grab = true) => {
      const c = world.createCollider(desc.setFriction(1).setRestitution(0.05).setCollisionGroups(groups(G_WORLD, G_ALL)), body);
      this.ctx.physics.register(c, { kind: 'static', grabbable: grab });
    };
    add(RAPIER.ColliderDesc.cuboid(GW, 0.12, GD).setTranslation(0, -0.12, 0)); // piso
    for (const z of [-GD, GD]) add(RAPIER.ColliderDesc.cuboid(GW, 0.32, 0.05).setTranslation(0, 0.32, z)); // paredinhas
    for (const x of [-GW + 0.08, GW - 0.08]) for (const z of [-GD + 0.08, GD - 0.08]) add(RAPIER.ColliderDesc.cylinder(1.15, 0.06).setTranslation(x, 1.15, z)); // colunas
    add(RAPIER.ColliderDesc.cuboid(GW + 0.1, 0.1, GD + 0.12).setTranslation(0, 2.4, 0)); // teto (dá para subir!)

    const g = new THREE.Group();
    const paint = this.material(color, { roughness: 0.45, metalness: 0.2 });
    const light = this.material(0xf6efe2, { roughness: 0.5 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(GW * 2, 0.24, GD * 2), this.material(0x5a5450));
    floor.position.y = -0.12;
    g.add(floor);
    for (const z of [-GD, GD]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(GW * 2, 0.64, 0.1), paint);
      wall.position.set(0, 0.32, z);
      g.add(wall);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(GW * 2 + 0.04, 0.08, 0.14), light);
      trim.position.set(0, 0.66, z);
      g.add(trim);
    }
    for (const x of [-GW + 0.08, GW - 0.08])
      for (const z of [-GD + 0.08, GD - 0.08]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 8), light);
        pole.position.set(x, 1.15, z);
        g.add(pole);
      }
    // teto listrado (cúpula achatada)
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(GW + 0.15, GW + 0.35, 0.22, 16), paint);
    roof.scale.z = (GD + 0.15) / (GW + 0.15);
    roof.position.y = 2.42;
    g.add(roof);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), light);
    knob.position.y = 2.6;
    g.add(knob);
    // haste até o ponto de pendurar na roda
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, HANG - 2.5, 6), light);
    rod.position.y = 2.5 + (HANG - 2.5) / 2;
    g.add(rod);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.ctx.root.add(g);
    this.ctx.links.add(body, g);
    return body;
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    // dentro de uma cabine: fica no meio dela; senão, a plataforma mais perto
    for (const g of this.gondolas) {
      const t = g.body.translation();
      if (Math.abs(p.x - t.x) < GW + 0.2 && p.y > t.y - 0.5 && p.y < t.y + 2.6) return new THREE.Vector3(t.x, t.y, 0);
    }
    return new THREE.Vector3(Math.sign(p.x || 1) * 6.4, 0, 0);
  }

  update(dt: number, time: number, arena: ArenaApi) {
    // De vez em quando a roda dispara (e depois volta ao normal)
    this.rushTimer -= dt;
    if (this.rushTimer <= 0 && this.rushT <= 0) {
      this.rushT = 5;
      this.rushTimer = 18 + Math.random() * 8;
      arena.announce('🎡 A RODA DISPAROU! Segure-se!', 'tip');
      arena.sound('alarm', 0.6);
    }
    this.rushT -= dt;
    const want = this.rushT > 0 ? 0.5 : 0.15;
    this.speed += (want - this.speed) * Math.min(1, dt * 1.2);
    this.angle += this.speed * dt;

    this.wheel.rotation.z = this.angle;
    const p = new THREE.Vector3();
    for (const g of this.gondolas) {
      this.gondolaPos(g.offset + this.angle, p);
      g.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    }
    // lâmpadas piscando em onda
    const k = Math.floor(time * 8);
    this.bulbs.forEach((b, i) => (b.visible = (i + k) % 4 !== 0));
    const on = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = on;
  }
}
