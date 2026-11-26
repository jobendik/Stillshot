// Shared tooling for the STILLSHOT test & capture scripts.
//
// The game exposes `window.__stillshot` (see src/main.ts). Setting
// `game.manual = true` stops the display loop from advancing the simulation, and
// `game.debugStep(dt, frames, render)` then advances it by exact, repeatable
// steps — so a test decides the frame rate, not the machine it runs on.
import { chromium } from 'playwright';
import { preview } from 'vite';

export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'];

/** Serve the production build (run `npm run build` first). Returns { url, close }. */
export async function serve(port = 4173) {
  if (process.env.STILLSHOT_URL) return { url: process.env.STILLSHOT_URL, close: async () => {} };
  const server = await preview({ preview: { port, strictPort: false, open: false, host: '127.0.0.1' }, logLevel: 'silent' });
  const address = server.httpServer.address();
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise((r) => server.httpServer.close(r)) };
}

export async function launch() {
  // CHROME_EXE lets you point at any Chromium/Chrome build; otherwise Playwright's own is used.
  return chromium.launch({ headless: true, executablePath: process.env.CHROME_EXE || undefined, args: GL_ARGS });
}

/** Open the game, dismiss the splash, and take manual control of the clock. */
export async function openGame(browser, url, { width = 1280, height = 720, storage = null } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  if (storage) await page.addInitScript((s) => localStorage.setItem('stillshot.v2', s), JSON.stringify(storage));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__stillshot, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  await page.mouse.click(width / 2, height / 2); // splash → archive
  await page.waitForSelector('.plates', { timeout: 10000 });
  await page.evaluate(() => {
    window.__stillshot.manual = true;
  });
  return { page, errors };
}

/** Render the current state and save a screenshot. */
export async function shot(page, path) {
  await page.evaluate(() => window.__stillshot.debugStep(0, 1, true));
  await page.screenshot({ path, timeout: 90000 });
}
