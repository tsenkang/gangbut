import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi } from './MapBase';
import { RAPIER, G_WORLD, G_ALL, groups } from '../physics/Physics';
import { cityBackdrop, grimeTexture, hazeBelow } from './City';

// ------------------------------------------------------------
// Mapa 18 — ANDAIME
// Duas gôndolas de limpador de janela penduradas na frente de um
// arranha-céu, ligadas só por uma tábua de madeira solta. Cada
// gôndola fica presa por quatro cabos (dois em cada ponta). Soque os
// cabos: com uma ponta solta a gôndola fica pendurada de lado e todo
// mundo escorrega; com os quatro partidos ela despenca.
// ------------------------------------------------------------

const GX = 3.5; // centro de cada gôndola
const GW = 2.15; // meia largura
const GD = 0.85; // meia profundidade
const CABLE_HP = 3;
const ANCHOR_Y = 32;
const WALL_Z = -GD - 0.55;

interface Cable {
  sx: number; // ponta (-1 / 1) em x local
  sz: number; // frente / fundo
  hp: number;
  mesh: THREE.Mesh;
}

interface Gondola {
  body: RAPIER.RigidBody;
  cx: number;
  cables: Cable[];
  rz: number; // inclinação de lado (ponta solta)
  rzV: number;
  rx: number; // inclinação frente/fundo
  rxV: number;
  fallV: number; // -1 = presa
  drop: number;
  respawn: number;
}

