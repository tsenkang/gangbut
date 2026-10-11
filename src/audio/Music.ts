import { audio } from './Audio';

// ------------------------------------------------------------
// Música de fundo feita na hora: um sequenciador de 16 passos
// com baixo, acordes, melodia e bateria. Cada mapa tem o seu tema
// (velocidade, escala e timbres diferentes).
// ------------------------------------------------------------

export type MusicThemeId = 'menu' | 'telhado' | 'fabrica' | 'gelatina' | 'trem' | 'lava';

interface Theme {
  bpm: number;
  root: number; // nota MIDI da tônica
  scale: number[]; // intervalos da escala
  chords: number[]; // grau do acorde em cada compasso (0 = tônica)
  bass: (number | null)[]; // 16 passos: grau relativo ao acorde
  kick: string; // 'x' = toca
  snare: string;
  hat: string;
  leadWave: OscillatorType;
  padWave: OscillatorType;
  swing: number;
  seed: number;
  leadDensity: number;
  clank?: boolean;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const MIXO = [0, 2, 4, 5, 7, 9, 10];

const THEMES: Record<MusicThemeId, Theme> = {
  menu: {
    bpm: 116, root: 60, scale: MAJOR, chords: [0, 5, 3, 4],
    bass: [0, null, 0, null, 4, null, 0, null, 0, null, 0, 2, 4, null, 2, null],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.',
    leadWave: 'square', padWave: 'triangle', swing: 0.08, seed: 3, leadDensity: 0.55,
  },
  telhado: {
    bpm: 104, root: 50, scale: DORIAN, chords: [0, 0, 3, 4],
    bass: [0, null, 0, 0, null, 0, 4, null, 0, null, 0, 0, 3, null, 4, null],
    kick: 'x..x..x...x..x..', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    leadWave: 'square', padWave: 'sawtooth', swing: 0.14, seed: 11, leadDensity: 0.5,
  },
  fabrica: {
    bpm: 128, root: 52, scale: MINOR, chords: [0, 0, 5, 6],
    bass: [0, 0, null, 0, 0, null, 0, 0, 0, 0, null, 0, 4, null, 3, null],
    kick: 'x...x...x...x...', snare: '....x.......x..x', hat: '.xxx.xxx.xxx.xxx',
    leadWave: 'sawtooth', padWave: 'square', swing: 0, seed: 21, leadDensity: 0.4, clank: true,
  },
  gelatina: {
    bpm: 122, root: 53, scale: MAJOR, chords: [0, 3, 4, 0],
    bass: [0, null, 4, null, 0, null, 4, null, 0, null, 4, null, 5, null, 4, null],
    kick: 'x.....x...x.....', snare: '....x.......x...', hat: '..x...x...x...xx',
    leadWave: 'sine', padWave: 'triangle', swing: 0.1, seed: 7, leadDensity: 0.65,
  },
  trem: {
    bpm: 144, root: 55, scale: MIXO, chords: [0, 3, 0, 4],
    bass: [0, null, 4, null, 0, null, 4, null, 0, null, 4, null, 0, null, 4, 2],
    kick: 'x...x...x...x...', snare: '..x...x...x...x.', hat: 'xxxxxxxxxxxxxxxx',
    leadWave: 'triangle', padWave: 'square', swing: 0.05, seed: 5, leadDensity: 0.5,
  },
  lava: {
    bpm: 112, root: 45, scale: PHRYGIAN, chords: [0, 1, 0, 6],
    bass: [0, 0, null, 0, null, 0, 1, null, 0, 0, null, 0, null, 6, 1, null],
    kick: 'x.x...x.x.x...x.', snare: '....x.......x...', hat: '..x...x...x...x.',
    leadWave: 'sawtooth', padWave: 'sawtooth', swing: 0, seed: 13, leadDensity: 0.45,
  },
};

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class MusicPlayer {
  private theme: Theme | null = null;
  private current: MusicThemeId | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private melody: (number | null)[][] = [];
  private bus: GainNode | null = null;

  play(id: MusicThemeId) {
    if (this.current === id) return;
    this.current = id;
    audio.onUnlock(() => this.start(id));
  }

  stop() {
    this.current = null;
    this.theme = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.bus && audio.ctx) {
      const b = this.bus;
      b.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.2);
      setTimeout(() => b.disconnect(), 1500);
    }
    this.bus = null;
  }

  private start(id: MusicThemeId) {
    if (this.current !== id || !audio.ctx) return;
    const keep = this.current;
    this.stop();
    this.current = keep;
    const ctx = audio.ctx;
    this.theme = THEMES[id];
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    this.bus.connect(audio.music);
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.melody = this.makeMelody(this.theme);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Inventa uma melodia (sempre igual para o mesmo tema). */
  private makeMelody(t: Theme) {
    let s = t.seed;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const bars: (number | null)[][] = [];
    for (let b = 0; b < 4; b++) {
      const bar: (number | null)[] = [];
      let deg = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < 16; i++) {
        if (rnd() < t.leadDensity && (i % 2 === 0 || rnd() < 0.3)) {
          deg += Math.floor(rnd() * 5) - 2;
          deg = Math.max(0, Math.min(9, deg));
          bar.push(deg);
        } else bar.push(null);
      }
      bars.push(bar);
    }
    // Repete os dois primeiros compassos no final (fica "grudento")
    bars[2] = bars[0].slice();
    return bars;
  }

  private note(deg: number, chord: number, octave: number) {
    const t = this.theme!;
    const d = deg + chord;
    const oct = Math.floor(d / t.scale.length);
    const idx = ((d % t.scale.length) + t.scale.length) % t.scale.length;
    return t.root + octave * 12 + oct * 12 + t.scale[idx];
  }

  private schedule() {
    const ctx = audio.ctx;
    if (!ctx || !this.theme || !this.bus) return;
    const t = this.theme;
    const stepDur = 60 / t.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      const i = this.step % 16;
      const bar = Math.floor(this.step / 16) % 4;
      const time = this.nextTime + (i % 2 === 1 ? t.swing * stepDur : 0);
      const chord = t.chords[bar];
      if (t.kick[i] === 'x') this.kick(time);
      if (t.snare[i] === 'x') this.snare(time);
      if (t.hat[i] === 'x') this.hat(time, i % 4 === 2 ? 0.07 : 0.04);
      const b = t.bass[i];
      if (b !== null) this.synth('triangle', midiHz(this.note(b, chord, -1)), time, stepDur * 1.6, 0.32, 900);
      if (i === 0 || i === 8) {
        for (const d of [0, 2, 4]) this.synth(t.padWave, midiHz(this.note(d, chord, 0)), time, stepDur * 7.5, 0.045, 1600);
      }
      const m = this.melody[bar][i];
      if (m !== null) this.synth(t.leadWave, midiHz(this.note(m, 0, 1)), time, stepDur * 1.4, t.leadWave === 'sine' ? 0.16 : 0.07, 3200);
      if (t.clank && i === 14 && bar % 2 === 1) this.hat(time, 0.12, 5000);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private synth(type: OscillatorType, f: number, t: number, dur: number, vol: number, cutoff: number) {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt).connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number) {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.2);
  }

  private noiseHit(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number) {
    const ctx = audio.ctx!;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.bus!);
    s.start(t);
  }

  private snare(t: number) {
    this.noiseHit(t, 0.16, 0.35, 'bandpass', 1800);
    this.synth('triangle', 190, t, 0.08, 0.2, 2000);
  }

  private hat(t: number, vol: number, freq = 8000) {
    this.noiseHit(t, 0.04, vol, 'highpass', freq);
  }
}

export const music = new MusicPlayer();
