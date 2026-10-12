import * as THREE from 'three';
import { GameMap, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER } from '../physics/Physics';

// ------------------------------------------------------------
// Mapa 5 — PONTE SOBRE LAVA
// Uma ponte de tábuas entre dois penhascos, em cima de um rio de
// lava. As tábuas tremem e caem uma a uma. Cordas dos lados servem
// para se pendurar. Caiu na lava? Virou churrasco.
// ------------------------------------------------------------

const PLANKS = 14;
const BRIDGE_X0 = -7;
const PLANK_W = 1;
const HALF_D = 1.5;
const LAVA_Y = -6;

interface Plank {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  state: 'ok' | 'shaking' | 'falling';
  t: number;
  base: THREE.Vector3;
}

export class LavaBridge extends GameMap {
  id = 'lava';
  name = 'Ponte sobre Lava';
  emoji = '🌋';
  description = 'Uma ponte velha de madeira sobre um rio de lava.';
  hazard = 'As tábuas tremem e caem! Segure nas cordas para não cair.';
  music = 'lava' as const;
  killY = -10;
  camera = {
    dir: new THREE.Vector3(0, 0.62, 1),
    minDist: 11,
    maxDist: 24,
    fov: 42,
    center: new THREE.Vector3(0, 0.4, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-9, -1, -1), new THREE.Vector3(9, 3, 1)),
  };

  private planks: Plank[] = [];
  private dropTimer = 4;
  private lavaMat!: THREE.ShaderMaterial;
  private emberT = 0;

  build() {
    this.lights({
      skyTop: 0x1a0a1e,
      skyBottom: 0xa8321c,
      fog: { color: 0x5a1a12, near: 25, far: 90 },
      sunColor: 0xffb27a,
      sunIntensity: 2,
      sunPos: new THREE.Vector3(-6, 18, 8),
      hemiSky: 0x8a5a7a,
      hemiGround: 0xff5a1a,
      hemiIntensity: 1.6,
      shadowExtent: 14,
    });
    // Luz quente vinda de baixo (da lava)
    const glow = new THREE.PointLight(0xff5a1a, 60, 30, 1.6);
    glow.position.set(0, -3, 2);
    this.ctx.root.add(glow);

    // Lava animada (shader simples)
    this.lavaMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      fog: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float t; varying vec2 vUv;
        float n(vec2 p){ return sin(p.x)*sin(p.y); }
        void main(){
          vec2 p = vUv * 40.0;
          float v = n(p + vec2(t*0.6, t*0.3)) + n(p*1.7 - vec2(t*0.4, -t*0.5)) * 0.6 + n(p*3.1 + t) * 0.3;
          v = v * 0.5 + 0.5;
          vec3 c = mix(vec3(0.55,0.05,0.0), vec3(1.0,0.55,0.05), smoothstep(0.35,0.85,v));
          c = mix(c, vec3(1.0,0.95,0.5), smoothstep(0.88,1.0,v));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), this.lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = LAVA_Y;
    this.deco(lava, false);

    // Penhascos (pedra)
    const rock = this.material(0x4a3b3b, { roughness: 1 });
    const rock2 = this.material(0x3a2d2d, { roughness: 1 });
    for (const s of [-1, 1]) {
      const x = s * 11;
      this.box({ x, y: -4, z: 0 }, { x: 8, y: 8, z: 7 }, rock);
      this.box({ x: x + s * 1.5, y: 0.6, z: -2.4 }, { x: 2.5, y: 1.2, z: 1.6 }, rock2);
      this.box({ x: x + s * 2.4, y: 1.4, z: 1.8 }, { x: 1.6, y: 2.8, z: 1.6 }, rock2);
      // pedrinhas de enfeite
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.4), rock2);
        b.position.set(x + (Math.random() - 0.5) * 6, 0.1, (Math.random() < 0.5 ? -1 : 1) * (2.6 + Math.random() * 0.7));
        this.deco(b);
      }
    }

    // Tábuas da ponte (cada uma é um corpo próprio, para poder cair)
    const wood = [0x8b5a2b, 0x9c6b3a, 0x7a4b22];
    for (let i = 0; i < PLANKS; i++) {
      const x = BRIDGE_X0 + PLANK_W * (i + 0.5);
      const { mesh, body } = this.box(
        { x, y: -0.15, z: 0 },
        { x: PLANK_W - 0.06, y: 0.3, z: HALF_D * 2 },
        this.material(wood[i % 3], { roughness: 0.9 }),
      );
      body!.collider(0).setMass(20);
      this.ctx.links.add(body!, mesh);
      this.planks.push({ body: body!, mesh, state: 'ok', t: 0, base: new THREE.Vector3(x, -0.15, 0) });
    }
    // Cordas dos lados (fixas nos penhascos: nunca caem)
    const rope = this.material(0xd9b77a, { roughness: 1 });
    for (const z of [-HALF_D - 0.1, HALF_D + 0.1]) {
      this.box({ x: 0, y: 0.95, z }, { x: 15.5, y: 0.08, z: 0.08 }, rope);
      this.box({ x: 0, y: -0.55, z }, { x: 15.5, y: 0.06, z: 0.06 }, rope, { collide: false });
      for (const x of [-7.4, 7.4]) this.box({ x, y: 0.5, z }, { x: 0.25, y: 1.2, z: 0.25 }, 0x5a3a1a);
    }

    // Vulcão ao fundo
    const volcano = new THREE.Mesh(new THREE.ConeGeometry(30, 34, 24, 1, true), this.material(0x2a1a1a, { roughness: 1 }));
    volcano.position.set(-10, 6, -70);
    this.deco(volcano, false);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(6, 20), new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
    crater.rotation.x = -Math.PI / 2;
    crater.position.set(-10, 22.5, -70);
    this.deco(crater, false);

    this.prop('barril', new THREE.Vector3(-10, 0.5, -0.5), 0xd94a3a);
    this.prop('caixa', new THREE.Vector3(10, 0.5, 0.6));

    this.spawns = [new THREE.Vector3(-4.5, 0.08, -0.4), new THREE.Vector3(4.5, 0.08, 0.4), new THREE.Vector3(-9.2, 0.08, 0.6), new THREE.Vector3(9.2, 0.08, -0.6)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.lavaMat.uniforms.t.value = time;
    // Brasas subindo da lava
    this.emberT -= dt;
    if (this.emberT <= 0) {
      this.emberT = 0.35;
      arena.effects.fire(new THREE.Vector3((Math.random() - 0.5) * 16, LAVA_Y + 0.2, (Math.random() - 0.5) * 6 - 1), 3);
    }

    // Escolhe uma tábua para cair (as do meio têm mais chance)
    this.dropTimer -= dt;
    if (this.dropTimer <= 0) {
      this.dropTimer = Math.max(1.6, 3.6 - time * 0.03) + Math.random() * 1.5;
      const ok = this.planks.filter((p) => p.state === 'ok');
      if (ok.length) {
        const weights = ok.map((p) => 1.5 - Math.abs(p.base.x) / 8);
        let r = Math.random() * weights.reduce((a, b) => a + b, 0);
        let pick = ok[0];
        for (let i = 0; i < ok.length; i++) {
          r -= weights[i];
          if (r <= 0) {
            pick = ok[i];
            break;
          }
        }
        pick.state = 'shaking';
        pick.t = 0;
        arena.sound('crack', 0.7);
      }
    }

    for (const p of this.planks) {
      if (p.state === 'shaking') {
        p.t += dt;
        // Treme: mexe o corpo (fixo) um pouquinho
        const j = Math.sin(p.t * 60) * 0.03 * Math.min(1, p.t);
        p.body.setTranslation({ x: p.base.x + j, y: p.base.y + Math.abs(j) * 0.5, z: p.base.z }, true);
        if (p.t > 1.4) {
          p.state = 'falling';
          p.body.setTranslation({ x: p.base.x, y: p.base.y, z: p.base.z }, true);
          p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          p.body.setAngvel({ x: (Math.random() - 0.5) * 2, y: 0, z: (Math.random() - 0.5) * 3 }, true);
          arena.sound('crack', 1, 0.7);
        }
      } else if (p.state === 'falling' && p.body.isValid()) {
        if (p.body.translation().y < LAVA_Y - 1) {
          arena.effects.fire(new THREE.Vector3(p.body.translation().x, LAVA_Y, 0), 12);
          arena.sound('sizzle', 0.5);
          arena.removeBody(p.body);
          p.mesh.parent?.remove(p.mesh);
        }
      }
    }
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    const under = this.planks.find((pl) => pl.state !== 'ok' && Math.abs(pl.base.x - p.x) < PLANK_W * 0.6);
    if (!under || p.y < -1) return null;
    // procura a tábua firme mais perto (ou o penhasco)
    let best = new THREE.Vector3(p.x < 0 ? -8.5 : 8.5, 0, 0);
    let bd = Math.abs(best.x - p.x);
    for (const pl of this.planks) {
      if (pl.state !== 'ok') continue;
      const d = Math.abs(pl.base.x - p.x);
      if (d < bd) {
        bd = d;
        best = new THREE.Vector3(pl.base.x, 0, 0);
      }
    }
    return best;
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < LAVA_Y + 1.4) return 'lava';
    return 'none';
  }
}
