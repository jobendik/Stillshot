/**
 * Keyboard + pointer-lock mouse input. Exposes high-level actions, edge-detected
 * "pressed this frame" queries, and the accumulated mouse delta that both the
 * camera and the time controller consume each frame.
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
};

export class InputManager {
  private down = new Set<Action>();
  private pressedThisFrame = new Set<Action>();
  private mouseDownThisFrame = new Set<number>();

  mouseDX = 0;
  mouseDY = 0;
  /** Summed absolute pixels this frame — fed to the time controller. */
  mousePixels = 0;

  pointerLocked = false;
  enabled = false;

  /** Optional hook fired when the user clicks while not pointer-locked. */
  onRequestLock: (() => void) | null = null;

  private readonly canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mousedown', this.handleMouseDown);
    document.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    // Suppress the context menu so right-click can be used as throw if desired.
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestPointerLock(): void {
    this.canvas.requestPointerLock?.();
  }

  exitPointerLock(): void {
    document.exitPointerLock?.();
  }

  private handlePointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const action = KEY_MAP[e.code];
    if (!action) return;
    if (e.code === 'Space') e.preventDefault();
    if (!this.down.has(action)) this.pressedThisFrame.add(action);
    this.down.add(action);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    const action = KEY_MAP[e.code];
    if (!action) return;
    this.down.delete(action);
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || !this.enabled) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
    this.mousePixels += Math.abs(e.movementX) + Math.abs(e.movementY);
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (!this.pointerLocked) {
      if (this.enabled) this.onRequestLock?.();
      return;
    }
    this.mouseDownThisFrame.add(e.button);
    if (e.button === 0) this.pressedThisFrame.add('fire');
    if (e.button === 2) this.pressedThisFrame.add('altFire');
    this.down.add(e.button === 0 ? 'fire' : e.button === 2 ? 'altFire' : 'fire');
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.down.delete('fire');
    if (e.button === 2) this.down.delete('altFire');
  };

  isDown(action: Action): boolean {
    return this.down.has(action);
  }

  pressed(action: Action): boolean {
    return this.pressedThisFrame.has(action);
  }

  /** Normalized move intent in local space (x = strafe, z = forward). */
  moveIntent(): { x: number; z: number; magnitude: number } {
    let x = 0;
    let z = 0;
    if (this.down.has('forward')) z -= 1;
    if (this.down.has('back')) z += 1;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('right')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 0) {
      x /= len;
      z /= len;
    }
    return { x, z, magnitude: len > 0 ? 1 : 0 };
  }

  /** Clear per-frame state. Call at the very end of each frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.mouseDownThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mousePixels = 0;
  }

  /** Drop all held state (used on death / state transitions). */
  releaseAll(): void {
    this.down.clear();
    this.pressedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mousePixels = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mouseup', this.handleMouseUp);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
  }
}
