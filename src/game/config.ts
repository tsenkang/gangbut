import type { Appearance } from '../characters/Skins';
import type { Difficulty } from '../ai/Bot';

// ------------------------------------------------------------
// Configuração de uma partida: quem joga, com o quê, em qual mapa.
// ------------------------------------------------------------

export interface PlayerSetup {
  slot: number; // 0..3
  name: string;
  appearance: Appearance;
  /** Id do dispositivo (kbA, kbB, pad0...) — vazio se for robô. */
  deviceId?: string;
  bot?: Difficulty;
}

export interface MatchConfig {
  players: PlayerSetup[];
  /** Id do mapa ou 'rodizio' (troca a cada rodada). */
  mapId: string;
  bestOf: 3 | 5;
  /** 'briga' (padrão: último em pé) ou 'futebol' (dois times, gols). */
  mode?: 'briga' | 'futebol';
}

/** Cores que identificam cada jogador na interface. */
export const SLOT_COLORS = [0xff4d5e, 0x3a86ff, 0x3ddc84, 0xffd23f];
