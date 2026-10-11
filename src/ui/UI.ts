import type { InputManager, Device } from '../input/InputManager';
import type { MenuAction } from '../input/types';
import { audio } from '../audio/Audio';

// ------------------------------------------------------------
// Ajudantes de interface: criar elementos, telas e listas de botões
// que funcionam com mouse, teclado e controle.
// ------------------------------------------------------------

export const uiRoot = () => document.getElementById('ui')!;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export interface Screen {
  el: HTMLElement;
  update(dt: number): void;
  destroy(): void;
}

export interface MenuItem {
  label: string | (() => string);
  /** Ao confirmar. */
  action?: () => void;
  /** Para itens de "escolha" (setas esquerda/direita). */
  change?: (dir: number) => void;
  hint?: string | (() => string);
  disabled?: () => boolean;
}

/**
 * Lista de botões navegável. Setas mudam o foco, confirmar aciona,
 * esquerda/direita mudam opções. Mouse também funciona.
 */
export class MenuList {
  el: HTMLDivElement;
  focus = 0;
  private buttons: HTMLDivElement[] = [];

  constructor(
    public items: MenuItem[],
    cls = 'menu-list',
  ) {
    this.el = h('div', cls);
    items.forEach((it, i) => {
      const b = h('div', 'btn');
      b.addEventListener('mouseenter', () => this.setFocus(i, false));
      b.addEventListener('click', (e) => {
        audio.unlock();
        const t = e.target as HTMLElement;
        if (t.dataset.dir) this.change(i, +t.dataset.dir);
        else if (it.action) this.activate(i);
        else if (it.change) this.change(i, 1);
      });
      this.buttons.push(b);
      this.el.appendChild(b);
    });
    this.render();
  }

  setFocus(i: number, sound = true) {
    const n = this.items.length;
    let k = ((i % n) + n) % n;
    // pula itens desabilitados
    for (let tries = 0; tries < n && this.items[k].disabled?.(); tries++) k = (k + (i >= this.focus ? 1 : -1) + n) % n;
    if (k !== this.focus && sound) audio.play('ui');
    this.focus = k;
    this.render();
  }

  private activate(i: number) {
    const it = this.items[i];
    if (it.disabled?.()) return;
    audio.play('join');
    it.action?.();
    this.render();
  }

  private change(i: number, d: number) {
    const it = this.items[i];
    if (!it.change || it.disabled?.()) return;
    audio.play('ui');
    it.change(d);
    this.render();
  }

  handle(a: MenuAction) {
    if (a === 'up') this.setFocus(this.focus - 1);
    else if (a === 'down') this.setFocus(this.focus + 1);
    else if (a === 'left') this.change(this.focus, -1);
    else if (a === 'right') this.change(this.focus, 1);
    else if (a === 'confirm') {
      const it = this.items[this.focus];
      if (it.action) this.activate(this.focus);
      else this.change(this.focus, 1);
    }
  }

  render() {
    this.items.forEach((it, i) => {
      const b = this.buttons[i];
      const label = typeof it.label === 'function' ? it.label() : it.label;
      const hint = it.hint ? (typeof it.hint === 'function' ? it.hint() : it.hint) : '';
      b.classList.toggle('focus', i === this.focus);
      b.classList.toggle('disabled', !!it.disabled?.());
      b.classList.toggle('choice', !!it.change);
      b.innerHTML = it.change
        ? `<span class="arrow" data-dir="-1">◀</span><span class="lbl">${label}</span><span class="arrow" data-dir="1">▶</span>`
        : `<span class="lbl">${label}</span>`;
      if (hint) b.innerHTML += `<small>${hint}</small>`;
    });
  }
}

/** Repassa os toques de menu de qualquer dispositivo para uma lista. */
export function driveMenu(input: InputManager, list: MenuList, onBack?: (d: Device) => void) {
  for (const { action, device } of input.anyEdges()) {
    if (action === 'back') {
      if (onBack) {
        audio.play('uiBack');
        onBack(device);
      }
    } else if (action !== 'pause') list.handle(action);
  }
}

/** Avisos rápidos no canto da tela (controle ligado/desligado...). */
export function toast(msg: string, kind: 'ok' | 'warn' | 'info' = 'info', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div');
    box.id = 'toasts';
    document.getElementById('app')!.appendChild(box);
  }
  const t = h('div', 'toast ' + kind, msg);
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 500);
}
