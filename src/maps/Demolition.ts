import * as THREE from 'three';
import { GameMap, hazardStripes, type ArenaApi } from './MapBase';
import { RAPIER } from '../physics/Physics';
import { cityBackdrop, grimeTexture, hazeBelow } from './City';
import type { Fighter } from '../characters/Fighter';

// ------------------------------------------------------------
// Mapa 7 — DEMOLIÇÃO
// O último andar de um prédio velho sendo derrubado. Um guindaste
// balança uma bola de ferro gigante de um lado para o outro; entre
// uma passada e outra o carrinho muda de faixa. Quem estiver no
// caminho voa longe. O chão tem buracos e pedaços soltos.
// ------------------------------------------------------------

const PIVOT_Y = 14.5;
const LEN = 13.3; // comprimento da corrente
const BALL_R = 1.05;
const LANES = [-3.3, 0, 3.3]; // faixas (z) por onde a bola passa
const AMP = 0.96; // abertura do balanço (radianos)

export class Demolition extends GameMap {
  id = 'demolicao';
  name = 'Demolição';
  emoji = '💥';
  description = 'O último andar de um prédio sendo derrubado, com uma bola de ferro gigante.';
  hazard = 'A bola de demolição balança de um lado para o outro e muda de faixa. Saia da frente!';
  music = 'fabrica' as const;
  killY = -10;
  camera = {
    dir: new THREE.Vector3(0, 0.7, 1),
    minDist: 14,
    maxDist: 30,
    fov: 42,
    center: new THREE.Vector3(0, 0.5, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-9, -1, -4), new THREE.Vector3(9, 3, 4)),
  };

  private ball!: RAPIER.RigidBody;
  private chain!: THREE.Mesh;
  private trolley!: THREE.Mesh;
  private gantry!: THREE.Group;
  private phase = -Math.PI / 2; // começa parada lá na ponta
  private laneZ = LANES[1];
  private targetZ = LANES[1];
  private lastSide = 0;
  private hitCd = new Map<Fighter, number>();
  private waitT = 4; // espera no começo
  private blink: THREE.Mesh[] = [];
  private ballPos = new THREE.Vector3();
  private ballVel = new THREE.Vector3();

  build() {
    this.lights({
      // dia nublado e poeirento
      skyTop: 0x6d7f99,
      skyBottom: 0xd9cdb8,
      fog: { color: 0xb3aa9c, near: 30, far: 120 },
      sunColor: 0xfff0d8,
      sunIntensity: 2.2,
      sunPos: new THREE.Vector3(-10, 22, 12),
      hemiSky: 0xd8e0ee,
      hemiGround: 0x5a4d40,
      hemiIntensity: 1.3,
      shadowExtent: 19,
    });

    // ---------------- laje do último andar (com buracos)
    const slab = new THREE.MeshStandardMaterial({ map: grimeTexture('#8c867c', [3, 2], { tiles: 6, cracks: true, dark: 'rgba(0,0,0,0.2)' }), roughness: 1 });
    const side = this.material(0x6e675e, { roughness: 1 });
    // pedaços da laje: [x, z, largura, profundidade]
    const pieces: [number, number, number, number][] = [
      [-6.2, 0, 8.4, 10],
      [1.4, -2.7, 6.8, 4.6],
      [1.4, 3.2, 6.8, 3.6],
      [7.6, 0, 5.6, 10],
      [-0.6, 0.5, 1.2, 0.9], // ilhota no meio do buraco
    ];
    for (const [x, z, w, d] of pieces) {
      this.box({ x, y: -0.35, z }, { x: w, y: 0.7, z: d }, slab);
      // borda de baixo mais escura (espessura da laje)
      this.box({ x, y: -0.9, z }, { x: w - 0.2, y: 0.4, z: d - 0.2 }, side, { collide: false });
    }
    // vergalhões espetados nas bordas quebradas
    const rebar = this.material(0x6b3b24, { roughness: 0.7, metalness: 0.6 });
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6 + Math.random() * 0.7, 5), rebar);
      const onHole = i < 14;
      m.position.set(onHole ? -1.9 + Math.random() * 6.4 : (Math.random() < 0.5 ? -10.4 : 10.4), -0.1, onHole ? (Math.random() < 0.5 ? -0.4 : 1.4) : (Math.random() - 0.5) * 9.6);
      m.rotation.set((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6);
      this.deco(m, false);
    }
    // pedaços de parede que sobraram (dá para agarrar e subir)
    const brick = new THREE.MeshStandardMaterial({ map: grimeTexture('#9a5a44', [2, 1], { tiles: 6, dark: 'rgba(0,0,0,0.25)' }), roughness: 1 });
    this.box({ x: -8.4, y: 0.9, z: -4.8 }, { x: 3.2, y: 1.8, z: 0.35 }, brick);
    this.box({ x: -10.1, y: 0.6, z: -2.8 }, { x: 0.35, y: 1.2, z: 3.4 }, brick);
    this.box({ x: -4, y: 0.7, z: 3.4 }, { x: 0.35, y: 1.4, z: 2 }, brick);
    this.box({ x: 8.6, y: 1.3, z: -4.8 }, { x: 2.4, y: 2.6, z: 0.35 }, brick);
    // pilar de concreto com o andar de cima destruído (lugar alto)
    this.box({ x: 8.8, y: 1.1, z: 3.4 }, { x: 1.4, y: 2.2, z: 1.4 }, side);
    this.box({ x: -8.6, y: 1.6, z: 3.6 }, { x: 1.2, y: 3.2, z: 1.2 }, side);
    // escombros (só desenho)
    for (let i = 0; i < 16; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 + Math.random() * 0.25), side);
      r.position.set((Math.random() - 0.5) * 19, 0.1, (Math.random() - 0.5) * 9);
      if (r.position.x > -1.9 && r.position.x < 4.8 && r.position.z > -0.5 && r.position.z < 1.5) continue;
      this.deco(r);
    }
    // tapume com listras de perigo
    const stripes = new THREE.MeshStandardMaterial({ map: hazardStripes([6, 1]) });
    this.box({ x: 0, y: 0.45, z: -5.4 }, { x: 21, y: 0.9, z: 0.08 }, stripes, { collide: false });
    // prédio que sobra embaixo (descendo para a neblina)
    const facade = this.material(0x7a7068, { roughness: 1 });
    const below = new THREE.Mesh(new THREE.BoxGeometry(21, 50, 10), facade);
    below.position.set(0, -26.3, 0);
    this.deco(below, false);
    for (let f = 0; f < 10; f++)
      for (let k = 0; k < 8; k++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.6), this.material(0x2a2a30));
        win.position.set(-8.4 + k * 2.4, -3 - f * 3.4, 5.02);
        this.deco(win, false);
      }

    // ---------------- guindaste + bola de demolição
    // pórtico: duas pernas nas pontas e uma travessa que anda de faixa em faixa
    const yellow = this.material(0xf2b705, { roughness: 0.6, metalness: 0.3 });
    this.gantry = new THREE.Group();
    const cross = new THREE.Mesh(new THREE.BoxGeometry(30, 0.9, 0.9), yellow);
    cross.position.y = PIVOT_Y + 0.9;
    this.gantry.add(cross);
    for (const x of [-15, 15]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 50, 0.9), yellow);
      leg.position.set(x, PIVOT_Y + 0.9 - 25, 0);
      this.gantry.add(leg);
    }
    this.trolley = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 1.1), this.material(0x333333));
    this.trolley.position.y = PIVOT_Y + 0.25;
    this.gantry.add(this.trolley);
    this.gantry.position.z = this.laneZ;
    this.deco(this.gantry);
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.45, metalness: 0.8 });
    const ballMesh = new THREE.Group();
    ballMesh.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 20), iron));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.07, 6, 12), iron);
    ring.position.y = BALL_R + 0.15;
    ballMesh.add(ring);
    const start = this.ballAt(this.phase, this.laneZ);
    this.ball = this.kinematic(start, RAPIER.ColliderDesc.ball(BALL_R), ballMesh, { grabbable: true });
    this.chain = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), this.material(0x1c1c1c, { metalness: 0.7 }));
    this.deco(this.chain, false);

    const city = cityBackdrop(this.ctx.root, { below: 55, radius: [40, 110], count: 40, walls: ['#6a6460', '#757068', '#5d6470', '#6d6670'] });
    this.blink.push(...city.blink);
    hazeBelow(this.ctx.root, 0xc8bfb2, [
      [-14, 0.4],
      [-26, 0.6],
    ]);

    this.prop('caixa', new THREE.Vector3(-5, 0.5, 3), 0x8d8d8d);
    this.prop('caixa', new THREE.Vector3(7, 0.5, -1.5), 0x8d8d8d);
    this.prop('barril', new THREE.Vector3(-8, 0.5, 1.5), 0xd95f2b);
    this.prop('caixa', new THREE.Vector3(2.5, 0.5, -3.8), 0x8d8d8d);

    this.spawns = [new THREE.Vector3(-7, 0.05, 2.5), new THREE.Vector3(8, 0.05, -1.5), new THREE.Vector3(-5, 0.05, -3), new THREE.Vector3(2, 0.05, -3.2)];
  }

  /** Posição da bola para um ângulo do balanço. */
  private ballAt(phase: number, z: number, out = new THREE.Vector3()) {
    const a = AMP * Math.sin(phase);
    return out.set(Math.sin(a) * LEN, PIVOT_Y - Math.cos(a) * LEN, z);
  }

  update(dt: number, time: number, arena: ArenaApi) {
    // Espera um pouco, depois balança sem parar (período ~6 s)
    if (this.waitT > 0) {
      this.waitT -= dt;
      if (this.waitT <= 0) {
        arena.announce('💥 Cuidado com a BOLA DE DEMOLIÇÃO! Ela muda de faixa!', 'tip');
        arena.sound('horn', 0.6, 0.8);
      }
    } else this.phase += dt * ((Math.PI * 2) / 6.2);

    // Lá na ponta (fora do prédio) o carrinho escolhe outra faixa
    const s = Math.sin(this.phase);
    const sideNow = s > 0.97 ? 1 : s < -0.97 ? -1 : 0;
    if (sideNow !== 0 && sideNow !== this.lastSide) {
      this.lastSide = sideNow;
      const others = LANES.filter((z) => z !== this.targetZ);
      this.targetZ = others[Math.floor(Math.random() * others.length)];
      arena.sound('clank', 0.4);
    }
    this.laneZ += THREE.MathUtils.clamp(this.targetZ - this.laneZ, -dt * 3, dt * 3);

    const before = this.ballPos.clone();
    this.ballAt(this.phase, this.laneZ, this.ballPos);
    this.ballVel.copy(this.ballPos).sub(before).divideScalar(Math.max(dt, 1e-4));
    this.ball.setNextKinematicTranslation(this.ballPos);
    this.ball.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, AMP * s)));
    this.gantry.position.z = this.laneZ;
    const pivot = new THREE.Vector3(0, PIVOT_Y, this.laneZ);
    const mid = pivot.clone().add(this.ballPos).multiplyScalar(0.5);
    this.chain.position.copy(mid);
    this.chain.scale.y = pivot.distanceTo(this.ballPos) - BALL_R;
    this.chain.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pivot.clone().sub(this.ballPos).normalize());

    // Pancada em quem a bola encosta (vai na direção do movimento)
    const speed = this.ballVel.length();
    for (const f of arena.fighters) {
      if (!f.alive || f.removed) continue;
      const cd = (this.hitCd.get(f) ?? 0) - dt;
      this.hitCd.set(f, cd);
      if (cd > 0 || speed < 3) continue;
      for (const part of ['chest', 'head', 'pelvis'] as const) {
        if (f.pos(part).distanceTo(this.ballPos) < BALL_R + 0.45) {
          this.hitCd.set(f, 1.2);
          const dir = this.ballVel.clone().normalize();
          dir.y = Math.max(dir.y, 0) + 0.45;
          arena.hazardHit(f, 45, dir.normalize(), Math.min(14, 5 + speed * 0.6), 'BLAM!');
          arena.effects.dust(f.pos('chest'), 1.5, 0xbfb3a0);
          arena.shake(0.4);
          break;
        }
      }
    }
    const on = Math.sin(time * 3) > 0;
    for (const m of this.blink) m.visible = on;
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    // o meio do mapa é o buraco: vai para o pedaço de laje mais perto
    return p.x < 1.4 ? new THREE.Vector3(-6.2, 0, 0) : new THREE.Vector3(7.6, 0, 0);
  }

  botAdvice(p: THREE.Vector3): THREE.Vector3 | null {
    // A bola está vindo pela minha faixa: muda para a faixa mais longe dela
    if (this.waitT > 0 || p.y < -1) return null;
    if (Math.abs(p.z - this.laneZ) > 1.9) return null;
    const ahead = (p.x - this.ballPos.x) * Math.sign(this.ballVel.x || 1);
    if (ahead < -1 || ahead > 9) return null;
    const far = this.laneZ > 0 ? -3.6 : 3.6;
    return new THREE.Vector3(THREE.MathUtils.clamp(p.x, -9, 9.5), 0, far);
  }
}
