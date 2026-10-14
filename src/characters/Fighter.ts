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

export type HitKind = 'punch' | 'bigpunch' | 'headbutt' | 'kick' | 'throw' | 'hazard' | 'fall' | 'shove';
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
  | 'bigthrow'
  | 'bigpunch'
  | 'charge'
  | 'shove'
  | 'down'
  | 'scream';

/** O que o lutador precisa saber do mundo à sua volta. */
export interface FighterEnv {
  physics: Physics;
  time: number;
  fighters: Fighter[];
  camFwd: THREE.Vector3;
  camRight: THREE.Vector3;
  onHit(attacker: Fighter | null, victim: Fighter, power: number, point: THREE.Vector3, dir: THREE.Vector3, kind: HitKind, part?: PartName): void;
  onPropHit(attacker: Fighter, body: RAPIER.RigidBody, point: THREE.Vector3, dir: THREE.Vector3, power: number): void;
  onEvent(f: Fighter, ev: FighterEvent, amount?: number): void;
}

// Ajustes de jogo (mexa aqui para mudar a sensação).
export const TUNING = {
  walkSpeed: 4.3,
  jumpSpeed: 6.9,
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
  /** Soco: ainda segurando o botão (carregando o socão)? */
  charging: boolean;
  /** Quanto carregou (segundos, até 0,9). */
  charge: number;
}
const newAttack = (): Attack => ({ t: -1, hit: new Set(), aim: new THREE.Vector3(), point: new THREE.Vector3(), charging: false, charge: 0 });
/** Carga mínima para virar "socão". */
const BIG_CHARGE = 0.25;

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
  /** Modo futebol: time (0 vermelho, 1 azul; -1 = cada um por si), colegas e função do robô. */
  team = -1;
  teamMates: Fighter[] = [];
  role: 'atacante' | 'zagueiro' | 'brigão' = 'atacante';
  strength = 1;
  hurtT = 0;
  lastAttacker: Fighter | null = null;
  lastAttackerAt = -99;

  facing: number;
  grounded = false;
  groundDist = 99;
  groundCollider: RAPIER.Collider | null = null;
  /** Velocidade do chão embaixo de mim (cabine, elevador, caminhão...). */
  groundVel = new THREE.Vector3();
  airTime = 0;
  walkPhase = 0;
  speed = 0;
  jumpT = 0;
  jumpCooldown = 0;
  pullT = -1;
  escape = 0;
  grabbedBy = 0;
  /** Algum perigo do mapa me agarrou (ex.: tubarão)? Nome dele, para a dica. */
  seizedBy: string | null = null;

  input: ControlState = emptyControl();
  prev: ControlState = emptyControl();
  frozen = false; // durante a contagem regressiva

  punchL = newAttack();
  punchR = newAttack();
  headbutt = newAttack();
  kick = newAttack();
  /** Chute no chão (botão de chute): perna para a frente, sem cair. */
  frontKick = newAttack();
  /** Abaixado (segurando o botão). */
  ducking = false;
  /** Correndo (segurando o botão). */
  running = false;

  /** Comemorando (vencedor da rodada). */
  celebrating = false;
  /** Ponto para onde as mãos miram ao agarrar alguém caído (ou null). */
  private grabAim: THREE.Vector3 | null = null;
  /** Estou erguendo alguém acima da cabeça? */
  lifting: Fighter | null = null;
  /** Estou sendo erguido por alguém? */
  liftedBy: Fighter | null = null;
  /** Quanto do nocaute já foi "acordado" apertando botões. */
  private koMashed = 0;
  private koFull = 0;
  /** Agachadinha antes do pulo (antecipação). */
  private crouchT = -1;
  /** Cambaleando depois de acordar. */
  private wakeT = 0;
  /** Para onde a cabeça está olhando (ponto no mundo). */
  private lookAt: THREE.Vector3 | null = null;
  /** "Molas" de gelatina de cada pedaço (só visual). */
  private jelly = {
    chest: { s: 0, v: 0, prev: new THREE.Vector3() },
    head: { s: 0, v: 0, prev: new THREE.Vector3() },
    pelvis: { s: 0, v: 0, prev: new THREE.Vector3() },
  };
  private prevVel = new THREE.Vector3();
  private impactGrace = 0;
  private blinkT = Math.random() * 3;
  private squash = 0;
  private screamT = 0;
  /** Depois da voadora: cai de costas, molinho, por um instante. */
  private flopT = 0;
  /** Levou um tombo: fica no chão um instante (sem estar desmaiado). */
  downT = 0;
  /** Espera entre um tranco de ombro e outro. */
  private shoveCd = 0;

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
    this.addSoft();
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

  /** Pele inteiriça do feijão: a malha e os ossos entram junto com as peças. */
  private addSoft() {
    const soft = this.skin.soft;
    if (!soft) return;
    this.root.add(soft.bones.pelvis, soft.bones.chest, soft.bones.head, soft.mesh, ...soft.extra);
  }

  /** Os ossos da pele copiam a pose (e o "amassado") de cada peça. */
  private syncSoft() {
    const soft = this.skin.soft;
    if (!soft) return;
    for (const n of ['pelvis', 'chest', 'head'] as const) {
      const src = this.skin.parts[n];
      const b = soft.bones[n];
      b.position.copy(src.position);
      b.quaternion.copy(src.quaternion);
      b.scale.copy(src.scale);
    }
  }

  /** Muda a aparência sem recriar o corpo (tela de escolha). */
  setAppearance(app: Appearance) {
    this.appearance = app;
    for (const n of PART_NAMES) this.root.remove(this.skin.parts[n]);
    if (this.skin.soft) {
      const soft = this.skin.soft;
      this.root.remove(soft.mesh, soft.bones.pelvis, soft.bones.chest, soft.bones.head, ...soft.extra);
      for (const m of [soft.mesh, ...soft.extra]) m.geometry.dispose();
    }
    this.skin.materials.forEach((m) => m.dispose());
    this.skin = buildSkin(app);
    this.links.links = [];
    for (const n of PART_NAMES) {
      this.root.add(this.skin.parts[n]);
      this.links.add(this.ragdoll.parts[n].body, this.skin.parts[n]);
    }
    this.addSoft();
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

    // Desmaiado: apertar botões rápido ajuda a acordar (até metade do tempo)
    if (this.alive && this.ko && !this.frozen) {
      const raw = this.source.read();
      const any = (raw.jump && !this._mashPrev.jump) || (raw.punchL && !this._mashPrev.punchL) || (raw.punchR && !this._mashPrev.punchR);
      this._mashPrev = raw;
      if (any && this.koMashed < this.koFull * 0.5) {
        this.koTimer -= 0.14;
        this.koMashed += 0.14;
        this.squash = Math.max(this.squash, 0.12);
      }
    }

    const canAct = this.alive && !this.ko && this.downT <= 0;

    // ----- força dos músculos
    let targetStrength = canAct ? 1 : this.ko || !this.alive ? 0.02 : 0.07;
    if (canAct && this.grabbedBy >= 2) targetStrength = 0.55;
    if (canAct && this.liftedBy && this.liftedBy.lifting === this) targetStrength = 0.15;
    else if (this.liftedBy) this.liftedBy = null;
    if (canAct && this.hurtT > 0) targetStrength = Math.min(targetStrength, 0.6);
    if (canAct && this.flopT > 0) targetStrength = Math.min(targetStrength, 0.2);
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
        else if (this.grounded && this.jumpCooldown <= 0 && this.crouchT < 0) this.crouchT = 0.085; // agacha e pula
      }
      if (this.crouchT >= 0) {
        this.crouchT -= dt;
        if (this.crouchT < 0) this.doJump(env);
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
      // Chute: no chão é um chute para a frente; no ar vira voadora
      if (pressed('kick') && this.kick.t < 0 && this.frontKick.t < 0) {
        if (this.grounded && this.jumpT <= 0) this.startAttack(this.frontKick, env, 'kick');
        else this.startAttack(this.kick, env, 'kick');
      }
      // Abaixar e correr (segurando)
      const holdingSomething = this.hands.L.holding() || this.hands.R.holding();
      this.ducking = inp.duck && this.grounded;
      this.running = inp.run && !this.ducking && !this.lifting && !holdingSomething && moveMag > 0.3;
      for (const side of ['L', 'R'] as const) {
        const key = side === 'L' ? 'punchL' : 'punchR';
        if (!pressed(key)) continue;
        const hand = this.hands[side];
        if (hand.holding() && !hand.holdingStatic()) this.throwHeld(env, side);
        else if ((this.jumpT > 0.05 || (!this.grounded && this.airTime > 0.08)) && this.kick.t < 0) this.startAttack(this.kick, env, 'kick');
        else {
          const a = side === 'L' ? this.punchL : this.punchR;
          if (a.t < 0 || a.t > 0.3) {
            // Toque = soco rápido. Segurar = puxa o braço lá atrás e solta um SOCÃO.
            this.startAttack(a, env, 'punch');
            a.charging = true;
            a.charge = 0;
          }
        }
      }

      // Mira automática ao agarrar: se tem alguém caído na frente, abaixa e pega
      this.grabAim = null;
      if ((inp.grabL || inp.grabR) && Math.abs(inp.armY) < 0.5 && !this.hands.L.holding() && !this.hands.R.holding()) {
        const me = this.pos('chest');
        const f = this.fwd();
        let bd = 2.6;
        for (const o of env.fighters) {
          if (o === this || o.removed || !o.alive) continue;
          const c = o.pos('chest');
          const d = c.clone().sub(me);
          if (c.y - o.pos('pelvis').y > 0.26) continue; // só quem está deitado no chão
          const flat = Math.hypot(d.x, d.z);
          if (flat > bd || (d.x * f.x + d.z * f.z) / (flat || 1) < 0.3) continue;
          bd = flat;
          this.grabAim = c.add(new THREE.Vector3(0, 0.12, 0));
        }
        // Ninguém caído: mira em quem está em pé bem na frente (pega no peito/ombro)
        if (!this.grabAim) {
          let bs = 1.7;
          for (const o of env.fighters) {
            if (o === this || o.removed || !o.alive) continue;
            const c = o.pos('chest');
            const d = c.clone().sub(me);
            const flat = Math.hypot(d.x, d.z);
            if (flat > bs || Math.abs(d.y) > 0.8 || (d.x * f.x + d.z * f.z) / (flat || 1) < 0.5) continue;
            bs = flat;
            this.grabAim = c.addScaledVector(d.setY(0).normalize(), -0.2).add(new THREE.Vector3(0, 0.15, 0));
          }
        }
        if (this.grabAim) this.faceNearest(env, 2, 0.2);
      }
      // Uma mão já segura alguém: a outra mão vai no mesmo (para poder erguer)
      if (!this.grabAim && inp.grabL && inp.grabR) {
        const held = [this.hands.L, this.hands.R].find((h) => h.holding() && h.targetInfo?.kind === 'fighter');
        const other = held === this.hands.L ? this.hands.R : this.hands.L;
        const o = held?.targetInfo?.owner as Fighter | undefined;
        if (held && !other.holding() && o && !o.removed) this.grabAim = o.pos('chest');
      }

      // Agarrar enquanto segura o gatilho
      for (const side of ['L', 'R'] as const) {
        const hand = this.hands[side];
        const want = side === 'L' ? inp.grabL : inp.grabR;
        if (want && !hand.holding()) {
          const wasWanting = side === 'L' ? this.prev.grabL : this.prev.grabR;
          if (!wasWanting) this.faceNearest(env, 2.2, 0.5);
          if (hand.tryGrab(!!this.grabAim)) env.onEvent(this, 'grab');
        } else if (!want && hand.holding()) {
          // Erguendo alguém acima da cabeça e soltou? Arremessa!
          if (this.lifting && hand.targetInfo?.owner === this.lifting) this.throwHeld(env, side);
          else hand.release();
        }
      }
      this.updateLift(dt);
      this.shoulderBump(env, dt);
    } else {
      if (this.lifting) this.stopLift();
      // Desmaiado: solta tudo.
      if (this.hands.L.holding()) this.hands.L.release();
      if (this.hands.R.holding()) this.hands.R.release();
      this.punchL.t = this.punchR.t = this.headbutt.t = this.kick.t = this.frontKick.t = -1;
      this.ducking = this.running = false;
      this.pullT = -1;
      this.crouchT = -1;
    }
    this.wakeT -= dt;
    this.updateLook(env);

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
    // Chão que anda (cinemático): ando junto com ele
    this.groundVel.set(0, 0, 0);
    const gb = this.grounded && hit ? hit.collider.parent() : null;
    if (gb && gb.isKinematic()) v3(gb.linvel(), this.groundVel);
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
    const overhead = !!this.lifting;
    if (this.lifting) this.stopLift();
    const dir = this.fwd().multiplyScalar(1).add(new THREE.Vector3(0, overhead ? 0.7 : 0.55, 0)).normalize();
    // Embalo: arremessar correndo joga mais longe
    const run = Math.min(1, this.speed / TUNING.walkSpeed) * 3;
    if (info?.kind === 'fighter') {
      const f = info.owner as Fighter;
      // Desmaiado voa longe; acordado resiste e só leva um empurrão. De cima da cabeça: voa muito!
      const base = overhead ? 11.5 : f.ko ? 8.5 : f.dizzy > 60 ? 6 : 4.2;
      f.knock(dir, base + run);
      if (overhead) env.onEvent(this, 'bigthrow');
      f.lastAttacker = this;
      f.lastAttackerAt = env.time;
      f.addDizzy(8);
    } else {
      const v = target.linvel();
      const k = 10 + run;
      target.setLinvel({ x: v.x + dir.x * k, y: v.y + dir.y * k, z: v.z + dir.z * k }, true);
    }
    env.onEvent(this, 'throw');
  }

  /**
   * Erguer acima da cabeça: segurando um lutador com as DUAS mãos e
   * levantando os braços, ele sobe e fica lá em cima, se debatendo.
   */
  private updateLift(dt: number) {
    const hL = this.hands.L;
    const hR = this.hands.R;
    const victim =
      hL.targetInfo?.kind === 'fighter' && hR.targetInfo?.kind === 'fighter' && hL.targetInfo.owner === hR.targetInfo.owner
        ? (hL.targetInfo.owner as Fighter)
        : null;
    const wantLift = !!victim && this.input.armY > 0.45 && this.strength > 0.5 && !victim.removed && victim.alive;
    if (!wantLift) {
      if (this.lifting) this.stopLift();
      return;
    }
    if (this.lifting !== victim) {
      this.lifting = victim;
      victim!.liftedBy = this;
    }
    // Leva o corpo do coitado para cima da minha cabeça
    const top = this.pos('head').add(new THREE.Vector3(0, 0.9, 0)).addScaledVector(this.fwd(), 0.15);
    for (const n of ['chest', 'pelvis', 'head'] as PartName[]) {
      const b = victim!.part(n);
      const p = v3(b.translation());
      const want = top.clone().add(new THREE.Vector3(0, n === 'head' ? 0.45 : n === 'pelvis' ? -0.38 : 0, 0)).sub(p).multiplyScalar(9);
      if (want.length() > 9) want.setLength(9);
      const v = b.linvel();
      const k = Math.min(1, 14 * dt);
      b.setLinvel({ x: v.x + (want.x - v.x) * k, y: v.y + (want.y - v.y) * k, z: v.z + (want.z - v.z) * k }, true);
    }
  }

  private stopLift() {
    if (this.lifting) this.lifting.liftedBy = null;
    this.lifting = null;
  }

  /**
   * Tranco de ombro: correndo e trombando em alguém, ele é empurrado
   * (e quem já está tonto vai para o chão).
   */
  private shoulderBump(env: FighterEnv, dt: number) {
    this.shoveCd -= dt;
    if (this.shoveCd > 0 || !this.grounded || this.speed < (this.running ? 4.6 : 3.6)) return;
    if (this.hands.L.holding() || this.hands.R.holding()) return;
    const me = this.pos('chest');
    const v = this.vel('chest').sub(this.groundVel).setY(0);
    const dir = v.clone().normalize();
    for (const o of env.fighters) {
      if (o === this || o.removed || !o.alive) continue;
      const d = o.pos('chest').sub(me);
      if (d.length() > 0.95 || d.setY(0).normalize().dot(dir) < 0.6) continue;
      this.shoveCd = 0.8;
      const push = dir.clone().setY(0.25).normalize();
      o.knock(push, 1.8 + this.speed * (this.running ? 0.55 : 0.3));
      o.lastAttacker = this;
      o.lastAttackerAt = env.time;
      o.addDizzy(6);
      if (o.dizzy > 45 || !o.grounded) o.knockDown(0.7);
      // eu também perco um pouquinho o equilíbrio
      this.hurtT = Math.max(this.hurtT, 0.15);
      env.onEvent(this, 'shove');
      return;
    }
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
    this.aimAttack(a, env, kind, 0.6);
    if (kind !== 'punch') env.onEvent(this, kind); // o soco faz barulho quando sai
  }

  /** Mira automática: vira um pouco para o inimigo mais perto na frente. */
  private aimAttack(a: Attack, env: FighterEnv, kind: 'punch' | 'headbutt' | 'kick', turn: number) {
    // Mira automática: vira um pouco para o inimigo mais perto na frente.
    const me = this.pos('chest');
    const f = this.fwd();
    let best: Fighter | null = null;
    let bestD = 3.3;
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
      this.facing += angleDiff(this.facing, Math.atan2(d.x, d.z)) * turn;
      a.aim.copy(d.normalize());
      // Mira um pouco "através" do alvo, para o punho chegar com força.
      a.point.copy(aimAt).addScaledVector(a.aim, 0.35);
    } else {
      a.aim.copy(this.fwd()).add(new THREE.Vector3(0, kind === 'punch' ? 0.1 : 0, 0)).normalize();
      a.point.copy(me).addScaledVector(this.fwd(), 1.4).add(new THREE.Vector3(0, 0.35, 0));
    }
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
    this.koFull = this.koTimer;
    this.koMashed = 0;
    this.koCount++;
    this.dizzy = 100;
    this.hands.L.release();
    this.hands.R.release();
    this._pendingKo = true; // o evento sai no próximo passo
  }
  _pendingKo = false;
  private _mashPrev = emptyControl();

  /** Recebe um golpe (chamado pela Arena). */
  receiveHit(power: number, dir: THREE.Vector3, part: PartName | undefined, knockSpeed: number) {
    this.hurtT = 0.28;
    this.squash = Math.min(0.35, 0.12 + power * 0.01);
    this.knock(dir, knockSpeed, part);
    // A cabeça "chicoteia" para trás e o corpo amassa (gelatina!)
    const h = this.part('head');
    const hv = h.linvel();
    h.setLinvel({ x: hv.x + dir.x * knockSpeed * 0.9, y: hv.y + 0.6, z: hv.z + dir.z * knockSpeed * 0.9 }, true);
    this.jelly.chest.v -= 3 + power * 0.08;
    this.jelly.head.v += 3 + power * 0.06;
    this.addDizzy(power);
    // Socaram minha mão/braço: a mão escorrega (quem está pendurado solta!)
    if (part === 'foreL' || part === 'armL') this.hands.L.release(0.5);
    if (part === 'foreR' || part === 'armR') this.hands.R.release(0.5);
    if (this.ko || !this.alive) return;
    // Pancada forte faz largar tudo e (às vezes) levar um tombo
    if (power >= 16) {
      this.hands.L.release(0.4);
      this.hands.R.release(0.4);
    }
    if (power >= 20 || (this.dizzy > 60 && power >= 11)) this.knockDown(0.45 + Math.min(0.85, power * 0.02));
  }

  /** Tombo: cai mole no chão por alguns instantes e levanta cambaleando. */
  knockDown(t: number) {
    if (!this.alive || this.ko) return;
    if (this.downT <= 0) this._pendingDown = true;
    this.downT = Math.max(this.downT, t);
  }
  private _pendingDown = false;

  private updateHealth(env: FighterEnv, dt: number) {
    this.hurtT -= dt;
    this.flopT -= dt;
    if (this.downT > 0) {
      this.downT -= dt;
      if (this.downT <= 0 && this.alive && !this.ko) this.wakeT = Math.max(this.wakeT, 0.9); // levanta meio tonto
    }
    if (this._pendingDown) {
      this._pendingDown = false;
      env.onEvent(this, 'down');
    }
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
        this.wakeT = 1.6;
        env.onEvent(this, 'wake');
      }
    } else if (this.hurtT < -1.2) {
      this.dizzy = Math.max(0, this.dizzy - TUNING.dizzyDecay * dt);
    }

    // Batida forte (queda, parede): muda brusca de velocidade.
    const v = this.vel('chest');
    const dv = v.distanceTo(this.prevVel);
    if (this.impactGrace <= 0 && !this.seizedBy && dv > 11 && this.alive) {
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
    const heavy = this.lifting ? 0.55 : this.hands.L.holding() || this.hands.R.holding() ? 0.7 : 1;
    const gait = this.running ? 1.65 : this.ducking ? 0.6 : 1;
    const target = move.clone().multiplyScalar(TUNING.walkSpeed * heavy * gait);
    // andar é relativo ao chão: em cima de algo que se mexe, vou junto
    target.x += this.groundVel.x;
    target.z += this.groundVel.z;

    const pv = pel.linvel();
    this.speed = Math.hypot(pv.x - this.groundVel.x, pv.z - this.groundVel.z); // relativo ao chão
    this.walkPhase += dt * (2 + this.speed * 3.3); // passinhos curtos e rápidos

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

    // Tonto ou acordando: anda cambaleando para os lados.
    const wobbly = this.wobbliness();
    if (wobbly > 0 && this.grounded) {
      const tt = performance.now() / 1000 + this.index;
      target.addScaledVector(this.left(), Math.sin(tt * 2.1) * 1.6 * wobbly);
      target.addScaledVector(this.fwd(), Math.sin(tt * 1.3 + 1) * 0.8 * wobbly);
    }
    if (this.celebrating) target.set(this.groundVel.x, 0, this.groundVel.z);
    // Mirando em alguém caído e sem andar: dá uns passinhos até ele
    if (this.grabAim && moveMag < 0.15) {
      const d = this.grabAim.clone().sub(this.pos('pelvis')).setY(0);
      if (d.length() > 0.75) target.copy(d.normalize().multiplyScalar(1.8)).add(this.groundVel.clone().setY(0));
    }

    // No ar só controla se estiver mexendo o analógico (o embalo continua),
    // e durante a voadora não freia nada.
    let ctrl = (this.grounded ? 0.2 : moveMag > 0.1 ? 0.045 : 0) * s;
    if (this.kick.t >= 0) ctrl = 0;
    for (const b of [pel, chest]) {
      const v = b.linvel();
      b.setLinvel({ x: v.x + (target.x - v.x) * ctrl, y: v.y, z: v.z + (target.z - v.z) * ctrl }, true);
    }

    // "Mola" que segura o quadril na altura certa = ficar em pé.
    // Compensa o peso do corpo todo e puxa para a altura desejada.
    if (this.grounded && this.jumpT <= 0) {
      // Sobe e desce a cada passo (gingado) e se agacha antes do pulo.
      const bob = Math.abs(Math.sin(this.walkPhase)) * 0.07 * Math.min(1, this.speed / 3) - 0.035 * Math.min(1, this.speed / 3);
      const reachingLow = this.grabAim ? Math.min(0.32, Math.max(0, this.pos('chest').y - this.grabAim.y - 0.2) * 0.6) : 0;
      const crouch = (this.crouchT >= 0 ? 0.24 : 0) + (this.ducking ? 0.36 : 0) + reachingLow;
      const err = DIM.hover + bob - crouch - this.groundDist;
      const vy = pel.linvel().y;
      const acc = THREE.MathUtils.clamp(err * 170 - vy * 20, -25, 70) - GRAVITY;
      const imp = BODY_MASS * acc * dt * s;
      pel.applyImpulse({ x: 0, y: imp * 0.6, z: 0 }, true);
      chest.applyImpulse({ x: 0, y: imp * 0.4, z: 0 }, true);
    }
    void moveMag;
  }

  /** 0..1: quanto o boneco está cambaleando (tonto ou acabando de acordar). */
  private wobbliness() {
    if (!this.alive || this.ko) return 0;
    const d = this.dizzy > 55 ? (this.dizzy - 55) / 45 : 0;
    const w = this.wakeT > 0 ? Math.min(1, this.wakeT / 1.6) : 0;
    return Math.min(1, Math.max(d * 0.8, w));
  }

  /** A cabeça procura o inimigo mais perto (os olhos seguem). */
  private updateLook(env: FighterEnv) {
    if (!this.alive || this.ko) {
      this.lookAt = null;
      return;
    }
    const me = this.pos('head');
    let best: THREE.Vector3 | null = null;
    let bd = 8;
    for (const o of env.fighters) {
      if (o === this || o.removed || !o.alive) continue;
      const p = o.pos('head');
      const d = p.distanceTo(me);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    this.lookAt = best;
  }

  // A pose de cada pedaço (é aqui que mora a "animação por código").
  private poseBody(env: FighterEnv, dt: number) {
    const s = this.strength;
    const t = env.time + this.index * 1.7;
    const fwd = this.fwd();
    const left = this.left();
    const spd = Math.min(1, this.speed / TUNING.walkSpeed);
    const wob = this.wobbliness();
    const walkSin = Math.sin(this.walkPhase);

    // ----- tronco: respira parado, ginga de um lado para o outro ao andar
    let pitch = spd * 0.24 + Math.sin(t * 2.2) * 0.025;
    let roll = Math.sin(t * 1.4) * 0.03 + walkSin * 0.14 * spd; // gingado de pinguim
    let twist = Math.sin(this.walkPhase) * 0.12 * spd; // ombros acompanham os passos
    // Tonto: o corpo todo balança como pudim
    pitch += Math.sin(t * 2.7) * 0.22 * wob;
    roll += Math.sin(t * 3.3 + 1) * 0.3 * wob;
    if (this.hurtT > 0) pitch -= 0.5; // se encolhe para trás ao levar soco
    if (this.crouchT >= 0) pitch += 0.25; // agachadinha antes do pulo
    if (this.ducking) pitch += 0.55; // abaixado: corpo dobrado para a frente
    if (this.running) pitch += 0.3 * Math.min(1, this.speed / 6); // correndo: inclinado
    const fkt = this.frontKick.t;
    if (fkt >= 0) pitch += fkt < 0.12 ? 0.1 : -0.35; // chute: joga o corpo para trás
    if (this.grabAim) pitch += this.grabAim.y < this.pos('chest').y - 0.3 ? 0.75 : 0.15; // se curva para pegar alguém no chão
    const hb = this.headbutt.t;
    if (hb >= 0) pitch += hb < 0.08 ? -0.5 : hb < 0.35 ? 1.1 : 0.3;
    const kt = this.kick.t;
    if (kt >= 0) pitch -= kt < 0.5 ? 1.35 : 0.8; // voadora: corpo quase deitado no ar
    for (const [a, sign] of [
      [this.punchL, -1],
      [this.punchR, 1],
    ] as const) {
      if (a.t < 0) continue;
      // Prepara girando para trás, depois gira o corpo todo no soco.
      // Carregando o socão: torce bem mais e inclina para trás.
      const c = Math.min(1, a.charge / 0.9);
      const big = a.charge >= BIG_CHARGE;
      twist += a.t < 0.07 ? -sign * (0.4 + c * 0.55) : a.t < 0.3 ? sign * (0.65 + (big ? c * 0.5 : 0)) : sign * 0.2;
      if (a.t < 0.07) pitch -= c * 0.3;
      if (a.t >= 0.07 && a.t < 0.3) pitch += big ? 0.35 : 0.15;
    }
    if (this.pullT >= 0) pitch += 0.4;
    if (this.celebrating) {
      pitch = -0.25 + Math.sin(t * 6) * 0.08;
      roll = Math.sin(t * 5) * 0.2;
      twist = Math.sin(t * 3) * 0.3;
    }

    const chestQ = yawPitchRoll(this.facing + twist, pitch, roll);
    const pelvisQ = yawPitchRoll(this.facing - twist * 0.4, spd * 0.06, -walkSin * 0.08 * spd);
    // Cabeça: olha para o inimigo mais perto (até ~50° para cada lado) e fica meio mole.
    let headYaw = this.facing + twist * 0.4;
    let headPitch = pitch * 0.35 - 0.05;
    if (this.lookAt && !this.celebrating) {
      const d = this.lookAt.clone().sub(this.pos('head'));
      const want = Math.atan2(d.x, d.z);
      headYaw = this.facing + THREE.MathUtils.clamp(angleDiff(this.facing, want), -0.9, 0.9);
      headPitch += THREE.MathUtils.clamp(-d.y * 0.3, -0.3, 0.3);
    }
    headPitch += Math.sin(t * 3.1) * 0.12 * wob;
    const headQ = yawPitchRoll(headYaw, headPitch, roll * 0.4 + Math.sin(t * 2.6) * 0.25 * wob);
    const hard = this.headbutt.t >= 0 || this.kick.t >= 0 ? 1.4 : 1;
    muscleOrient(this.part('chest'), chestQ, 0.32 * s * hard);
    muscleOrient(this.part('pelvis'), pelvisQ, 0.32 * s);
    muscleOrient(this.part('head'), headQ, (0.16 + 0.06 * (1 - wob)) * s);

    // ----- pernas: passinhos curtos, com as pernas um pouco abertas
    const legAmp = this.grounded ? 0.7 * spd : 0.25;
    const held = (this.grabbedBy > 0 || !!this.seizedBy) && !this.grounded;
    for (const [side, sx, ph] of [
      ['L', 1, 0],
      ['R', -1, Math.PI],
    ] as const) {
      const leg = this.part(('leg' + side) as PartName);
      const sideV = left.clone().multiplyScalar(sx);
      const d = DOWN.clone().addScaledVector(sideV, 0.1);
      let str = 0.3;
      if (fkt >= 0 && side === 'R' && fkt < 0.42) {
        // chute no chão: puxa a perna para trás e manda para a frente
        if (fkt < 0.12) d.addScaledVector(fwd, -0.5);
        else d.copy(fwd).multiplyScalar(1.25).addScaledVector(DOWN, 0.2);
        str = 0.75;
      } else if (kt >= 0 && kt < 0.5) {
        d.copy(fwd).multiplyScalar(1.1).addScaledVector(DOWN, 0.25);
        str = 0.6;
      } else if (held) {
        // Pendurado por alguém: esperneia
        d.addScaledVector(fwd, Math.sin(t * 13 + ph) * 0.8);
      } else if (this.celebrating) {
        d.addScaledVector(sideV, 0.15 + Math.max(0, Math.sin(t * 6 + ph)) * 0.25);
      } else if (!this.grounded) {
        // No ar: pedala
        d.addScaledVector(fwd, 0.3 + Math.sin(t * 10 + ph) * 0.35);
      } else {
        const step = Math.sin(this.walkPhase + ph);
        d.addScaledVector(fwd, step * legAmp);
        // A perna que vai à frente abre um pouquinho (passo de pinguim)
        d.addScaledVector(sideV, Math.max(0, step) * 0.12 * spd);
        if (this.crouchT >= 0) d.addScaledVector(fwd, 0.25);
      }
      muscleAim(leg, AXIS_DOWN, d, str * s, 16, 26, fwd);
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

      if (punch.t >= 0 && punch.t < 0.07 && punch.charge > 0.08) {
        // Carregando o socão: braço lá atrás e no alto, punho tremendo
        const shake = Math.sin(t * 40) * 0.08 * Math.min(1, punch.charge * 2);
        upper = fwd.clone().multiplyScalar(-1).addScaledVector(UP, 0.35 + shake).addScaledVector(sideV, 0.7);
        lower = UP.clone().addScaledVector(fwd, 0.35).addScaledVector(sideV, shake);
        str = 0.85;
      } else if (punch.t >= 0 && punch.t < 0.07) {
        // Puxa o braço para trás (preparando), cotovelo dobrado
        upper = fwd.clone().multiplyScalar(-0.8).addScaledVector(DOWN, 0.5).addScaledVector(sideV, 0.5);
        lower = fwd.clone().multiplyScalar(0.5).addScaledVector(UP, 0.4);
        str = 0.75;
      } else if (punch.t >= 0.07 && punch.t < 0.3) {
        // Braço esticado do ombro até o alvo
        upper = punch.point.clone().sub(shoulder);
        lower = upper.clone();
        str = 1;
      } else if (punch.t >= 0.3) {
        // Volta mole depois do soco
        upper = DOWN.clone().addScaledVector(fwd, 0.6);
        lower = upper.clone().addScaledVector(fwd, 0.3);
        str = 0.25;
      } else if (this.pullT >= 0) {
        upper = DOWN.clone().addScaledVector(fwd, 0.4);
        lower = DOWN.clone().addScaledVector(fwd, 0.2);
        str = 0.8;
      } else if (grabbing || hand.holding()) {
        // "Braços de zumbi": esticados para frente, balançando de leve
        // (ou mirando em quem está caído no chão)
        const reach = this.grabAim && !hand.holding()
          ? this.grabAim.clone().addScaledVector(sideV, 0.14)
          : chestPos
          .clone()
          .addScaledVector(fwd, 1.05 * Math.cos(reachPitch))
          .addScaledVector(UP, 1.05 * Math.sin(reachPitch) + 0.05 + Math.sin(t * 7 + ph) * 0.06)
          .addScaledVector(sideV, 0.16);
        upper = reach.sub(shoulder);
        lower = upper.clone();
        str = hand.holding() ? 0.7 : 0.85;
      } else if (this.celebrating) {
        // Comemora: braços para cima, abanando
        upper = UP.clone().addScaledVector(sideV, 0.5 + Math.sin(t * 9 + ph) * 0.35);
        lower = upper.clone().addScaledVector(sideV, Math.sin(t * 9 + ph) * 0.4);
        str = 0.6;
      } else if (this.hurtT > 0) {
        // Se protege: braços junto do corpo
        upper = DOWN.clone().addScaledVector(fwd, 0.5).addScaledVector(sideV, -0.3);
        lower = UP.clone().addScaledVector(fwd, 0.6).addScaledVector(sideV, -0.4);
        str = 0.4;
      } else if (this.grabbedBy > 0 || this.seizedBy) {
        // Sendo carregado: se debate
        upper = UP.clone().addScaledVector(sideV, 0.6).addScaledVector(fwd, Math.sin(t * 15 + ph) * 0.8);
        lower = upper.clone();
        str = 0.35;
      } else if (!this.grounded && this.airTime > 0.25) {
        // Caindo: braços para cima, desesperado
        upper = UP.clone().addScaledVector(sideV, 0.8).addScaledVector(fwd, Math.sin(t * 14 + ph) * 0.5);
        lower = upper.clone().addScaledVector(UP, 0.4);
        str = 0.3;
      } else if (wob > 0.2) {
        // Tonto: braços soltos girando
        upper = DOWN.clone().addScaledVector(sideV, 0.5 + Math.sin(t * 4 + ph) * 0.4).addScaledVector(fwd, Math.cos(t * 4 + ph) * 0.5);
        lower = upper.clone();
        str = 0.12;
      } else {
        // Balança os braços ao andar (bracinhos curtos e moles)
        const swing = Math.sin(this.walkPhase + ph) * 0.9 * spd;
        upper = DOWN.clone().addScaledVector(fwd, swing).addScaledVector(sideV, 0.25 + Math.sin(t * 1.3 + ph) * 0.05 + spd * 0.15);
        lower = upper.clone().addScaledVector(fwd, 0.3 + spd * 0.3);
        str = 0.16;
      }
      muscleAim(arm, AXIS_DOWN, upper, str * s);
      muscleAim(fore, AXIS_DOWN, lower, str * s);
    }

    // Comemorando: pulinhos
    if (this.celebrating && this.grounded && this.jumpCooldown <= 0 && Math.random() < dt * 1.5) {
      this.jumpCooldown = 0.6;
      for (const n of PART_NAMES) {
        const b = this.part(n);
        const v = b.linvel();
        b.setLinvel({ x: v.x, y: Math.max(v.y, 4.5), z: v.z }, true);
      }
      this.jumpT = 0.3;
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
      if (dead) {
        a.t = -1;
        a.charging = false;
        continue;
      }
      if (a.charging) {
        const held = side === 'L' ? this.input.punchL : this.input.punchR;
        if (held && a.t + dt >= 0.065) {
          // Segurando: o braço fica lá atrás, carregando
          a.t = 0.065;
          const was = a.charge;
          a.charge = Math.min(0.9, a.charge + dt);
          if (was < BIG_CHARGE && a.charge >= BIG_CHARGE) env.onEvent(this, 'charge');
          if (a.charge >= BIG_CHARGE) this.aimAttack(a, env, 'punch', 0.08);
          continue;
        }
        if (!held) a.charging = false;
      }
      const before = a.t;
      a.t += dt;
      const fore = this.part(('fore' + side) as PartName);
      const big = a.charge >= BIG_CHARGE;
      if (before < 0.07 && a.t >= 0.07) {
        a.charging = false;
        // Lança o punho na direção do alvo! (o socão vai com o corpo todo)
        const dir = a.point.clone().sub(this.hands[side].position()).normalize();
        const k = 11 + (big ? a.charge * 10 : 0);
        const v = fore.linvel();
        fore.setLinvel({ x: v.x + dir.x * k, y: v.y + dir.y * k, z: v.z + dir.z * k }, true);
        const arm = this.part(('arm' + side) as PartName);
        const v2 = arm.linvel();
        arm.setLinvel({ x: v2.x + dir.x * k * 0.45, y: v2.y + dir.y * k * 0.45, z: v2.z + dir.z * k * 0.45 }, true);
        // Dá um passinho para frente junto com o soco
        const c = this.part('chest');
        const cv = c.linvel();
        const step = 2.6 + (big ? a.charge * 4 : 0);
        c.setLinvel({ x: cv.x + a.aim.x * step, y: cv.y, z: cv.z + a.aim.z * step }, true);
        env.onEvent(this, big ? 'bigpunch' : 'punch');
      }
      if (a.t >= 0.08 && a.t < 0.28) {
        const power = TUNING.punchPower * (big ? 1 + a.charge * 1.3 : 1);
        this.testHit(env, this.hands[side].position(), DIM.handR + (big ? 0.16 : 0.1), a, power, big ? 'bigpunch' : 'punch', fore);
      }
      if (a.t > 0.42) a.charge = 0;
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

    const fk = this.frontKick;
    if (fk.t >= 0) {
      const before = fk.t;
      fk.t += dt;
      if (dead) fk.t = -1;
      else {
        if (before === 0) {
          // passinho para a frente no chute
          for (const n of ['pelvis', 'chest'] as PartName[]) {
            const b = this.part(n);
            const v = b.linvel();
            b.setLinvel({ x: v.x + fk.aim.x * 1.6, y: v.y, z: v.z + fk.aim.z * 1.6 }, true);
          }
        }
        if (fk.t >= 0.12 && fk.t < 0.34) {
          const leg = this.part('legR');
          const foot = v3(leg.translation()).add(new THREE.Vector3(0, -DIM.legHH - 0.05, 0).applyQuaternion(q4(leg.rotation())));
          this.testHit(env, foot, DIM.legR + 0.16, fk, TUNING.kickPower * 0.75, 'kick', leg);
        }
        if (fk.t > 0.55) fk.t = -1;
      }
    }

    const k = this.kick;
    if (k.t >= 0) {
      const before = k.t;
      k.t += dt;
      if (dead) k.t = -1;
      else {
        if (before === 0) {
          for (const n of ['pelvis', 'legL', 'legR', 'chest'] as PartName[]) {
            const b = this.part(n);
            const v = b.linvel();
            const f = n === 'chest' ? 2.5 : 6;
            b.setLinvel({ x: v.x + k.aim.x * f, y: v.y + 1.8, z: v.z + k.aim.z * f }, true);
          }
        }
        if (k.t >= 0.06 && k.t < 0.5) {
          for (const n of ['legL', 'legR'] as PartName[]) {
            const leg = this.part(n);
            const foot = v3(leg.translation()).add(new THREE.Vector3(0, -DIM.legHH - 0.05, 0).applyQuaternion(q4(leg.rotation())));
            this.testHit(env, foot, DIM.legR + 0.12, k, TUNING.kickPower, 'kick', leg);
          }
        }
        if (k.t > 0.65 || (this.grounded && k.t > 0.2)) {
          k.t = -1;
          this.flopT = 0.55; // e cai de costas (o preço da voadora)
        }
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
        env.onHit(this, victim, power * mult, p.clone(), dir, kind, info.part as PartName);
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
    const shout = ko || this.hurtT > 0 || this.screamT > 0.8 || this.headbutt.t >= 0 || this.celebrating || this.grabbedBy > 0 || !!this.seizedBy;
    f.mouth.visible = !shout && f.smile;
    f.mouthO.visible = shout;

    // Olhos seguem quem a cabeça está olhando
    let lx = 0;
    let ly = 0;
    if (this.lookAt && !ko) {
      const head = this.skin.parts.head;
      const local = this.lookAt.clone().sub(head.position).applyQuaternion(head.quaternion.clone().invert());
      local.normalize();
      lx = THREE.MathUtils.clamp(local.x, -1, 1);
      ly = THREE.MathUtils.clamp(local.y, -1, 1);
    } else if (this.wobbliness() > 0.2) {
      // tonto: olhos rodando
      const tt = performance.now() / 300;
      lx = Math.cos(tt);
      ly = Math.sin(tt);
    }
    for (const p of f.pupils) {
      p.position.x += (lx * 0.03 - p.position.x) * 0.3;
      p.position.y += (ly * 0.025 - p.position.y) * 0.3;
    }

    // Gelatina: amassa e volta (golpes + molas de cada pedaço + respiração)
    this.squash *= Math.pow(0.02, dt);
    const wob = this.squash * Math.sin(performance.now() * 0.03);
    const breath = Math.sin(performance.now() / 1000 * 2.4 + this.index) * 0.015;
    const crouch = this.crouchT >= 0 ? 0.12 : 0;
    const J = this.jelly;
    const sq = (g: THREE.Object3D, k: number, extra: number) => {
      const y = 1 + k + extra;
      const xz = 1 - (k + extra) * 0.55;
      g.scale.set(xz, y, xz);
    };
    sq(this.skin.parts.chest, J.chest.s - wob + breath - crouch, 0);
    sq(this.skin.parts.head, J.head.s + wob * 0.6, 0);
    sq(this.skin.parts.pelvis, J.pelvis.s - crouch * 0.5, 0);
  }

  /** Molas de gelatina: aceleração forte (pouso, golpe) faz o pedaço amassar e tremer. */
  private updateJelly(dt: number) {
    const J = this.jelly;
    for (const n of ['chest', 'head', 'pelvis'] as const) {
      const j = J[n];
      const v = v3(this.part(n).linvel());
      const ay = (v.y - j.prev.y) / dt;
      const ah = Math.hypot(v.x - j.prev.x, v.z - j.prev.z) / dt;
      j.prev.copy(v);
      // parada brusca para baixo (pouso) = amassa; impulso para cima = estica
      const drive = THREE.MathUtils.clamp(ay * 0.0035, -2.5, 2.5) * -1 + (ah > 25 ? (Math.random() - 0.5) * ah * 0.004 : 0);
      j.v += (-260 * j.s - 9 * j.v) * dt + drive * (n === 'head' ? 0.6 : 1);
      j.s += j.v * dt;
      j.s = THREE.MathUtils.clamp(j.s, -0.28, 0.28);
    }
  }

  /** Atualiza os desenhos (chamado a cada quadro). */
  render(alpha: number) {
    if (this.removed) return;
    this.links.apply(alpha);
    this.syncSoft();
  }

  afterPhysics() {
    if (this.removed) return;
    this.links.capture();
    this.updateJelly(1 / 60);
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
