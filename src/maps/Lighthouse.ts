import * as THREE from 'three';
import { GameMap, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER } from '../physics/Physics';
import { grimeTexture } from './City';

// ------------------------------------------------------------
// Mapa 9 — FAROL
// O alto de um farol numa noite de tempestade: a sala da lanterna
// no meio (dá para entrar pelas duas portas e brigar lá dentro, em
// volta da lâmpada girando) e a varanda redonda em volta, com o
// guarda-corpo cheio de buracos. A cúpula dá para escalar, e de vez em quando uma onda gigante estoura lá
// embaixo e o vento empurra todo mundo para um lado. Raios
// iluminam tudo de repente. Caiu? Mar bravo.
// ------------------------------------------------------------

const R = 7.8; // raio da varanda
const TOWER_R = 3.1; // raio da sala da lanterna (oca, dá para entrar)
const ROOM_H = 2.7;
const DOOR = 0.62; // meia abertura (rad) de cada porta
const SEA_Y = -26;

export class Lighthouse extends GameMap {
  id = 'farol';
  name = 'Farol';
  emoji = '🌊';
  description = 'A varanda redonda no alto de um farol, numa noite de tempestade.';
  hazard = 'Rajadas de vento varrem a varanda (só a sala da lanterna protege) e o guarda-corpo tem buracos!';
  music = 'trem' as const;
  killY = -12;
  camera = {
    dir: new THREE.Vector3(0, 0.75, 1),
    minDist: 15,
    maxDist: 28,
    fov: 44,
    center: new THREE.Vector3(0, 0.6, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-5.5, -1, -5.5), new THREE.Vector3(5.5, 3, 5.5)),
  };

  private beam!: THREE.Group;
  private seaMat!: THREE.ShaderMaterial;
  private hemi!: THREE.HemisphereLight;
  private flash = 0;
  private flashTimer = 5;
  private gustT = 0;
  private gustTimer = 9;
  private gustDir = new THREE.Vector3();
  private rainT = 0;
  private roofMats: THREE.Material[] = [];
  private lens!: THREE.Group;

  build() {
    const { hemi } = this.lights({
      skyTop: 0x0b1020,
      skyBottom: 0x2c3a52,
      fog: { color: 0x1c2638, near: 22, far: 80 },
      sunColor: 0x9fb4e0, // lua atrás das nuvens
      sunIntensity: 1.5,
      sunPos: new THREE.Vector3(-8, 20, 10),
      hemiSky: 0x7f93c0,
      hemiGround: 0x1a2030,
      hemiIntensity: 1.3,
      shadowExtent: 12,
    });
    this.hemi = hemi;

    // ---------------- varanda redonda (piso de chapa)
    const plate = new THREE.MeshStandardMaterial({ map: grimeTexture('#5f6670', [3, 3], { tiles: 8, dark: 'rgba(0,0,0,0.3)' }), roughness: 0.6, metalness: 0.5 });
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.4, 48), plate);
    deck.position.y = -0.2;
    this.deco(deck);
    this.ctx.physics.addStatic({ x: 0, y: -0.2, z: 0 }, RAPIER.ColliderDesc.cylinder(0.2, R));
    // borda de baixo (aba da varanda)
    const red = this.material(0xb22d2d, { roughness: 0.6 });
    const white = this.material(0xf1ede4, { roughness: 0.6 });
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.1, R - 0.6, 0.6, 48, 1, true), red);
    lip.position.y = -0.7;
    this.deco(lip);

    // guarda-corpo com buracos (algumas partes faltando)
    const rail = this.material(0x22262d, { roughness: 0.4, metalness: 0.7 });
    const posts = 34;
    const missing = new Set([4, 5, 15, 16, 24, 25, 26]); // vãos sem grade (por onde dá para cair)
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      const x = Math.cos(a) * (R - 0.12);
      const z = Math.sin(a) * (R - 0.12);
      if (!missing.has(i)) this.box({ x, y: 0.55, z }, { x: 0.07, y: 1.1, z: 0.07 }, rail);
      if (missing.has(i) || missing.has((i + 1) % posts)) continue;
      // barra de cima entre este poste e o próximo (dá para agarrar)
      const a2 = ((i + 1) / posts) * Math.PI * 2;
      const mid = (a + a2) / 2;
      const len = 2 * (R - 0.12) * Math.sin(Math.PI / posts) + 0.05;
      const rot = new THREE.Euler(0, -mid + Math.PI / 2, 0);
      const mx = Math.cos(mid) * (R - 0.12) * Math.cos(Math.PI / posts);
      const mz = Math.sin(mid) * (R - 0.12) * Math.cos(Math.PI / posts);
      this.box({ x: mx, y: 1.1, z: mz }, { x: len, y: 0.06, z: 0.06 }, rail, { rot });
      this.box({ x: mx, y: 0.55, z: mz }, { x: len, y: 0.04, z: 0.04 }, rail, { rot, collide: false });
    }

    // ---------------- sala da lanterna (oca: duas portas, lâmpada no meio)
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xfff3c4, emissive: 0xffe28a, emissiveIntensity: 0.5, transparent: true, opacity: 0.32, roughness: 0.1, depthWrite: false });
    const segs = 28;
    const segLen = 2 * TOWER_R * Math.sin(Math.PI / segs) + 0.04;
    const isDoor = (a: number) => {
      const d1 = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
      const d2 = Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)));
      return d1 < DOOR || d2 < DOOR;
    };
    for (let i = 0; i < segs; i++) {
      const a = ((i + 0.5) / segs) * Math.PI * 2;
      if (isDoor(a)) continue;
      const x = Math.cos(a) * TOWER_R;
      const z = Math.sin(a) * TOWER_R;
      const rot = new THREE.Euler(0, -a + Math.PI / 2, 0);
      // rodapé branco sólido + vidro em cima (tudo colide)
      this.box({ x, y: 0.45, z }, { x: segLen, y: 0.9, z: 0.18 }, white, { rot });
      this.box({ x, y: 0.9 + (ROOM_H - 0.9) / 2, z }, { x: segLen, y: ROOM_H - 0.9, z: 0.1 }, glassMat, { rot });
      if (i % 2 === 0) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, ROOM_H, 0.08), rail);
        bar.position.set(Math.cos(a) * (TOWER_R + 0.06), ROOM_H / 2, Math.sin(a) * (TOWER_R + 0.06));
        this.deco(bar);
      }
    }
    // batentes das portas
    for (const c of [Math.PI / 2, -Math.PI / 2]) {
      for (const s of [-1, 1]) {
        const a = c + s * DOOR;
        this.box({ x: Math.cos(a) * TOWER_R, y: ROOM_H / 2, z: Math.sin(a) * TOWER_R }, { x: 0.18, y: ROOM_H, z: 0.18 }, red);
      }
      this.box({ x: 0, y: ROOM_H - 0.2, z: Math.sin(c) * TOWER_R }, { x: 2 * TOWER_R * Math.sin(DOOR), y: 0.4, z: 0.2 }, red);
    }
    // teto + cúpula (somem quando tem alguém lá dentro, para a câmera ver)
    const roofMat = this.material(0xb22d2d, { roughness: 0.6 });
    roofMat.transparent = true;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R + 0.25, TOWER_R + 0.25, 0.3, 40), roofMat);
    roof.position.y = ROOM_H + 0.15;
    this.deco(roof);
    this.ctx.physics.addStatic({ x: 0, y: ROOM_H + 0.15, z: 0 }, RAPIER.ColliderDesc.cylinder(0.15, TOWER_R + 0.25));
    const domeMat = roofMat.clone();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(TOWER_R * 0.75, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.y = ROOM_H + 0.3;
    dome.scale.y = 0.45;
    this.deco(dome);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 8), rail);
    spire.position.y = ROOM_H + 0.3 + TOWER_R * 0.75 * 0.45 + 0.35;
    this.deco(spire);
    this.roofMats = [roofMat, domeMat];
    // escadinha do lado de fora (x+) para subir no teto
    for (let k = 0; k < 6; k++) this.box({ x: TOWER_R + 0.22, y: 0.35 + k * 0.46, z: 0 }, { x: 0.06, y: 0.06, z: 0.8 }, rail);
    // pedestal da lâmpada no centro (dá para usar de cobertura)
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1.0, 20), rail);
    ped.position.y = 0.5;
    this.deco(ped);
    this.ctx.physics.addStatic({ x: 0, y: 0.5, z: 0 }, RAPIER.ColliderDesc.cylinder(0.5, 0.7));
    this.lens = new THREE.Group();
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d0, toneMapped: false }));
    this.lens.add(lamp);
    for (const s of [1, -1]) {
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.25, 0.5, 16, 1, true), rail);
      hood.rotation.z = (s * Math.PI) / 2;
      hood.position.x = -s * 0.35;
      this.lens.add(hood);
    }
    this.lens.position.y = 1.5;
    this.deco(this.lens, false);
    const lightL = new THREE.PointLight(0xffe7a8, 30, 16, 1.6);
    lightL.position.y = 1.6;
    this.ctx.root.add(lightL);
    // chão interno de madeira
    const floorIn = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R - 0.1, TOWER_R - 0.1, 0.02, 40), this.material(0x6b4a2e, { roughness: 0.9 }));
    floorIn.position.y = 0.01;
    this.deco(floorIn, false);

    // facho de luz girando
    this.beam = new THREE.Group();
    for (const s of [1, -1]) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(4, 40, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      cone.rotation.z = (s * Math.PI) / 2;
      cone.position.x = s * 20;
      this.beam.add(cone);
    }
    this.beam.position.y = 1.5;
    this.deco(this.beam, false);

    // ---------------- torre do farol descendo até o mar (listrada)
    for (let k = 0; k < 6; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(3.6 + k * 0.3, 3.9 + k * 0.3, 4.4, 32), k % 2 ? white : red);
      seg.position.y = -1.2 - 2.2 - k * 4.4;
      this.deco(seg, false);
    }
    // rochas na base
    const rock = this.material(0x2b2f36, { roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(2 + Math.random() * 3), rock);
      const a = Math.random() * Math.PI * 2;
      r.position.set(Math.cos(a) * (5 + Math.random() * 6), SEA_Y + 0.5, Math.sin(a) * (5 + Math.random() * 6));
      this.deco(r, false);
    }

    // ---------------- mar bravo (shader de ondas)
    this.seaMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      fog: false,
      vertexShader: `uniform float t; varying float vH; varying vec2 vUv;
        void main(){ vUv = uv; vec3 p = position;
          float h = sin(p.x*0.15 + t*1.3)*1.2 + sin(p.y*0.22 - t*1.7)*0.8 + sin((p.x+p.y)*0.4 + t*2.3)*0.35;
          p.z += h; vH = h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
      fragmentShader: `varying float vH; varying vec2 vUv;
        void main(){ vec3 deep = vec3(0.04,0.09,0.14); vec3 top = vec3(0.18,0.32,0.38);
          vec3 c = mix(deep, top, smoothstep(-1.5, 2.0, vH));
          c = mix(c, vec3(0.75,0.82,0.85), smoothstep(1.7, 2.3, vH));
          float d = length(vUv - 0.5) * 2.0; c = mix(c, vec3(0.11,0.15,0.22), smoothstep(0.3, 1.0, d));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 120, 120), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = SEA_Y;
    this.deco(sea, false);

    this.prop('barril', new THREE.Vector3(5.4, 0.5, 2.2), 0x2b5e8a);
    this.prop('caixa', new THREE.Vector3(-5.4, 0.5, -2.2));
    this.prop('caixa', new THREE.Vector3(-1.6, 0.5, 1.4));
    this.prop('barril', new THREE.Vector3(1.8, 0.5, -1.2), 0xd95f2b);

    // dois começam dentro da sala da lanterna, dois na varanda
    this.spawns = [new THREE.Vector3(-1.8, 0.05, 0.4), new THREE.Vector3(1.8, 0.05, 0.4), new THREE.Vector3(-5.4, 0.05, 2.6), new THREE.Vector3(5.4, 0.05, -2.6)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.seaMat.uniforms.t.value = time;
    this.beam.rotation.y = time * 0.7;
    this.lens.rotation.y = time * 0.7;
    // teto fica transparente quando tem alguém dentro da sala
    let inside = false;
    for (const f of arena.fighters) {
      if (!f.alive || f.removed) continue;
      const p = f.pos('pelvis');
      if (p.x * p.x + p.z * p.z < TOWER_R * TOWER_R && p.y < ROOM_H) inside = true;
    }
    for (const m of this.roofMats) m.opacity += ((inside ? 0.18 : 1) - m.opacity) * Math.min(1, dt * 6);

    // Chuva (respingos na varanda)
    this.rainT -= dt;
    if (this.rainT <= 0) {
      this.rainT = 0.08;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * R;
      arena.effects.splash(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r), 0x9fb8d8, 3);
    }

    // Raios: clarão e trovão
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) {
      this.flashTimer = 6 + Math.random() * 8;
      this.flash = 1;
      arena.sound('crack', 0.9, 0.4);
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    const flick = this.flash > 0 ? this.flash * (0.6 + Math.random() * 0.4) : 0;
    this.hemi.intensity = 1.3 + flick * 4;

    // Rajada de vento: empurra todo mundo para um lado
    this.gustTimer -= dt;
    if (this.gustTimer <= 0 && this.gustT <= 0) {
      this.gustT = 3.2;
      this.gustTimer = 11 + Math.random() * 6;
      const a = Math.random() * Math.PI * 2;
      this.gustDir.set(Math.cos(a), 0, Math.sin(a));
      arena.announce('🌊 ONDA GIGANTE! Rajada de vento!', 'tip');
      arena.sound('splash', 1, 0.6);
      arena.sound('whoosh', 1, 0.35);
      arena.shake(0.25);
    }
    if (this.gustT > 0) {
      this.gustT -= dt;
      const k = Math.min(1, this.gustT) * 6.5 * dt;
      for (const f of arena.fighters) {
        if (!f.alive || f.removed) continue;
        const pp = f.pos('pelvis');
        if (pp.x * pp.x + pp.z * pp.z < (TOWER_R - 0.2) ** 2 && pp.y < ROOM_H) continue; // abrigado na sala
        for (const b of f.ragdoll.bodies()) {
          const v = b.linvel();
          b.setLinvel({ x: v.x + this.gustDir.x * k, y: v.y, z: v.z + this.gustDir.z * k }, true);
        }
      }
      if (Math.random() < dt * 14) arena.effects.splash(this.gustDir.clone().multiplyScalar(-R).setY(0.3 + Math.random()), 0xcfe3f0, 8);
    }
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // Na rajada: se abriga dentro da sala da lanterna (entra pela porta mais perto)
    if (this.gustT <= 0 || p.y < -1) return null;
    const r = Math.hypot(p.x, p.z);
    if (r < TOWER_R - 0.4) return null;
    const sz = p.z >= 0 ? 1 : -1;
    if (Math.abs(p.x) > 1.2 && r > TOWER_R) return new THREE.Vector3(Math.sign(p.x) * 0.6, 0, sz * (TOWER_R + 1.3));
    return new THREE.Vector3(0, 0, sz * 1.2);
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < SEA_Y + 1) return 'water';
    return p.y < this.killY ? 'fall' : 'none';
  }
}
