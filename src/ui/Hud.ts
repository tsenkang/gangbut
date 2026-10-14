import * as THREE from 'three';
import { h, hex, uiRoot } from './UI';
import type { Fighter } from '../characters/Fighter';
import { SLOT_COLORS, type PlayerSetup } from '../game/config';
import type { ControlLabels } from '../input/labels';

// ------------------------------------------------------------
// HUD da luta: placar no topo, nome + barra de tontura em cima de
// cada lutador, mensagens grandes no meio e avisos de eliminação.
// ------------------------------------------------------------

export class Hud {
  el = h('div', 'hud');
  private top = h('div', 'hud-top');
  private center = h('div', 'hud-center');
  private feed = h('div', 'hud-feed');
  private legend = h('div', 'hud-legend');
  private tags = new Map<Fighter, { el: HTMLDivElement; bar: HTMLDivElement; hint: HTMLDivElement | null; labels?: ControlLabels; lastHint: string }>();
  private centerTimer = 0;

  constructor(private camera: THREE.Camera) {
    this.el.append(this.top, this.center, this.feed, this.legend);
    uiRoot().appendChild(this.el);
  }

  setScore(players: PlayerSetup[], wins: number[], round: number, bestOf: number, mapName: string, time: number) {
    const need = Math.ceil(bestOf / 2);
    const chips = players
      .map((p) => {
        const dots = Array.from({ length: need }, (_, i) => `<i class="${i < wins[p.slot] ? 'on' : ''}"></i>`).join('');
        return `<div class="chip" style="--c:${hex(SLOT_COLORS[p.slot])}"><b>${p.name}</b><span class="dots">${dots}</span></div>`;
      })
      .join('');
    const t = Math.max(0, Math.ceil(time));
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, '0');
    this.top.innerHTML = `<div class="round">Rodada ${round} · melhor de ${bestOf} · ${mapName}</div><div class="chips">${chips}</div><div class="clock ${t <= 10 ? 'hurry' : ''}">${mm}:${ss}</div>`;
  }

  /** Placar do futebol: Vermelho x Azul + relógio. */
  setFootball(score: number[], time: number, golden: boolean, toWin: number) {
    const t = Math.max(0, Math.ceil(time));
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, '0');
    const team = (i: number, name: string, c: string) => `<div class="chip foot" style="--c:${c}"><b>${name}</b><span class="goals">${score[i]}</span></div>`;
    this.top.innerHTML = `<div class="round">⚽ Futebol · primeiro a ${toWin} gols</div><div class="chips">${team(0, 'Vermelho', '#ff4d5e')}<span class="vs">×</span>${team(1, 'Azul', '#3a86ff')}</div><div class="clock ${golden || t <= 10 ? 'hurry' : ''}">${golden ? 'GOL DE OURO' : `${mm}:${ss}`}</div>`;
  }

  /** Mensagem grande no centro ("3", "BRIGA!", "MORTE SÚBITA!"). */
  big(text: string, cls = '', ms = 900) {
    this.center.innerHTML = '';
    const d = h('div', 'big ' + cls, text);
    this.center.appendChild(d);
    this.centerTimer = ms / 1000;
  }

  announce(text: string, cls = '') {
    const d = h('div', 'feed-item ' + cls, text);
    this.feed.prepend(d);
    setTimeout(() => d.classList.add('out'), 3200);
    setTimeout(() => d.remove(), 3800);
    while (this.feed.children.length > 4) this.feed.lastChild?.remove();
  }

  /** humans: lutadores controlados por gente, com os nomes dos botões de cada um. */
  setFighters(fighters: Fighter[], humans: Map<Fighter, ControlLabels> = new Map(), bigLegend = false) {
    for (const [, t] of this.tags) t.el.remove();
    this.tags.clear();
    for (const f of fighters) {
      const labels = humans.get(f);
      const el = h('div', 'tag' + (labels ? ' me' : ''), `<span>${f.name}</span>`);
      el.style.setProperty('--c', hex(SLOT_COLORS[f.index]));
      const barBox = h('div', 'dizzy');
      const bar = h('div');
      barBox.appendChild(bar);
      let hint: HTMLDivElement | null = null;
      if (labels) {
        hint = h('div', 'hint');
        el.prepend(hint);
      }
      el.appendChild(barBox);
      this.el.appendChild(el);
      this.tags.set(f, { el, bar, hint, labels, lastHint: '' });
    }
    // Legenda fixa com os botões de cada jogador humano
    this.legend.innerHTML = '';
    for (const [f, L] of humans) {
      const d = h(
        'div',
        'legend' + (bigLegend ? ' big' : ''),
        `<b>${f.name}</b><span><kbd>${L.move}</kbd> andar</span><span><kbd>${L.jump}</kbd> pular</span><span><kbd>${L.punch}</kbd> socar (segure: socão)</span><span><kbd>${L.grab}</kbd> agarrar (segure)</span><span><kbd>${L.headbutt}</kbd> cabeçada</span><span><kbd>${L.kick}</kbd> chute</span><span><kbd>${L.run}</kbd> correr</span><span><kbd>${L.duck}</kbd> abaixar</span><span><kbd>${L.pause}</kbd> pausa</span>`,
      );
      d.style.setProperty('--c', hex(SLOT_COLORS[f.index]));
      this.legend.appendChild(d);
    }
  }

  /** Deixa a legenda pequena (depois do começo da partida). */
  shrinkLegend() {
    for (const c of Array.from(this.legend.children)) c.classList.remove('big');
  }

  /** Qual dica mostrar em cima do boneco do jogador agora? */
  private hintFor(f: Fighter, L: ControlLabels): string {
    if (f.ko) return `Desmaiado! Aperte ${L.jump} rápido para acordar!`;
    if (f.downT > 0) return 'Levou um tombo! Levantando...';
    if (f.liftedBy) return `Te ergueram! Aperte ${L.jump} sem parar!`;
    if (f.lifting) return `${L.punch.split(' / ')[0]} ou solte ${L.grab}: ARREMESSAR!`;
    if (f.seizedBy) return `O ${f.seizedBy} te pegou! Aperte ${L.jump} sem parar!`;
    if (f.grabbedBy > 0) return `Te pegaram! Aperte ${L.jump} sem parar!`;
    const holdingFoe = [f.hands.L, f.hands.R].some((hd) => hd.holding() && hd.targetInfo?.kind === 'fighter');
    const holdingThing = [f.hands.L, f.hands.R].some((hd) => hd.holding() && hd.targetInfo?.kind === 'prop');
    const hanging = (f.hands.L.holdingStatic() || f.hands.R.holdingStatic()) && !f.grounded;
    if (hanging) return `${L.jump}: subir!`;
    const bothOnFoe = f.hands.L.targetInfo?.kind === 'fighter' && f.hands.L.targetInfo.owner === f.hands.R.targetInfo?.owner;
    if (bothOnFoe) return `${L.arms}: erguer acima da cabeça · ${L.punch.split(' / ')[0]}: arremessar`;
    if (holdingFoe) return `Leve até a borda e aperte ${L.punch.split(' / ')[0]}: arremessar!`;
    if (holdingThing) return `${L.punch.split(' / ')[0]}: arremessar a peça`;
    const me = f.pos('chest');
    for (const [o] of this.tags) {
      if (o === f || !o.alive || o.removed) continue;
      if (o.ko && o.pos('chest').distanceTo(me) < 2.2) return `Ele desmaiou! Segure ${L.grab} para agarrar`;
      if (o.downT > 0 && o.pos('chest').distanceTo(me) < 2.2) return `Ele caiu! Segure ${L.grab} para pegar`;
    }
    if ([f.punchL, f.punchR].some((a) => a.charging && a.charge > 0.25)) return 'Solte: SOCÃO!';
    if (f.dizzy > 70) return 'Tonto! Mais um soco e você desmaia';
    return '';
  }

  update(dt: number) {
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) this.center.innerHTML = '';
    }
    const w = window.innerWidth;
    const hh = window.innerHeight;
    const v = new THREE.Vector3();
    for (const [f, t] of this.tags) {
      if (f.removed || !f.alive) {
        t.el.style.display = 'none';
        continue;
      }
      v.copy(f.skin.parts.head.position);
      v.y += 0.75;
      v.project(this.camera);
      if (v.z > 1) {
        t.el.style.display = 'none';
        continue;
      }
      t.el.style.display = '';
      t.el.style.left = `${((v.x + 1) / 2) * w}px`;
      t.el.style.top = `${((1 - v.y) / 2) * hh}px`;
      const d = Math.min(100, f.dizzy);
      t.bar.style.width = `${d}%`;
      t.bar.className = f.ko ? 'ko' : d > 65 ? 'high' : '';
      t.el.classList.toggle('ko', f.ko);
      t.el.classList.toggle('calm', d < 3 && !f.ko);
      if (t.hint && t.labels) {
        const msg = this.hintFor(f, t.labels);
        if (msg !== t.lastHint) {
          t.lastHint = msg;
          t.hint.textContent = msg;
        }
      }
    }
  }

  destroy() {
    this.el.remove();
  }
}
