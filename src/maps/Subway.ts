import * as THREE from 'three';
import { GameMap, canvasTexture, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER } from '../physics/Physics';
import { grimeTexture } from './City';
import type { Fighter } from '../characters/Fighter';

// ------------------------------------------------------------
// Mapa 16 — METRÔ
// Uma plataforma de estação no meio de dois trilhos. De tempos em
// tempos um trem passa direto, a toda velocidade, por um dos
// lados: as luzes do trilho piscam antes. Quem estiver no trilho
// (ou colado na beirada) é levado junto. Dá para subir de volta
// para a plataforma pela beirada.
// ------------------------------------------------------------

const PLAT_W = 3.6; // meia largura da plataforma (z)
const PLAT_L = 16; // meia largura (x)
const TRACK_Z = PLAT_W + 2.1; // centro de cada trilho
const PIT_Y = -1.4; // fundo do trilho
const TRAIN_SPEED = 38;
const MEZ_Y = 2.8; // altura do mezanino

interface Run {
  side: number;
  x: number;
  dir: number;
  hit: Set<Fighter>;
}

export class Subway extends GameMap {
  id = 'metro';
  name = 'Metrô';
  emoji = '🚇';
  description = 'A plataforma de uma estação, com trens passando direto pelos dois lados.';
  hazard = 'Quando as luzes do trilho piscarem, saia de lá: o trem passa a toda!';
  music = 'trem' as const;
  killY = -8;
  camera = {
    dir: new THREE.Vector3(0, 0.75, 1),
    minDist: 14,
    maxDist: 29,
    fov: 44,
    center: new THREE.Vector3(0, 0.4, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-12, -1.5, -5), new THREE.Vector3(12, 3, 5)),
  };

  private trains: THREE.Group[] = [];
  private run: Run | null = null;
  private timer = 9;
  private warnSide = 0;
  private trackLights: { side: number; mat: THREE.MeshBasicMaterial }[] = [];
  /** Quem o trem pegou (sai do jogo logo depois). */
  private runOver = new Map<Fighter, number>();
  private escalator = { x0: 0, x1: 0, z: 0, angle: 0 };
  private lift!: RAPIER.RigidBody;
  private liftT = 0;

  build() {
    this.lights({
      // subsolo: luz fria de lâmpada fluorescente
      skyTop: 0x14161c,
      skyBottom: 0x1d2028,
      fog: { color: 0x1a1d24, near: 20, far: 60 },
      sunColor: 0xeaf2ff,
      sunIntensity: 1.6,
      sunPos: new THREE.Vector3(-4, 18, 6),
      hemiSky: 0xc7d4ea,
      hemiGround: 0x3a3630,
      hemiIntensity: 1.5,
      shadowExtent: 20,
    });

    // ---------------- plataforma (piso de ladrilho)
    const tile = new THREE.MeshStandardMaterial({ map: grimeTexture('#b8b2a6', [10, 3], { tiles: 8, dark: 'rgba(0,0,0,0.15)' }), roughness: 0.7 });
    this.box({ x: 0, y: -0.7, z: 0 }, { x: PLAT_L * 2, y: 1.4, z: PLAT_W * 2 }, tile);
    // faixa amarela tátil na beirada
    for (const s of [-1, 1]) this.box({ x: 0, y: 0.01, z: s * (PLAT_W - 0.3) }, { x: PLAT_L * 2, y: 0.02, z: 0.35 }, this.material(0xf2c94c), { collide: false, shadow: false });
    // colunas (dá para agarrar)
    const col = new THREE.MeshStandardMaterial({ map: grimeTexture('#3d6a8a', [1, 4], { tiles: 4 }), roughness: 0.6 });
    for (const x of [-12, -6, 0, 6, 12]) this.box({ x, y: 2.5, z: 0 }, { x: 0.6, y: 5, z: 0.6 }, col);
    // bancos e lixeiras (obstáculos para subir)
    for (const x of [-9, -3, 3, 9]) this.box({ x, y: 0.25, z: x % 2 ? 1.2 : -1.2 }, { x: 2, y: 0.5, z: 0.6 }, this.material(0x8a5a3a));
    // lado direito: escada rolante e elevador até um mezanino mais alto
    const metal = this.material(0x8d939b, { metalness: 0.7, roughness: 0.4 });
    const ESC_X0 = 5.5;
    const ESC_X1 = 10.5;
    const angle = Math.atan2(MEZ_Y, ESC_X1 - ESC_X0);
    const len = Math.hypot(MEZ_Y, ESC_X1 - ESC_X0);
    this.box(
      { x: (ESC_X0 + ESC_X1) / 2, y: MEZ_Y / 2 - 0.1, z: -2.5 },
      { x: len, y: 0.2, z: 1.3 },
      new THREE.MeshStandardMaterial({ map: grimeTexture('#3a3d42', [8, 1], { tiles: 16 }), roughness: 0.5, metalness: 0.6 }),
      { rot: new THREE.Euler(0, 0, angle), friction: 1 },
    );
    for (const z of [-3.2, -1.8]) this.box({ x: (ESC_X0 + ESC_X1) / 2, y: MEZ_Y / 2 + 0.55, z }, { x: len, y: 0.9, z: 0.12 }, metal, { rot: new THREE.Euler(0, 0, angle) });
    this.escalator = { x0: ESC_X0, x1: ESC_X1, z: -2.5, angle };
    // mezanino (plataforma alta)
    this.box({ x: (ESC_X1 + PLAT_L) / 2, y: MEZ_Y - 0.15, z: -1.5 }, { x: PLAT_L - ESC_X1, y: 0.3, z: 4.2 }, tile);
    this.box({ x: (ESC_X1 + PLAT_L) / 2, y: MEZ_Y + 0.5, z: 0.6 }, { x: PLAT_L - ESC_X1, y: 0.08, z: 0.08 }, metal);
    // elevador (sobe e desce sozinho)
    const lift = new THREE.Group();
    const floorL = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 1.8), metal);
    lift.add(floorL);
    const cage = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 1.8), new THREE.MeshStandardMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.25 }));
    cage.position.y = 1.1;
    lift.add(cage);
    this.lift = this.kinematic(new THREE.Vector3(14.5, -0.1, 2), RAPIER.ColliderDesc.cuboid(0.9, 0.1, 0.9), lift);
    // placa da estação
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 0.8),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(512, 100, (g) => {
          g.fillStyle = '#1d3f8f';
          g.fillRect(0, 0, 512, 100);
          g.fillStyle = '#ffffff';
          g.font = '900 58px "Lilita One", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('ESTAÇÃO MOLENGA', 256, 54);
        }),
      }),
    );
    sign.position.set(-8, 3.6, 0.31);
    this.deco(sign, false);

    // ---------------- trilhos (valas dos dois lados)
    const ballast = new THREE.MeshStandardMaterial({ map: grimeTexture('#4a4542', [20, 2], { dark: 'rgba(0,0,0,0.3)' }), roughness: 1 });
    const steel = this.material(0x9aa0a8, { metalness: 0.8, roughness: 0.3 });
    for (const s of [-1, 1]) {
      this.box({ x: 0, y: PIT_Y - 0.3, z: s * TRACK_Z }, { x: 80, y: 0.6, z: 4.2 }, ballast);
      for (const dz of [-0.7, 0.7]) this.box({ x: 0, y: PIT_Y + 0.08, z: s * TRACK_Z + dz }, { x: 80, y: 0.16, z: 0.12 }, steel, { collide: false });
      // parede do túnel do outro lado do trilho (a da frente é só uma mureta, para a câmera ver)
      const wallMat = new THREE.MeshStandardMaterial({ map: grimeTexture('#d9d2c2', [20, 3], { tiles: 10 }), roughness: 0.7 });
      if (s < 0) this.box({ x: 0, y: 2, z: s * (TRACK_Z + 2.4) }, { x: 80, y: 7, z: 0.6 }, wallMat, { grabbable: false });
      else this.box({ x: 0, y: PIT_Y + 0.6, z: s * (TRACK_Z + 2.4) }, { x: 80, y: 1.2, z: 0.6 }, wallMat, { grabbable: false });
      // luzes de aviso ao longo do trilho
      for (let x = -14; x <= 14; x += 4) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x331111, toneMapped: false });
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat);
        l.position.set(x, PIT_Y + (s > 0 ? 1.3 : 0.6), s * (TRACK_Z + 2.05));
        this.deco(l, false);
        this.trackLights.push({ side: s, mat });
      }
      // trem (só desenho; a pancada é calculada)
      this.trains.push(this.makeTrain(s));
    }
    // luminárias na parede do fundo
    for (let x = -14; x <= 14; x += 7) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, 0.1), new THREE.MeshBasicMaterial({ color: 0xf2f6ff }));
      lamp.position.set(x, 4.6, -(TRACK_Z + 2.05));
      this.deco(lamp, false);
    }
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([30, 1]) });
    for (const s of [-1, 1]) this.box({ x: 0, y: -0.7, z: s * (PLAT_W + 0.02) }, { x: PLAT_L * 2, y: 1.4, z: 0.04 }, stripes, { collide: false, shadow: false });

    this.prop('caixa', new THREE.Vector3(-6, 0.5, 2));
    this.prop('barril', new THREE.Vector3(-12, 0.5, -2), 0x2b5e8a);
    // cones de trânsito em volta da escada rolante (dá para pegar e jogar)
    for (const [x, z] of [
      [4.8, -1.5],
      [4.8, -3.4],
      [7, -0.6],
      [12, 1.4],
      [-3, 2.6],
    ])
      this.prop('cone', new THREE.Vector3(x, 0.45, z));

    this.spawns = [new THREE.Vector3(-8, 0.05, 1.5), new THREE.Vector3(8, 0.05, 1.5), new THREE.Vector3(-4, 0.05, -1.5), new THREE.Vector3(4, 0.05, 1.5)];
  }

  private makeTrain(side: number) {
    const g = new THREE.Group();
    const body = this.material(0xd8dde3, { roughness: 0.35, metalness: 0.4 });
    const stripe = this.material(side > 0 ? 0xd62828 : 0x1d6fd6);
    for (let i = 0; i < 4; i++) {
      const car = new THREE.Mesh(new THREE.BoxGeometry(11, 3.4, 3.2), body);
      car.position.set(i * 11.5, PIT_Y + 2, 0);
      g.add(car);
      const st = new THREE.Mesh(new THREE.BoxGeometry(11.02, 0.4, 3.24), stripe);
      st.position.set(i * 11.5, PIT_Y + 1.5, 0);
      g.add(st);
      for (let w = 0; w < 4; w++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 3.26), this.material(0x22303c, { roughness: 0.1 }));
        win.position.set(i * 11.5 - 3.8 + w * 2.5, PIT_Y + 2.6, 0);
        g.add(win);
      }
    }
    const front = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 10, 0, Math.PI), body);
    front.rotation.y = -Math.PI / 2;
    front.scale.set(1, 1.05, 0.6);
    front.position.set(-5.5, PIT_Y + 2, 0);
    g.add(front);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
    light.position.set(-6.5, PIT_Y + 1.8, 0);
    g.add(light);
    g.position.set(999, 0, side * TRACK_Z);
    this.deco(g);
    return g;
  }

  update(dt: number, time: number, arena: ArenaApi) {
    // escada rolante: quem está nela é levado para cima
    const e = this.escalator;
    for (const f of arena.fighters) {
      if (!f.alive || f.removed || !f.grounded) continue;
      const p = f.pos('pelvis');
      if (p.x > e.x0 - 0.3 && p.x < e.x1 + 0.2 && Math.abs(p.z - e.z) < 0.8 && p.y > 0.2 && p.y < MEZ_Y + 1.2) {
        for (const b of [f.part('pelvis'), f.part('chest')]) {
          const v = b.linvel();
          b.setLinvel({ x: v.x + (1.6 - v.x) * Math.min(1, dt * 6), y: v.y, z: v.z }, true);
        }
      }
    }
    // elevador: espera embaixo, sobe, espera em cima, desce
    this.liftT += dt;
    const cycle = this.liftT % 12;
    const k = cycle < 3 ? 0 : cycle < 6 ? (cycle - 3) / 3 : cycle < 9 ? 1 : 1 - (cycle - 9) / 3;
    this.lift.setNextKinematicTranslation({ x: 14.5, y: -0.1 + k * MEZ_Y, z: 2 });

    if (!this.run) {
      this.timer -= dt;
      if (this.timer < 2.2 && !this.warnSide) {
        this.warnSide = Math.random() < 0.5 ? -1 : 1;
        arena.announce(this.warnSide > 0 ? '🚇 TREM VINDO pelo trilho da FRENTE!' : '🚇 TREM VINDO pelo trilho de TRÁS!', 'tip');
        arena.sound('horn', 0.8, 0.7);
      }
      if (this.timer <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.run = { side: this.warnSide || 1, x: -dir * 70, dir, hit: new Set() };
        this.warnSide = 0;
      }
    }
    // luzes piscam no lado que vai passar o trem
    const blinkSide = this.run ? this.run.side : this.warnSide;
    const on = Math.sin(time * 14) > 0;
    for (const l of this.trackLights) l.mat.color.setHex(l.side === blinkSide && on ? 0xff3030 : 0x331111);

    if (this.run) {
      const r = this.run;
      const before = r.x;
      r.x += r.dir * TRAIN_SPEED * dt;
      const g = this.trains[r.side > 0 ? 1 : 0];
      // o grupo do trem cresce para +x; indo para -x, ele fica virado
      g.scale.x = r.dir > 0 ? -1 : 1;
      g.position.x = r.x;
      // frente do trem (onde ele está agora) e cauda (já passou)
      const head = r.x;
      const tail = r.x - r.dir * 46;
      const lo = Math.min(head, tail, before);
      const hi = Math.max(head, tail, before);
      for (const f of arena.fighters) {
        if (!f.alive || f.removed || r.hit.has(f)) continue;
        const p = f.pos('chest');
        const inTrack = Math.abs(p.z - r.side * TRACK_Z) < 1.9 && p.y < PIT_Y + 3.6;
        if (inTrack && p.x > lo && p.x < hi) {
          r.hit.add(f);
          this.runOver.set(f, 0.35);
          arena.hazardHit(f, 70, new THREE.Vector3(r.dir, 0.5, -r.side * 0.2).normalize(), 16, 'FIUUU!');
        }
      }
      if (Math.abs(r.x) > 80) {
        g.position.x = 999;
        this.run = null;
        this.timer = 8 + Math.random() * 6;
      }
      if (Math.abs(r.x) < 30 && Math.random() < dt * 6) arena.shake(0.08);
    }
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // trem vindo (ou passando): sai do trilho e da beirada
    const side = this.run ? this.run.side : this.warnSide;
    if (!side) return null;
    if (p.z * side < PLAT_W - 1) return null;
    return new THREE.Vector3(p.x, 0, side * -0.5);
  }

  deathOf(f: Fighter): DeathKind {
    const t = this.runOver.get(f);
    if (t === undefined) return 'none';
    // um instantinho voando antes de sair do jogo
    if (t > 0) {
      this.runOver.set(f, t - 1 / 60);
      return 'none';
    }
    this.runOver.delete(f);
    return 'train';
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(THREE.MathUtils.clamp(p.x, -14, 14), 0, 0);
  }
}
