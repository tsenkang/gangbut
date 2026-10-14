import * as THREE from 'three';
import { emptyControl, type ControlState, type InputSource } from '../input/types';
import type { Fighter } from '../characters/Fighter';
import type { Arena } from '../game/Arena';
import { FIXED_DT } from '../physics/Physics';

// ------------------------------------------------------------
// Robôs. Eles "apertam botões" igual a um jogador: o lutador não
// sabe se quem manda é gente ou robô. A dificuldade muda o tempo de
// reação, a mira, o cuidado com a borda e as manhas (agarrar e
// carregar até a borda, escalar de volta...).
// ------------------------------------------------------------

export type Difficulty = 'facil' | 'medio' | 'dificil';

export const DIFFICULTY_NAMES: Record<Difficulty, string> = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil' };

interface BotParams {
  reaction: number; // segundos entre decisões
  punchRate: number; // socos por segundo quando perto
  aimError: number; // erro de direção (radianos)
  edgeCare: number; // chance de desviar da borda
  grabChance: number;
  headbutt: number;
  kick: number;
  climb: boolean;
  carry: number; // chance de carregar o inimigo até a borda
  speed: number;
  escapeRate: number; // apertos por segundo para escapar
  hazardCare: number; // chance de dar atenção aos avisos de perigo do mapa
  edgeFear: number; // quanto foge da beirada
}

const PARAMS: Record<Difficulty, BotParams> = {
  facil: { reaction: 0.6, punchRate: 1.1, aimError: 0.7, edgeCare: 0.8, grabChance: 0.1, headbutt: 0.04, kick: 0.02, climb: true, carry: 0, speed: 0.7, escapeRate: 3, hazardCare: 0.7, edgeFear: 0.6 },
  medio: { reaction: 0.32, punchRate: 2, aimError: 0.35, edgeCare: 0.95, grabChance: 0.35, headbutt: 0.12, kick: 0.06, climb: true, carry: 0.5, speed: 0.9, escapeRate: 6, hazardCare: 0.9, edgeFear: 1 },
  dificil: { reaction: 0.14, punchRate: 3.6, aimError: 0.12, edgeCare: 1, grabChance: 0.6, headbutt: 0.2, kick: 0.1, climb: true, carry: 0.9, speed: 1, escapeRate: 10, hazardCare: 1, edgeFear: 1.3 },
};

type Mode = 'chase' | 'grab' | 'carry' | 'flee' | 'wander';

export class Bot implements InputSource {
  kind = 'bot' as const;
  label: string;
  p: BotParams;
  fighter!: Fighter;
  private out = emptyControl();
  /** Saltando um vão: tempo restante e direção (não vira para trás no meio do pulo). */
  private leapT = 0;
  private leapDir = new THREE.Vector3();
  private leapJumped = false;
  private leapClock = 0;
  private leapBack = 0;
  private think = Math.random() * 0.3;
  private mode: Mode = 'chase';
  private target: Fighter | null = null;
  private wantDir = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private punchTimer = 0;
  private toggle = false;
  /** Segurando o soco para soltar um socão (segundos restantes). */
  private holdPunch = 0;
  private holdSide: 'punchL' | 'punchR' = 'punchL';
  private modeTime = 0;
  private wanderDir = new THREE.Vector3(1, 0, 0);
  private escapeTimer = 0;
  private stuck = 0;

  constructor(
    public difficulty: Difficulty,
    private arena: Arena,
    public id: string,
  ) {
    this.p = PARAMS[difficulty];
    this.label = 'Robô ' + DIFFICULTY_NAMES[difficulty];
  }

  attach(f: Fighter) {
    this.fighter = f;
  }

  connected() {
    return true;
  }

