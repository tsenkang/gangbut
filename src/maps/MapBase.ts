import * as THREE from 'three';
import { RAPIER, Physics, G_PROP, G_WORLD, G_ALL, groups } from '../physics/Physics';
import { LinkSet } from '../physics/BodyLink';
import type { CameraSetup } from '../game/CameraRig';
import type { Fighter, HitKind } from '../characters/Fighter';
import type { Effects } from '../game/Effects';
import type { MusicThemeId } from '../audio/Music';

// ------------------------------------------------------------
// Base para todos os mapas. Para criar um mapa novo:
//   1) crie um arquivo em src/maps/ com uma classe que estende GameMap
//   2) preencha build() (cenário) e update() (perigos)
//   3) registre a classe em src/maps/index.ts
// ------------------------------------------------------------

/** O que os perigos do mapa podem fazer com o jogo. */
export interface ArenaApi {
  fighters: Fighter[];
  effects: Effects;
  time: number;
  shake(amount: number): void;
  hitstop(seconds: number): void;
  sound(name: string, volume?: number, pitch?: number): void;
  hazardHit(victim: Fighter, power: number, dir: THREE.Vector3, knockSpeed: number, label?: string): void;
  announce(text: string, cls?: string): void;
  removeBody(body: RAPIER.RigidBody): void;
}

export interface Prop {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  kind: 'caixa' | 'barril' | 'bola' | 'cone';
}

export interface MapContext {
  root: THREE.Group;
  physics: Physics;
  links: LinkSet;
  props: Prop[];
  shadowSize: number;
}

export interface Lighting {
  skyTop: number;
  skyBottom: number;
  fog?: { color: number; near: number; far: number };
  sunColor: number;
  sunIntensity: number;
  sunPos: THREE.Vector3;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  shadowExtent?: number;
}

export type DeathKind = 'fall' | 'lava' | 'water' | 'left' | 'train' | 'grind' | 'none';

export abstract class GameMap {
  abstract id: string;
  abstract name: string;
  abstract description: string;
  abstract hazard: string;
  abstract emoji: string;
  abstract music: MusicThemeId;
  abstract camera: CameraSetup;
  /** Abaixo desta altura, o lutador está fora. */
  killY = -12;
  spawns: THREE.Vector3[] = [];
  spawnYaw = 0;
  /** Os robôs podem pular vãos curtos para alcançar o alvo? */
  botLeaps = true;
  ctx!: MapContext;

  abstract build(): void;
  update(_dt: number, _time: number, _arena: ArenaApi): void {}

  /** Este ponto mata na hora? (lava, água, ficou para trás no trem...) */
  /**
   * Dica de perigo para os robôs: se houver um lugar seguro para onde
   * correr agora (fugir do túnel, da prensa...), devolve esse ponto.
   */
  botAdvice(_p: THREE.Vector3): THREE.Vector3 | null {
    return null;
  }

  /**
   * Para onde o robô corre quando se assusta com a beirada: um lugar
   * firme perto dele. O padrão é o meio do mapa; mapas com buraco no
   * meio (ou chão que anda) devolvem o lugar seguro mais próximo.
   */
  safeSpot(_p: THREE.Vector3): THREE.Vector3 {
    return this.camera.center;
  }

  /**
   * Onde o robô que está carregando alguém deve jogá-lo (ex.: o poço
   * aberto do incinerador). null = leva até a beirada mais perto.
   */
  dumpSpot(_p: THREE.Vector3): THREE.Vector3 | null {
    return null;
  }

  /** Perigos que tiram alguém do jogo direto (ex.: atropelado pelo trem). */
  deathOf(_f: Fighter): DeathKind {
    return 'none';
  }

  deathAt(p: THREE.Vector3): DeathKind {
    return p.y < this.killY ? 'fall' : 'none';
  }

  init(ctx: MapContext) {
    this.ctx = ctx;
    this.build();
  }

  // ------------------------------------------------ ajudantes

