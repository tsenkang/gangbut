import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi } from './MapBase';
import { cityBackdrop, grimeTexture, hazeBelow } from './City';

// ------------------------------------------------------------
// Mapa 12 — VENTILADORES
// O terraço de uma fábrica cheio de ventiladores gigantes no chão.
// Um de cada vez eles ligam (a grade pisca antes) e jogam quem
// estiver em cima lá para o alto. Lá no alto o vento espalha todo
// mundo... e quem cair fora do terraço some na neblina.
// ------------------------------------------------------------

const FANS: [number, number][] = [
  [-4.2, -0.7],
  [0, 0.7],
  [4.2, -0.7],
];
const FAN_R = 1.35;

interface Fan {
  x: number;
  z: number;
  blades: THREE.Group;
  light: THREE.MeshBasicMaterial;
  spin: number;
}

export class Vents extends GameMap {
  id = 'ventiladores';
  name = 'Ventiladores';
  emoji = '🌀';
  description = 'O terraço de uma fábrica com ventiladores gigantes no chão.';
  hazard = 'Quando a grade piscar, saia de cima: o ventilador joga você lá no alto!';
  music = 'fabrica' as const;
  killY = -10;
  camera = {
    dir: new THREE.Vector3(0, 0.72, 1),
    minDist: 12,
    maxDist: 25,
    fov: 42,
    center: new THREE.Vector3(0, 0.8, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-6, -1, -3), new THREE.Vector3(6, 6, 3)),
  };

  private fans: Fan[] = [];
  private active = -1;
  private phase: 'idle' | 'warn' | 'blow' = 'idle';
  private phaseT = 4;
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
      shadowExtent: 14,
    });

    // ---------------- terraço (com buracos redondos onde ficam os ventiladores)
    const roof = new THREE.MeshStandardMaterial({ map: grimeTexture('#7f7a73', [3, 2], { tiles: 6, cracks: true }), roughness: 1 });
    // o piso é feito de tiras em volta dos buracos (cada ventilador tem seu poço)
    const W = 7.2;
    const D = 4.4;
    this.box({ x: 0, y: -0.3, z: -3.3 }, { x: W * 2, y: 0.6, z: 2.2 }, roof); // faixa de trás
    this.box({ x: 0, y: -0.3, z: 3.3 }, { x: W * 2, y: 0.6, z: 2.2 }, roof); // faixa da frente
    // entre os poços (meio)
    for (const [x0, x1] of [
      [-W, -5.6],
      [-2.8, -1.4],
      [1.4, 2.8],
      [5.6, W],
    ]) {
      this.box({ x: (x0 + x1) / 2, y: -0.3, z: 0 }, { x: x1 - x0, y: 0.6, z: D }, roof);
    }
    // laterais dos poços (só onde não tem ventilador)
    for (const [x, z] of FANS) {
      // o resto da faixa do meio (do outro lado do poço) é chão
      this.box({ x, y: -0.3, z: z < 0 ? 1.45 : -1.45 }, { x: 2.8, y: 0.6, z: D - 2.8 - 0.1 }, roof);
    }
    // grades dos ventiladores (dá para pisar: o vento é que é o problema)
    // grade de aço com furos (transparente: dá para ver as pás girando)
    const grateTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = '#9aa1aa';
      g.fillRect(0, 0, 128, 128);
      for (let y = 4; y < 128; y += 16) for (let x = 4; x < 128; x += 16) g.clearRect(x, y, 12, 12);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(3, 3);
      return t;
    })();
    const grate = new THREE.MeshStandardMaterial({ map: grateTex, alphaTest: 0.5, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
    const ring = this.material(0x2d3138, { metalness: 0.6, roughness: 0.4 });
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([8, 1]) });
    for (const [x, z] of FANS) {
      // fundo do poço (escuro) e paredes do poço
      this.box({ x, y: -1.3, z }, { x: 2.8, y: 0.1, z: 2.8 }, this.material(0x1a1c20), { collide: false });
      const well = new THREE.Mesh(new THREE.CylinderGeometry(FAN_R + 0.05, FAN_R + 0.05, 1.2, 28, 1, true), this.material(0x30343a, { side: THREE.BackSide }));
      well.position.set(x, -0.7, z);
      this.deco(well, false);
      // a grade tem colisão (pisa em cima)
      this.box({ x, y: -0.05, z }, { x: 2.8, y: 0.1, z: 2.8 }, grate, { shadow: false });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(FAN_R + 0.05, 0.08, 6, 32), ring);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x, 0.02, z);
      this.deco(rim, false);
      const band = new THREE.Mesh(new THREE.RingGeometry(FAN_R + 0.15, FAN_R + 0.35, 32), stripes);
      band.rotation.x = -Math.PI / 2;
      band.position.set(x, 0.012, z);
      this.deco(band, false);
      // pás girando lá dentro
      const blades = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(FAN_R * 0.95, 0.05, 0.38), this.material(0x9aa1aa, { metalness: 0.6, roughness: 0.4 }));
        b.position.x = FAN_R * 0.48;
        b.rotation.x = 0.35;
        const arm = new THREE.Group();
        arm.rotation.y = (i / 5) * Math.PI * 2;
        arm.add(b);
        blades.add(arm);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 12), ring);
      blades.add(hub);
      blades.position.set(x, -0.45, z);
      this.deco(blades, false);
      // luz de aviso
      const light = new THREE.MeshBasicMaterial({ color: 0x441111, toneMapped: false });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), light);
      bulb.position.set(x + FAN_R + 0.5, 0.15, z);
      this.deco(bulb, false);
      this.fans.push({ x, z, blades, light, spin: 0.5 });
    }

    // ---------------- caixas de ar-condicionado, dutos e mureta baixa no fundo
    const metal = this.material(0xb9bec5, { metalness: 0.5, roughness: 0.4 });
    this.box({ x: -5.9, y: 0.6, z: -3.4 }, { x: 2, y: 1.2, z: 1.4 }, metal);
    this.box({ x: 6.2, y: 0.9, z: 3.5 }, { x: 1.4, y: 1.8, z: 1.4 }, metal);
    this.box({ x: 2.2, y: 0.35, z: -3.5 }, { x: 3.6, y: 0.7, z: 0.8 }, this.material(0x7d8590, { metalness: 0.5 }));
    this.box({ x: 0, y: 0.4, z: -4.55 }, { x: W * 2, y: 0.8, z: 0.3 }, this.material(0x6e675e)); // mureta de trás
    // chaminé alta (dá para agarrar e subir)
    this.box({ x: -2.6, y: 2, z: -3.7 }, { x: 0.9, y: 4, z: 0.9 }, this.material(0x8a4b3a));
    // prédio da fábrica descendo para a neblina
    const facade = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 50, D + 4), this.material(0x6f6560, { roughness: 1 }));
    facade.position.set(0, -25.6, 0);
    this.deco(facade, false);

    const city = cityBackdrop(this.ctx.root, { below: 55, radius: [40, 110], count: 40, walls: ['#6a6460', '#757068', '#5d6470', '#6d6670'] });
    this.blink.push(...city.blink);
    hazeBelow(this.ctx.root, 0xc8bcb4, [
      [-12, 0.45],
      [-22, 0.65],
    ]);

    this.prop('caixa', new THREE.Vector3(-2, 0.5, 3.2));
    this.prop('barril', new THREE.Vector3(3, 0.5, 3.2), 0xd95f2b);
    this.prop('bola', new THREE.Vector3(-6, 0.6, 1.5), 0xffb703);

    this.spawns = [new THREE.Vector3(-6.2, 0.05, 1.5), new THREE.Vector3(6.3, 0.05, 1.2), new THREE.Vector3(-2, 0.05, -3.2), new THREE.Vector3(2.2, 0.05, 3.2)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.phaseT -= dt;
    if (this.phaseT <= 0) {
      if (this.phase === 'idle') {
        this.phase = 'warn';
        this.phaseT = 1.6;
        let next = Math.floor(Math.random() * this.fans.length);
        if (next === this.active) next = (next + 1) % this.fans.length;
        this.active = next;
        arena.sound('alarm', 0.5);
      } else if (this.phase === 'warn') {
        this.phase = 'blow';
        this.phaseT = 3;
        arena.sound('whoosh', 1, 0.3);
        arena.shake(0.2);
      } else {
        this.phase = 'idle';
        this.phaseT = 2.5 + Math.random() * 2;
      }
    }

    this.fans.forEach((f, i) => {
      const on = i === this.active && this.phase === 'blow';
      const warn = i === this.active && this.phase === 'warn';
      const want = on ? 30 : warn ? 8 : 1.2;
      f.spin += (want - f.spin) * Math.min(1, dt * 2.5);
      f.blades.rotation.y += f.spin * dt;
      f.light.color.setHex(on ? 0xff3322 : warn ? (Math.sin(time * 20) > 0 ? 0xffd23f : 0x553311) : 0x331111);
      if (!on) return;
      // poeira subindo
      if (Math.random() < dt * 25) arena.effects.dust(new THREE.Vector3(f.x + (Math.random() - 0.5) * 2, 0.3, f.z + (Math.random() - 0.5) * 2), 0.4, 0xdddddd);
      // corrente de ar: quem estiver em cima (ou na coluna de ar) sobe
      for (const ft of arena.fighters) {
        if (!ft.alive || ft.removed) continue;
        const p = ft.pos('pelvis');
        const dx = p.x - f.x;
        const dz = p.z - f.z;
        const d = Math.hypot(dx, dz);
        if (d > FAN_R + 0.35 || p.y > 7) continue;
        const k = (1 - d / (FAN_R + 0.35)) * 0.6 + 0.4;
        for (const b of ft.ragdoll.bodies()) {
          const v = b.linvel();
          // acelera para cima até ~9 m/s e espalha um pouco para os lados
          const vy = v.y + (9 - v.y) * Math.min(1, dt * 6 * k);
          b.setLinvel({ x: v.x + dx * 1.5 * dt, y: vy, z: v.z + dz * 1.5 * dt }, true);
        }
      }
    });
    const blinkOn = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = blinkOn;
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // Saia de cima da grade que vai ligar (ou que está ligada)
    if (this.active < 0 || this.phase === 'idle' || p.y < -1) return null;
    const f = this.fans[this.active];
    if (Math.hypot(p.x - f.x, p.z - f.z) > FAN_R + 0.8) return null;
    return new THREE.Vector3(f.x, 0, f.z < 0 ? 3.2 : -3.2);
  }
}
