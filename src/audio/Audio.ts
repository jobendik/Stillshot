import { MAX_TIME_SCALE, MIN_TIME_SCALE } from '@/config/constants';
import { clamp, lerp } from '@/core/math';

export type SoundName =
  | 'shoot'
  | 'glass'
  | 'impact'
  | 'shatter'
  | 'slice'
  | 'deflect'
  | 'throw'
  | 'thud'
  | 'pickup'
  | 'dryfire'
  | 'swing'
  | 'hotswitch'
  | 'death'
  | 'ui';

/**
 * Fully procedural Web Audio engine — no asset files. The whole soundscape is
 * tethered to the time scale: as time crawls toward 1/200th, every effect is
 * pitched down and the ambient bed is low-passed into a deep, underwater hum,
 * then snaps back to bright real-time as the player accelerates ("auditory
 * whiplash"). The ambient bed is the low drone of server fans and CRT monitors.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambient: { gain: GainNode; filter: BiquadFilterNode; osc: OscillatorNode[] } | null = null;
  private scale = MIN_TIME_SCALE;
  enabled = true;
  private volume = 0.7;

  /** Must be called from a user gesture (pointer lock / click). */
  resume(): void {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);

    // Pre-bake a second of white noise to reuse for percussive sounds.
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  /** Map [MIN..MAX] time scale → pitch/brightness across the whole mixer. */
  setTimeScale(scale: number): void {
    this.scale = scale;
    if (this.ambient && this.ctx) {
      const t = this.ctx.currentTime;
      const norm = clamp((scale - MIN_TIME_SCALE) / (MAX_TIME_SCALE - MIN_TIME_SCALE), 0, 1);
      this.ambient.filter.frequency.setTargetAtTime(lerp(180, 1400, norm), t, 0.08);
    }
  }

  startAmbient(): void {
    if (!this.ctx || !this.master || this.ambient) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.06;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.connect(gain);
    gain.connect(this.master);

    const osc: OscillatorNode[] = [];
    for (const freq of [55, 58.5, 110]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.value = 0.4;
      o.connect(g);
      g.connect(filter);
      o.start();
      osc.push(o);
    }
    // Filtered noise = fan hiss.
    if (this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0.05;
      src.connect(g);
      g.connect(filter);
      src.start();
    }
    this.ambient = { gain, filter, osc };
  }

  stopAmbient(): void {
    if (!this.ambient) return;
    for (const o of this.ambient.osc) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.ambient.gain.disconnect();
    this.ambient = null;
  }

  // ---- one-shots --------------------------------------------------------

  play(name: SoundName): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    // Pitch/length follow the time scale: deep & long when frozen, bright & snappy when fast.
    const rate = lerp(0.4, 1, clamp((this.scale - MIN_TIME_SCALE) / (1 - MIN_TIME_SCALE), 0, 1));
    switch (name) {
      case 'shoot':
        this.noise(0.09 / rate, 2200 * rate, 0.5);
        this.tone(150 * rate, 0.12 / rate, 'square', 0.25, 40 * rate);
        break;
      case 'glass':
        this.noise(0.28 / rate, 5200 * rate, 0.4, 'highpass');
        this.tone(900 * rate, 0.18 / rate, 'triangle', 0.12, 1600 * rate);
        break;
      case 'shatter':
        this.noise(0.35 / rate, 1400 * rate, 0.45);
        this.tone(220 * rate, 0.3 / rate, 'sawtooth', 0.18, 80 * rate);
        break;
      case 'impact':
        this.noise(0.05 / rate, 1800 * rate, 0.3);
        break;
      case 'slice':
        this.noise(0.18 / rate, 6000 * rate, 0.3, 'bandpass', 3000 * rate);
        break;
      case 'deflect':
        this.tone(1400 * rate, 0.16 / rate, 'sine', 0.3, 2600 * rate);
        break;
      case 'throw':
      case 'swing':
        this.noise(0.22 / rate, 1200 * rate, 0.22, 'bandpass', 700 * rate);
        break;
      case 'thud':
        this.tone(90 * rate, 0.16 / rate, 'sine', 0.4, 50 * rate);
        break;
      case 'pickup':
        this.tone(440 * rate, 0.08 / rate, 'square', 0.2, 880 * rate);
        break;
      case 'dryfire':
        this.noise(0.03 / rate, 3000 * rate, 0.2);
        break;
      case 'hotswitch':
        this.tone(1200 * rate, 0.4 / rate, 'sawtooth', 0.3, 120 * rate);
        this.noise(0.4 / rate, 2000 * rate, 0.2, 'bandpass', 1500 * rate);
        break;
      case 'death':
        this.tone(180, 0.8, 'sawtooth', 0.4, 40);
        this.noise(0.8, 800, 0.4);
        break;
      case 'ui':
        this.tone(660, 0.05, 'square', 0.15);
        break;
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gainValue: number,
    glideTo?: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainValue, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(
    dur: number,
    filterFreq: number,
    gainValue: number,
    filterType: BiquadFilterType = 'lowpass',
    bandFreq?: number,
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(bandFreq ?? filterFreq, t);
    if (filterType === 'lowpass') filter.frequency.exponentialRampToValueAtTime(Math.max(120, filterFreq * 0.4), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainValue, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Synthesized title voice for the replay ("super... hot..."). */
  speak(text: string): void {
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.85;
      u.pitch = 0.5;
      u.volume = this.enabled ? 0.9 : 0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* speech unsupported */
    }
  }
}
