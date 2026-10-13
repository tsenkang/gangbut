import * as THREE from 'three';
import { GameMap, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER } from '../physics/Physics';
import { grimeTexture } from './City';

// ------------------------------------------------------------
// Mapa 9 — FAROL
// A varandinha redonda no alto de um farol, numa noite de
// tempestade. O guarda-corpo tem buracos, a cúpula do farol dá
// para escalar, e de vez em quando uma onda gigante estoura lá
// embaixo e o vento empurra todo mundo para um lado. Raios
// iluminam tudo de repente. Caiu? Mar bravo.
// ------------------------------------------------------------

const R = 4.6; // raio da varanda
const TOWER_R = 1.7; // raio da sala da lanterna
const SEA_Y = -26;

export class Lighthouse extends GameMap {
  id = 'farol';
  name = 'Farol';
  emoji = '🌊';
  description = 'A varanda redonda no alto de um farol, numa noite de tempestade.';
  hazard = 'Rajadas de vento empurram todo mundo e o guarda-corpo tem buracos!';
  music = 'trem' as const;
  killY = -12;
  camera = {
    dir: new THREE.Vector3(0, 0.75, 1),
    minDist: 12,
    maxDist: 22,
    fov: 44,
    center: new THREE.Vector3(0, 0.6, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-3, -1, -3), new THREE.Vector3(3, 3, 3)),
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
      shadowExtent: 9,
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
    const posts = 24;
    const missing = new Set([3, 4, 11, 17, 18]); // vãos sem grade (por onde dá para cair)
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

    // ---------------- sala da lanterna (no meio) + cúpula (dá para subir)
    this.ctx.physics.addStatic({ x: 0, y: 1.3, z: 0 }, RAPIER.ColliderDesc.cylinder(1.3, TOWER_R));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R, TOWER_R, 0.9, 32), white);
    base.position.y = 0.45;
    this.deco(base);
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(TOWER_R - 0.05, TOWER_R - 0.05, 1.6, 32, 1, true),
      new THREE.MeshPhysicalMaterial({ color: 0xfff3c4, emissive: 0xffe28a, emissiveIntensity: 0.9, transparent: true, opacity: 0.55, roughness: 0.1 }),
    );
    glass.position.y = 1.7;
    this.deco(glass, false);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), rail);
      bar.position.set(Math.cos(a) * TOWER_R, 1.7, Math.sin(a) * TOWER_R);
      this.deco(bar);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d0, toneMapped: false }));
    lamp.position.y = 1.7;
    this.deco(lamp, false);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(TOWER_R + 0.15, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), red);
    dome.position.y = 2.6;
    dome.scale.y = 0.6;
    this.deco(dome);
    this.ctx.physics.addStatic({ x: 0, y: 2.75, z: 0 }, RAPIER.ColliderDesc.cylinder(0.15, TOWER_R + 0.15));
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 8), rail);
    spire.position.y = 3.9;
    this.deco(spire);
    // escadinha na lateral da sala (para subir na cúpula)
    for (let k = 0; k < 5; k++) this.box({ x: 0, y: 0.35 + k * 0.5, z: TOWER_R + 0.12 }, { x: 0.7, y: 0.06, z: 0.06 }, rail);
    const lightL = new THREE.PointLight(0xffe7a8, 25, 14, 1.6);
    lightL.position.y = 1.7;
    this.ctx.root.add(lightL);

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
    this.beam.position.y = 1.7;
    this.deco(this.beam, false);

    // ---------------- torre do farol descendo até o mar (listrada)
    for (let k = 0; k < 6; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.6 + k * 0.25, 2.85 + k * 0.25, 4.4, 32), k % 2 ? white : red);
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

    this.prop('barril', new THREE.Vector3(2.8, 0.5, 1.4), 0x2b5e8a);
    this.prop('caixa', new THREE.Vector3(-2.8, 0.5, -1.4));

    this.spawns = [new THREE.Vector3(-3, 0.05, 1.6), new THREE.Vector3(3, 0.05, 1.6), new THREE.Vector3(-3, 0.05, -1.6), new THREE.Vector3(3, 0.05, -1.6)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.seaMat.uniforms.t.value = time;
    this.beam.rotation.y = time * 0.7;

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
        for (const b of f.ragdoll.bodies()) {
          const v = b.linvel();
          b.setLinvel({ x: v.x + this.gustDir.x * k, y: v.y, z: v.z + this.gustDir.z * k }, true);
        }
      }
      if (Math.random() < dt * 14) arena.effects.splash(this.gustDir.clone().multiplyScalar(-R).setY(0.3 + Math.random()), 0xcfe3f0, 8);
    }
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // Na rajada: chega perto da sala da lanterna, do lado de onde o vento vem
    if (this.gustT <= 0 || p.y < -1) return null;
    return this.gustDir.clone().multiplyScalar(-(TOWER_R + 0.9)).setY(0);
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < SEA_Y + 1) return 'water';
    return p.y < this.killY ? 'fall' : 'none';
  }
}
