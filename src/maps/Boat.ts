import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER, G_WORLD, G_ALL, groups } from '../physics/Physics';
import { grimeTexture } from './City';
import type { Fighter } from '../characters/Fighter';

// ------------------------------------------------------------
// Mapa 13 — BARCO DE PESCA
// Um barco pesqueiro balançando em mar agitado. De vez em quando
// aparece uma barbatana rondando... e um TUBARÃO salta no convés!
// Ele não mata na hora: morde, segura e vai se arrastando até a
// borda para levar o coitado para o fundo do mar. Para escapar:
// apertar botões sem parar, ou os amigos socarem o tubarão.
// ------------------------------------------------------------

const WATER_Y = -2.3;
const HALF_L = 11; // meio comprimento do convés
const HALF_W = 4; // meia largura do convés
const SHARK_HP = 3; // pancadas para o tubarão soltar
const ESCAPE_PRESSES = 10; // botões que a vítima precisa apertar
const SHARK_SCALE = 1.4; // tamanho do tubarão
const MOUTH = new THREE.Vector3(1.15 * SHARK_SCALE, -0.07, 0); // boca (no espaço do tubarão)

type SharkState = 'wait' | 'warn' | 'leap' | 'drag' | 'flop' | 'dive';

export class Boat extends GameMap {
  id = 'barco';
  name = 'Barco de Pesca';
  emoji = '🦈';
  description = 'Um barco pesqueiro balançando em mar agitado... cheio de tubarões em volta.';
  hazard = 'Tubarões pulam no convés e arrastam quem pegarem para o mar! Soque o tubarão ou aperte botões para escapar.';
  music = 'trem' as const;
  killY = -9;
  camera = {
    dir: new THREE.Vector3(0, 0.72, 1),
    minDist: 14,
    maxDist: 29,
    fov: 44,
    center: new THREE.Vector3(0, 0.6, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-10, -1, -3), new THREE.Vector3(10, 4, 3)),
  };

  private boat!: RAPIER.RigidBody;
  private boatPos = new THREE.Vector3();
  private boatQuat = new THREE.Quaternion();
  private seaMat!: THREE.ShaderMaterial;
  private clock = 0;
  private waveT = 0;
  private waveTimer = 18;

  // ----- tubarão
  private shark!: RAPIER.RigidBody;
  private sharkMesh!: THREE.Group;
  private jaw!: THREE.Object3D;
  private fin!: THREE.Mesh;
  private state: SharkState = 'wait';
  private stateT = 0;
  private waitTimer = 10;
  private side = 1; // de que lado do barco ele vem (z+ ou z-)
  private sharkPos = new THREE.Vector3(0, -30, 0);
  private sharkYaw = 0;
  private sharkPitch = 0;
  private leapFrom = new THREE.Vector3();
  private leapTo = new THREE.Vector3();
  private victim: Fighter | null = null;
  /** Em quem ele mirou o pulo (corrige a mira no ar). */
  private prey: Fighter | null = null;
  private sharkVel = new THREE.Vector3();
  private lastSharkPos = new THREE.Vector3(0, -30, 0);
  private hp = SHARK_HP;
  private presses = 0;
  private hitCd = new Map<Fighter, number>();

  build() {
    this.lights({
      // mar aberto, céu nublado
      skyTop: 0x5d7690,
      skyBottom: 0xcdd6dc,
      fog: { color: 0xa9b7c2, near: 30, far: 120 },
      sunColor: 0xfff2dc,
      sunIntensity: 2.1,
      sunPos: new THREE.Vector3(-10, 22, 12),
      hemiSky: 0xd6e2ee,
      hemiGround: 0x3b5266,
      hemiIntensity: 1.35,
      shadowExtent: 18,
    });

    // ---------------- mar (ondas por shader)
    this.seaMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      fog: false,
      vertexShader: `uniform float t; varying float vH; varying vec2 vUv;
        void main(){ vUv = uv; vec3 p = position;
          float h = sin(p.x*0.12 + t*1.1)*0.6 + sin(p.y*0.2 - t*1.5)*0.4 + sin((p.x+p.y)*0.45 + t*2.1)*0.18;
          p.z += h; vH = h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
      fragmentShader: `varying float vH; varying vec2 vUv;
        void main(){ vec3 deep = vec3(0.05,0.22,0.32); vec3 top = vec3(0.16,0.45,0.55);
          vec3 c = mix(deep, top, smoothstep(-0.8, 1.0, vH));
          c = mix(c, vec3(0.85,0.92,0.95), smoothstep(0.85, 1.15, vH));
          float d = length(vUv - 0.5) * 2.0; c = mix(c, vec3(0.62,0.7,0.76), smoothstep(0.35, 1.0, d));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 140, 140), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = WATER_Y;
    this.deco(sea, false);

    // ---------------- o barco (um corpo cinemático só: tudo balança junto)
    const world = this.ctx.physics.world;
    this.boat = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
    const add = (hx: number, hy: number, hz: number, x: number, y: number, z: number, grab = true) => {
      const c = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.9).setRestitution(0.05).setCollisionGroups(groups(G_WORLD, G_ALL)),
        this.boat,
      );
      this.ctx.physics.register(c, { kind: 'static', grabbable: grab });
    };
    const g = new THREE.Group();
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const deck = new THREE.MeshStandardMaterial({ map: grimeTexture('#9a7a55', [8, 3], { tiles: 12, dark: 'rgba(40,20,0,0.25)' }), roughness: 0.95 });
    const hullRed = this.material(0xb3261e, { roughness: 0.6 });
    const hullWhite = this.material(0xece7dc, { roughness: 0.6 });
    const steel = this.material(0x5b636d, { roughness: 0.5, metalness: 0.6 });
    const blue = this.material(0x2f5d8a, { roughness: 0.6 });

    // convés
    add(HALF_L, 0.3, HALF_W, 0, -0.3, 0);
    box(HALF_L * 2, 0.6, HALF_W * 2, 0, -0.3, 0, deck);
    // proa (bico)
    add(1.6, 0.3, 2.8, HALF_L + 1.4, -0.3, 0);
    add(1, 0.3, 1.5, HALF_L + 3.4, -0.3, 0);
    const bowShape = new THREE.Shape();
    bowShape.moveTo(0, -HALF_W);
    bowShape.lineTo(2.2, -2.9);
    bowShape.lineTo(4.6, 0);
    bowShape.lineTo(2.2, 2.9);
    bowShape.lineTo(0, HALF_W);
    const bow = new THREE.Mesh(new THREE.ExtrudeGeometry(bowShape, { depth: 0.6, bevelEnabled: false }), deck);
    bow.rotation.x = Math.PI / 2;
    bow.position.set(HALF_L, 0, 0);
    bow.castShadow = bow.receiveShadow = true;
    g.add(bow);
    // casco (vermelho embaixo, branco em cima)
    box(HALF_L * 2, 1.4, HALF_W * 2 + 0.2, 0, -1.3, 0, hullWhite);
    box(HALF_L * 2 - 0.4, 1.6, HALF_W * 2 - 0.2, 0, -2.6, 0, hullRed);
    const hullBow = new THREE.Mesh(new THREE.ExtrudeGeometry(bowShape, { depth: 2.4, bevelEnabled: false }), hullWhite);
    hullBow.rotation.x = Math.PI / 2;
    hullBow.position.set(HALF_L, -0.6, 0);
    g.add(hullBow);
    // amuradas baixas com vãos (dá para agarrar; pelos vãos dá para cair)
    for (const s of [-1, 1]) {
      for (const [x0, x1] of [
        [-HALF_L, -4],
        [-1.5, 4.5],
        [7, HALF_L],
      ]) {
        const cx = (x0 + x1) / 2;
        const hx = (x1 - x0) / 2;
        add(hx, 0.3, 0.08, cx, 0.3, s * (HALF_W - 0.08));
        box(hx * 2, 0.6, 0.16, cx, 0.3, s * (HALF_W - 0.08), hullWhite);
        box(hx * 2, 0.08, 0.24, cx, 0.62, s * (HALF_W - 0.08), blue);
      }
    }
    add(0.08, 0.3, HALF_W, -HALF_L + 0.08, 0.3, 0);
    box(0.16, 0.6, HALF_W * 2, -HALF_L + 0.08, 0.3, 0, hullWhite);
    // faixa de perigo no chão perto das bordas
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([20, 1]) });
    for (const s of [-1, 1]) box(HALF_L * 2 - 0.4, 0.02, 0.25, 0, 0.012, s * (HALF_W - 0.35), stripes);

    // cabine do capitão (na popa; dá para subir no teto)
    add(2, 1.3, 2.4, -8, 1.3, 0);
    box(4, 2.6, 4.8, -8, 1.3, 0, hullWhite);
    box(4.4, 0.2, 5.2, -8, 2.7, 0, blue);
    for (const z of [-2.41, 2.41]) box(2.6, 0.8, 0.04, -7.8, 1.8, z, this.material(0x9fc6e0, { roughness: 0.1, metalness: 0.4 }));
    box(0.04, 0.8, 3, -5.99, 1.8, 0, this.material(0x9fc6e0, { roughness: 0.1, metalness: 0.4 }));
    // mastro com guindaste de rede (o mastro dá para agarrar)
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 7, 10), steel);
    mast.position.set(-2.5, 3.5, 0);
    g.add(mast);
    add(0.17, 3.5, 0.17, -2.5, 3.5, 0);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 8), steel);
    boom.rotation.z = Math.PI / 2 - 0.35;
    boom.position.set(0.3, 5.2, 0);
    g.add(boom);
    // rede pendurada (enfeite) e bóias
    const net = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3d5a40, wireframe: true }));
    net.scale.set(1, 1.3, 1);
    net.position.set(3, 3.3, 0);
    g.add(net);
    for (const [x, z] of [
      [-5, HALF_W + 0.05],
      [5.5, -HALF_W - 0.05],
    ]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.12, 8, 18), this.material(0xff6b35));
      ring.position.set(x, -0.6, z);
      g.add(ring);
    }
    // contêineres e caixas de peixe (dá para subir)
    const cont = this.material(0x2a9d8f, { roughness: 0.7, metalness: 0.3 });
    add(1.5, 1.2, 1.2, 3, 1.2, -2);
    box(3, 2.4, 2.4, 3, 1.2, -2, cont);
    add(1.2, 0.6, 1, 7, 0.6, 1.8);
    box(2.4, 1.2, 2, 7, 0.6, 1.8, this.material(0xe9c46a, { roughness: 0.8 }));
    // tampa do porão (pintada)
    box(3, 0.05, 2.4, -2.5, 0.03, 2, this.material(0x264653));
    // chaminé da cabine
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 1.4, 12), this.material(0x222222));
    stack.position.set(-9.2, 3.5, 1.4);
    g.add(stack);

    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.ctx.root.add(g);
    this.ctx.links.add(this.boat, g);

    // ---------------- tubarão (cinemático; dá para agarrar e socar)
    this.sharkMesh = this.makeShark();
    this.shark = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -30, 0));
    const sc = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.75 * SHARK_SCALE, 0.42 * SHARK_SCALE)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2))
        .setCollisionGroups(groups(G_WORLD, G_ALL))
        .setFriction(0.4),
      this.shark,
    );
    this.ctx.physics.register(sc, { kind: 'static', grabbable: true });
    this.ctx.root.add(this.sharkMesh);
    this.ctx.links.add(this.shark, this.sharkMesh);
    // barbatana que aparece rondando antes do ataque
    this.fin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 4), this.material(0x5f6b78, { roughness: 0.5 }));
    this.fin.scale.set(0.35, 1, 1);
    this.fin.position.set(0, -30, 0);
    this.deco(this.fin, false);

    // barcos e boias lá longe
    for (let i = 0; i < 5; i++) {
      const far = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 4), this.material(0x6b7480));
      const top = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), this.material(0xe0e0e0));
      top.position.set(-3, 3, 0);
      far.add(hull, top);
      far.position.set(-90 + i * 45, WATER_Y, -60 - Math.random() * 30);
      this.deco(far, false);
    }

    this.prop('caixa', new THREE.Vector3(-3.5, 0.5, -2), 0x9c6b3a);
    this.prop('barril', new THREE.Vector3(5, 0.5, 2), 0xd95f2b);
    this.prop('caixa', new THREE.Vector3(9, 0.5, -1.5), 0x9c6b3a);

    this.spawns = [new THREE.Vector3(-4.5, 0.1, 1.8), new THREE.Vector3(5, 0.1, -0.5), new THREE.Vector3(0, 0.1, 2), new THREE.Vector3(8.5, 0.1, 0.8)];
  }

  private makeShark() {
    const g = new THREE.Group();
    const gray = this.material(0x6c7a88, { roughness: 0.45 });
    const belly = this.material(0xe9edf0, { roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), gray);
    body.scale.set(2.3, 0.85, 0.8);
    g.add(body);
    const under = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), belly);
    under.scale.set(2.1, 0.6, 0.72);
    under.position.y = -0.15;
    g.add(under);
    // nadadeira de cima, laterais e rabo
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 4), gray);
    dorsal.scale.set(0.35, 1, 1);
    dorsal.position.set(-0.1, 0.65, 0);
    dorsal.rotation.z = 0.35;
    g.add(dorsal);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 4), gray);
      side.scale.set(0.3, 1, 1);
      side.position.set(0.25, -0.3, s * 0.45);
      side.rotation.set(s * 1.1, 0, 0.6);
      g.add(side);
    }
    const tail = new THREE.Group();
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 4), gray);
      t.scale.set(0.35, 1, 1);
      t.position.set(-0.15, s * 0.32, 0);
      t.rotation.z = s * 0.7 + Math.PI / 2;
      tail.add(t);
    }
    tail.position.x = -1.35;
    g.add(tail);
    // boca (mandíbula de baixo abre e fecha) com dentinhos
    const jaw = new THREE.Group();
    const jawMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.5), this.material(0xb84a5a));
    jawMesh.position.set(0.3, 0, 0);
    jaw.add(jawMesh);
    const tooth = new THREE.ConeGeometry(0.04, 0.12, 4);
    const white = this.material(0xffffff, { roughness: 0.3 });
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) {
        const t = new THREE.Mesh(tooth, white);
        t.position.set(0.1 + i * 0.08, 0.1, s * 0.2);
        jaw.add(t);
        const t2 = new THREE.Mesh(tooth, white);
        t2.position.set(0.1 + i * 0.08, 0.22, s * 0.2);
        t2.rotation.x = Math.PI;
        g.add(t2);
        t2.position.x += 0.85;
      }
    }
    jaw.position.set(0.85, -0.12, 0);
    g.add(jaw);
    this.jaw = jaw;
    // olhinhos
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), this.material(0x111111));
      eye.position.set(0.95, 0.12, s * 0.3);
      g.add(eye);
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // tubarão grandão (o desenho todo cresce junto)
    const big = new THREE.Group();
    g.scale.setScalar(SHARK_SCALE);
    big.add(g);
    return big;
  }

  /** Ponto do convés (coordenadas do barco) levado para o mundo. */
  private deckWorld(x: number, z: number, y = 0) {
    return new THREE.Vector3(x, y, z).applyQuaternion(this.boatQuat).add(this.boatPos);
  }

  /** Converte um ponto do mundo para as coordenadas do barco. */
  private toBoat(p: THREE.Vector3) {
    return p.clone().sub(this.boatPos).applyQuaternion(this.boatQuat.clone().invert());
  }

  /**
   * A mordida: puxa o peito (e um pouco o quadril e a cabeça) da vítima
   * para a boca do tubarão, com velocidade limitada (sem trancos).
   */
  private holdVictim(dt: number) {
    const v = this.victim;
    if (!v || v.removed || !v.alive) return;
    const mouth = this.mouthWorld();
    for (const [n, dy, k] of [
      ['chest', 0, 1],
      ['pelvis', -0.35, 0.5],
      ['head', 0.45, 0.4],
    ] as const) {
      const b = v.part(n);
      const p = b.translation();
      const want = new THREE.Vector3(mouth.x - p.x, mouth.y + dy - p.y, mouth.z - p.z).multiplyScalar(9);
      // anda junto com o tubarão + corrige a distância (no máximo 7 m/s)
      if (want.length() > 7) want.setLength(7);
      want.add(this.sharkVel);
      const cur = b.linvel();
      const a = Math.min(1, 14 * dt) * k;
      b.setLinvel({ x: cur.x + (want.x - cur.x) * a, y: cur.y + (want.y - cur.y) * a, z: cur.z + (want.z - cur.z) * a }, true);
    }
  }

  private releaseBite(cd = 0) {
    // ao soltar, a vítima não sai voando: corta a velocidade dela
    const v = this.victim;
    if (v && !v.removed) {
      for (const b of v.ragdoll.bodies()) {
        const lv = b.linvel();
        const sp = Math.hypot(lv.x, lv.y, lv.z);
        if (sp > 5) b.setLinvel({ x: (lv.x / sp) * 5, y: (lv.y / sp) * 5, z: (lv.z / sp) * 5 }, true);
      }
    }
    if (this.victim) this.victim.seizedBy = null;
    this.victim = null;
    this.presses = 0;
    void cd;
  }

  private setState(s: SharkState) {
    this.state = s;
    this.stateT = 0;
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.clock += dt;
    const t = this.clock;
    this.seaMat.uniforms.t.value = time;

    // ----- o barco balança (e às vezes vem uma onda grande)
    this.waveTimer -= dt;
    if (this.waveTimer <= 0 && this.waveT <= 0) {
      this.waveT = 4;
      this.waveTimer = 20 + Math.random() * 8;
      arena.announce('🌊 ONDA GRANDE! Segure-se!', 'tip');
      arena.sound('splash', 1, 0.6);
    }
    this.waveT -= dt;
    const big = this.waveT > 0 ? Math.sin((1 - this.waveT / 4) * Math.PI) : 0;
    const ramp = Math.min(1, t / 3);
    const roll = ramp * (Math.sin(t * 0.7) * 0.07 + Math.sin(t * 1.9) * 0.015 + big * 0.14 * Math.sin(t * 2.2));
    const pitch = ramp * Math.sin(t * 0.5 + 1) * 0.03;
    this.boatPos.set(0, ramp * Math.sin(t * 0.9) * 0.15, 0);
    this.boatQuat.setFromEuler(new THREE.Euler(roll, 0, pitch));
    this.boat.setNextKinematicTranslation(this.boatPos);
    this.boat.setNextKinematicRotation(this.boatQuat);

    this.updateShark(dt, time, arena);
  }

  private updateShark(dt: number, time: number, arena: ArenaApi) {
    this.stateT += dt;
    const st = this.state;
    // a vítima saiu do jogo: larga
    if (this.victim && (this.victim.removed || !this.victim.alive)) this.releaseBite();

    if (st === 'wait') {
      this.sharkPos.set(0, -30, 0);
      this.fin.position.y = -30;
      this.waitTimer -= dt;
      if (this.waitTimer <= 0 && arena.fighters.some((f) => f.alive && !f.removed)) {
        this.side = Math.random() < 0.5 ? 1 : -1;
        this.setState('warn');
        arena.announce('🦈 BARBATANA À VISTA! Cuidado com a borda!', 'tip');
        arena.sound('horn', 0.5, 0.5);
      }
    } else if (st === 'warn') {
      // barbatana rondando o lado escolhido
      const a = this.stateT * 1.6;
      this.fin.position.set(Math.sin(a) * 7, WATER_Y + 0.35, this.side * (HALF_W + 2.5 + Math.cos(a) * 0.8));
      this.fin.rotation.y = -a;
      if (this.stateT > 2.4) {
        // escolhe a vítima: quem estiver mais perto daquele lado
        let best: Fighter | null = null;
        let bd = Infinity;
        for (const f of arena.fighters) {
          if (!f.alive || f.removed) continue;
          const lp = this.toBoat(f.pos('chest'));
          const d = (HALF_W - lp.z * this.side) + Math.abs(lp.x - this.fin.position.x) * 0.3;
          if (d < bd) {
            bd = d;
            best = f;
          }
        }
        if (!best) {
          this.setState('wait');
          this.waitTimer = 5;
          return;
        }
        this.prey = best;
        const lp = this.toBoat(best.pos('pelvis'));
        const landX = THREE.MathUtils.clamp(lp.x, -HALF_L + 1, HALF_L - 0.5);
        const landZ = THREE.MathUtils.clamp(lp.z, -HALF_W + 1, HALF_W - 1);
        // pousa um pouco antes da vítima, para a boca cair bem em cima dela
        this.leapFrom.set(landX, WATER_Y - 0.8, this.side * (HALF_W + 3.5));
        this.leapTo.copy(this.deckWorld(landX, landZ + this.side * 1.4, 0.6));
        this.fin.position.y = -30;
        this.setState('leap');
        arena.sound('splash', 1, 0.8);
        arena.effects.splash(new THREE.Vector3(landX, WATER_Y + 0.2, this.side * (HALF_W + 3)), 0xdff3ff, 30);
      }
    } else if (st === 'leap') {
      const k = Math.min(1, this.stateT / 0.95);
      // no começo do pulo ainda corrige a mira (persegue a presa)
      const pr = this.prey;
      if (pr && k < 0.75 && pr.alive && !pr.removed) {
        const lp = this.toBoat(pr.pos('pelvis'));
        const want = this.deckWorld(THREE.MathUtils.clamp(lp.x, -HALF_L + 1, HALF_L - 0.5), THREE.MathUtils.clamp(lp.z, -HALF_W + 1, HALF_W - 1) + this.side * 1.4, 0.6);
        this.leapTo.lerp(want, Math.min(1, dt * 4));
      }
      const p = this.leapFrom.clone().lerp(this.leapTo, k);
      p.y += Math.sin(k * Math.PI) * 3.2;
      const prev = this.sharkPos.clone();
      this.sharkPos.copy(p);
      const v = this.sharkPos.clone().sub(prev);
      this.sharkYaw = Math.atan2(-v.z, v.x);
      this.sharkPitch = Math.atan2(v.y, Math.hypot(v.x, v.z) + 1e-4);
      this.jaw.rotation.z = -0.6; // boca aberta
      if (k >= 1) {
        arena.shake(0.35);
        arena.sound('heavy', 1, 0.7);
        arena.effects.splash(this.sharkPos.clone(), 0xdff3ff, 20);
        // morde quem estiver perto da boca
        const mouth = this.mouthWorld();
        let prey: Fighter | null = null;
        let pd = 2.1;
        for (const f of arena.fighters) {
          if (!f.alive || f.removed) continue;
          const d = Math.min(f.pos('chest').distanceTo(mouth), f.pos('pelvis').distanceTo(mouth), f.pos('chest').distanceTo(this.sharkPos));
          if (d < pd) {
            pd = d;
            prey = f;
          }
        }
        if (prey) this.grab(prey, arena);
        else {
          arena.effects.text(this.sharkPos.clone().add(new THREE.Vector3(0, 1.2, 0)), 'ERROU!');
          this.setState('flop');
        }
      }
    } else if (st === 'drag' || st === 'flop') {
      // arrasta-se até a borda do seu lado (a vítima vem junto)
      const lp = this.toBoat(this.sharkPos);
      const speed = st === 'drag' ? 1.5 : 2.2;
      const wait = st === 'flop' ? 1.2 : 0.5;
      if (this.stateT > wait) lp.z += this.side * speed * dt;
      // perto da amurada levanta para passar por cima (puxando a vítima)
      const edge = Math.abs(lp.z) - (HALF_W - 1.6);
      const lift = THREE.MathUtils.clamp(edge, 0, 1.4) * 0.9;
      const world = this.deckWorld(lp.x, lp.z, 0.6 + lift);
      this.sharkPos.copy(world);
      this.sharkYaw = this.side > 0 ? -Math.PI / 2 : Math.PI / 2; // de cara para o mar
      this.sharkPitch = 0.15 * Math.sin(time * 12); // se debatendo
      this.jaw.rotation.z = st === 'drag' ? -0.1 : -0.4 + Math.sin(time * 14) * 0.3;
      if (Math.abs(lp.z) > HALF_W + 0.9) this.setState('dive');
      if (st === 'drag') this.struggle(dt, arena);
    } else if (st === 'dive') {
      // mergulha levando quem estiver na boca
      this.sharkPos.z += this.side * 2.2 * dt;
      this.sharkPos.y -= 4 * dt;
      this.sharkPitch = -0.9;
      if (this.sharkPos.y < WATER_Y + 0.2 && this.stateT < 0.3) arena.effects.splash(this.sharkPos.clone(), 0xdff3ff, 25);
      if (this.sharkPos.y < WATER_Y - 2.5) {
        this.releaseBite();
        this.setState('wait');
        this.waitTimer = 9 + Math.random() * 6;
        this.hp = SHARK_HP;
      }
      if (this.victim) this.struggle(dt, arena);
    }

    // pancadas no tubarão (quando ele está no barco)
    if (st === 'drag' || st === 'flop' || st === 'leap') this.checkHits(dt, arena);

    // velocidade do tubarão (para a vítima ir junto) e a mordida
    this.sharkVel.copy(this.sharkPos).sub(this.lastSharkPos).divideScalar(Math.max(dt, 1e-4));
    if (this.sharkVel.length() > 15) this.sharkVel.set(0, 0, 0); // teleporte (sumiu na água)
    this.lastSharkPos.copy(this.sharkPos);
    if (this.victim && (this.state === 'drag' || this.state === 'dive')) this.holdVictim(dt);
    this.shark.setNextKinematicTranslation(this.sharkPos);
    this.shark.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.sharkYaw, this.sharkPitch, 'YXZ')));
  }

  private mouthWorld() {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.sharkYaw, this.sharkPitch, 'YXZ'));
    return MOUTH.clone().applyQuaternion(q).add(this.sharkPos);
  }

  private grab(prey: Fighter, arena: ArenaApi) {
    this.victim = prey;
    prey.seizedBy = 'tubarão';
    prey.lastAttacker = null;
    prey.hands.L.release(0.3);
    prey.hands.R.release(0.3);
    this.presses = 0;
    this.hp = SHARK_HP;
    prey.addDizzy(12);
    arena.effects.text(prey.pos('head').add(new THREE.Vector3(0, 1, 0)), 'NHAC!', 'big');
    arena.announce(`🦈 O tubarão pegou ${prey.name}! Aperte botões ou soquem o tubarão!`, 'out');
    arena.sound('crack', 1, 0.6);
    prey.source.rumble?.(1, 1, 400);
    this.setState('drag');
  }

  /** A vítima se debate: apertar botões rápido solta a mordida. */
  private struggle(_dt: number, arena: ArenaApi) {
    const v = this.victim;
    if (!v) return;
    const i = v.input;
    const p = v.prev;
    if ((i.jump && !p.jump) || (i.punchL && !p.punchL) || (i.punchR && !p.punchR)) this.presses++;
    if (this.presses >= ESCAPE_PRESSES && this.state === 'drag') {
      const name = v.name;
      const pos = v.pos('head');
      this.releaseBite();
      arena.effects.text(pos.add(new THREE.Vector3(0, 0.8, 0)), 'ESCAPOU!', 'big');
      arena.sound('escape', 0.9);
      arena.announce(`${name} escapou do tubarão!`, 'tip');
      this.setState('flop');
    }
  }

  /** Socos, cabeçadas e voadoras no tubarão: com 3 ele solta e foge. */
  private checkHits(dt: number, arena: ArenaApi) {
    for (const f of arena.fighters) {
      if (!f.alive || f.removed) continue;
      const cd = (this.hitCd.get(f) ?? 0) - dt;
      this.hitCd.set(f, cd);
      if (cd > 0) continue;
      let hitAt: THREE.Vector3 | null = null;
      for (const [a, side] of [
        [f.punchL, 'L'],
        [f.punchR, 'R'],
      ] as const) {
        if (a.t >= 0.08 && a.t < 0.28) {
          const h = f.hands[side].position();
          if (h.distanceTo(this.sharkPos) < 1.7) hitAt = h;
        }
      }
      if (f.headbutt.t >= 0.1 && f.headbutt.t < 0.32 && f.pos('head').distanceTo(this.sharkPos) < 1.3) hitAt = f.pos('head');
      if (f.kick.t >= 0.06 && f.kick.t < 0.5 && f.pos('pelvis').distanceTo(this.sharkPos) < 1.5) hitAt = f.pos('pelvis');
      if (!hitAt) continue;
      this.hitCd.set(f, 0.35);
      this.hp--;
      arena.effects.sparks(hitAt, 0xffffff, 10, 6);
      arena.sound('punch', 1, 0.8);
      arena.shake(0.15);
      if (this.hp <= 0) {
        arena.effects.text(this.sharkPos.clone().add(new THREE.Vector3(0, 1.3, 0)), 'TOMA, TUBARÃO!', 'big');
        if (this.victim) arena.announce(`${f.name} salvou ${this.victim.name} do tubarão!`, 'tip');
        this.releaseBite();
        this.setState('flop');
        this.stateT = 1.2; // foge na hora
        return;
      }
      arena.effects.text(hitAt.clone().add(new THREE.Vector3(0, 0.6, 0)), this.hp === 1 ? 'MAIS UM!' : 'POW!');
    }
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    const lp = this.toBoat(p);
    return this.deckWorld(THREE.MathUtils.clamp(lp.x, -7, 9), 0, 0);
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // barbatana rondando: sai da borda daquele lado
    if (this.state !== 'warn' || p.y < -1) return null;
    const lp = this.toBoat(p);
    if (lp.z * this.side < 0.5) return null;
    return this.deckWorld(THREE.MathUtils.clamp(lp.x, -7, 9), -this.side * 2, 0);
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < WATER_Y + 0.3) return 'water';
    return p.y < this.killY ? 'fall' : 'none';
  }
}
