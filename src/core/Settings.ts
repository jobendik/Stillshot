/**
 * Player-facing options and campaign progress, persisted to localStorage.
 * Nothing here may change the rules of the simulation — only how it is
 * presented and how the controls feel.
 */
export interface Settings {
  /** Mouse sensitivity multiplier. */
  sensitivity: number;
  invertY: boolean;
  /** Vertical field of view in degrees. */
  fov: number;
  master: number;
  sfx: number;
  music: number;
  /** Strength of the lens pass (grain, fringe, vignette, ripple): 0..1. */
  lens: number;
  bloom: boolean;
  /** Show where slow bullets are headed while time is nearly still. */
  threatLines: boolean;
  /** Removes camera kick, FOV breathing, ripples and replay camera moves. */
  reducedMotion: boolean;
  /** Removes full-screen flashes and the negative inversion. */
  reducedFlash: boolean;
  /** Internal render scale (0.5..1). */
  renderScale: number;
}

export interface PlateRecord {
  /** Best (lowest) exposure in world seconds. */
  exposure: number;
}

export interface Progress {
  unlocked: number;
  best: Record<string, PlateRecord>;
}

const DEFAULTS: Settings = {
  sensitivity: 1,
  invertY: false,
  fov: 78,
  master: 0.8,
  sfx: 1,
  music: 0.7,
  lens: 0.7,
  bloom: true,
  threatLines: true,
  reducedMotion: false,
  reducedFlash: false,
  renderScale: 1,
};

const KEY = 'stillshot.v2';

export class SettingsStore {
  readonly values: Settings = { ...DEFAULTS };
  readonly progress: Progress = { unlocked: 1, best: {} };
  private listeners = new Set<() => void>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw) as { settings?: Partial<Settings>; progress?: Partial<Progress> };
        Object.assign(this.values, data.settings ?? {});
        if (data.progress) {
          this.progress.unlocked = Math.max(1, data.progress.unlocked ?? 1);
          this.progress.best = data.progress.best ?? {};
        }
      }
    } catch {
      /* storage unavailable or corrupt — run with defaults */
    }
    if (typeof matchMedia === 'function' && !localStorage.getItem(KEY)) {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.values.reducedMotion = true;
    }
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.values[key] = value;
    this.save();
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** Record a finished plate. Returns true if this is a new best exposure. */
  recordPlate(id: string, index: number, exposure: number): boolean {
    this.progress.unlocked = Math.max(this.progress.unlocked, index + 2);
    const prev = this.progress.best[id];
    const better = !prev || exposure < prev.exposure;
    if (better) this.progress.best[id] = { exposure };
    this.save();
    return better;
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ settings: this.values, progress: this.progress }));
    } catch {
      /* ignore */
    }
  }
}
