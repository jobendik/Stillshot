import './ui/styles.css';
import { Game } from '@/core/Game';

/**
 * Entry point. Boots the StillShot temporal engine once the DOM is ready.
 */
function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root') as HTMLElement | null;
  if (!canvas || !uiRoot) {
    throw new Error('StillShot: missing #scene canvas or #ui-root element.');
  }
  const game = new Game(canvas, uiRoot);
  game.start();
  // Expose for debugging in the console.
  (window as unknown as { __stillshot: Game }).__stillshot = game;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
