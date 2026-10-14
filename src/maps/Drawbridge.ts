import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER, G_WORLD, G_ALL, groups } from '../physics/Physics';
import { cityBackdrop, grimeTexture, hazeBelow } from './City';

// ------------------------------------------------------------
// Mapa 15 — PONTE LEVADIÇA
// Uma ponte velha sobre o rio da cidade. De tempos em tempos toca a
// sirene e as duas metades do meio SOBEM para um navio passar: todo
// mundo escorrega para o vão. Dá para se segurar nos postes e na
// borda da ponte... ou correr para as cabeceiras.
// ------------------------------------------------------------

const RIVER_Y = -7;
const LEAF = 8; // comprimento de cada metade que sobe
const HALF_W = 3.4; // meia largura da ponte
const PIVOT_X = LEAF; // as metades giram presas em x = ±8
const END = 7; // comprimento das cabeceiras fixas
const MAX_ANGLE = 0.62;

export class Drawbridge extends GameMap {
  id = 'ponte';
  name = 'Ponte Levadiça';
  emoji = '🌉';
  description = 'Uma ponte velha que se abre no meio para os navios passarem.';
  hazard = 'Quando a sirene tocar, a ponte sobe e todo mundo escorrega para o vão. Segure firme!';
  music = 'trem' as const;
  killY = -12;
  camera = {
    dir: new THREE.Vector3(0, 0.62, 1),
    minDist: 15,
    maxDist: 31,
    fov: 44,
    center: new THREE.Vector3(0, 0.8, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-12, -1, -2), new THREE.Vector3(12, 5, 2)),
  };

  private leaves: { body: RAPIER.RigidBody; s: number }[] = [];
  private angle = 0;
  private phase: 'closed' | 'warn' | 'open' | 'closing' = 'closed';
  private phaseT = 0;
  private timer = 14;
  private riverMat!: THREE.ShaderMaterial;
  private ship!: THREE.Group;
  private warnLights: THREE.MeshBasicMaterial[] = [];
  private blink: THREE.Mesh[] = [];

  build() {
    this.lights({
      // fim de tarde enevoado sobre o rio
      skyTop: 0x3c4f72,
      skyBottom: 0xe8a984,
      fog: { color: 0xa79a9e, near: 30, far: 120 },
      sunColor: 0xffd9b0,
      sunIntensity: 2.2,
      sunPos: new THREE.Vector3(-14, 20, 12),
      hemiSky: 0xcbd6ea,
      hemiGround: 0x4b4440,
      hemiIntensity: 1.3,
      shadowExtent: 20,
    });

    // ---------------- rio
    this.riverMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      fog: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float t; varying vec2 vUv;
        float n(vec2 p){ return sin(p.x)*sin(p.y); }
        void main(){ vec2 p = vUv * vec2(60.0, 300.0);
          // ondinhas em várias escalas (nada de manchas grandes)
          float w = n(p*0.9 + vec2(t*0.7, -t*1.4)) * 0.5 + n(p*2.1 + vec2(-t*1.1, t*0.9)) * 0.3 + n(p*4.3 + vec2(t*1.8, t*1.3)) * 0.2;
          vec3 deep = vec3(0.13,0.22,0.27), lite = vec3(0.24,0.36,0.40);
          vec3 c = mix(deep, lite, smoothstep(-0.6, 0.6, w));
          // brilhos do céu nas cristas
          c += vec3(0.9,0.75,0.6) * smoothstep(0.62, 0.8, w) * 0.35;
          // margem mais clara perto das bordas
          float d = abs(vUv.x - 0.5) * 2.0; c = mix(c, vec3(0.42,0.40,0.38), smoothstep(0.82, 1.0, d));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const river = new THREE.Mesh(new THREE.PlaneGeometry(60, 300), this.riverMat);
    river.rotation.x = -Math.PI / 2;
    river.position.y = RIVER_Y;
    this.deco(river, false);

    // ---------------- cabeceiras fixas (com torres de pedra)
    const asphalt = new THREE.MeshStandardMaterial({ map: grimeTexture('#4f5054', [4, 2], { cracks: true }), roughness: 0.95 });
    const stone = new THREE.MeshStandardMaterial({ map: grimeTexture('#8c8275', [2, 4], { tiles: 6, dark: 'rgba(0,0,0,0.25)' }), roughness: 1 });
    const iron = this.material(0x2f5d50, { roughness: 0.5, metalness: 0.5 });
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([6, 1]) });
    for (const s of [-1, 1]) {
      const x = s * (PIVOT_X + END / 2);
      this.box({ x, y: -0.4, z: 0 }, { x: END, y: 0.8, z: HALF_W * 2 }, asphalt);
      this.box({ x: s * (PIVOT_X + 0.1), y: 0.01, z: 0 }, { x: 0.2, y: 0.02, z: HALF_W * 2 }, stripes, { collide: false, shadow: false });
      // pilar de pedra até o rio
      this.box({ x, y: RIVER_Y / 2 - 0.5, z: 0 }, { x: END - 1, y: -RIVER_Y, z: HALF_W * 2 + 1 }, stone, { collide: false });
      // casinhas do operador nos cantos (dá para subir)
      for (const z of [-1, 1]) {
        this.box({ x: s * (PIVOT_X + 2.2), y: 1.4, z: z * (HALF_W - 0.9) }, { x: 1.8, y: 2.8, z: 1.6 }, stone);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.2, 4), this.material(0x3c5a7a));
        roof.rotation.y = Math.PI / 4;
        roof.position.set(s * (PIVOT_X + 2.2), 3.4, z * (HALF_W - 0.9));
        this.deco(roof);
      }
      // grade baixa nas laterais das cabeceiras
      for (const z of [-HALF_W, HALF_W]) this.box({ x: s * (PIVOT_X + END / 2 + 1.2), y: 0.45, z }, { x: END - 2.4, y: 0.9, z: 0.12 }, iron);
    }

    // ---------------- as duas metades que sobem (cinemáticas, giram na ponta de fora)
    const world = this.ctx.physics.world;
    for (const s of [-1, 1]) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(s * PIVOT_X, 0, 0));
      const add = (hx: number, hy: number, hz: number, x: number, y: number, z: number) => {
        const c = world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.8).setRestitution(0.05).setCollisionGroups(groups(G_WORLD, G_ALL)),
          body,
        );
        this.ctx.physics.register(c, { kind: 'static', grabbable: true });
      };
      const g = new THREE.Group();
      const piece = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
        mesh.position.set(x, y, z);
        g.add(mesh);
      };
      // tabuleiro (vai de x = 0 até a ponta do meio)
      const cx = -s * LEAF / 2;
      add(LEAF / 2, 0.3, HALF_W, cx, -0.3, 0);
      piece(LEAF, 0.6, HALF_W * 2, cx, -0.3, 0, asphalt);
      // faixa do meio da pista e marca da emenda
      piece(LEAF, 0.02, 0.15, cx, 0.01, 0, this.material(0xf1d36b));
      piece(0.25, 0.02, HALF_W * 2, -s * (LEAF - 0.15), 0.012, 0, stripes);
      // grade de ferro nas laterais (dá para agarrar quando a ponte sobe)
      for (const z of [-HALF_W, HALF_W]) {
        add(LEAF / 2, 0.06, 0.06, cx, 1, z);
        piece(LEAF, 0.12, 0.12, cx, 1, z, iron);
        for (let k = 0; k <= 4; k++) piece(0.1, 1, 0.1, -s * (0.3 + k * ((LEAF - 0.6) / 4)), 0.5, z, iron);
      }
      // poste de luz no meio de cada metade (dá para se agarrar)
      add(0.1, 1.6, 0.1, cx, 1.6, -HALF_W + 0.35);
      piece(0.18, 3.2, 0.18, cx, 1.6, -HALF_W + 0.35, iron);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), lampMat);
      lamp.position.set(cx, 3.3, -HALF_W + 0.35);
      g.add(lamp);
      // luz vermelha de aviso na ponta
      const warn = new THREE.MeshBasicMaterial({ color: 0x441111, toneMapped: false });
      const wl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), warn);
      wl.position.set(-s * (LEAF - 0.3), 1.3, HALF_W);
      g.add(wl);
      this.warnLights.push(warn);
      // estrutura de ferro por baixo
      piece(LEAF, 0.8, 0.3, cx, -1, HALF_W - 0.4, iron);
      piece(LEAF, 0.8, 0.3, cx, -1, -HALF_W + 0.4, iron);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.ctx.root.add(g);
      this.ctx.links.add(body, g);
      this.leaves.push({ body, s });
    }

    // navio que passa quando a ponte abre
    this.ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 18), this.material(0x2b3a4a));
    hull.position.y = 1.5;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3, 4), this.material(0xe8e4dc));
    cabin.position.set(0, 4.5, -5);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 3, 12), this.material(0xc0392b));
    funnel.position.set(0, 7.3, -5);
    this.ship.add(hull, cabin, funnel);
    this.ship.position.set(0, RIVER_Y, -80);
    this.deco(this.ship, false);

    // margens (cais de pedra e rua) dos dois lados do rio
    const quay = new THREE.MeshStandardMaterial({ map: grimeTexture('#6b625c', [20, 2], { tiles: 4 }), roughness: 1 });
    for (const s of [-1, 1]) {
      this.box({ x: s * 60, y: RIVER_Y + 1.2, z: 0 }, { x: 60, y: 2.4, z: 300 }, quay, { collide: false, shadow: false });
    }

    // cidade dos dois lados do rio
    const city = cityBackdrop(this.ctx.root, { ground: false, below: 4.6, radius: [36, 100], count: 40, keepClear: (x) => Math.abs(x) < 36, walls: ['#5d5763', '#6b6370', '#4f5866', '#625b60'] });
    this.blink.push(...city.blink);
    hazeBelow(this.ctx.root, 0xb7a9aa, [[-20, 0.4]]);

    this.prop('caixa', new THREE.Vector3(-12, 0.5, 1.5));
    this.prop('barril', new THREE.Vector3(12, 0.5, -1.5), 0x2b5e8a);
    this.prop('caixa', new THREE.Vector3(-3, 0.5, -1.5), 0x9c6b3a);
    this.prop('barril', new THREE.Vector3(3.5, 0.5, 1.8), 0xd95f2b);

    this.spawns = [new THREE.Vector3(-5, 0.05, 1), new THREE.Vector3(5, 0.05, -1), new THREE.Vector3(-11.5, 0.05, -1), new THREE.Vector3(11.5, 0.05, 1)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.riverMat.uniforms.t.value = time;
    this.phaseT += dt;
    if (this.phase === 'closed') {
      this.timer -= dt;
      this.angle = Math.max(0, this.angle - dt * 0.4);
      if (this.timer <= 0) {
        this.phase = 'warn';
        this.phaseT = 0;
        arena.announce('🚢 Sirene! A PONTE VAI ABRIR! Corra para as pontas ou segure firme!', 'tip');
        arena.sound('horn', 1, 0.6);
        arena.sound('alarm', 0.6);
      }
    } else if (this.phase === 'warn') {
      if (this.phaseT > 3) {
        this.phase = 'open';
        this.phaseT = 0;
        this.ship.position.z = -70;
      }
    } else if (this.phase === 'open') {
      // sobe devagar (fica íngreme), espera o navio e desce
      this.angle = Math.min(MAX_ANGLE, this.angle + dt * 0.22);
      if (Math.random() < dt * 2) arena.sound('clank', 0.3, 0.6);
      this.ship.position.z += dt * 14;
      if (this.phaseT > 8) {
        this.phase = 'closing';
        this.phaseT = 0;
      }
    } else if (this.phase === 'closing') {
      this.angle = Math.max(0, this.angle - dt * 0.3);
      this.ship.position.z += dt * 14;
      if (this.angle <= 0) {
        this.phase = 'closed';
        this.timer = 16 + Math.random() * 8;
        arena.shake(0.2);
      }
    }
    for (const l of this.leaves) {
      l.body.setNextKinematicTranslation({ x: l.s * PIVOT_X, y: 0, z: 0 });
      // a metade da esquerda (s = -1) sobe girando no sentido anti-horário, a da direita no horário
      l.body.setNextKinematicRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), l.s * this.angle * -1));
    }
    // luzes de aviso piscando quando a ponte não está fechada
    const on = this.phase !== 'closed' && Math.sin(time * 10) > 0;
    for (const m of this.warnLights) m.color.setHex(on ? 0xff2a2a : 0x441111);
    const b = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = b;
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // sirene tocou: corre para a cabeceira mais perto
    if (this.phase === 'closed' || p.y < -1.5) return null;
    if (Math.abs(p.x) > PIVOT_X + 0.8) return null;
    return new THREE.Vector3(Math.sign(p.x || 1) * (PIVOT_X + 3), 0, THREE.MathUtils.clamp(p.z, -2, 2));
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    if (this.phase === 'closed') return new THREE.Vector3(THREE.MathUtils.clamp(p.x, -12, 12), 0, 0);
    return new THREE.Vector3(Math.sign(p.x || 1) * (PIVOT_X + 3), 0, 0);
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < RIVER_Y + 0.4) return 'water';
    return p.y < this.killY ? 'fall' : 'none';
  }
}
