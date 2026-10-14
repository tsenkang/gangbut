import { GamepadSource, listPads, looksLikePad } from './Gamepads';
import { KeyboardSource, LAYOUT_A, LAYOUT_B, initKeyboard, clearTaps } from './Keyboard';
import type { MenuAction } from './types';

// ------------------------------------------------------------
// Junta teclado e controles. Detecta quando um controle é ligado
// ou desligado (mesmo no meio do jogo) olhando a lista de
// controles a cada quadro — é mais confiável que só os eventos.
// ------------------------------------------------------------

export type Device = KeyboardSource | GamepadSource;

const ACTIONS: MenuAction[] = ['up', 'down', 'left', 'right', 'confirm', 'back', 'pause'];
const REPEATABLE = new Set<MenuAction>(['up', 'down', 'left', 'right']);

interface MenuMemory {
  held: Record<string, number>; // tempo segurando cada ação
  edges: MenuAction[];
}

export class InputManager {
  keyboardA = new KeyboardSource('kbA', 'Teclado A (WASD)', LAYOUT_A);
  keyboardB = new KeyboardSource('kbB', 'Teclado B (setas)', LAYOUT_B);
  pads = new Map<number, GamepadSource>();
  private memory = new Map<string, MenuMemory>();
  private connectCbs: ((p: GamepadSource) => void)[] = [];
  private disconnectCbs: ((p: GamepadSource) => void)[] = [];

  constructor() {
    initKeyboard();
    // Os eventos ajudam, mas a verificação principal é no update().
    window.addEventListener('gamepadconnected', () => this.pollPads());
    window.addEventListener('gamepaddisconnected', () => this.pollPads());
  }

  onConnect(cb: (p: GamepadSource) => void) {
    this.connectCbs.push(cb);
  }
  onDisconnect(cb: (p: GamepadSource) => void) {
    this.disconnectCbs.push(cb);
  }

  private missing = new Map<GamepadSource, number>(); // há quanto tempo sumiu
  private lost: GamepadSource[] = []; // desconectados (esperando voltar)
  private lastPoll = performance.now();
  private twins = new Set<number>(); // índices que são cópia de outro controle (ignorados)

  /** O que está apertado agora (para reconhecer um controle "espelho"). */
  private signature(gp: Gamepad) {
    let sig = '';
    for (let i = 0; i < Math.min(gp.buttons.length, 17); i++) sig += gp.buttons[i].pressed || gp.buttons[i].value > 0.5 ? '1' : '0';
    for (const a of gp.axes.slice(0, 2)) sig += a > 0.6 ? '+' : a < -0.6 ? '-' : '0';
    return sig;
  }

  private active(gp: Gamepad) {
    return gp.buttons.some((b) => b.pressed || b.value > 0.5) || gp.axes.slice(0, 2).some((a) => Math.abs(a) > 0.6);
  }

  private pollPads() {
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.lastPoll) / 1000);
    this.lastPoll = now;
    const list = listPads();
    const seen = new Set<number>();
    const present = new Set<number>();
    for (const gp of list) if (gp && gp.connected) present.add(gp.index);
    for (const i of [...this.twins]) if (!present.has(i)) this.twins.delete(i);
    for (const gp of list) {
      if (!gp || !gp.connected || !looksLikePad(gp)) continue;
      seen.add(gp.index);
      const known = this.pads.get(gp.index);
      if (known) {
        this.missing.delete(known);
        continue;
      }
      if (this.twins.has(gp.index)) continue;
      // Só vira jogador depois de apertar algo nele.
      if (!this.active(gp)) continue;
      // O mesmo controle aparecendo duas vezes (Steam, DS4Windows, HID + XInput...):
      // se outro controle já conhecido está com exatamente os mesmos botões
      // apertados agora, este é um espelho dele.
      const sig = this.signature(gp);
      const mirror = /[1+-]/.test(sig) && list.some((o) => o && o.index !== gp.index && o.connected && (this.pads.has(o.index) || seen.has(o.index)) && this.signature(o) === sig);
      if (mirror) {
        this.twins.add(gp.index);
        continue;
      }
      // Um controle que tinha caído voltou (mesmo em outro índice)? Devolve
      // o mesmo "dispositivo" para o jogador continuar com ele.
      const back = this.lost.shift();
      const src = back ?? new GamepadSource(gp.index, gp.id);
      if (back) back.rebind(gp.index, gp.id);
      this.pads.set(gp.index, src);
      this.memory.delete(src.id);
      this.connectCbs.forEach((cb) => cb(src));
    }
    for (const [idx, src] of this.pads) {
      if (seen.has(idx)) continue;
      // Bluetooth às vezes "pisca": só considera desligado depois de 1,2 s sumido.
      const t = (this.missing.get(src) ?? 0) + dt;
      this.missing.set(src, t);
      if (t < 1.2) continue;
      this.missing.delete(src);
      this.pads.delete(idx);
      this.lost.push(src);
      this.disconnectCbs.forEach((cb) => cb(src));
    }
  }

  devices(): Device[] {
    return [this.keyboardA, this.keyboardB, ...[...this.pads.values()].sort((a, b) => a.index - b.index)];
  }

  getSource(id: string): Device | undefined {
    return this.devices().find((d) => d.id === id);
  }

  /** Chamar uma vez por quadro. Calcula os toques de menu (com repetição ao segurar). */
  update(dt: number) {
    this.pollPads();
    for (const dev of this.devices()) {
      let mem = this.memory.get(dev.id);
      if (!mem) {
        mem = { held: {}, edges: [] };
        // Começa como "segurando" para não disparar no primeiro quadro.
        const st0 = dev.menuState();
        for (const a of ACTIONS) mem.held[a] = st0[a] ? 999 : -1;
        this.memory.set(dev.id, mem);
        continue;
      }
      mem.edges = [];
      const st = dev.menuState();
      for (const a of ACTIONS) {
        if (st[a]) {
          const before = mem.held[a];
          if (before < 0) {
            mem.edges.push(a);
            mem.held[a] = 0;
          } else {
            mem.held[a] = before + dt;
            // Repetição automática nas setas.
            if (REPEATABLE.has(a) && before < 900) {
              const first = 0.38;
              const rep = 0.11;
              if (before < first && mem.held[a] >= first) mem.edges.push(a);
              else if (before >= first && Math.floor((before - first) / rep) !== Math.floor((mem.held[a] - first) / rep))
                mem.edges.push(a);
            }
          }
        } else mem.held[a] = -1;
      }
    }
  }

  /** Fim do quadro: esquece os toques rápidos já lidos. */
  endFrame() {
    clearTaps();
  }

  /** Toques de menu de um dispositivo neste quadro. */
  edges(deviceId: string): MenuAction[] {
    return this.memory.get(deviceId)?.edges ?? [];
  }

  /** Toques de menu de qualquer dispositivo (para menus simples). */
  anyEdges(): { action: MenuAction; device: Device }[] {
    const out: { action: MenuAction; device: Device }[] = [];
    for (const d of this.devices()) for (const a of this.edges(d.id)) out.push({ action: a, device: d });
    return out;
  }

  /** Ignora o que está apertado agora (ex.: ao trocar de tela). */
  swallow() {
    for (const [, mem] of this.memory) {
      mem.edges = [];
      for (const a of ACTIONS) if (mem.held[a] >= 0) mem.held[a] = 999;
    }
  }
}