  read(): ControlState {
    const f = this.fighter;
    const o = this.out;
    // Botões "de toque" voltam a solto a cada passo (para gerar novas apertadas).
    o.punchL = o.punchR = o.headbutt = o.jump = o.kick = false;
    o.run = o.duck = false;
    if (!f || !f.alive || f.ko) {
      o.grabL = o.grabR = false;
      o.moveX = o.moveY = 0;
      // desmaiado: robôs espertos apertam botões para acordar antes
      if (f && f.ko && this.difficulty !== 'facil' && Math.random() < FIXED_DT * this.p.escapeRate * 0.8) o.jump = true;
      return { ...o };
    }
    const dt = FIXED_DT;
    this.think -= dt;
    this.modeTime += dt;
    if (this.think <= 0) {
      this.think = this.p.reaction * (0.7 + Math.random() * 0.6);
      this.decide();
    }
    this.act(dt);
    if (this.holdPunch > 0) {
      this.holdPunch -= dt;
      if (this.holdPunch > 0 && !f.hands.L.holding() && !f.hands.R.holding()) o[this.holdSide] = true;
    }

    // Corre quando o caminho está livre e firme (robôs mais espertos correm mais)
    if (this.wantDir.lengthSq() > 0.64 && f.grounded && this.leapT <= 0 && this.runner && !f.ko && this.arena.map.botLeaps) {
      const me = f.pos('chest');
      const d = this.wantDir.clone().normalize();
      if (this.groundAt(me.clone().addScaledVector(d, 1.6)) && this.groundAt(me.clone().addScaledVector(d, 2.8))) o.run = true;
    }
    // Converte a direção do mundo para "analógico" relativo à câmera.
    this.dir.lerp(this.wantDir, 0.2);
    const sp = Math.min(1, this.dir.length()) * this.p.speed;
    const d = this.dir.clone().normalize().multiplyScalar(sp);
    o.moveX = d.dot(this.arena.camRight);
    o.moveY = d.dot(this.arena.camFwd);
    return { ...o };
  }

  private enemies() {
    const me = this.fighter;
    // no futebol, colega de time não é alvo
    return this.arena.fighters.filter((x) => x !== me && x.alive && !x.removed && (me.team < 0 || x.team !== me.team));
  }

  /** Tem chão nesse ponto? (raio para baixo — e não vale água, lava ou trilho) */
  private maxDrop = 1.2;
  private groundAt(p: THREE.Vector3) {
    // um degrau de até ~1,2 m abaixo do pé conta como chão (mais que isso é queda: viga
    // de baixo, cabine de baixo...). Seguindo um aviso do mapa, aceita descer até ~2,2 m.
    const hit = this.arena.physics.rayDown(new THREE.Vector3(p.x, p.y + 1.5, p.z), 2.5 + this.maxDrop, this.fighter.ragdoll.bit);
    if (!hit) return false;
    const y = p.y + 1.5 - hit.dist;
    return y > this.arena.map.killY && this.arena.map.deathAt(new THREE.Vector3(p.x, y, p.z)) === 'none';
  }

  /** Tem chão para pousar nesse ponto, mais ou menos na minha altura (e parado)? */
  private landingAt(p: THREE.Vector3) {
    const hit = this.arena.physics.rayDown(new THREE.Vector3(p.x, p.y + 1.2, p.z), 2.6, this.fighter.ragdoll.bit);
    if (!hit) return false;
    // plataforma que sobe/desce rápido (elevador, gôndola) não serve para pousar
    const body = hit.collider.parent();
    if (body && body.isKinematic()) {
      const v = body.linvel();
      const g = this.fighter.groundVel;
      // anda em relação a mim (sobe, desce ou passa de lado)? não dá para pousar
      if (Math.abs(v.y) > 0.35 || Math.hypot(v.x - g.x, v.z - g.z) > 0.8) return false;
    }
    return true;
  }

  /** Tem uma beirada mais alta (dá para escalar: 0,5 a 2,2 m) logo na frente? */
  private ledgeAhead(me: THREE.Vector3, dir: THREE.Vector3) {
    const feet = me.y - 1.0;
    const hit = this.arena.physics.rayDown(new THREE.Vector3(me.x + dir.x * 0.8, feet + 2.6, me.z + dir.z * 0.8), 2.4, this.fighter.ragdoll.bit);
    if (!hit) return false;
    const h = feet + 2.6 - hit.dist - feet;
    return h > 0.5 && h < 2.2;
  }

