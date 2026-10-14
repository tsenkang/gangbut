import { MenuList, driveMenu, h, hex, uiRoot, type Screen } from './UI';
import type { InputManager } from '../input/InputManager';
import { GamepadSource, buttonNames, padsBlocked } from '../input/Gamepads';
import { SLOT_COLORS } from '../game/config';

// ------------------------------------------------------------
// "Configurar controles": mostra os dispositivos conectados, qual
// jogador usa cada um, e acende quando você aperta algo (teste).
// A troca de jogador é feita entrando/saindo na tela de escolha.
// ------------------------------------------------------------

export class ControlsScreen implements Screen {
  el: HTMLElement;
  private list: MenuList;
  private table = h('div', 'devices');

  constructor(
    private input: InputManager,
    /** deviceId -> número do jogador (0..3) */
    private assignment: () => Map<string, number>,
    private cb: { back(): void; reset(): void },
  ) {
    this.el = h('div', 'screen controls');
    this.el.innerHTML = `<h1 class="title">Controles</h1>`;
    this.el.appendChild(this.table);
    const help = h('div', 'bindings');
    const x = buttonNames('xbox');
    const p = buttonNames('playstation');
    help.innerHTML = `
      <table>
        <tr><th>Ação</th><th>Teclado A</th><th>Teclado B</th><th>Xbox</th><th>PS5</th></tr>
        <tr><td>Andar</td><td>W A S D</td><td>Setas</td><td colspan=2>Analógico esquerdo</td></tr>
        <tr><td>Pular / escalar</td><td>Espaço</td><td>0 / Enter</td><td>${x.jump}</td><td>${p.jump}</td></tr>
        <tr><td>Soco esquerdo</td><td>J</td><td>1 / ,</td><td>${x.punchL}</td><td>${p.punchL}</td></tr>
        <tr><td>Soco direito</td><td>K</td><td>2 / .</td><td>${x.punchR}</td><td>${p.punchR}</td></tr>
        <tr><td>Agarrar (segurar)</td><td>L</td><td>3 / Shift dir.</td><td>${x.grabL} / ${x.grabR}</td><td>${p.grabL} / ${p.grabR}</td></tr>
        <tr><td>Cabeçada</td><td>U</td><td>5 (num.)</td><td>${x.headbutt}</td><td>${p.headbutt}</td></tr>
        <tr><td>Chutar</td><td>O</td><td>4 (num.)</td><td>${x.kick}</td><td>${p.kick}</td></tr>
        <tr><td>Correr (segurar)</td><td>Shift esq.</td><td>Ctrl dir. / 9 (num.)</td><td>${x.run}</td><td>${p.run}</td></tr>
        <tr><td>Abaixar (segurar)</td><td>C / Ctrl esq.</td><td>7 (num.)</td><td>${x.duck}</td><td>${p.duck}</td></tr>
        <tr><td>Erguer os braços</td><td>I</td><td>6 (num.)</td><td colspan=2>Analógico direito (cima/baixo)</td></tr>
        <tr><td>Pausar</td><td>Esc</td><td>Enter numérico</td><td>${x.pause}</td><td>${p.pause}</td></tr>
      </table>
      <p class="tips">Dicas: segurando alguém, aperte <b>soco</b> para arremessar. Pendurado numa borda, aperte <b>pular</b> para subir. No ar, <b>soco</b> vira voadora. Apanhando de alguém que te segura? Aperte botões sem parar para escapar!</p>`;
    this.el.appendChild(help);
    this.list = new MenuList([
      { label: 'Reorganizar jogadores', hint: 'Volta todos para a escolha de personagem', action: () => cb.reset() },
      { label: 'Voltar', action: () => cb.back() },
    ]);
    this.list.focus = 1;
    this.list.render();
    this.el.appendChild(this.list.el);
    uiRoot().appendChild(this.el);
  }

  update() {
    driveMenu(this.input, this.list, () => this.cb.back());
    const asg = this.assignment();
    const rows = this.input.devices().map((d) => {
      const st = d.read();
      const active =
        Math.abs(st.moveX) > 0.1 || Math.abs(st.moveY) > 0.1 || st.jump || st.punchL || st.punchR || st.grabL || st.grabR || st.headbutt || st.run || st.kick || st.duck || Math.abs(st.armY) > 0.2;
      const slot = asg.get(d.id);
      const who =
        slot !== undefined
          ? `<span class="pl" style="--c:${hex(SLOT_COLORS[slot])}">Jogador ${slot + 1}</span>`
          : `<span class="pl free">livre</span>`;
      const icon = d instanceof GamepadSource ? '🎮' : '⌨️';
      const detail = d instanceof GamepadSource ? `#${d.index + 1}` : '';
      const pressed = [st.jump && 'pular', st.punchL && 'soco E', st.punchR && 'soco D', st.grabL && 'agarrar E', st.grabR && 'agarrar D', st.headbutt && 'cabeçada', st.kick && 'chute', st.run && 'correr', st.duck && 'abaixar']
        .filter(Boolean)
        .join(' · ');
      return `<div class="dev ${active ? 'active' : ''}"><span class="ic">${icon}</span><span class="nm">${d.label} ${detail}</span>${who}<span class="live">${
        pressed || (active ? 'mexendo…' : 'aperte algo para testar')
      }</span></div>`;
    });
    if (!this.input.pads.size)
      rows.push(
        padsBlocked
          ? `<div class="dev dim">⚠ O navegador bloqueou os controles nesta janela. Abra o jogo numa aba própria para usar controle.</div>`
          : `<div class="dev dim">Nenhum controle detectado. Ligue o controle (USB ou Bluetooth) e aperte qualquer botão.</div>`,
      );
    this.table.innerHTML = rows.join('');
  }

  destroy() {
    this.el.remove();
  }
}
