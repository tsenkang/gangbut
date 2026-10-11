import { emptyControl, type ControlState, type InputSource, type MenuAction } from './types';

// ------------------------------------------------------------
// Teclado. Dois jogadores dividem o mesmo teclado:
//   Teclado A (jogador 1): WASD + J K L + espaço
//   Teclado B (jogador 2): setas + teclado numérico
// Usamos event.code (posição física da tecla), então funciona
// igual em teclado ABNT ou americano.
// ------------------------------------------------------------

const down = new Set<string>();
/** Teclas apertadas desde o último quadro (para não perder toques rápidos). */
const tapped = new Set<string>();

/** Chamado uma vez por quadro, depois de ler o teclado. */
export function clearTaps() {
  tapped.clear();
}

export function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    // Evita a página rolar com espaço / setas.
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code.startsWith('Numpad')) e.preventDefault();
    down.add(e.code);
    tapped.add(e.code);
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
}

export const isDown = (code: string) => down.has(code);

export interface KeyLayout {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  jump: string[];
  punchL: string[];
  punchR: string[];
  grab: string[];
  headbutt: string[];
  armsUp: string[];
  pause: string[];
}

export const LAYOUT_A: KeyLayout = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  punchL: ['KeyJ'],
  punchR: ['KeyK'],
  grab: ['KeyL'],
  headbutt: ['KeyU'],
  armsUp: ['KeyI'],
  pause: ['Escape'],
};

export const LAYOUT_B: KeyLayout = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  jump: ['Numpad0', 'Enter'],
  punchL: ['Numpad1', 'Comma'],
  punchR: ['Numpad2', 'Period'],
  grab: ['Numpad3', 'ShiftRight'],
  headbutt: ['Numpad5', 'Slash'],
  armsUp: ['Numpad6', 'Quote'],
  pause: ['NumpadEnter', 'Backspace'],
};

const any = (codes: string[]) => codes.some((c) => down.has(c) || tapped.has(c));

export class KeyboardSource implements InputSource {
  kind = 'keyboard' as const;
  constructor(
    public id: string,
    public label: string,
    public layout: KeyLayout,
  ) {}

  connected() {
    return true;
  }

  read(): ControlState {
    const L = this.layout;
    const s = emptyControl();
    s.moveX = (any(L.right) ? 1 : 0) - (any(L.left) ? 1 : 0);
    s.moveY = (any(L.up) ? 1 : 0) - (any(L.down) ? 1 : 0);
    // Na diagonal, normaliza para não andar mais rápido.
    if (s.moveX && s.moveY) {
      s.moveX *= Math.SQRT1_2;
      s.moveY *= Math.SQRT1_2;
    }
    s.jump = any(L.jump);
    s.punchL = any(L.punchL);
    s.punchR = any(L.punchR);
    s.grabL = s.grabR = any(L.grab);
    s.headbutt = any(L.headbutt);
    s.armY = any(L.armsUp) ? 1 : 0;
    s.pause = any(L.pause);
    return s;
  }

  /** Teclas de menu deste lado do teclado. */
  menuState(): Record<MenuAction, boolean> {
    const L = this.layout;
    return {
      up: any(L.up),
      down: any(L.down),
      left: any(L.left),
      right: any(L.right),
      confirm: any(L.jump),
      back: any(L.punchR) || any(L.pause),
      pause: any(L.pause),
    };
  }
}
