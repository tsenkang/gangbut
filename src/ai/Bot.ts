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
  facil: { reaction: 0.6, punchRate: 1.1, aimError: 0.7, edgeCare: 0.6, grabChance: 0.1, headbutt: 0.04, kick: 0.02, climb: false, carry: 0, speed: 0.7, escapeRate: 3, hazardCare: 0.45, edgeFear: 0.5 },
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
  private think = Math.random() * 0.3;
  private mode: Mode = 'chase';
  private target: Fighter | null = null;
  private wantDir = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private punchTimer = 0;
  private toggle = false;
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
    o.punchL = o.punchR = o.headbutt = o.jump = false;
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

    // Converte a direção do mundo para "analógico" relativo à câmera.
    this.dir.lerp(this.wantDir, 0.2);
    const sp = Math.min(1, this.dir.length()) * this.p.speed;
    const d = this.dir.clone().normalize().multiplyScalar(sp);
    o.moveX = d.dot(this.arena.camRight);
    o.moveY = d.dot(this.arena.camFwd);
    return { ...o };
  }

  private enemies() {
    return this.arena.fighters.filter((x) => x !== this.fighter && x.alive && !x.removed);
  }

  /** Tem chão nesse ponto? (raio para baixo) */
  private groundAt(p: THREE.Vector3) {
    const hit = this.arena.physics.rayDown(new THREE.Vector3(p.x, p.y + 1.5, p.z), 6, this.fighter.ragdoll.bit);
    return !!hit;
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
      if (this.difficulty !== 'facil' && e.ko) score -= 3;
      if (this.difficulty === 'dificil' && e.dizzy > 60) score -= 1.5;
      if (e === this.target) score -= 1; // não fica trocando toda hora
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
    } else if (this.mode !== 'grab' && best && (best.ko ? Math.random() < this.p.grabChance * 2 : Math.random() < this.p.grabChance * 0.4)) {
      this.mode = 'grab';
      this.modeTime = 0;
    } else if (this.mode === 'grab' && this.modeTime > 3) this.mode = 'chase';
    else if (this.mode !== 'grab' && this.mode !== 'carry') this.mode = 'chase';
    if (this.mode === 'carry' && !holdingFoe) this.mode = 'chase';

    // Um pouco de erro na mira (robô fácil anda meio torto)
    this.aimNoise = (Math.random() * 2 - 1) * this.p.aimError;
    this.careful = Math.random() < this.p.edgeCare;
    this.heed = Math.random() < this.p.hazardCare;
  }
  private heed = true;
  private edgePush = new THREE.Vector3();
  private edgeTick = 0;
  private aimNoise = 0;
  private careful = true;

  private act(dt: number) {
    const f = this.fighter;
    const o = this.out;
    const me = f.pos('chest');
    const center = this.arena.map.camera.center;

    // ----- sendo segurado: aperta botões para escapar
    if (f.grabbedBy > 0) {
      this.escapeTimer -= dt;
      if (this.escapeTimer <= 0) {
        this.escapeTimer = 1 / this.p.escapeRate;
        o.jump = true;
      }
    }

    // ----- pendurado numa borda: escala (ou segura firme)
    const hanging = (f.hands.L.holdingStatic() || f.hands.R.holdingStatic()) && !f.grounded;
    if (hanging) {
      o.grabL = o.grabR = true;
      o.armY = 1;
      this.wantDir.copy(center).sub(me).setY(0).normalize().multiplyScalar(0.5);
      if (this.p.climb && Math.random() < dt * 2) o.jump = true;
      return;
    }
    // ----- caindo da borda: tenta se agarrar logo (corrimão, beirada...)
    const falling = !f.grounded && f.airTime > 0.06 && (f.vel('pelvis').y < -2 || !this.groundAt(f.pos('pelvis')));
    if (falling && (this.difficulty !== 'facil' || this.heed)) {
      o.grabL = o.grabR = true;
      o.armY = f.vel('chest').y < 0 ? 0.2 : 0.7;
      this.wantDir.copy(center).sub(me).setY(0).normalize();
      return;
    }

    // ----- perigo anunciado pelo mapa (túnel, prensa, guindaste...): corre para o lugar seguro
    const safe = this.heed ? this.arena.map.botAdvice(me) : null;
    if (safe) {
      o.grabL = o.grabR = false;
      const d = safe.clone().sub(me).setY(0);
      this.wantDir.copy(d.lengthSq() > 0.16 ? d.normalize() : d.set(0, 0, 0));
      // se alguém estiver colado, dá um soquinho para abrir caminho
      this.punchTimer -= dt;
      const near = this.target && !this.target.removed && this.target.pos('chest').distanceTo(me) < 1.3;
      if (near && this.punchTimer <= 0) {
        this.punchTimer = 0.6;
        o.punchR = true;
      }
      this.avoidEdge(me);
      return;
    }

    // O alvo pode ter saído do jogo desde a última decisão.
    if (this.target && (this.target.removed || !this.target.alive)) {
      this.target = null;
      this.think = 0;
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
      const away = me.clone().sub(center).setY(0);
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      away.normalize();
      this.wantDir.copy(away);
      // perto da beirada: para de andar e arremessa (sem ir junto!)
      const ahead = me.clone().addScaledVector(away, 1.4);
      if (!this.groundAt(me.clone().addScaledVector(away, 0.9))) this.wantDir.set(0, 0, 0);
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

    // Vai atrás do alvo
    this.wantDir.copy(to).multiplyScalar(dist > 1.1 ? 1 : 0.15);
    if (this.mode === 'grab') {
      o.grabL = o.grabR = dist < 1.8;
      o.armY = this.target.ko ? -0.7 : 0;
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
        else {
          this.toggle = !this.toggle;
          if (this.toggle) o.punchL = true;
          else o.punchR = true;
        }
      }
      // voadora: no ar, aperta soco
      if (!f.grounded && f.airTime > 0.12 && f.airTime < 0.2 && dist < 2.6 && Math.random() < 0.5) o.punchL = true;
    }

    // Alvo lá em cima (eu caí no engate, ele está no teto): agarra a parede e escala
    if (this.p.climb && tgt.y - me.y > 1.0 && dist < 3.5) {
      o.grabL = o.grabR = true;
      o.armY = 1;
      if (Math.random() < dt * 3) o.jump = true;
    }

    // Preso num canto? pula.
    if (f.speed < 0.3 && dist > 2) {
      this.stuck += dt;
      if (this.stuck > 1.2) {
        o.jump = true;
        this.stuck = 0;
      }
    } else this.stuck = 0;

    this.avoidEdge(me);
  }

  /** Se o próximo passo for o vazio, desvia (de acordo com o cuidado). */
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
    if (this.careful && (!this.groundAt(near) || !this.groundAt(ahead))) {
      const center = this.arena.map.camera.center;
      this.wantDir.copy(center).sub(me).setY(0).normalize();
    }
  }
}
