// Regenerates the screenshots in docs/after/ from the current build.
//
//   npm run build && npm run capture            everything
//   node scripts/capture.mjs ui plates          only the named sets
//
// Scenes are staged by driving the real game through its test hooks; nothing is
// composited or retouched. (Headless runs use a software rasteriser, so these
// are what the renderer outputs, not a measure of how fast it does so.)
import { mkdirSync } from 'node:fs';
import { launch, openGame, serve, shot } from './harness.mjs';
import { playPlate } from './bot.mjs';

const OUT = process.env.OUT || 'docs/after/';
mkdirSync(OUT, { recursive: true });
const which = new Set(process.argv.slice(2));
const want = (k) => which.size === 0 || which.has(k);

const room = (over = {}) => ({
  id: 'test', name: 'TEST', briefing: '', bounds: { minX: -9, maxX: 9, minZ: -12, maxZ: 6 }, floorY: 0, spawn: { pos: [0, 0, 0], yaw: 0 },
  colliders: [
    { pos: [0, 3, -12.4], size: [19.6, 6, 0.8], kind: 'wall' }, { pos: [-9.4, 3, -3], size: [0.8, 6, 19], kind: 'wall' },
    { pos: [9.4, 3, -3], size: [0.8, 6, 19], kind: 'wall' }, { pos: [0, 3, 6.4], size: [19.6, 6, 0.8], kind: 'wall' },
  ],
  glass: [], weapons: [], throwables: [], waves: [], abilities: { hotswitch: true, borrow: true }, par: 10, ...over,
});

const server = await serve();
const browser = await launch();
const { page, errors } = await openGame(browser, server.url);
const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(() => {
  const g = window.__stillshot;
  const V = g.player.pos.constructor;
  window.T = {
    start(def) { g.debugStartDef(def); g.player.invulnerable = true; g.debugStep(1 / 60, 2); g.hud.hideBanner(); },
    plate(i) { g.debugStart(i); g.player.invulnerable = true; g.debugStep(1 / 60, 2); },
    flow(w) { const t = g.time.worldElapsed + w; let i = 0; while (g.time.worldElapsed < t && i++ < 4000) { g.time.spendAction(Math.min(0.02, t - g.time.worldElapsed)); g.debugStep(1 / 60, 1); } },
    still(s) { g.debugStep(1 / 60, Math.round(s * 60)); },
    walk(s) { g.input.setAction('forward', true); g.debugStep(1 / 60, Math.round(s * 60)); g.input.setAction('forward', false); },
    face(x, y, z) { const p = g.player; p.yaw = Math.atan2(-(x - p.pos.x), -(z - p.pos.z)); p.pitch = Math.atan2(y - (p.pos.y + 1.62), Math.hypot(x - p.pos.x, z - p.pos.z)); g.debugStep(1 / 60, 1); },
    bullet(from, dir, opts = {}) { return g.projectiles.spawn(new V(...from), new V(...dir), { faction: 'enemy', speed: 30, piercing: false, glass: 'stop', deflectable: true, look: 'bullet', ...opts }); },
  };
});

if (want('ui')) {
  await page.screenshot({ path: OUT + '01_archive.png' });
  await page.click('.plate');
  await page.waitForTimeout(200);
  await shot(page, OUT + '02_briefing.png');
  await ev(() => window.__stillshot.toMenu());
}

if (want('plates')) {
  await ev(() => { T.plate(0); T.walk(0.5); T.still(2.6); });
  await shot(page, OUT + '03_first_light.png');
  await ev(() => { T.plate(1); T.walk(0.3); T.still(2.6); });
  await shot(page, OUT + '04_glass_house.png');
  await ev(() => { T.plate(4); T.still(2.6); });
  await shot(page, OUT + '05_volley.png');
  await ev(() => { const g = window.__stillshot; g.input.tap('borrow'); T.walk(0.7); });
  await shot(page, OUT + '06_negative.png');
  await ev(() => { T.plate(5); T.walk(0.9); T.still(2.6); });
  await shot(page, OUT + '07_time_fields.png');
  await ev(() => { T.plate(7); T.walk(0.4); T.still(2.6); });
  await shot(page, OUT + '08_long_exposure.png');
}

