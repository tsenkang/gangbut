import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi } from './MapBase';
import { RAPIER, G_WORLD, G_ALL, groups } from '../physics/Physics';
import { cityBackdrop, grimeTexture, hazeBelow, iBeamGeometry } from './City';

// ------------------------------------------------------------
// Mapa 8 — ELEVADORES
// Três elevadores de obra, sem paredes, subindo e descendo lado a
// lado na fachada de um prédio. Dos dois lados tem um andar firme.
// Os elevadores não esperam ninguém: pule na hora certa! Lá em
// cima tem uma viga que raspa a cabeça de quem ficar em pé.
// ------------------------------------------------------------

const CARS = [-3.3, 0, 3.3]; // x de cada elevador
const CW = 1.45; // meia largura (x)
const CD = 1.6; // meia profundidade (z)
const LOW = -2.2;
const HIGH = 5.4;
const BEAM_Y = 7.4; // viga lá de cima (bate em quem passa em pé)

interface Car {
  body: RAPIER.RigidBody;
  x: number;
  phase: number;
  y: number;
  speed: number;
}

export class Elevators extends GameMap {
  id = 'elevadores';
  name = 'Elevadores';
  emoji = '🛗';
  description = 'Três elevadores de obra subindo e descendo na fachada de um prédio.';
  hazard = 'Os elevadores não esperam ninguém! E lá no alto a viga raspa a cabeça.';
  music = 'telhado' as const;
  killY = -12;
  camera = {
    dir: new THREE.Vector3(0, 0.45, 1),
    minDist: 14,
    maxDist: 27,
    fov: 44,
    center: new THREE.Vector3(0, 1.5, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-7, -1, -1), new THREE.Vector3(7, 6, 1)),
  };

  private cars: Car[] = [];
  private clock = 0;
  private blink: THREE.Mesh[] = [];
  private beamHitCd = new Map<object, number>();
  private lamps: THREE.MeshBasicMaterial[] = [];

  build() {
    this.lights({
      // fim de tarde azulado, cidade enevoada
      skyTop: 0x3e5276,
      skyBottom: 0xe8b796,
      fog: { color: 0xa7a0a8, near: 28, far: 110 },
      sunColor: 0xffe1c2,
      sunIntensity: 2.2,
      sunPos: new THREE.Vector3(-12, 20, 14),
      hemiSky: 0xcfd8ea,
      hemiGround: 0x4f4642,
      hemiIntensity: 1.25,
      shadowExtent: 15,
    });

    // ---------------- andares firmes dos dois lados
    const floor = new THREE.MeshStandardMaterial({ map: grimeTexture('#7a756e', [2, 2], { tiles: 4, cracks: true }), roughness: 1 });
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([3, 1]) });
    for (const s of [-1, 1]) {
      const x = s * 8.1;
      this.box({ x, y: -0.4, z: 0 }, { x: 6, y: 0.8, z: 4.4 }, floor);
      this.box({ x: s * 5.12, y: 0.01, z: 0 }, { x: 0.12, y: 0.03, z: 4.4 }, stripes, { collide: false, shadow: false });
      // parede do prédio no fundo, com janela
      this.box({ x, y: 2, z: -2.4 }, { x: 6, y: 4, z: 0.4 }, this.material(0x8a6f5c, { roughness: 1 }));
      // andar de cima (alto, dá para chegar pelo elevador)
      this.box({ x: s * 8.6, y: HIGH - 0.25, z: -0.6 }, { x: 5, y: 0.5, z: 3.2 }, floor);
      this.box({ x: s * 6.2, y: HIGH + 0.5, z: -2 }, { x: 0.1, y: 1, z: 0.1 }, this.material(0xd9d2c3), { collide: false });
    }
    // corrimão no andar de cima (para se pendurar)
    for (const s of [-1, 1]) this.box({ x: s * 8.6, y: HIGH + 0.95, z: -2.1 }, { x: 5, y: 0.08, z: 0.08 }, this.material(0xd9d2c3));

    // ---------------- estrutura do poço (só desenho) e viga de cima
    const steel = new THREE.MeshStandardMaterial({ color: 0x3f6f9c, roughness: 0.6, metalness: 0.4 });
    for (const x of [-5, -1.65, 1.65, 5]) {
      for (const z of [-1.9]) {
        const col = new THREE.Mesh(iBeamGeometry(40, 0.4, 0.4), steel);
        col.rotation.x = Math.PI / 2;
        col.position.set(x, -10, z);
        this.deco(col);
      }
    }
    // a viga de cima tem colisão (bate a cabeça e dá para se pendurar)
    const top = new THREE.Mesh(iBeamGeometry(11, 0.5, 0.5), steel);
    top.rotation.y = Math.PI / 2;
    top.position.set(0, BEAM_Y, 0);
    this.deco(top);
    this.ctx.physics.addStaticBox({ x: 0, y: BEAM_Y, z: 0 }, { x: 5.5, y: 0.25, z: 0.25 });
    // motor e polias lá no alto
    const motor = new THREE.Mesh(new THREE.BoxGeometry(10.5, 1.2, 1.4), this.material(0x4a4f57, { metalness: 0.5 }));
    motor.position.set(0, BEAM_Y + 3.2, -1.9);
    this.deco(motor);

    // ---------------- os três elevadores (cinemáticos)
    const world = this.ctx.physics.world;
    CARS.forEach((x, i) => {
      const phase = (i * Math.PI * 2) / 3;
      const y = this.carY(phase, 0);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, 0));
      const add = (desc: RAPIER.ColliderDesc) => {
        const c = world.createCollider(desc.setFriction(1).setRestitution(0.05).setCollisionGroups(groups(G_WORLD, G_ALL)), body);
        this.ctx.physics.register(c, { kind: 'static', grabbable: true });
      };
      add(RAPIER.ColliderDesc.cuboid(CW, 0.15, CD).setTranslation(0, -0.15, 0)); // piso
      add(RAPIER.ColliderDesc.cuboid(CW, 0.5, 0.05).setTranslation(0, 0.5, -CD)); // grade do fundo
      add(RAPIER.ColliderDesc.cuboid(CW, 0.05, 0.05).setTranslation(0, 1, CD)); // barra da frente (alta: dá para passar por baixo)

      const g = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(CW * 2, 0.3, CD * 2), new THREE.MeshStandardMaterial({ map: grimeTexture('#6f747c', [1, 1], { tiles: 6 }), roughness: 0.6, metalness: 0.5 }));
      deck.position.y = -0.15;
      g.add(deck);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(CW * 2 + 0.02, 0.1, CD * 2 + 0.02), stripes);
      edge.position.y = -0.26;
      g.add(edge);
      const yellow = this.material(0xf2b705, { roughness: 0.5, metalness: 0.3 });
      const back = new THREE.Mesh(new THREE.BoxGeometry(CW * 2, 1, 0.08), new THREE.MeshStandardMaterial({ color: 0xf2b705, wireframe: true }));
      back.position.set(0, 0.5, -CD);
      g.add(back);
      for (const sx of [-CW, CW]) {
        for (const sz of [-CD, CD]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.1), yellow);
          post.position.set(sx, 0.5, sz);
          g.add(post);
        }
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(CW * 2, 0.1, 0.1), yellow);
      bar.position.set(0, 1, CD);
      g.add(bar);
      const bar2 = bar.clone();
      bar2.position.z = -CD;
      g.add(bar2);
      // cabos subindo
      for (const sx of [-0.9, 0.9]) {
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 30, 4), this.material(0x1a1a1a));
        cable.position.set(sx, 15, -CD + 0.1);
        g.add(cable);
      }
      // luz que avisa: verde = subindo, vermelho = descendo
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x33ff66, toneMapped: false });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), lampMat);
      lamp.position.set(0, 1.2, -CD);
      g.add(lamp);
      this.lamps.push(lampMat);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.ctx.root.add(g);
      this.ctx.links.add(body, g);
      this.cars.push({ body, x, phase, y, speed: 0 });
    });

    const city = cityBackdrop(this.ctx.root, { below: 60, radius: [40, 115], count: 40, walls: ['#5d5763', '#6b6370', '#4f5866', '#625b60'] });
    this.blink.push(...city.blink);
    hazeBelow(this.ctx.root, 0xcdbfc0, [
      [-12, 0.45],
      [-22, 0.65],
    ]);

    this.prop('caixa', new THREE.Vector3(-7.5, 0.5, 1));
    this.prop('barril', new THREE.Vector3(8, 0.5, 1.2), 0x2b5e8a);
    this.prop('caixa', new THREE.Vector3(8.6, HIGH + 0.5, -0.6));

    this.spawns = [new THREE.Vector3(-7, 0.05, 0.5), new THREE.Vector3(7, 0.05, 0.5), new THREE.Vector3(-9, 0.05, -0.8), new THREE.Vector3(9, 0.05, -0.8)];
  }

  /** Altura do elevador: para um pouquinho em cima e embaixo, anda no meio. */
  private carY(phase: number, t: number) {
    const s = Math.sin(t * 0.55 + phase);
    const k = THREE.MathUtils.clamp(s * 1.35, -1, 1); // achatado = paradinha nas pontas
    return LOW + ((k + 1) / 2) * (HIGH - LOW);
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.clock += dt;
    this.cars.forEach((c, i) => {
      const y = this.carY(c.phase, this.clock);
      c.speed = (y - c.y) / Math.max(dt, 1e-4);
      c.y = y;
      c.body.setNextKinematicTranslation({ x: c.x, y, z: 0 });
      this.lamps[i].color.setHex(c.speed > 0.05 ? 0x33ff66 : c.speed < -0.05 ? 0xff3344 : 0xffd23f);
    });

    // A viga de cima raspa quem chegar lá em pé num elevador subindo
    for (const f of arena.fighters) {
      if (!f.alive || f.removed) continue;
      const cd = (this.beamHitCd.get(f) ?? 0) - dt;
      this.beamHitCd.set(f, cd);
      if (cd > 0) continue;
      const h = f.pos('head');
      if (Math.abs(h.x) < 5 && Math.abs(h.z) < 0.6 && Math.abs(h.y - BEAM_Y) < 0.6 && f.vel('head').y > 0.3) {
        this.beamHitCd.set(f, 1.5);
        arena.hazardHit(f, 30, new THREE.Vector3(0, -0.3, f.pos('chest').z >= 0 ? 1 : -1).normalize(), 6, 'TOING!');
      }
    }
    const on = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = on;
  }
}
