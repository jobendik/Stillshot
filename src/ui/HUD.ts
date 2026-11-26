import type { GameContext } from '@/core/Context';
import type { HintDef, LevelDef } from '@/types';
import { getWeaponDef } from '@/config/weapons';
import { BORROW_MAX } from '@/config/constants';

interface Arrival {
  x: number;
  z: number;
  ttl: number;
}

const MAX_THREATS = 8;

/**
 * Heads-up display. Plain DOM over the canvas, deliberately sparse:
 *
 *   top-left     EXPOSURE — world seconds spent so far. This is both the score
 *                and an honest clock: the digits run when time runs and hold
 *                when it holds.
 *   top-right    figures remaining.
 *   crosshair    a dot and a ring; the ring closes as the weapon comes ready
 *                (weapon readiness is on spent time, so it only closes if you
 *                move). Red when a transfer target is under it.
 *   ring arcs    rounds that will pass through you from outside your view, and
 *                figures arriving outside your view. Nothing lethal is ever
 *                both off-screen and unannounced.
 *   bottom       weapon + rounds left; ability keys with their cooldowns.
 */
export class HUD {
  private readonly ctx: GameContext;
  private readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly threatEls: HTMLDivElement[] = [];
  private readonly exposure: HTMLDivElement;
  private readonly flow: HTMLElement;
  private readonly remaining: HTMLDivElement;
  private readonly weaponName: HTMLDivElement;
  private readonly ammo: HTMLDivElement;
  private readonly abilityTransfer: HTMLDivElement;
  private readonly abilityBorrow: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly loan: HTMLDivElement;
  private readonly loanLabel: HTMLSpanElement;
  private readonly loanFill: HTMLElement;
  private readonly banner: HTMLDivElement;
  private readonly stampEl: HTMLDivElement;

  private hitTimer = 0;
  private bannerTimer = 0;
  private hintTimer = 0;
  private readonly arrivals: Arrival[] = [];
  private hints: HintDef[] = [];
  private readonly fired = new Set<HintDef>();
  private lastAmmoKey = '';
  private lastRemaining = -1;
  private borrowWasReady = true;
  private transferWasReady = true;
  private abilities = { hotswitch: false, borrow: false };

  constructor(ctx: GameContext, parent: HTMLElement) {
    this.ctx = ctx;
    this.root = el('div', 'hud-root');

    this.crosshair = el('div', 'crosshair');
    this.ring = el('div', 'ring');
    this.crosshair.append(this.ring, el('div', 'dot'));
    this.hitmarker = el('div', 'hitmarker');

    const threats = el('div', 'threats');
    for (let i = 0; i < MAX_THREATS; i++) {
      const t = el('div', 'threat');
      threats.appendChild(t);
      this.threatEls.push(t);
    }

    const tl = el('div', 'hud tl');
    tl.innerHTML = '<div class="exposure-label">exposure</div>';
    this.exposure = el('div', 'exposure-value');
    const flowWrap = el('div', 'flow');
    this.flow = document.createElement('i');
    flowWrap.appendChild(this.flow);
    tl.append(this.exposure, flowWrap);

    const tr = el('div', 'hud tr');
    this.remaining = el('div', 'remaining');
    const remLabel = el('div', 'exposure-label');
    remLabel.textContent = 'red remaining';
    tr.append(this.remaining, remLabel);

    const bl = el('div', 'hud bl');
    this.weaponName = el('div', 'weapon-name');
    this.ammo = el('div', 'ammo');
    bl.append(this.weaponName, this.ammo);

    const br = el('div', 'hud br');
    this.abilityBorrow = el('div', 'ability');
    this.abilityBorrow.innerHTML = '<span>borrow time</span><span class="bar"><i></i></span><span class="key">C</span>';
    this.abilityTransfer = el('div', 'ability');
    this.abilityTransfer.innerHTML = '<span>transfer</span><span class="bar"><i></i></span><span class="key">SHIFT</span>';
    br.append(this.abilityBorrow, this.abilityTransfer);

    this.hint = el('div', 'hint');
    this.prompt = el('div', 'prompt');

    this.loan = el('div', 'loan');
    this.loanLabel = document.createElement('span');
    const track = el('div', 'track');
    this.loanFill = document.createElement('i');
    track.appendChild(this.loanFill);
    this.loan.append(this.loanLabel, track);

    this.banner = el('div', 'banner');
    this.stampEl = el('div', 'stamp');

    this.root.append(this.stampEl, this.crosshair, threats, this.hitmarker, tl, tr, bl, br, this.prompt, this.hint, this.loan, this.banner);
    parent.appendChild(this.root);
    this.bind();
    this.setVisible(false);
  }

