// ------------------------------------------------------------
// O "estado do controle": o que cada jogador está apertando agora.
// Teclado, controle e robô produzem este mesmo formato.
// ------------------------------------------------------------

export interface ControlState {
  /** Andar: x = direita/esquerda, y = frente/trás (-1..1). */
  moveX: number;
  moveY: number;
  /** Altura dos braços (-1 = baixo, 1 = alto). */
  armY: number;
  jump: boolean;
  punchL: boolean;
  punchR: boolean;
  grabL: boolean;
  grabR: boolean;
  headbutt: boolean;
  pause: boolean;
}

export const emptyControl = (): ControlState => ({
  moveX: 0,
  moveY: 0,
  armY: 0,
  jump: false,
  punchL: false,
  punchR: false,
  grabL: false,
  grabR: false,
  headbutt: false,
  pause: false,
});

export type DeviceKind = 'keyboard' | 'gamepad' | 'bot';

/** Qualquer coisa que gera comandos para um lutador. */
export interface InputSource {
  id: string;
  kind: DeviceKind;
  label: string;
  read(): ControlState;
  connected(): boolean;
  rumble?(strong: number, weak: number, ms: number): void;
}

/** Comandos de menu (setas, confirmar, voltar). */
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause';
