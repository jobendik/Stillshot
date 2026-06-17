import type { LevelDef } from '@/types';

export interface MenuHandlers {
  levels: LevelDef[];
  onPlay: (index: number) => void;
  isAudioOn: () => boolean;
  isCrtOn: () => boolean;
  onToggleAudio: () => void;
  onToggleCrt: () => void;
}

/**
 * The diegetic faux-DOS shell. All non-gameplay UI is framed as an illicitly
 * traded, cracked executable — boot spew, a blinking prompt, mission briefings.
 * Reinforces the meta-narrative that the software itself is the antagonist.
 */
export class Menu {
  private readonly root: HTMLDivElement;
  private readonly handlers: MenuHandlers;
  private unlocked = 1;
  private typingTimer: number | null = null;

  constructor(parent: HTMLElement, handlers: MenuHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.className = 'menu';
    parent.appendChild(this.root);
  }

  setUnlocked(n: number): void {
    this.unlocked = Math.max(this.unlocked, n);
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.innerHTML = '';
    if (this.typingTimer !== null) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
  }

  private show(): void {
    this.root.style.display = '';
  }

  // ---- boot -------------------------------------------------------------

  showBoot(onDone: () => void): void {
    this.show();
    const lines = [
      'SUPERHOT_TEAM BIOS v3.7 ... OK',
      'mounting /dev/mind ............ OK',
      'cracked build — license check BYPASSED',
      'loading temporal kernel ....... OK',
      'WARNING: timescale driver unsigned',
      'injecting consciousness shim ... OK',
      '',
      'THE MOST INNOVATIVE SHOOTER OF THE YEAR',
      'THE MOST INNOVATIVE SHOOTER OF THE YEAR',
      'THE MOST INNOVATIVE SHOOTER OF THE YEAR',
      '',
      '> _',
    ];
    const pre = document.createElement('pre');
    pre.className = 'boot';
    this.root.innerHTML = '';
    this.root.appendChild(pre);

    let i = 0;
    const advance = () => {
      if (i < lines.length) {
        pre.textContent += lines[i] + '\n';
        i++;
      } else {
        if (this.typingTimer !== null) clearInterval(this.typingTimer);
        this.typingTimer = null;
        const prompt = document.createElement('div');
        prompt.className = 'boot-continue blink';
        prompt.textContent = '[ click or press any key to continue ]';
        this.root.appendChild(prompt);
        const go = () => {
          window.removeEventListener('keydown', go);
          this.root.removeEventListener('click', go);
          onDone();
        };
        window.addEventListener('keydown', go);
        this.root.addEventListener('click', go);
      }
    };
    this.typingTimer = window.setInterval(advance, 130);
  }

  // ---- title ------------------------------------------------------------

  showTitle(): void {
    this.show();
    this.root.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'title-screen';

    wrap.innerHTML = `
      <h1 class="logo">STILL<span>SHOT</span></h1>
      <p class="tagline">time moves only when you move</p>
      <div class="menu-list"></div>
      <div class="menu-toggles"></div>
      <p class="credits">a browser homage to the SUPERHOT temporal engine · WASD move · MOUSE look · LMB fire · Q throw · F melee · E pick up · SHIFT hotswitch</p>
    `;
    this.root.appendChild(wrap);

    const list = wrap.querySelector('.menu-list') as HTMLDivElement;
    this.handlers.levels.forEach((lvl, idx) => {
      const btn = document.createElement('button');
      const locked = idx > this.unlocked - 1;
      btn.className = 'menu-item' + (locked ? ' locked' : '');
      btn.disabled = locked;
      btn.innerHTML = `<span class="idx">${String(idx + 1).padStart(2, '0')}</span> ${locked ? '████████' : lvl.name}`;
      btn.addEventListener('click', () => {
        if (!locked) this.handlers.onPlay(idx);
      });
      list.appendChild(btn);
    });

    const toggles = wrap.querySelector('.menu-toggles') as HTMLDivElement;
    const audioBtn = document.createElement('button');
    audioBtn.className = 'toggle';
    const crtBtn = document.createElement('button');
    crtBtn.className = 'toggle';
    const refresh = () => {
      audioBtn.textContent = `AUDIO: ${this.handlers.isAudioOn() ? 'ON' : 'OFF'}`;
      crtBtn.textContent = `CRT: ${this.handlers.isCrtOn() ? 'ON' : 'OFF'}`;
    };
    audioBtn.addEventListener('click', () => {
      this.handlers.onToggleAudio();
      refresh();
    });
    crtBtn.addEventListener('click', () => {
      this.handlers.onToggleCrt();
      refresh();
    });
    refresh();
    toggles.append(audioBtn, crtBtn);
  }

  // ---- briefing ---------------------------------------------------------

  showBriefing(level: LevelDef, index: number, onBegin: () => void): void {
    this.show();
    this.root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'briefing';
    wrap.innerHTML = `
      <div class="brief-head">NODE ${String(index + 1).padStart(2, '0')} // ${level.name}</div>
      <pre class="brief-body">${level.briefing}</pre>
      <div class="brief-begin blink">[ click to insert consciousness ]</div>
    `;
    this.root.appendChild(wrap);
    const go = () => {
      window.removeEventListener('keydown', go);
      this.root.removeEventListener('click', go);
      onBegin();
    };
    // Defer attaching the dismiss listeners so the very click that opened this
    // briefing (which bubbles up to the menu root) cannot instantly skip it.
    window.setTimeout(() => {
      window.addEventListener('keydown', go);
      this.root.addEventListener('click', go);
    }, 80);
  }

  // ---- win --------------------------------------------------------------

  showWin(onAgain: () => void): void {
    this.show();
    this.root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'win-screen';
    wrap.innerHTML = `
      <h1 class="logo">SUPER<span>HOT</span></h1>
      <p class="tagline">the system has you now</p>
      <pre class="brief-body">every red shape, deleted.
you typed the compliance phrase without noticing.
you are part of the system. the system is you.</pre>
      <button class="menu-item" id="again">&gt; run it again</button>
    `;
    this.root.appendChild(wrap);
    (wrap.querySelector('#again') as HTMLButtonElement).addEventListener('click', onAgain);
  }
}