  private bind(): void {
    const bus = this.ctx.bus;
    bus.on('hitmarker', () => (this.hitTimer = 0.2));
    bus.on('enemy:killed', () => {
      this.hitTimer = 0.2;
      this.trigger('first-kill');
    });
    bus.on('enemy:spawned', (p) => this.arrivals.push({ x: p.x, z: p.z, ttl: 2.2 }));
    bus.on('hint', (p) => this.showHint(p.text, p.ms ?? 2600));
    bus.on('weapon:empty', () => {
      if (!this.trigger('empty')) this.showHint('empty — throw it [right mouse]', 1600);
    });
    bus.on('pickup', () => this.trigger('armed'));
    bus.on('bullet:near', () => this.trigger('bullet-near'));
  }

  /** Fire a one-shot level hint by trigger name. Returns true if one was shown. */
  private trigger(when: HintDef['when']): boolean {
    for (const h of this.hints) {
      if (h.when === when && !this.fired.has(h)) {
        this.fired.add(h);
        this.showHint(h.text, 5200);
        return true;
      }
    }
    return false;
  }

  /** Prepare for a fresh attempt at a plate. */
  begin(def: LevelDef, showHints: boolean): void {
    this.hints = showHints ? (def.hints ?? []) : [];
    this.fired.clear();
    this.arrivals.length = 0;
    this.abilities = def.abilities;
    this.abilityTransfer.style.display = def.abilities.hotswitch ? '' : 'none';
    this.abilityBorrow.style.display = def.abilities.borrow ? '' : 'none';
    this.borrowWasReady = true;
    this.transferWasReady = true;
    this.lastAmmoKey = '';
    this.lastRemaining = -1;
    this.hint.classList.remove('show');
    this.hintTimer = 0;
    this.hideBanner();
    this.stamp(null);
    this.root.classList.remove('negative');
  }

  setVisible(on: boolean): void {
    for (const e of Array.from(this.root.children) as HTMLElement[]) {
      if (e === this.banner || e === this.stampEl) continue;
      e.style.visibility = on ? '' : 'hidden';
    }
  }

