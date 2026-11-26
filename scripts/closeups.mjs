// Dev tool: close-up captures of individual systems for visual review.
import { launch, openGame, serve, shot } from './harness.mjs';
const OUT = process.env.OUT || 'docs/review/';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });
const which = new Set(process.argv.slice(2));
const want = (k) => which.size === 0 || which.has(k);
const sandbox = (over = {}) => ({ id: 'test', name: 'TEST', briefing: '', bounds: { minX: -9, maxX: 9, minZ: -12, maxZ: 6 }, floorY: 0, spawn: { pos: [0, 0, 0], yaw: 0 },
  colliders: [{ pos: [0, 3, -12.4], size: [19.6, 6, 0.8], kind: 'wall' }, { pos: [-9.4, 3, -3], size: [0.8, 6, 19], kind: 'wall' }, { pos: [9.4, 3, -3], size: [0.8, 6, 19], kind: 'wall' }, { pos: [0, 3, 6.4], size: [19.6, 6, 0.8], kind: 'wall' }],
  glass: [], weapons: [], throwables: [], waves: [], abilities: { hotswitch: true, borrow: true }, par: 10, ...over });
const server = await serve();
const browser = await launch();
const { page, errors } = await openGame(browser, server.url);
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => {
  const g = window.__stillshot;
  const V = g.player.pos.constructor;
  window.T = {
    V,
    start(def) { g.debugStartDef(def); g.player.invulnerable = true; g.debugStep(1 / 60, 2); g.hud.hideBanner(); },
    flow(w) { const t = g.time.worldElapsed + w; let i = 0; while (g.time.worldElapsed < t && i++ < 4000) { g.time.spendAction(Math.min(0.02, t - g.time.worldElapsed)); g.debugStep(1 / 60, 1); } },
    still(s) { g.debugStep(1 / 60, Math.round(s * 60)); },
    face(x, y, z) { const p = g.player; p.yaw = Math.atan2(-(x - p.pos.x), -(z - p.pos.z)); p.pitch = Math.atan2(y - (p.pos.y + 1.62), Math.hypot(x - p.pos.x, z - p.pos.z)); g.debugStep(1 / 60, 1); },
    bullet(from, dir, opts = {}) { return g.projectiles.spawn(new V(...from), new V(...dir), { faction: 'enemy', speed: 30, piercing: false, glass: 'stop', deflectable: true, look: 'bullet', ...opts }); },
  };
});

