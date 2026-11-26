import type { Vector3 } from 'three';
import { clamp, lerp } from '@/core/math';

export type SoundName =
  | 'shoot'
  | 'shotgun'
  | 'nail'
  | 'glass'
  | 'impact'
  | 'shatter'
  | 'slice'
  | 'slash'
  | 'deflect'
  | 'ricochet'
  | 'throw'
  | 'thud'
  | 'punch'
  | 'pickup'
  | 'catch'
  | 'dryfire'
  | 'swing'
  | 'windup'
  | 'hotswitch'
  | 'death'
  | 'ui'
  | 'whiz'
  | 'tick'
  | 'arrive'
  | 'borrow'
  | 'collect'
  | 'repaid'
  | 'chime'
  | 'complete';

/** Minimum real seconds between two triggers of the same sound (retrigger gate). */
const GATE: Partial<Record<SoundName, number>> = {
  impact: 0.035,
  shoot: 0.02,
  shotgun: 0.05,
  glass: 0.05,
  shatter: 0.03,
  whiz: 0.06,
  tick: 0.05,
  ricochet: 0.03,
  thud: 0.03,
  arrive: 0.02,
};

/**
 * Per-sound trim. These were set from measurement, not by ear: each sound was
 * rendered offline and its peak level read, then trimmed so that warnings
 * (wind-up, near miss, arrival, tick) sit near -20 dBFS, weapons near -11, and
 * the two loudest events (transfer, borrowing) no longer tower over the rest.
 */
const LEVEL: Partial<Record<SoundName, number>> = {
  shoot: 2.0,
  shotgun: 1.8,
  nail: 2.2,
  impact: 1.8,
  shatter: 1.6,
  slice: 1.5,
  slash: 4.0,
  deflect: 1.5,
  ricochet: 1.6,
  throw: 6.0,
  swing: 6.0,
  windup: 2.8,
  thud: 1.6,
  punch: 1.5,
  pickup: 1.4,
  dryfire: 3.0,
  hotswitch: 0.7,
  whiz: 3.0,
  tick: 2.2,
  arrive: 2.0,
  borrow: 0.7,
  collect: 1.6,
  repaid: 1.4,
  chime: 1.5,
  ui: 2.8,
};

/** Sounds that are dropped first when the mixer is saturated. */
const LOW_PRIORITY = new Set<SoundName>(['impact', 'whiz', 'tick', 'thud', 'ricochet']);

/** A-minor pentatonic across three octaves; kills walk this motif. */
const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];
const MOTIF = [0, 2, 4, 3, 5, 7, 6, 4, 8, 7, 9, 6, 10, 9, 11, 8];

