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
  l3: 10,
  r3: 11,
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
  // Xbox primeiro: "Xbox Wireless Controller" também contém "wireless controller".
  if (s.includes('xbox') || s.includes('xinput') || s.includes('045e') || s.includes('microsoft')) return 'xbox';
  if (s.includes('054c') || s.includes('dualsense') || s.includes('dualshock') || s.includes('playstation') || s.includes('wireless controller'))
    return 'playstation';
  return 'generic';
}

export function padLabel(t: PadType) {
  return t === 'xbox' ? 'Controle Xbox' : t === 'playstation' ? 'Controle PS5' : 'Controle';
}

/** Nomes dos botões para mostrar na tela, de acordo com o tipo do controle. */
export function buttonNames(t: PadType) {
  if (t === 'playstation')
    return { jump: '✕', punchL: '□', punchR: '○', headbutt: '△', grabL: 'L2', grabR: 'R2', run: 'L1', kick: 'R1', duck: 'R3', pause: 'Options' };
  return { jump: 'A', punchL: 'X', punchR: 'B', headbutt: 'Y', grabL: 'LT', grabR: 'RT', run: 'LB', kick: 'RB', duck: 'RS', pause: 'Start' };
}

/** true quando o navegador não deixa ler controles (ex.: página dentro de um iframe sem permissão). */
export let padsBlocked = false;

/** Lista de controles, sem nunca quebrar o jogo (alguns navegadores jogam erro aqui). */
export function listPads(): (Gamepad | null)[] {
  try {
    if (!navigator.getGamepads) return [];
    const l = navigator.getGamepads();
    padsBlocked = false;
    return l ? Array.from(l) : [];
  } catch {
    padsBlocked = true;
    return [];
  }
}

export function getPad(index: number): Gamepad | null {
  const p = listPads()[index];
  return p && p.connected ? p : null;
}

/** Parece mesmo um controle? (fones, teclados e volantes às vezes aparecem como "gamepad") */
export function looksLikePad(gp: Gamepad) {
  return gp.buttons.length >= 4 && gp.axes.length >= 2;
}

const pressed = (gp: Gamepad, i: number, threshold = 0.5) => {
  const b = gp.buttons[i];
  return !!b && (b.pressed || b.value > threshold);
};

/**
 * Leitura "normalizada": devolve botões e eixos sempre no layout padrão,
 * mesmo quando o navegador não entrega o mapeamento padrão (DualSense no
 * Firefox, Xbox no Linux...).
 */
interface PadView {
  btn(i: number, threshold?: number): boolean;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

/** Direcional que vem como um eixo só ("hat"): -1 = cima, girando no sentido horário. */
function hat(v: number | undefined) {
  const r = { up: false, down: false, left: false, right: false };
  if (v === undefined || Math.abs(v) > 1.05) return r;
  const k = Math.round((v + 1) / (2 / 7)) % 8; // 0 cima, 1 cima-dir, 2 dir, ... 7 cima-esq
  r.up = k === 7 || k === 0 || k === 1;
  r.right = k >= 1 && k <= 3;
  r.down = k >= 3 && k <= 5;
  r.left = k >= 5 && k <= 7;
  return r;
}

export function padView(gp: Gamepad, type: PadType): PadView {
  const ax = (i: number) => gp.axes[i] ?? 0;
  if (gp.mapping === 'standard' || type === 'generic') {
    return { btn: (i, t) => pressed(gp, i, t), lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3) };
  }
  // Gatilho que vem como eixo: -1 solto, +1 apertado (às vezes 0 antes do primeiro toque).
  const trig = (i: number) => gp.axes.length > i && ax(i) > 0.1;
  if (type === 'playstation') {
    // DualSense / DualShock sem mapeamento padrão
    const map: Record<number, number> = { 0: 1, 1: 2, 2: 0, 3: 3, 4: 4, 5: 5, 8: 8, 9: 9, 10: 10, 11: 11 };
    const h = hat(gp.axes[9]);
    return {
      btn: (i, t) => {
        if (i === BTN.lt) return pressed(gp, 6, t) || trig(3);
        if (i === BTN.rt) return pressed(gp, 7, t) || trig(4);
        if (i === BTN.dUp) return h.up || pressed(gp, 12);
        if (i === BTN.dDown) return h.down || pressed(gp, 13);
        if (i === BTN.dLeft) return h.left || pressed(gp, 14);
        if (i === BTN.dRight) return h.right || pressed(gp, 15);
        return i in map ? pressed(gp, map[i], t) : false;
      },
      lx: ax(0),
      ly: ax(1),
      rx: ax(2),
      ry: gp.axes.length > 5 ? ax(5) : ax(3),
    };
  }
  // Xbox sem mapeamento padrão (Linux): gatilhos e direcional são eixos
  const map: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 8: 6, 9: 7, 10: 9, 11: 10 };
  return {
    btn: (i, t) => {
      if (i === BTN.lt) return trig(2);
      if (i === BTN.rt) return trig(5);
      if (i === BTN.dUp) return ax(7) < -0.5;
      if (i === BTN.dDown) return ax(7) > 0.5;
      if (i === BTN.dLeft) return ax(6) < -0.5;
      if (i === BTN.dRight) return ax(6) > 0.5;
      return i in map ? pressed(gp, map[i], t) : false;
    },
    lx: ax(0),
    ly: ax(1),
    rx: ax(3),
    ry: ax(4),
  };
}