  /** Dá para chegar andando em linha reta até lá? (sem buraco no caminho) */
  private reachable(to: THREE.Vector3) {
    const me = this.fighter.pos('chest');
    const d = to.clone().sub(me).setY(0);
    const len = d.length();
    if (len < 1.2 || Math.abs(to.y - me.y) > 2.2) return Math.abs(to.y - me.y) <= 2.2;
    d.normalize();
    for (let t = 0.7; t < len - 0.4; t += 0.7) {
      const p = me.clone().addScaledVector(d, t);
      p.y = me.y + ((to.y - me.y) * t) / len;
      if (!this.groundAt(p)) return false;
    }
    return true;
  }

  private decide() {
    const f = this.fighter;
    const me = f.pos('chest');
    const foes = this.enemies();
    if (!foes.length) {
      this.mode = 'wander';
      return;
    }
    // Escolhe um alvo: o mais perto (os difíceis preferem quem está tonto/na borda).
    let best: Fighter | null = null;
    let bestScore = Infinity;
    for (const e of foes) {
      let score = e.pos('chest').distanceTo(me);
      if (this.difficulty !== 'facil' && (e.ko || e.downT > 0)) score -= 3;
      if (this.difficulty === 'dificil' && e.dizzy > 60) score -= 1.5;
      if (e === this.target) score -= 1; // não fica trocando toda hora
      if (!this.reachable(e.pos('chest'))) score += 9; // prefere quem dá para alcançar
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.target = best;
    const holding = f.hands.L.holding() || f.hands.R.holding();
    const holdingFoe = [f.hands.L, f.hands.R].some((h) => h.targetInfo?.kind === 'fighter');
    if (holdingFoe && Math.random() < this.p.carry + 0.1) this.mode = 'carry';
    else if (holding && !holdingFoe && !f.hands.L.holdingStatic() && !f.hands.R.holdingStatic()) {
      // segurando uma caixa: joga no inimigo
      this.out.punchL = true;
      this.mode = 'chase';
    } else if (this.mode !== 'grab' && best && (best.ko || best.downT > 0 ? Math.random() < this.p.grabChance * 2 : Math.random() < this.p.grabChance * 0.4)) {
      this.mode = 'grab';
      this.modeTime = 0;
    } else if (this.mode === 'grab' && this.modeTime > 3) this.mode = 'chase';
    else if (this.mode !== 'grab' && this.mode !== 'carry') this.mode = 'chase';
    if (this.mode === 'carry' && !holdingFoe) this.mode = 'chase';
    // Futebol: só larga a bola para agarrar alguém desmaiado bem do lado (o brigão agarra à vontade)
    if (this.mode === 'grab' && f.role !== 'brigão' && this.arena.map.botObjective(f) && !(best && best.ko && best.pos('chest').distanceTo(me) < 2)) this.mode = 'chase';

    // Um pouco de erro na mira (robô fácil anda meio torto)
    this.aimNoise = (Math.random() * 2 - 1) * this.p.aimError;
    this.careful = Math.random() < this.p.edgeCare;
    this.runner = Math.random() < (this.difficulty === 'dificil' ? 0.75 : this.difficulty === 'medio' ? 0.55 : 0.25);
    this.heed = Math.random() < this.p.hazardCare;
  }
  private heed = true;
  private edgePush = new THREE.Vector3();
  private edgeTick = 0;
  private aimNoise = 0;
  private careful = true;
  private runner = false;

  private act(dt: number) {
    const f = this.fighter;
    const o = this.out;
    const me = f.pos('chest');
    const center = this.arena.map.safeSpot(me);

    // ----- sendo segurado: aperta botões para escapar
    if (f.grabbedBy > 0 || f.seizedBy) {
      this.escapeTimer -= dt;
      if (this.escapeTimer <= 0) {
        this.escapeTimer = 1 / this.p.escapeRate;
        o.jump = true;
      }
    }

    // ----- saltando um vão: corre reto, pula e segura a direção até pousar
    if (this.leapT > 0) {
      this.leapT -= dt;
      this.leapClock += dt;
      if (!this.leapJumped && this.leapClock < this.leapBack) {
        // primeiro uns passos para trás (para ter embalo)
        this.wantDir.copy(this.leapDir).multiplyScalar(-0.8);
        return;
      }
      this.wantDir.copy(this.leapDir);
      this.dir.copy(this.leapDir); // sem suavizar: vai com tudo
      if (!this.leapJumped) {
        const edgeAhead = !this.groundAt(me.clone().addScaledVector(this.leapDir, 0.5));
        if (f.grounded && edgeAhead) {
          // confere de novo se o outro lado ainda está lá (cabine/elevador pode ter saído)
          if (!this.landingAt(me.clone().addScaledVector(this.leapDir, 2.0))) {
            this.leapT = 0;
            this.wantDir.set(0, 0, 0);
            return;
          }
          o.jump = true;
          this.leapJumped = true;
          this.leapClock = 0;
        } else if (this.leapT < 0.5) {
          this.leapT = 0; // não achou a beirada: desiste
          return;
        }
      } else if (f.grounded && this.leapClock > 0.35) this.leapT = 0; // pousou
      if (!f.grounded && f.vel('pelvis').y < -4) {
        // caiu curto: tenta se agarrar na beirada
        o.grabL = o.grabR = true;
        o.armY = 0.6;
      }
      return;
    }

    // ----- pendurado numa borda: escala (ou segura firme)
    const hanging = (f.hands.L.holdingStatic() || f.hands.R.holdingStatic()) && !f.grounded;
    if (hanging) {
      this.hangT += dt;
      o.grabL = o.grabR = true;
      o.armY = 1;
      // empurra na direção da beirada que está segurando (não para baixo dela)
      const h = f.hands.L.holdingStatic() ? f.hands.L : f.hands.R;
      const toLedge = h.anchorWorld().sub(f.pos('pelvis')).setY(0);
      if (toLedge.lengthSq() > 0.02) this.wantDir.copy(toLedge.normalize()).multiplyScalar(0.7);
      else this.wantDir.copy(center).sub(me).setY(0).normalize().multiplyScalar(0.5);
      if (this.p.climb && Math.random() < dt * 2.5) o.jump = true;
      // pendurado faz tempo e tem chão logo abaixo (teto da cabine, mureta baixa): solta
      if (this.hangT > 4 && f.groundDist < 2.2) {
        o.grabL = o.grabR = false;
        this.hangT = 0;
      }
      return;
    }
    this.hangT = 0;
    // ----- caindo da borda: tenta se agarrar logo (corrimão, beirada...)
    const falling = !f.grounded && f.airTime > 0.06 && (f.vel('pelvis').y < -2 || !this.groundAt(f.pos('pelvis')));
    if (falling && (this.difficulty !== 'facil' || this.heed)) {
      o.grabL = o.grabR = true;
      o.armY = f.vel('chest').y < 0 ? 0.2 : 0.7;
      this.wantDir.copy(center).sub(me).setY(0).normalize();
      return;
    }

    // ----- perigo anunciado pelo mapa (túnel, prensa, guindaste...): corre para o lugar seguro
    const dumping = this.mode === 'carry' && this.arena.map.dumpSpot(me) !== null;
    const safe = this.heed && !dumping ? this.arena.map.botAdvice(me) : null;
    if (safe) {
      o.grabL = o.grabR = false;
      const d = safe.clone().sub(me).setY(0);
      this.wantDir.copy(d.lengthSq() > 0.16 ? d.normalize() : d.set(0, 0, 0));
      // o lugar seguro é mais alto (ex.: caí no trilho e o trem vem): agarra a beirada e sobe
      if (me.y < safe.y + 0.5 && d.lengthSq() > 0.16) {
        o.grabL = o.grabR = true;
        o.armY = 1;
        if (f.grounded && Math.random() < dt * 4) o.jump = true;
      }
      // se alguém estiver colado, dá um soquinho para abrir caminho
      this.punchTimer -= dt;
      const near = this.target && !this.target.removed && this.target.pos('chest').distanceTo(me) < 1.3;
      if (near && this.punchTimer <= 0) {
        this.punchTimer = 0.6;
        o.punchR = true;
      }
      this.maxDrop = 2.2;
      this.avoidEdge(me);
      this.maxDrop = 1.2;
      return;
    }

    // O alvo pode ter saído do jogo desde a última decisão.
    if (this.target && (this.target.removed || !this.target.alive)) {
      this.target = null;
      this.think = 0;
    }
    // Ninguém mais para brigar (venci a rodada) ou comemorando: fica quietinho num lugar firme
    if (f.celebrating || !this.enemies().length) {
      o.grabL = o.grabR = false;
      const d = center.clone().sub(me).setY(0);
      this.wantDir.copy(d.lengthSq() > 2 ? d.normalize().multiplyScalar(0.5) : d.set(0, 0, 0));
      this.avoidEdge(me);
      return;
    }
    if (this.mode === 'wander' || !this.target) {
      o.grabL = o.grabR = false;
      if (Math.random() < dt * 0.5) this.wanderDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      this.wantDir.copy(this.wanderDir).multiplyScalar(0.4);
      this.avoidEdge(me);
      return;
    }

    const tgt = this.target.pos('chest');
    const to = tgt.clone().sub(me);
    const dist = Math.hypot(to.x, to.z);
    to.y = 0;
    to.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.aimNoise * Math.min(1, dist / 3));

    if (this.mode === 'carry') {
      // Leva o coitado até a borda mais perto e joga (os espertos erguem antes).
      o.grabL = o.grabR = true;
      o.armY = this.difficulty === 'dificil' || (this.difficulty === 'medio' && this.target?.ko) ? 1 : 0.5;
      const dump = this.arena.map.dumpSpot(me);
      if (dump) {
        // o mapa tem um lugar certo para jogar (poço, fornalha...): leva até lá
        const d = dump.clone().sub(me).setY(0);
        const dl = d.length();
        this.wantDir.copy(d.normalize());
        // chegou na beirada (ou perto o bastante): joga sem entrar junto
        if (dl < 2 || this.modeTime > 6 || !this.groundAt(me.clone().addScaledVector(this.wantDir, 1.0))) {
          this.wantDir.multiplyScalar(-0.6);
          o.punchL = true;
          o.punchR = true;
          this.mode = 'flee';
          this.modeTime = 0;
        }
        return;
      }
      const away = me.clone().sub(center).setY(0);
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      away.normalize();
      this.wantDir.copy(away);
      // perto da beirada: para de andar e arremessa (sem ir junto!)
      const ahead = me.clone().addScaledVector(away, 1.8);
      if (!this.groundAt(me.clone().addScaledVector(away, 1.2))) this.wantDir.set(0, 0, 0);
      if (!this.groundAt(ahead) || this.modeTime > 5) {
        this.wantDir.copy(away).multiplyScalar(-0.6); // dá um passo para trás
        o.punchL = true; // joga!
        o.punchR = true;
        this.mode = 'flee';
        this.modeTime = 0;
      }
      return;
    }

    if (this.mode === 'flee') {
      // Depois de jogar, volta para o meio.
      o.grabL = o.grabR = false;
      this.wantDir.copy(center).sub(me).setY(0).normalize();
      if (this.modeTime > 0.8) this.mode = 'chase';
      this.avoidEdge(me);
      return;
    }

    // Objetivo do mapa (futebol: ir na bola, chutar para o gol, defender)
    const obj = this.mode !== 'grab' ? this.arena.map.botObjective(f) : null;
    if (obj) {
      o.grabL = o.grabR = false;
      o.armY = 0;
      const d = obj.to.clone().sub(me).setY(0);
      this.wantDir.copy(d.lengthSq() > 0.09 ? d.normalize() : d.set(0, 0, 0));
      this.punchTimer -= dt;
      if (this.punchTimer <= 0) {
        if (obj.strike) {
          // bola na frente: soco, cabeçada ou voadora na bola
          this.punchTimer = (1 / this.p.punchRate) * (0.5 + Math.random() * 0.5);
          const r = Math.random();
          if (r < 0.12 && f.grounded && this.difficulty !== 'facil') o.jump = true;
          else if (r < 0.55 && f.grounded) o.kick = true; // chuta a bola
          else if (r < 0.68) o.headbutt = true;
          else {
            this.toggle = !this.toggle;
            if (this.toggle) o.punchL = true;
            else o.punchR = true;
          }
        } else if (dist < 1.5) {
          // adversário no caminho: tira ele da frente
          this.punchTimer = (1 / this.p.punchRate) * (0.7 + Math.random() * 0.6);
          this.toggle = !this.toggle;
          if (this.toggle) o.punchL = true;
          else o.punchR = true;
        }
      }
      // voadora: no ar, aperta soco
      if (!f.grounded && f.airTime > 0.12 && f.airTime < 0.2) o.punchL = true;
      this.avoidEdge(me);
      return;
    }

    // Vai atrás do alvo
    this.wantDir.copy(to).multiplyScalar(dist > 1.1 ? 1 : 0.15);
    if (this.mode === 'grab') {
      o.grabL = o.grabR = dist < 1.8;
      o.armY = this.target.ko || this.target.downT > 0 ? -0.7 : 0;
      if (f.hands.L.holding() || f.hands.R.holding()) {
        if (Math.random() < this.p.carry) {
          this.mode = 'carry';
          this.modeTime = 0;
        }
      }
    } else {
      o.grabL = o.grabR = false;
      o.armY = 0;
      this.punchTimer -= dt;
      if (dist < 1.7 && this.punchTimer <= 0) {
        this.punchTimer = 1 / this.p.punchRate * (0.6 + Math.random() * 0.8);
        const r = Math.random();
        if (r < this.p.headbutt) o.headbutt = true;
        else if (r < this.p.headbutt + this.p.kick && f.grounded) o.jump = true; // prepara voadora
        else if (r < this.p.headbutt + this.p.kick + 0.12 && f.grounded) o.kick = true; // chute no chão
        else {
          this.toggle = !this.toggle;
          if (this.toggle) o.punchL = true;
          else o.punchR = true;
          // De vez em quando carrega um socão
          const chargeChance = this.difficulty === 'dificil' ? 0.3 : this.difficulty === 'medio' ? 0.18 : 0.06;
          if (Math.random() < chargeChance) {
            this.holdPunch = 0.35 + Math.random() * 0.45;
            this.holdSide = this.toggle ? 'punchL' : 'punchR';
          }
        }
      }
      // voadora: no ar, aperta soco
      if (!f.grounded && f.airTime > 0.12 && f.airTime < 0.2 && dist < 2.6 && Math.random() < 0.5) o.punchL = true;
    }

    // Parede/beirada na minha frente e eu travado (engate do trem, trilho, mureta): escala
    if (this.p.climb && f.grounded && f.speed < 0.6 && dist > 1.2 && this.ledgeAhead(me, to)) {
      o.grabL = o.grabR = true;
      o.armY = 1;
      if (Math.random() < dt * 3) o.jump = true;
    }

    // Alvo lá em cima (eu caí no engate, ele está no teto): agarra a parede e escala
    // (só quando ele está quase em cima de mim e tem chão na frente — senão é pular no vazio)
    if (this.p.climb && tgt.y - me.y > 1.0 && dist < 2 && this.groundAt(me.clone().addScaledVector(to, 0.7))) {
      o.grabL = o.grabR = true;
      o.armY = 1;
      if (Math.random() < dt * 3) o.jump = true;
    }

    // Preso num canto? pula. (mas não quando está esperando na beirada)
    if (f.speed < 0.3 && dist > 2 && this.arena.map.botLeaps && this.wantDir.lengthSq() > 0.09 && this.groundAt(me.clone().addScaledVector(this.wantDir.clone().normalize(), 1.2))) {
      this.stuck += dt;
      if (this.stuck > 1.2) {
        o.jump = true;
        this.stuck = 0;
      }
    } else this.stuck = 0;

    this.avoidEdge(me);
  }

