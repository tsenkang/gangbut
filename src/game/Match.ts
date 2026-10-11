import { Arena, type ArenaPlayer } from './Arena';
import type { Engine } from './Engine';
import type { CameraRig } from './CameraRig';
import type { Effects } from './Effects';
import type { MatchConfig, PlayerSetup } from './config';
import { SLOT_COLORS } from './config';
import type { InputManager } from '../input/InputManager';
import { makeMap, MAPS } from '../maps/index';
import { Hud } from '../ui/Hud';
import { MenuList, h, hex, uiRoot } from '../ui/UI';
import { audio } from '../audio/Audio';
import { music } from '../audio/Music';
import type { Fighter } from '../characters/Fighter';

// ------------------------------------------------------------
// Uma partida: várias rodadas até alguém vencer a "melhor de 3"
// (ou de 5). Cuida da contagem, do relógio, da pausa e do placar.
// ------------------------------------------------------------

type State = 'countdown' | 'fight' | 'roundEnd' | 'matchEnd';

export const ROUND_TIME = 120; // segundos por rodada
const SUDDEN_DEATH_AT = 30; // segundos restantes para a morte súbita

export interface MatchDeps {
  engine: Engine;
  rig: CameraRig;
  effects: Effects;
  input: InputManager;
}

export class Match {
  arena: Arena | null = null;
  wins: number[] = [0, 0, 0, 0];
  round = 0;
  state: State = 'countdown';
  stateTime = 0;
  timeLeft = ROUND_TIME;
  hud: Hud;
  paused = false;
  private pauseEl: HTMLElement | null = null;
  private pauseMenu: MenuList | null = null;
  private overlay: HTMLElement | null = null;
  private overlayMenu: MenuList | null = null;
  private mapOrder: string[];
  private lastCount = -1;
  private suddenDeath = false;
  /** Chamado quando a partida termina e o jogador escolhe o que fazer. */
  onExit: (choice: 'again' | 'setup' | 'menu') => void = () => {};

  constructor(
    private d: MatchDeps,
    public config: MatchConfig,
  ) {
    this.hud = new Hud(d.engine.camera);
    const ids = MAPS.map((m) => m.id);
    if (config.mapId === 'rodizio') {
      // embaralha a ordem dos mapas
      this.mapOrder = ids.slice().sort(() => Math.random() - 0.5);
    } else this.mapOrder = [config.mapId];
  }

  get need() {
    return Math.ceil(this.config.bestOf / 2);
  }

  start() {
    this.nextRound();
  }

  private nextRound() {
    this.clearOverlay();
    this.arena?.dispose();
    this.round++;
    const mapId = this.mapOrder[(this.round - 1) % this.mapOrder.length];
    const players: ArenaPlayer[] = this.config.players.map((p) => ({
      slot: p.slot,
      name: p.name,
      appearance: p.appearance,
      bot: p.bot,
      source: p.deviceId ? this.d.input.getSource(p.deviceId) ?? this.d.input.keyboardA : undefined,
    }));
    const arena = new Arena(this.d.engine, this.d.effects, this.d.rig, makeMap(mapId), players);
    this.arena = arena;
    arena.onAnnounce = (t, cls) => this.hud.announce(t, cls);
    arena.fighters.forEach((f) => (f.frozen = true));
    this.hud.setFighters(arena.fighters);
    this.state = 'countdown';
    this.stateTime = 0;
    this.lastCount = -1;
    this.timeLeft = ROUND_TIME;
    this.suddenDeath = false;
    music.play(arena.map.music);
    this.hud.big(arena.map.name, 'mapname', 1400);
    this.hud.announce(`${arena.map.emoji} ${arena.map.hazard}`, 'tip');
    this.d.engine.paused = false;
  }

  // ------------------------------------------------ laço
  fixed(dt: number) {
    if (this.arena && !this.paused) this.arena.fixedStep(dt);
  }

  frame(dt: number, alpha: number) {
    const a = this.arena;
    if (!a) return;
    this.handleInput();
    if (!this.paused) this.stateTime += dt;

    switch (this.state) {
      case 'countdown': {
        const n = 3 - Math.floor(this.stateTime - 1);
        if (this.stateTime > 1 && n !== this.lastCount && n >= 1) {
          this.lastCount = n;
          this.hud.big(String(n), 'count', 800);
          audio.play('beep');
        }
        if (this.stateTime > 4) {
          this.state = 'fight';
          this.stateTime = 0;
          a.fighters.forEach((f) => (f.frozen = false));
          a.hazardsOn = true;
          this.hud.big('BRIGA!', 'go', 900);
          audio.play('go');
        }
        break;
      }
      case 'fight': {
        if (!this.paused) this.timeLeft -= dt;
        if (!this.suddenDeath && this.timeLeft <= SUDDEN_DEATH_AT) {
          this.suddenDeath = true;
          a.damageMult = 2;
          this.hud.big('MORTE SÚBITA!', 'go', 1500);
          this.hud.announce('Golpes valem o dobro!', 'tip');
          audio.play('alarm');
        }
        const alive = a.alive;
        if (alive.length <= 1 || this.timeLeft <= 0) {
          this.state = 'roundEnd';
          this.stateTime = 0;
        }
        break;
      }
      case 'roundEnd': {
        // Espera um pouquinho (pode cair mais alguém!) e mostra o placar.
        if (this.stateTime > 1.6 && !this.overlay) {
          const alive = a.alive;
          const w = alive.length === 1 ? alive[0] : null; // ninguém (ou vários no fim do tempo) = empate
          if (w) this.wins[w.index]++;
          this.showRoundEnd(w);
        }
        if (this.overlay && this.stateTime > 6.5 && !this.paused) this.afterRoundEnd();
        break;
      }
      case 'matchEnd':
        break;
    }

    this.hud.setScore(this.config.players, this.wins, this.round, this.config.bestOf, a.map.name, this.timeLeft);
    a.frame(dt, alpha);
    this.hud.update(dt);
  }

