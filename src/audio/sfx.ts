/**
 * All sound is synthesised with the Web Audio API, so the game ships with no audio files.
 * The context is created lazily on the first user gesture (required on mobile).
 */
export type SfxName =
  | 'click' | 'select' | 'move' | 'laser' | 'enemyLaser' | 'missileLaunch' | 'explosion' | 'bigExplosion'
  | 'rail' | 'flak' | 'shieldHit' | 'hullHit' | 'boost' | 'pickup' | 'crit' | 'waveStart' | 'waveClear' | 'gameOver' | 'warning';

const STORAGE_KEY = 'stb.muted';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* ignore */ }
  }

  /** Call from a user gesture to unlock audio. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  play(name: SfxName): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'click': this.tone('square', 520, 0.05, 0.12, t, 420); break;
      case 'select': this.tone('sine', 740, 0.08, 0.15, t, 980); break;
      case 'move': this.noise(0.25, 0.12, t, 900, 200); this.tone('sine', 220, 0.2, 0.08, t, 160); break;
      case 'laser': this.tone('sawtooth', 1400, 0.18, 0.25, t, 180); this.tone('square', 900, 0.1, 0.1, t, 300); break;
      case 'rail': this.noise(0.5, 0.35, t, 4000, 300); this.sweep('sawtooth', 2200, 120, 0.5, 0.3, t); this.tone('sine', 60, 0.5, 0.4, t, 30); break;
      case 'flak': for (let i = 0; i < 5; i++) this.noise(0.12, 0.3, t + i * 0.05, 2500, 400); this.tone('square', 150, 0.3, 0.2, t, 60); break;
      case 'enemyLaser': this.tone('sawtooth', 700, 0.2, 0.22, t, 120); break;
      case 'missileLaunch': this.noise(0.5, 0.3, t, 300, 2500); this.tone('triangle', 160, 0.45, 0.2, t, 520); break;
      case 'explosion': this.noise(0.6, 0.6, t, 1600, 80); this.tone('sine', 110, 0.5, 0.45, t, 30); break;
      case 'bigExplosion':
        this.noise(1.1, 0.8, t, 2200, 60); this.tone('sine', 80, 0.9, 0.6, t, 20); this.tone('sawtooth', 200, 0.4, 0.2, t + 0.05, 40);
        break;
      case 'shieldHit': this.tone('sine', 880, 0.25, 0.25, t, 440); this.tone('sine', 1320, 0.2, 0.12, t, 660); break;
      case 'hullHit': this.noise(0.3, 0.5, t, 700, 120); this.tone('square', 90, 0.25, 0.3, t, 40); break;
      case 'boost': this.sweep('sine', 300, 900, 0.5, 0.25, t); this.sweep('sine', 450, 1350, 0.5, 0.12, t + 0.05); break;
      case 'pickup': [660, 880, 1100, 1320].forEach((f, i) => this.tone('square', f, 0.12, 0.12, t + i * 0.07, f)); break;
      case 'crit': this.tone('sawtooth', 1800, 0.3, 0.3, t, 200); this.tone('square', 1200, 0.15, 0.15, t + 0.02, 2400); break;
      case 'waveStart': [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, 0.35, 0.22, t + i * 0.12, f)); break;
      case 'waveClear': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('square', f, 0.3, 0.14, t + i * 0.1, f)); break;
      case 'gameOver': [440, 370, 311, 220].forEach((f, i) => this.tone('sawtooth', f, 0.5, 0.2, t + i * 0.28, f * 0.9)); break;
      case 'warning': this.tone('square', 330, 0.15, 0.12, t, 330); this.tone('square', 330, 0.15, 0.12, t + 0.22, 330); break;
    }
  }

  private tone(type: OscillatorType, freq: number, dur: number, vol: number, at: number, endFreq = freq): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(vol, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  private sweep(type: OscillatorType, from: number, to: number, dur: number, vol: number, at: number): void {
    this.tone(type, from, dur, vol, at, to);
  }

  private noise(dur: number, vol: number, at: number, filterFrom: number, filterTo: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrom, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, filterTo), at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(at);
    src.stop(at + dur + 0.05);
  }
}
