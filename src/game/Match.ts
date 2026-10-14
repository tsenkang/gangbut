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
import { labelsFor, type ControlLabels } from '../input/labels';
import { Football, TEAM_COLORS, TEAM_NAMES } from '../maps/Football';

// ------------------------------------------------------------
// Uma partida: várias rodadas até alguém vencer a "melhor de 3"
// (ou de 5). Cuida da contagem, do relógio, da pausa e do placar.
// ------------------------------------------------------------

type State = 'countdown' | 'fight' | 'roundEnd' | 'matchEnd';

export const ROUND_TIME = 120; // segundos por rodada
const SUDDEN_DEATH_AT = 30; // segundos restantes para a morte súbita
export const FOOTBALL_TIME = 180; // futebol: 3 minutos
export const GOALS_TO_WIN = 3;

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
  private roundWinner: Fighter | null = null;
  /** Futebol: gols de cada time, prorrogação e quando acaba. */
  score = [0, 0];
  private golden = false;
  private endIn = -1;
  /** Chamado quando a partida termina e o jogador escolhe o que fazer. */
  onExit: (choice: 'again' | 'setup' | 'menu') => void = () => {};

  constructor(
    private d: MatchDeps,
    public config: MatchConfig,
  ) {
    this.hud = new Hud(d.engine.camera);
    const ids = MAPS.map((m) => m.id);
    if (config.mode === 'futebol') this.mapOrder = ['futebol'];
    else if (config.mapId === 'rodizio') {
      // embaralha a ordem dos mapas
      this.mapOrder = ids.slice().sort(() => Math.random() - 0.5);
    } else this.mapOrder = [config.mapId];
  }

  get football() {
    return this.config.mode === 'futebol';
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
    // Quem é gente (e com qual dispositivo) ganha legenda de botões e dicas.
    const humans = new Map<Fighter, ControlLabels>();
    for (const f of arena.fighters) {
      const p = this.config.players.find((x) => x.slot === f.index);
      if (p?.deviceId) humans.set(f, labelsFor(this.d.input.getSource(p.deviceId)));
    }
    if (this.football) this.setupFootball(arena);
    this.hud.setFighters(arena.fighters, humans, this.round === 1);
    if (this.round === 1 && humans.size && !this.football)
      this.hud.announce('Combo: soque até desmaiar → segure agarrar → leve até a borda → soco para jogar!', 'tip');
    this.state = 'countdown';
    this.stateTime = 0;
    this.lastCount = -1;
    this.timeLeft = this.football ? FOOTBALL_TIME : ROUND_TIME;
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
          this.hud.big(this.football ? 'BOLA ROLANDO!' : 'BRIGA!', 'go', 900);
          audio.play('go');
        }
        break;
      }
      case 'fight': {
        if (this.football) {
          this.footballFight(dt);
          break;
        }
        if (!this.paused) this.timeLeft -= dt;
        if (this.round === 1 && this.stateTime > 12 && this.stateTime - dt <= 12) this.hud.shrinkLegend();
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
          // O último em pé comemora! (e já está garantido: se cair depois, ainda ganha)
          this.roundWinner = alive.length === 1 ? alive[0] : null;
          if (this.roundWinner) this.roundWinner.celebrating = true;
        }
        break;
      }
      case 'roundEnd': {
        // Espera um pouquinho (pode cair mais alguém!) e mostra o placar.
        if (this.stateTime > 1.6 && !this.overlay) {
          const w = this.roundWinner; // ninguém (ou vários no fim do tempo) = empate
          if (w) this.wins[w.index]++;
          this.showRoundEnd(w);
        }
        if (this.overlay && this.stateTime > 6.5 && !this.paused) this.afterRoundEnd();
        break;
      }
      case 'matchEnd':
        break;
    }

    if (this.football) this.hud.setFootball(this.score, this.timeLeft, this.golden, GOALS_TO_WIN);
    else this.hud.setScore(this.config.players, this.wins, this.round, this.config.bestOf, a.map.name, this.timeLeft);
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

  // ------------------------------------------------ futebol
  /** Divide em dois times (alternando), põe cada um no seu campo e liga o gol. */
  private setupFootball(arena: Arena) {
    const map = arena.map as Football;
    arena.koOut = false;
    const sorted = arena.fighters.slice().sort((a, b) => a.index - b.index);
    const teams: Fighter[][] = [[], []];
    sorted.forEach((f, i) => teams[i % 2].push(f));
    teams.forEach((list, t) =>
      list.forEach((f, i) => {
        f.team = t;
        f.teamMates = list.filter((x) => x !== f);
        f.role = i === 0 ? 'atacante' : i === 1 ? 'zagueiro' : 'brigão';
        const spot = map.kickoffSpot(t, i);
        f.teleport(spot, t === 0 ? Math.PI / 2 : -Math.PI / 2);
      }),
    );
    map.onGoal = (team) => this.goal(team);
    this.score = [0, 0];
    this.golden = false;
    this.endIn = -1;
    this.hud.announce('⚽ Futebol! Vermelho ataca para a direita ➜, Azul para a esquerda ⬅', 'tip');
  }

  private goal(team: number) {
    if (this.state !== 'fight' || this.endIn >= 0) return;
    this.score[team]++;
    audio.play('win');
    this.hud.big('GOOOL!', 'go', 1600);
    this.hud.announce(`⚽ GOL do Time ${TEAM_NAMES[team]}! ${this.score[0]} × ${this.score[1]}`, 'out');
    if (this.golden || this.score[team] >= GOALS_TO_WIN) this.endIn = 2.6;
  }

  private footballFight(dt: number) {
    const a = this.arena!;
    if (this.round === 1 && this.stateTime > 12 && this.stateTime - dt <= 12) this.hud.shrinkLegend();
    if (this.endIn >= 0) {
      this.endIn -= dt;
      if (this.endIn < 0) this.finishFootball();
      return;
    }
    if (!this.paused && !this.golden) this.timeLeft -= dt;
    if (this.timeLeft <= 0 && !this.golden) {
      if (this.score[0] === this.score[1]) {
        this.golden = true;
        this.hud.big('GOL DE OURO!', 'go', 1800);
        this.hud.announce('Empate! Prorrogação: quem marcar primeiro vence.', 'tip');
        audio.play('alarm');
      } else this.finishFootball();
    }
    // desmaiou no campo: acorda sozinho (ninguém sai do jogo)
    for (const f of a.fighters) if (f.koTotal > 18) f.koTotal = 0;
  }

  private finishFootball() {
    const a = this.arena!;
    const win = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    for (const f of a.fighters) if (f.team === win) f.celebrating = true;
    this.state = 'matchEnd';
    this.clearOverlay();
    audio.play('win');
    audio.play('cheer');
    music.play('menu');
    const names = (t: number) =>
      this.config.players
        .filter((p) => a.fighters.find((f) => f.index === p.slot)?.team === t)
        .map((p) => p.name)
        .join(', ');
    const title = win < 0 ? 'EMPATE!' : `Time ${TEAM_NAMES[win]}!`;
    const color = win < 0 ? '#ffffff' : hex(TEAM_COLORS[win]);
    const el = h(
      'div',
      'overlay matchend',
      `<div class="confetti"></div><h2>${win < 0 ? 'FIM DE JOGO' : 'CAMPEÃO'}</h2><h1 style="color:${color}">${title}</h1>
      <div class="board"><div class="row" style="--c:${hex(TEAM_COLORS[0])}"><b>Vermelho</b><span>${names(0)}</span><span class="goals">${this.score[0]}</span></div>
      <div class="row" style="--c:${hex(TEAM_COLORS[1])}"><b>Azul</b><span>${names(1)}</span><span class="goals">${this.score[1]}</span></div></div>`,
    );
    const menu = new MenuList([
      { label: 'Jogar de novo', action: () => this.onExit('again') },
      { label: 'Trocar regras', action: () => this.onExit('setup') },
      { label: 'Menu principal', action: () => this.onExit('menu') },
    ]);
    el.appendChild(menu.el);
    this.overlay = el;
    this.overlayMenu = menu;
    uiRoot().appendChild(el);
    this.d.input.swallow();
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
    const title = w ? `${w.name} venceu!` : 'Empate!';
    if (w) {
      audio.play('win');
      audio.play('cheer');
    }
    this.overlay = h('div', 'overlay roundend', `<h1>${title}</h1><div class="board">${this.scoreboard()}</div><p class="hint">Próxima rodada já já... (aperte A / Espaço)</p>`);
    if (w) this.overlay.style.setProperty('--c', hex(SLOT_COLORS[w.index]));
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
