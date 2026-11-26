import type { LevelDef } from '@/types';
import type { Settings, SettingsStore } from '@/core/Settings';

export interface MenuHandlers {
  levels: LevelDef[];
  store: SettingsStore;
  onPlay: (index: number) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onUiSound: () => void;
}

export interface ResultsData {
  index: number;
  def: LevelDef;
  exposure: number;
  realTime: number;
  newBest: boolean;
  previousBest: number | null;
  shots: number;
  kills: number;
  /** e.g. "2 split · 1 collateral" — the unusual ways figures fell. */
  flourishes: string[];
  last: boolean;
}

export interface ResultsHandlers {
  onContinue: () => void;
  onRetry: () => void;
  onWatch: () => void;
  onMenu: () => void;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

type SliderDef = { key: keyof Settings; label: string; note?: string; min: number; max: number; step: number; fmt: (v: number) => string };
type ToggleDef = { key: keyof Settings; label: string; note?: string };

const SLIDERS_INPUT: SliderDef[] = [
  { key: 'sensitivity', label: 'mouse sensitivity', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'fov', label: 'field of view', min: 60, max: 100, step: 1, fmt: (v) => `${v.toFixed(0)}°` },
];
const SLIDERS_AUDIO: SliderDef[] = [
  { key: 'master', label: 'volume', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
  { key: 'sfx', label: 'effects', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
  { key: 'music', label: 'tone & pulse', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
];
const SLIDERS_VIDEO: SliderDef[] = [
  { key: 'lens', label: 'lens effects', note: 'grain, fringe, vignette', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}` },
  { key: 'renderScale', label: 'render scale', note: 'lower for slower machines', min: 0.5, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];
const TOGGLES: ToggleDef[] = [
  { key: 'invertY', label: 'invert vertical look' },
  { key: 'bloom', label: 'bloom' },
  { key: 'threatLines', label: 'trajectory lines', note: 'show where slow rounds are heading' },
  { key: 'reducedMotion', label: 'reduced motion', note: 'no FOV breathing, ripples, or moving replay cameras' },
  { key: 'reducedFlash', label: 'reduced flash', note: 'borrowed time tints the image instead of inverting it' },
];

/**
 * Everything that is not the HUD: the opening card, the contact sheet of
 * plates, briefings, settings, the pause sheet, the results card and the
 * replay's transport. Fast to get through — any card can be dismissed with a
 * click or a key, and nothing is ever typed out at you twice.
 */
export class Menu {
  private readonly root: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly resultsHost: HTMLDivElement;
  private readonly replayHost: HTMLDivElement;
  private readonly h: MenuHandlers;
  private dismiss: (() => void) | null = null;
  private replayEls: { fill: HTMLElement; head: HTMLElement; shot: HTMLElement; state: HTMLElement } | null = null;

  constructor(parent: HTMLElement, handlers: MenuHandlers) {
    this.h = handlers;
    this.replayHost = document.createElement('div');
    this.resultsHost = document.createElement('div');
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    parent.append(this.replayHost, this.resultsHost, this.root, this.overlay);
    this.root.style.display = 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  hide(): void {
    this.clearDismiss();
    this.root.style.display = 'none';
    this.root.innerHTML = '';
  }

  private open(overScene = false): HTMLDivElement {
    this.clearDismiss();
    this.root.style.display = '';
    this.root.classList.toggle('over-scene', overScene);
    this.root.innerHTML = '';
    this.root.scrollTop = 0;
    const frame = document.createElement('div');
    frame.className = 'frame';
    this.root.appendChild(frame);
    return frame;
  }

  /** Dismiss the current card with any key or a click (armed after a short delay). */
  private armDismiss(target: HTMLElement, fn: () => void): void {
    const go = (e: Event): void => {
      if (e instanceof KeyboardEvent && (e.repeat || e.code === 'Tab' || e.metaKey || e.ctrlKey || e.altKey)) return;
      this.clearDismiss();
      fn();
    };
    const timer = window.setTimeout(() => {
      window.addEventListener('keydown', go);
      target.addEventListener('click', go);
    }, 120);
    this.dismiss = () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', go);
      target.removeEventListener('click', go);
    };
  }

  private clearDismiss(): void {
    this.dismiss?.();
    this.dismiss = null;
  }

  // ---- opening ----------------------------------------------------------

  showSplash(onDone: () => void): void {
    const frame = this.open();
    const wrap = document.createElement('div');
    wrap.className = 'splash';
    wrap.innerHTML = `
      <h1 class="logo">STILL<span>SHOT</span></h1>
      <p class="tagline">time is not passed. it is spent.</p>
      <p class="go blink">click to open the archive</p>`;
    frame.appendChild(wrap);
    this.armDismiss(this.root, onDone);
  }

  // ---- contact sheet ----------------------------------------------------

  showTitle(): void {
    const frame = this.open();
    const progress = this.h.store.progress;

    const head = document.createElement('div');
    head.className = 'title-head';
    head.innerHTML = `
      <div>
        <h1 class="logo small">STILL<span>SHOT</span></h1>
        <p class="tagline">an archive of eight exposures</p>
      </div>
      <div class="right"></div>`;
    const settingsBtn = button('btn', 'settings', () => this.showSettings());
    head.querySelector('.right')!.appendChild(settingsBtn);
    frame.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'plates';
    this.h.levels.forEach((lvl, idx) => {
      const locked = idx > progress.unlocked - 1;
      const best = progress.best[lvl.id];
      const card = document.createElement('button');
      card.className = 'plate' + (best ? ' done' : '') + (best && best.exposure <= lvl.par ? ' par' : '');
      card.disabled = locked;
      card.innerHTML = `
        <span class="mark"></span>
        <span class="no">${pad2(idx + 1)}</span>
        <span>
          <span class="name">${locked ? 'unexposed' : lvl.name}</span><br>
          <span class="rec">${
            locked ? '—' : best ? `best ${best.exposure.toFixed(2)}s · par ${lvl.par.toFixed(0)}s` : `par ${lvl.par.toFixed(0)}s`
          }</span>
        </span>`;
      card.addEventListener('click', () => {
        this.h.onUiSound();
        this.h.onPlay(idx);
      });
      grid.appendChild(card);
    });
    frame.appendChild(grid);

    const controls = document.createElement('div');
    controls.className = 'controls';
    controls.innerHTML = [
      ['W A S D', 'move — spends time'],
      ['MOUSE', 'look — spends a little'],
      ['LEFT MOUSE', 'fire / strike / take'],
      ['RIGHT MOUSE · Q', 'throw what you hold'],
      ['E', 'take or catch'],
      ['F', 'strike with anything'],
      ['SPACE', 'jump — hold to hang'],
      ['SHIFT', 'transfer into a body'],
      ['C', 'borrow time'],
      ['R', 'expose again'],
      ['ESC', 'pause'],
    ]
      .map(([k, v]) => `<div><b>${k}</b>${v}</div>`)
      .join('');
    frame.appendChild(controls);

    const fine = document.createElement('p');
    fine.className = 'fine';
    fine.textContent =
      'Exposure is the world-time a plate costs you; a filled mark means developed, a red one means under par. ' +
      'STILLSHOT is a non-commercial fan project that began as a study of the time-moves-when-you-move idea introduced by SUPERHOT (SUPERHOT Team). ' +
      'All models, shaders and sound are generated in code.';
    frame.appendChild(fine);
  }

  // ---- briefing ---------------------------------------------------------

  showBriefing(level: LevelDef, index: number, onBegin: () => void): void {
    const frame = this.open(true);
    const best = this.h.store.progress.best[level.id];
    const abilities = [level.abilities.hotswitch ? 'transfer' : null, level.abilities.borrow ? 'borrow' : null].filter(Boolean).join(' · ');
    const wrap = document.createElement('div');
    wrap.className = 'briefing';
    wrap.innerHTML = `
      <div class="no">${pad2(index + 1)}</div>
      <div class="name">${level.name}</div>
      <pre></pre>
      <div class="meta">
        <span>par ${level.par.toFixed(0)}s</span>
        <span>${best ? `best ${best.exposure.toFixed(2)}s` : 'not yet developed'}</span>
        ${abilities ? `<span>${abilities}</span>` : ''}
      </div>
      <div class="go blink">click to expose</div>`;
    (wrap.querySelector('pre') as HTMLElement).textContent = level.briefing;
    frame.appendChild(wrap);
    this.armDismiss(this.root, onBegin);
  }

  // ---- settings ---------------------------------------------------------

  private buildSettings(host: HTMLElement): void {
    const store = this.h.store;
    const grid = document.createElement('div');
    grid.className = 'settings';

    const group = (name: string): void => {
      const g = document.createElement('div');
      g.className = 'group';
      g.textContent = name;
      grid.appendChild(g);
    };
    const label = (text: string, note?: string): void => {
      const l = document.createElement('label');
      l.innerHTML = `${text}${note ? `<span class="note">${note}</span>` : ''}`;
      grid.appendChild(l);
    };
    const slider = (def: SliderDef): void => {
      label(def.label, def.note);
      const ctrl = document.createElement('div');
      ctrl.className = 'ctrl';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      input.value = String(store.values[def.key]);
      input.setAttribute('aria-label', def.label);
      const out = document.createElement('output');
      out.textContent = def.fmt(Number(input.value));
      input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = def.fmt(v);
        store.set(def.key, v as never);
      });
      ctrl.append(input, out);
      grid.appendChild(ctrl);
    };
    const toggle = (def: ToggleDef): void => {
      label(def.label, def.note);
      const b = document.createElement('button');
      const refresh = (): void => {
        const on = Boolean(store.values[def.key]);
        b.className = 'toggle' + (on ? ' on' : '');
        b.textContent = on ? 'on' : 'off';
        b.setAttribute('aria-pressed', String(on));
      };
      b.setAttribute('aria-label', def.label);
      b.addEventListener('click', () => {
        store.set(def.key, !store.values[def.key] as never);
        refresh();
        this.h.onUiSound();
      });
      refresh();
      grid.appendChild(b);
    };

    group('control');
    SLIDERS_INPUT.forEach(slider);
    toggle(TOGGLES[0]);
    group('sound');
    SLIDERS_AUDIO.forEach(slider);
    group('picture');
    SLIDERS_VIDEO.forEach(slider);
    toggle(TOGGLES[1]);
    toggle(TOGGLES[2]);
    group('comfort');
    toggle(TOGGLES[3]);
    toggle(TOGGLES[4]);
    host.appendChild(grid);
  }

  private showSettings(fromPause = false): void {
    this.overlay.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = '<h2>settings</h2><div class="kicker">saved on this device</div>';
    this.buildSettings(sheet);
    sheet.addEventListener('click', (e) => e.stopPropagation());
    this.overlay.onclick = null;
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(
      button('btn primary', 'done', () => {
        if (fromPause) this.showPause();
        else this.overlay.classList.remove('show');
      }),
    );
    sheet.appendChild(row);
    this.overlay.appendChild(sheet);
    this.overlay.classList.add('show');
  }

  // ---- pause ------------------------------------------------------------

  showPause(): void {
    this.overlay.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = '<h2>held.</h2><div class="kicker">the exposure is paused</div>';
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.append(
      button('btn primary', 'resume', () => this.h.onResume()),
      button('btn', 'expose again', () => this.h.onRestart()),
      button('btn', 'settings', () => this.showSettings(true)),
      button('btn', 'back to the archive', () => this.h.onQuit()),
    );
    sheet.appendChild(row);
    sheet.addEventListener('click', (e) => e.stopPropagation());
    this.overlay.appendChild(sheet);
    // Clicking anywhere outside the sheet resumes too.
    this.overlay.onclick = () => this.h.onResume();
    this.overlay.classList.add('show');
  }

  hidePause(): void {
    this.overlay.onclick = null;
    this.overlay.classList.remove('show');
    this.overlay.innerHTML = '';
  }

  get pauseVisible(): boolean {
    return this.overlay.classList.contains('show');
  }

  // ---- results ----------------------------------------------------------

  showResults(d: ResultsData, handlers: ResultsHandlers): void {
    this.resultsHost.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'results';
    const under = d.exposure <= d.def.par;
    const rows: Array<[string, string]> = [
      ['par', `${d.def.par.toFixed(2)}s`],
      ['your time, undeveloped', `${d.realTime.toFixed(1)}s`],
      ['rounds fired', String(d.shots)],
      ['figures', String(d.kills)],
    ];
    if (d.previousBest !== null && !d.newBest) rows.unshift(['best', `${d.previousBest.toFixed(2)}s`]);
    card.innerHTML = `
      <div class="word">STILL.<br><span>SHOT.</span></div>
      <div class="kicker">plate ${pad2(d.index + 1)} — ${d.def.name} — developed</div>
      <div class="big">
        <span class="v">${d.exposure.toFixed(2)}s</span>
        <span class="l">exposure${d.newBest ? '<span class="tag">best</span>' : ''}${under ? '<span class="tag">under par</span>' : ''}</span>
      </div>
      <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      ${d.flourishes.length ? `<div class="kicker">${d.flourishes.join(' · ')}</div>` : ''}
      ${d.def.afterword ? `<p class="after">${d.def.afterword}</p>` : ''}`;
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.append(
      button('btn primary', d.last ? 'close the archive<kbd>enter</kbd>' : 'next plate<kbd>enter</kbd>', handlers.onContinue),
      button('btn', 'watch again<kbd>w</kbd>', handlers.onWatch),
      button('btn', 'expose again<kbd>r</kbd>', handlers.onRetry),
      button('btn', 'archive', handlers.onMenu),
    );
    card.appendChild(row);
    this.resultsHost.appendChild(card);
  }

  hideResults(): void {
    this.resultsHost.innerHTML = '';
  }

  get resultsVisible(): boolean {
    return this.resultsHost.childElementCount > 0;
  }

  // ---- replay transport -------------------------------------------------

  showReplay(title: string, killFractions: number[], onSeek: (fraction: number) => void): void {
    this.replayHost.innerHTML = '';
    const ui = document.createElement('div');
    ui.className = 'replay-ui';
    ui.innerHTML = `
      <div class="bar top"><span class="rec">${title}</span><span class="shot"></span></div>
      <div class="bar bottom">
        <span class="state">developing</span>
        <div class="timeline"><div class="fill"></div>${killFractions
          .map((f) => `<div class="tick" style="left:${(f * 100).toFixed(2)}%"></div>`)
          .join('')}<div class="head"></div></div>
        <span class="keys"><b>space</b> hold · <b>← →</b> scrub · <b>1 2 3</b> camera · <b>enter</b> skip</span>
      </div>`;
    const timeline = ui.querySelector('.timeline') as HTMLElement;
    timeline.addEventListener('click', (e) => {
      const r = timeline.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    });
    this.replayHost.appendChild(ui);
    this.replayEls = {
      fill: ui.querySelector('.fill') as HTMLElement,
      head: ui.querySelector('.head') as HTMLElement,
      shot: ui.querySelector('.shot') as HTMLElement,
      state: ui.querySelector('.state') as HTMLElement,
    };
  }

  updateReplay(progress: number, shot: string, state: string): void {
    const els = this.replayEls;
    if (!els) return;
    const pct = `${(progress * 100).toFixed(2)}%`;
    els.fill.style.width = pct;
    els.head.style.left = pct;
    if (els.shot.textContent !== shot) els.shot.textContent = shot;
    if (els.state.textContent !== state) els.state.textContent = state;
  }

  hideReplay(): void {
    this.replayHost.innerHTML = '';
    this.replayEls = null;
  }

  // ---- ending -----------------------------------------------------------

  showEnding(total: number, onDone: () => void): void {
    const frame = this.open();
    const wrap = document.createElement('div');
    wrap.className = 'ending';
    wrap.innerHTML = `
      <h1 class="logo small">STILL<span>.</span></h1>
      <pre></pre>
      <div class="btn-row"></div>`;
    (wrap.querySelector('pre') as HTMLElement).textContent =
      `eight plates. all of them blank now.\nwhatever was moving in them has been developed out.\n\n` +
      `total exposure: ${total.toFixed(2)} seconds.\nthat is all the time that passed in there.\nyou were inside for a great deal longer.\n\n` +
      `the archive kept asking who was holding the shutter open.\nit has stopped asking.\n\n` +
      `you were never looking at a photograph.\nyou were the light.`;
    wrap.querySelector('.btn-row')!.appendChild(button('btn primary', 'return to the archive', onDone));
    frame.appendChild(wrap);
  }
}

function button(className: string, html: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.innerHTML = html;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
