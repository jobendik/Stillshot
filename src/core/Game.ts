import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GameState } from '@/types';
import { PALETTE } from '@/config/palette';
import { MIN_TIME_SCALE } from '@/config/constants';
import { GameContext, makeRng } from './Context';
import { EventBus } from './events';
import { TimeController } from './Time';
import { InputManager } from './Input';
import { Level } from '@/world/Level';
import { ProjectileSystem } from '@/combat/Projectile';
import { ThrownObjectSystem } from '@/combat/Throwable';
import { Player } from '@/player/Player';
import { Director } from '@/ai/Director';
import { FXSystem } from '@/fx/FX';
import { PostFX } from '@/fx/PostFX';
import { AudioEngine } from '@/audio/Audio';
import { ReplayRecorder } from '@/replay/Replay';
import { HUD } from '@/ui/HUD';
import { Menu } from '@/ui/Menu';
import { LEVELS, getLevel } from '@/world/levels';

/**
 * Top-level orchestrator: owns the renderer, the service context, the state
 * machine, and the single requestAnimationFrame loop. Drives the strict
 * separation that defines the whole game — player kinematics on UNSCALED time,
 * the entire world on SCALED time.
 */
export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly ctx = new GameContext();

  private readonly time = new TimeController();
  private readonly input: InputManager;
  private readonly bus = new EventBus();
  private readonly audio = new AudioEngine();
  private readonly fx: FXSystem;
  private readonly postfx: PostFX;
  private readonly projectiles: ProjectileSystem;
  private readonly thrown: ThrownObjectSystem;
  private readonly player: Player;
  private readonly director: Director;
  private readonly replay: ReplayRecorder;
  private readonly hud: HUD;
  private readonly menu: Menu;

  private state: GameState = GameState.Boot;
  private level: Level | null = null;
  private levelIndex = 0;
  private unlocked = 1;
  private lastTime = 0;
  private freezeTimer = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);
    this.scene.add(this.camera);
    this.scene.background = PALETTE.background.clone();
    this.scene.fog = new Fog(PALETTE.fog.getHex(), 26, 80);
    this.setupLights();

    this.input = new InputManager(canvas);
    this.fx = new FXSystem(this.scene);
    this.postfx = new PostFX(this.renderer);

    // Populate the context fields read by downstream constructors FIRST
    // (Player reads ctx.camera, HUD binds ctx.bus, etc.).
    this.ctx.scene = this.scene;
    this.ctx.camera = this.camera;
    this.ctx.time = this.time;
    this.ctx.input = this.input;
    this.ctx.bus = this.bus;
    this.ctx.audio = this.audio;
    this.ctx.fx = this.fx;
    this.ctx.rng = makeRng(0x5eed);

    this.projectiles = new ProjectileSystem(this.ctx);
    this.thrown = new ThrownObjectSystem(this.ctx);
    this.player = new Player(this.ctx);
    this.director = new Director(this.ctx);
    this.replay = new ReplayRecorder(this.ctx, uiRoot);
    this.hud = new HUD(this.ctx, uiRoot);

    // Now the runtime-only references.
    this.ctx.projectiles = this.projectiles;
    this.ctx.thrown = this.thrown;
    this.ctx.player = this.player;
    this.ctx.director = this.director;
    this.ctx.replay = this.replay;

    this.menu = new Menu(uiRoot, {
      levels: LEVELS,
      onPlay: (i) => this.beginLevel(i),
      isAudioOn: () => this.audio.enabled,
      isCrtOn: () => this.postfx.enabled,
      onToggleAudio: () => this.audio.setEnabled(!this.audio.enabled),
      onToggleCrt: () => (this.postfx.enabled = !this.postfx.enabled),
    });

    this.bindEvents();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.input.onRequestLock = () => this.onUnlockedClick();
  }

  // ---- setup ------------------------------------------------------------

  private setupLights(): void {
    this.scene.add(new AmbientLight(0xffffff, 0.55));
    const hemi = new HemisphereLight(0xffffff, 0xb9bcc4, 0.6);
    this.scene.add(hemi);
    const sun = new DirectionalLight(0xffffff, 1.25);
    sun.position.set(12, 24, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 28;
    sun.shadow.camera.bottom = -28;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
  }

  private bindEvents(): void {
    this.bus.on('player:died', () => {
      if (this.state !== GameState.Playing) return;
      this.state = GameState.Dead;
      this.input.exitPointerLock();
      this.input.enabled = false;
    });
    this.bus.on('level:complete', () => {
      if (this.state !== GameState.Playing) return;
      this.state = GameState.LevelComplete;
      this.freezeTimer = 0.9; // hang on the final frozen frame before the replay
      this.input.exitPointerLock();
      this.input.enabled = false;
    });
  }

  // ---- lifecycle --------------------------------------------------------

  start(): void {
    this.menu.showBoot(() => {
      this.audio.resume();
      this.audio.startAmbient();
      this.toMenu();
    });
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  private toMenu(): void {
    this.state = GameState.Menu;
    this.menu.setUnlocked(this.unlocked);
    this.menu.showTitle();
    this.input.enabled = false;
    this.teardownLevel();
  }

  private beginLevel(index: number): void {
    this.levelIndex = index;
    this.loadLevel(index);
    this.state = GameState.Briefing;
    this.menu.showBriefing(getLevel(index), index, () => {
      this.menu.hide();
      this.startPlaying();
    });
  }

  private loadLevel(index: number): void {
    this.teardownLevel();
    const def = getLevel(index);
    this.level = new Level(def);
    this.ctx.level = this.level;
    this.level.build(this.scene);
    this.director.start(def);
    this.player.spawnAt(new Vector3(...def.spawn.pos), def.spawn.yaw);
    this.projectiles.clear();
    this.thrown.clear();
    this.fx.clear();
    this.time.reset();
  }

  private teardownLevel(): void {
    this.director.clear();
    this.projectiles.clear();
    this.thrown.clear();
    this.fx.clear();
    this.replay.endPlayback();
    if (this.level) {
      this.level.dispose();
      this.level = null;
    }
  }

  private startPlaying(): void {
    this.state = GameState.Playing;
    this.input.enabled = true;
    this.input.releaseAll();
    this.audio.resume();
    this.replay.beginRecording();
    this.hud.reset();
    this.hud.setVisible(true);
    this.hud.showLevelTitle(getLevel(this.levelIndex).name);
    this.input.requestPointerLock();
  }

  private retryLevel(): void {
    this.hud.reset();
    this.loadLevel(this.levelIndex);
    this.startPlaying();
  }

  private completeLevelFlow(): void {
    this.unlocked = Math.max(this.unlocked, this.levelIndex + 2);
    this.hud.setVisible(false);
    if (this.levelIndex + 1 < LEVELS.length) {
      this.beginLevel(this.levelIndex + 1);
    } else {
      this.state = GameState.Win;
      this.menu.setUnlocked(this.unlocked);
      this.menu.showWin(() => this.toMenu());
    }
  }

  // ---- input plumbing ---------------------------------------------------

  private onUnlockedClick(): void {
    this.audio.resume();
    if (this.state === GameState.Dead) {
      this.retryLevel();
    } else if (this.state === GameState.Paused) {
      this.input.requestPointerLock();
    }
  }

  private onPointerLockChange = (): void => {
    const locked = document.pointerLockElement !== null;
    if (!locked && this.state === GameState.Playing) {
      this.state = GameState.Paused;
      this.hud.showBanner('PAUSED', 'click to resume', 0);
    } else if (locked && this.state === GameState.Paused) {
      this.state = GameState.Playing;
      this.input.enabled = true;
      this.hud.hideBanner();
    }
  };

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h);
  };

  // ---- main loop --------------------------------------------------------

  private frame = (now: number): void => {
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    requestAnimationFrame(this.frame);

    switch (this.state) {
      case GameState.Playing:
        this.updatePlaying(rawDt);
        break;
      case GameState.LevelComplete:
        this.updateLevelComplete(rawDt);
        break;
      case GameState.Replay:
        this.updateReplay(rawDt);
        break;
      case GameState.Dead:
        if (this.input.pressed('restart')) this.retryLevel();
        this.fx.update(rawDt, 0);
        break;
      default:
        // Boot / Menu / Briefing / Paused / Win: keep the scene gently alive.
        this.fx.update(rawDt, 0);
        break;
    }

    this.input.endFrame();
    this.postfx.render(this.scene, this.camera, rawDt);
  };

  private updatePlaying(rawDt: number): void {
    const intent = this.input.moveIntent();
    this.time.update(rawDt, {
      moveMagnitude: intent.magnitude,
      mousePixels: this.input.mousePixels,
      jumpHeld: this.input.isDown('jump'),
      airborne: !this.player.grounded,
    });

    const u = this.time.unscaledDt;
    const w = this.time.scaledDt;

    this.player.update(u, w);
    if (this.level) this.level.update(w);
    this.director.update(w);
    this.projectiles.update(w);
    this.thrown.update(w);
    this.fx.update(u, w);

    this.audio.setTimeScale(this.time.scale);
    this.replay.sample();
    this.hud.update(rawDt);
  }

  private updateLevelComplete(rawDt: number): void {
    // Hold the frozen tableau briefly, then roll the replay.
    this.time.force(MIN_TIME_SCALE);
    this.fx.update(rawDt, this.time.scaledDt);
    this.audio.setTimeScale(MIN_TIME_SCALE);
    this.freezeTimer -= rawDt;
    if (this.freezeTimer <= 0) {
      this.projectiles.clear();
      this.director.clear();
      this.thrown.clear();
      this.fx.clear(); // remove leftover death shards so the montage shows only ghosts
      if (this.replay.beginPlayback()) {
        this.state = GameState.Replay;
        this.hud.setVisible(false); // the SUPER/HOT montage stands alone
        this.audio.setTimeScale(1);
      } else {
        this.completeLevelFlow();
      }
    }
  }

  private updateReplay(rawDt: number): void {
    const done = this.replay.update(rawDt);
    if (done) {
      this.replay.endPlayback();
      this.completeLevelFlow();
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.input.dispose();
    this.hud.dispose();
    this.postfx.dispose();
    this.renderer.dispose();
  }
}
