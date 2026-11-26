/**
 * Keyboard + pointer-lock mouse input. Exposes held actions, edge-detected
 * "pressed this frame" queries, and the mouse delta accumulated since the last
 * frame. Everything can also be driven programmatically (`setAction`, `tap`,
 * `addLook`) so the test harness and the autoplayer use the same path a human
 * does.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'fire'
  | 'altFire' // throw
  | 'melee'
  | 'use'
  | 'hotswitch'
  | 'borrow'
  | 'restart';

const KEY_MAP: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  KeyQ: 'altFire',
  KeyF: 'melee',
  KeyE: 'use',
  KeyR: 'restart',
  ShiftLeft: 'hotswitch',
  ShiftRight: 'hotswitch',
  KeyC: 'borrow',
  KeyV: 'borrow',
};

const MOUSE_MAP: Record<number, Action> = {
  0: 'fire',
  1: 'borrow',
  2: 'altFire',
};

export class InputManager {
  private down = new Set<Action>();
  private pressedThisFrame = new Set<Action>();

  /** Mouse delta in pixels accumulated since the last frame. */
  mouseDX = 0;
  mouseDY = 0;

  pointerLocked = false;
  /** When false, gameplay input is ignored (menus, death, replay). */
  enabled = false;

  /** Fired when the user clicks the canvas while it is not pointer-locked. */
  onRequestLock: (() => void) | null = null;
  /** Fired for any key press (used by menus / replay controls). */
  onAnyKey: ((code: string) => void) | null = null;

  private readonly canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleBlur);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('contextmenu', this.handleContextMenu);
  }

  requestPointerLock(): void {
    try {
      const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      // Browsers reject a re-lock attempted too soon after Esc; the game stays
      // paused and the next click simply tries again.
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* unsupported */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  private handlePointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) this.releaseAll();
  };

  private handleBlur = () => {
    // Never leave a key "stuck" when focus goes elsewhere.
    this.releaseAll();
  };

  private handleContextMenu = (e: Event) => {
    if (this.pointerLocked || e.target === this.canvas) e.preventDefault();
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!e.repeat) this.onAnyKey?.(e.code);
    const action = KEY_MAP[e.code];
    if (!action) return;
    if (this.enabled) {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    }
    if (e.repeat) return;
    if (!this.down.has(action)) this.pressedThisFrame.add(action);
    this.down.add(action);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    const action = KEY_MAP[e.code];
    if (action) this.down.delete(action);
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || !this.enabled) return;
    // Some browsers report a huge bogus delta on the first event after a lock
    // or a focus change; a single frame can never legitimately exceed this.
    if (Math.abs(e.movementX) > 2000 || Math.abs(e.movementY) > 2000) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (!this.pointerLocked) {
      if (this.enabled && e.target === this.canvas) this.onRequestLock?.();
      return;
    }
    const action = MOUSE_MAP[e.button];
    if (!action) return;
    if (e.button === 1) e.preventDefault();
    this.pressedThisFrame.add(action);
    this.down.add(action);
  };

  private handleMouseUp = (e: MouseEvent) => {
    const action = MOUSE_MAP[e.button];
    if (action) this.down.delete(action);
  };

  isDown(action: Action): boolean {
    return this.enabled && this.down.has(action);
  }

  pressed(action: Action): boolean {
    return this.enabled && this.pressedThisFrame.has(action);
  }

  /** Normalized move intent in local space (x = strafe, z = forward/back). */
  moveIntent(): { x: number; z: number; magnitude: number } {
    let x = 0;
    let z = 0;
    if (this.enabled) {
      if (this.down.has('forward')) z -= 1;
      if (this.down.has('back')) z += 1;
      if (this.down.has('left')) x -= 1;
      if (this.down.has('right')) x += 1;
    }
    const len = Math.hypot(x, z);
    if (len > 0) {
      x /= len;
      z /= len;
    }
    return { x, z, magnitude: len > 0 ? 1 : 0 };
  }

  // ---- programmatic input (tests, autoplayer) ---------------------------

  setAction(action: Action, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(action)) this.pressedThisFrame.add(action);
      this.down.add(action);
    } else {
      this.down.delete(action);
    }
  }

  tap(action: Action): void {
    this.pressedThisFrame.add(action);
  }

  addLook(dxPixels: number, dyPixels: number): void {
    this.mouseDX += dxPixels;
    this.mouseDY += dyPixels;
  }

  /** Clear per-frame state. Call at the very end of each frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  /** Drop all held state (focus loss, death, state transitions). */
  releaseAll(): void {
    this.down.clear();
    this.pressedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleBlur);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('contextmenu', this.handleContextMenu);
  }
}
