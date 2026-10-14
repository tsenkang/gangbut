import * as THREE from 'three';
import { GameMap, canvasTexture, type ArenaApi, type DeathKind } from './MapBase';
import { RAPIER, G_PROP, G_ALL, groups } from '../physics/Physics';
import type { Fighter } from '../characters/Fighter';

// ------------------------------------------------------------
// MODO FUTEBOL — ESTÁDIO
// Um campinho fechado (ninguém cai para fora), um gol em cada ponta
// e uma bola enorme. Time Vermelho ataca para a direita (+x), Time
// Azul para a esquerda (-x). Vale tudo: chutar, socar e cabecear a
// bola... e os adversários. A Match cuida do placar e do relógio.
// ------------------------------------------------------------

export const FIELD_X = 14; // meia largura do campo (até a linha do gol)
export const FIELD_Z = 8; // meia profundidade
const WALL_H = 1.4; // muretinha (com alambrado alto em cima)
const FENCE_H = 5;
export const GOAL_W = 3.0; // meia abertura do gol (z)
export const GOAL_H = 2.5;
const GOAL_D = 2; // fundo do gol
export const BALL_R = 0.75;
export const TEAM_COLORS = [0xff4d5e, 0x3a86ff];
export const TEAM_NAMES = ['Vermelho', 'Azul'];

export class Football extends GameMap {
  id = 'futebol';
  name = 'Estádio';
  emoji = '⚽';
  description = 'Futebol de gelatina: dois times, uma bola gigante e nenhuma regra.';
  hazard = 'Leve a bola até o gol do adversário — socar, chutar e cabecear vale!';
  music = 'gelatina' as const;
  killY = -40;
  botLeaps = true; // campo plano e fechado: robôs podem correr
  camera = {
    dir: new THREE.Vector3(0, 0.95, 0.9),
    minDist: 17,
    maxDist: 34,
    fov: 44,
    center: new THREE.Vector3(0, 0.5, 0),
    bounds: new THREE.Box3(new THREE.Vector3(-FIELD_X - 1, -1, -FIELD_Z), new THREE.Vector3(FIELD_X + 1, 3, FIELD_Z)),
  };

  ball!: RAPIER.RigidBody;
  private ballMesh!: THREE.Object3D;
  /** Chamado quando sai um gol: time que MARCOU (0 vermelho, 1 azul). */
  onGoal: (team: number) => void = () => {};
  /** Bola parada no meio esperando o reinício. */
  private resetT = -1;
  private rings = new Map<Fighter, THREE.Mesh>();
  private outT = new Map<Fighter, number>();
  private idleT = 0;
  private idlePos = new THREE.Vector3();
  private crowd: THREE.InstancedMesh[] = [];
  private cheerT = 0;
  private goalFlash = 0;
  private nets: THREE.MeshStandardMaterial[] = [];

