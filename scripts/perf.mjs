// Performance probe. Plays the heaviest plate with the autoplayer and reports
// simulation cost, scene complexity and memory. Rendering here goes through a
// SOFTWARE rasteriser (SwiftShader) when run headless, so render times printed
// by this script say nothing about a real GPU — draw calls and triangle counts do.
import { launch, openGame, serve } from './harness.mjs';
import { botChunk } from './bot.mjs';

const level = Number(process.argv[2] ?? 7);
const server = await serve();
const browser = await launch();
const { page, errors } = await openGame(browser, server.url);

const heap = () => page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null));
const heap0 = await heap();

await page.evaluate((level) => {
  window.__bot = undefined;
  window.__stillshot.debugStart(level);
}, level);

const sim = [];
const peaks = { projectiles: 0, enemies: 0, bursts: 0, shardTris: 0, streaks: 0, sparks: 0, calls: 0, triangles: 0, recFrames: 0 };
let info;
for (let i = 0; i < 400; i++) {
  // Time 120 simulated frames (no rendering) with the high-resolution clock.
  const r = await page.evaluate(
    ({ args, fnSrc }) => {
      const fn = new Function('return ' + fnSrc)();
      const t0 = performance.now();
      const info = fn(args);
      return { ms: (performance.now() - t0) / args.frames, info };
    },
    { args: { frames: 120, dt: 1 / 60, god: true }, fnSrc: botChunk.toString() },
  );
  info = r.info;
  sim.push(r.ms);
  // Render one real frame to read draw-call statistics at this moment.
  const gl = await page.evaluate(() => {
    const g = window.__stillshot;
    g.debugStep(0, 1, true);
    return g.debugInfo().gl;
  });
  for (const k of ['projectiles', 'enemies', 'bursts', 'shardTris', 'streaks', 'sparks', 'recFrames']) peaks[k] = Math.max(peaks[k], info[k]);
  peaks.calls = Math.max(peaks.calls, gl.calls);
  peaks.triangles = Math.max(peaks.triangles, gl.triangles);
  if (info.state !== 'playing') break;
}
sim.sort((a, b) => a - b);
const avg = sim.reduce((a, b) => a + b, 0) / sim.length;

// Replay playback cost.
const replay = await page.evaluate(() => {
  const g = window.__stillshot;
  for (let i = 0; i < 300 && g.state !== 'replay'; i++) g.debugStep(1 / 60, 1);
  const t0 = performance.now();
  let frames = 0;
  while (!g.debugInfo().results && frames < 8000) {
    g.debugStep(1 / 60, 1);
    frames++;
  }
  const r = g.lastRecording;
  return { msPerFrame: (performance.now() - t0) / Math.max(1, frames), frames, recFrames: r.frames.length, recEvents: r.events.length, duration: r.duration, shots: g.stage.edit.shots.length };
});

// Software-rasterised frame time, for completeness only.
const render = await page.evaluate(() => {
  const g = window.__stillshot;
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) g.debugStep(1 / 60, 1, true);
  g.renderer.getContext().finish();
  return (performance.now() - t0) / 20;
});

const heap1 = await heap();
console.log(`plate ${level + 1}: ended ${info.state}, exposure ${info.world.toFixed(1)}s, ${info.stats.kills} figures`);
console.log(`simulation (CPU, no render): avg ${avg.toFixed(3)} ms/frame, median ${sim[sim.length >> 1].toFixed(3)}, worst 120-frame average ${sim[sim.length - 1].toFixed(3)}`);
console.log(`peaks: ${JSON.stringify(peaks)}`);
console.log(`replay: ${replay.msPerFrame.toFixed(3)} ms/frame CPU over ${replay.frames} frames; recording ${replay.recFrames} frames + ${replay.recEvents} events for ${replay.duration.toFixed(1)}s; ${replay.shots} shots`);
console.log(`render (SwiftShader software GL, 1280x720, NOT representative of a GPU): ${render.toFixed(1)} ms/frame`);
if (heap0 !== null) console.log(`JS heap: ${heap0.toFixed(1)} MB at menu → ${heap1.toFixed(1)} MB after plate + replay`);
console.log('errors:', errors.length);
await browser.close();
await server.close();
