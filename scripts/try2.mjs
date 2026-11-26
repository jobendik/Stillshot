import { launch, openGame, serve, shot } from './harness.mjs';
import { playPlate } from './bot.mjs';
const OUT = '/tmp/claude-0/-home-user-Stillshot/4fbeb417-558b-5f5a-ac04-d8d76d389b99/scratchpad/s/';
const level = Number(process.argv[2] ?? 0);
const server = await serve();
const browser = await launch();
const { page, errors } = await openGame(browser, server.url);
const info = await playPlate(page, level, { maxSeconds: 200 });
console.log('end', info.state, info.world.toFixed(2), JSON.stringify(info.stats));
await page.evaluate(() => window.__stillshot.debugStep(1 / 60, 30));
await shot(page, OUT + `r${level}_tableau.png`);
await page.evaluate(() => window.__stillshot.debugStep(1 / 60, 60));
let n = 0;
for (let i = 0; i < 400; i++) {
  const s = await page.evaluate(() => { const g = window.__stillshot; g.debugStep(1 / 60, 12); return g.debugInfo(); });
  if (!s.replay) { console.log('no replay', s.state); break; }
  if (i % 6 === 0 || s.results) { console.log(`tau=${s.replay.tau.toFixed(2)}/${s.replay.duration.toFixed(2)} shot=${s.replay.shot} outro=${s.replay.outro.toFixed(2)} bursts=${s.bursts} tris=${s.shardTris} results=${s.results}`); }
  if (i % 9 === 0 && n < 9) await shot(page, OUT + `r${level}_${n++}.png`);
  if (s.results) { await page.evaluate(() => window.__stillshot.debugStep(1 / 60, 90)); await shot(page, OUT + `r${level}_results.png`); break; }
}
const rec = await page.evaluate(() => { const r = window.__stillshot.lastRecording; const kinds = {}; for (const e of r.events) kinds[e.k] = (kinds[e.k] || 0) + 1; return { frames: r.frames.length, events: r.events.length, kinds, duration: r.duration, exposure: r.exposure, shots: window.__stillshot.stage.edit.shots.map(s => `${s.type}[${s.t0.toFixed(2)}-${s.t1.toFixed(2)}]`) }; });
console.log(JSON.stringify(rec));
console.log('errors:', errors.slice(0, 10));
await browser.close();
await server.close();
