import * as THREE from 'three';
import { canvasTexture, GameMap, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER } from '../physics/Physics';
import { grimeTexture } from './City';
import type { Fighter } from '../characters/Fighter';

// ------------------------------------------------------------
// Mapa 14 — AQUÁRIO
// Passarelas estreitas de manutenção em cima do tanque gigante de
// um aquário. Caiu na água? Fora! E de vez em quando sobe um
// TENTÁCULO de polvo: primeiro borbulha, depois ele sobe, bate na
// passarela e varre para o lado.
// ------------------------------------------------------------

const WATER_Y = -1.6;
const TX = 10; // meia largura do tanque (x)
const TZ = 6; // meia profundidade do tanque (z)
const TENT_L = 4.6; // comprimento do tentáculo
const TENT_R = 0.38;

type TentState = 'idle' | 'warn' | 'rise' | 'slam' | 'sweep' | 'sink';

export class Aquarium extends GameMap {
  id = 'aquario';
  name = 'Aquário';
  emoji = '🐙';
  description = 'Passarelas de manutenção em cima do tanque gigante de um aquário.';
  hazard = 'Não caia na água! Quando borbulhar, um tentáculo de polvo vai subir e varrer a passarela.';
  music = 'gelatina' as const;
  killY = -9;
  botLeaps = false; // o vão entre as passarelas é grande demais
  camera = {
    dir: new THREE.Vector3(0, 0.78, 1),
    minDist: 14,
    maxDist: 28,
    fov: 44,
    center: new THREE.Vector3(0, 0.4, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-8, -1, -4.5), new THREE.Vector3(8, 3, 4.5)),
  };

  private waterMat!: THREE.ShaderMaterial;
  private fish: { obj: THREE.Object3D; r: number; speed: number; y: number; phase: number; cz: number }[] = [];
  // ----- tentáculo
  private tent!: RAPIER.RigidBody;
  private tentState: TentState = 'idle';
  private tentT = 0;
  private tentTimer = 8;
  private base = new THREE.Vector3();
  private aimYaw = 0; // para onde ele tomba
  private tilt = 0; // 0 = em pé, ~1.3 = deitado
  private sweepYaw = 0;
  private rise = 0; // 0 = escondido, 1 = todo para fora
  private tentHit = new Set<Fighter>();
  private bubbleT = 0;

  build() {
    this.lights({
      // salão escuro iluminado pela água
      skyTop: 0x0b1a2c,
      skyBottom: 0x14304a,
      fog: { color: 0x0f2438, near: 22, far: 70 },
      sunColor: 0xcfe8ff,
      sunIntensity: 1.7,
      sunPos: new THREE.Vector3(-6, 20, 8),
      hemiSky: 0x7fb8e6,
      hemiGround: 0x0f3a55,
      hemiIntensity: 1.5,
      shadowExtent: 15,
    });
    const glow = new THREE.PointLight(0x4fc3ff, 50, 30, 1.5);
    glow.position.set(0, -2.5, 0);
    this.ctx.root.add(glow);

    // ---------------- tanque: água, fundo, vidro da frente
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      transparent: true,
      fog: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float t; varying vec2 vUv;
        void main(){ vec2 p = vUv * vec2(20.0, 12.0);
          float c = sin(p.x*1.3 + t*1.2) * sin(p.y*1.7 - t*0.9) + sin((p.x+p.y)*0.8 + t*1.6) * 0.5;
          vec3 col = mix(vec3(0.05,0.35,0.5), vec3(0.35,0.8,0.95), smoothstep(0.6, 1.4, c));
          gl_FragColor = vec4(col, 0.82); }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(TX * 2, TZ * 2), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    this.deco(water, false);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(TX * 2, TZ * 2), this.material(0xc9b07a, { roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = -9;
    this.deco(sand, false);
    const inside = new THREE.Mesh(new THREE.BoxGeometry(TX * 2, 7.4, TZ * 2), new THREE.MeshBasicMaterial({ color: 0x0d4a66, transparent: true, opacity: 0.55, side: THREE.BackSide, depthWrite: false }));
    inside.position.y = WATER_Y - 3.7;
    this.deco(inside, false);
    // paredes do tanque (vidro grosso, borda de concreto)
    const concrete = new THREE.MeshStandardMaterial({ map: grimeTexture('#6f7880', [4, 1], { tiles: 6 }), roughness: 0.9 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1 });
    this.box({ x: 0, y: -4.6, z: TZ + 0.25 }, { x: TX * 2 + 1, y: 9, z: 0.5 }, glass, { collide: false, shadow: false });
    for (const s of [-1, 1]) this.box({ x: s * (TX + 0.25), y: -4.6, z: 0 }, { x: 0.5, y: 9, z: TZ * 2 }, concrete, { collide: false });
    this.box({ x: 0, y: -4.6, z: -TZ - 0.25 }, { x: TX * 2 + 1, y: 9, z: 0.5 }, concrete, { collide: false });
    // corais, algas e pedras no fundo
    const cols = [0xff6f61, 0xffb347, 0xb565d9, 0x3ec7a8];
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Mesh(i % 3 ? new THREE.ConeGeometry(0.4 + Math.random() * 0.5, 1.5 + Math.random() * 2.5, 6) : new THREE.DodecahedronGeometry(0.6 + Math.random()), this.material(i % 3 ? cols[i % 4] : 0x55606a));
      c.position.set((Math.random() - 0.5) * TX * 1.8, -8.2, (Math.random() - 0.5) * TZ * 1.8);
      this.deco(c, false);
    }
    // peixinhos nadando em volta (só desenho)
    for (let i = 0; i < 18; i++) {
      const fishG = new THREE.Group();
      const color = [0xffd23f, 0xff7b54, 0x4cc9f0, 0xf72585][i % 4];
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), this.material(color, { roughness: 0.4 }));
      body.scale.set(1.6, 0.9, 0.6);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.35, 4), this.material(color));
      tail.rotation.z = Math.PI / 2;
      tail.position.x = -0.5;
      fishG.add(body, tail);
      this.deco(fishG, false);
      this.fish.push({ obj: fishG, r: 2 + Math.random() * 6, speed: 0.3 + Math.random() * 0.5, y: -3 - Math.random() * 5, phase: Math.random() * 6, cz: (Math.random() - 0.5) * 4 });
    }

    // ---------------- passarelas (piso de grade, estreitas)
    const grate = new THREE.MeshStandardMaterial({ map: grimeTexture('#8b939b', [6, 1], { tiles: 10 }), roughness: 0.5, metalness: 0.6 });
    const rail = this.material(0xf2b705, { roughness: 0.5, metalness: 0.4 });
    const walk = (x: number, z: number, w: number, d: number) => this.box({ x, y: -0.12, z }, { x: w, y: 0.24, z: d }, grate);
    walk(0, -TZ + 0.8, TX * 2, 1.6); // fundo
    walk(0, TZ - 0.8, TX * 2, 1.6); // frente
    walk(-TX + 0.8, 0, 1.6, TZ * 2 - 3.2); // esquerda
    walk(TX - 0.8, 0, 1.6, TZ * 2 - 3.2); // direita
    walk(-4, 0, 1.3, TZ * 2 - 3.2); // pontes que cruzam o tanque
    walk(4, 0, 1.3, TZ * 2 - 3.2);
    walk(0, 0, 6.7, 1.3); // ponte do meio
    walk(0, 0, 2.6, 2.6); // plataforma central
    // corrimão só no fundo (o resto é aberto!)
    this.box({ x: 0, y: 1, z: -TZ + 0.1 }, { x: TX * 2, y: 0.08, z: 0.08 }, rail);
    for (let x = -TX; x <= TX; x += 2.5) this.box({ x, y: 0.5, z: -TZ + 0.1 }, { x: 0.07, y: 1, z: 0.07 }, rail, { collide: false });
    // mureta baixa no lado de fora das passarelas (o lado da água fica aberto)
    const kick = this.material(0x55606a, { roughness: 0.7, metalness: 0.4 });
    this.box({ x: 0, y: 0.3, z: -TZ - 0.05 }, { x: TX * 2 + 0.2, y: 0.6, z: 0.12 }, kick);
    this.box({ x: 0, y: 0.3, z: TZ + 0.05 }, { x: TX * 2 + 0.2, y: 0.6, z: 0.12 }, kick);
    for (const s of [-1, 1]) this.box({ x: s * (TX + 0.05), y: 0.3, z: 0 }, { x: 0.12, y: 0.6, z: TZ * 2 + 0.2 }, kick);
    // faixas de perigo nas beiradas da plataforma central
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([2, 1]) });
    for (const s of [-1, 1]) this.box({ x: 0, y: 0.005, z: s * 1.2 }, { x: 2.6, y: 0.01, z: 0.15 }, stripes, { collide: false, shadow: false });
    // salão: paredes escuras com janelas azuis
    const hall = this.material(0x16263a, { roughness: 1 });
    this.box({ x: 0, y: 4, z: -TZ - 3 }, { x: 40, y: 14, z: 1 }, hall, { collide: false });
    // janelão do oceanário no fundo (água azul, raios de luz e peixes)
    const ocean = canvasTexture(1024, 256, (g) => {
      const grd = g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, '#2f9fd6');
      grd.addColorStop(0.55, '#14628f');
      grd.addColorStop(1, '#082a45');
      g.fillStyle = grd;
      g.fillRect(0, 0, 1024, 256);
      for (let i = 0; i < 9; i++) {
        const x = Math.random() * 1024;
        g.fillStyle = 'rgba(200,240,255,0.08)';
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 40, 0);
        g.lineTo(x + 110, 256);
        g.lineTo(x + 50, 256);
        g.fill();
      }
      g.fillStyle = 'rgba(5,30,50,0.55)';
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * 1024;
        const y = 60 + Math.random() * 170;
        const sz = 6 + Math.random() * 14;
        g.beginPath();
        g.ellipse(x, y, sz, sz * 0.45, 0, 0, Math.PI * 2);
        g.moveTo(x + sz, y);
        g.lineTo(x + sz * 1.7, y - sz * 0.5);
        g.lineTo(x + sz * 1.7, y + sz * 0.5);
        g.fill();
      }
      // pedras e algas no fundo
      g.fillStyle = '#06202f';
      for (let x = 0; x < 1024; x += 30) g.fillRect(x, 230 + Math.random() * 10, 34, 40);
    });
    const glassWin = new THREE.Mesh(new THREE.PlaneGeometry(36, 9), new THREE.MeshBasicMaterial({ map: ocean, toneMapped: false }));
    glassWin.position.set(0, 4.2, -TZ - 2.44);
    this.deco(glassWin, false);
    const frame = this.material(0x0c1622, { roughness: 0.8 });
    for (const x of [-18, -9, 0, 9, 18]) this.box({ x, y: 4.2, z: -TZ - 2.35 }, { x: 0.35, y: 9.2, z: 0.25 }, frame, { collide: false });
    for (const y of [-0.4, 8.8]) this.box({ x: 0, y, z: -TZ - 2.35 }, { x: 36.4, y: 0.4, z: 0.25 }, frame, { collide: false });
    // paredes laterais e piso do salão em volta do tanque
    for (const sx of [-1, 1]) this.box({ x: sx * 20, y: 4, z: 0 }, { x: 1, y: 14, z: 30 }, hall, { collide: false });
    // piso do salão em volta do tanque (mais baixo que a borda; só desenho)
    const hallFloor = this.material(0x13202e, { roughness: 1 });
    for (const sx of [-1, 1]) this.box({ x: sx * 15.2, y: -2.2, z: 0 }, { x: 9.6, y: 0.4, z: 30 }, hallFloor, { collide: false, shadow: false });
    for (const sz of [-1, 1]) this.box({ x: 0, y: -2.2, z: sz * 10.6 }, { x: 20.8, y: 0.4, z: 8.8 }, hallFloor, { collide: false, shadow: false });
    // baldes de comida de peixe e caixas na borda
    this.prop('barril', new THREE.Vector3(-TX + 0.8, 0.5, -TZ + 0.8), 0x2a9d8f);
    this.prop('caixa', new THREE.Vector3(TX - 0.8, 0.5, TZ - 0.8));
    this.prop('caixa', new THREE.Vector3(0, 0.5, -TZ + 0.8), 0x9c6b3a);

    // ---------------- tentáculo (cinemático, escondido na água)
    const tentMat = this.material(0xc0396b, { roughness: 0.45 });
    const suck = this.material(0xf4b6c8, { roughness: 0.5 });
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(TENT_R, TENT_L - TENT_R * 2, 8, 14), tentMat);
    g.add(t);
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10), suck);
      s.rotation.x = Math.PI / 2;
      s.position.set(0, -TENT_L / 2 + 0.6 + i * 0.55, TENT_R * 0.92);
      g.add(s);
    }
    this.tent = this.kinematic(new THREE.Vector3(0, -20, 0), RAPIER.ColliderDesc.capsule(TENT_L / 2 - TENT_R, TENT_R), g, { grabbable: true });

    this.spawns = [new THREE.Vector3(-7, 0.05, -TZ + 0.8), new THREE.Vector3(7, 0.05, -TZ + 0.8), new THREE.Vector3(-6, 0.05, TZ - 0.8), new THREE.Vector3(6, 0.05, TZ - 0.8)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.waterMat.uniforms.t.value = time;
    for (const f of this.fish) {
      const a = time * f.speed + f.phase;
      f.obj.position.set(Math.cos(a) * f.r, f.y + Math.sin(a * 2) * 0.3, f.cz + Math.sin(a) * f.r * 0.45);
      f.obj.rotation.y = -a - Math.PI / 2;
    }
    this.updateTentacle(dt, arena);
  }

  private updateTentacle(dt: number, arena: ArenaApi) {
    this.tentT += dt;
    const st = this.tentState;
    const go = (s: TentState) => {
      this.tentState = s;
      this.tentT = 0;
    };
    if (st === 'idle') {
      this.rise = 0;
      this.tentTimer -= dt;
      if (this.tentTimer <= 0) {
        // nasce na água perto de alguém, mirando nele
        const alive = arena.fighters.filter((f) => f.alive && !f.removed);
        if (!alive.length) return;
        const target = alive[Math.floor(Math.random() * alive.length)].pos('pelvis');
        const spots: THREE.Vector3[] = [];
        for (const x of [-7.3, -2, 2, 7.3]) for (const z of [-2.8, 2.8]) spots.push(new THREE.Vector3(x, WATER_Y, z));
        spots.sort((a, b) => a.distanceTo(target) - b.distanceTo(target));
        this.base.copy(spots[Math.floor(Math.random() * 2)]);
        this.aimYaw = Math.atan2(target.x - this.base.x, target.z - this.base.z);
        this.tentHit.clear();
        go('warn');
        arena.announce('🐙 BORBULHANDO... o polvo vai atacar!', 'tip');
        arena.sound('splash', 0.6, 0.6);
      }
    } else if (st === 'warn') {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.bubbleT = 0.08;
        arena.effects.splash(this.base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.1, (Math.random() - 0.5) * 0.8)), 0xbfefff, 4);
      }
      if (this.tentT > 1.6) {
        go('rise');
        arena.sound('splash', 1, 0.5);
        arena.effects.splash(this.base.clone(), 0xbfefff, 30);
      }
    } else if (st === 'rise') {
      this.rise = Math.min(1, this.tentT / 0.5);
      this.tilt = 0;
      if (this.tentT > 0.7) go('slam');
    } else if (st === 'slam') {
      // tomba como um martelo em cima da passarela
      this.tilt = Math.min(1.35, (this.tentT / 0.35) * 1.35);
      if (this.tentT > 0.35 && this.tentT - dt <= 0.35) {
        arena.shake(0.4);
        arena.sound('heavy', 1, 0.6);
      }
      if (this.tentT > 0.6) go('sweep');
      this.sweepYaw = 0;
    } else if (st === 'sweep') {
      // varre para o lado e volta
      this.sweepYaw = Math.sin((this.tentT / 1.6) * Math.PI * 2) * 0.9;
      this.tilt = 1.3;
      if (this.tentT > 1.6) go('sink');
    } else if (st === 'sink') {
      this.tilt = Math.max(0, 1.3 - this.tentT * 2.5);
      this.rise = Math.max(0, 1 - this.tentT / 0.8);
      if (this.tentT > 0.9) {
        go('idle');
        this.tentTimer = 6 + Math.random() * 5;
      }
    }

    // posição: base na água, tomba na direção mirada (+ varrida)
    const yaw = this.aimYaw + this.sweepYaw;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.tilt, yaw, 0, 'YXZ'));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const sunk = (1 - this.rise) * (TENT_L + 1);
    const center = this.base.clone().addScaledVector(up, TENT_L / 2 - 0.3).add(new THREE.Vector3(0, -sunk, 0));
    if (st === 'idle') center.set(0, -20, 0);
    this.tent.setNextKinematicTranslation(center);
    this.tent.setNextKinematicRotation(q);

    // pancada em quem o tentáculo encosta (enquanto bate e varre)
    if (st === 'slam' || st === 'sweep') {
      const a = center.clone().addScaledVector(up, -TENT_L / 2);
      const b = center.clone().addScaledVector(up, TENT_L / 2);
      const seg = new THREE.Line3(a, b);
      const tmp = new THREE.Vector3();
      for (const f of arena.fighters) {
        if (!f.alive || f.removed || this.tentHit.has(f)) continue;
        for (const part of ['chest', 'head', 'pelvis'] as const) {
          const p = f.pos(part);
          seg.closestPointToPoint(p, true, tmp);
          if (tmp.distanceTo(p) < TENT_R + 0.45) {
            this.tentHit.add(f);
            // empurra para o lado da varrida (e um pouco para cima)
            const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(Math.sign(Math.cos((this.tentT / 1.6) * Math.PI * 2)) || 1);
            const dir = st === 'slam' ? p.clone().sub(tmp).setY(0).normalize().setY(0.6) : side.setY(0.5);
            arena.hazardHit(f, 32, dir.normalize(), 7, st === 'slam' ? 'PLOFT!' : 'SPLASH!');
            break;
          }
        }
      }
    }
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // borbulhou perto: sai de perto do ponto (fica no lado de fora da passarela)
    if (this.tentState !== 'warn' && this.tentState !== 'rise') return null;
    if (p.distanceTo(this.base) > TENT_L + 0.5 || p.y < -1) return null;
    const away = p.clone().sub(this.base).setY(0).normalize().multiplyScalar(2.5);
    return p.clone().add(away).setY(0);
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    // a passarela do fundo é a mais larga (e tem corrimão)
    return new THREE.Vector3(THREE.MathUtils.clamp(p.x, -8, 8), 0, Math.abs(p.z) < 1 ? 0 : p.z < 0 ? -TZ + 0.8 : TZ - 0.8);
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < WATER_Y + 0.2) return 'water';
    return p.y < this.killY ? 'fall' : 'none';
  }
}
