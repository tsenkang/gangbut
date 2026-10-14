import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { cityBackdrop, grimeTexture, hazeBelow } from './City';

// ------------------------------------------------------------
// Mapa 12 — VENTILADORES
// O terraço de uma fábrica com 3 dutos de ventilação gigantes
// abertos no chão, cada um com uma passarela estreita por cima.
// O ventilador alterna: ora SOPRA (joga quem está em cima lá para
// o alto), ora PUXA (suga para dentro do duto). Caiu num duto? Fora!
// ------------------------------------------------------------

const PITS = [-6.5, 0, 6.5]; // x de cada duto
const PIT = 2.1; // meia largura do duto (quadrado)
const W = 11; // meia largura do terraço
const D = 4.4; // faixa do meio (onde ficam os dutos)
const S = 3.2; // faixas de trás e da frente

type Phase = 'idle' | 'warnBlow' | 'blow' | 'warnPull' | 'pull';

export class Vents extends GameMap {
  id = 'ventiladores';
  name = 'Ventiladores';
  emoji = '🌀';
  description = 'O terraço de uma fábrica com 3 dutos de ventilação gigantes no chão.';
  hazard = 'O ventilador alterna: SOPRA (joga para o alto) e PUXA (suga para o duto). Caiu no duto, está fora!';
  music = 'fabrica' as const;
  killY = -10;
  botLeaps = false;
  camera = {
    dir: new THREE.Vector3(0, 0.75, 1),
    minDist: 14,
    maxDist: 30,
    fov: 42,
    center: new THREE.Vector3(0, 0.8, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-8.5, -1, -4), new THREE.Vector3(8.5, 6, 4)),
  };

  private blades: THREE.Group[] = [];
  private lamps: THREE.MeshBasicMaterial[] = [];
  private phase: Phase = 'idle';
  private phaseT = 5;
  private nextIsPull = false;
  private spin = 1;
  private blink: THREE.Mesh[] = [];

  build() {
    this.lights({
      skyTop: 0x5a6f92,
      skyBottom: 0xe3c3a8,
      fog: { color: 0xb6a9a6, near: 30, far: 120 },
      sunColor: 0xfff0d8,
      sunIntensity: 2.2,
      sunPos: new THREE.Vector3(-10, 22, 12),
      hemiSky: 0xd4dcec,
      hemiGround: 0x584c44,
      hemiIntensity: 1.3,
      shadowExtent: 18,
    });

    // ---------------- terraço com 3 buracos (os dutos)
    const roof = new THREE.MeshStandardMaterial({ map: grimeTexture('#7f7a73', [3, 2], { tiles: 6, cracks: true }), roughness: 1 });
    this.box({ x: 0, y: -0.3, z: -(D + S) / 2 }, { x: W * 2, y: 0.6, z: S }, roof); // faixa de trás
    this.box({ x: 0, y: -0.3, z: (D + S) / 2 }, { x: W * 2, y: 0.6, z: S }, roof); // faixa da frente
    const edges = [-W, ...PITS.flatMap((x) => [x - PIT, x + PIT]), W];
    for (let i = 0; i < edges.length; i += 2) {
      const [x0, x1] = [edges[i], edges[i + 1]];
      this.box({ x: (x0 + x1) / 2, y: -0.3, z: 0 }, { x: x1 - x0, y: 0.6, z: D }, roof);
    }
    // o duto vai da beirada do buraco até o fundo, com as pás lá embaixo
    const steel = this.material(0x3a3f46, { roughness: 0.5, metalness: 0.6 });
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([6, 1]) });
    const catwalk = new THREE.MeshStandardMaterial({ map: grimeTexture('#8b939b', [1, 4], { tiles: 8 }), roughness: 0.5, metalness: 0.6 });
    for (const x of PITS) {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(PIT * 2, 6, PIT * 2), this.material(0x23262b, { side: THREE.BackSide }));
      shaft.position.set(x, -3.05, 0);
      this.deco(shaft, false);
      // borda pintada
      for (const s of [-1, 1]) {
        this.box({ x, y: 0.01, z: s * (PIT + 0.12) }, { x: PIT * 2 + 0.5, y: 0.02, z: 0.24 }, stripes, { collide: false, shadow: false });
        this.box({ x: x + s * (PIT + 0.12), y: 0.01, z: 0 }, { x: 0.24, y: 0.02, z: PIT * 2 }, stripes, { collide: false, shadow: false });
      }
      // passarela estreita atravessando o duto (de trás para frente)
      this.box({ x, y: -0.08, z: 0 }, { x: 1.1, y: 0.16, z: PIT * 2 + 0.2 }, catwalk);
      // pás do ventilador lá no fundo
      const blades = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(PIT * 0.95, 0.06, 0.6), this.material(0x9aa1aa, { metalness: 0.6, roughness: 0.4 }));
        b.position.x = PIT * 0.48;
        b.rotation.x = 0.35;
        const arm = new THREE.Group();
        arm.rotation.y = (i / 4) * Math.PI * 2;
        arm.add(b);
        blades.add(arm);
      }
      blades.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 12), steel));
      blades.position.set(x, -4.5, 0);
      this.deco(blades, false);
      this.blades.push(blades);
      // luz de aviso na beirada
      const lamp = new THREE.MeshBasicMaterial({ color: 0x331111, toneMapped: false });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lamp);
      bulb.position.set(x, 0.2, -PIT - 0.6);
      this.deco(bulb, false);
      this.lamps.push(lamp);
    }

    // caixas de ar-condicionado, chaminés e mureta de trás
    const metal = this.material(0xb9bec5, { metalness: 0.5, roughness: 0.4 });
    this.box({ x: -9.6, y: 0.6, z: -4.2 }, { x: 2, y: 1.2, z: 1.4 }, metal);
    this.box({ x: 9.8, y: 0.9, z: 4.3 }, { x: 1.4, y: 1.8, z: 1.4 }, metal);
    this.box({ x: 3.3, y: 0.35, z: -4.3 }, { x: 2.4, y: 0.7, z: 0.8 }, this.material(0x7d8590, { metalness: 0.5 }));
    this.box({ x: 0, y: 0.4, z: -(D / 2 + S) + 0.15 }, { x: W * 2, y: 0.8, z: 0.3 }, this.material(0x6e675e));
    this.box({ x: -3.3, y: 2, z: -4.6 }, { x: 0.9, y: 4, z: 0.9 }, this.material(0x8a4b3a));
    this.box({ x: 9, y: 2.5, z: -4.6 }, { x: 0.9, y: 5, z: 0.9 }, this.material(0x8a4b3a));
    const facade = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 50, D + S * 2), this.material(0x6f6560, { roughness: 1 }));
    facade.position.set(0, -25.6, 0);
    this.deco(facade, false);

    const city = cityBackdrop(this.ctx.root, { below: 55, radius: [40, 110], count: 40, walls: ['#6a6460', '#757068', '#5d6470', '#6d6670'] });
    this.blink.push(...city.blink);
    hazeBelow(this.ctx.root, 0xc8bcb4, [
      [-12, 0.45],
      [-22, 0.65],
    ]);

    this.prop('caixa', new THREE.Vector3(-3.3, 0.5, 3.6));
    this.prop('barril', new THREE.Vector3(3.3, 0.5, 3.6), 0xd95f2b);
    this.prop('caixa', new THREE.Vector3(8, 0.5, -3.4));

    this.spawns = [new THREE.Vector3(-6.5, 0.05, 3.7), new THREE.Vector3(6.5, 0.05, 3.7), new THREE.Vector3(-6.5, 0.05, -3.6), new THREE.Vector3(6.5, 0.05, -3.6)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.phaseT -= dt;
    if (this.phaseT <= 0) {
      if (this.phase === 'idle') {
        this.phase = this.nextIsPull ? 'warnPull' : 'warnBlow';
        this.phaseT = 1.6;
        arena.announce(this.nextIsPull ? '🌀 O ventilador vai PUXAR! Longe dos dutos!' : '🌀 O ventilador vai SOPRAR! Saia de cima das passarelas!', 'tip');
        arena.sound('alarm', 0.5);
      } else if (this.phase === 'warnBlow' || this.phase === 'warnPull') {
        this.phase = this.phase === 'warnBlow' ? 'blow' : 'pull';
        this.phaseT = 3.2;
        arena.sound('whoosh', 1, this.phase === 'blow' ? 0.35 : 0.25);
        arena.shake(0.2);
      } else {
        this.nextIsPull = !this.nextIsPull;
        this.phase = 'idle';
        this.phaseT = 2.5 + Math.random() * 2;
      }
    }

    const blowing = this.phase === 'blow';
    const pulling = this.phase === 'pull';
    const warn = this.phase === 'warnBlow' || this.phase === 'warnPull';
    const want = blowing ? 30 : pulling ? -30 : warn ? (this.phase === 'warnBlow' ? 8 : -8) : 1.5;
    this.spin += (want - this.spin) * Math.min(1, dt * 2.5);
    for (const b of this.blades) b.rotation.y += this.spin * dt;
    const flash = Math.sin(time * 20) > 0;
    for (const l of this.lamps) l.color.setHex(blowing ? 0xff3322 : pulling ? 0x3366ff : warn ? (flash ? 0xffd23f : 0x553311) : 0x331111);

    if (blowing || pulling) {
      for (const x of PITS) {
        if (Math.random() < dt * 18) {
          const p = new THREE.Vector3(x + (Math.random() - 0.5) * PIT * 1.6, blowing ? 0.2 : 1.2, (Math.random() - 0.5) * PIT * 1.6);
          arena.effects.dust(p, 0.35, 0xdddddd);
        }
      }
      for (const f of arena.fighters) {
        if (!f.alive || f.removed) continue;
        const p = f.pos('pelvis');
        for (const x of PITS) {
          const dx = p.x - x;
          const dz = p.z;
          if (blowing) {
            // em cima do duto: sobe até ~9 m/s e espalha um pouco
            if (Math.abs(dx) > PIT + 0.2 || Math.abs(dz) > PIT + 0.2 || p.y > 7) continue;
            for (const b of f.ragdoll.bodies()) {
              const v = b.linvel();
              const vy = v.y + (9 - v.y) * Math.min(1, dt * 5);
              b.setLinvel({ x: v.x + dx * 1.2 * dt, y: vy, z: v.z + dz * 1.2 * dt }, true);
            }
          } else {
            // puxa para dentro (mais forte quanto mais perto) e para baixo em cima do duto
            const d = Math.hypot(dx, dz);
            if (d > PIT + 2 || p.y > 5) continue;
            const k = (1 - d / (PIT + 2)) * 7;
            const over = Math.abs(dx) < PIT && Math.abs(dz) < PIT;
            for (const b of f.ragdoll.bodies()) {
              const v = b.linvel();
              b.setLinvel({ x: v.x - (dx / (d || 1)) * k * dt, y: v.y - (over ? 14 : 0) * dt, z: v.z - (dz / (d || 1)) * k * dt }, true);
            }
          }
        }
      }
    }
    const on = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = on;
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // vai ligar (ou está ligado): sai de perto dos dutos, para a faixa de trás/da frente
    if (this.phase === 'idle' || p.y < -1) return null;
    const near = PITS.some((x) => Math.abs(p.x - x) < PIT + (this.phase.includes('ull') ? 1.6 : 0.6) && Math.abs(p.z) < PIT + 0.8);
    if (!near) return null;
    return new THREE.Vector3(p.x, 0, p.z < 0 ? -3.8 : 3.8);
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(THREE.MathUtils.clamp(p.x, -9, 9), 0, p.z < 0 ? -3.8 : 3.8);
  }

  deathAt(p: THREE.Vector3): DeathKind {
    // caiu dentro de um duto
    if (p.y < -1.3 && Math.abs(p.z) < PIT && PITS.some((x) => Math.abs(p.x - x) < PIT)) return 'fall';
    return p.y < this.killY ? 'fall' : 'none';
  }
}
