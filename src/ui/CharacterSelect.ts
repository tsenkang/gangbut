import { h, hex, uiRoot, type Screen } from './UI';
import type { InputManager, Device } from '../input/InputManager';
import { CHARACTERS, COLORS, HATS, type Appearance } from '../characters/Skins';
import { SLOT_COLORS } from '../game/config';
import { audio } from '../audio/Audio';
import type { MenuAction } from '../input/types';
import { buttonNames, GamepadSource } from '../input/Gamepads';

// ------------------------------------------------------------
// Escolha de personagem. Cada jogador entra apertando o botão de
// pular no SEU controle/teclado e escolhe personagem, cor e chapéu
// com as setas. Controles já ligados entram sozinhos.
// ------------------------------------------------------------

export interface SlotState {
  deviceId: string | null;
  appearance: Appearance;
  row: number; // 0 personagem, 1 cor, 2 chapéu, 3 pronto
  ready: boolean;
}

export function defaultAppearance(slot: number): Appearance {
  const c = CHARACTERS[slot % CHARACTERS.length];
  return { character: c.id, color: c.defaultColor, hat: HATS[(slot + 1) % HATS.length].id };
}

export class CharacterSelect implements Screen {
  el: HTMLElement;
  private cards: HTMLElement[] = [];
  private doneTimer = -1;

  constructor(
    private input: InputManager,
    public slots: SlotState[],
    private vsBots: boolean,
    private cb: { changed(): void; done(): void; back(): void },
    autoJoin: boolean,
  ) {
    this.el = h('div', 'screen select');
    this.el.innerHTML = `<h1 class="title">Escolham seus molengas!</h1>`;
    const row = h('div', 'cards');
    for (let i = 0; i < 4; i++) {
      const c = h('div', 'card');
      c.style.setProperty('--c', hex(SLOT_COLORS[i]));
      c.addEventListener('click', (e) => this.onClick(i, e));
      this.cards.push(c);
      row.appendChild(c);
    }
    this.el.appendChild(row);
    this.el.appendChild(
      h('div', 'footer', 'Entrar: <b>Espaço</b> (teclado A) · <b>0 / Enter</b> (teclado B) · <b>A / ✕</b> (controle) &nbsp;|&nbsp; Sair: <b>K</b>, <b>2/.</b> ou <b>B / ○</b> &nbsp;|&nbsp; Esc: voltar'),
    );
    uiRoot().appendChild(this.el);
    if (autoJoin) this.autoJoin();
    this.render();
  }

  /** Controles ligados entram sozinhos; sem controle, entra o teclado A. */
  autoJoin() {
    const pads = [...this.input.pads.values()];
    for (const p of pads) this.join(p, false);
    if (!pads.length && !this.slots.some((s) => s.deviceId)) this.join(this.input.keyboardA, false);
  }

  /** Um controle foi ligado com a tela aberta. */
  padConnected(d: Device) {
    this.join(d);
  }

  private join(d: Device, sound = true) {
    if (this.slots.some((s) => s.deviceId === d.id)) return;
    const free = this.slots.find((s) => !s.deviceId);
    if (!free) return;
    free.deviceId = d.id;
    free.row = 0;
    free.ready = false;
    if (sound) audio.play('join');
    this.cb.changed();
    this.render();
  }

  private leave(s: SlotState) {
    s.deviceId = null;
    s.ready = false;
    audio.play('uiBack');
    this.cb.changed();
    this.render();
  }

  private cycle(s: SlotState, row: number, dir: number) {
    const a = { ...s.appearance };
    if (row === 0) {
      const i = CHARACTERS.findIndex((c) => c.id === a.character);
      const next = CHARACTERS[(i + dir + CHARACTERS.length) % CHARACTERS.length];
      // se a cor era a padrão do personagem anterior, troca junto
      if (a.color === CHARACTERS[i].defaultColor) a.color = next.defaultColor;
      a.character = next.id;
    } else if (row === 1) {
      const i = COLORS.findIndex((c) => c.hex === a.color);
      a.color = COLORS[(i + dir + COLORS.length) % COLORS.length].hex;
    } else if (row === 2) {
      const i = HATS.findIndex((c) => c.id === a.hat);
      a.hat = HATS[(i + dir + HATS.length) % HATS.length].id;
    }
    s.appearance = a;
    audio.play('ui');
    this.cb.changed();
  }