  showBanner(kicker: string, title: string, sub: string, seconds: number, dead = false): void {
    this.banner.innerHTML = `<div class="kicker">${kicker}</div><div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    this.banner.classList.toggle('dead', dead);
    this.banner.classList.add('show');
    this.bannerTimer = seconds; // 0 = until hidden
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

  /** The big word. `null` clears it. */
  stamp(word: string | null, red = false): void {
    if (word === null) {
      this.stampEl.classList.remove('show', 'pop');
      return;
    }
    this.stampEl.textContent = word;
    this.stampEl.classList.toggle('red', red);
    this.stampEl.classList.remove('pop');
    void this.stampEl.offsetWidth; // restart the animation
    this.stampEl.classList.add('show', 'pop');
  }

  /** Describe where the killing blow came from, relative to where the player was looking. */
  deathDirection(): string {
    const p = this.ctx.player;
    const dx = p.deathFrom.x - p.pos.x;
    const dz = p.deathFrom.z - p.pos.z;
    const a = this.relAngle(dx, dz);
    const abs = Math.abs(a);
    if (abs < 0.6) return 'from ahead';
    if (abs > 2.4) return 'from behind';
    return a > 0 ? 'from your right' : 'from your left';
  }

  /** Signed angle (radians, + = right) from the view direction to a world offset. */
  private relAngle(dx: number, dz: number): number {
    const yaw = this.ctx.player.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
  }

  update(realDt: number): void {
    const { time, player, director } = this.ctx;

    // Exposure + flow.
    const w = time.worldElapsed;
    this.exposure.innerHTML = `${w.toFixed(2)}<small>s</small>`;
    this.flow.style.width = `${Math.min(100, (time.scale / 2) * 100).toFixed(1)}%`;
    this.root.classList.toggle('negative', time.borrowPhase === 'borrowing' && !this.ctx.settings.values.reducedFlash);

    const rem = director.remainingTotal();
    if (rem !== this.lastRemaining) {
      this.lastRemaining = rem;
      this.remaining.textContent = String(rem).padStart(2, '0');
    }

    // Weapon.
    const kind = player.heldKind;
    const key = `${kind}:${player.heldAmmo}`;
    if (key !== this.lastAmmoKey) {
      this.lastAmmoKey = key;
      if (kind === 'fist') {
        this.weaponName.textContent = 'bare hands';
        this.ammo.innerHTML = '';
      } else if (kind === 'orb') {
        this.weaponName.textContent = 'orb';
        this.ammo.innerHTML = '';
      } else {
        const def = getWeaponDef(kind);
        this.weaponName.textContent = def.displayName;
        let pips = '';
        if (def.category === 'firearm') {
          for (let i = 0; i < def.ammo; i++) pips += `<span class="pip${i < player.heldAmmo ? '' : ' spent'}"></span>`;
        }
        this.ammo.innerHTML = pips;
      }
    }

    // Crosshair.
    const target = this.abilities.hotswitch && player.hotswitchReady ? player.hotswitchTarget() : null;
    const grab = player.alive ? player.nearbyPickup() : null;
    this.crosshair.classList.toggle('target', target !== null);
    this.crosshair.classList.toggle('grab', grab !== null && kind === 'fist' && target === null);
    this.ring.style.setProperty('--p', `${((1 - player.readiness) * 100).toFixed(0)}%`);

    // Grab prompt.
    if (grab && player.alive) {
      const name = grab.type === 'weapon' && grab.kind ? getWeaponDef(grab.kind).displayName : 'orb';
      this.prompt.textContent = `${grab.settled ? 'take' : 'catch'} ${name} — ${kind === 'fist' ? 'click / E' : 'E'}`;
      this.prompt.classList.add('show');
    } else {
      this.prompt.classList.remove('show');
    }

    // Abilities.
    if (this.abilities.hotswitch) {
      const ready = player.hotswitchReady;
      this.abilityTransfer.classList.toggle('ready', ready);
      this.abilityTransfer.classList.toggle('armed', target !== null);
      (this.abilityTransfer.querySelector('i') as HTMLElement).style.width = `${((1 - player.hotswitchCooldownFraction) * 100).toFixed(0)}%`;
      if (ready && !this.transferWasReady) this.trigger('hotswitch-ready');
      this.transferWasReady = ready;
    }
    if (this.abilities.borrow) {
      const ready = time.canBorrow;
      this.abilityBorrow.classList.toggle('ready', ready);
      (this.abilityBorrow.querySelector('i') as HTMLElement).style.width = `${(ready ? 100 : Math.max(0, 1 - time.borrowCooldown / 4) * 100).toFixed(0)}%`;
      if (ready && !this.borrowWasReady) this.trigger('borrow-ready');
      this.borrowWasReady = ready;
    }

    // Loan / debt meter.
    if (time.borrowPhase === 'borrowing') {
      this.loan.classList.add('show');
      this.loan.classList.remove('owed');
      this.loanLabel.textContent = `borrowed ${(BORROW_MAX * time.loanFraction).toFixed(1)}s left — C to stop`;
      this.loanFill.style.width = `${(time.loanFraction * 100).toFixed(1)}%`;
    } else if (time.borrowPhase === 'repaying') {
      this.loan.classList.add('show', 'owed');
      this.loanLabel.textContent = `owed ${time.debt.toFixed(1)}s — the world is collecting`;
      this.loanFill.style.width = `${Math.min(100, (time.debt / BORROW_MAX) * 100).toFixed(1)}%`;
    } else {
      this.loan.classList.remove('show', 'owed');
    }

    this.updateThreats(realDt);

    // Timed hints (world time).
    for (const h of this.hints) {
      if (typeof h.when === 'number' && !this.fired.has(h) && w >= h.when) {
        this.fired.add(h);
        this.showHint(h.text, 6000);
      }
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= realDt;
      if (this.hintTimer <= 0) this.hint.classList.remove('show');
    }

    if (this.hitTimer > 0) {
      this.hitTimer -= realDt;
      this.hitmarker.style.opacity = `${Math.max(0, this.hitTimer / 0.2)}`;
    } else if (this.hitmarker.style.opacity !== '0') {
      this.hitmarker.style.opacity = '0';
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= realDt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
  }

  /** Tick banner / stamp timers while the simulation itself is not running. */
  idle(realDt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= realDt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
  }

  private updateThreats(realDt: number): void {
    const player = this.ctx.player;
    let n = 0;
    const put = (angle: number, strength: number, arrival: boolean): void => {
      if (n >= MAX_THREATS) return;
      const e = this.threatEls[n++];
      e.classList.toggle('arrival', arrival);
      e.style.transform = `rotate(${angle.toFixed(3)}rad)`;
      e.style.opacity = strength.toFixed(2);
    };

    if (player.alive) {
      // Rounds on course to pass through the player from outside the view.
      const head = player.headPos;
      for (const p of this.ctx.projectiles.active) {
        if (p.faction !== 'enemy') continue;
        const rx = head.x - p.pos.x;
        const ry = head.y - 0.5 - p.pos.y;
        const rz = head.z - p.pos.z;
        const along = rx * p.dir.x + ry * p.dir.y + rz * p.dir.z;
        if (along <= 0 || along > 26) continue;
        const px = rx - p.dir.x * along;
        const py = ry - p.dir.y * along;
        const pz = rz - p.dir.z * along;
        if (px * px + pz * pz > 0.8 * 0.8 || Math.abs(py) > 1.3) continue;
        const angle = this.relAngle(-rx, -rz);
        if (Math.abs(angle) < 0.7) continue; // you can see this one
        put(angle, 0.35 + 0.65 * (1 - along / 26), false);
      }
      // Figures arriving outside the view.
      for (let i = this.arrivals.length - 1; i >= 0; i--) {
        const a = this.arrivals[i];
        a.ttl -= realDt;
        if (a.ttl <= 0) {
          this.arrivals.splice(i, 1);
          continue;
        }
        const angle = this.relAngle(a.x - player.pos.x, a.z - player.pos.z);
        if (Math.abs(angle) < 0.75) continue;
        put(angle, Math.min(1, a.ttl) * 0.9, true);
      }
    }
    for (let i = n; i < MAX_THREATS; i++) {
      if (this.threatEls[i].style.opacity !== '0') this.threatEls[i].style.opacity = '0';
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