/**
 * Fully procedural Web Audio — no sample files. The whole mix is tethered to
 * the state of time:
 *
 *   - every effect's pitch and length follow the time scale at the moment it is
 *     triggered (an octave down and twice as long when the world is still);
 *   - the effects bus runs through a low-pass that closes as time slows and a
 *     reverb send that opens, so stillness sounds suspended, not just quiet;
 *   - borrowing time shuts the filter almost completely and leaves a thin tone
 *     hanging; the world collecting its debt is a rising, tremolo'd saw.
 *
 * Effects are positioned (pan + distance) relative to the camera, so a round
 * passing your ear, a figure arriving behind you, or a Constant's ticking halo
 * can be located by sound — but nothing is communicated by sound alone.
 *
 * Each kill also plays the next note of a pentatonic motif. Spread across a
 * slow, careful run the notes are isolated; in the real-time replay they close
 * up into a phrase.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private dry: GainNode | null = null;
  private timeFilter: BiquadFilterNode | null = null;
  private reverbSend: GainNode | null = null;
  private music: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private pad: { filter: BiquadFilterNode; gain: GainNode; oscs: OscillatorNode[] } | null = null;
  private hold: { osc: OscillatorNode; gain: GainNode } | null = null;

  private rate = 0.5;
  private readonly lastPlayed = new Map<SoundName, number>();
  private voices = 0;
  private chimeIndex = 0;
  private pulseOn = false;
  private pulseNext = 0;
  private pulseStep = 0;

  private readonly listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  private volMaster = 0.8;
  private volSfx = 1;
  private volMusic = 0.7;

  /** Set by the recorder so the replay can reproduce the soundtrack of a run. */
  tap: ((name: SoundName, pos: [number, number, number] | null, param: number) => void) | null = null;

  /** Must be called from a user gesture. */
  resume(): void {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.volMaster;
    this.master.connect(comp);

    // Effects: [voices] → sfx → timeFilter → dry → master, with a reverb send after the filter.
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.volSfx;
    this.timeFilter = ctx.createBiquadFilter();
    this.timeFilter.type = 'lowpass';
    this.timeFilter.frequency.value = 1200;
    this.timeFilter.Q.value = 0.6;
    this.dry = ctx.createGain();
    this.sfx.connect(this.timeFilter);
    this.timeFilter.connect(this.dry);
    this.dry.connect(this.master);

    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx, 2.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.3;
    this.timeFilter.connect(this.reverbSend);
    this.reverbSend.connect(convolver);
    convolver.connect(this.master);

    this.music = ctx.createGain();
    this.music.gain.value = this.volMusic;
    this.music.connect(this.master);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  /** A synthetic room: exponentially decaying, slowly darkening noise. */
  private makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        lp += (n - lp) * lerp(0.6, 0.08, t);
        d[i] = lp * Math.pow(1 - t, 2.6);
      }
    }
    return buf;
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.volMaster = master;
    this.volSfx = sfx;
    this.volMusic = music;
    if (this.master) this.master.gain.value = master;
    if (this.sfx) this.sfx.gain.value = sfx;
    if (this.music) this.music.gain.value = music;
  }

  setListener(pos: Vector3, right: Vector3): void {
    this.listener.x = pos.x;
    this.listener.y = pos.y;
    this.listener.z = pos.z;
    this.listener.rx = right.x;
    this.listener.rz = right.z;
  }

  /**
   * Tie the mix to the clock. `scale` is the world rate (0 while borrowing,
   * up to 2 while the world collects).
   */
  setTimeScale(scale: number, borrowing = false): void {
    const norm = clamp(scale, 0, 1);
    this.rate = borrowing ? 0.42 : lerp(0.5, 1, Math.sqrt(norm)) * (scale > 1 ? 1 + (scale - 1) * 0.12 : 1);
    if (!this.ctx || !this.timeFilter || !this.reverbSend) return;
    const t = this.ctx.currentTime;
    const cutoff = borrowing ? 240 : 700 * Math.pow(26, Math.pow(norm, 0.6));
    this.timeFilter.frequency.setTargetAtTime(cutoff, t, 0.06);
    this.reverbSend.gain.setTargetAtTime(borrowing ? 0.75 : lerp(0.5, 0.14, norm), t, 0.1);
    if (this.pad) {
      this.pad.filter.frequency.setTargetAtTime(borrowing ? 110 : lerp(170, 1300, norm), t, 0.1);
      this.pad.gain.gain.setTargetAtTime(borrowing ? 0.03 : lerp(0.1, 0.14, norm), t, 0.2);
    }
  }

  // ---- ambience & music -------------------------------------------------

  /** The room tone: a low fifth through a filter that follows the clock. */
  startAmbient(root = 55): void {
    if (!this.ctx || !this.music) return;
    this.stopAmbient();
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.1;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 1.2;
    filter.connect(gain);
    gain.connect(this.music);
    const oscs: OscillatorNode[] = [];
    const voices: Array<[number, OscillatorType, number]> = [
      [1, 'sawtooth', 0.42],
      [1.498, 'sawtooth', 0.26],
      [2.004, 'triangle', 0.3],
      [3.56, 'sine', 0.1],
    ];
    for (const [ratio, type, level] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = root * ratio;
      o.detune.value = (Math.random() - 0.5) * 9;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(filter);
      o.start();
      oscs.push(o);
    }
    this.pad = { filter, gain, oscs };
  }

  stopAmbient(): void {
    if (!this.pad) return;
    for (const o of this.pad.oscs) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.pad.gain.disconnect();
    this.pad = null;
  }

  /** The thin tone that hangs while time is borrowed. */
  setHold(on: boolean): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    if (on && !this.hold) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 2640;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.018 * this.volSfx, t + 0.25);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      this.hold = { osc, gain };
    } else if (!on && this.hold) {
      const h = this.hold;
      this.hold = null;
      h.gain.gain.cancelScheduledValues(t);
      h.gain.gain.setTargetAtTime(0, t, 0.03);
      h.osc.stop(t + 0.2);
    }
  }

  resetMotif(): void {
    this.chimeIndex = 0;
  }

  /** Next note of the kill motif (returns the index so it can be recorded). */
  nextChime(): number {
    return this.chimeIndex++;
  }

  /** The replay's pulse: a soft kick and off-beat tick under the developed shot. */
  setPulse(on: boolean): void {
    this.pulseOn = on;
    this.pulseStep = 0;
    if (this.ctx) this.pulseNext = this.ctx.currentTime + 0.05;
  }

  /** Call every frame; schedules the pulse slightly ahead of the audio clock. */
  update(): void {
    if (!this.ctx || !this.music || !this.pulseOn) return;
    const ctx = this.ctx;
    const step = 60 / 108 / 2; // eighth notes at 108 bpm
    while (this.pulseNext < ctx.currentTime + 0.12) {
      const t = this.pulseNext;
      if (this.pulseStep % 2 === 0) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(this.pulseStep % 8 === 0 ? 92 : 78, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.32, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        o.connect(g);
        g.connect(this.music);
        o.start(t);
        o.stop(t + 0.3);
      } else if (this.noiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.045, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        src.connect(f);
        f.connect(g);
        g.connect(this.music);
        src.start(t, Math.random());
        src.stop(t + 0.08);
      }
      this.pulseNext += step;
      this.pulseStep++;
    }
  }

  // ---- one-shots --------------------------------------------------------

  /**
   * Play a sound. `pos` positions it in the world; omit it for sounds that
   * belong to the player. `param` is sound-specific (chime index, duration).
   */
  play(name: SoundName, pos?: Vector3 | { x: number; y: number; z: number } | null, param = 0): void {
    this.tap?.(name, pos ? [pos.x, pos.y, pos.z] : null, param);
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.master || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const gate = GATE[name];
    if (gate !== undefined) {
      const last = this.lastPlayed.get(name) ?? -1;
      if (now - last < gate) return;
      this.lastPlayed.set(name, now);
    }
    if (this.voices > 26 && LOW_PRIORITY.has(name)) return;
    if (this.voices > 44) return;

    // Positioning: equal-power pan + distance roll-off, relative to the camera.
    let pan = 0;
    let amp = 1;
    if (pos) {
      const dx = pos.x - this.listener.x;
      const dy = pos.y - this.listener.y;
      const dz = pos.z - this.listener.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 0.4) pan = clamp(((dx * this.listener.rx + dz * this.listener.rz) / d) * 0.9, -1, 1);
      amp = 1 / (1 + d * 0.11);
    }
    // Interface sounds, the kill motif, and a Constant's tick are outside the
    // player's time: they are not pitched or filtered by the clock.
    const isUi = name === 'ui' || name === 'complete' || name === 'chime' || name === 'tick';
    const out = ctx.createGain();
    out.gain.value = amp * (LEVEL[name] ?? 1);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(isUi ? this.master : this.sfx);

    const r = isUi ? 1 : this.rate;
    let dur = 0.3;

    switch (name) {
      case 'shoot':
        this.noise(out, 0.07 / r, 'highpass', 1600 * r, 0.7, 0.5);
        this.noise(out, 0.16 / r, 'lowpass', 2600 * r, 0.6, 0.45, 300 * r);
        this.tone(out, 170 * r, 0.14 / r, 'square', 0.3, 42 * r);
        dur = 0.2 / r;
        break;
      case 'shotgun':
        this.noise(out, 0.32 / r, 'lowpass', 2200 * r, 0.6, 0.7, 180 * r);
        this.noise(out, 0.06 / r, 'highpass', 2200 * r, 0.7, 0.45);
        this.tone(out, 115 * r, 0.3 / r, 'sawtooth', 0.42, 32 * r);
        dur = 0.36 / r;
        break;
      case 'nail':
        this.tone(out, 2600 * r, 0.09 / r, 'sine', 0.3, 420 * r);
        this.noise(out, 0.12 / r, 'bandpass', 3800 * r, 2.5, 0.35);
        this.tone(out, 220 * r, 0.1 / r, 'triangle', 0.3, 70 * r);
        dur = 0.16 / r;
        break;
      case 'impact':
        this.noise(out, 0.045 / r, 'bandpass', 2400 * r, 1.2, 0.35);
        this.tone(out, 240 * r, 0.06 / r, 'sine', 0.22, 90 * r);
        dur = 0.08 / r;
        break;
      case 'shatter': {
        // The signature: a body-thump, a crack, and a spill of glassy partials.
        this.tone(out, 96 * r, 0.3 / r, 'sine', 0.55, 38 * r);
        this.noise(out, 0.12 / r, 'bandpass', 2600 * r, 1.4, 0.5);
        this.tone(out, 523.25 * r, 0.22 / r, 'triangle', 0.14, 500 * r);
        this.tone(out, 783.99 * r, 0.26 / r, 'triangle', 0.1, 760 * r);
        const pings = 11;
        for (let i = 0; i < pings; i++) {
          const f = (1200 + Math.random() * 5200) * r;
          const at = (Math.pow(Math.random(), 1.6) * 0.42) / r;
          this.tone(out, f, (0.07 + Math.random() * 0.3) / r, 'sine', 0.05 + Math.random() * 0.06, f * 0.985, at);
        }
        dur = 0.85 / r;
        break;
      }
      case 'glass': {
        this.noise(out, 0.2 / r, 'highpass', 4200 * r, 0.7, 0.4);
        const pings = 14;
        for (let i = 0; i < pings; i++) {
          const f = (2400 + Math.random() * 6500) * r;
          const at = (Math.pow(Math.random(), 1.3) * 0.5) / r;
          this.tone(out, f, (0.05 + Math.random() * 0.22) / r, 'sine', 0.035 + Math.random() * 0.05, f * 0.99, at);
        }
        dur = 0.8 / r;
        break;
      }
      case 'slice':
        // Steel through lead: two inharmonic partials and a hiss.
        this.tone(out, 3120 * r, 0.34 / r, 'sine', 0.2, 3050 * r);
        this.tone(out, 4710 * r, 0.26 / r, 'sine', 0.13, 4650 * r);
        this.noise(out, 0.1 / r, 'bandpass', 6200 * r, 3, 0.3);
        dur = 0.4 / r;
        break;
      case 'slash':
        this.noise(out, 0.2 / r, 'bandpass', 900 * r, 1.6, 0.4, 5200 * r);
        this.tone(out, 2200 * r, 0.16 / r, 'sine', 0.05, 2900 * r);
        dur = 0.24 / r;
        break;
      case 'deflect':
        this.tone(out, 1250 * r, 0.2 / r, 'sine', 0.34, 2700 * r);
        this.tone(out, 180 * r, 0.1 / r, 'triangle', 0.3, 80 * r);
        this.noise(out, 0.04 / r, 'highpass', 3000 * r, 0.7, 0.3);
        dur = 0.24 / r;
        break;
      case 'ricochet':
        this.tone(out, 2300 * r, 0.24 / r, 'sine', 0.24, 820 * r);
        this.noise(out, 0.03 / r, 'highpass', 4000 * r, 0.7, 0.3);
        dur = 0.26 / r;
        break;
      case 'throw':
      case 'swing':
        this.noise(out, 0.2 / r, 'bandpass', 420 * r, 1.4, 0.34, 1500 * r);
        dur = 0.24 / r;
        break;
      case 'windup':
        this.tone(out, 150 * r, 0.3 / r, 'sawtooth', 0.14, 330 * r);
        dur = 0.34 / r;
        break;
      case 'thud':
        this.tone(out, 105 * r, 0.16 / r, 'sine', 0.5, 46 * r);
        this.noise(out, 0.05 / r, 'lowpass', 900 * r, 0.7, 0.3);
        dur = 0.2 / r;
        break;
      case 'punch':
        this.tone(out, 150 * r, 0.12 / r, 'sine', 0.55, 55 * r);
        this.noise(out, 0.06 / r, 'bandpass', 1300 * r, 1, 0.4);
        dur = 0.16 / r;
        break;
      case 'pickup':
        this.tone(out, 330, 0.05, 'square', 0.14, 330);
        this.tone(out, 495, 0.07, 'square', 0.14, 495, 0.05);
        this.noise(out, 0.03, 'highpass', 5000, 0.7, 0.15);
        dur = 0.16;
        break;
      case 'catch':
        this.tone(out, 440, 0.045, 'square', 0.14, 440);
        this.tone(out, 660, 0.045, 'square', 0.14, 660, 0.045);
        this.tone(out, 990, 0.1, 'triangle', 0.18, 990, 0.09);
        dur = 0.24;
        break;
      case 'dryfire':
        this.noise(out, 0.025, 'bandpass', 3200, 2, 0.3);
        this.tone(out, 900, 0.02, 'square', 0.08, 700);
        dur = 0.05;
        break;
      case 'hotswitch':
        this.noise(out, 0.5, 'bandpass', 4200, 2.2, 0.36, 260);
        this.tone(out, 1320, 0.45, 'sawtooth', 0.22, 82);
        this.tone(out, 62, 0.5, 'sine', 0.6, 31, 0.08);
        dur = 0.65;
        break;
      case 'death':
        this.tone(out, 196, 1.1, 'sawtooth', 0.4, 36);
        this.tone(out, 207, 1.1, 'sawtooth', 0.3, 39);
        this.noise(out, 0.9, 'lowpass', 1200, 0.7, 0.45, 90);
        dur = 1.2;
        break;
      case 'whiz':
        this.noise(out, 0.16 / r, 'bandpass', 3600 * r, 5, 0.6, 620 * r);
        dur = 0.2 / r;
        break;
      case 'tick':
        this.tone(out, 1750, 0.03, 'sine', 0.22, 1600);
        this.tone(out, 880, 0.045, 'triangle', 0.16, 820);
        dur = 0.06;
        break;
      case 'arrive':
        this.tone(out, 196 * r, 0.5 / r, 'triangle', 0.16, 392 * r);
        this.noise(out, 0.45 / r, 'bandpass', 700 * r, 3, 0.22, 3200 * r);
        dur = 0.55 / r;
        break;
      case 'borrow':
        // The world is switched off: a falling sweep and a sub drop.
        this.noise(out, 0.5, 'lowpass', 9000, 0.9, 0.5, 120);
        this.tone(out, 440, 0.45, 'sine', 0.3, 55);
        this.tone(out, 48, 0.7, 'sine', 0.7, 30, 0.05);
        dur = 0.8;
        break;
      case 'collect': {
        // The debt being collected: a rising, shuddering saw for as long as it lasts.
        const len = Math.max(0.3, param);
        this.tone(out, 82, len, 'sawtooth', 0.2, 330, 0, 14);
        this.tone(out, 123, len, 'sawtooth', 0.12, 494, 0, 14);
        this.noise(out, 0.25, 'highpass', 2500, 0.7, 0.35);
        dur = len + 0.1;
        break;
      }
      case 'repaid':
        this.tone(out, 660, 0.09, 'triangle', 0.2, 660);
        this.tone(out, 880, 0.2, 'triangle', 0.2, 880, 0.08);
        dur = 0.3;
        break;
      case 'chime': {
        const f = SCALE[MOTIF[Math.max(0, Math.floor(param)) % MOTIF.length]];
        this.bell(out, f, 1.5, 0.2);
        dur = 1.6;
        break;
      }
      case 'complete':
        this.bell(out, 220, 2.6, 0.2);
        this.bell(out, 329.63, 2.6, 0.16, 0.09);
        this.bell(out, 440, 2.8, 0.16, 0.18);
        this.bell(out, 659.25, 3, 0.12, 0.27);
        dur = 3.2;
        break;
      case 'ui':
        this.tone(out, 720, 0.04, 'square', 0.1, 720);
        dur = 0.06;
        break;
    }

    // Release the routing nodes once the sound has finished.
    this.voices++;
    window.setTimeout(
      () => {
        this.voices--;
        out.disconnect();
        panner.disconnect();
      },
      (dur + 0.6) * 1000,
    );
  }

  private tone(
    dest: AudioNode,
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    glideTo: number,
    delay = 0,
    tremolo = 0,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(clamp(freq, 20, 16000), t);
    if (glideTo !== freq) o.frequency.exponentialRampToValueAtTime(clamp(glideTo, 20, 16000), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + Math.min(0.004, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    if (tremolo > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = tremolo;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      const trem = ctx.createGain();
      trem.gain.value = 0.5;
      lfo.connect(depth);
      depth.connect(trem.gain);
      g.connect(trem);
      trem.connect(dest);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    } else {
      g.connect(dest);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    dest: AudioNode,
    dur: number,
    filterType: BiquadFilterType,
    freq: number,
    q: number,
    gain: number,
    sweepTo?: number,
  ): void {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(clamp(freq, 30, 18000), t);
    if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(clamp(sweepTo, 30, 18000), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** A two-operator FM bell. */
  private bell(dest: AudioNode, freq: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 3.51;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 2.2, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur * 0.6);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    carrier.connect(g);
    g.connect(dest);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }
}
