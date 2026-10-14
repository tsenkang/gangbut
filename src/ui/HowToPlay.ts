import { MenuList, driveMenu, h, uiRoot, type Screen } from './UI';
import type { InputManager } from '../input/InputManager';
import { KEYBOARD_A, KEYBOARD_B, labelsFor } from '../input/labels';

// ------------------------------------------------------------
// "Como jogar": o objetivo, os golpes e o combo básico, com as
// teclas de cada dispositivo lado a lado.
// ------------------------------------------------------------

export class HowToPlay implements Screen {
  el: HTMLElement;
  private list: MenuList;

  constructor(
    private input: InputManager,
    cb: { done(): void; back(): void },
    doneLabel = 'Voltar',
  ) {
    const A = KEYBOARD_A;
    const B = KEYBOARD_B;
    const pad = [...input.pads.values()][0];
    const P = labelsFor(pad ?? ({ id: 'pad', kind: 'gamepad' } as never));
    const padName = pad ? pad.label : 'Controle';
    const padLabels = pad ? P : { ...P, move: 'Analógico esq.', arms: 'Analógico dir.', jump: 'A / ✕', punchL: 'X / □', punchR: 'B / ○', punch: 'X B / □ ○', grab: 'LT RT / L2 R2', headbutt: 'Y / △', run: 'LB / L1', kick: 'RB / R1', duck: 'RS / R3', pause: 'Start' };
    const keys = (a: string, b: string, c: string) => `<div class="keys"><span><i>J1</i><kbd>${a}</kbd></span><span><i>J2</i><kbd>${b}</kbd></span><span><i>🎮</i><kbd>${c}</kbd></span></div>`;

    this.el = h('div', 'screen howto');
    this.el.innerHTML = `
      <h1 class="title">Como jogar</h1>
      <p class="goal"><b>Objetivo:</b> jogue os outros para <b>fora do mapa</b>. O último em pé vence a rodada.</p>
      <div class="moves">
        <div class="move"><h3>Andar</h3><p>Seu boneco é mole e desajeitado: é assim mesmo!</p>${keys(A.move, B.move, padLabels.move)}</div>
        <div class="move"><h3>Socar</h3><p>Cada soco enche a <b>barra amarela</b> do outro. Cheia = <b>nocaute</b>. <b>Segure</b> o soco e solte: <b>SOCÃO</b>!</p>${keys(A.punch, B.punch, padLabels.punch)}</div>
        <div class="move hot"><h3>Agarrar <small>(segure)</small></h3><p>Estica os braços e segura o que tocar: gente, caixas, bordas. Soltou o botão, soltou a mão.</p>${keys(A.grab, B.grab, padLabels.grab)}</div>
        <div class="move hot"><h3>Erguer e arremessar</h3><p>Segurando com as <b>duas mãos</b>, levante os braços para <b>erguer acima da cabeça</b>. Depois aperte <b>soco</b> ou <b>solte o agarrar</b>: de lá de cima (ou correndo) voa muito mais longe!</p>${keys(A.arms + ' + ' + A.punchL, B.arms + ' + ' + B.punchL, padLabels.arms + ' + ' + padLabels.punchL)}</div>
        <div class="move"><h3>Pular / subir</h3><p>Pendurado numa borda (agarrando), aperte <b>pular</b> para subir.</p>${keys(A.jump, B.jump, padLabels.jump)}</div>
        <div class="move"><h3>Chutar</h3><p>Chute para a frente (mais forte que o soco, ótimo na bola do futebol). No ar, o chute vira <b>voadora</b>.</p>${keys(A.kick, B.kick, padLabels.kick)}</div>
        <div class="move"><h3>Correr <small>(segure)</small></h3><p>Bem mais rápido — e dá um <b>tranco de ombro</b> forte em quem estiver na frente.</p>${keys(A.run, B.run, padLabels.run)}</div>
        <div class="move"><h3>Abaixar <small>(segure)</small></h3><p>Fica agachado: passa por baixo do <b>túnel</b> do trem e das <b>placas</b> da estrada.</p>${keys(A.duck, B.duck, padLabels.duck)}</div>
        <div class="move"><h3>Cabeçada / voadora</h3><p>Cabeçada é forte, mas te deixa um pouco tonto. Pule e aperte <b>soco</b>: voadora (e você cai de costas).</p>${keys(A.headbutt, B.headbutt, padLabels.headbutt)}</div>
      </div>
      <div class="combo"><b>Combo básico:</b>
        <span>1. Soque até ele desmaiar</span><span>→</span><span>2. Segure o agarrar</span><span>→</span><span>3. Leve até a borda</span><span>→</span><span>4. Soco para jogar!</span>
      </div>
      <p class="small">Golpe forte derruba (tombo) e faz largar o que estava segurando. Soque a mão de quem está pendurado para ele soltar. Correndo, você dá um <b>tranco</b> em quem estiver na frente. Para pegar alguém caído é só segurar o agarrar perto dele: o boneco se abaixa sozinho. Desmaiado ou seguro por alguém? Aperte botões sem parar para acordar/escapar. · Pausa: ${A.pause} (J1), ${B.pause} (J2), ${padLabels.pause} (${padName}).</p>`;
    this.list = new MenuList([{ label: doneLabel, action: () => cb.done() }]);
    this.el.appendChild(this.list.el);
    uiRoot().appendChild(this.el);
    this.back = cb.back;
  }
  private back: () => void;

  update() {
    driveMenu(this.input, this.list, () => this.back());
  }

  destroy() {
    this.el.remove();
  }
}
