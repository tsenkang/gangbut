// ------------------------------------------------------------
// Sons gerados no código com a Web Audio API (nenhum arquivo).
// Cada som é uma receita curtinha: osciladores + ruído + filtros.
// ------------------------------------------------------------

export type SoundName =
  | 'punch'
  | 'heavy'
  | 'whoosh'
  | 'jump'
  | 'land'
  | 'scream'
  | 'ko'
  | 'grab'
  | 'throw'
  | 'boing'
  | 'beep'
  | 'go'
  | 'cheer'
  | 'elim'
  | 'clank'
  | 'horn'
  | 'sizzle'
  | 'crack'
  | 'alarm'
  | 'ui'
  | 'uiBack'
  | 'join'
  | 'splash'
  | 'escape'
  | 'win'
  | 'grunt'
  | 'oof';

class AudioSystem {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;
  private lastPlay = new Map<string, number>();
  private unlockCbs: (() => void)[] = [];

  /** O navegador só deixa tocar som depois de um clique/tecla. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    // Um compressor evita estourar quando muita coisa toca junto.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.32;
    this.music.connect(this.master);
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.unlockCbs.forEach((f) => f());
  }

  onUnlock(f: () => void) {
    if (this.ctx) f();
    else this.unlockCbs.push(f);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------ peças básicas
  private env(g: GainNode, t: number, a: number, peak: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, out: AudioNode = this.sfx, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1, out: AudioNode = this.sfx, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  // ------------------------------------------------ receitas
  play(name: SoundName | string, vol = 1, pitch = 1) {
    if (!this.ctx || this.muted) return;
    // Evita repetir o mesmo som 30 vezes no mesmo instante.
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.lastPlay.set(name, now);
    const p = pitch * (0.92 + Math.random() * 0.16);
    const v = vol;
    switch (name) {
      case 'punch':
        this.tone('sine', 170 * p, 55, 0.14, 0.7 * v);
        this.noise(0.06, 0.45 * v, 'bandpass', 1800 * p, 900, 1.2);
        break;
      case 'heavy':
        this.tone('sine', 120 * p, 40, 0.25, 0.9 * v);
        this.tone('triangle', 260 * p, 60, 0.12, 0.4 * v);
        this.noise(0.12, 0.6 * v, 'lowpass', 2500, 300, 0.8);
        break;
      case 'whoosh':
        this.noise(0.18, 0.25 * v, 'bandpass', 500 * p, 2400 * p, 2);
        break;
      case 'throw':
        this.noise(0.3, 0.35 * v, 'bandpass', 300 * p, 3000 * p, 2.5);
        break;
      case 'jump':
        this.tone('sine', 260 * p, 520 * p, 0.14, 0.28 * v);
        break;
      case 'boing': {
        const o = this.tone('sine', 180 * p, 420 * p, 0.35, 0.4 * v);
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 18;
        const lg = this.ctx.createGain();
        lg.gain.value = 40;
        lfo.connect(lg).connect(o.frequency);
        lfo.start();
        lfo.stop(this.ctx.currentTime + 0.4);
        break;
      }
      case 'land':
        this.noise(0.16, 0.5 * v, 'lowpass', 600, 120, 0.7);
        this.tone('sine', 90 * p, 45, 0.16, 0.5 * v);
        break;
      case 'grab':
        this.tone('sine', 240 * p, 140 * p, 0.08, 0.3 * v);
        this.noise(0.05, 0.15 * v, 'lowpass', 900, 400);
        break;
      case 'scream':
        this.scream(p, v);
        break;
      case 'grunt':
        // "Hup!" de esforço (soco, pulo, arremesso)
        this.voice(p * 1.1, v, 0.13, [380, 950], 1.15, 0.85);
        break;
      case 'oof':
        // "Uóf!" de quem apanha
        this.voice(p * 0.95, v, 0.2, [520, 1000], 1.25, 0.6);
        break;
      case 'ko':
        this.tone('triangle', 880 * p, 860 * p, 0.6, 0.35 * v);
        this.tone('triangle', 1320 * p, 1300 * p, 0.45, 0.2 * v);
        this.tone('sine', 900 * p, 220 * p, 0.7, 0.25 * v, this.sfx, 0.08);
        break;
      case 'elim':
        this.tone('sine', 1400 * p, 180 * p, 0.9, 0.3 * v);
        this.tone('square', 700 * p, 90 * p, 0.9, 0.06 * v);
        break;
      case 'beep':
        this.tone('square', 660, 660, 0.14, 0.18 * v);
        break;
      case 'go':
        this.tone('square', 990, 990, 0.35, 0.2 * v);
        this.tone('square', 1320, 1320, 0.35, 0.12 * v);
        break;
      case 'cheer': {
        // Torcida: ruído com "vozes" tremidas
        for (let i = 0; i < 3; i++) this.noise(1.4, 0.18 * v, 'bandpass', 700 + i * 500, 900 + i * 400, 1.5, this.sfx, i * 0.05);
        break;
      }
      case 'clank':
        this.tone('square', 140 * p, 60, 0.25, 0.3 * v);
        this.noise(0.2, 0.5 * v, 'highpass', 2500, 1200, 1);
        this.tone('triangle', 1700 * p, 1650, 0.4, 0.12 * v);
        break;
      case 'horn':
        this.tone('sawtooth', 220, 214, 1.1, 0.16 * v);
        this.tone('sawtooth', 277, 270, 1.1, 0.13 * v);
        this.tone('sawtooth', 330, 322, 1.1, 0.1 * v);
        break;
      case 'sizzle':
        this.noise(0.7, 0.35 * v, 'highpass', 3000, 6000, 0.5);
        break;
      case 'crack':
        this.noise(0.09, 0.6 * v, 'bandpass', 1200 * p, 600, 3);
        this.noise(0.25, 0.3 * v, 'lowpass', 800, 200, 1, this.sfx, 0.05);
        break;
      case 'alarm':
        this.tone('square', 880, 880, 0.12, 0.12 * v);
        this.tone('square', 660, 660, 0.12, 0.12 * v, this.sfx, 0.14);
        break;
      case 'ui':
        this.tone('triangle', 720, 760, 0.07, 0.2 * v);
        break;
      case 'uiBack':
        this.tone('triangle', 520, 400, 0.08, 0.2 * v);
        break;
      case 'join':
        this.tone('triangle', 523, 523, 0.08, 0.25 * v);
        this.tone('triangle', 784, 784, 0.12, 0.25 * v, this.sfx, 0.08);
        break;
      case 'splash':
        this.noise(0.5, 0.5 * v, 'lowpass', 3000, 300, 0.8);
        this.tone('sine', 300 * p, 80, 0.3, 0.3 * v);
        break;
      case 'escape':
        this.tone('triangle', 400 * p, 900 * p, 0.15, 0.3 * v);
        break;
      case 'win': {
        const notes = [523, 659, 784, 1046];
        notes.forEach((f, i) => this.tone('square', f, f, 0.18, 0.12 * v, this.sfx, i * 0.11));
        this.tone('triangle', 1046, 1046, 0.6, 0.18 * v, this.sfx, 0.44);
        break;
      }
    }
  }

  /** Grito curto e engraçado: serra passando por filtros de "voz". */
  /** Voz curtinha: um "a/u/o" com dois formantes e o tom subindo/caindo. */
  private voice(p: number, v: number, dur: number, formants: number[], up: number, down: number) {
    const c = this.ctx!;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const base = 210 * p;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * up, t + dur * 0.3);
    o.frequency.exponentialRampToValueAtTime(base * down, t + dur);
    const g = c.createGain();
    this.env(g, t, 0.012, 0.3 * v, dur);
    for (const f of formants) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * p;
      bp.Q.value = 5;
      o.connect(bp).connect(g);
    }
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private scream(p: number, v: number) {
    const c = this.ctx!;
    const t = c.currentTime;
    const dur = 0.55;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const base = 330 * p;
    o.frequency.setValueAtTime(base * 1.3, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.6, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, t + dur);
    const lfo = c.createOscillator();
    lfo.frequency.value = 9;
    const lg = c.createGain();
    lg.gain.value = base * 0.06;
    lfo.connect(lg).connect(o.frequency);
    const g = c.createGain();
    this.env(g, t, 0.02, 0.22 * v, dur);
    // Dois formantes = som de "aaa"
    for (const [f, q] of [
      [800, 6],
      [1250, 8],
    ]) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * p;
      bp.Q.value = q;
      o.connect(bp).connect(g);
    }
    g.connect(this.sfx);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }
}

export const audio = new AudioSystem();