export class Scaffold extends GameMap {
  id = 'andaime';
  name = 'Andaime';
  emoji = '🪟';
  description = 'Duas gôndolas de limpador de janela, ligadas por uma tábua, no alto de um prédio.';
  hazard = 'Soque os cabos: uma ponta solta deixa a gôndola pendurada de lado; sem nenhum cabo, ela despenca!';
  music = 'telhado' as const;
  killY = -12;
  botLeaps = false;
  camera = {
    dir: new THREE.Vector3(0, 0.42, 1),
    minDist: 13,
    maxDist: 26,
    fov: 44,
    center: new THREE.Vector3(0, 1, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-7, -1, -1), new THREE.Vector3(7, 4, 1)),
  };

  private gondolas: Gondola[] = [];
  private plank!: RAPIER.RigidBody;
  private plankLost = 0;
  private clock = 0;
  private hitCd = new Map<object, number>();
  private blink: THREE.Mesh[] = [];
  private up = new THREE.Vector3(0, 1, 0);

  build() {
    this.lights({
      skyTop: 0x4f86c6,
      skyBottom: 0xdfe9f2,
      fog: { color: 0xc5d3e0, near: 30, far: 120 },
      sunColor: 0xfff1d8,
      sunIntensity: 2.4,
      sunPos: new THREE.Vector3(-10, 22, 14),
      hemiSky: 0xd6e4f5,
      hemiGround: 0x4f4f55,
      hemiIntensity: 1.3,
      shadowExtent: 12,
    });

    // ---------------- fachada do prédio (com janelas) logo atrás
    const glass = new THREE.MeshStandardMaterial({
      map: (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d')!;
        g.fillStyle = '#9aa3ad';
        g.fillRect(0, 0, 128, 128);
        const grd = g.createLinearGradient(0, 0, 128, 128);
        grd.addColorStop(0, '#5b7fa6');
        grd.addColorStop(1, '#a9c6e0');
        g.fillStyle = grd;
        g.fillRect(8, 8, 112, 112);
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(24, 100);
        g.lineTo(100, 24);
        g.stroke();
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(10, 30);
        return t;
      })(),
      roughness: 0.25,
      metalness: 0.4,
    });
    this.box({ x: 0, y: -10, z: WALL_Z - 0.5 }, { x: 26, y: 80, z: 1 }, glass);
    // marquise / topo do prédio onde os cabos estão presos
    const steel = this.material(0x5d636c, { roughness: 0.5, metalness: 0.7 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(26, 1.2, 3), this.material(0xb9b3a8, { roughness: 0.9 }));
    roof.position.set(0, ANCHOR_Y + 0.6, WALL_Z + 0.5);
    this.deco(roof, false);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.6), steel);
      arm.position.set(s * GX, ANCHOR_Y, 0);
      this.deco(arm, false);
    }

    // ---------------- as duas gôndolas
    const world = this.ctx.physics.world;
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([4, 1]) });
    const deckMat = new THREE.MeshStandardMaterial({ map: grimeTexture('#8c9097', [2, 1], { tiles: 6 }), roughness: 0.6, metalness: 0.5 });
    const yellow = this.material(0xf2b705, { roughness: 0.5, metalness: 0.3 });
    const cableMat = this.material(0x1a1a1a, { metalness: 0.6 });
    for (const s of [-1, 1]) {
      const cx = s * GX;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, 0, 0));
      const add = (desc: RAPIER.ColliderDesc) => {
        const c = world.createCollider(desc.setFriction(1).setRestitution(0.05).setCollisionGroups(groups(G_WORLD, G_ALL)), body);
        this.ctx.physics.register(c, { kind: 'static', grabbable: true });
      };
      add(RAPIER.ColliderDesc.cuboid(GW, 0.12, GD).setTranslation(0, -0.12, 0)); // piso
      add(RAPIER.ColliderDesc.cuboid(GW, 0.05, 0.05).setTranslation(0, 1.0, GD)); // corrimão da frente
      add(RAPIER.ColliderDesc.cuboid(GW, 0.55, 0.05).setTranslation(0, 0.5, -GD)); // grade do fundo (lado do prédio)
      add(RAPIER.ColliderDesc.cuboid(0.05, 0.5, GD).setTranslation(s * GW, 0.5, 0)); // ponta de fora fechada

      const g = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(GW * 2, 0.24, GD * 2), deckMat);
      deck.position.y = -0.12;
      g.add(deck);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(GW * 2 + 0.02, 0.1, GD * 2 + 0.02), stripes);
      edge.position.y = -0.22;
      g.add(edge);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(GW * 2, 0.1, 0.1), yellow);
      bar.position.set(0, 1.0, GD);
      g.add(bar);
      const back = new THREE.Mesh(new THREE.BoxGeometry(GW * 2, 1.1, 0.08), yellow);
      back.position.set(0, 0.5, -GD);
      g.add(back);
      const endW = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, GD * 2), yellow);
      endW.position.set(s * GW, 0.5, 0);
      g.add(endW);
      for (const sx of [-GW, GW]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.1), yellow);
        post.position.set(sx, 0.5, GD);
        g.add(post);
      }
      // balde e rodo (enfeite)
      const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.32, 12), this.material(0x2f7fd6));
      bucket.position.set(s * (GW - 0.4), 0.16, -GD + 0.3);
      g.add(bucket);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.ctx.root.add(g);
      this.ctx.links.add(body, g);

      const cables: Cable[] = [];
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), cableMat);
          m.castShadow = true;
          this.ctx.root.add(m);
          cables.push({ sx, sz, hp: CABLE_HP, mesh: m });
        }
      }
      this.gondolas.push({ body, cx, cables, rz: 0, rzV: 0, rx: 0, rxV: 0, fallV: -1, drop: 0, respawn: 0 });
    }

    // ---------------- a tábua que liga as duas (solta: escorrega se uma gôndola entortar)
    const plankMesh = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 0.9), this.material(0x9c6b3a, { roughness: 0.9 }));
    plankMesh.castShadow = true;
    plankMesh.receiveShadow = true;
    this.ctx.root.add(plankMesh);
    this.plank = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.07, 0).setLinearDamping(0.2).setAngularDamping(0.6));
    const pc = world.createCollider(RAPIER.ColliderDesc.cuboid(1.8, 0.06, 0.45).setMass(30).setFriction(1).setCollisionGroups(groups(G_WORLD, G_ALL)), this.plank);
    this.ctx.physics.register(pc, { kind: 'prop', grabbable: true });
    this.ctx.links.add(this.plank, plankMesh);

    const city = cityBackdrop(this.ctx.root, { below: 70, radius: [40, 120], count: 44, walls: ['#7f8a99', '#8c8577', '#6f7a88', '#9a9285'] });
    this.blink.push(...city.blink);
    hazeBelow(this.ctx.root, 0xd6dde6, [
      [-14, 0.4],
      [-26, 0.65],
    ]);

    this.prop('caixa', new THREE.Vector3(-GX - 1.2, 0.4, 0));
    this.prop('barril', new THREE.Vector3(GX + 1.2, 0.4, 0), 0x2f7fd6);

    this.spawns = [new THREE.Vector3(-GX + 0.9, 0.05, 0), new THREE.Vector3(GX - 0.9, 0.05, 0), new THREE.Vector3(-GX - 0.6, 0.05, 0.2), new THREE.Vector3(GX + 0.6, 0.05, 0.2)];
  }

  private baseY() {
    // o guincho sobe e desce bem devagar
    return Math.sin(this.clock * 0.25) * 0.35;
  }

  /** Socos, cabeçadas e voadoras nos cabos. */
  private hitCables(gd: Gondola, attach: THREE.Vector3[], dt: number, arena: ArenaApi) {
    for (const f of arena.fighters) {
      if (!f.alive || f.removed) continue;
      const cd = (this.hitCd.get(f) ?? 0) - dt;
      this.hitCd.set(f, cd);
      if (cd > 0) continue;
      const pts: THREE.Vector3[] = [];
      for (const [a, side] of [
        [f.punchL, 'L'],
        [f.punchR, 'R'],
      ] as const)
        if (a.t >= 0.08 && a.t < 0.28) pts.push(f.hands[side].position());
      if (f.headbutt.t >= 0.1 && f.headbutt.t < 0.32) pts.push(f.pos('head'));
      if (f.kick.t >= 0.06 && f.kick.t < 0.5) pts.push(f.pos('pelvis'));
      for (const p of pts) {
        for (let i = 0; i < gd.cables.length; i++) {
          const k = gd.cables[i];
          if (k.hp <= 0) continue;
          const a = attach[i];
          if (Math.abs(p.x - a.x) > 0.5 || Math.abs(p.z - a.z) > 0.6 || p.y < a.y - 0.2 || p.y > a.y + 3.5) continue;
          this.hitCd.set(f, 0.3);
          k.hp--;
          arena.effects.sparks(p, 0xfff1a8, 10, 5);
          arena.sound('clank', 0.8, 1.3);
          if (k.hp <= 0) {
            k.mesh.visible = false;
            arena.effects.text(p.clone().add(new THREE.Vector3(0, 0.6, 0)), 'TÉC!', 'big');
            arena.sound('crack', 1, 1.2);
            const left = gd.cables.filter((q) => q.hp > 0).length;
            if (left === 0) {
              gd.fallV = 0;
              gd.respawn = 7;
              arena.announce('🪟 Os cabos arrebentaram! A GÔNDOLA DESPENCOU!', 'out');
              arena.shake(0.35);
            } else if (gd.cables.filter((q) => q.sx === k.sx && q.hp > 0).length === 0) {
              arena.announce('🪟 Uma ponta soltou! A gôndola ficou pendurada!', 'tip');
              arena.shake(0.25);
            } else arena.announce('🪟 Um cabo arrebentou!', 'tip');
          }
          return;
        }
      }
    }
  }

  update(dt: number, time: number, arena: ArenaApi) {
    this.clock += dt;
    const y0 = this.baseY();
    const sway = Math.sin(time * 0.6) * 0.12;
    for (const gd of this.gondolas) {
      const alive = (sx: number) => gd.cables.filter((k) => k.sx === sx && k.hp > 0).length;
      const L = alive(-1);
      const R = alive(1);
      // alvo da inclinação de lado: ponta sem cabo cai
      let rzT = 0;
      if (L === 0 && R > 0) rzT = 1.3; // ponta esquerda cai (gira em volta da direita)
      else if (R === 0 && L > 0) rzT = -1.3;
      else if (L === 1 && R === 2) rzT = 0.1;
      else if (R === 1 && L === 2) rzT = -0.1;
      // frente/fundo: cabo da frente partido inclina para a frente
      const front = gd.cables.filter((k) => k.sz > 0 && k.hp > 0).length;
      const back = gd.cables.filter((k) => k.sz < 0 && k.hp > 0).length;
      const rxT = front < back ? 0.14 : back < front ? -0.1 : 0;
      gd.rzV += (-9 * (gd.rz - rzT) - 2.2 * gd.rzV) * dt;
      gd.rz += gd.rzV * dt;
      gd.rxV += (-12 * (gd.rx - rxT) - 3 * gd.rxV) * dt;
      gd.rx += gd.rxV * dt;

      if (gd.fallV >= 0) {
        gd.fallV += 19 * dt;
        gd.drop += gd.fallV * dt;
        if (y0 - gd.drop < this.killY - 8) {
          gd.drop = -y0 + 8 - this.killY;
          gd.respawn -= dt;
          if (gd.respawn <= 0) {
            // gôndola nova, cabos novos
            gd.fallV = -1;
            gd.drop = 0;
            gd.rz = gd.rzV = gd.rx = gd.rxV = 0;
            for (const k of gd.cables) {
              k.hp = CABLE_HP;
              k.mesh.visible = true;
            }
            arena.announce('🪟 Chegou uma gôndola nova!', 'tip');
          }
        }
      }
      // gira em volta da ponta que ainda está presa
      const pivot = new THREE.Vector3(gd.rz > 0 ? GW : gd.rz < 0 ? -GW : 0, 0, 0);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(gd.rx, 0, gd.rz + sway * 0.05));
      const origin = new THREE.Vector3(gd.cx + sway, y0 - gd.drop, 0).add(pivot).sub(pivot.clone().applyQuaternion(q));
      gd.body.setNextKinematicTranslation({ x: origin.x, y: origin.y, z: origin.z });
      gd.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });

      // cabos: da ponta da gôndola até o braço lá no alto
      const attach: THREE.Vector3[] = [];
      for (const k of gd.cables) {
        const a = new THREE.Vector3(k.sx * (GW - 0.12), 1.05, k.sz * (GD - 0.08)).applyQuaternion(q).add(origin);
        attach.push(a);
        if (!k.mesh.visible) continue;
        const top = new THREE.Vector3(gd.cx + k.sx * (GW - 0.12), ANCHOR_Y, k.sz * 0.9);
        const mid = a.clone().add(top).multiplyScalar(0.5);
        const dir = top.clone().sub(a);
        k.mesh.position.copy(mid);
        k.mesh.scale.set(1, dir.length(), 1);
        k.mesh.quaternion.setFromUnitVectors(this.up, dir.normalize());
      }
      if (gd.fallV < 0) this.hitCables(gd, attach, dt, arena);
    }

    // tábua caiu lá embaixo: depois de um tempo, os limpadores põem outra
    const pp = this.plank.translation();
    if (pp.y < this.killY) this.plankLost += dt;
    if (this.plankLost > 6 && this.gondolas.every((g) => g.fallV < 0 && Math.abs(g.rz) < 0.2)) {
      this.plankLost = 0;
      this.plank.setTranslation({ x: 0, y: y0 + 0.5, z: 0 }, true);
      this.plank.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.plank.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.plank.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    const on = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = on;
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    // a gôndola mais firme (de preferência a mais perto)
    let best = this.gondolas[0];
    let bs = Infinity;
    for (const g of this.gondolas) {
      const s = Math.abs(p.x - g.cx) + (g.fallV >= 0 ? 100 : 0) + Math.abs(g.rz) * 6;
      if (s < bs) {
        bs = s;
        best = g;
      }
    }
    return new THREE.Vector3(best.cx, this.baseY(), 0);
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // gôndola pendurada de lado: sobe para a ponta presa
    for (const g of this.gondolas) {
      if (Math.abs(p.x - g.cx) > GW + 0.5 || Math.abs(g.rz) < 0.4 || g.fallV >= 0) continue;
      return new THREE.Vector3(g.cx + (g.rz > 0 ? GW - 0.4 : -GW + 0.4), p.y, 0);
    }
    return null;
  }
}