  private act(s: SlotState, a: MenuAction) {
    if (s.ready) {
      if (a === 'back' || a === 'confirm') {
        s.ready = a === 'confirm';
        if (!s.ready) audio.play('uiBack');
      }
      return;
    }
    if (a === 'up') s.row = (s.row + 3) % 4;
    else if (a === 'down') s.row = (s.row + 1) % 4;
    else if ((a === 'left' || a === 'right') && s.row < 3) this.cycle(s, s.row, a === 'left' ? -1 : 1);
    else if (a === 'confirm') {
      if (s.row === 3) {
        s.ready = true;
        audio.play('join');
      } else {
        s.row++;
        audio.play('ui');
      }
    } else if (a === 'back') this.leave(s);
  }

  private onClick(i: number, e: MouseEvent) {
    audio.unlock();
    const s = this.slots[i];
    const t = e.target as HTMLElement;
    if (!s.deviceId) {
      // clicar num cartão vazio coloca o teclado livre nele
      const kb = [this.input.keyboardA, this.input.keyboardB].find((k) => !this.slots.some((x) => x.deviceId === k.id));
      if (kb) this.join(kb);
      return;
    }
    if (t.dataset.row !== undefined) {
      const row = +t.dataset.row;
      if (t.dataset.dir) this.cycle(s, row, +t.dataset.dir);
      else if (row === 3) s.ready = !s.ready;
      s.row = row;
    }
    this.render();
  }

  update(dt: number) {
    const edges = this.input.anyEdges();
    for (const { action, device } of edges) {
      const s = this.slots.find((x) => x.deviceId === device.id);
      if (!s) {
        if (action === 'confirm') this.join(device);
        else if (action === 'back' || action === 'pause') {
          if (!this.slots.some((x) => x.deviceId)) {
            audio.play('uiBack');
            this.cb.back();
            return;
          }
        }
        continue;
      }
      if (action === 'pause' && !s.ready) {
        // Esc / Start: volta ao menu
        audio.play('uiBack');
        this.cb.back();
        return;
      }
      this.act(s, action);
    }
    const joined = this.slots.filter((s) => s.deviceId);
    const allReady = joined.length > 0 && joined.every((s) => s.ready);
    if (allReady) {
      if (this.doneTimer < 0) this.doneTimer = 0.6;
      this.doneTimer -= dt;
      if (this.doneTimer <= 0) {
        this.doneTimer = 99;
        this.cb.done();
        return;
      }
    } else this.doneTimer = -1;
    if (edges.length) this.render();
  }

  private deviceLabel(id: string) {
    const d = this.input.getSource(id);
    return d ? d.label : 'desconectado';
  }

  private render() {
    this.slots.forEach((s, i) => {
      const c = this.cards[i];
      c.classList.toggle('empty', !s.deviceId);
      c.classList.toggle('ready', s.ready);
      if (!s.deviceId) {
        c.innerHTML = `<div class="who">J${i + 1}</div><div class="join">${
          this.vsBots ? '🤖 Robô<br><small>ou aperte pular para entrar</small>' : 'Aperte <b>pular</b><br>para entrar'
        }</div>`;
        return;
      }
      const ch = CHARACTERS.find((x) => x.id === s.appearance.character)!;
      const col = COLORS.find((x) => x.hex === s.appearance.color);
      const hat = HATS.find((x) => x.id === s.appearance.hat)!;
      const dev = this.input.getSource(s.deviceId);
      const names = dev instanceof GamepadSource ? buttonNames(dev.type) : null;
      const rows = [
        `<span class="v">${ch.name}</span>`,
        `<span class="v"><i class="sw" style="background:${hex(s.appearance.color)}"></i>${col?.name ?? 'Cor'}</span>`,
        `<span class="v">${hat.name}</span>`,
      ];
      c.innerHTML =
        `<div class="who">J${i + 1} <small>${this.deviceLabel(s.deviceId)}</small></div>` +
        rows
          .map(
            (r, k) =>
              `<div class="opt ${s.row === k && !s.ready ? 'focus' : ''}" data-row="${k}"><span class="arrow" data-row="${k}" data-dir="-1">◀</span>${r}<span class="arrow" data-row="${k}" data-dir="1">▶</span></div>`,
          )
          .join('') +
        `<div class="desc">${ch.description}</div>` +
        `<div class="opt readybtn ${s.row === 3 && !s.ready ? 'focus' : ''}" data-row="3">${s.ready ? '✔ PRONTO!' : `Pronto? (${names ? names.jump : 'pular'})`}</div>`;
    });
  }

  destroy() {
    this.el.remove();
  }
}
