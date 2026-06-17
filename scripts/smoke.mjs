import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL ?? 'http://localhost:4173/';

const EXE =
  process.env.CHROME_EXE ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe`;

const browser = await chromium.launch({
  headless: true,
  executablePath: EXE,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const logs = [];
page.on('console', (msg) => {
  logs.push(`[${msg.type()}] ${msg.text()}`);
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

await page.goto(URL, { waitUntil: 'load', timeout: 20000 });

// Boot sequence types over ~1.5s then shows a continue prompt.
await page.waitForTimeout(2500);
const bootText = await page.evaluate(() => document.querySelector('.menu')?.textContent ?? '');
console.log('BOOT/menu present:', bootText.includes('SUPERHOT_TEAM') || bootText.includes('STILL'));

// Click to advance boot -> title.
await page.mouse.click(640, 360);
await page.waitForTimeout(800);
const titlePresent = await page.evaluate(() => !!document.querySelector('.title-screen'));
console.log('TITLE present:', titlePresent);

// Click first level (PLAY 01) -> briefing.
const clickInfo = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('.menu-item'));
  const first = items.find((b) => !b.disabled);
  first?.click();
  return { count: items.length, clickedText: first?.textContent ?? null };
});
console.log('menu-items:', clickInfo.count, 'clicked:', clickInfo.clickedText);
await page.waitForTimeout(500);
const briefingPresent = await page.evaluate(() => !!document.querySelector('.briefing'));
const menuSnap = await page.evaluate(() => (document.querySelector('.menu')?.textContent ?? '').slice(0, 120));
console.log('BRIEFING present:', briefingPresent, '| menu snap:', JSON.stringify(menuSnap));

// Click to insert consciousness -> playing.
await page.mouse.click(640, 360);
await page.waitForTimeout(500);

// Verify the game loop is running and the world is populated.
const running = await page.evaluate(() => !!window.__stillshot);
console.log('GAME instance exposed:', running);

// Exercise the play loop: move (advances time), look, and fire.
await page.keyboard.down('KeyW');
await page.mouse.move(700, 360);
await page.mouse.move(760, 360);
await page.waitForTimeout(250);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(150);
await page.keyboard.up('KeyW');
// Try a few abilities for coverage.
await page.keyboard.press('KeyQ'); // throw
await page.keyboard.press('KeyF'); // melee
await page.keyboard.press('ShiftLeft'); // hotswitch
await page.waitForTimeout(400);

await page.screenshot({ path: 'scripts/smoke-shot.png' });

await browser.close();

console.log('--- console (last 12) ---');
console.log(logs.slice(-12).join('\n'));
if (errors.length) {
  console.log('--- ERRORS (' + errors.length + ') ---');
  console.log(errors.join('\n'));
  process.exit(1);
}
console.log('SMOKE OK — no console/page errors.');
