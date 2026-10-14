import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { grimeTexture } from './City';
import { RAPIER } from '../physics/Physics';

// ------------------------------------------------------------
// Mapa 5 — INCINERADOR
// A sala de triagem de uma usina de lixo. No meio do piso fica o
// poço do incinerador, tampado por um alçapão de duas folhas; duas
// esteiras rolantes, uma de cada lado, levam tudo (e todos) direto
// para ele. De tempos em tempos o alçapão abre e a fornalha cospe
// fogo. Em cima, um mezanino no fundo, com rampas nas laterais. Na
// frente, um guarda-corpo com vãos dá para o fosso de fogo.
// ------------------------------------------------------------

const HX = 13.5; // meia largura da sala
const HZ = 5.5; // meia profundidade da sala
const PIT_X = 2.4; // meio vão do poço
const PIT_Z = 2.6;
const BELT_Z = 1.1; // meia largura das esteiras
const BELT_X = 11.4; // onde as esteiras começam
const BELT_Y = 0.2;
const BELT_SPEED = 1.5;
const MEZ_Y = 2.8;
const MEZ_Z = -3.3; // borda da frente do mezanino
const LAVA_Y = -5;

type HatchState = 'closed' | 'warn' | 'open' | 'closing';

export class Incinerator extends GameMap {
  id = 'incinerador';
  name = 'Incinerador';
  emoji = '🔥';
  description = 'Sala de triagem de lixo: esteiras levam tudo para o poço do incinerador no meio.';
  hazard = 'As esteiras te levam para o alçapão — quando ele abre, é direto para o fogo!';
  music = 'lava' as const;
  killY = -10;
  camera = {
    dir: new THREE.Vector3(0, 0.7, 1),
    minDist: 14,
    maxDist: 30,
    fov: 42,
    center: new THREE.Vector3(0, 0.8, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-12, -1, -4.5), new THREE.Vector3(12, 3.5, 4.5)),
  };

  private lavaMat!: THREE.ShaderMaterial;
  private beltTex: THREE.Texture[] = [];
  private hatches: { body: RAPIER.RigidBody; side: number }[] = [];
  private hatch: HatchState = 'closed';
  private hatchT = 0;
  private hatchTimer = 12;
  private openK = 0; // 0 = fechado, 1 = aberto
  private emberT = 0;
  private doorGlow!: THREE.MeshBasicMaterial;
  private warnLamps: THREE.MeshBasicMaterial[] = [];

  build() {
    this.lights({
      skyTop: 0x1c1d26,
      skyBottom: 0x4a2a22,
      fog: { color: 0x2e2324, near: 26, far: 75 },
      sunColor: 0xd8dcff,
      sunIntensity: 1.5,
      sunPos: new THREE.Vector3(-6, 18, 8),
      hemiSky: 0x6b6f86,
      hemiGround: 0xff6a2a,
      hemiIntensity: 1.5,
      shadowExtent: 19,
    });
    const glow = new THREE.PointLight(0xff6a1a, 60, 24, 1.5);
    glow.position.set(0, -2.5, 0);
    this.ctx.root.add(glow);

    // Fogo (embaixo do poço e no fosso da frente)
    this.lavaMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      fog: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float t; varying vec2 vUv;
        float n(vec2 p){ return sin(p.x)*sin(p.y); }
        void main(){
          vec2 p = vUv * vec2(30.0, 14.0);
          float v = n(p + vec2(t*0.9, t*1.7)) + n(p*1.9 - vec2(t*0.6, -t*1.1)) * 0.6 + n(p*3.7 + t*2.0) * 0.35;
          v = v * 0.5 + 0.5;
          vec3 c = mix(vec3(0.25,0.02,0.0), vec3(1.0,0.35,0.02), smoothstep(0.3,0.8,v));
          c = mix(c, vec3(1.0,0.85,0.35), smoothstep(0.86,1.0,v));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), this.lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(0, LAVA_Y, 6);
    this.deco(lava, false);

    // ---------------- piso com o buraco do poço no meio
    const concrete = new THREE.MeshStandardMaterial({ map: grimeTexture('#6d6862', [3, 2], { tiles: 6, cracks: true }), roughness: 0.95 });
    const T = 1; // espessura
    this.box({ x: -(HX + PIT_X) / 2, y: -T / 2, z: 0 }, { x: HX - PIT_X, y: T, z: HZ * 2 }, concrete);
    this.box({ x: (HX + PIT_X) / 2, y: -T / 2, z: 0 }, { x: HX - PIT_X, y: T, z: HZ * 2 }, concrete);
    this.box({ x: 0, y: -T / 2, z: (HZ + PIT_Z) / 2 }, { x: PIT_X * 2, y: T, z: HZ - PIT_Z }, concrete);
    this.box({ x: 0, y: -T / 2, z: -(HZ + PIT_Z) / 2 }, { x: PIT_X * 2, y: T, z: HZ - PIT_Z }, concrete);
    // paredes do poço (tijolo queimado) até o fogo
    const brick = new THREE.MeshStandardMaterial({ map: grimeTexture('#4a2c26', [2, 2], { tiles: 6, dark: 'rgba(0,0,0,0.35)' }), roughness: 1 });
    const depth = -LAVA_Y;
    for (const s of [-1, 1]) {
      this.box({ x: s * (PIT_X + 0.15), y: -depth / 2 - 0.5, z: 0 }, { x: 0.3, y: depth - 1, z: PIT_Z * 2 }, brick, { shadow: false });
      this.box({ x: 0, y: -depth / 2 - 0.5, z: s * (PIT_Z + 0.15) }, { x: PIT_X * 2, y: depth - 1, z: 0.3 }, brick, { shadow: false });
    }
    // faixas de perigo em volta do poço
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([3, 1]) });
    for (const s of [-1, 1]) {
      this.box({ x: 0, y: 0.01, z: s * (PIT_Z + 0.25) }, { x: PIT_X * 2 + 0.5, y: 0.03, z: 0.3 }, stripes, { collide: false, shadow: false });
    }

    // ---------------- alçapão de duas folhas (articulado nas bordas)
    const plate = new THREE.MeshStandardMaterial({ map: grimeTexture('#565c66', [1, 2], { tiles: 4, dark: 'rgba(0,0,0,0.3)' }), roughness: 0.6, metalness: 0.6 });
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(PIT_X - 0.02, 0.2, PIT_Z * 2 - 0.04), plate);
      g.add(m);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.21, PIT_Z * 2 - 0.04), new THREE.MeshStandardMaterial({ map: hazardStripes([1, 4]) }));
      stripe.position.x = -side * (PIT_X / 2 - 0.1);
      g.add(stripe);
      const body = this.kinematic(new THREE.Vector3(side * PIT_X / 2, -0.1, 0), RAPIER.ColliderDesc.cuboid(PIT_X / 2 - 0.01, 0.1, PIT_Z - 0.02), g, { grabbable: true });
      this.hatches.push({ body, side });
    }

    // ---------------- esteiras rolantes (levam para o poço)
    const steel = this.material(0x58606b, { roughness: 0.55, metalness: 0.6 });
    for (const s of [-1, 1]) {
      const tex = (() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const g = c.getContext('2d')!;
        g.fillStyle = '#26282c';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#3c4046';
        for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 6, 64);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(BELT_X - PIT_X, 1);
        return t;
      })();
      this.beltTex.push(tex);
      const len = BELT_X - PIT_X;
      const cx = s * (PIT_X + len / 2);
      this.box({ x: cx, y: BELT_Y / 2, z: 0 }, { x: len, y: BELT_Y, z: BELT_Z * 2 }, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), { friction: 1 });
      // laterais da esteira e rolo na ponta
      for (const z of [-BELT_Z - 0.08, BELT_Z + 0.08]) this.box({ x: cx, y: BELT_Y / 2 + 0.05, z }, { x: len, y: BELT_Y + 0.1, z: 0.16 }, steel);
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, BELT_Z * 2, 12), steel);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(s * BELT_X, BELT_Y / 2, 0);
      this.deco(roller);
      // funil de lixo no começo da esteira
      this.box({ x: s * (BELT_X + 0.9), y: 1.6, z: 0 }, { x: 1.6, y: 3.2, z: 2.8 }, this.material(0x2f6f4e, { roughness: 0.7, metalness: 0.3 }));
    }

    // ---------------- paredes
    const plates = new THREE.MeshStandardMaterial({ map: grimeTexture('#3d424b', [8, 3], { tiles: 6, dark: 'rgba(0,0,0,0.3)' }), roughness: 0.7, metalness: 0.5 });
    this.box({ x: 0, y: 5, z: -HZ - 0.5 }, { x: HX * 2 + 2, y: 12, z: 1 }, plates);
    for (const s of [-1, 1]) this.box({ x: s * (HX + 0.5), y: 3.5, z: 0 }, { x: 1, y: 9, z: HZ * 2 + 2 }, plates);
    // boca da fornalha no fundo, atrás do poço
    const door = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.4, 32), steel);
    door.rotation.x = Math.PI / 2;
    door.position.set(0, 1.6, -HZ + 0.1);
    this.deco(door, false);
    this.doorGlow = new THREE.MeshBasicMaterial({ color: 0xff7a1a, toneMapped: false });
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(1.8, 32), this.doorGlow);
    mouth.position.set(0, 1.6, -HZ + 0.32);
    this.deco(mouth, false);
    for (let i = 0; i < 5; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.6, 0.14), this.material(0x1d1f24, { metalness: 0.6 }));
      bar.position.set(-1.2 + i * 0.6, 1.6, -HZ + 0.36);
      this.deco(bar, false);
    }
    // lâmpadas de alerta dos lados do poço
    for (const s of [-1, 1]) {
      const m = new THREE.MeshBasicMaterial({ color: 0x441111, toneMapped: false });
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), m);
      l.position.set(s * 3.4, 3.9, -HZ + 0.2);
      this.deco(l, false);
      this.warnLamps.push(m);
    }
    // canos e chaminé
    const pipe = this.material(0x8a5a3a, { roughness: 0.6, metalness: 0.5 });
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, HX * 2, 12), pipe);
    duct.rotation.z = Math.PI / 2;
    duct.position.set(0, 7.5, -HZ + 0.4);
    this.deco(duct, false);
    for (const x of [-8, 0, 8]) {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.5, 16, 1, true), this.material(0x2d3a2f, { side: THREE.DoubleSide }));
      shade.position.set(x, 8, 0);
      this.deco(shade, false);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
      bulb.position.set(x, 7.75, 0);
      this.deco(bulb, false);
    }

    // ---------------- mezanino no fundo (dois lados do poço) + rampas nas laterais
    const grate = this.material(0x7d848f, { roughness: 0.6, metalness: 0.6 });
    const rail = this.material(0xd9a521, { roughness: 0.5, metalness: 0.5 });
    const mezD = HZ + MEZ_Z; // profundidade
    for (const s of [-1, 1]) {
      const x0 = 3.2;
      const cx = s * (x0 + HX) / 2;
      const w = HX - x0;
      this.box({ x: cx, y: MEZ_Y - 0.15, z: -HZ + mezD / 2 }, { x: w, y: 0.3, z: mezD }, grate);
      // pilares
      for (const px of [x0 + 0.3, (x0 + HX) / 2]) this.box({ x: s * px, y: MEZ_Y / 2 - 0.15, z: MEZ_Z + 0.25 }, { x: 0.3, y: MEZ_Y - 0.3, z: 0.3 }, steel);
      // guarda-corpo com um vão no meio
      const g1 = { a: x0, b: (x0 + HX) / 2 - 1 };
      const g2 = { a: (x0 + HX) / 2 + 1, b: HX - 1.9 };
      for (const g of [g1, g2]) {
        this.box({ x: s * (g.a + g.b) / 2, y: MEZ_Y + 1, z: MEZ_Z - 0.05 }, { x: g.b - g.a, y: 0.08, z: 0.08 }, rail);
        for (const px of [g.a, g.b]) this.box({ x: s * px, y: MEZ_Y + 0.5, z: MEZ_Z - 0.05 }, { x: 0.08, y: 1, z: 0.08 }, rail);
      }
      // rampa encostada na parede lateral, da frente até o mezanino
      const rz0 = 3.8;
      const run = rz0 - MEZ_Z;
      const ang = Math.atan2(MEZ_Y, run);
      const len = Math.hypot(MEZ_Y, run);
      this.box(
        { x: s * (HX - 0.85), y: MEZ_Y / 2 - 0.12, z: (rz0 + MEZ_Z) / 2 },
        { x: 1.7, y: 0.24, z: len },
        grate,
        { rot: new THREE.Euler(ang, 0, 0), friction: 1 },
      );
      this.box({ x: s * (HX - 1.75), y: MEZ_Y / 2 + 0.75, z: (rz0 + MEZ_Z) / 2 }, { x: 0.08, y: 0.08, z: len }, rail, { rot: new THREE.Euler(ang, 0, 0) });
    }

    // ---------------- guarda-corpo da frente (com vãos) — atrás dele, o fosso de fogo
    const gaps = [
      [-7, -5.2],
      [4.2, 6],
    ];
    for (let x = -HX + 0.4; x <= HX - 0.4; x += 1.8) {
      if (gaps.some(([a, b]) => x > a - 0.2 && x < b + 0.2)) continue;
      this.box({ x, y: 0.5, z: HZ - 0.1 }, { x: 0.1, y: 1, z: 0.1 }, rail);
    }
    const segs: [number, number][] = [
      [-HX, -7],
      [-5.2, 4.2],
      [6, HX],
    ];
    for (const [a, b] of segs) this.box({ x: (a + b) / 2, y: 1, z: HZ - 0.1 }, { x: b - a, y: 0.08, z: 0.08 }, rail);

    this.prop('barril', new THREE.Vector3(-9, 0.6, 0), 0xd94a3a);
    this.prop('caixa', new THREE.Vector3(8.5, 0.6, 0));
    this.prop('caixa', new THREE.Vector3(-8, 0.5, 3.6));
    this.prop('barril', new THREE.Vector3(8, MEZ_Y + 0.5, -4.4), 0x2b5e8a);

    this.spawns = [new THREE.Vector3(-6.5, 0.08, 3.2), new THREE.Vector3(6.5, 0.08, 3.2), new THREE.Vector3(-6.5, 0.08, -3), new THREE.Vector3(6.5, 0.08, -3)];
  }

  private setHatches(k: number) {
    const a = k * 1.45; // até ~83°
    for (const h of this.hatches) {
      const phi = h.side * a;
      // dobradiça na borda de fora do poço
      const hx = h.side * PIT_X;
      const ox = -h.side * (PIT_X / 2);
      const x = hx + ox * Math.cos(phi);
      const y = -0.1 + ox * Math.sin(phi);
      h.body.setNextKinematicTranslation({ x, y, z: 0 });
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi);
      h.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.lavaMat.uniforms.t.value = time;
    for (let i = 0; i < this.beltTex.length; i++) this.beltTex[i].offset.x += (i === 0 ? -1 : 1) * BELT_SPEED * dt * -1;
    this.doorGlow.color.setHSL(0.07, 1, 0.42 + Math.sin(time * 5) * 0.06 + this.openK * 0.2);

    // esteiras: quem está em cima é levado para o poço
    for (const f of arena.fighters) {
      if (!f.alive || f.removed) continue;
      const p = f.pos('pelvis');
      if (Math.abs(p.z) < BELT_Z + 0.1 && Math.abs(p.x) > PIT_X - 0.1 && Math.abs(p.x) < BELT_X && p.y > 0 && p.y < 1.6) {
        const target = -Math.sign(p.x) * BELT_SPEED;
        for (const b of f.ragdoll.bodies()) {
          const v = b.linvel();
          b.setLinvel({ x: v.x + (target - v.x) * Math.min(1, dt * (f.grounded ? 3 : 1)), y: v.y, z: v.z }, true);
        }
      }
    }
    for (const pr of this.ctx.props) {
      if (!pr.body.isValid()) continue;
      const p = pr.body.translation();
      if (Math.abs(p.z) < BELT_Z && Math.abs(p.x) > PIT_X && Math.abs(p.x) < BELT_X && p.y > 0 && p.y < 1.4) {
        const v = pr.body.linvel();
        const target = -Math.sign(p.x) * BELT_SPEED;
        pr.body.setLinvel({ x: v.x + (target - v.x) * Math.min(1, dt * 3), y: v.y, z: v.z }, true);
      }
    }

    // alçapão: fechado → alerta → abre → fecha
    this.hatchT += dt;
    if (this.hatch === 'closed') {
      this.hatchTimer -= dt;
      if (this.hatchTimer <= 0) {
        this.hatch = 'warn';
        this.hatchT = 0;
        arena.announce('🔥 O INCINERADOR VAI ABRIR! Saia do alçapão!', 'tip');
        arena.sound('horn', 0.7, 0.7);
      }
    } else if (this.hatch === 'warn') {
      if (this.hatchT > 2.2) {
        this.hatch = 'open';
        this.hatchT = 0;
        arena.sound('crack', 1, 0.6);
        arena.shake(0.2);
      }
    } else if (this.hatch === 'open') {
      this.openK = Math.min(1, this.openK + dt * 2.5);
      if (Math.random() < dt * 22) arena.effects.fire(new THREE.Vector3((Math.random() - 0.5) * PIT_X * 1.6, -1.5 + Math.random() * 2, (Math.random() - 0.5) * PIT_Z * 1.6), 6);
      if (this.hatchT > 6.5) {
        this.hatch = 'closing';
        this.hatchT = 0;
      }
    } else {
      this.openK = Math.max(0, this.openK - dt * 0.9);
      if (this.openK <= 0) {
        this.hatch = 'closed';
        this.hatchTimer = Math.max(5, 9 - time * 0.03) + Math.random() * 3;
      }
    }
    // tremidinha no alerta
    const shakeK = this.hatch === 'warn' ? Math.sin(time * 50) * 0.012 : 0;
    this.setHatches(this.openK + shakeK);
    const blink = this.hatch === 'warn' || this.hatch === 'open' ? (Math.sin(time * 14) > 0 ? 1 : 0) : 0;
    for (const m of this.warnLamps) m.color.setHex(blink ? 0xff2a1a : 0x441111);

    // brasas subindo do fosso e do poço
    this.emberT -= dt;
    if (this.emberT <= 0) {
      this.emberT = 0.3;
      if (Math.random() < 0.5) arena.effects.fire(new THREE.Vector3((Math.random() - 0.5) * 26, LAVA_Y + 0.3, HZ + 1 + Math.random() * 3), 3);
      else if (this.openK > 0.3) arena.effects.fire(new THREE.Vector3((Math.random() - 0.5) * 3, LAVA_Y + 0.3, (Math.random() - 0.5) * 3), 4);
    }
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    if (p.y < -0.5) return null;
    const danger = this.hatch === 'warn' || this.hatch === 'open';
    const onBelt = Math.abs(p.z) < BELT_Z + 0.4 && Math.abs(p.x) < BELT_X && p.y < 1.5;
    const nearPit = Math.abs(p.x) < PIT_X + 1.4 && Math.abs(p.z) < PIT_Z + 1.4 && p.y < 1.5;
    if (nearPit && (danger || this.openK > 0)) {
      return new THREE.Vector3(Math.sign(p.x || 1) * (PIT_X + 2.5), 0, p.z >= 0 ? PIT_Z + 1.2 : -(PIT_Z + 1.2));
    }
    // nunca fica parado em cima da esteira perto do poço
    if (onBelt && (danger || Math.abs(p.x) < PIT_X + 3)) return new THREE.Vector3(p.x, 0, p.z >= 0 ? 2.4 : -2.4);
    return null;
  }

  dumpSpot(p: THREE.Vector3) {
    if (this.openK < 0.5 || p.y > 1.5) return null;
    return new THREE.Vector3(0, 0, 0);
  }

  safeSpot(p: THREE.Vector3) {
    return new THREE.Vector3(Math.sign(p.x || 1) * 7, 0, 3);
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < LAVA_Y + 1.4) return 'lava';
    return 'none';
  }
}