let nextPadId = 0;

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
    // id fixo do objeto (não do índice): se o controle reconectar em outro
    // índice, o mesmo jogador continua com ele.
    this.id = 'pad' + nextPadId++;
  }

  /** Controle reconectou (talvez em outro índice): passa a ler dele. */
  rebind(index: number, padId: string) {
    this.index = index;
    this.type = padType(padId);
    this.label = padLabel(this.type);
  }

  connected() {
    return !!getPad(this.index);
  }

  read(): ControlState {
    const s = emptyControl();
    const raw = getPad(this.index);
    if (!raw) return s;
    const gp = padView(raw, this.type);
    const [lx, ly] = applyDeadzone(gp.lx, gp.ly);
    const [, ry] = applyDeadzone(gp.rx, gp.ry);
    // Direcional também anda (útil em controles genéricos).
    const dx = (gp.btn(BTN.dRight) ? 1 : 0) - (gp.btn(BTN.dLeft) ? 1 : 0);
    const dy = (gp.btn(BTN.dUp) ? 1 : 0) - (gp.btn(BTN.dDown) ? 1 : 0);
    s.moveX = dx || lx;
    s.moveY = dy || -ly; // no controle, "para cima" é negativo
    s.armY = -ry;
    s.jump = gp.btn(BTN.south);
    s.punchL = gp.btn(BTN.west);
    s.punchR = gp.btn(BTN.east);
    s.headbutt = gp.btn(BTN.north);
    // Gatilhos agarram; LB corre, RB chuta, R3 abaixa (L3 também corre).
    s.grabL = gp.btn(BTN.lt, 0.3);
    s.grabR = gp.btn(BTN.rt, 0.3);
    s.run = gp.btn(BTN.lb) || gp.btn(BTN.l3);
    s.kick = gp.btn(BTN.rb);
    s.duck = gp.btn(BTN.r3);
    // Segurar um gatilho também levanta um pouco os braços.
    if ((s.grabL || s.grabR) && s.armY === 0) s.armY = 0.1;
    s.pause = gp.btn(BTN.start);
    return s;
  }

  menuState(): Record<MenuAction, boolean> {
    const raw = getPad(this.index);
    const r = { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false };
    if (!raw) return r;
    const gp = padView(raw, this.type);
    const ax = gp.lx;
    const ay = gp.ly;
    r.up = gp.btn(BTN.dUp) || ay < -0.6;
    r.down = gp.btn(BTN.dDown) || ay > 0.6;
    r.left = gp.btn(BTN.dLeft) || ax < -0.6;
    r.right = gp.btn(BTN.dRight) || ax > 0.6;
    r.confirm = gp.btn(BTN.south);
    r.back = gp.btn(BTN.east);
    r.pause = gp.btn(BTN.start);
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
