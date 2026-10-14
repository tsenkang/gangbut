import type { InputSource } from './types';
import { GamepadSource, buttonNames } from './Gamepads';

// ------------------------------------------------------------
// Nome dos botões de cada ação, de acordo com o dispositivo do
// jogador. Usado na legenda da luta, nas dicas e no "Como jogar".
// ------------------------------------------------------------

export interface ControlLabels {
  move: string;
  jump: string;
  punchL: string;
  punchR: string;
  punch: string; // "J / K"
  grab: string;
  headbutt: string;
  arms: string;
  run: string;
  kick: string;
  duck: string;
  pause: string;
}

export const KEYBOARD_A: ControlLabels = {
  move: 'W A S D',
  jump: 'Espaço',
  punchL: 'J',
  punchR: 'K',
  punch: 'J / K',
  grab: 'L',
  headbutt: 'U',
  arms: 'I',
  run: 'Shift',
  kick: 'O',
  duck: 'C',
  pause: 'Esc',
};

export const KEYBOARD_B: ControlLabels = {
  move: 'Setas',
  jump: 'Enter',
  punchL: ',',
  punchR: '.',
  punch: ', / .',
  grab: 'Shift dir.',
  headbutt: 'Num 5',
  arms: 'Num 6',
  run: 'Ctrl dir.',
  kick: 'Num 4',
  duck: 'Num 7',
  pause: 'Backspace',
};

export function labelsFor(src: InputSource | undefined): ControlLabels {
  if (src instanceof GamepadSource) {
    const n = buttonNames(src.type);
    return {
      move: 'Analógico esq.',
      jump: n.jump,
      punchL: n.punchL,
      punchR: n.punchR,
      punch: `${n.punchL} / ${n.punchR}`,
      grab: `${n.grabL} / ${n.grabR}`,
      headbutt: n.headbutt,
      arms: 'Analógico dir.',
      run: n.run,
      kick: n.kick,
      duck: n.duck,
      pause: n.pause,
    };
  }
  if (src?.id === 'kbB') return KEYBOARD_B;
  return KEYBOARD_A;
}