  build() {
    this.lights({
      // noite de jogo com os refletores acesos
      skyTop: 0x0d1630,
      skyBottom: 0x2b3a66,
      fog: { color: 0x1d2644, near: 50, far: 140 },
      sunColor: 0xf4f6ff,
      sunIntensity: 2.4,
      sunPos: new THREE.Vector3(-6, 26, 12),
      hemiSky: 0xbfcbea,
      hemiGround: 0x2f4a2a,
      hemiIntensity: 1.5,
      shadowExtent: 20,
      clouds: false,
    });

    // ---------------- gramado listrado com as linhas do campo
    const grass = canvasTexture(1024, 512, (g) => {
      for (let i = 0; i < 14; i++) {
        g.fillStyle = i % 2 ? '#3f9a46' : '#46a84d';
        g.fillRect((i * 1024) / 14, 0, 1024 / 14 + 1, 512);
      }
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 6;
      const px = (x: number) => ((x + FIELD_X) / (FIELD_X * 2)) * 1024;
      const pz = (z: number) => ((z + FIELD_Z) / (FIELD_Z * 2)) * 512;
      g.strokeRect(px(-FIELD_X + 0.2), pz(-FIELD_Z + 0.2), px(FIELD_X - 0.2) - px(-FIELD_X + 0.2), pz(FIELD_Z - 0.2) - pz(-FIELD_Z + 0.2));
      g.beginPath();
      g.moveTo(px(0), pz(-FIELD_Z + 0.2));
      g.lineTo(px(0), pz(FIELD_Z - 0.2));
      g.stroke();
      g.beginPath();
      g.arc(px(0), pz(0), (3 / (FIELD_X * 2)) * 1024, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(px(0), pz(0), 6, 0, Math.PI * 2);
      g.fill();
      for (const s of [-1, 1]) {
        const x0 = px(s * (FIELD_X - 0.2));
        const x1 = px(s * (FIELD_X - 4));
        g.strokeRect(Math.min(x0, x1), pz(-5), Math.abs(x1 - x0), pz(5) - pz(-5));
        const x2 = px(s * (FIELD_X - 1.8));
        g.strokeRect(Math.min(x0, x2), pz(-3.2), Math.abs(x2 - x0), pz(3.2) - pz(-3.2));
      }
    });
    const field = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 });
    this.box({ x: 0, y: -0.25, z: 0 }, { x: FIELD_X * 2, y: 0.5, z: FIELD_Z * 2 }, field, { friction: 0.9 });
    // gramado de fora (atrás dos gols e nas laterais)
    const outer = this.material(0x2f7a37, { roughness: 1 });
    this.box({ x: 0, y: -0.26, z: 0 }, { x: FIELD_X * 2 + 10, y: 0.48, z: FIELD_Z * 2 + 6 }, outer, { collide: false });

