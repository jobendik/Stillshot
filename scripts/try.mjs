import { launch, openGame, serve, shot } from './harness.mjs';
import { playPlate } from './bot.mjs';
const OUT = '/tmp/claude-0/-home-user-Stillshot/4fbeb417-558b-5f5a-ac04-d8d76d389b99/scratchpad/s/';
const levels = process.argv.slice(2).map(Number);
const server = await serve();
const browser = await launch();
const { page, errors } = await openGame(browser, server.url);
for (const level of levels) {
  const t0 = Date.now();
  const info = await playPlate(page, level, { maxSeconds: 200 });
  const hits = await page.evaluate(() => window.__stillshot.player.hitsTaken);
  console.log(`plate ${level + 1}: state=${info.state} world=${info.world.toFixed(2)} real=${info.real.toFixed(1)} remaining=${info.remaining} hits=${hits} stats=${JSON.stringify(info.stats)} (${Date.now() - t0}ms)`);
  await shot(page, OUT + `end${level}.png`);
}
console.log('errors:', errors.slice(0, 10));
await browser.close();
await server.close();