  private afterRoundEnd() {
    const champ = this.config.players.find((p) => this.wins[p.slot] >= this.need);
    // Segurança: se demorar demais (muitos empates), quem tiver mais vitórias leva.
    const tooLong = this.round >= this.config.bestOf * 2 + 1;
    if (champ || tooLong) {
      const best = champ ?? this.config.players.slice().sort((x, y) => this.wins[y.slot] - this.wins[x.slot])[0];
      this.showMatchEnd(best);
    } else this.nextRound();
  }

  // ------------------------------------------------ telas
  private scoreboard() {
    return this.config.players
      .slice()
      .sort((x, y) => this.wins[y.slot] - this.wins[x.slot])
      .map(
        (p) =>
          `<div class="row" style="--c:${hex(SLOT_COLORS[p.slot])}"><b>${p.name}</b><span>${p.bot ? '🤖' : '🎮'}</span><span class="dots">${Array.from(
            { length: this.need },
            (_, i) => `<i class="${i < this.wins[p.slot] ? 'on' : ''}"></i>`,
          ).join('')}</span></div>`,
      )
      .join('');
  }

  private showRoundEnd(w: Fighter | null) {
    this.clearOverlay();
    const title = w ? `${w.name} VENCEU A RODADA!` : 'EMPATE!';
    if (w) {
      audio.play('win');
      audio.play('cheer');
    }
    this.overlay = h('div', 'overlay roundend', `<h1>${title}</h1><div class="board">${this.scoreboard()}</div><p class="hint">Próxima rodada já já... (aperte A / Espaço)</p>`);
    uiRoot().appendChild(this.overlay);
  }

  private showMatchEnd(p: PlayerSetup) {
    this.state = 'matchEnd';
    this.clearOverlay();
    audio.play('win');
    audio.play('cheer');
    music.play('menu');
    const el = h('div', 'overlay matchend', `<div class="confetti"></div><h2>CAMPEÃO</h2><h1 style="color:${hex(SLOT_COLORS[p.slot])}">${p.name}!</h1><div class="board">${this.scoreboard()}</div>`);
    const menu = new MenuList([
      { label: 'Jogar de novo', action: () => this.onExit('again') },
      { label: 'Trocar mapa / regras', action: () => this.onExit('setup') },
      { label: 'Menu principal', action: () => this.onExit('menu') },
    ]);
    el.appendChild(menu.el);
    this.overlay = el;
    this.overlayMenu = menu;
    uiRoot().appendChild(el);
    this.d.input.swallow();
  }

  private clearOverlay() {
    this.overlay?.remove();
    this.overlay = null;
    this.overlayMenu = null;
  }

  // ------------------------------------------------ pausa
  pause(reason = '') {
    if (this.paused || this.state === 'matchEnd') return;
    this.paused = true;
    this.d.engine.paused = true;
    audio.play('uiBack');
    const el = h('div', 'overlay pause', `<h1>PAUSA</h1>${reason ? `<p class="warn">${reason}</p>` : ''}`);
    const menu = new MenuList([
      { label: 'Continuar', action: () => this.resume() },
      { label: 'Recomeçar partida', action: () => this.onExit('again') },
      { label: 'Trocar mapa / regras', action: () => this.onExit('setup') },
      { label: 'Sair para o menu', action: () => this.onExit('menu') },
    ]);
    el.appendChild(menu.el);
    el.appendChild(h('p', 'hint', 'Start / Options / Esc para continuar'));
    uiRoot().appendChild(el);
    this.pauseEl = el;
    this.pauseMenu = menu;
    this.d.input.swallow();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.d.engine.paused = false;
    this.pauseEl?.remove();
    this.pauseEl = null;
    this.pauseMenu = null;
    this.d.input.swallow();
  }

  private handleInput() {
    const humans = new Set(this.config.players.filter((p) => p.deviceId).map((p) => p.deviceId!));
    for (const { action, device } of this.d.input.anyEdges()) {
      if (this.paused && this.pauseMenu) {
        if (action === 'pause' || action === 'back') this.resume();
        else this.pauseMenu.handle(action);
        return;
      }
      if (this.overlayMenu) {
        this.overlayMenu.handle(action);
        return;
      }
      if (action === 'pause' && (humans.has(device.id) || humans.size === 0)) {
        this.pause();
        return;
      }
      if (this.state === 'roundEnd' && this.overlay && action === 'confirm' && this.stateTime > 2.5) {
        this.afterRoundEnd();
        return;
      }
    }
  }

  dispose() {
    this.arena?.dispose();
    this.arena = null;
    this.hud.destroy();
    this.clearOverlay();
    this.pauseEl?.remove();
    this.d.engine.paused = false;
  }
}
