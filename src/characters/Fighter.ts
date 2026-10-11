import * as THREE from 'three';
import { Ragdoll, DIM, PART_NAMES, BODY_MASS, type PartName } from './Ragdoll';
import { buildSkin, type Appearance, type SkinResult } from './Skins';
import { muscleAim, muscleOrient, yawPitchRoll, angleDiff } from './Animation';
import { Hand } from '../physics/Grab';
import { Physics, v3, q4, GRAVITY, type ColliderInfo } from '../physics/Physics';
import { LinkSet } from '../physics/BodyLink';
import { emptyControl, type ControlState, type InputSource } from '../input/types';
import type RAPIER from '@dimforge/rapier3d-compat';

// ------------------------------------------------------------
// O lutador: lê os comandos, mexe os músculos, soca, agarra,
// fica tonto e desmaia. Toda a "graça" mole mora aqui.
// ------------------------------------------------------------

export type HitKind = 'punch' | 'headbutt' | 'kick' | 'throw' | 'hazard' | 'fall' | 'shove';
export type FighterEvent =
  | 'jump'
  | 'land'
  | 'ko'
  | 'wake'
  | 'grab'
  | 'throw'
  | 'punch'
  | 'headbutt'
  | 'kick'
  | 'escape'
  | 'climb'
  | 'scream';

/** O que o lutador precisa saber do mundo à sua volta. */
export interface FighterEnv {
  physics: Physics;
  time: number;
  fighters: Fighter[];
  camFwd: THREE.Vector3;
  camRight: THREE.Vector3;
  onHit(attacker: Fighter | null, victim: Fighter, power: number, point: THREE.Vector3, dir: THREE.Vector3, kind: HitKind): void;
  onPropHit(attacker: Fighter, body: RAPIER.RigidBody, point: THREE.Vector3, dir: THREE.Vector3, power: number): void;
  onEvent(f: Fighter, ev: FighterEvent, amount?: number): void;
}

// Ajustes de jogo (mexa aqui para mudar a sensação).
export const TUNING = {
  walkSpeed: 4.3,
  jumpSpeed: 7.4,
  turnSpeed: 9,
  koBase: 2.8, // segundos de nocaute no primeiro desmaio
  koStep: 0.9, // cada nocaute dura mais
  koMax: 7,
  koLimit: 22, // tempo total desmaiado que elimina
  dizzyDecay: 7, // quanto a tontura cai por segundo
  punchPower: 13,
  headbuttPower: 22,
  kickPower: 26,
};

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const AXIS_DOWN = new THREE.Vector3(0, -1, 0);

interface Attack {
  t: number; // tempo desde o início (-1 = parado)
  hit: Set<Fighter>; // quem já levou desta vez
  aim: THREE.Vector3; // direção do golpe
  point: THREE.Vector3; // ponto mirado (no mundo)
}
const newAttack = (): Attack => ({ t: -1, hit: new Set(), aim: new THREE.Vector3(), point: new THREE.Vector3() });

export class Fighter {
  ragdoll: Ragdoll;
  skin: SkinResult;
  root = new THREE.Group();
  links = new LinkSet();
  hands: { L: Hand; R: Hand };

  alive = true;
  /** Já foi tirado do mundo (corpo removido)? */
  removed = false;
  eliminatedAt = -1;

  dizzy = 0;
  koTimer = 0;
  koCount = 0;
  koTotal = 0;
  strength = 1;
  hurtT = 0;
  lastAttacker: Fighter | null = null;
  lastAttackerAt = -99;

  facing: number;
  grounded = false;
  groundDist = 99;
  groundCollider: RAPIER.Collider | null = null;
  airTime = 0;
  walkPhase = 0;
  speed = 0;
  jumpT = 0;
  jumpCooldown = 0;
  pullT = -1;
  escape = 0;
  grabbedBy = 0;

  input: ControlState = emptyControl();
  prev: ControlState = emptyControl();
  frozen = false; // durante a contagem regressiva

  punchL = newAttack();
  punchR = newAttack();
  headbutt = newAttack();
  kick = newAttack();

  private prevVel = new THREE.Vector3();
  private impactGrace = 0;
  private blinkT = Math.random() * 3;
  private squash = 0;
  private screamT = 0;

