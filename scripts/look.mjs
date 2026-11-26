import { launch, openGame, serve, shot } from './harness.mjs';
const OUT = '/tmp/claude-0/-home-user-Stillshot/4fbeb417-558b-5f5a-ac04-d8d76d389b99/scratchpad/s/';
const which = new Set(process.argv.slice(2));
const want = (k) => which.size === 0 || which.has(k);
const server = await serve();
const browser = await launch();
const { page, errors } = await openGame(browser, server.url);
const ev = (fn, arg) => page.evaluate(fn, arg);
const step = (n, dt = 1 / 60) => ev(({ n, dt }) => window.__stillshot.debugStep(dt, n), { n, dt });
const look = (dx, dy) => ev(({ dx, dy }) => { const g = window.__stillshot; g.input.addLook(dx, dy); g.debugStep(1 / 60, 1); }, { dx, dy });
const key = (a, on) => ev(({ a, on }) => window.__stillshot.input.setAction(a, on), { a, on });
const tap = (a) => ev((a) => { const g = window.__stillshot; g.input.tap(a); g.debugStep(1 / 60, 1); }, a);
const start = async (i) => { await ev((i) => { const g = window.__stillshot; g.debugStart(i); g.player.invulnerable = true; }, i); await step(2); };

if (want('volley')) {
  await start(4);
  await step(20);
  await shot(page, OUT + 'L_volley.png');
  await tap('borrow');
  await key('forward', true); await step(40); await key('forward', false);
  await shot(page, OUT + 'L_negative.png');
  await key('forward', true); await step(45); await key('forward', false);
  await look(1400, 0); await step(3);
  await shot(page, OUT + 'L_negative2.png');
  await tap('borrow'); await step(8);
  await shot(page, OUT + 'L_repay.png');
}
if (want('fields')) {
  await start(5);
  await key('forward', true); await step(50); await key('forward', false); await step(30);
  await shot(page, OUT + 'L_fields.png');
  await key('forward', true); await step(80); await key('forward', false); await look(-500, 0); await step(20);
  await shot(page, OUT + 'L_fields2.png');
}
if (want('slab')) {
  await start(6);
  await key('forward', true); await step(120); await key('forward', false); await step(40);
  await shot(page, OUT + 'L_slab.png');
}
if (want('glass')) {
  await start(1);
  await key('forward', true); await step(20); await key('forward', false); await step(30);
  await shot(page, OUT + 'L_glass.png');
}
if (want('window')) {
  await start(3);
  await step(30);
  await shot(page, OUT + 'L_window.png');
}
if (want('long')) {
  await start(7);
  await key('forward', true); await step(30); await key('forward', false); await step(30);
  await shot(page, OUT + 'L_long.png');
}
if (want('ui')) {
  await ev(() => window.__stillshot.toMenu());
  await page.click('.plate');
  await page.waitForTimeout(200);
  await shot(page, OUT + 'L_briefing.png');
  await ev(() => window.__stillshot.toMenu());
  await page.click('.title-head .btn');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + 'L_settings.png' });
}
console.log('errors:', errors.slice(0, 10));
await browser.close();
await server.close();
