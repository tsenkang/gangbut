import { emptyControl, type ControlState, type InputSource, type MenuAction } from './types';

// ------------------------------------------------------------
// Controles (Xbox e PlayStation 5 / DualSense) pela Gamepad API.
// Os navegadores entregam os dois no "mapeamento padrão", com os
// botões nas mesmas posições:
//   0 = A / X(cruz)      1 = B / Círculo
//   2 = X / Quadrado     3 = Y / Triângulo
//   4 = LB / L1          5 = RB / R1
//   6 = LT / L2          7 = RT / R2
//   9 = Start / Options  12..15 = direcional
// ------------------------------------------------------------

export const BTN = {
  south: 0,
  east: 1,
  west: 2,
  north: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  select: 8,
  start: 9,
  dUp: 12,
  dDown: 13,
  dLeft: 14,
  dRight: 15,
};

/** Zona morta: ignora movimentos pequenos do analógico (para não andar sozinho). */
export const DEADZONE = 0.22;

export function applyDeadzone(x: number, y: number, dz = DEADZONE): [number, number] {
  const len = Math.hypot(x, y);
  if (len < dz) return [0, 0];
  // Reescala para começar do zero logo depois da zona morta.
  const scaled = Math.min(1, (len - dz) / (1 - dz));
  return [(x / len) * scaled, (y / len) * scaled];
}

export type PadType = 'xbox' | 'playstation' | 'generic';

export function padType(id: string): PadType {
  const s = id.toLowerCase();
  if (s.includes('054c') || s.includes('dualsense') || s.includes('dualshock') || s.includes('playstation') || s.includes('wireless controller'))
    return 'playstation';
  if (s.includes('xbox') || s.includes('xinput') || s.includes('045e') || s.includes('microsoft')) return 'xbox';
  return 'generic';
}

export function padLabel(t: PadType) {
  return t === 'xbox' ? 'Controle Xbox' : t === 'playstation' ? 'Controle PS5' : 'Controle';
}

/** Nomes dos botões para mostrar na tela, de acordo com o tipo do controle. */
export function buttonNames(t: PadType) {
  if (t === 'playstation')
    return { jump: '✕', punchL: '□', punchR: '○', headbutt: '△', grabL: 'L2', grabR: 'R2', pause: 'Options' };
  return { jump: 'A', punchL: 'X', punchR: 'B', headbutt: 'Y', grabL: 'LT', grabR: 'RT', pause: 'Start' };
}

export function getPad(index: number): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads[index];
  return p && p.connected ? p : null;
}

const pressed = (gp: Gamepad, i: number, threshold = 0.5) => {
  const b = gp.buttons[i];
  return !!b && (b.pressed || b.value > threshold);
};

export class GamepadSource implements InputSource {
  kind = 'gamepad' as const;
  type: PadType;
  label: string;
  id: string;

  constructor(
    public index: number,
    padId: string,
  ) {
    this.type = padType(padId);
    this.label = padLabel(this.type);
    this.id = 'pad' + index;
  }

  connected() {
    return !!getPad(this.index);
  }

  read(): ControlState {
    const s = emptyControl();
    const gp = getPad(this.index);
    if (!gp) return s;
    const [lx, ly] = applyDeadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
    const [, ry] = applyDeadzone(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
    // Direcional também anda (útil em controles genéricos).
    const dx = (pressed(gp, BTN.dRight) ? 1 : 0) - (pressed(gp, BTN.dLeft) ? 1 : 0);
    const dy = (pressed(gp, BTN.dUp) ? 1 : 0) - (pressed(gp, BTN.dDown) ? 1 : 0);
    s.moveX = dx || lx;
    s.moveY = dy || -ly; // no controle, "para cima" é negativo
    s.armY = -ry;
    s.jump = pressed(gp, BTN.south);
    s.punchL = pressed(gp, BTN.west);
    s.punchR = pressed(gp, BTN.east);
    s.headbutt = pressed(gp, BTN.north);
    // Gatilhos (e também os botões de ombro) agarram.
    s.grabL = pressed(gp, BTN.lt, 0.3) || pressed(gp, BTN.lb);
    s.grabR = pressed(gp, BTN.rt, 0.3) || pressed(gp, BTN.rb);
    // Segurar um gatilho também levanta um pouco os braços.
    if ((s.grabL || s.grabR) && s.armY === 0) s.armY = 0.1;
    s.pause = pressed(gp, BTN.start);
    return s;
  }

  menuState(): Record<MenuAction, boolean> {
    const gp = getPad(this.index);
    const r = { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false };
    if (!gp) return r;
    const ax = gp.axes[0] ?? 0;
    const ay = gp.axes[1] ?? 0;
    r.up = pressed(gp, BTN.dUp) || ay < -0.6;
    r.down = pressed(gp, BTN.dDown) || ay > 0.6;
    r.left = pressed(gp, BTN.dLeft) || ax < -0.6;
    r.right = pressed(gp, BTN.dRight) || ax > 0.6;
    r.confirm = pressed(gp, BTN.south);
    r.back = pressed(gp, BTN.east);
    r.pause = pressed(gp, BTN.start);
    return r;
  }

  /** Vibra o controle (se o navegador deixar). */
  rumble(strong: number, weak: number, ms: number) {
    const gp = getPad(this.index) as (Gamepad & { vibrationActuator?: { playEffect?: Function } }) | null;
    const act = gp?.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return;
    try {
      const p = act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: ms,
        strongMagnitude: Math.min(1, strong),
        weakMagnitude: Math.min(1, weak),
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* alguns navegadores não suportam: tudo bem */
    }
  }
}
