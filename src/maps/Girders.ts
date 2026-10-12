import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi } from './MapBase';
import { RAPIER } from '../physics/Physics';
import { cityBackdrop, grimeTexture, iBeamGeometry } from './City';
import type { Fighter } from '../characters/Fighter';

// ------------------------------------------------------------
// Mapa 6 — VIGAS
// Esqueleto de aço de um arranha-céu em construção, lá no alto.
// A briga é em cima das vigas (estreitas!). Um guindaste passa
// carregando uma viga pendurada que varre quem estiver no caminho,
// e de vez em quando bate uma ventania.
// ------------------------------------------------------------

const RUST = 0xb5482b;
const SWEEP = 15; // até onde a viga do guindaste vai em x

interface Beam {
  x: number;
  z: number;
  len: number;
  along: 'x' | 'z';
  y?: number;
  w?: number;
}

export class Girders extends GameMap {
  id = 'vigas';
  name = 'Vigas';
  emoji = '🏗️';
  description = 'O esqueleto de aço de um arranha-céu em obras, a 70 metros do chão.';
  hazard = 'As vigas são estreitas, o guindaste varre tudo e a ventania empurra!';
  music = 'telhado' as const;
  killY = -9;
  camera = {
    dir: new THREE.Vector3(0, 0.72, 1),
    minDist: 12,
    maxDist: 24,
    fov: 42,
    center: new THREE.Vector3(0, 0.5, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-7, -1, -4), new THREE.Vector3(7, 3, 3)),
  };

  private hook!: RAPIER.RigidBody;
  private hookGroup!: THREE.Group;
  private cable!: THREE.Mesh;
  private trolley!: THREE.Mesh;
  private hookX = -SWEEP - 5;
  private hookDir = 1;
  private hookWait = 6;
  private hookWarned = false;
  private hit = new Set<Fighter>();
  private windT = 0;
  private windTimer = 14;
  private windDir = 1;
  private blink: THREE.Mesh[] = [];

  build() {
    this.lights({
      skyTop: 0x4c5a70,
      skyBottom: 0xc7b49a,
      fog: { color: 0x8d8f95, near: 35, far: 140 },
      sunColor: 0xffe2c0,
      sunIntensity: 2.1,
      sunPos: new THREE.Vector3(-14, 24, 10),
      hemiSky: 0xcfd8e8,
      hemiGround: 0x4a3c30,
      hemiIntensity: 1.2,
      shadowExtent: 16,
    });

    const steel = new THREE.MeshStandardMaterial({ color: RUST, roughness: 0.7, metalness: 0.4 });
    const beams: Beam[] = [
      { x: 0, z: 0, len: 19, along: 'x', w: 1.8 }, // viga principal
      { x: 0, z: -4, len: 15, along: 'x', w: 1.4 }, // viga de trás
      { x: -6, z: -1.5, len: 8, along: 'z', w: 1.4 },
      { x: 0, z: -0.5, len: 8.5, along: 'z', w: 1.4 },
      { x: 6, z: -1.5, len: 8, along: 'z', w: 1.4 },
      { x: -2.5, z: 3, len: 6, along: 'x', y: -0.7, w: 1.3 }, // viga baixa da frente
    ];
    for (const b of beams) this.beam(b, steel);

    // Colunas nas cruzes (dá para agarrar e escalar)
    const cols: [number, number][] = [
      [-6, 0],
      [6, 0],
      [-6, -4],
      [6, -4],
      [0, -4],
    ];
    for (const [x, z] of cols) {
      const m = new THREE.Mesh(iBeamGeometry(60, 0.5, 0.5), steel);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, -30, z);
      this.deco(m);
      this.ctx.physics.addStaticBox({ x, y: -2, z }, { x: 0.25, y: 2, z: 0.25 });
    }
    // Colunas que sobem acima do piso (para pendurar e subir)
    for (const [x, z] of [
      [-6, -4],
      [6, -4],
    ]) {
      const up = new THREE.Mesh(iBeamGeometry(3.4, 0.4, 0.4), steel);
      up.rotation.x = Math.PI / 2;
      up.position.set(x, 1.7, z);
      this.deco(up);
      this.ctx.physics.addStaticBox({ x, y: 1.7, z }, { x: 0.2, y: 1.7, z: 0.2 });
    }
    // Plataforma alta de tábuas entre as colunas de trás (lugar disputado)
    const wood = new THREE.MeshStandardMaterial({ map: grimeTexture('#8a6a45', [1, 4], { tiles: 4 }), roughness: 1 });
    this.box({ x: 4.2, y: 2.55, z: -4 }, { x: 3.6, y: 0.15, z: 1.6 }, wood);
    this.beam({ x: 0, z: -4, len: 12.5, along: 'x', y: 3.4, w: 0.5 }, steel); // viga de cima (para se pendurar)

    // Placas de aviso
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshStandardMaterial({ map: hazardStripes([2, 1]) }));
    sign.position.set(-3, 0.8, -4.25);
    this.deco(sign, false);

    // ----- guindaste (cenário) + viga pendurada (perigo)
    const yellow = this.material(0xf2b705, { roughness: 0.6, metalness: 0.3 });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1.4, 60, 1.4), yellow);
    tower.position.set(-9, -10, -12);
    this.deco(tower);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(46, 0.9, 0.9), yellow);
    jib.position.set(4, 18, -12);
    this.deco(jib);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 2), this.material(0x666666));
    counter.position.set(-18, 17.4, -12);
    this.deco(counter);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 1.8), yellow);
    cab.position.set(-9, 16.8, -10.8);
    this.deco(cab);
    // O braço do guindaste aponta para o mapa: carrinho corre em x, a corda desce até z=0
    const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 13), yellow);
    arm2.position.set(0, 17.6, -5.5);
    this.deco(arm2);
    this.trolley = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), this.material(0x333333));
    this.trolley.position.set(this.hookX, 17.3, -1.5);
    this.deco(this.trolley);
    // viga pendurada (cinemática)
    this.hookGroup = new THREE.Group();
    const hb = new THREE.Mesh(iBeamGeometry(4.6, 0.5, 0.5), steel);
    this.hookGroup.add(hb);
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4), this.material(0x222222));
      strap.position.set(0, 0.6, s * 1.4);
      strap.rotation.x = -s * 0.5;
      this.hookGroup.add(strap);
    }
    this.hook = this.kinematic(new THREE.Vector3(this.hookX, 1.15, -1.5), RAPIER.ColliderDesc.cuboid(0.25, 0.25, 2.3), this.hookGroup, { grabbable: true });
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), this.material(0x1a1a1a));
    this.deco(this.cable, false);

    // ----- cidade lá embaixo
    const city = cityBackdrop(this.ctx.root, { below: 80, radius: [45, 120], count: 44, walls: ['#5a5552', '#6a6560', '#4f5560', '#5e5a66'] });
    this.blink.push(...city.blink);

    this.prop('caixa', new THREE.Vector3(3.6, 3.2, -4));
    this.prop('caixa', new THREE.Vector3(-3, 0.5, 0));
    this.prop('barril', new THREE.Vector3(5, 0.5, 0), 0x2b5e8a);

    this.spawns = [new THREE.Vector3(-6, 0.08, 0), new THREE.Vector3(6, 0.08, 0), new THREE.Vector3(0, 0.08, 2), new THREE.Vector3(0, 0.08, -4)];
  }

  /** Viga horizontal com o topo em y (padrão 0). */
  private beam(b: Beam, m: THREE.Material) {
    const y = b.y ?? 0;
    const w = b.w ?? 1.1;
    const mesh = new THREE.Mesh(iBeamGeometry(b.len, 0.55, w), m);
    if (b.along === 'x') mesh.rotation.y = Math.PI / 2;
    mesh.position.set(b.x, y - 0.275, b.z);
    this.deco(mesh);
    const half = b.along === 'x' ? { x: b.len / 2, y: 0.275, z: w / 2 } : { x: w / 2, y: 0.275, z: b.len / 2 };
    this.ctx.physics.addStaticBox({ x: b.x, y: y - 0.275, z: b.z }, half, { friction: 1 });
  }

  update(dt: number, time: number, arena: ArenaApi) {
    // ----- viga do guindaste: espera, avisa e atravessa o mapa
    if (this.hookWait > 0) {
      this.hookWait -= dt;
      if (this.hookWait < 2 && !this.hookWarned) {
        this.hookWarned = true;
        arena.announce(this.hookDir > 0 ? '🏗️ Viga do guindaste vindo da ESQUERDA!' : '🏗️ Viga do guindaste vindo da DIREITA!', 'tip');
        arena.sound('horn', 0.6);
      }
    } else {
      const before = this.hookX;
      this.hookX += this.hookDir * 3.4 * dt;
      // derruba quem a viga alcança (empurra para o lado: para fora da viga!)
      for (const f of arena.fighters) {
        if (!f.alive || f.removed || this.hit.has(f)) continue;
        const p = f.pos('chest');
        // encostou na viga (ou ela passou por ele neste passo)
        const touching = Math.abs(p.x - this.hookX) < 0.75 || (before - p.x) * (this.hookX - p.x) <= 0;
        if (touching && Math.abs(p.z + 1.5) < 2.5 && p.y > 0.2 && p.y < 2.2) {
          this.hit.add(f);
          const side = p.z > -1.5 ? 1 : -1;
          arena.hazardHit(f, 34, new THREE.Vector3(this.hookDir, 0.45, side * 0.9).normalize(), 6, 'PAFT!');
        }
      }
      if (Math.abs(this.hookX) > SWEEP + 5) {
        this.hookDir *= -1;
        this.hookWait = 7 + Math.random() * 5;
        this.hookWarned = false;
        this.hit.clear();
      }
    }
    const swing = Math.sin(time * 1.6) * 0.12;
    this.hook.setNextKinematicTranslation({ x: this.hookX, y: 1.15 + Math.abs(swing) * 0.3, z: -1.5 + swing });
    this.hook.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(swing * 0.6, 0, 0)));
    this.trolley.position.x = this.hookX;
    const top = 17.1;
    const bottom = 1.4;
    this.cable.scale.y = top - bottom;
    this.cable.position.set(this.hookX, (top + bottom) / 2, -1.5 + swing * 0.5);

    // ----- ventania
    this.windTimer -= dt;
    if (this.windTimer <= 0 && this.windT <= 0) {
      this.windT = 4;
      this.windTimer = 14 + Math.random() * 8;
      this.windDir = Math.random() < 0.5 ? 1 : -1;
      arena.announce(this.windDir > 0 ? '💨 VENTANIA para a frente!' : '💨 VENTANIA para trás!', 'tip');
      arena.sound('whoosh', 1, 0.4);
    }
    if (this.windT > 0) {
      this.windT -= dt;
      for (const f of arena.fighters) {
        if (f.removed || !f.alive) continue;
        for (const b of f.ragdoll.bodies()) {
          const v = b.linvel();
          b.setLinvel({ x: v.x, y: v.y, z: v.z + this.windDir * 7 * dt }, true);
        }
      }
      if (Math.random() < dt * 8) arena.effects.dust(new THREE.Vector3((Math.random() - 0.5) * 16, 0.3, -this.windDir * 5), 0.3, 0xcccccc);
    }

    const b = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = b;
  }
}
