import type { GameContext } from '@/core/Context';
import { getWeaponDef } from '@/config/weapons';
import { MIN_TIME_SCALE } from '@/config/constants';

/**
 * Diegetic heads-up display. Minimal, high-contrast, and built from plain DOM so
 * it layers cleanly over the WebGL canvas + CRT pass. Reads game state each
 * frame and listens on the event bus for discrete moments (hits, deaths, waves).
 */
export class HUD {
  private readonly ctx: GameContext;
  private readonly root: HTMLElement;

  private readonly crosshair: HTMLDivElement;
  private readonly ammo: HTMLDivElement;
  private readonly weaponName: HTMLDivElement;
  private readonly enemiesLeft: HTMLDivElement;
  private readonly timeFill: HTMLDivElement;
  private readonly timeLabel: HTMLDivElement;
  private readonly hotswitch: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly banner: HTMLDivElement;

  private hitTimer = 0;
  private bannerTimer = 0;
  private hintTimer = 0;
  private unsub: Array<() => void> = [];

  constructor(ctx: GameContext, root: HTMLElement) {
    this.ctx = ctx;
    this.root = root;

    this.crosshair = this.el('div', 'crosshair');
    this.banner = this.el('div', 'hud-banner');
    this.hitmarker = this.el('div', 'hitmarker');
    this.vignette = this.el('div', 'hud-vignette');

    const bl = this.el('div', 'hud bl');
    this.weaponName = this.el('div', 'weapon-name');
    this.ammo = this.el('div', 'ammo');
    bl.append(this.weaponName, this.ammo);

    const tr = this.el('div', 'hud tr');
    this.enemiesLeft = this.el('div', 'enemies-left');
    tr.append(this.enemiesLeft);

    const left = this.el('div', 'hud time-meter');
    this.timeFill = this.el('div', 'time-fill');
    this.timeLabel = this.el('div', 'time-label');
    this.timeLabel.textContent = 'TIME';
    left.append(this.timeFill, this.timeLabel);

    const br = this.el('div', 'hud br');
    this.hotswitch = this.el('div', 'hotswitch-status');
    br.append(this.hotswitch);

    this.hint = this.el('div', 'hud hint');

    this.root.append(
      this.crosshair,
      bl,
      tr,
      left,
      br,
      this.hint,
      this.banner,
      this.hitmarker,
      this.vignette,
    );

    this.bind();
    this.setVisible(false);
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    return e;
  }

  private bind(): void {
    const bus = this.ctx.bus;
    this.unsub.push(
      bus.on('hitmarker', () => (this.hitTimer = 0.18)),
      bus.on('enemy:killed', () => (this.hitTimer = Math.max(this.hitTimer, 0.12))),
      bus.on('player:died', () => {
        this.vignette.classList.add('dead');
        this.showBanner('TERMINATED', 'press R to retry', 0);
      }),
      bus.on('wave:announce', () => {}),
      bus.on('hint', (p) => this.showHint(p.text, p.ms ?? 2600)),
      bus.on('weapon:empty', () => this.showHint('empty — throw it [Q] or grab another [E]', 1800)),
    );
  }

  setVisible(on: boolean): void {
    this.root.style.setProperty('--hud-opacity', on ? '1' : '0');
    for (const e of [this.crosshair, ...Array.from(this.root.querySelectorAll<HTMLElement>('.hud'))]) {
      e.style.display = on ? '' : 'none';
    }
  }

  showLevelTitle(name: string): void {
    this.showBanner(name, '', 2.4);
  }

  showBanner(title: string, sub: string, seconds: number): void {
    this.banner.innerHTML = `<div class="banner-title">${title}</div>${sub ? `<div class="banner-sub">${sub}</div>` : ''}`;
    this.banner.classList.add('show');
    this.bannerTimer = seconds; // 0 = sticky
  }

  hideBanner(): void {
    this.banner.classList.remove('show');
    this.bannerTimer = 0;
  }

  showHint(text: string, ms: number): void {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    this.hintTimer = ms / 1000;
  }

  reset(): void {
    this.vignette.classList.remove('dead');
    this.hideBanner();
    this.hint.classList.remove('show');
  }

  update(realDt: number): void {
    const { time, player, director } = this.ctx;

    // Time meter.
    const norm = (time.scale - MIN_TIME_SCALE) / (1 - MIN_TIME_SCALE);
    this.timeFill.style.height = `${Math.max(2, norm * 100).toFixed(1)}%`;
    this.timeFill.style.background = `hsl(${(1 - norm) * 210}, 90%, 55%)`;

    // Weapon + ammo.
    const kind = player.heldKind;
    if (kind === 'fist') {
      this.weaponName.textContent = 'FISTS';
      this.ammo.innerHTML = '';
    } else if (kind === 'ball') {
      this.weaponName.textContent = 'THROWABLE';
      this.ammo.innerHTML = '';
    } else if (kind) {
      const def = getWeaponDef(kind);
      this.weaponName.textContent = def.displayName;
      if (def.category === 'firearm') {
        let dots = '';
        for (let i = 0; i < def.ammo; i++) {
          dots += `<span class="dot ${i < player.heldAmmo ? 'full' : 'spent'}"></span>`;
        }
        this.ammo.innerHTML = dots;
      } else {
        this.ammo.innerHTML = '';
      }
    }

    // Enemies remaining.
    this.enemiesLeft.innerHTML = `<span class="num">${director.remainingTotal()}</span><span class="lbl">RED LEFT</span>`;

    // Hotswitch status.
    if (player.hotswitchReady) {
      this.hotswitch.textContent = 'HOTSWITCH READY [SHIFT]';
      this.hotswitch.classList.toggle('armed', player.aimingAtEnemy());
    } else {
      this.hotswitch.textContent = `HOTSWITCH ${(this.ctx.player.hotswitchCooldownFraction * 100).toFixed(0)}%`;
      this.hotswitch.classList.remove('armed');
    }

    // Crosshair target highlight.
    this.crosshair.classList.toggle('target', player.aimingAtEnemy());

    // Pickup hint.
    if (this.hintTimer <= 0) {
      const near = player.nearbyPickup();
      if (near && player.alive) {
        this.hint.textContent =
          near.type === 'weapon' ? `[E] pick up ${near.kind}` : '[E] pick up object';
        this.hint.classList.add('show');
      } else {
        this.hint.classList.remove('show');
      }
    } else {
      this.hintTimer -= realDt;
    }

    // Hitmarker.
    if (this.hitTimer > 0) {
      this.hitTimer -= realDt;
      this.hitmarker.style.opacity = `${Math.max(0, this.hitTimer / 0.18)}`;
    } else {
      this.hitmarker.style.opacity = '0';
    }

    // Banner auto-hide.
    if (this.bannerTimer > 0) {
      this.bannerTimer -= realDt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }
}
