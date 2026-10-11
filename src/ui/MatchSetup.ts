import { MenuList, driveMenu, h, uiRoot, type Screen } from './UI';
import type { InputManager } from '../input/InputManager';
import { MAPS } from '../maps/index';
import { DIFFICULTY_NAMES, type Difficulty } from '../ai/Bot';

// ------------------------------------------------------------
// Regras da partida: mapa, número de rodadas, robôs e dificuldade.
// ------------------------------------------------------------

export interface SetupState {
  mapId: string;
  bestOf: 3 | 5;
  bots: number;
  difficulty: Difficulty;
}

/** Info de cada mapa (preenchida a partir das classes). */
export const MAP_INFO = MAPS.map((m) => {
  const map = m.make();
  return { id: m.id, name: map.name, emoji: map.emoji, description: map.description, hazard: map.hazard };
});

export class MatchSetup implements Screen {
  el: HTMLElement;
  private list: MenuList;
  private info: HTMLElement;

  constructor(
    private input: InputManager,
    private st: SetupState,
    humans: number,
    cb: { start(): void; back(): void },
  ) {
    const maxBots = 4 - humans;
    st.bots = Math.min(st.bots, maxBots);
    const mapIds = [...MAP_INFO.map((m) => m.id), 'rodizio'];
    const diffs: Difficulty[] = ['facil', 'medio', 'dificil'];
    const mapLabel = () => {
      if (st.mapId === 'rodizio') return '🎲 Rodízio (muda a cada rodada)';
      const m = MAP_INFO.find((x) => x.id === st.mapId)!;
      return `${m.emoji} ${m.name}`;
    };
    this.el = h('div', 'screen setup');
    this.el.innerHTML = `<h1 class="title">Regras da partida</h1>`;
    this.list = new MenuList([
      { label: () => `Mapa: ${mapLabel()}`, change: (d) => (st.mapId = mapIds[(mapIds.indexOf(st.mapId) + d + mapIds.length) % mapIds.length]) },
      { label: () => `Rodadas: melhor de ${st.bestOf}`, change: () => (st.bestOf = st.bestOf === 3 ? 5 : 3) },
      { label: () => `Robôs: ${st.bots}`, change: (d) => (st.bots = (st.bots + d + maxBots + 1) % (maxBots + 1)) },
      {
        label: () => `Dificuldade dos robôs: ${DIFFICULTY_NAMES[st.difficulty]}`,
        change: (d) => (st.difficulty = diffs[(diffs.indexOf(st.difficulty) + d + 3) % 3]),
        disabled: () => st.bots === 0,
      },
      {
        label: 'BRIGAR!',
        action: () => cb.start(),
        disabled: () => humans + st.bots < 2,
        hint: () => (humans + st.bots < 2 ? 'Precisa de pelo menos 2 lutadores — adicione um robô' : `${humans} jogador(es) + ${st.bots} robô(s)`),
      },
      { label: 'Voltar', action: () => cb.back() },
    ]);
    this.list.focus = 4;
    if (humans + st.bots < 2) this.list.focus = 2;
    this.list.render();
    this.info = h('div', 'map-info');
    this.el.append(this.list.el, this.info);
    uiRoot().appendChild(this.el);
    this.back = cb.back;
  }
  private back: () => void;

  update() {
    driveMenu(this.input, this.list, () => this.back());
    const st = this.st;
    if (st.mapId === 'rodizio') this.info.innerHTML = `<b>Rodízio</b><p>Cada rodada acontece num mapa diferente.</p>`;
    else {
      const m = MAP_INFO.find((x) => x.id === st.mapId)!;
      this.info.innerHTML = `<b>${m.emoji} ${m.name}</b><p>${m.description}</p><p class="warn">⚠ ${m.hazard}</p>`;
    }
  }

  destroy() {
    this.el.remove();
  }
}
