// Prints the peak level (dBFS) of every synthesized sound, rendered offline, at
// full-speed time and at stillness. Used to balance the mix by measurement.
//   npm run build && node scripts/mix.mjs
import { launch, openGame, serve } from './harness.mjs';
const server = await serve();
const browser = await launch();
const { page } = await openGame(browser, server.url);
const out = await page.evaluate(async () => {
  const Engine = window.__stillshot.audio.constructor;
  const RealCtx = window.AudioContext;
  const render = async (seconds, setup) => {
    let made = null;
    window.AudioContext = function () { made = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100); Object.defineProperty(made, 'state', { get: () => 'running' }); return made; };
    const engine = new Engine(); engine.resume(); window.AudioContext = RealCtx;
    setup(engine);
    const buf = await made.startRendering();
    const l = buf.getChannelData(0);
    let peak = 0, sum = 0;
    for (let i = 0; i < l.length; i++) { peak = Math.max(peak, Math.abs(l[i])); sum += l[i] * l[i]; }
    return [+(20 * Math.log10(peak + 1e-9)).toFixed(1), +(20 * Math.log10(Math.sqrt(sum / l.length) + 1e-9)).toFixed(1)];
  };
  const names = ['shoot', 'shotgun', 'nail', 'glass', 'impact', 'shatter', 'slice', 'slash', 'deflect', 'ricochet', 'throw', 'thud', 'punch', 'pickup', 'catch', 'dryfire', 'swing', 'windup', 'hotswitch', 'death', 'ui', 'whiz', 'tick', 'arrive', 'borrow', 'collect', 'repaid', 'chime', 'complete'];
  const res = {};
  for (const n of names) {
    const flow = await render(3.5, (e) => { e.setTimeScale(1); e.timeFilter.frequency.cancelScheduledValues(0); e.timeFilter.frequency.value = 18000; e.play(n, null, 1.0); });
    const still = await render(3.5, (e) => { e.setTimeScale(0.005); e.timeFilter.frequency.cancelScheduledValues(0); e.timeFilter.frequency.value = 700; e.play(n, null, 1.0); });
    res[n] = { flowPeak: flow[0], stillPeak: still[0] };
  }
  const amb = await render(3, (e) => { e.setTimeScale(1); e.startAmbient(55); });
  res.ambient = { flowPeak: amb[0], rms: amb[1] };
  return res;
});
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(10), JSON.stringify(v));
await browser.close(); await server.close();