  /** Se o próximo passo for o vazio, desvia (de acordo com o cuidado). */
  private waitT = 0; // esperando na beirada
  private hangT = 0; // pendurado há quanto tempo
  private circleSign = Math.random() < 0.5 ? 1 : -1;

  private avoidEdge(me: THREE.Vector3) {
    // Sente a beirada em volta e se afasta dela (mesmo parado, brigando)
    if (this.edgeTick-- <= 0) {
      this.edgeTick = 3;
      this.edgePush.set(0, 0, 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        if (!this.groundAt(me.clone().addScaledVector(dir, 0.95))) this.edgePush.sub(dir);
      }
    }
    if (this.edgePush.lengthSq() > 0.01) {
      this.wantDir.addScaledVector(this.edgePush.clone().normalize(), this.p.edgeFear);
      if (this.wantDir.lengthSq() > 1) this.wantDir.normalize();
    }
    if (this.wantDir.lengthSq() < 0.01) return;
    const dir = this.wantDir.clone().normalize();
    const near = me.clone().addScaledVector(dir, 0.7);
    const ahead = me.clone().addScaledVector(dir, 1.3);
    // os descuidados só param quando o vazio está colado no pé
    const blocked = this.careful ? !this.groundAt(near) || !this.groundAt(ahead) : !this.groundAt(near);
    if (!blocked && this.waitT > 0) this.waitT = Math.max(0, this.waitT - 1 / 120);
    if (blocked) {
      // Vão curto com chão do outro lado e o alvo lá: pula!
      const f = this.fighter;
      const land = me.clone().addScaledVector(dir, 2.3);
      const chasing = this.mode === 'chase' || this.mode === 'grab';
      if (chasing && this.arena.map.botLeaps && this.difficulty !== 'facil' && f.grounded && this.groundAt(near) && this.landingAt(land) && this.landingAt(me.clone().addScaledVector(dir, 2.8))) {
        // dá uma corridinha e pula (o pulo sai no começo do salto)
        this.leapT = 2;
        this.leapJumped = false;
        this.leapClock = 0;
        this.leapBack = f.speed < 2.5 ? 0.55 : 0; // parado na beirada: recua antes para pegar embalo
        this.leapDir.copy(dir);
        return;
      }
      // Procura um ângulo que tenha chão (passarela estreita, tábua, curva...).
      // Esperando faz tempo na beirada? Dá a volta (contorna o buraco).
      const around = this.waitT > 2.5 && this.arena.map.botDetours ? [100 * this.circleSign, 130 * this.circleSign] : [];
      for (const deg of [25, -25, 50, -50, 75, -75, ...around]) {
        const alt = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180);
        if (this.groundAt(me.clone().addScaledVector(alt, 0.7)) && this.groundAt(me.clone().addScaledVector(alt, 1.3))) {
          this.wantDir.copy(alt).multiplyScalar(Math.min(1, this.wantDir.length()));
          return;
        }
      }
      // Sem caminho: perseguindo, espera na beirada (o elevador/gôndola pode chegar);
      // senão, volta para um lugar firme.
      if (chasing && this.groundAt(near)) {
        this.wantDir.set(0, 0, 0);
        this.waitT += 1 / 60;
        if (this.waitT > 6) {
          this.waitT = 0;
          this.circleSign = -this.circleSign;
        }
        return;
      }
      const center = this.arena.map.safeSpot(me);
      this.wantDir.copy(center).sub(me).setY(0).normalize();
    }
  }
}
