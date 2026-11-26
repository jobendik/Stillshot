// Dev tool: play a plate with the bot, then capture one frame from each kind of replay shot.
import { mkdirSync } from 'node:fs';
import { launch, openGame, serve, shot } from './harness.mjs';
import { playPlate } from './bot.mjs';
const OUT = process.env.OUT || 'docs/review/';
mkdirSync(OUT, { recursive: true });
const level = Number(process.argv[2] ?? 2);
const server = await serve();
const browser = await launch();
const { page, errors } = await openGame(browser, server.url);
const info = await playPlate(page, level, { maxSeconds: 300 });
console.log('end', info.state, info.world.toFixed(2), JSON.stringify(info.stats));
const shots = await page.evaluate(() => {
  const g = window.__stillshot;
  for (let i = 0; i < 300 && g.state !== 'replay'; i++) g.debugStep(1 / 60, 1);
  return g.stage.edit.shots.map((s) => ({ type: s.type, t0: s.t0, t1: s.t1 }));
});
console.log(shots.map((s) => `${s.type}[${s.t0.toFixed(2)}-${s.t1.toFixed(2)}]`).join(' '));
const seen = new Map();
for (const s of shots) {
  const n = seen.get(s.type) ?? 0;
  if (n >= 2) continue;
  seen.set(s.type, n + 1);
  // Seek a little before the point of interest and play into it so cameras settle.
  const target = s.type === 'round' ? s.t0 + (s.t1 - s.t0) * 0.45 : s.type === 'impact' ? Math.max(s.t0, s.t1 - 0.42) : (s.t0 + s.t1) / 2;
  await page.evaluate(({ t, t0 }) => {
    const g = window.__stillshot;
    g.stage.seek(Math.max(t0, t - 0.25));
    let guard = 0;
    while (g.stage.tau < t && guard++ < 400) g.debugStep(1 / 60, 1);
  }, { t: target, t0: s.t0 });
  await shot(page, OUT + `replay${level}_${s.type}${n}.png`);
}
console.log('errors:', errors.slice(0, 10));
await browser.close();
await server.close();
