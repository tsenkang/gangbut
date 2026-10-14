import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER, G_WORLD, G_PROP, G_ALL, groups } from '../physics/Physics';
import { cityBackdrop } from './City';

// ------------------------------------------------------------
// Mapa 3 — RODA-GIGANTE
// Uma roda-gigante num píer de madeira sobre o mar. Todo mundo
// começa dentro de uma cabine diferente; as cabines não têm porta e
// balançam conforme o peso de quem está dentro. O píer tem tábuas
// podres que cedem e vai desmoronando aos poucos; as letras do eixo
// caem na cabeça de quem está embaixo; e a roda muda de velocidade
// do nada. Caiu na água? Fora!
// ------------------------------------------------------------

const C = new THREE.Vector3(0, 9.4, 0); // centro da roda
const WATER_Y = -2.6;
const PIER_HALF = 16; // até onde vai o píer (x)
const PIER_W = 3.2; // meia largura do píer (z)
const PLANK = 0.8; // largura de cada tábua
const GAP = 1.8; // vão do píer onde a cabine de baixo passa
const R = 6.8; // raio (até o ponto onde a cabine fica pendurada)
const N = 8; // número de cabines
const HANG = 2.6; // distância do ponto de pendurar até o piso da cabine
const GW = 1.3; // meia largura da cabine (x)
const GD = 1.05; // meia profundidade da cabine (z)
const CAB_COLORS = [0xe63946, 0xffb703, 0x2a9d8f, 0x3a86ff];

interface Gondola {
  body: RAPIER.RigidBody;
  offset: number; // ângulo da cabine na roda
  swing: number; // balanço (radianos)
  swingV: number;
}

interface Plank {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  x: number;
  weak: boolean; // tábua podre: cede quando alguém pisa
  load: number;
  state: 'ok' | 'shaking' | 'falling';
  t: number;
}