if (want('figures')) {
  await ev((def) => { T.start(def); T.flow(1.6); T.still(1.2); T.face(0, 1.25, -4); }, sandbox({ waves: [{ trigger: 'start', enemies: [
    { pos: [-2.2, 0, -4.2], weapon: 'pistol', yaw: Math.PI }, { pos: [0, 0, -4.6], kind: 'constant', weapon: 'rifle', yaw: Math.PI }, { pos: [2.4, 0, -4.2], kind: 'bulwark', weapon: 'pistol', yaw: Math.PI }] }] }));
  await shot(page, OUT + 'figures.png');
}
if (want('shatter')) {
  await ev((def) => {
    const g = window.__stillshot;
    T.start(def); T.flow(1.0);
    for (const e of g.director.enemies.slice(0, 2)) T.bullet([e.pos.x + 2.5, 1.25, e.pos.z + 1.5], [-0.857, 0, -0.514], { faction: 'player', speed: 40 });
    T.flow(0.16); T.still(1.0); T.face(0, 1.1, -4);
  }, sandbox({ waves: [{ trigger: 'start', enemies: [{ pos: [-1.2, 0, -3.6], weapon: 'pistol', yaw: Math.PI }, { pos: [1.4, 0, -4.4], yaw: Math.PI }, { pos: [8, 0, 5], yaw: 0 }] }] }));
  await shot(page, OUT + 'shatter_frozen.png');
  await ev(() => { T.flow(0.22); T.still(1.0); });
  await shot(page, OUT + 'shatter_later.png');
}
if (want('telegraph')) {
  await ev((def) => { const g = window.__stillshot; T.start(def); T.flow(1.22); T.still(1.0); T.face(0, 1.3, -8); }, sandbox({ waves: [{ trigger: 'start', enemies: [
    { pos: [-3, 0, -9], weapon: 'pistol', yaw: Math.PI }, { pos: [0.5, 0, -10], weapon: 'rifle', yaw: Math.PI }, { pos: [3.5, 0, -8], weapon: 'shotgun', yaw: Math.PI }] }] }));
  await shot(page, OUT + 'telegraph.png');
  await ev(() => { T.flow(0.16); T.still(1.2); });
  await shot(page, OUT + 'bullets_incoming.png');
}
if (want('weapons')) {
  for (const kind of ['pistol', 'rifle', 'shotgun', 'nailgun', 'katana', 'bat']) {
    await ev(({ def, kind }) => { const g = window.__stillshot; T.start(def); g.input.tap('use'); g.debugStep(1 / 60, 30); }, { def: sandbox({ weapons: [{ kind, pos: [0, 0.3, -0.6] }] }), kind });
    await shot(page, OUT + `hand_${kind}.png`);
  }
  await ev((def) => { const g = window.__stillshot; T.start(def); g.input.tap('use'); g.debugStep(1 / 60, 30); g.input.tap('fire'); g.debugStep(1 / 60, 7); }, sandbox({ weapons: [{ kind: 'katana', pos: [0, 0.3, -0.6] }] }));
  await shot(page, OUT + 'hand_katana_swing.png');
}
if (want('round')) {
  const shots = await ev((def) => {
    const g = window.__stillshot;
    T.start(def); g.input.tap('use'); g.debugStep(1 / 60, 3); T.flow(0.9);
    const e = g.director.enemies[0];
    T.face(e.pos.x, 1.15, e.pos.z);
    g.input.tap('fire');
    g.debugStep(1 / 60, 1);
    T.flow(0.9);
    for (let i = 0; i < 600 && g.state !== 'replay'; i++) g.debugStep(1 / 60, 1);
    return g.stage ? g.stage.edit.shots.map((s) => ({ type: s.type, t0: s.t0, t1: s.t1 })) : [];
  }, sandbox({ bounds: { minX: -9, maxX: 9, minZ: -22, maxZ: 6 }, colliders: [{ pos: [0, 3, -22.4], size: [19.6, 6, 0.8], kind: 'wall' }, { pos: [-9.4, 3, -8], size: [0.8, 6, 29], kind: 'wall' }, { pos: [9.4, 3, -8], size: [0.8, 6, 29], kind: 'wall' }, { pos: [0, 3, 6.4], size: [19.6, 6, 0.8], kind: 'wall' }],
    weapons: [{ kind: 'pistol', pos: [0, 0.3, -0.6] }], waves: [{ trigger: 'start', enemies: [{ pos: [1.5, 0, -19], weapon: 'pistol', yaw: Math.PI }] }] }));
  console.log(shots.map((s) => `${s.type}[${s.t0.toFixed(2)}-${s.t1.toFixed(2)}]`).join(' '));
  const r = shots.find((s) => s.type === 'round');
  if (r) {
    for (const [name, f] of [['a', 0.35], ['b', 0.62], ['c', 0.93]]) {
      await ev(({ t, t0 }) => { const g = window.__stillshot; g.stage.seek(t0); let n = 0; while (g.stage.tau < t && n++ < 900) g.debugStep(1 / 60, 1); }, { t: r.t0 + (r.t1 - r.t0) * f, t0: r.t0 });
      await shot(page, OUT + `round_${name}.png`);
    }
  }
}
if (want('death')) {
  await ev((def) => { const g = window.__stillshot; T.start(def); g.player.invulnerable = false; T.flow(1.6); T.bullet([3, 1.3, 4], [-0.6, 0, -0.8]); T.flow(0.4); g.debugStep(1 / 60, 40); }, sandbox({ waves: [{ trigger: 'start', enemies: [{ pos: [0, 0, -8], weapon: 'pistol', yaw: Math.PI }] }] }));
  await shot(page, OUT + 'death.png');
}
console.log('errors:', errors.slice(0, 10));
await browser.close();
await server.close();
