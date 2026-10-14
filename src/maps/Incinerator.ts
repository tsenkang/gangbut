import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { grimeTexture } from './City';
import { RAPIER } from '../physics/Physics';

// ------------------------------------------------------------
// Mapa 5 — INCINERADOR
// Uma passarela de grades de aço sobre a fornalha de uma usina de
// lixo. As grades tremem e se soltam uma a uma; os canos dos lados
// servem para se pendurar. De vez em quando a fornalha solta uma
// labareda. Caiu lá embaixo? Virou churrasco.
// ------------------------------------------------------------

const PLANKS = 14;
const BRIDGE_X0 = -7;
const PLANK_W = 1;
const HALF_D = 2.3; // passarela larga
const LAVA_Y = -6;

interface Plank {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  state: 'ok' | 'shaking' | 'falling';
  t: number;
  base: THREE.Vector3;
}

export class Incinerator extends GameMap {
  id = 'incinerador';
  name = 'Incinerador';
  emoji = '🔥';
  description = 'Passarela de grades sobre a fornalha de uma usina de lixo.';
  hazard = 'As grades se soltam e caem no fogo! Segure nos canos para não cair.';
  music = 'lava' as const;
  killY = -10;
  camera = {
    dir: new THREE.Vector3(0, 0.62, 1),
    minDist: 13,
    maxDist: 28,
    fov: 42,
    center: new THREE.Vector3(0, 0.4, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-11, -1, -1.8), new THREE.Vector3(11, 3, 1.8)),
  };

  private planks: Plank[] = [];
  private dropTimer = 4;
  private lavaMat!: THREE.ShaderMaterial;
  private emberT = 0;
  private flareT = -1;
  private flareTimer = 12;
  private doorGlow!: THREE.MeshBasicMaterial;

  build() {
    this.lights({
      // dentro do galpão: penumbra fria em cima, fogo laranja embaixo
      skyTop: 0x1c1d26,
      skyBottom: 0x4a2a22,
      fog: { color: 0x2e2324, near: 22, far: 70 },
      sunColor: 0xd8dcff,
      sunIntensity: 1.5,
      sunPos: new THREE.Vector3(-6, 18, 8),
      hemiSky: 0x6b6f86,
      hemiGround: 0xff6a2a,
      hemiIntensity: 1.5,
      shadowExtent: 19,
    });
    // Luz quente vinda de baixo (da fornalha)
    const glow = new THREE.PointLight(0xff6a1a, 70, 30, 1.5);
    glow.position.set(0, -3, 2);
    this.ctx.root.add(glow);

    // Fogo da fornalha (shader simples: chamas que correm)
    this.lavaMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      fog: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float t; varying vec2 vUv;
        float n(vec2 p){ return sin(p.x)*sin(p.y); }
        void main(){
          vec2 p = vUv * vec2(18.0, 12.0);
          float v = n(p + vec2(t*0.9, t*1.7)) + n(p*1.9 - vec2(t*0.6, -t*1.1)) * 0.6 + n(p*3.7 + t*2.0) * 0.35;
          v = v * 0.5 + 0.5;
          vec3 c = mix(vec3(0.25,0.02,0.0), vec3(1.0,0.35,0.02), smoothstep(0.3,0.8,v));
          c = mix(c, vec3(1.0,0.85,0.35), smoothstep(0.86,1.0,v));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(16, 10.5), this.lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = LAVA_Y;
    this.deco(lava, false);

    // Poço da fornalha: paredes de tijolo queimado em volta do fogo
    const brick = new THREE.MeshStandardMaterial({ map: grimeTexture('#4a2c26', [6, 3], { tiles: 8, dark: 'rgba(0,0,0,0.35)' }), roughness: 1 });
    this.box({ x: 0, y: LAVA_Y + 2.5, z: -5 }, { x: 16, y: 5, z: 1 }, brick, { collide: false });

    // Plataformas de concreto dos lados (com faixa de perigo na beirada)
    const concrete = new THREE.MeshStandardMaterial({ map: grimeTexture('#6d6862', [2, 2], { tiles: 4, cracks: true }), roughness: 0.95 });
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([3, 1]) });
    const steel = this.material(0x58606b, { roughness: 0.55, metalness: 0.6 });
    for (const s of [-1, 1]) {
      const x = s * 12.5;
      this.box({ x, y: -5, z: 0 }, { x: 11, y: 10, z: 11 }, concrete);
      this.box({ x: s * 7.1, y: 0.01, z: 0 }, { x: 0.15, y: 0.03, z: 7 }, stripes, { collide: false, shadow: false });
      // máquina / contêiner de lixo (dá para subir)
      this.box({ x: x + s * 1.5, y: 0.6, z: -2.4 }, { x: 2.5, y: 1.2, z: 1.6 }, this.material(0x2f6f4e, { roughness: 0.7, metalness: 0.3 }));
      this.box({ x: x + s * 2.4, y: 1.4, z: 1.8 }, { x: 1.6, y: 2.8, z: 1.6 }, steel);
    }

    // Parede do fundo: chapas de aço e a porta redonda da fornalha
    const plates = new THREE.MeshStandardMaterial({ map: grimeTexture('#3d424b', [8, 3], { tiles: 6, dark: 'rgba(0,0,0,0.3)' }), roughness: 0.7, metalness: 0.5 });
    this.box({ x: 0, y: 6, z: -9 }, { x: 40, y: 26, z: 1 }, plates, { collide: false });
    const door = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.5, 32), steel);
    door.rotation.x = Math.PI / 2;
    door.position.set(0, 5.5, -8.4);
    this.deco(door, false);
    this.doorGlow = new THREE.MeshBasicMaterial({ color: 0xff7a1a, toneMapped: false });
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), this.doorGlow);
    mouth.position.set(0, 5.5, -8.1);
    this.deco(mouth, false);
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.8, 0.18), this.material(0x1d1f24, { metalness: 0.6 }));
      bar.position.set(-1.75 + i * 0.7, 5.5, -7.95);
      this.deco(bar, false);
    }
    // Canos grossos e chaminés
    const pipe = this.material(0x8a5a3a, { roughness: 0.6, metalness: 0.5 });
    for (const [x, y] of [
      [-8, 9],
      [8, 11],
      [-14, 4],
      [14, 6],
    ]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 30, 16), pipe);
      p.position.set(x, y, -8);
      this.deco(p, false);
    }
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 30, 12), pipe);
    duct.rotation.z = Math.PI / 2;
    duct.position.set(0, 12, -7.6);
    this.deco(duct, false);
    // Lâmpadas industriais penduradas
    for (const x of [-8, 0, 8]) {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.5, 16, 1, true), this.material(0x2d3a2f, { side: THREE.DoubleSide }));
      shade.position.set(x, 7, -1);
      this.deco(shade, false);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
      bulb.position.set(x, 6.75, -1);
      this.deco(bulb, false);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 8, 4), this.material(0x111111));
      cord.position.set(x, 11.2, -1);
      this.deco(cord, false);
    }

    // Grades da passarela (cada uma é um corpo próprio, para poder cair)
    const grate = new THREE.MeshStandardMaterial({
      map: (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d')!;
        g.fillStyle = '#7d848f';
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = '#2a2d33';
        for (let y = 6; y < 128; y += 16) for (let x = 6; x < 128; x += 16) g.fillRect(x, y, 10, 10);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1, 3);
        return t;
      })(),
      roughness: 0.6,
      metalness: 0.6,
    });
    for (let i = 0; i < PLANKS; i++) {
      const x = BRIDGE_X0 + PLANK_W * (i + 0.5);
      const { mesh, body } = this.box(
        { x, y: -0.15, z: 0 },
        { x: PLANK_W - 0.06, y: 0.3, z: HALF_D * 2 },
        grate,
      );
      body!.collider(0).setMass(20);
      this.ctx.links.add(body!, mesh);
      this.planks.push({ body: body!, mesh, state: 'ok', t: 0, base: new THREE.Vector3(x, -0.15, 0) });
    }
    // Canos dos lados (presos nas plataformas: nunca caem)
    const rail = this.material(0xd9a521, { roughness: 0.5, metalness: 0.5 });
    for (const z of [-HALF_D - 0.1, HALF_D + 0.1]) {
      this.box({ x: 0, y: 0.95, z }, { x: 15.5, y: 0.1, z: 0.1 }, rail);
      this.box({ x: 0, y: -0.55, z }, { x: 15.5, y: 0.14, z: 0.14 }, this.material(0x55595f, { metalness: 0.6 }), { collide: false });
      for (const x of [-7.4, 7.4]) this.box({ x, y: 0.5, z }, { x: 0.25, y: 1.2, z: 0.25 }, 0x3a3e45);
    }

    this.prop('barril', new THREE.Vector3(-10, 0.5, -0.5), 0xd94a3a);
    this.prop('caixa', new THREE.Vector3(10, 0.5, 0.6));
    this.prop('caixa', new THREE.Vector3(-9, 0.5, 3));
    this.prop('barril', new THREE.Vector3(9.5, 0.5, -3), 0x2b5e8a);

    this.spawns = [new THREE.Vector3(-4.5, 0.08, -0.8), new THREE.Vector3(4.5, 0.08, 0.8), new THREE.Vector3(-10, 0.08, 1.5), new THREE.Vector3(10, 0.08, -1.5)];
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.lavaMat.uniforms.t.value = time;
    this.doorGlow.color.setHSL(0.07, 1, 0.45 + Math.sin(time * 5) * 0.08 + (this.flareT > 0 ? 0.15 : 0));
    // Labareda: a fornalha "respira" e solta fogo para cima (só assusta... e empurra)
    this.flareTimer -= dt;
    if (this.flareTimer <= 0 && this.flareT <= 0) {
      this.flareT = 1.6;
      this.flareTimer = 13 + Math.random() * 6;
      arena.announce('🔥 LABAREDA! O fogo sobe!', 'tip');
      arena.sound('horn', 0.5, 0.6);
    }
    if (this.flareT > 0) {
      this.flareT -= dt;
      if (Math.random() < dt * 30) arena.effects.fire(new THREE.Vector3((Math.random() - 0.5) * 13, LAVA_Y + 2 + Math.random() * 3, (Math.random() - 0.5) * 3), 6);
      // ar quente empurra quem está no ar para cima
      for (const f of arena.fighters) {
        if (!f.alive || f.removed || f.grounded) continue;
        const p = f.pos('pelvis');
        if (Math.abs(p.x) < 7 && p.y < 1) for (const b of f.ragdoll.bodies()) {
          const v = b.linvel();
          b.setLinvel({ x: v.x, y: v.y + 22 * dt, z: v.z }, true);
        }
      }
    }
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
