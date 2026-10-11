import * as THREE from 'three';
import { h, hex, uiRoot } from './UI';
import type { Fighter } from '../characters/Fighter';
import { SLOT_COLORS, type PlayerSetup } from '../game/config';

// ------------------------------------------------------------
// HUD da luta: placar no topo, nome + barra de tontura em cima de
// cada lutador, mensagens grandes no meio e avisos de eliminação.
// ------------------------------------------------------------

export class Hud {
  el = h('div', 'hud');
  private top = h('div', 'hud-top');
  private center = h('div', 'hud-center');
  private feed = h('div', 'hud-feed');
  private tags = new Map<Fighter, { el: HTMLDivElement; bar: HTMLDivElement }>();
  private centerTimer = 0;

  constructor(private camera: THREE.Camera) {
    this.el.append(this.top, this.center, this.feed);
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

  setFighters(fighters: Fighter[]) {
    for (const [, t] of this.tags) t.el.remove();
    this.tags.clear();
    for (const f of fighters) {
      const el = h('div', 'tag', `<span>${f.name}</span>`);
      el.style.setProperty('--c', hex(SLOT_COLORS[f.index]));
      const barBox = h('div', 'dizzy');
      const bar = h('div');
      barBox.appendChild(bar);
      el.appendChild(barBox);
      this.el.appendChild(el);
      this.tags.set(f, { el, bar });
    }
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
    }
  }

  destroy() {
    this.el.remove();
  }
}