  constructor(
    public index: number,
    public name: string,
    public appearance: Appearance,
    public source: InputSource,
    private physics: Physics,
    spawn: THREE.Vector3,
    yaw: number,
    scene: THREE.Scene,
  ) {
    this.facing = yaw;
    this.ragdoll = new Ragdoll(physics, index, spawn, yaw, this);
    this.hands = {
      L: new Hand('L', this.ragdoll.parts.foreL.body, physics, this.ragdoll.bit),
      R: new Hand('R', this.ragdoll.parts.foreR.body, physics, this.ragdoll.bit),
    };
    this.skin = buildSkin(appearance);
    for (const n of PART_NAMES) {
      this.root.add(this.skin.parts[n]);
      this.links.add(this.ragdoll.parts[n].body, this.skin.parts[n]);
    }
    scene.add(this.root);
    // Se algum corpo que eu seguro sumir, solto a mão antes.
    physics.onBodyRemoved((b) => {
      for (const h of [this.hands.L, this.hands.R]) if (h.target === b || h.fore === b) h.release(0);
    });
  }

  get isBot() {
    return this.source.kind === 'bot';
  }
  get ko() {
    return this.koTimer > 0;
  }
  part(n: PartName) {
    return this.ragdoll.parts[n].body;
  }
  /** Última posição conhecida (para quando o corpo já foi removido). */
  private lastPos = new THREE.Vector3();
  pos(n: PartName = 'chest', out = new THREE.Vector3()) {
    // Ler um corpo removido trava o Rapier: devolve a última posição.
    if (this.removed) return out.copy(this.lastPos);
    return v3(this.part(n).translation(), out);
  }
  vel(n: PartName = 'chest', out = new THREE.Vector3()) {
    if (this.removed) return out.set(0, 0, 0);
    return v3(this.part(n).linvel(), out);
  }
  fwd(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }
  /** Lado esquerdo do boneco. */
  left(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.facing), 0, -Math.sin(this.facing));
  }

  /** Muda a aparência sem recriar o corpo (tela de escolha). */
  setAppearance(app: Appearance) {
    this.appearance = app;
    for (const n of PART_NAMES) this.root.remove(this.skin.parts[n]);
    this.skin.materials.forEach((m) => m.dispose());
    this.skin = buildSkin(app);
    this.links.links = [];
    for (const n of PART_NAMES) {
      this.root.add(this.skin.parts[n]);
      this.links.add(this.ragdoll.parts[n].body, this.skin.parts[n]);
    }
  }

  // ---------------------------------------------------------- passo
  step(env: FighterEnv, dt: number) {
    if (this.removed) return;
    this.prev = this.input;
    this.input = this.alive && !this.frozen ? this.source.read() : emptyControl();
    const inp = this.input;
    const pressed = (k: keyof ControlState) => !!inp[k] && !this.prev[k];

    this.sense();
    this.hands.L.update(dt);
    this.hands.R.update(dt);
    this.updateHealth(env, dt);

    const canAct = this.alive && !this.ko;

    // ----- força dos músculos
    let targetStrength = canAct ? 1 : 0.02;
    if (canAct && this.grabbedBy >= 2) targetStrength = 0.55;
    if (canAct && this.hurtT > 0) targetStrength = Math.min(targetStrength, 0.6);
    // Ao acordar a força volta devagar (levantando cambaleando).
    const rate = targetStrength > this.strength ? 1.6 : 12;
    this.strength += (targetStrength - this.strength) * Math.min(1, rate * dt);

    // ----- direção desejada (relativa à câmera)
    const move = new THREE.Vector3()
      .addScaledVector(env.camRight, inp.moveX)
      .addScaledVector(env.camFwd, inp.moveY);
    if (move.lengthSq() > 1) move.normalize();
    const moveMag = move.length();

    if (canAct) {
      if (moveMag > 0.15 && this.headbutt.t < 0) {
        const want = Math.atan2(move.x, move.z);
        this.facing += angleDiff(this.facing, want) * Math.min(1, TUNING.turnSpeed * dt);
      }

      // Pular (ou escalar, se estiver pendurado em algo fixo)
      this.jumpCooldown -= dt;
      if (pressed('jump')) {
        const ledge = this.ledgeHand();
        if (ledge) this.startPull(env);
        else if (this.grounded && this.jumpCooldown <= 0) this.doJump(env);
      }
      // Escapar quando alguém está me segurando: apertar botões!
      if (this.grabbedBy > 0 && (pressed('jump') || pressed('punchL') || pressed('punchR'))) {
        this.escape++;
        if (this.escape >= 7) {
          this.escape = 0;
          env.onEvent(this, 'escape');
        }
      }
      if (this.grabbedBy === 0) this.escape = Math.max(0, this.escape - dt);

      // Golpes
      if (pressed('headbutt') && this.headbutt.t < 0) this.startAttack(this.headbutt, env, 'headbutt');
      for (const side of ['L', 'R'] as const) {
        const key = side === 'L' ? 'punchL' : 'punchR';
        if (!pressed(key)) continue;
        const hand = this.hands[side];
        if (hand.holding() && !hand.holdingStatic()) this.throwHeld(env, side);
        else if (!this.grounded && this.airTime > 0.08 && this.kick.t < 0) this.startAttack(this.kick, env, 'kick');
        else {
          const a = side === 'L' ? this.punchL : this.punchR;
          if (a.t < 0 || a.t > 0.3) this.startAttack(a, env, 'punch');
        }
      }

      // Agarrar enquanto segura o gatilho
      for (const side of ['L', 'R'] as const) {
        const hand = this.hands[side];
        const want = side === 'L' ? inp.grabL : inp.grabR;
        if (want && !hand.holding()) {
          const wasWanting = side === 'L' ? this.prev.grabL : this.prev.grabR;
          if (!wasWanting) this.faceNearest(env, 2.2, 0.5);
          if (hand.tryGrab()) env.onEvent(this, 'grab');
        } else if (!want && hand.holding()) hand.release();
      }
    } else {
      // Desmaiado: solta tudo.
      if (this.hands.L.holding()) this.hands.L.release();
      if (this.hands.R.holding()) this.hands.R.release();
      this.punchL.t = this.punchR.t = this.headbutt.t = this.kick.t = -1;
      this.pullT = -1;
    }

    this.moveBody(move, moveMag, dt);
    this.poseBody(env, dt);
    this.runAttacks(env, dt);
    this.updateFace(dt);
  }

  // Raio para baixo: estou no chão?
  private sense() {
    const p = this.pos('pelvis');
    const hit = this.physics.rayDown(p, DIM.hover + 0.8, this.ragdoll.bit);
    this.groundDist = hit ? hit.dist : 99;
    this.groundCollider = hit ? hit.collider : null;
    // O raio pode acertar o próprio lutador que eu seguro... tudo bem, vira apoio.
    this.grounded = this.groundDist < DIM.hover + 0.3;
  }

  private ledgeHand(): Hand | null {
    for (const h of [this.hands.L, this.hands.R]) {
      if (!h.holdingStatic()) continue;
      const a = h.anchorWorld();
      // Só conta se a mão estiver acima do quadril (senão é só segurar o chão).
      if (a.y > this.pos('pelvis').y - 0.2) return h;
    }
    return null;
  }

  private doJump(env: FighterEnv) {
    this.jumpT = 0.35;
    this.jumpCooldown = 0.45;
    for (const n of PART_NAMES) {
      const b = this.part(n);
      const v = b.linvel();
      const vy = n === 'legL' || n === 'legR' ? TUNING.jumpSpeed * 0.7 : TUNING.jumpSpeed;
      b.setLinvel({ x: v.x, y: Math.max(v.y, vy), z: v.z }, true);
    }
    env.onEvent(this, 'jump');
  }

  private startPull(env: FighterEnv) {
    this.pullT = 0;
    // Mão que ficou lá embaixo atrapalha: solta para pegar mais alto.
    const top = Math.max(this.hands.L.holdingStatic() ? this.hands.L.anchorWorld().y : -99, this.hands.R.holdingStatic() ? this.hands.R.anchorWorld().y : -99);
    for (const h of [this.hands.L, this.hands.R]) {
      if (h.holding() && h.anchorWorld().y < top - 0.35) h.release(0.25);
    }
    env.onEvent(this, 'climb');
  }

  private throwHeld(env: FighterEnv, side: 'L' | 'R') {
    const hand = this.hands[side];
    const info = hand.targetInfo as ColliderInfo | null;
    const target = hand.target;
    const other = side === 'L' ? this.hands.R : this.hands.L;
    if (other.target === target) other.release(0.25);
    hand.release(0.25);
    if (!target || !target.isValid()) return;
    const dir = this.fwd().multiplyScalar(1).add(new THREE.Vector3(0, 0.55, 0)).normalize();
    if (info?.kind === 'fighter') {
      const f = info.owner as Fighter;
      // Desmaiado voa longe; acordado resiste e só leva um empurrão.
      f.knock(dir, f.ko ? 8.5 : f.dizzy > 60 ? 6 : 4.2);
      f.lastAttacker = this;
      f.lastAttackerAt = env.time;
      f.addDizzy(8);
    } else {
      const v = target.linvel();
      target.setLinvel({ x: v.x + dir.x * 10, y: v.y + dir.y * 10, z: v.z + dir.z * 10 }, true);
    }
    env.onEvent(this, 'throw');
  }

  /** Vira um pouco para o inimigo mais perto que estiver na frente. */
  private faceNearest(env: FighterEnv, range: number, amount: number) {
    const me = this.pos('chest');
    const f = this.fwd();
    let best: THREE.Vector3 | null = null;
    let bestD = range;
    for (const o of env.fighters) {
      if (o === this || !o.alive || o.removed) continue;
      const d = o.pos('chest').sub(me);
      d.y = 0;
      const dist = d.length();
      if (dist > bestD || d.normalize().dot(f) < 0.2) continue;
      best = d;
      bestD = dist;
    }
    if (best) this.facing += angleDiff(this.facing, Math.atan2(best.x, best.z)) * amount;
  }

  private startAttack(a: Attack, env: FighterEnv, kind: 'punch' | 'headbutt' | 'kick') {
    a.t = 0;
    a.hit.clear();
    // Mira automática: vira um pouco para o inimigo mais perto na frente.
    const me = this.pos('chest');
    const f = this.fwd();
    let best: Fighter | null = null;
    let bestD = 2.8;
    for (const o of env.fighters) {
      if (o === this || !o.alive || o.removed) continue;
      const d = o.pos('chest').sub(me);
      const dist = d.length();
      if (dist > bestD) continue;
      d.y = 0;
      if (d.normalize().dot(f) < 0.25) continue;
      best = o;
      bestD = dist;
    }
    if (best) {
      const aimAt = best.pos(kind === 'kick' ? 'pelvis' : 'head').lerp(best.pos('chest'), 0.55);
      const d = aimAt.clone().sub(me);
      this.facing += angleDiff(this.facing, Math.atan2(d.x, d.z)) * 0.6;
      a.aim.copy(d.normalize());
      // Mira um pouco "através" do alvo, para o punho chegar com força.
      a.point.copy(aimAt).addScaledVector(a.aim, 0.35);
    } else {
      a.aim.copy(this.fwd()).add(new THREE.Vector3(0, kind === 'punch' ? 0.1 : 0, 0)).normalize();
      a.point.copy(me).addScaledVector(this.fwd(), 1.4).add(new THREE.Vector3(0, 0.3, 0));
    }
    env.onEvent(this, kind);
  }

  /** Empurra o corpo todo numa direção (usado por golpes e perigos). */
  knock(dir: THREE.Vector3, speed: number, partBoost?: PartName) {
    for (const n of PART_NAMES) {
      const b = this.part(n);
      const k = n === partBoost ? 1.6 : n === 'chest' || n === 'head' ? 1 : 0.8;
      const v = b.linvel();
      b.setLinvel({ x: v.x + dir.x * speed * k, y: v.y + dir.y * speed * k, z: v.z + dir.z * speed * k }, true);
    }
    this.impactGrace = 0.25;
  }

  addDizzy(n: number) {
    if (!this.alive) return;
    if (this.ko) {
      // Apanhar desmaiado prolonga um pouquinho o nocaute.
      this.koTimer = Math.min(this.koTimer + n * 0.02, TUNING.koMax);
      return;
    }
    this.dizzy += n;
    if (this.dizzy >= 100) this.knockOut();
  }

  knockOut() {
    if (this.ko || !this.alive) return;
    this.koTimer = Math.min(TUNING.koBase + this.koCount * TUNING.koStep, TUNING.koMax);
    this.koCount++;
    this.dizzy = 100;
    this.hands.L.release();
    this.hands.R.release();
    this._pendingKo = true; // o evento sai no próximo passo
  }
  _pendingKo = false;

  /** Recebe um golpe (chamado pela Arena). */
  receiveHit(power: number, dir: THREE.Vector3, part: PartName | undefined, knockSpeed: number) {
    this.hurtT = 0.28;
    this.squash = Math.min(0.35, 0.12 + power * 0.01);
    this.knock(dir, knockSpeed, part);
    this.addDizzy(power);
  }

  private updateHealth(env: FighterEnv, dt: number) {
    this.hurtT -= dt;
    this.impactGrace -= dt;
    if (this._pendingKo) {
      this._pendingKo = false;
      env.onEvent(this, 'ko');
    }
    if (this.ko) {
      this.koTimer -= dt;
      this.koTotal += dt;
      if (this.koTimer <= 0) {
        this.koTimer = 0;
        this.dizzy = 35;
        this.strength = 0.05;
        env.onEvent(this, 'wake');
      }
    } else if (this.hurtT < -1.2) {
      this.dizzy = Math.max(0, this.dizzy - TUNING.dizzyDecay * dt);
    }

    // Batida forte (queda, parede): muda brusca de velocidade.
    const v = this.vel('chest');
    const dv = v.distanceTo(this.prevVel);
    if (this.impactGrace <= 0 && dv > 11 && this.alive) {
      const dmg = (dv - 11) * 6;
      env.onHit(null, this, dmg, this.pos('chest'), this.prevVel.clone().normalize().negate(), 'fall');
    }
    this.prevVel.copy(v);

    // Ar / chão
    if (this.grounded) {
      if (this.airTime > 0.35) env.onEvent(this, 'land', Math.min(1, this.airTime));
      this.airTime = 0;
    } else this.airTime += dt;
    this.jumpT -= dt;

    if (v.y < -9 && this.screamT <= 0 && this.alive) {
      this.screamT = 2;
      env.onEvent(this, 'scream');
    }
    this.screamT -= dt;
  }

  // Andar, flutuar sobre o chão (as "molas" das pernas) e escalar.
  private moveBody(move: THREE.Vector3, moveMag: number, dt: number) {
    const s = this.strength;
    const pel = this.part('pelvis');
    const chest = this.part('chest');
    const heavy = this.hands.L.holding() || this.hands.R.holding() ? 0.7 : 1;
    const target = move.clone().multiplyScalar(TUNING.walkSpeed * heavy);

    const pv = pel.linvel();
    this.speed = Math.hypot(pv.x, pv.z);
    this.walkPhase += dt * (2 + this.speed * 2.6);

    if (this.pullT >= 0) {
      // Escalando: puxa o corpo para cima e por cima da borda.
      this.pullT += dt;
      const hand = this.ledgeHand();
      const anchor = hand ? hand.anchorWorld() : this.pos('chest');
      const toAnchor = anchor.clone().sub(this.pos('chest'));
      toAnchor.y = 0;
      if (toAnchor.lengthSq() > 0.0001) toAnchor.normalize();
      // Enquanto o peito está abaixo da mão, sobe sem ir para a parede.
      const hz = this.pos('chest').y > anchor.y - 0.4 ? 1.5 : -0.4;
      for (const b of [pel, chest]) {
        const v = b.linvel();
        b.setLinvel({ x: v.x + (toAnchor.x * hz - v.x) * 0.25, y: v.y + (6.2 - v.y) * 0.35, z: v.z + (toAnchor.z * hz - v.z) * 0.25 }, true);
      }
      const above = this.pos('chest').y > anchor.y - 0.25;
      if (!hand || above || this.pullT > 0.8) {
        this.pullT = -1;
        if (hand && above) {
          // Chegou lá em cima: solta e pula por cima da borda.
          this.hands.L.release(0.35);
          this.hands.R.release(0.35);
          const f = this.fwd();
          for (const n of PART_NAMES) {
            const b = this.part(n);
            const v = b.linvel();
            b.setLinvel({ x: f.x * 3.2, y: Math.max(v.y, 7), z: f.z * 3.2 }, true);
          }
          this.jumpT = 0.3;
        }
      }
      return;
    }

    if (s < 0.1) return; // mole demais para se mexer

    const ctrl = (this.grounded ? 0.2 : 0.045) * s;
    for (const b of [pel, chest]) {
      const v = b.linvel();
      b.setLinvel({ x: v.x + (target.x - v.x) * ctrl, y: v.y, z: v.z + (target.z - v.z) * ctrl }, true);
    }

    // "Mola" que segura o quadril na altura certa = ficar em pé.
    // Compensa o peso do corpo todo e puxa para a altura desejada.
    if (this.grounded && this.jumpT <= 0) {
      const bob = Math.sin(this.walkPhase * 2) * 0.035 * Math.min(1, this.speed / 3);
      const err = DIM.hover + bob - this.groundDist;
      const vy = pel.linvel().y;
      const acc = THREE.MathUtils.clamp(err * 170 - vy * 20, -25, 70) - GRAVITY;
      const imp = BODY_MASS * acc * dt * s;
      pel.applyImpulse({ x: 0, y: imp * 0.6, z: 0 }, true);
      chest.applyImpulse({ x: 0, y: imp * 0.4, z: 0 }, true);
    }
    void moveMag;
  }

  // A pose de cada pedaço (é aqui que mora a "animação por código").
  private poseBody(env: FighterEnv, dt: number) {
    const s = this.strength;
    const t = env.time + this.index * 1.7;
    const fwd = this.fwd();
    const left = this.left();
    const spd = Math.min(1, this.speed / TUNING.walkSpeed);

    // ----- tronco: inclina para frente ao correr, treme parado (gelatina)
    let pitch = spd * 0.22 + Math.sin(t * 1.7) * 0.03;
    let roll = Math.sin(t * 2.3) * 0.035;
    let twist = 0;
    if (this.hurtT > 0) pitch -= 0.45; // se encolhe para trás ao levar soco
    const hb = this.headbutt.t;
    if (hb >= 0) pitch += hb < 0.08 ? -0.45 : 1.05;
    const kt = this.kick.t;
    if (kt >= 0) pitch -= 0.7;
    for (const [a, sign] of [
      [this.punchL, -1],
      [this.punchR, 1],
    ] as const) {
      if (a.t < 0) continue;
      // O corpo gira junto com o soco.
      twist += a.t < 0.07 ? -sign * 0.3 : a.t < 0.3 ? sign * 0.55 : 0;
    }
    if (this.pullT >= 0) pitch += 0.4;
    roll += Math.sin(this.walkPhase) * 0.06 * spd;

    const chestQ = yawPitchRoll(this.facing + twist, pitch, roll);
    const pelvisQ = yawPitchRoll(this.facing, spd * 0.08, 0);
    const headQ = yawPitchRoll(this.facing + twist * 0.5, pitch * 0.4 - 0.05, roll * 0.5);
    const hard = this.headbutt.t >= 0 || this.kick.t >= 0 ? 1.4 : 1;
    muscleOrient(this.part('chest'), chestQ, 0.32 * s * hard);
    muscleOrient(this.part('pelvis'), pelvisQ, 0.32 * s);
    muscleOrient(this.part('head'), headQ, 0.22 * s);

    // ----- pernas: passo para frente e para trás
    const legAmp = this.grounded ? 0.75 * spd : 0.25;
    for (const [side, ph] of [
      ['L', 0],
      ['R', Math.PI],
    ] as const) {
      const leg = this.part(('leg' + side) as PartName);
      const d = DOWN.clone();
      if (kt >= 0 && kt < 0.5) {
        d.copy(fwd).multiplyScalar(1.1).addScaledVector(DOWN, 0.25);
      } else if (!this.grounded) {
        d.addScaledVector(fwd, 0.35 + Math.sin(t * 9 + ph) * 0.2);
      } else {
        d.addScaledVector(fwd, Math.sin(this.walkPhase + ph) * legAmp);
      }
      muscleAim(leg, AXIS_DOWN, d, (kt >= 0 ? 0.6 : 0.3) * s, 16, 26, fwd);
    }

    // ----- braços
    const reachPitch = 0.25 + this.input.armY * 0.95; // altura dos braços
    const chestPos = this.pos('chest');
    for (const [side, sx, ph] of [
      ['L', 1, Math.PI],
      ['R', -1, 0],
    ] as const) {
      const arm = this.part(('arm' + side) as PartName);
      const fore = this.part(('fore' + side) as PartName);
      const hand = this.hands[side];
      const sideV = left.clone().multiplyScalar(sx);
      const shoulder = v3(arm.translation());
      const punch = side === 'L' ? this.punchL : this.punchR;
      const grabbing = (side === 'L' ? this.input.grabL : this.input.grabR) && this.alive && !this.ko;
      let upper: THREE.Vector3;
      let lower: THREE.Vector3;
      let str: number;

      if (punch.t >= 0 && punch.t < 0.07) {
        // Puxa o braço para trás (preparando)
        upper = fwd.clone().multiplyScalar(-0.7).addScaledVector(DOWN, 0.6).addScaledVector(sideV, 0.4);
        lower = fwd.clone().multiplyScalar(0.3).addScaledVector(UP, 0.2);
        str = 0.7;
      } else if (punch.t >= 0.07 && punch.t < 0.3) {
        // Braço esticado do ombro até o alvo
        upper = punch.point.clone().sub(shoulder);
        lower = upper.clone();
        str = 1;
      } else if (this.pullT >= 0) {
        upper = DOWN.clone().addScaledVector(fwd, 0.4);
        lower = DOWN.clone().addScaledVector(fwd, 0.2);
        str = 0.8;
      } else if (grabbing || hand.holding()) {
        // Braços esticados para frente, se juntando na frente do peito
        const reach = chestPos
          .clone()
          .addScaledVector(fwd, 1.05 * Math.cos(reachPitch))
          .addScaledVector(UP, 1.05 * Math.sin(reachPitch) + 0.05)
          .addScaledVector(sideV, 0.16);
        upper = reach.sub(shoulder);
        lower = upper.clone();
        str = hand.holding() ? 0.7 : 0.85;
      } else if (this.hurtT > 0) {
        // Se protege: braços junto do corpo
        upper = DOWN.clone().addScaledVector(fwd, 0.5).addScaledVector(sideV, -0.3);
        lower = UP.clone().addScaledVector(fwd, 0.6).addScaledVector(sideV, -0.4);
        str = 0.4;
      } else if (!this.grounded && this.airTime > 0.25) {
        // Caindo: braços para cima, desesperado
        upper = UP.clone().addScaledVector(sideV, 0.8).addScaledVector(fwd, Math.sin(t * 14 + ph) * 0.5);
        lower = upper.clone().addScaledVector(UP, 0.4);
        str = 0.3;
      } else {
        // Balança os braços ao andar
        const swing = Math.sin(this.walkPhase + ph) * 0.8 * spd;
        upper = DOWN.clone().addScaledVector(fwd, swing).addScaledVector(sideV, 0.22 + Math.sin(t * 1.3 + ph) * 0.04);
        lower = upper.clone().addScaledVector(fwd, 0.35);
        str = 0.18;
      }
      muscleAim(arm, AXIS_DOWN, upper, str * s);
      muscleAim(fore, AXIS_DOWN, lower, str * s);
    }
  }

  // Socos, cabeçadas e voadoras: dão impulso e testam se acertaram.
  private runAttacks(env: FighterEnv, dt: number) {
    const dead = !this.alive || this.ko;
    for (const [a, side] of [
      [this.punchL, 'L'],
      [this.punchR, 'R'],
    ] as const) {
      if (a.t < 0) continue;
      const before = a.t;
      a.t += dt;
      if (dead) {
        a.t = -1;
        continue;
      }
      const fore = this.part(('fore' + side) as PartName);
      if (before < 0.07 && a.t >= 0.07) {
        // Lança o punho na direção do alvo!
        const dir = a.point.clone().sub(this.hands[side].position()).normalize();
        const v = fore.linvel();
        fore.setLinvel({ x: v.x + dir.x * 11, y: v.y + dir.y * 11, z: v.z + dir.z * 11 }, true);
        const arm = this.part(('arm' + side) as PartName);
        const v2 = arm.linvel();
        arm.setLinvel({ x: v2.x + dir.x * 5, y: v2.y + dir.y * 5, z: v2.z + dir.z * 5 }, true);
        // Dá um passinho para frente junto com o soco
        const c = this.part('chest');
        const cv = c.linvel();
        c.setLinvel({ x: cv.x + a.aim.x * 1.6, y: cv.y, z: cv.z + a.aim.z * 1.6 }, true);
      }
      if (a.t >= 0.08 && a.t < 0.28) {
        this.testHit(env, this.hands[side].position(), DIM.handR + 0.1, a, TUNING.punchPower, 'punch', fore);
      }
      if (a.t > 0.42) a.t = -1;
    }

    const hb = this.headbutt;
    if (hb.t >= 0) {
      const before = hb.t;
      hb.t += dt;
      if (dead) hb.t = -1;
      else {
        if (before < 0.08 && hb.t >= 0.08) {
          const h = this.part('head');
          const v = h.linvel();
          h.setLinvel({ x: v.x + hb.aim.x * 8, y: v.y + 1, z: v.z + hb.aim.z * 8 }, true);
          const c = this.part('chest');
          const cv = c.linvel();
          c.setLinvel({ x: cv.x + hb.aim.x * 3, y: cv.y, z: cv.z + hb.aim.z * 3 }, true);
        }
        if (hb.t >= 0.1 && hb.t < 0.32) this.testHit(env, this.pos('head'), DIM.headR + 0.08, hb, TUNING.headbuttPower, 'headbutt', this.part('head'));
        if (hb.t > 0.7) hb.t = -1;
      }
    }

    const k = this.kick;
    if (k.t >= 0) {
      const before = k.t;
      k.t += dt;
      if (dead) k.t = -1;
      else {
        if (before === 0) {
          for (const n of ['pelvis', 'legL', 'legR'] as PartName[]) {
            const b = this.part(n);
            const v = b.linvel();
            b.setLinvel({ x: v.x + k.aim.x * 5, y: v.y + 1.5, z: v.z + k.aim.z * 5 }, true);
          }
        }
        if (k.t >= 0.06 && k.t < 0.5) {
          for (const n of ['legL', 'legR'] as PartName[]) {
            const leg = this.part(n);
            const foot = v3(leg.translation()).add(new THREE.Vector3(0, -DIM.legHH - 0.05, 0).applyQuaternion(q4(leg.rotation())));
            this.testHit(env, foot, DIM.legR + 0.12, k, TUNING.kickPower, 'kick', leg);
          }
        }
        if (k.t > 0.65 || (this.grounded && k.t > 0.2)) k.t = -1;
      }
    }
  }

  private testHit(env: FighterEnv, p: THREE.Vector3, r: number, a: Attack, power: number, kind: HitKind, striker: RAPIER.RigidBody) {
    const sv = v3(striker.linvel());
    this.physics.overlapBall(p, r, this.ragdoll.bit, (c) => {
      const info = this.physics.getInfo(c);
      if (!info) return;
      if (info.kind === 'fighter') {
        const victim = info.owner as Fighter;
        if (victim === this || a.hit.has(victim) || !victim.alive) return;
        // Precisa estar indo rápido para valer como golpe.
        const rel = sv.clone().sub(victim.vel(info.part as PartName));
        if (rel.length() < 1.8) return;
        a.hit.add(victim);
        const dir = a.aim.clone();
        dir.y = Math.max(dir.y, 0.15);
        dir.normalize();
        const mult = info.part === 'head' ? 1.35 : 1;
        env.onHit(this, victim, power * mult, p.clone(), dir, kind);
      } else if (info.kind === 'prop') {
        const body = c.parent();
        if (!body || a.hit.size > 3) return;
        if ((a as Attack & { props?: Set<number> }).props?.has(body.handle)) return;
        ((a as Attack & { props?: Set<number> }).props ??= new Set()).add(body.handle);
        env.onPropHit(this, body, p.clone(), a.aim.clone(), power);
      }
    });
  }

  // ----- rosto
  private updateFace(dt: number) {
    const f = this.skin.face;
    const ko = this.ko || !this.alive;
    for (const x of f.xEyes) x.visible = ko;
    for (const p of f.pupils) p.visible = !ko;
    this.blinkT -= dt;
    let eyeScale = 1;
    if (this.blinkT < 0) {
      eyeScale = 0.15;
      if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    }
    if (this.hurtT > 0) eyeScale = 0.35;
    if (ko) eyeScale = 1;
    for (const e of f.eyes) e.scale.y = eyeScale;
    const shout = ko || this.hurtT > 0 || this.screamT > 0.8 || this.headbutt.t >= 0;
    f.mouth.visible = !shout;
    f.mouthO.visible = shout;
    // Gelatina: amassa e volta
    this.squash *= Math.pow(0.02, dt);
    const wob = this.squash * Math.sin(performance.now() * 0.03);
    this.skin.parts.chest.scale.set(1 + wob, 1 - wob, 1 + wob);
    this.skin.parts.head.scale.set(1 - wob * 0.6, 1 + wob * 0.6, 1 - wob * 0.6);
  }

  /** Atualiza os desenhos (chamado a cada quadro). */
  render(alpha: number) {
    if (this.removed) return;
    this.links.apply(alpha);
    // reaplica a escala de "gelatina" depois do apply (que só mexe em posição/rotação)
  }

  afterPhysics() {
    if (this.removed) return;
    this.links.capture();
    v3(this.part('chest').translation(), this.lastPos);
  }

  /** Tira o lutador do jogo (caiu, desmaiou demais...). */
  eliminate(time: number) {
    if (!this.alive) return;
    this.alive = false;
    this.eliminatedAt = time;
    this.koTimer = 0;
    this.hands.L.release();
    this.hands.R.release();
  }

  /** Remove o corpo do mundo de física e o desenho da cena. */
  removeFromWorld() {
    if (this.removed) return;
    v3(this.part('chest').translation(), this.lastPos);
    this.removed = true;
    this.hands.L.release(0);
    this.hands.R.release(0);
    this.ragdoll.dispose();
    this.root.parent?.remove(this.root);
  }

  dispose() {
    this.removeFromWorld();
    this.skin.materials.forEach((m) => m.dispose());
  }

  /** Teleporta o boneco inteiro (usado no saguão / começo de rodada). */
  teleport(origin: THREE.Vector3, yaw: number) {
    this.facing = yaw;
    const base = this.pos('pelvis').clone();
    base.y -= DIM.pelvisY;
    for (const n of PART_NAMES) {
      const b = this.part(n);
      const p = v3(b.translation()).sub(base).add(origin);
      b.setTranslation(p, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.links.capture();
    this.links.capture();
  }
}
