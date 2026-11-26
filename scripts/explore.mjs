import { launch, openGame, serve, shot } from './harness.mjs';
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-Stillshot/4fbeb417-558b-5f5a-ac04-d8d76d389b99/scratchpad/s/';
const level = Number(process.argv[2] ?? 0);
const server = await serve();
const browser = await launch();
const { page, errors } = await openGame(browser, server.url);
await shot(page, OUT + 'title.png');
const info = await page.evaluate((level) => {
  const g = window.__stillshot;
  g.debugStart(level);
  g.debugStep(1 / 60, 3);
  // walk forward for half a second
  g.input.setAction('forward', true);
  g.debugStep(1 / 60, 40);
  g.input.setAction('forward', false);
  g.debugStep(1 / 60, 30);
  return g.debugInfo();
}, level);
console.log(JSON.stringify(info));
await shot(page, OUT + `play${level}.png`);
console.log('errors:', errors.slice(0, 12));
await browser.close();
await server.close();
