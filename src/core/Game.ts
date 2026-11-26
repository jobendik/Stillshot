import { AmbientLight, DirectionalLight, Fog, HemisphereLight, PCFSoftShadowMap, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { GameState, type LevelDef } from '@/types';
import { PALETTE } from '@/config/palette';
import { getWeaponDef } from '@/config/weapons';
import { GameContext, makeRng } from './Context';
import { EventBus, type KillCause } from './events';
import { TimeController, type BorrowPhase } from './Time';
import { InputManager } from './Input';
import { SettingsStore } from './Settings';
import { clamp, damp } from './math';
import { Level } from '@/world/Level';
import { ProjectileSystem } from '@/combat/Projectile';
import { ThrownObjectSystem } from '@/combat/Throwable';
import { Player } from '@/player/Player';
import { Director } from '@/ai/Director';
import { FXSystem } from '@/fx/FX';
import { PostFX } from '@/fx/PostFX';
import { CrystalGlobals } from '@/fx/Crystal';
import { EnvGlobals } from '@/fx/Env';
import { registerFigureParts } from '@/fx/Rig';
import { warmShardTemplates } from '@/fx/Shards';
import type { BulletVisual } from '@/fx/Bullets';
import { AudioEngine } from '@/audio/Audio';
import { ReplayRecorder, type Recording } from '@/replay/Recorder';
import { ReplayStage } from '@/replay/Stage';
import { HUD } from '@/ui/HUD';
import { Menu } from '@/ui/Menu';
import { LEVELS, getLevel } from '@/world/levels';

const TABLEAU_TIME = 1.25;
const FLOURISH: Partial<Record<KillCause, string>> = {
  split: 'split',
  returned: 'returned',
  collateral: 'collateral',
  friendly: 'by their own',
  ricochet: 'ricochet',
  thrown: 'thrown',
  melee: 'by hand',
  transfer: 'taken',
};

/**
 * Top-level orchestrator: owns the renderer, the service context, the state
 * machine and the single requestAnimationFrame loop. It is also where the one
 * rule that defines the game is enforced — the player is updated on real time,
 * everything else on world time.
 */
export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly ctx = new GameContext();
  private readonly sun: DirectionalLight;

  readonly time = new TimeController();
  readonly input: InputManager;
  private readonly bus = new EventBus();
  private readonly store = new SettingsStore();
  private readonly audio = new AudioEngine();
  private readonly fx: FXSystem;
  private readonly postfx: PostFX;
  private readonly projectiles: ProjectileSystem;
  private readonly thrown: ThrownObjectSystem;
  readonly player: Player;
  readonly director: Director;
  private readonly recorder: ReplayRecorder;
  private readonly hud: HUD;
  private readonly menu: Menu;

  state: GameState = GameState.Boot;
  private level: Level | null = null;
  levelIndex = 0;
  private lastTime = 0;
  private realClock = 0;
  private tableauTimer = 0;
  private deadTimer = 0;
  private lastPhase: BorrowPhase = 'idle';
  private recording: Recording | null = null;
  private stage: ReplayStage | null = null;
  private resultsShown = false;
  private stampTimer = 0;
  private readonly killsByCause = new Map<KillCause, number>();
  private readonly visuals: BulletVisual[] = [];
  private attempts = 0;
  private activeDef: LevelDef | null = null;
  private customDef: LevelDef | null = null;
  /** When true the RAF loop renders but does not advance — tests step manually. */
  manual = false;
  /** Frame statistics for the performance probe. */
  readonly perf = { frames: 0, cpuMs: 0, maxCpuMs: 0 };

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    // Anti-aliasing happens in the HDR scene target (see PostFX), not the canvas.
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.camera = new PerspectiveCamera(this.store.values.fov, window.innerWidth / window.innerHeight, 0.04, 300);
    this.scene.add(this.camera);
    this.scene.background = PALETTE.background.clone();
    this.scene.fog = new Fog(PALETTE.fog.getHex(), 30, 95);

    this.scene.add(new AmbientLight(0xffffff, 0.35));
    this.scene.add(new HemisphereLight(0xffffff, 0xd6d1c8, 1.1));
    this.sun = new DirectionalLight(0xfffaf2, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.input = new InputManager(canvas);
    this.fx = new FXSystem(this.scene);
    this.postfx = new PostFX(this.renderer);

    registerFigureParts();

    const ctx = this.ctx;
    ctx.scene = this.scene;
    ctx.camera = this.camera;
    ctx.time = this.time;
    ctx.input = this.input;
    ctx.bus = this.bus;
    ctx.settings = this.store;
    ctx.audio = this.audio;
    ctx.fx = this.fx;
    ctx.rng = makeRng(0x5eed);

    this.projectiles = new ProjectileSystem(ctx);
    this.thrown = new ThrownObjectSystem(ctx);
    this.player = new Player(ctx);
    this.director = new Director(ctx);
    ctx.projectiles = this.projectiles;
    ctx.thrown = this.thrown;
    ctx.player = this.player;
    ctx.director = this.director;
    this.recorder = new ReplayRecorder(ctx);
    ctx.recorder = this.recorder;
    this.hud = new HUD(ctx, uiRoot);

    this.menu = new Menu(uiRoot, {
      levels: LEVELS,
      store: this.store,
      onPlay: (i) => this.beginLevel(i),
      onResume: () => this.input.requestPointerLock(),
      onRestart: () => {
        this.menu.hidePause();
        this.retryLevel();
      },
      onQuit: () => this.toMenu(),
      onUiSound: () => this.audio.play('ui'),
    });

    this.bindEvents();
    this.applySettings();
    this.store.onChange(() => this.applySettings());
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => this.onResize());
    this.input.onRequestLock = () => this.onUnlockedClick();
    this.input.onAnyKey = (code) => this.onKey(code);
  }

  // ---- setup ------------------------------------------------------------

  private applySettings(): void {
    const s = this.store.values;
    this.audio.setVolumes(s.master, s.sfx, s.music);
    this.postfx.lens = s.lens;
    this.postfx.bloom = s.bloom;
    this.postfx.negativeSoft = s.reducedFlash;
    this.postfx.rippleEnabled = !s.reducedMotion;
    this.fx.flashScale = s.reducedFlash ? 0.25 : 1;
    this.postfx.setRenderScale(s.renderScale);
    EnvGlobals.uClock.value = 1;
  }

  private bindEvents(): void {
    const bus = this.bus;
    bus.on('player:died', () => {
      if (this.state !== GameState.Playing) return;
      this.state = GameState.Dead;
      this.deadTimer = 0;
      this.recorder.abort();
      this.audio.setHold(false);
      this.hud.showBanner('exposure lost', 'OVEREXPOSED', `<b>${this.hud.deathDirection()}</b> &nbsp;·&nbsp; R or click — expose again`, 0, true);
    });
    bus.on('level:complete', () => {
      if (this.state !== GameState.Playing) return;
      this.state = GameState.LevelComplete;
      this.tableauTimer = TABLEAU_TIME;
      this.input.enabled = false;
      this.input.exitPointerLock();
      this.audio.setHold(false);
      this.audio.play('complete');
      this.hud.setVisible(false);
      this.hud.stamp('STILL.');
    });
    bus.on('enemy:killed', (p) => {
      this.killsByCause.set(p.cause, (this.killsByCause.get(p.cause) ?? 0) + 1);
      this.player.stats.kills++;
      // Each figure that falls is the next note of the plate's phrase.
      this.audio.play('chime', null, this.audio.nextChime());
    });
    bus.on('hotswitch', () => this.postfx.kick(0.5, 0.5, 1.3));
  }

  /** Aim the key light and fit its shadow frustum to the plate. */
  private fitSun(level: Level): void {
    const b = level.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const dir = new Vector3(...(level.def.sun ?? [0.42, 0.84, 0.34])).normalize();
    const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 4;
    this.sun.position.set(cx + dir.x * 40, level.floorY + dir.y * 40, cz + dir.z * 40);
    this.sun.target.position.set(cx, level.floorY, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 5;
    cam.far = 90;
    cam.updateProjectionMatrix();
    CrystalGlobals.uSunDir.value.copy(dir);
    CrystalGlobals.uBounds.value.set(b.minX + 0.05, b.minZ + 0.05, b.maxX - 0.05, b.maxZ - 0.05);
    CrystalGlobals.uFloorY.value = level.floorY;
  }

  // ---- lifecycle --------------------------------------------------------

  start(): void {
    this.menu.showSplash(() => {
      this.audio.resume();
      this.audio.startAmbient(55);
      this.audio.play('ui');
      warmShardTemplates();
      this.toMenu();
    });
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  private toMenu(): void {
    this.state = GameState.Menu;
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.menu.hidePause();
    this.menu.hideResults();
    this.menu.hideReplay();
    this.hud.setVisible(false);
    this.hud.hideBanner();
    this.hud.stamp(null);
    this.teardownLevel();
    this.resetLens();
    this.audio.setPulse(false);
    this.audio.setHold(false);
    this.audio.setTimeScale(0.2);
    this.menu.showTitle();
  }

  private beginLevel(index: number): void {
    this.customDef = null;
    this.levelIndex = index;
    this.attempts = 0;
    this.loadLevel(index);
    this.state = GameState.Briefing;
    this.menu.hideResults();
    this.menu.hideReplay();
    this.hud.stamp(null);
    this.menu.showBriefing(getLevel(index), index, () => {
      this.menu.hide();
      this.startPlaying();
    });
  }

  private loadLevel(index: number, custom?: LevelDef): void {
    this.teardownLevel();
    const def = custom ?? getLevel(index);
    this.activeDef = def;
    // Same seed every attempt: a plate is a fixed puzzle, not a dice roll.
    this.ctx.rng = makeRng(0x5eed + index * 977);
    this.fx.reseed(0xc0ffee + index * 131);
    this.level = new Level(def);
    this.ctx.level = this.level;
    this.level.build(this.scene);
    this.fitSun(this.level);
    this.time.reset();
    this.director.start(def);
    this.player.spawnAt(new Vector3(...def.spawn.pos), def.spawn.yaw);
    for (const v of def.volley ?? []) {
      const w = getWeaponDef(v.weapon);
      this.projectiles.spawn(new Vector3(...v.pos), new Vector3(...v.dir), {
        faction: 'enemy',
        speed: w.projectileSpeed,
        piercing: w.piercing,
        glass: w.glass,
        deflectable: w.deflectable,
        look: 'bullet',
      }).traveled = 3;
    }
    this.killsByCause.clear();
    this.lastPhase = 'idle';
    this.audio.resetMotif();
    this.audio.startAmbient([55, 49, 58.27, 51.91, 46.25, 55, 61.74, 41.2][index % 8]);
    this.resetLens();
    this.syncGlobals(0);
    this.drawWorld();
  }

  private teardownLevel(): void {
    this.recorder.abort();
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
    }
    this.recording = null;
    this.director.clear();
    this.projectiles.clear();
    this.thrown.clear();
    this.fx.clear(true);
    this.fx.streaks.begin();
    this.fx.streaks.end();
    if (this.level) {
      this.level.dispose();
      this.level = null;
    }
  }

  private resetLens(): void {
    this.postfx.negative = 0;
    this.postfx.repay = 0;
    this.postfx.death = 0;
    this.postfx.flow = 0;
  }

  private startPlaying(): void {
    const def = this.activeDef ?? getLevel(this.levelIndex);
    this.state = GameState.Playing;
    this.input.releaseAll();
    this.input.enabled = true;
    this.audio.resume();
    this.audio.setPulse(false);
    this.recorder.begin();
    this.hud.begin(def, this.attempts < 3);
    this.hud.setVisible(true);
    this.hud.showBanner(`plate ${String(this.levelIndex + 1).padStart(2, '0')}`, def.name, '', 2.2);
    this.attempts++;
    this.input.requestPointerLock();
  }

  private retryLevel(): void {
    this.menu.hideResults();
    this.menu.hideReplay();
    this.menu.hidePause();
    this.loadLevel(this.levelIndex, this.customDef ?? undefined);
    this.startPlaying();
  }

  // ---- replay -----------------------------------------------------------

  private startReplay(): void {
    const rec = this.recorder.finish();
    this.recording = rec;
    this.director.clear();
    this.projectiles.clear();
    this.thrown.clear();
    this.level?.setItemsVisible(false);
    this.resetLens();
    this.resultsShown = false;

    if (rec.frames.length < 2) {
      this.showResults();
      this.state = GameState.Replay;
      return;
    }
    this.stage = new ReplayStage(this.ctx, rec);
    this.state = GameState.Replay;
    const def = this.activeDef ?? getLevel(this.levelIndex);
    const marks = this.stage.edit.kills.map((k) => (rec.duration > 0 ? k.tau / rec.duration : 0));
    this.menu.showReplay(`plate ${String(this.levelIndex + 1).padStart(2, '0')} — ${def.name}`, marks, (f) => {
      if (!this.stage) return;
      this.hideResultsForReplay();
      this.stage.seek(f * this.stage.duration);
    });
    this.hud.stamp('SHOT.', true);
    this.stampTimer = 0.9;
    this.audio.resetMotif();
    this.audio.setPulse(true);
  }

  private hideResultsForReplay(): void {
    this.menu.hideResults();
    this.resultsShown = false;
  }

  private showResults(): void {
    if (this.resultsShown) return;
    this.resultsShown = true;
    const def = this.activeDef ?? getLevel(this.levelIndex);
    const rec = this.recording;
    const exposure = rec ? rec.exposure : this.time.worldElapsed;
    const prev = this.store.progress.best[def.id]?.exposure ?? null;
    // Test scenarios are not part of the archive.
    const newBest = this.customDef ? false : this.store.recordPlate(def.id, this.levelIndex, exposure);
    const flourishes: string[] = [];
    for (const [cause, n] of this.killsByCause) {
      const label = FLOURISH[cause];
      if (label) flourishes.push(`${n} ${label}`);
    }
    const st = this.player.stats;
    if (st.catches > 0) flourishes.push(`${st.catches} caught`);
    if (st.borrows > 0) flourishes.push(`${st.borrows} borrowed`);
    this.audio.setPulse(false);
    this.menu.showResults(
      {
        index: this.levelIndex,
        def,
        exposure,
        realTime: rec ? rec.realTime : 0,
        newBest,
        previousBest: prev,
        shots: st.shots,
        kills: st.kills,
        flourishes,
        last: this.levelIndex + 1 >= LEVELS.length,
      },
      {
        onContinue: () => this.continueFromResults(),
        onRetry: () => this.retryLevel(),
        onWatch: () => this.watchAgain(),
        onMenu: () => this.toMenu(),
      },
    );
  }

  private watchAgain(): void {
    if (!this.stage) return;
    this.hideResultsForReplay();
    this.audio.resetMotif();
    this.audio.setPulse(true);
    this.stage.restart();
  }

  private continueFromResults(): void {
    this.menu.hideResults();
    this.menu.hideReplay();
    this.hud.stamp(null);
    this.audio.setPulse(false);
    if (this.levelIndex + 1 < LEVELS.length) {
      this.beginLevel(this.levelIndex + 1);
    } else {
      this.state = GameState.Win;
      this.teardownLevel();
      let total = 0;
      for (const l of LEVELS) total += this.store.progress.best[l.id]?.exposure ?? 0;
      this.menu.showEnding(total, () => this.toMenu());
    }
  }

  // ---- input plumbing ---------------------------------------------------

  private onUnlockedClick(): void {
    this.audio.resume();
    if (this.state === GameState.Playing || this.state === GameState.Dead) this.input.requestPointerLock();
  }

  private onKey(code: string): void {
    if (this.state === GameState.Replay) {
      const stage = this.stage;
      switch (code) {
        case 'Enter':
        case 'NumpadEnter':
          if (this.resultsShown || !stage) this.continueFromResults();
          else stage.skipToEnd();
          break;
        case 'Escape':
          if (stage && !this.resultsShown) stage.skipToEnd();
          break;
        case 'Space':
          if (stage && !this.resultsShown) stage.paused = !stage.paused;
          break;
        case 'ArrowLeft':
          if (stage) {
            this.hideResultsForReplay();
            stage.seek(stage.tau - 2);
          }
          break;
        case 'ArrowRight':
          if (stage && !this.resultsShown) stage.seek(stage.tau + 2);
          break;
        case 'Digit1':
          stage?.setMode('director');
          break;
        case 'Digit2':
          stage?.setMode('first');
          break;
        case 'Digit3':
          stage?.setMode('pursuit');
          break;
        case 'KeyW':
          if (this.resultsShown) this.watchAgain();
          break;
        case 'KeyR':
          this.retryLevel();
          break;
      }
    } else if (this.state === GameState.Paused && code === 'KeyR') {
      this.retryLevel();
    }
  }

  private pause(): void {
    if (this.state !== GameState.Playing) return;
    this.state = GameState.Paused;
    this.input.releaseAll();
    this.menu.showPause();
  }

  private onPointerLockChange = (): void => {
    const locked = document.pointerLockElement !== null;
    if (!locked && this.state === GameState.Playing) {
      this.pause();
    } else if (locked && this.state === GameState.Paused) {
      this.state = GameState.Playing;
      this.input.enabled = true;
      this.menu.hidePause();
    }
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      if (this.state === GameState.Playing) {
        this.input.exitPointerLock();
        this.pause();
      }
      this.audio.suspend();
    } else {
      this.audio.resume();
      // Do not let the time away from the tab arrive as one enormous frame.
      this.lastTime = performance.now();
    }
  };

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.postfx.resize();
  };

  // ---- main loop --------------------------------------------------------

  private frame = (now: number): void => {
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    requestAnimationFrame(this.frame);
    if (this.manual) return;
    this.tick(rawDt, true);
  };

  /** Advance one frame. Public so tests can drive the game deterministically. */
  tick(rawDt: number, render: boolean): void {
    const t0 = performance.now();
    this.realClock += Math.min(rawDt, 0.1);

    switch (this.state) {
      case GameState.Playing:
        this.updatePlaying(rawDt);
        break;
      case GameState.LevelComplete:
        this.updateTableau(rawDt);
        break;
      case GameState.Replay:
        this.updateReplay(rawDt);
        break;
      case GameState.Dead:
        this.updateDead(rawDt);
        break;
      default:
        // Menus / briefing / paused: the world is held exactly as it is.
        this.hud.idle(rawDt);
        break;
    }

    this.input.endFrame();
    this.audio.update();
    this.perf.cpuMs = performance.now() - t0;
    this.perf.maxCpuMs = Math.max(this.perf.maxCpuMs, this.perf.cpuMs);
    this.perf.frames++;
    if (render) this.postfx.render(this.scene, this.camera, Math.min(rawDt, 0.1));
  }

  private syncGlobals(worldTime: number): void {
    CrystalGlobals.uTime.value = worldTime;
    EnvGlobals.uWorldTime.value = worldTime;
    EnvGlobals.uRealTime.value = this.realClock;
    EnvGlobals.uPlayer.value.copy(this.camera.position);
  }

  /** Rebuild the per-frame streak / bullet lists from the live simulation. */
  private drawWorld(): void {
    const s = this.store.values;
    const threat = s.threatLines ? clamp(1 - this.time.scale * 2.6, 0, 1) : 0;
    this.fx.streaks.begin();
    this.fx.bullets.draw(this.projectiles.fillVisuals(this.visuals), this.fx.streaks, threat, this.time.worldElapsed);
    this.director.drawTelegraphs(this.fx.streaks);
    this.fx.draw();
    this.fx.streaks.end();
  }

  private updatePlaying(rawDt: number): void {
    const time = this.time;
    if (this.input.pressed('restart')) {
      this.retryLevel();
      return;
    }

    const intent = this.input.moveIntent();
    const look = this.player.readLook();
    time.update(rawDt, {
      moveMagnitude: intent.magnitude,
      lookRadians: look,
      jumpHeld: this.input.isDown('jump'),
      airborne: !this.player.grounded,
    });

    this.player.update();
    this.trackBorrow();
    if (this.level) this.level.update(time);
    this.director.update();
    this.projectiles.update();
    this.thrown.update();
    this.fx.update(time.unscaledDt, time.scaledDt, time.worldElapsed);
    this.recorder.sample();

    this.syncGlobals(time.worldElapsed);
    this.drawWorld();
    this.hud.update(time.unscaledDt);

    this.audio.setListener(this.camera.position, this.player.aimRight);
    this.audio.setTimeScale(time.scale, time.borrowPhase === 'borrowing');
    this.updateLens(time.unscaledDt, clamp(time.scale, 0, 1), time.borrowPhase);
  }

  /** Announce changes of borrow phase (sound, lens, events). */
  private trackBorrow(): void {
    const phase = this.time.borrowPhase;
    if (phase === this.lastPhase) return;
    if (phase === 'borrowing') {
      this.bus.emit('borrow:begin', {});
      this.audio.play('borrow');
      this.audio.setHold(true);
      this.postfx.kick(0.5, 0.5, 0.8);
    } else if (phase === 'repaying') {
      this.bus.emit('borrow:end', { debt: this.time.debt });
      this.audio.setHold(false);
      this.audio.play('collect', null, this.time.debt);
      this.postfx.kick(0.5, 0.5, 1);
    } else {
      this.audio.setHold(false);
      if (this.lastPhase === 'repaying') {
        this.bus.emit('borrow:repaid', {});
        this.audio.play('repaid');
      }
    }
    this.lastPhase = phase;
  }

  private updateLens(dt: number, flow: number, phase: BorrowPhase): void {
    const p = this.postfx;
    p.flow += (flow - p.flow) * damp(10, dt);
    const neg = phase === 'borrowing' ? 1 : 0;
    p.negative = clamp(p.negative + Math.sign(neg - p.negative) * dt * 5.5, 0, 1);
    p.repay += ((phase === 'repaying' ? 1 : 0) - p.repay) * damp(8, dt);
  }

  private updateTableau(rawDt: number): void {
    // The last figure has fallen: let the room hang for a moment, almost still.
    this.time.hold(rawDt, 0.035);
    const time = this.time;
    if (this.level) this.level.update(time);
    this.director.update();
    this.projectiles.update();
    this.thrown.update();
    this.fx.update(time.unscaledDt, time.scaledDt, time.worldElapsed);
    this.recorder.sample();
    this.syncGlobals(time.worldElapsed);
    this.drawWorld();
    this.audio.setTimeScale(0.03);
    this.updateLens(time.unscaledDt, 0, 'idle');
    this.tableauTimer -= rawDt;
    if (this.tableauTimer <= 0) this.startReplay();
  }

  private updateReplay(rawDt: number): void {
    const dt = Math.min(rawDt, 0.1);
    const stage = this.stage;
    if (this.stampTimer > 0) {
      this.stampTimer -= dt;
      if (this.stampTimer <= 0) this.hud.stamp(null);
    }
    if (!stage) return;

    const before = stage.worldTime;
    stage.update(dt);
    this.fx.update(dt, Math.max(0, stage.worldTime - before), stage.worldTime);
    this.syncGlobals(stage.worldTime);
    this.fx.streaks.begin();
    stage.draw();
    this.fx.draw();
    this.fx.streaks.end();

    this.audio.setListener(this.camera.position, new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion));
    this.audio.setTimeScale(clamp(stage.paused ? 0.05 : stage.rate, 0, 1), stage.phase === 'borrowing');
    this.updateLens(dt, stage.paused ? 0 : clamp(stage.rate, 0, 1), stage.phase);
    this.menu.updateReplay(stage.progress, stage.shotLabel, stage.paused ? 'held' : stage.outroT > 0 ? 'developed' : 'developing');

    if (stage.outroT > 0.7 && !this.resultsShown) this.showResults();
  }

  private updateDead(rawDt: number): void {
    const dt = Math.min(rawDt, 0.1);
    this.deadTimer += dt;
    this.postfx.death = Math.min(1, this.deadTimer / 0.35);
    this.postfx.negative = Math.max(0, this.postfx.negative - dt * 4);
    this.postfx.repay = Math.max(0, this.postfx.repay - dt * 4);
    // The world stays exactly where it stopped; only light pulses finish decaying.
    this.fx.update(dt, 0, this.time.worldElapsed);
    this.fx.streaks.begin();
    this.fx.bullets.draw(this.projectiles.fillVisuals(this.visuals), this.fx.streaks, 0, this.time.worldElapsed);
    this.fx.draw();
    this.fx.streaks.end();
    this.hud.idle(dt);
    this.audio.setTimeScale(0.02);
    if (this.deadTimer > 0.3 && (this.input.pressed('restart') || this.input.pressed('fire') || this.input.pressed('jump'))) {
      this.retryLevel();
    }
  }

  // ---- test / tooling hooks ---------------------------------------------

  /** Jump straight into a plate, skipping the menus (tests, autoplayer). */
  debugStart(index: number): void {
    this.menu.hide();
    this.menu.hidePause();
    this.menu.hideResults();
    this.menu.hideReplay();
    this.customDef = null;
    this.levelIndex = index;
    this.attempts = 0;
    this.loadLevel(index);
    this.startPlaying();
  }

  /** Start an arbitrary plate definition (tests build small scenarios this way). */
  debugStartDef(def: LevelDef): void {
    this.menu.hide();
    this.menu.hidePause();
    this.menu.hideResults();
    this.menu.hideReplay();
    this.customDef = def;
    this.levelIndex = 0;
    this.attempts = 3; // no tutorial hints
    this.loadLevel(0, def);
    this.startPlaying();
  }

  /** Step `frames` frames of `dt` seconds without waiting for the display. */
  debugStep(dt: number, frames = 1, render = false): void {
    for (let i = 0; i < frames; i++) this.tick(dt, render && i === frames - 1);
  }

  /** A snapshot of internal state for assertions. */
  debugInfo(): Record<string, unknown> {
    const info = this.renderer.info;
    return {
      state: this.state,
      level: this.levelIndex,
      world: this.time.worldElapsed,
      real: this.time.realElapsed,
      scale: this.time.scale,
      spend: this.time.spend,
      borrow: this.time.borrowPhase,
      debt: this.time.debt,
      alive: this.player.alive,
      pos: [this.player.pos.x, this.player.pos.y, this.player.pos.z],
      yaw: this.player.yaw,
      held: this.player.heldKind,
      ammo: this.player.heldAmmo,
      enemies: this.director.enemies.length,
      remaining: this.director.remainingTotal(),
      projectiles: this.projectiles.active.length,
      thrown: this.thrown.objects.length,
      items: this.level ? this.level.items.length : 0,
      bursts: this.fx.shards.burstCount,
      shardTris: this.fx.shards.triangleCount,
      sparks: this.fx.sparkCount,
      streaks: this.fx.streaks.instanceCount,
      recFrames: this.recorder.frameCount,
      recEvents: this.recorder.eventCount,
      replay: this.stage
        ? { tau: this.stage.tau, duration: this.stage.duration, outro: this.stage.outroT, shot: this.stage.shotLabel, shots: this.stage.edit.shots.length, kills: this.stage.edit.kills.length }
        : null,
      results: this.resultsShown,
      stats: { ...this.player.stats },
      gl: { geometries: info.memory.geometries, textures: info.memory.textures, calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0 },
      cpuMs: this.perf.cpuMs,
    };
  }

  /** The last finished recording (tests inspect it for fidelity). */
  get lastRecording(): Recording | null {
    return this.recording;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.postfx.dispose();
    this.renderer.dispose();
  }
}
