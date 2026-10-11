import { GamepadSource, getPad } from './Gamepads';
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

  private pollPads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    const seen = new Set<number>();
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      const known = this.pads.get(gp.index);
      if (!known) {
        const src = new GamepadSource(gp.index, gp.id);
        this.pads.set(gp.index, src);
        this.connectCbs.forEach((cb) => cb(src));
      }
    }
    for (const [idx, src] of this.pads) {
      if (!seen.has(idx) && !getPad(idx)) {
        this.pads.delete(idx);
        this.disconnectCbs.forEach((cb) => cb(src));
      }
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
