import { MenuList, driveMenu, h, uiRoot, type Screen } from './UI';
import type { InputManager } from '../input/InputManager';
import { audio } from '../audio/Audio';
import { padsBlocked } from '../input/Gamepads';
import type { Engine, Quality } from '../game/Engine';

// ------------------------------------------------------------
// Tela inicial.
// ------------------------------------------------------------

export interface MainMenuActions {
  local(): void;
  bots(): void;
  controls(): void;
  howto(): void;
}

export class MainMenu implements Screen {
  el: HTMLElement;
  private list: MenuList;
  private pads: HTMLElement;

  constructor(
    private input: InputManager,
    engine: Engine,
    act: MainMenuActions,
  ) {
    this.el = h('div', 'screen main-menu');
    // Logo com cada letra um pouco torta (e balançando)
    const letters = [...'MOLENGAS']
      .map((c, i) => `<b style="--r:${((i * 37) % 9) - 4}deg;--y:${((i * 53) % 7) - 3}px;--d:${(i * 0.13).toFixed(2)}s">${c}</b>`)
      .join('');
    this.el.innerHTML = `<div class="logo"><span>${letters}</span><small>briga bagunçada de gelatina</small></div>`;
    const qualities: (Quality | 'auto')[] = ['auto', 'alta', 'media', 'baixa'];
    let q = 0;
    const qName = { auto: 'Automática', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
    this.list = new MenuList([
      { label: 'Jogar (local)', hint: '2 a 4 jogadores na mesma tela', action: act.local },
      { label: 'Contra robôs', hint: 'Robôs completam as vagas', action: act.bots },
      { label: 'Como jogar', hint: 'Golpes, botões e o combo básico', action: act.howto },
      { label: 'Configurar controles', hint: 'Quem usa qual controle', action: act.controls },
      {
        label: () => `Som: ${audio.muted ? 'desligado' : 'ligado'}`,
        change: () => audio.setMuted(!audio.muted),
      },
      {
        label: () => `Qualidade: ${qName[qualities[q]]}`,
        change: (d) => {
          q = (q + d + qualities.length) % qualities.length;
          const v = qualities[q];
          engine.autoQuality = v === 'auto';
          engine.setQuality(v === 'auto' ? 'alta' : v);
        },
      },
    ]);
    this.el.appendChild(this.list.el);
    this.pads = h('div', 'pads-status');
    this.el.appendChild(this.pads);
    this.el.appendChild(
      h('div', 'footer', 'Setas / analógico para escolher · <b>Espaço</b> ou <b>A / ✕</b> para confirmar · Funciona com controle de Xbox e de PS5'),
    );
    uiRoot().appendChild(this.el);
  }

  update() {
    driveMenu(this.input, this.list);
    const pads = [...this.input.pads.values()];
    this.pads.innerHTML = pads.length
      ? pads.map((p) => `<span>🎮 ${p.label}</span>`).join('')
      : padsBlocked
        ? '<span class="dim">⚠ O navegador bloqueou os controles nesta janela — abra o jogo em uma aba própria (tela cheia) para usar controle</span>'
        : '<span class="dim">Nenhum controle conectado — aperte um botão no controle para ele aparecer</span>';
  }

  destroy() {
    this.el.remove();
  }
}