    // ---------------- muretas + alambrado (fecham o campo; abertura nos gols)
    const wallMat = this.material(0xe8e4dc, { roughness: 0.8 });
    const adMat = (txt: string, bg: string) =>
      new THREE.MeshStandardMaterial({
        map: canvasTexture(512, 64, (g) => {
          g.fillStyle = bg;
          g.fillRect(0, 0, 512, 64);
          g.fillStyle = '#fff';
          g.font = '900 40px "Lilita One", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(txt, 256, 34);
        }),
        roughness: 0.6,
      });
    const ads = [adMat('MOLENGAS', '#d62839'), adMat('GELATINA FC', '#1d4ed8'), adMat('PIZZA DA ESQUINA', '#f59e0b'), adMat('BOLA NA REDE', '#16a34a')];
    const fence = new THREE.MeshStandardMaterial({ color: 0xcfd6df, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    for (const s of [-1, 1]) {
      // laterais compridas
      const seg = (FIELD_X * 2 + 1) / 4;
      for (let i = 0; i < 4; i++) {
        const x = -FIELD_X - 0.5 + seg * (i + 0.5);
        this.box({ x, y: WALL_H / 2, z: s * (FIELD_Z + 0.25) }, { x: seg, y: WALL_H, z: 0.5 }, ads[(i + (s > 0 ? 0 : 2)) % 4]);
      }
      this.box({ x: 0, y: WALL_H + (FENCE_H - WALL_H) / 2, z: s * (FIELD_Z + 0.25) }, { x: FIELD_X * 2 + 1, y: FENCE_H - WALL_H, z: 0.1 }, fence, { shadow: false, grabbable: true });
      // fundos (com o buraco do gol no meio)
      for (const side of [-1, 1]) {
        const zc = side * (GOAL_W + (FIELD_Z - GOAL_W) / 2);
        const len = FIELD_Z - GOAL_W + 0.5;
        this.box({ x: s * (FIELD_X + 0.25), y: WALL_H / 2, z: zc }, { x: 0.5, y: WALL_H, z: len }, wallMat);
        this.box({ x: s * (FIELD_X + 0.25), y: WALL_H + (FENCE_H - WALL_H) / 2, z: zc }, { x: 0.1, y: FENCE_H - WALL_H, z: len }, fence, { shadow: false, grabbable: true });
      }
      // em cima do gol: o alambrado continua (não dá para pular por cima)
      this.box({ x: s * (FIELD_X + 0.25), y: GOAL_H + (FENCE_H - GOAL_H) / 2 + 0.1, z: 0 }, { x: 0.1, y: FENCE_H - GOAL_H, z: GOAL_W * 2 }, fence, { shadow: false });
    }
    // cantos chanfrados (a bola não fica presa no cantinho)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const c = new THREE.Vector3(sx * (FIELD_X - 0.9), 0, sz * (FIELD_Z - 0.9));
        this.box({ x: c.x, y: WALL_H / 2, z: c.z }, { x: 2.9, y: WALL_H, z: 0.4 }, wallMat, { rot: new THREE.Euler(0, sx * sz > 0 ? -Math.PI / 4 : Math.PI / 4, 0) });
      }
    // teto invisível bem alto (a bola não sai voando do estádio)
    this.ctx.physics.addStaticBox({ x: 0, y: FENCE_H + 3, z: 0 }, { x: FIELD_X + 3, y: 0.2, z: FIELD_Z + 3 });

    // ---------------- os dois gols (trave, travessão, rede)
    const post = this.material(0xffffff, { roughness: 0.3, metalness: 0.2 });
    for (const s of [-1, 1]) {
      const x0 = s * FIELD_X;
      const team = s > 0 ? 1 : 0; // gol da direita é do Azul (o Vermelho ataca para lá)
      for (const z of [-GOAL_W, GOAL_W]) this.box({ x: x0 + s * 0.1, y: GOAL_H / 2, z }, { x: 0.2, y: GOAL_H, z: 0.2 }, post);
      this.box({ x: x0 + s * 0.1, y: GOAL_H, z: 0 }, { x: 0.2, y: 0.2, z: GOAL_W * 2 + 0.2 }, post);
      // rede (colide: segura a bola e quem entrar)
      const net = new THREE.MeshStandardMaterial({
        map: canvasTexture(128, 128, (g) => {
          g.clearRect(0, 0, 128, 128);
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2;
          for (let i = 0; i <= 128; i += 16) {
            g.beginPath();
            g.moveTo(i, 0);
            g.lineTo(i, 128);
            g.moveTo(0, i);
            g.lineTo(128, i);
            g.stroke();
          }
        }, [4, 2]),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        color: TEAM_COLORS[team],
        emissive: TEAM_COLORS[team],
        emissiveIntensity: 0.15,
      });
      this.nets.push(net);
      this.box({ x: x0 + s * (GOAL_D + 0.1), y: GOAL_H / 2, z: 0 }, { x: 0.1, y: GOAL_H, z: GOAL_W * 2 }, net, { shadow: false });
      for (const z of [-GOAL_W - 0.05, GOAL_W + 0.05]) this.box({ x: x0 + s * (GOAL_D / 2 + 0.1), y: GOAL_H / 2, z }, { x: GOAL_D, y: GOAL_H, z: 0.1 }, net, { shadow: false });
      this.box({ x: x0 + s * (GOAL_D / 2 + 0.1), y: GOAL_H + 0.05, z: 0 }, { x: GOAL_D, y: 0.1, z: GOAL_W * 2 }, net, { shadow: false });
      // gramado dentro do gol
      this.box({ x: x0 + s * (GOAL_D / 2 + 0.1), y: -0.25, z: 0 }, { x: GOAL_D + 0.2, y: 0.5, z: GOAL_W * 2 }, field);
    }

    // ---------------- arquibancadas com torcida e refletores
    const stand = this.material(0x3a4256, { roughness: 0.9 });
    const seatCols = [0xd62839, 0x1d4ed8, 0xf4f1ea, 0xffd23f, 0x16a34a, 0xff70a6, 0x9b5de5];
    for (const [cx, cz, w, rot] of [
      [0, -FIELD_Z - 6, FIELD_X * 2 + 10, 0],
      [0, FIELD_Z + 7, FIELD_X * 2 + 10, Math.PI],
      [-FIELD_X - 7, 0, FIELD_Z * 2 + 4, Math.PI / 2],
      [FIELD_X + 7, 0, FIELD_Z * 2 + 4, -Math.PI / 2],
    ] as [number, number, number, number][]) {
      const g = new THREE.Group();
      for (let r = 0; r < 6; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, 1.4), stand);
        step.position.set(0, r * 0.8 + 0.4, -r * 1.4);
        g.add(step);
      }
      // torcida (bonequinhos de gelatina coloridos)
      const fanGeo = new THREE.CapsuleGeometry(0.28, 0.35, 4, 8);
      const n = Math.floor(w / 0.9) * 6;
      const fans = new THREE.InstancedMesh(fanGeo, new THREE.MeshStandardMaterial({ roughness: 0.4 }), n);
      let k = 0;
      for (let r = 0; r < 6; r++)
        for (let i = 0; i < Math.floor(w / 0.9); i++) {
          if (Math.random() < 0.12) {
            fans.setMatrixAt(k, new THREE.Matrix4().makeScale(0, 0, 0));
          } else fans.setMatrixAt(k, new THREE.Matrix4().makeTranslation(-w / 2 + 0.45 + i * 0.9 + (Math.random() - 0.5) * 0.2, r * 0.8 + 1.15, -r * 1.4 - 0.1));
          fans.setColorAt(k, new THREE.Color(seatCols[Math.floor(Math.random() * seatCols.length)]));
          k++;
        }
      fans.userData.base = Array.from({ length: n }, (_, i) => {
        const m = new THREE.Matrix4();
        fans.getMatrixAt(i, m);
        return m;
      });
      g.add(fans);
      this.crowd.push(fans);
      g.position.set(cx, 0, cz);
      g.rotation.y = rot;
      this.deco(g, false);
    }
    // refletores nos cantos
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 18, 8), this.material(0x6b7280, { metalness: 0.6 }));
        tower.position.set(sx * (FIELD_X + 9), 9, sz * (FIELD_Z + 8));
        this.deco(tower, false);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffee, toneMapped: false }));
        panel.position.set(sx * (FIELD_X + 9), 18.5, sz * (FIELD_Z + 8));
        panel.lookAt(0, 0, 0);
        this.deco(panel, false);
      }
    const fill = new THREE.PointLight(0xffffff, 120, 60, 1.2);
    fill.position.set(0, 14, 0);
    this.ctx.root.add(fill);

    // ---------------- a bola
    const ballTex = canvasTexture(256, 128, (g) => {
      g.fillStyle = '#f7f7f2';
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#1b1b1f';
      for (let i = 0; i < 12; i++) {
        const x = (i % 6) * 44 + (Math.floor(i / 6) ? 22 : 0) + 10;
        const y = Math.floor(i / 6) * 64 + 32;
        g.beginPath();
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
          g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
        }
        g.fill();
      }
    });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 20), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.45 }));
    this.ballMesh.castShadow = true;
    const world = this.ctx.physics.world;
    this.ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, BALL_R + 0.05, 0).setLinearDamping(0.35).setAngularDamping(0.6).setCcdEnabled(true));
    const col = world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_R).setMass(2.6).setRestitution(0.55).setFriction(0.6).setCollisionGroups(groups(G_PROP, G_ALL)),
      this.ball,
    );
    this.ctx.physics.register(col, { kind: 'prop', grabbable: true });
    this.ctx.root.add(this.ballMesh);
    this.ctx.links.add(this.ball, this.ballMesh);
    this.ctx.props.push({ body: this.ball, mesh: this.ballMesh, kind: 'bola' });

    // posições de saída: Vermelho na esquerda, Azul na direita (slots 0..3 trocados pela Match)
    this.spawns = [new THREE.Vector3(-5, 0.05, -2.5), new THREE.Vector3(5, 0.05, -2.5), new THREE.Vector3(-5, 0.05, 2.5), new THREE.Vector3(5, 0.05, 2.5)];
  }

  /** Ponto de saída do time (lado de defesa). */
  kickoffSpot(team: number, i: number) {
    const side = team === 0 ? -1 : 1;
    return new THREE.Vector3(side * (4.5 + (i % 2) * 2.5), 0.05, (i % 2 ? 1 : -1) * 2.6);
  }

  /** Centro do gol que este time ATACA. */
  attackGoal(team: number) {
    return new THREE.Vector3(team === 0 ? FIELD_X + 0.6 : -FIELD_X - 0.6, 0, 0);
  }

  resetBall(delay = 0) {
    if (delay > 0) {
      this.resetT = delay;
      return;
    }
    this.ball.setTranslation({ x: 0, y: 4, z: 0 }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.resetT = -1;
  }

  update(dt: number, time: number, arena: ArenaApi) {
    // anel do time embaixo de cada jogador
    for (const f of arena.fighters) {
      let ring = this.rings.get(f);
      if (!ring && f.team >= 0) {
        ring = new THREE.Mesh(
          new THREE.RingGeometry(0.45, 0.62, 28),
          new THREE.MeshBasicMaterial({ color: TEAM_COLORS[f.team], transparent: true, opacity: 0.85, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        this.ctx.root.add(ring);
        this.rings.set(f, ring);
      }
      if (!ring) continue;
      const p = f.pos('pelvis');
      // voou para fora do campo (arquibancada, cima do alambrado): volta para o seu lado
      const out = Math.abs(p.x) > FIELD_X + GOAL_D + 0.6 || Math.abs(p.z) > FIELD_Z + 0.7 || p.y < -3 || p.y > FENCE_H + 4;
      const t = out && f.alive ? (this.outT.get(f) ?? 0) + dt : 0;
      this.outT.set(f, t);
      if (t > 1 && f.team >= 0) {
        this.outT.set(f, 0);
        f.teleport(this.kickoffSpot(f.team, 0).setY(1.5), f.team === 0 ? Math.PI / 2 : -Math.PI / 2);
        arena.effects.dust(f.pos('chest'), 2, 0xffffff);
        arena.sound('whoosh', 0.6);
      }
      ring.visible = f.alive && !f.removed;
      ring.position.set(p.x, 0.03, p.z);
    }

    // torcida pulando (mais ainda depois de gol)
    this.cheerT = Math.max(0, this.cheerT - dt);
    const m = new THREE.Matrix4();
    const amp = 0.06 + this.cheerT * 0.25;
    for (const fans of this.crowd) {
      const base = fans.userData.base as THREE.Matrix4[];
      for (let i = 0; i < base.length; i += 1) {
        m.copy(base[i]);
        m.elements[13] += Math.max(0, Math.sin(time * (6 + (i % 5)) + i)) * amp;
        fans.setMatrixAt(i, m);
      }
      fans.instanceMatrix.needsUpdate = true;
    }
    this.goalFlash = Math.max(0, this.goalFlash - dt);
    for (const n of this.nets) n.emissiveIntensity = 0.15 + this.goalFlash * 1.5;

    if (this.resetT >= 0) {
      this.resetT -= dt;
      if (this.resetT <= 0) {
        this.resetBall();
        arena.sound('beep', 0.8);
      }
      return;
    }

    // GOL? (a bola passou inteira da linha, dentro da boca do gol)
    const b = this.ball.translation();
    if (Math.abs(b.x) > FIELD_X + BALL_R * 0.9 && Math.abs(b.z) < GOAL_W && b.y < GOAL_H) {
      const scoring = b.x > 0 ? 0 : 1; // bola no gol da direita = ponto do Vermelho
      const p = new THREE.Vector3(b.x, b.y, b.z);
      arena.effects.sparks(p, TEAM_COLORS[scoring], 40, 9);
      arena.effects.text(p.clone().add(new THREE.Vector3(0, 1.5, 0)), 'GOOOL!', 'big');
      arena.sound('cheer', 1);
      arena.sound('horn', 0.8);
      arena.shake(0.4);
      this.cheerT = 3;
      this.goalFlash = 2;
      this.resetBall(2.5);
      this.onGoal(scoring);
    }
    // bola parada muito tempo (presa num canto, ninguém chega): o juiz põe no meio
    const bp = new THREE.Vector3(b.x, b.y, b.z);
    if (bp.distanceTo(this.idlePos) > 0.6) {
      this.idlePos.copy(bp);
      this.idleT = 0;
    } else if ((this.idleT += dt) > 9) {
      arena.announce('🟨 Bola parada — o juiz reinicia no meio!', 'tip');
      arena.sound('beep', 0.8);
      this.resetBall();
      this.idleT = 0;
    }
    // bola presa em cima do alambrado / fora do estádio: volta ao meio
    if (b.y < -5 || Math.abs(b.x) > FIELD_X + 4 || Math.abs(b.z) > FIELD_Z + 3) this.resetBall();
  }

  focusPoints() {
    const b = this.ball.translation();
    return [new THREE.Vector3(b.x, b.y, b.z)];
  }

  /** Para os robôs: onde ir agora (bola, gol, marcação). */
  botObjective(f: Fighter): { to: THREE.Vector3; strike: boolean } | null {
    const o = this.objective(f);
    if (o) {
      // nunca manda o robô para dentro da parede (só para dentro do gol, se for o caso)
      const inGoal = Math.abs(o.to.z) < GOAL_W - 0.4;
      o.to.x = THREE.MathUtils.clamp(o.to.x, -FIELD_X - (inGoal ? 1.5 : -0.5), FIELD_X + (inGoal ? 1.5 : -0.5));
      o.to.z = THREE.MathUtils.clamp(o.to.z, -FIELD_Z + 0.5, FIELD_Z - 0.5);
    }
    return o;
  }

  private objective(f: Fighter): { to: THREE.Vector3; strike: boolean } | null {
    if (f.team < 0 || this.resetT >= 0) return null;
    const ballV = this.ball.translation();
    const ball = new THREE.Vector3(ballV.x, 0, ballV.z);
    const me = f.pos('pelvis').setY(0);
    const goal = this.attackGoal(f.team);
    const own = this.attackGoal(1 - f.team).multiplyScalar(0.92);
    const mates = (f.teamMates ?? []).filter((x) => x.alive && !x.removed && !x.ko);
    // quem do time está mais perto da bola vai nela; o outro fica na defesa (ou briga)
    const myD = me.distanceTo(ball);
    const closest = mates.every((x) => x.pos('pelvis').setY(0).distanceTo(ball) >= myD - 0.3);
    const atkSign = Math.sign(goal.x);
    if (!closest && f.role === 'zagueiro' && ball.x * atkSign > 2) {
      // bola no ataque: sobe para a frente do gol adversário (rebote / segunda bola)
      return { to: new THREE.Vector3(goal.x - atkSign * 4.5, 0, -ball.z * 0.3), strike: myD < 2 };
    }
    if (!closest && f.role === 'zagueiro') {
      // fica entre a bola e o próprio gol
      const spot = own.clone().lerp(ball, 0.35);
      spot.z = THREE.MathUtils.clamp(spot.z, -GOAL_W - 1, GOAL_W + 1);
      return { to: spot, strike: myD < 2.2 };
    }
    if (!closest && f.role === 'brigão') return null; // vai brigar normalmente
    // atacante: chega por trás da bola (lado contrário ao gol) e empurra/chuta para o gol
    const toGoal = goal.clone().sub(ball).setY(0).normalize();
    // rente à lateral: conduz a bola ao longo da parede (não dá para ficar "atrás" dela)
    if (Math.abs(ball.z) > FIELD_Z - 1.8 && Math.abs(goal.x - ball.x) > 3) toGoal.set(Math.sign(goal.x - ball.x), 0, -Math.sign(ball.z) * 0.6).normalize();
    const behind = ball.clone().addScaledVector(toGoal, -(BALL_R + 0.9));
    const fromBall = me.clone().sub(ball).setY(0);
    const aligned = fromBall.lengthSq() > 0.01 && fromBall.normalize().dot(toGoal) < -0.55;
    if (aligned) return { to: ball.clone().addScaledVector(toGoal, 2), strike: myD < 1.9 };
    // contorna a bola (não empurra para o lado errado)
    const side = new THREE.Vector3(-toGoal.z, 0, toGoal.x);
    if (me.clone().sub(ball).dot(side) < 0) side.negate();
    const around = myD < 2.4 ? ball.clone().addScaledVector(side, 1.3).addScaledVector(toGoal, -1.5) : behind;
    return { to: around, strike: false };
  }

  safeSpot(p: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(THREE.MathUtils.clamp(p.x, -FIELD_X + 1, FIELD_X - 1), 0, THREE.MathUtils.clamp(p.z, -FIELD_Z + 1, FIELD_Z - 1));
  }

  deathAt(_p: THREE.Vector3): DeathKind {
    return 'none';
  }
}