  material(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts });
  }

  /** Caixa visível + colisor fixo. size = tamanho total. */
  box(
    pos: THREE.Vector3Like,
    size: THREE.Vector3Like,
    mat: THREE.Material | number,
    opts: { rot?: THREE.Euler; grabbable?: boolean; friction?: number; restitution?: number; collide?: boolean; shadow?: boolean } = {},
  ) {
    const material = typeof mat === 'number' ? this.material(mat) : mat;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.set(pos.x, pos.y, pos.z);
    if (opts.rot) mesh.rotation.copy(opts.rot);
    mesh.castShadow = opts.shadow ?? true;
    mesh.receiveShadow = true;
    this.ctx.root.add(mesh);
    let body: RAPIER.RigidBody | undefined;
    if (opts.collide !== false) {
      const r = this.ctx.physics.addStaticBox(pos, { x: size.x / 2, y: size.y / 2, z: size.z / 2 }, {
        rot: opts.rot ? new THREE.Quaternion().setFromEuler(opts.rot) : undefined,
        grabbable: opts.grabbable,
        friction: opts.friction,
        restitution: opts.restitution,
      });
      body = r.body;
    }
    return { mesh, body };
  }

  /** Só desenho, sem colisão. */
  deco(obj: THREE.Object3D, shadow = true) {
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = shadow;
        o.receiveShadow = true;
      }
    });
    this.ctx.root.add(obj);
    return obj;
  }

  /** Corpo cinemático (move por código: prensa, ringue...). */
  kinematic(pos: THREE.Vector3, shape: RAPIER.ColliderDesc, mesh: THREE.Object3D, opts: { friction?: number; restitution?: number; grabbable?: boolean } = {}) {
    const body = this.ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
    const col = this.ctx.physics.world.createCollider(
      shape
        .setFriction(opts.friction ?? 0.9)
        .setRestitution(opts.restitution ?? 0.05)
        .setCollisionGroups(groups(G_WORLD, G_ALL)),
      body,
    );
    this.ctx.physics.register(col, { kind: 'static', grabbable: opts.grabbable ?? true });
    mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.ctx.root.add(mesh);
    this.ctx.links.add(body, mesh);
    return body;
  }

  /** Peça solta que dá para agarrar e jogar. */
  prop(kind: Prop['kind'], pos: THREE.Vector3, color?: number) {
    const ctx = this.ctx;
    let desc: RAPIER.ColliderDesc;
    let mesh: THREE.Object3D;
    if (kind === 'caixa') {
      desc = RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4).setMass(5);
      const g = new THREE.Group();
      const wood = this.material(color ?? 0xc68642, { roughness: 0.9 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), wood));
      const plank = this.material(new THREE.Color(color ?? 0xc68642).multiplyScalar(0.7).getHex());
      for (const s of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.12, 0.84), plank);
        b.position.y = s * 0.3;
        g.add(b);
      }
      mesh = g;
    } else if (kind === 'barril') {
      desc = RAPIER.ColliderDesc.cylinder(0.45, 0.35).setMass(7);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 18), this.material(color ?? 0x2b7bb9, { roughness: 0.5, metalness: 0.3 })));
      for (const y of [-0.3, 0.3]) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.355, 0.03, 6, 20), this.material(0x333333, { metalness: 0.6, roughness: 0.4 }));
        r.rotation.x = Math.PI / 2;
        r.position.y = y;
        g.add(r);
      }
      mesh = g;
    } else if (kind === 'cone') {
      // cone de trânsito (leve: bom de arremessar)
      desc = RAPIER.ColliderDesc.cone(0.38, 0.28).setMass(1.2);
      const g = new THREE.Group();
      const orange = this.material(color ?? 0xff6b1a, { roughness: 0.6 });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.76, 16), orange);
      g.add(cone);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.12, 16), this.material(0xffffff));
      band.position.y = 0.05;
      g.add(band);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.62), orange);
      base.position.y = -0.38;
      g.add(base);
      mesh = g;
    } else {
      desc = RAPIER.ColliderDesc.ball(0.45).setMass(2).setRestitution(0.7);
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), this.material(color ?? 0xff4fa3, { roughness: 0.3 }));
    }
    const body = ctx.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.1).setAngularDamping(0.4),
    );
    const col = ctx.physics.world.createCollider(desc.setFriction(0.7).setCollisionGroups(groups(G_PROP, G_ALL)), body);
    ctx.physics.register(col, { kind: 'prop', grabbable: true });
    mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    ctx.root.add(mesh);
    ctx.links.add(body, mesh);
    const p: Prop = { body, mesh, kind };
    ctx.props.push(p);
    return p;
  }

  /** Céu em degradê + luzes + sombras + neblina. */
  lights(L: Lighting) {
    const root = this.ctx.root;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color(L.skyTop) }, bottom: { value: new THREE.Color(L.skyBottom) } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
          void main(){ float t = smoothstep(-0.2, 0.7, vP.y); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }`,
      }),
    );
    sky.renderOrder = -1;
    root.add(sky);

    const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity);
    root.add(hemi);
    const sun = new THREE.DirectionalLight(L.sunColor, L.sunIntensity);
    sun.position.copy(L.sunPos);
    sun.castShadow = true;
    const e = L.shadowExtent ?? 16;
    sun.shadow.camera.left = -e;
    sun.shadow.camera.right = e;
    sun.shadow.camera.top = e;
    sun.shadow.camera.bottom = -e;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.mapSize.set(this.ctx.shadowSize, this.ctx.shadowSize);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 4;
    root.add(sun);
    root.add(sun.target);
    if (L.fog) {
      // A neblina fica guardada no root e a Arena aplica na cena.
      root.userData.fog = new THREE.Fog(L.fog.color, L.fog.near, L.fog.far);
    }
    return { sun, hemi };
  }

  dispose() {
    this.ctx.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
    });
  }
}

export type { HitKind };

/** Textura de canvas (para janelas de prédio, listras de aviso...). */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** Listras amarelas e pretas de "perigo". */
export function hazardStripes(repeat: [number, number] = [4, 1]) {
  return canvasTexture(
    128,
    32,
    (g) => {
      g.fillStyle = '#ffcc00';
      g.fillRect(0, 0, 128, 32);
      g.fillStyle = '#1b1b1b';
      for (let x = -32; x < 160; x += 32) {
        g.beginPath();
        g.moveTo(x, 32);
        g.lineTo(x + 16, 32);
        g.lineTo(x + 32, 0);
        g.lineTo(x + 16, 0);
        g.fill();
      }
    },
    repeat,
  );
}