export class FerrisWheel extends GameMap {
  id = 'rodagigante';
  name = 'Roda-Gigante';
  emoji = '🎡';
  description = 'Uma roda-gigante velha num píer de madeira sobre o mar.';
  hazard = 'Cabines balançam, tábuas podres cedem, letras caem do eixo e a roda muda de velocidade. Não caia na água!';
  music = 'gelatina' as const;
  killY = -10;
  botLeaps = false;
  botDetours = false;
  camera = {
    dir: new THREE.Vector3(0, 0.4, 1),
    minDist: 16,
    maxDist: 33,
    fov: 44,
    center: new THREE.Vector3(0, 3, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-12, 0.5, -1.5), new THREE.Vector3(12, 12, 1.5)),
  };

  private gondolas: Gondola[] = [];
  private wheel = new THREE.Group();
  private bulbs: THREE.Mesh[] = [];
  private angle = 0;
  private speed = 0.15;
  private targetSpeed = 0.15;
  private speedTimer = 6;
  private blink: THREE.Mesh[] = [];
  private planks: Plank[] = [];
  private crumbleTimer = 10;
  private seaMat!: THREE.ShaderMaterial;
  private letters: THREE.Mesh[] = [];
  private letterTimer = 12;
  private fallingLetters: { body: RAPIER.RigidBody; mesh: THREE.Object3D; t: number }[] = [];

  build() {
    this.lights({
      // fim de tarde enevoado sobre a cidade
      skyTop: 0x34476e,
      skyBottom: 0xf2a77e,
      fog: { color: 0xb59a9f, near: 28, far: 115 },
      sunColor: 0xffd2a8,
      sunIntensity: 2.2,
      sunPos: new THREE.Vector3(-12, 22, 14),
      hemiSky: 0xc9d4ea,
      hemiGround: 0x5a4a48,
      hemiIntensity: 1.25,
      shadowExtent: 18,
    });

    // ---------------- mar
    this.seaMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      fog: false,
      vertexShader: `uniform float t; varying float vH; varying vec2 vUv;
        void main(){ vUv = uv; vec3 p = position;
          float h = sin(p.x*0.15 + t*1.0)*0.35 + sin(p.y*0.22 - t*1.3)*0.25;
          p.z += h; vH = h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
      fragmentShader: `varying float vH; varying vec2 vUv;
        void main(){ vec3 c = mix(vec3(0.08,0.3,0.42), vec3(0.25,0.55,0.62), smoothstep(-0.5, 0.6, vH));
          float d = length(vUv - 0.5) * 2.0; c = mix(c, vec3(0.75,0.7,0.72), smoothstep(0.35, 1.0, d));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 100, 100), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = WATER_Y;
    this.deco(sea, false);

    // ---------------- píer de tábuas (cada tábua é um corpo: as podres caem)
    const woods = [0x8a6a48, 0x7d5f40, 0x957552];
    for (let x = -PIER_HALF + PLANK / 2; x < PIER_HALF; x += PLANK) {
      if (Math.abs(x) < GAP) continue; // vão da cabine de baixo
      const { mesh, body } = this.box({ x, y: -0.15, z: 0 }, { x: PLANK - 0.05, y: 0.3, z: PIER_W * 2 }, this.material(woods[Math.floor(Math.random() * 3)], { roughness: 0.95 }));
      body!.collider(0).setMass(15);
      this.ctx.links.add(body!, mesh);
      this.planks.push({ body: body!, mesh, x, weak: Math.random() < 0.22, load: 0, state: 'ok', t: 0 });
    }
    // vigas e estacas por baixo (só desenho) e corrimão no fundo
    const post = this.material(0x4e3b2a, { roughness: 1 });
    for (let x = -PIER_HALF + 1; x < PIER_HALF; x += 3) {
      if (Math.abs(x) < GAP) continue;
      for (const z of [-PIER_W + 0.3, PIER_W - 0.3]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 6, 8), post);
        m.position.set(x, WATER_Y - 1.2, z);
        this.deco(m, false);
      }
    }
    const rail = this.material(0xe8e2d6, { roughness: 0.6 });
    for (const s of [-1, 1]) {
      const cx = s * (GAP + (PIER_HALF - GAP) / 2);
      this.box({ x: cx, y: 1, z: -PIER_W + 0.1 }, { x: PIER_HALF - GAP, y: 0.09, z: 0.09 }, rail);
      for (let x = s * (GAP + 0.3); Math.abs(x) < PIER_HALF; x += s * 1.6) this.box({ x, y: 0.5, z: -PIER_W + 0.1 }, { x: 0.08, y: 1, z: 0.08 }, rail, { collide: false });
    }
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([3, 1]) });
    for (const s of [-1, 1]) this.box({ x: s * (GAP + 0.06), y: 0.01, z: 0 }, { x: 0.12, y: 0.03, z: PIER_W * 2 }, stripes, { collide: false, shadow: false });
    // barraquinha de algodão-doce no píer (dá para subir)
    this.box({ x: -12, y: 0.8, z: -1.8 }, { x: 1.8, y: 1.6, z: 1.4 }, this.material(0xff8fab, { roughness: 0.7 }));
    this.box({ x: -12, y: 1.7, z: -1.8 }, { x: 2.2, y: 0.2, z: 1.8 }, this.material(0xffffff));

    // ---------------- a roda (só desenho; gira inteira)
    const white = this.material(0xf1ece2, { roughness: 0.45, metalness: 0.35 });
    const red = this.material(0xd62828, { roughness: 0.5, metalness: 0.3 });
    for (const z of [-1.5, 1.5]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.16, 8, 72), white);
      rim.position.z = z;
      this.wheel.add(rim);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(R * 0.62, 0.1, 6, 56), red);
      inner.position.z = z;
      this.wheel.add(inner);
      for (let i = 0; i < N * 2; i++) {
        const a = (i / (N * 2)) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, R, 6), i % 2 ? red : white);
        spoke.position.set((Math.cos(a) * R) / 2, (Math.sin(a) * R) / 2, z);
        spoke.rotation.z = a - Math.PI / 2;
        this.wheel.add(spoke);
      }
    }
    // travessas entre as duas faces (onde as cabines ficam penduradas)
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 8), white);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      this.wheel.add(bar);
    }
    // lâmpadas no aro
    const bulbGeo = new THREE.SphereGeometry(0.11, 8, 6);
    const bulbCols = [0xfff1a8, 0xff8fab, 0x9bf6ff];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const b = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: bulbCols[i % 3], toneMapped: false }));
      b.position.set(Math.cos(a) * (R + 0.2), Math.sin(a) * (R + 0.2), 1.62);
      this.wheel.add(b);
      this.bulbs.push(b);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.6, 20), red);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);
    this.wheel.position.copy(C);
    this.deco(this.wheel);
    // letras grandes presas no eixo (caem de vez em quando!)
    const word = 'MOLENGAS';
    for (let i = 0; i < word.length; i++) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g2 = c.getContext('2d')!;
      g2.fillStyle = '#ffd23f';
      g2.font = '900 120px "Lilita One", sans-serif';
      g2.textAlign = 'center';
      g2.textBaseline = 'middle';
      g2.fillText(word[i], 64, 70);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const letter = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
      letter.position.set(C.x - 3.15 + i * 0.9, C.y - 1.4, 2.1);
      this.deco(letter, false);
      this.letters.push(letter);
    }
    // pernas (cavalete em "A") descendo até a neblina
    for (const z of [-2.4]) {
      // (só as pernas de trás, para não tapar a câmera)
      for (const s of [-1, 1]) {
        const top = new THREE.Vector3(0, C.y, z);
        const foot = new THREE.Vector3(s * 6, WATER_Y - 2, z * 1.4);
        const len = top.distanceTo(foot);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, len, 0.5), white);
        leg.position.copy(top).add(foot).multiplyScalar(0.5);
        leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().sub(top).normalize());
        this.deco(leg);
      }
    }

    // ---------------- cabines (cinemáticas: sobem e descem com a roda)
    for (let i = 0; i < N; i++) {
      const offset = -Math.PI / 2 + (i / N) * Math.PI * 2; // a 0 fica embaixo
      this.gondolas.push({ body: this.makeGondola(CAB_COLORS[i % CAB_COLORS.length], this.gondolaPos(offset)), offset, swing: 0, swingV: 0 });
    }

    // ---------------- cidade e neblina lá embaixo
    // a cidade lá longe, do outro lado da baía
    const city = cityBackdrop(this.ctx.root, { below: -WATER_Y, radius: [70, 130], count: 34, keepClear: (_x, z) => z > -20, walls: ['#5d5763', '#6b6370', '#4f5866', '#625b60'] });
    this.blink.push(...city.blink);

    this.prop('barril', new THREE.Vector3(9.5, 0.5, -1.5), 0x2a9d8f);
    this.prop('bola', new THREE.Vector3(6, 0.6, 1.8), 0xffb703);
    this.prop('caixa', new THREE.Vector3(-7, 0.5, 1.5), 0xe76f51);

    // todo mundo começa numa cabine diferente
    const sp = (i: number) => this.gondolaPos(-Math.PI / 2 + (i / N) * Math.PI * 2).add(new THREE.Vector3(0, 0.1, 0));
    this.spawns = [sp(7), sp(1), sp(6), sp(2)];
  }

  /** Piso da cabine para um ângulo da roda. */
  private gondolaPos(a: number, out = new THREE.Vector3()) {
    return out.set(C.x + Math.cos(a) * R, C.y + Math.sin(a) * R - HANG, 0);
  }

  private makeGondola(color: number, pos: THREE.Vector3) {
    const world = this.ctx.physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
    const add = (desc: RAPIER.ColliderDesc, grab = true) => {
      const c = world.createCollider(desc.setFriction(1).setRestitution(0.05).setCollisionGroups(groups(G_WORLD, G_ALL)), body);
      this.ctx.physics.register(c, { kind: 'static', grabbable: grab });
    };
    add(RAPIER.ColliderDesc.cuboid(GW, 0.12, GD).setTranslation(0, -0.12, 0)); // piso
    for (const z of [-GD, GD]) add(RAPIER.ColliderDesc.cuboid(GW, 0.32, 0.05).setTranslation(0, 0.32, z)); // paredinhas
    for (const x of [-GW + 0.08, GW - 0.08]) for (const z of [-GD + 0.08, GD - 0.08]) add(RAPIER.ColliderDesc.cylinder(1.15, 0.06).setTranslation(x, 1.15, z)); // colunas
    add(RAPIER.ColliderDesc.cuboid(GW + 0.1, 0.1, GD + 0.12).setTranslation(0, 2.4, 0)); // teto (dá para subir!)

    const g = new THREE.Group();
    const paint = this.material(color, { roughness: 0.45, metalness: 0.2 });
    const light = this.material(0xf6efe2, { roughness: 0.5 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(GW * 2, 0.24, GD * 2), this.material(0x5a5450));
    floor.position.y = -0.12;
    g.add(floor);
    for (const z of [-GD, GD]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(GW * 2, 0.64, 0.1), paint);
      wall.position.set(0, 0.32, z);
      g.add(wall);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(GW * 2 + 0.04, 0.08, 0.14), light);
      trim.position.set(0, 0.66, z);
      g.add(trim);
    }
    for (const x of [-GW + 0.08, GW - 0.08])
      for (const z of [-GD + 0.08, GD - 0.08]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 8), light);
        pole.position.set(x, 1.15, z);
        g.add(pole);
      }
    // teto listrado (cúpula achatada)
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(GW + 0.15, GW + 0.35, 0.22, 16), paint);
    roof.scale.z = (GD + 0.15) / (GW + 0.15);
    roof.position.y = 2.42;
    g.add(roof);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), light);
    knob.position.y = 2.6;
    g.add(knob);
    // haste até o ponto de pendurar na roda
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, HANG - 2.5, 6), light);
    rod.position.y = 2.5 + (HANG - 2.5) / 2;
    g.add(rod);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.ctx.root.add(g);
    this.ctx.links.add(body, g);
    return body;
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // tábua tremendo (ou cedendo) embaixo de mim: pula para a firme mais perto
    if (p.y > 2.2 || p.y < -0.5 || Math.abs(p.z) > PIER_W) return null;
    const under = this.planks.find((pl) => Math.abs(p.x - pl.x) < PLANK * 0.6);
    if (!under || (under.state !== 'shaking' && !(under.weak && under.load > 0))) return null;
    let best: Plank | null = null;
    for (const pl of this.planks) {
      if (pl === under || pl.state !== 'ok' || Math.abs(pl.x - under.x) > PLANK * 2.5) continue;
      if (!best || Math.abs(pl.x - p.x) < Math.abs(best.x - p.x)) best = pl;
    }
    return best ? new THREE.Vector3(best.x, 0, p.z * 0.5) : null;
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    // dentro de uma cabine: fica no meio dela; senão, a plataforma mais perto
    for (const g of this.gondolas) {
      const t = g.body.translation();
      if (Math.abs(p.x - t.x) < GW + 0.2 && p.y > t.y - 0.5 && p.y < t.y + 2.6) return new THREE.Vector3(t.x, t.y, 0);
    }
    return new THREE.Vector3(Math.sign(p.x || 1) * 6, 0, 0);
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.seaMat.uniforms.t.value = time;
    // velocidade errática: a cada tanto a roda acelera, freia ou quase para
    this.speedTimer -= dt;
    if (this.speedTimer <= 0) {
      this.speedTimer = 4 + Math.random() * 4;
      const prev = this.targetSpeed;
      this.targetSpeed = [0.04, 0.12, 0.2, 0.35, 0.5][Math.floor(Math.random() * 5)];
      if (this.targetSpeed > prev + 0.15) {
        arena.announce('🎡 A RODA DISPAROU! Segure-se!', 'tip');
        arena.sound('alarm', 0.5);
      }
    }
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 0.9);
    this.angle += this.speed * dt;
    this.wheel.rotation.z = this.angle;

    // cabines: balançam com o peso de quem está dentro (e com o tranco da roda)
    const p = new THREE.Vector3();
    for (const g of this.gondolas) {
      this.gondolaPos(g.offset + this.angle, p);
      let torque = 0;
      for (const f of arena.fighters) {
        if (!f.alive || f.removed) continue;
        const q = f.pos('pelvis');
        if (Math.abs(q.x - p.x) < GW + 0.3 && q.y > p.y - 0.4 && q.y < p.y + 2.6 && Math.abs(q.z) < GD + 0.3) torque += (q.x - p.x) * 1.4;
      }
      const acc = -10 * g.swing - 2.6 * g.swingV - torque * 0.45 - (this.targetSpeed - this.speed) * 1.5;
      g.swingV += acc * dt;
      g.swing = THREE.MathUtils.clamp(g.swing + g.swingV * dt, -0.32, 0.32);
      // gira em volta do ponto onde está pendurada
      const pivot = p.clone().add(new THREE.Vector3(0, HANG, 0));
      const qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), g.swing);
      const pos = new THREE.Vector3(0, -HANG, 0).applyQuaternion(qr).add(pivot);
      g.body.setNextKinematicTranslation(pos);
      g.body.setNextKinematicRotation(qr);
    }

    this.updatePier(dt, arena);
    this.updateLetters(dt, arena);

    // lâmpadas piscando em onda
    const k = Math.floor(time * 8);
    this.bulbs.forEach((b, i) => (b.visible = (i + k) % 4 !== 0));
    const on = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = on;
  }

  /** Tábuas podres cedem quando alguém pisa; com o tempo o píer desmorona. */
  private updatePier(dt: number, arena: ArenaApi) {
    this.crumbleTimer -= dt;
    if (this.crumbleTimer <= 0) {
      this.crumbleTimer = 6 + Math.random() * 4;
      const ok = this.planks.filter((pl) => pl.state === 'ok');
      if (ok.length) {
        // as das pontas (mais velhas) caem primeiro
        ok.sort((a, b) => Math.abs(b.x) - Math.abs(a.x) + (Math.random() - 0.5) * 6);
        ok[0].state = 'shaking';
        ok[0].t = 0;
        arena.sound('crack', 0.6);
      }
    }
    for (const pl of this.planks) {
      if (pl.state === 'ok' && pl.weak) {
        let on = false;
        for (const f of arena.fighters) {
          if (!f.alive || f.removed || !f.grounded) continue;
          const q = f.pos('pelvis');
          if (Math.abs(q.x - pl.x) < PLANK * 0.6 && Math.abs(q.z) < PIER_W && q.y < 1.4) on = true;
        }
        pl.load = on ? pl.load + dt : Math.max(0, pl.load - dt);
        if (pl.load > 0.35) {
          pl.state = 'falling';
          this.drop(pl);
          arena.sound('crack', 1, 0.8);
          arena.effects.text(new THREE.Vector3(pl.x, 1, 0), 'CRAC!');
        }
      } else if (pl.state === 'shaking') {
        pl.t += dt;
        const j = Math.sin(pl.t * 60) * 0.03;
        pl.body.setTranslation({ x: pl.x + j, y: -0.15, z: 0 }, true);
        if (pl.t > 1.2) {
          pl.state = 'falling';
          this.drop(pl);
        }
      } else if (pl.state === 'falling' && pl.body.isValid() && pl.body.translation().y < WATER_Y - 2) {
        const tp = pl.body.translation();
        arena.effects.splash(new THREE.Vector3(tp.x, WATER_Y, tp.z), 0xcfefff, 10);
        arena.removeBody(pl.body);
        pl.mesh.parent?.remove(pl.mesh);
        pl.state = 'falling';
        (pl as { body: RAPIER.RigidBody | null }).body = null as unknown as RAPIER.RigidBody;
      }
    }
    this.planks = this.planks.filter((pl) => pl.body);
  }

  private drop(pl: Plank) {
    pl.body.setTranslation({ x: pl.x, y: -0.15, z: 0 }, true);
    pl.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    pl.body.setAngvel({ x: (Math.random() - 0.5) * 2, y: 0, z: (Math.random() - 0.5) * 3 }, true);
  }

  /** As letras do eixo se soltam e caem (pesadas!) em quem está embaixo. */
  private updateLetters(dt: number, arena: ArenaApi) {
    this.letterTimer -= dt;
    const left = this.letters.filter((l) => l.visible);
    if (this.letterTimer <= 0 && left.length) {
      this.letterTimer = 9 + Math.random() * 6;
      const l = left[Math.floor(Math.random() * left.length)];
      l.visible = false;
      const world = this.ctx.physics.world;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(l.position.x, l.position.y, 0.4).setAngvel({ x: 0, y: 0, z: (Math.random() - 0.5) * 3 }),
      );
      const col = world.createCollider(RAPIER.ColliderDesc.cuboid(0.45, 0.45, 0.15).setMass(25).setCollisionGroups(groups(G_PROP, G_ALL)), body);
      this.ctx.physics.register(col, { kind: 'prop', grabbable: true });
      const mesh = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.3), this.material(0xd62828, { roughness: 0.5 }));
      const face = l.clone();
      face.visible = true;
      face.position.set(0, 0, 0.16);
      mesh.add(back, face);
      mesh.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
      this.ctx.root.add(mesh);
      this.ctx.links.add(body, mesh);
      this.fallingLetters.push({ body, mesh, t: 0 });
      arena.announce('🔠 Uma LETRA se soltou do eixo! Saia de baixo!', 'tip');
      arena.sound('crack', 0.8, 1.2);
    }
    for (const fl of this.fallingLetters) {
      fl.t += dt;
      if (fl.body.isValid() && fl.body.translation().y < WATER_Y - 3) {
        arena.removeBody(fl.body);
        fl.mesh.parent?.remove(fl.mesh);
        fl.t = -1;
      }
    }
    this.fallingLetters = this.fallingLetters.filter((fl) => fl.t >= 0);
  }

  deathAt(p: THREE.Vector3): DeathKind {
    if (p.y < WATER_Y + 0.3) return 'water';
    return p.y < this.killY ? 'fall' : 'none';
  }
}