if (want('systems')) {
  await ev((def) => { T.start(def); T.flow(1.6); T.still(1.2); T.face(0, 1.25, -4); }, room({ waves: [{ trigger: 'start', enemies: [
    { pos: [-2.2, 0, -4.2], weapon: 'pistol', yaw: Math.PI }, { pos: [0, 0, -4.6], kind: 'constant', weapon: 'rifle', yaw: Math.PI }, { pos: [2.4, 0, -4.2], kind: 'bulwark', weapon: 'pistol', yaw: Math.PI }] }] }));
  await shot(page, OUT + '09_figures.png');

  await ev((def) => { T.start(def); T.flow(1.22); T.still(1.0); T.face(0, 1.3, -8); }, room({ waves: [{ trigger: 'start', enemies: [
    { pos: [-3, 0, -9], weapon: 'pistol', yaw: Math.PI }, { pos: [0.5, 0, -10], weapon: 'rifle', yaw: Math.PI }, { pos: [3.5, 0, -8], weapon: 'shotgun', yaw: Math.PI }] }] }));
  await shot(page, OUT + '10_rounds_in_the_air.png');

  await ev((def) => {
    const g = window.__stillshot;
    T.start(def); T.flow(1.0);
    for (const e of g.director.enemies.slice(0, 2)) T.bullet([e.pos.x + 2.5, 1.25, e.pos.z + 1.5], [-0.857, 0, -0.514], { faction: 'player', speed: 40 });
    T.flow(0.16); T.still(1.0); T.face(0, 1.1, -4);
  }, room({ waves: [{ trigger: 'start', enemies: [{ pos: [-1.2, 0, -3.6], weapon: 'pistol', yaw: Math.PI }, { pos: [1.4, 0, -4.4], yaw: Math.PI }, { pos: [8, 0, 5], yaw: 0 }] }] }));
  await shot(page, OUT + '11_fracture_suspended.png');

  await ev((def) => { const g = window.__stillshot; T.start(def); g.input.tap('use'); g.debugStep(1 / 60, 30); }, room({ weapons: [{ kind: 'katana', pos: [0, 0.3, -0.6] }] }));
  await shot(page, OUT + '12_blade.png');
}

if (want('replay')) {
  // A long shot, so the edit includes a ride behind the round.
  const shots = await ev((def) => {
    const g = window.__stillshot;
    T.start(def); g.input.tap('use'); g.debugStep(1 / 60, 3); T.flow(0.9);
    const e = g.director.enemies[0];
    T.face(e.pos.x, 1.15, e.pos.z);
    g.input.tap('fire'); g.debugStep(1 / 60, 1); T.flow(0.9);
    for (let i = 0; i < 600 && g.state !== 'replay'; i++) g.debugStep(1 / 60, 1);
    return g.stage ? g.stage.edit.shots.map((s) => ({ type: s.type, t0: s.t0, t1: s.t1 })) : [];
  }, room({ bounds: { minX: -9, maxX: 9, minZ: -22, maxZ: 6 }, colliders: [{ pos: [0, 3, -22.4], size: [19.6, 6, 0.8], kind: 'wall' }, { pos: [-9.4, 3, -8], size: [0.8, 6, 29], kind: 'wall' }, { pos: [9.4, 3, -8], size: [0.8, 6, 29], kind: 'wall' }, { pos: [0, 3, 6.4], size: [19.6, 6, 0.8], kind: 'wall' }],
    weapons: [{ kind: 'pistol', pos: [0, 0.3, -0.6] }], waves: [{ trigger: 'start', enemies: [{ pos: [1.5, 0, -19], weapon: 'pistol', yaw: Math.PI }] }] }));
  const r = shots.find((s) => s.type === 'round');
  if (r) {
    await ev(({ t, t0 }) => { const g = window.__stillshot; g.stage.seek(t0); let n = 0; while (g.stage.tau < t && n++ < 900) g.debugStep(1 / 60, 1); }, { t: r.t0 + (r.t1 - r.t0) * 0.93, t0: r.t0 });
    await shot(page, OUT + '13_replay_round.png');
  }

  // A full plate played by the autoplayer, then its film.
  const info = await playPlate(page, 2, { maxSeconds: 300 });
  console.log('plate 03 by autoplayer:', info.state, info.world.toFixed(2) + 's');
  await ev(() => { const g = window.__stillshot; g.debugStep(1 / 60, 30); });
  await shot(page, OUT + '14_still.png');
  const edit = await ev(() => { const g = window.__stillshot; for (let i = 0; i < 300 && g.state !== 'replay'; i++) g.debugStep(1 / 60, 1); return g.stage.edit.shots.map((s) => ({ type: s.type, t0: s.t0, t1: s.t1 })); });
  console.log(edit.map((s) => `${s.type}[${s.t0.toFixed(1)}-${s.t1.toFixed(1)}]`).join(' '));
  const pick = { chase: '15_replay_pursuit.png', wide: '16_replay_witness.png', fp: '17_replay_first_person.png' };
  const done = new Set();
  for (const s of edit.slice(2)) {
    if (!pick[s.type] || done.has(s.type)) continue;
    done.add(s.type);
    await ev(({ t, t0 }) => { const g = window.__stillshot; g.stage.seek(Math.max(t0, t - 0.3)); let n = 0; while (g.stage.tau < t && n++ < 400) g.debugStep(1 / 60, 1); }, { t: Math.max(s.t0 + 0.1, s.t1 - 0.45), t0: s.t0 });
    await shot(page, OUT + pick[s.type]);
  }
  await ev(() => { const g = window.__stillshot; g.onKey('Enter'); g.debugStep(1 / 60, 150); });
  await shot(page, OUT + '18_developed.png');
}

if (want('death')) {
  await ev((def) => { const g = window.__stillshot; T.start(def); g.player.invulnerable = false; T.flow(2.2); g.debugStep(1 / 60, 40); }, room({ waves: [{ trigger: 'start', enemies: [{ pos: [0, 0, -8], weapon: 'pistol', yaw: Math.PI }] }] }));
  await shot(page, OUT + '19_overexposed.png');
}

console.log('errors:', errors.slice(0, 10));
await browser.close();
await server.close();
