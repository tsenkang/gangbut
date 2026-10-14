import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { grimeTexture } from './City';

// ------------------------------------------------------------
// Mapa 17 — MOEDOR
// Uma passarela de metal em forma de "8" pendurada sobre um
// triturador industrial gigante. Os dois buracos do 8 e tudo em
// volta dão direto nos rolos dentados que giram lá embaixo. O
// guarda-corpo tem vãos, e de tempos em tempos a máquina engasga e
// solta um jato de vapor pelos buracos, jogando todo mundo para cima.
// ------------------------------------------------------------

const CX = 3.6; // centro de cada laço do 8
const RING = 3.0; // raio do meio da passarela
const W = 1.7; // largura da passarela
const ROLLER_Y = -3.6;
const DEATH_Y = -2.5;

export class Grinder extends GameMap {
  id = 'moedor';
  name = 'Moedor';
  emoji = '⚙️';
  description = 'Uma passarela em forma de 8 pendurada sobre um triturador gigante.';
  hazard = 'Caiu da passarela? Os rolos lá embaixo moem tudo! Cuidado com o vapor.';
  music = 'fabrica' as const;
  killY = -8;
  botLeaps = false;
  camera = {
    dir: new THREE.Vector3(0, 0.85, 1),
    minDist: 14,
    maxDist: 28,
    fov: 42,
    center: new THREE.Vector3(0, 0.3, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-8, -1, -4), new THREE.Vector3(8, 3, 4)),
  };

  private rollers: THREE.Group[] = [];
  private spin = 1;
  private steamT = 0;
  private steamTimer = 13;
  private steamSide = 1;
  private sparkT = 0;
  private warnLamps: THREE.MeshBasicMaterial[] = [];

  build() {
    this.lights({
      skyTop: 0x22252c,
      skyBottom: 0x3a3430,
      fog: { color: 0x2a2826, near: 24, far: 70 },
      sunColor: 0xfff0d8,
      sunIntensity: 1.7,
      sunPos: new THREE.Vector3(-5, 18, 9),
      hemiSky: 0x8a8f9c,
      hemiGround: 0x4a3a2a,
      hemiIntensity: 1.5,
      shadowExtent: 14,
    });

    const steel = this.material(0x6f7782, { roughness: 0.5, metalness: 0.7 });
    const grate = new THREE.MeshStandardMaterial({ map: grimeTexture('#7a818c', [1, 1], { tiles: 4, dark: 'rgba(0,0,0,0.3)' }), roughness: 0.6, metalness: 0.6 });
    const yellow = this.material(0xe2b21d, { roughness: 0.5, metalness: 0.4 });

    // ---------------- passarela em 8 (dois anéis que se cruzam no meio)
    const SEG = 26;
    const gapsOuter = new Set([3, 4, 11, 12, 19, 20]);
    const gapsInner = new Set([1, 2, 8, 14, 15, 21]);
    for (const s of [-1, 1]) {
      const cx = s * CX;
      for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const x = cx + Math.cos(a) * RING;
        const z = Math.sin(a) * RING;
        // pedaços do anel que caem dentro do outro laço ficam de fora (é o cruzamento)
        if (Math.abs(x) < 0.5 && Math.abs(z) > 0.9) continue;
        const rot = new THREE.Euler(0, -a, 0);
        const len = 2 * (RING + W / 2) * Math.sin(Math.PI / SEG) + 0.08;
        this.box({ x, y: -0.12, z }, { x: W, y: 0.24, z: len }, grate, { rot, friction: 0.9 });
        // corrimões (de fora e de dentro), com vãos
        const toCenter = Math.sign(s) * Math.cos(a) < 0; // lado de dentro do 8 (perto do cruzamento)
        if (toCenter && Math.abs(Math.sin(a)) < 0.45) continue; // nada de grade no cruzamento
        for (const [r, gaps, h] of [
          [RING + W / 2 - 0.05, gapsOuter, 1.0],
          [RING - W / 2 + 0.05, gapsInner, 0.75],
        ] as [number, Set<number>, number][]) {
          if (gaps.has(i)) continue;
          const rx = cx + Math.cos(a) * r;
          const rz = Math.sin(a) * r;
          const rl = 2 * r * Math.sin(Math.PI / SEG) + 0.04;
          this.box({ x: rx, y: h, z: rz }, { x: 0.06, y: 0.06, z: rl }, yellow, { rot });
          this.box({ x: rx, y: h / 2, z: rz }, { x: 0.06, y: h, z: 0.06 }, yellow, { rot });
        }
      }
      // estrutura que segura o anel (só visual)
      const hub = new THREE.Mesh(new THREE.TorusGeometry(RING, 0.12, 8, 48), steel);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(cx, -0.45, 0);
      this.deco(hub);
    }
    // placa do cruzamento no meio
    this.box({ x: 0, y: -0.12, z: 0 }, { x: 1.9, y: 0.24, z: 2.1 }, grate);
    this.box({ x: 0, y: 0.005, z: 0 }, { x: 1.9, y: 0.02, z: 0.16 }, new THREE.MeshStandardMaterial({ map: hazardStripes([3, 1]) }), { collide: false, shadow: false });
    // cabos que penduram a passarela no teto
    const cable = this.material(0x1d1f24, { metalness: 0.6 });
    for (const s of [-1, 1]) {
      for (const a of [(5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 14, 5), cable);
        c.position.set(s * CX + Math.cos(a) * (RING + W / 2), 7, Math.sin(a) * (RING + W / 2));
        this.deco(c, false);
      }
    }

    // ---------------- triturador: rolos dentados girando lá embaixo
    const rollerMat = this.material(0x4b5058, { roughness: 0.45, metalness: 0.8 });
    const toothMat = this.material(0x9aa0a8, { roughness: 0.35, metalness: 0.85 });
    const rollerGeo = new THREE.CylinderGeometry(0.55, 0.55, 13, 14);
    const toothGeo = new THREE.BoxGeometry(0.22, 13, 0.16);
    for (let x = -10; x <= 10.01; x += 1.25) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(rollerGeo, rollerMat));
      for (let k = 0; k < 8; k++) {
        const t = new THREE.Mesh(toothGeo, toothMat);
        const a = (k / 8) * Math.PI * 2;
        t.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
        t.rotation.y = -a;
        g.add(t);
      }
      g.rotation.x = Math.PI / 2;
      g.position.set(x, ROLLER_Y, 0);
      this.deco(g, false);
      this.rollers.push(g);
    }
    // caixa do triturador (paredes em volta do poço)
    const housing = new THREE.MeshStandardMaterial({ map: grimeTexture('#4c5260', [4, 2], { tiles: 6, dark: 'rgba(0,0,0,0.35)' }), roughness: 0.75, metalness: 0.5 });
    this.box({ x: 0, y: -2.5, z: -6.9 }, { x: 24, y: 4, z: 0.6 }, housing, { collide: false });
    this.box({ x: 0, y: -2.5, z: 6.9 }, { x: 24, y: 4, z: 0.6 }, housing, { collide: false, shadow: false });
    for (const s of [-1, 1]) this.box({ x: s * 11.6, y: -2.5, z: 0 }, { x: 0.6, y: 4, z: 14 }, housing, { collide: false });
    const lip = new THREE.MeshStandardMaterial({ map: hazardStripes([12, 1]) });
    this.box({ x: 0, y: -0.45, z: 6.6 }, { x: 23, y: 0.2, z: 0.1 }, lip, { collide: false, shadow: false });
    // parede do fundo do galpão
    const wall = new THREE.MeshStandardMaterial({ map: grimeTexture('#5a5f68', [8, 4], { tiles: 8, dark: 'rgba(0,0,0,0.3)' }), roughness: 0.85 });
    this.box({ x: 0, y: 5, z: -7.6 }, { x: 40, y: 20, z: 0.8 }, wall, { collide: false });
    // lâmpadas de alerta do vapor
    for (const s of [-1, 1]) {
      const m = new THREE.MeshBasicMaterial({ color: 0x441111, toneMapped: false });
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), m);
      l.position.set(s * CX, 3.5, -7.1);
      this.deco(l, false);
      this.warnLamps.push(m);
    }
    const lamp = new THREE.PointLight(0xffb070, 30, 18, 1.5);
    lamp.position.set(0, -2, 0);
    this.ctx.root.add(lamp);

    this.prop('barril', new THREE.Vector3(-CX - RING, 0.5, 0), 0xd94a3a);
    this.prop('caixa', new THREE.Vector3(CX + RING, 0.5, 0));

    this.spawns = [
      new THREE.Vector3(-CX, 0.08, RING),
      new THREE.Vector3(CX, 0.08, -RING),
      new THREE.Vector3(-CX, 0.08, -RING),
      new THREE.Vector3(CX, 0.08, RING),
    ];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    const speed = this.spin * (this.steamT > 0 ? 2.2 : 1);
    for (let i = 0; i < this.rollers.length; i++) this.rollers[i].rotation.y += (i % 2 ? 1 : -1) * speed * 3 * dt;
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = 0.25;
      arena.effects.sparks(new THREE.Vector3((Math.random() - 0.5) * 20, ROLLER_Y + 0.6, (Math.random() - 0.5) * 10), 0xfff1a8, 5, 3);
    }

    // jato de vapor saindo de um dos buracos do 8
    this.steamTimer -= dt;
    const warn = this.steamTimer < 2 && this.steamT <= 0;
    if (warn && this.steamTimer + dt >= 2) {
      this.steamSide = Math.random() < 0.5 ? -1 : 1;
      arena.announce(this.steamSide < 0 ? '💨 VAPOR no laço da ESQUERDA!' : '💨 VAPOR no laço da DIREITA!', 'tip');
      arena.sound('horn', 0.5, 0.8);
    }
    if (this.steamTimer <= 0 && this.steamT <= 0) {
      this.steamT = 2.6;
      this.steamTimer = 12 + Math.random() * 6;
      arena.sound('whoosh', 1, 0.5);
      arena.shake(0.2);
    }
    for (let i = 0; i < this.warnLamps.length; i++) {
      const on = (warn || this.steamT > 0) && (i === 0 ? -1 : 1) === this.steamSide && Math.sin(time * 14) > 0;
      this.warnLamps[i].color.setHex(on ? 0xff2a1a : 0x441111);
    }
    if (this.steamT > 0) {
      this.steamT -= dt;
      const c = new THREE.Vector3(this.steamSide * CX, 0, 0);
      if (Math.random() < dt * 30) arena.effects.dust(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -1 + Math.random() * 3, (Math.random() - 0.5) * 3)), 2, 0xeef2f5);
      for (const f of arena.fighters) {
        if (!f.alive || f.removed) continue;
        const p = f.pos('pelvis');
        const d = Math.hypot(p.x - c.x, p.z);
        if (d > RING + W / 2 + 0.3 || p.y > 4) continue;
        // empurra para cima e um pouco para fora do laço
        const out = new THREE.Vector3(p.x - c.x, 0, p.z).normalize();
        for (const b of f.ragdoll.bodies()) {
          const v = b.linvel();
          b.setLinvel({ x: v.x + out.x * 5 * dt, y: v.y + 24 * dt, z: v.z + out.z * 5 * dt }, true);
        }
      }
    }
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // vapor chegando: sai do laço que vai soltar vapor (vai para o outro)
    if (p.y < -0.5) return null;
    if (!(this.steamTimer < 2 || this.steamT > 0)) return null;
    if (Math.sign(p.x || 1) !== this.steamSide && Math.abs(p.x) > 0.8) return null;
    return new THREE.Vector3(-this.steamSide * CX, 0, p.z >= 0 ? RING : -RING);
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    // ponto mais perto no meio da passarela
    const cx = (p.x >= 0 ? 1 : -1) * CX;
    const d = new THREE.Vector3(p.x - cx, 0, p.z);
    if (d.lengthSq() < 0.01) d.set(0, 0, 1);
    return d.normalize().multiplyScalar(RING).add(new THREE.Vector3(cx, 0, 0));
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < DEATH_Y) return 'grind';
    return 'none';
  }
}
