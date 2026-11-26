// STILLSHOT regression suite.
//
//   npm test                 build, then run everything
//   node scripts/test.mjs time combat     run only groups whose name matches
//
// Every check here is an assertion: a failure exits non-zero. The game is
// stepped manually with exact frame deltas (see harness.mjs), so results do not
// depend on the speed of the machine or on the display's refresh rate.
import { launch, openGame, serve } from './harness.mjs';
import { playPlate } from './bot.mjs';

const filters = process.argv.slice(2);
const results = [];
let current = '';

function check(name, ok, detail = '') {
  results.push({ group: current, name, ok: !!ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
}

const sandbox = (over = {}) => ({
  id: 'test',
  name: 'TEST',
  briefing: '',
  bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
  floorY: 0,
  spawn: { pos: [0, 0, 0], yaw: 0 },
  colliders: [],
  glass: [],
  weapons: [],
  throwables: [],
  waves: [],
  abilities: { hotswitch: true, borrow: true },
  par: 10,
  ...over,
});

/** Helpers installed in the page once. */
function installHelpers() {
  const g = window.__stillshot;
  const V = g.player.pos.constructor;
  window.T = {
    V,
    start(def, god = true) {
      g.debugStartDef(def);
      g.player.invulnerable = god;
      g.player.hitsTaken = 0;
      g.debugStep(1 / 60, 2);
    },
    step(seconds, dt = 1 / 60, each) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) {
        if (each) each(i);
        g.debugStep(dt, 1);
      }
    },
    /** Let world time pass without moving: strafe left and right in place. */
    pass(worldSeconds) {
      const target = g.time.worldElapsed + worldSeconds;
      let i = 0;
      while (g.time.worldElapsed < target && i < 4000) {
        g.input.setAction('left', Math.floor(i / 8) % 2 === 0);
        g.input.setAction('right', Math.floor(i / 8) % 2 === 1);
        g.debugStep(1 / 60, 1);
        i++;
      }
      g.input.setAction('left', false);
      g.input.setAction('right', false);
    },
    /** Let world time pass without touching the controls (as if acting on the spot). */
    flow(worldSeconds) {
      const target = g.time.worldElapsed + worldSeconds;
      let i = 0;
      while (g.time.worldElapsed < target && i++ < 4000) {
        // Spend only what is still needed, so no time is left owing afterwards.
        g.time.spendAction(Math.min(0.02, target - g.time.worldElapsed));
        g.debugStep(1 / 60, 1);
      }
    },
    face(x, y, z) {
      const p = g.player;
      p.yaw = Math.atan2(-(x - p.pos.x), -(z - p.pos.z));
      p.pitch = Math.atan2(y - (p.pos.y + 1.62), Math.hypot(x - p.pos.x, z - p.pos.z));
      g.debugStep(1 / 60, 1);
    },
    bullet(from, dir, opts = {}) {
      return g.projectiles.spawn(new V(...from), new V(...dir), {
        faction: 'enemy',
        speed: 30,
        piercing: false,
        glass: 'stop',
        deflectable: true,
        look: 'bullet',
        ...opts,
      });
    },
  };
}

const groups = {
  // -------------------------------------------------------------------------
  async time(page) {
    // Equal physical mouse motion must cost equal world time at any frame rate.
    const sweep = (fps, bursty) =>
      page.evaluate(
        ({ def, fps, bursty }) => {
          const g = window.__stillshot;
          T.start(def);
          T.step(0.5, 1 / fps);
          const w0 = g.time.worldElapsed;
          const frames = Math.round(2 * fps);
          let carry = 0;
          for (let i = 0; i < frames; i++) {
            carry += 600 / fps; // 600 px/s
            // "bursty": the mouse reports on only one frame in `bursty`.
            if (!bursty || i % bursty === bursty - 1) {
              g.input.addLook(carry, 0);
              carry = 0;
            }
            g.debugStep(1 / fps, 1);
          }
          T.step(1.5, 1 / fps);
          return g.time.worldElapsed - w0;
        },
        { def: sandbox(), fps, bursty },
      );
    const fpsList = [30, 60, 120, 144, 240];
    const steady = [];
    for (const fps of fpsList) steady.push(await sweep(fps, 0));
    const spread = Math.max(...steady) / Math.min(...steady);
    check('look cost is frame-rate independent (30–240 fps)', spread < 1.06, `world s: ${steady.map((v) => v.toFixed(4)).join(', ')} (spread ×${spread.toFixed(3)})`);
    const bursty = [];
    // 240 fps display with a 120 Hz and an 80 Hz mouse; 144 fps with a 72 Hz mouse.
    for (const [fps, every] of [[240, 2], [240, 3], [144, 2]]) bursty.push(await sweep(fps, every));
    const all = steady.concat(bursty);
    const spread2 = Math.max(...all) / Math.min(...all);
    check('look cost is independent of mouse report rate', spread2 < 1.1, `bursty: ${bursty.map((v) => v.toFixed(4)).join(', ')} (overall ×${spread2.toFixed(3)})`);

    const tap = (fps) =>
      page.evaluate(
        ({ def, fps }) => {
          const g = window.__stillshot;
          T.start(def);
          T.step(0.5, 1 / fps);
          const w0 = g.time.worldElapsed;
          g.input.setAction('forward', true);
          T.step(0.25, 1 / fps);
          g.input.setAction('forward', false);
          T.step(1.5, 1 / fps);
          return g.time.worldElapsed - w0;
        },
        { def: sandbox(), fps },
      );
    const taps = [];
    for (const fps of fpsList) taps.push(await tap(fps));
    const tspread = Math.max(...taps) / Math.min(...taps);
    check('a 0.25s step costs the same at any frame rate', tspread < 1.08, `world s: ${taps.map((v) => v.toFixed(4)).join(', ')} (spread ×${tspread.toFixed(3)})`);

    const stall = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      T.step(0.5);
      const w0 = g.time.worldElapsed;
      g.input.addLook(6000, 0);
      g.debugStep(3.0, 1); // a three-second hitch with a huge accumulated mouse delta
      return g.time.worldElapsed - w0;
    }, sandbox());
    check('a stalled frame cannot leap the world forward', stall < 0.06, `advanced ${stall.toFixed(4)}s`);

    const idle = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      T.step(1);
      const w0 = g.time.worldElapsed;
      T.step(10);
      return (g.time.worldElapsed - w0) / 10;
    }, sandbox());
    check('standing still holds time at 1/200', Math.abs(idle - 0.005) < 0.0005, `rate ${idle.toFixed(5)}`);

    const hang = await page.evaluate((def) => {
      const g = window.__stillshot;
      const run = (hop) => {
        T.start(def);
        T.step(0.5);
        const w0 = g.time.worldElapsed;
        const z0 = g.player.pos.z;
        g.input.setAction('forward', true);
        for (let i = 0; i < 180; i++) {
          if (hop) {
            g.input.setAction('jump', true);
            if (g.player.grounded) g.input.tap('jump');
          }
          g.debugStep(1 / 60, 1);
        }
        g.input.releaseAll();
        T.step(1.5);
        return { world: g.time.worldElapsed - w0, dist: Math.abs(g.player.pos.z - z0) };
      };
      // One held jump: how slow does the world get at the top of the arc?
      T.start(def);
      g.input.setAction('forward', true);
      T.step(0.4);
      g.input.setAction('jump', true);
      g.input.tap('jump');
      T.step(0.45);
      const apexScale = g.time.scale;
      g.input.releaseAll();
      return { walk: run(false), hop: run(true), apexScale };
    }, sandbox());
    check('holding jump in the air slows the world', hang.apexScale < 0.3, `scale ${hang.apexScale.toFixed(3)} at the apex`);
    check('…but hopping everywhere is not a discount: hang time is repaid on landing', hang.hop.world > hang.walk.world * 0.8, `walking ${hang.walk.world.toFixed(2)}s, hopping ${hang.hop.world.toFixed(2)}s over ${hang.hop.dist.toFixed(1)}m`);

    const fire = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      g.input.tap('use');
      T.step(2);
      const out = { held: g.player.heldKind };
      const w0 = g.time.worldElapsed;
      g.input.tap('fire');
      T.step(1.5);
      out.oneShot = g.time.worldElapsed - w0;
      out.ammo1 = g.player.heldAmmo;
      // Second and third clicks in quick succession: each must still be paid for.
      const w1 = g.time.worldElapsed;
      g.input.tap('fire');
      T.step(0.6);
      g.input.tap('fire');
      T.step(2);
      out.twoShots = g.time.worldElapsed - w1;
      out.ammo3 = g.player.heldAmmo;
      return out;
    }, sandbox({ weapons: [{ kind: 'pistol', pos: [0, 0.3, -0.6] }] }));
    check('picking up works', fire.held === 'pistol', fire.held);
    check('a shot fired standing still spends time', fire.oneShot > 0.1 && fire.oneShot < 0.3 && fire.ammo1 === 4, `cost ${fire.oneShot.toFixed(3)}s, ammo ${fire.ammo1}`);
    check('a click on a cycling weapon commits: time is spent, then it fires', fire.ammo3 === 2 && fire.twoShots > 0.3, `cost ${fire.twoShots.toFixed(3)}s for two, ammo ${fire.ammo3}`);

    const borrow = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      T.step(0.5);
      const out = {};
      g.input.tap('borrow');
      g.debugStep(1 / 60, 1);
      const w0 = g.time.worldElapsed;
      const x0 = g.player.pos.z;
      g.input.setAction('forward', true);
      T.step(1.0);
      g.input.setAction('forward', false);
      out.phase1 = g.time.borrowPhase;
      out.worldDuringBorrow = g.time.worldElapsed - w0;
      out.moved = Math.abs(g.player.pos.z - x0);
      out.debt = g.time.debt;
      g.input.tap('borrow');
      g.debugStep(1 / 60, 1);
      out.phase2 = g.time.borrowPhase;
      const w1 = g.time.worldElapsed;
      T.step(2.5); // stand still while the world collects
      out.collected = g.time.worldElapsed - w1;
      out.phase3 = g.time.borrowPhase;
      out.canBorrowAgain = g.time.canBorrow;
      return out;
    }, sandbox());
    check('borrowing stops the world exactly', borrow.phase1 === 'borrowing' && borrow.worldDuringBorrow === 0, `world advanced ${borrow.worldDuringBorrow}`);
    check('the player still moves at full speed while borrowing', borrow.moved > 4, `moved ${borrow.moved.toFixed(2)}m in 1s`);
    check('the debt equals the time held', Math.abs(borrow.debt - 1.0) < 0.03, `debt ${borrow.debt.toFixed(3)}s`);
    check('the world collects what was borrowed (standing still)', borrow.phase2 === 'repaying' && Math.abs(borrow.collected - borrow.debt) < 0.12, `collected ${borrow.collected.toFixed(3)}s for ${borrow.debt.toFixed(3)}s`);
    check('borrowing has a cooldown', borrow.phase3 === 'idle' && borrow.canBorrowAgain === false);
  },

  // -------------------------------------------------------------------------
  async combat(page) {
    const tunnel = await page.evaluate((def) => {
      const g = window.__stillshot;
      const out = {};
      for (const dt of [1 / 20, 1 / 240]) {
        T.start(def);
        T.bullet([0, 1.2, -19], [0, 0, 1], { speed: 60 });
        // Full-speed time in very coarse or very fine steps.
        for (let i = 0; i < Math.round(1.2 / dt); i++) {
          g.time.spendAction(0.1);
          g.debugStep(dt, 1);
        }
        out[dt === 1 / 20 ? 'coarse' : 'fine'] = g.player.hitsTaken;
      }
      return out;
    }, sandbox());
    check('a fast round cannot tunnel through the player at 20 fps', tunnel.coarse === 1, `hits ${tunnel.coarse}`);
    check('…nor at 240 fps', tunnel.fine === 1, `hits ${tunnel.fine}`);

    const glass = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      T.bullet([0, 1.2, 2], [0, 0, -1], { faction: 'player', speed: 56 });
      g.debugStep(1 / 20, 1);
      g.input.setAction('left', true);
      T.step(0.5, 1 / 20);
      g.input.releaseAll();
      return { alive: g.level.glass[0].alive, bursts: g.fx.shards.burstCount };
    }, sandbox({ glass: [{ pos: [0, 1.5, -5], size: [6, 3, 0.06] }] }));
    check('a round breaks thin glass even at 20 fps', glass.alive === false && glass.bursts >= 1);

    const ff = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      const [a] = g.director.enemies;
      const causes = [];
      const off = g.bus.on('enemy:killed', (p) => causes.push(p.cause));
      T.bullet([a.pos.x + 0.6, 1.2, a.pos.z], [1, 0, 0], { ownerId: a.id });
      T.flow(0.4);
      off();
      return { causes, remaining: g.director.remainingTotal() };
    }, sandbox({ waves: [{ trigger: 'start', enemies: [{ pos: [-3, 0, -12], yaw: Math.PI }, { pos: [3, 0, -12], yaw: Math.PI }] }] }));
    check('a hostile round kills another hostile (friendly fire)', ff.causes[0] === 'friendly' && ff.remaining === 1, JSON.stringify(ff));

    const split = await page.evaluate((def) => {
      const g = window.__stillshot;
      const run = (swing) => {
        T.start(def);
        g.input.tap('use');
        g.debugStep(1 / 60, 2);
        T.bullet([0, 1.45, -4.5], [0, 0, 1]);
        if (swing) g.input.tap('fire');
        else T.flow(0.6);
        T.step(0.5);
        return {
          held: g.player.heldKind,
          hits: g.player.hitsTaken,
          splits: g.player.stats.splits,
          halves: g.projectiles.active.filter((p) => p.look === 'half' && p.faction === 'player').length,
        };
      };
      return { swing: run(true), noSwing: run(false) };
    }, sandbox({ weapons: [{ kind: 'katana', pos: [0, 0.3, -0.6] }] }));
    check('swinging a katana into a round splits it into two of yours', split.swing.hits === 0 && split.swing.splits === 1 && split.swing.halves === 2, JSON.stringify(split.swing));
    check('…and holding a katana without swinging protects nobody', split.noSwing.hits === 1 && split.noSwing.splits === 0, JSON.stringify(split.noSwing));

    const slab = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      T.pass(1.0);
      const e = g.director.enemies[0];
      T.bullet([0, 1.2, -2], [0, 0, -1], { faction: 'player' });
      T.pass(0.25);
      const afterBullet = { alive: e.alive, ricochets: g.projectiles.active.filter((p) => p.cause === 'ricochet').length + g.player.hitsTaken };
      T.bullet([0, 1.2, -2], [0, 0, -1], { faction: 'player', piercing: true, look: 'nail', speed: 56 });
      T.pass(0.3);
      return { afterBullet, afterNail: e.alive };
    }, sandbox({ waves: [{ trigger: 'start', enemies: [{ pos: [0, 0, -7], kind: 'bulwark', yaw: Math.PI }] }] }));
    check("a round fired at a slab's face is returned, not absorbed", slab.afterBullet.alive === true && slab.afterBullet.ricochets >= 1, JSON.stringify(slab.afterBullet));
    check('a piercing round goes through the slab', slab.afterNail === false);

    const disarm = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      g.input.tap('use');
      g.debugStep(1 / 60, 2);
      const out = { held: g.player.heldKind };
      T.pass(0.9);
      const e = g.director.enemies[0];
      T.face(e.pos.x, 1.1, e.pos.z);
      g.input.tap('altFire');
      g.debugStep(1 / 60, 1);
      out.thrown = g.thrown.objects.length;
      let sawAirborne = false;
      for (let i = 0; i < 400 && g.player.heldKind === 'fist'; i++) {
        const item = g.level.items.find((it) => it.kind === 'pistol' && !it.settled);
        if (item) {
          sawAirborne = true;
          T.face(item.pos.x, item.pos.y, item.pos.z);
          if (g.player.grabTarget(false)) g.input.tap('use');
        }
        g.input.setAction('left', i % 16 < 8);
        g.input.setAction('right', i % 16 >= 8);
        g.debugStep(1 / 60, 1);
      }
      g.input.releaseAll();
      out.enemyArmed = e.weapon !== null;
      out.sawAirborne = sawAirborne;
      out.nowHeld = g.player.heldKind;
      out.catches = g.player.stats.catches;
      out.ammo = g.player.heldAmmo;
      return out;
    }, sandbox({ throwables: [{ pos: [0, 0.14, -0.6] }], waves: [{ trigger: 'start', enemies: [{ pos: [0, 0, -6], weapon: 'pistol', yaw: Math.PI }] }] }));
    check('a thrown object disarms', disarm.held === 'orb' && disarm.thrown === 1 && disarm.enemyArmed === false, JSON.stringify(disarm));
    check('the weapon it knocks loose can be caught out of the air', disarm.sawAirborne && disarm.nowHeld === 'pistol' && disarm.catches === 1 && disarm.ammo > 0, JSON.stringify(disarm));

    const shield = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      g.input.tap('use');
      g.debugStep(1 / 60, 2);
      T.pass(0.3);
      g.input.tap('altFire'); // throw a pistol straight ahead
      g.debugStep(1 / 60, 1);
      const before = g.projectiles.active.length;
      T.bullet([0, 1.55, -12], [0, 0, 1], { speed: 30 });
      T.pass(0.6);
      return { before, hits: g.player.hitsTaken, bullets: g.projectiles.active.length };
    }, sandbox({ weapons: [{ kind: 'pistol', pos: [0, 0.3, -0.6] }] }));
    check('a thrown object stops a round in flight', shield.hits === 0, JSON.stringify(shield));

    const transfer = await page.evaluate(
      ({ open, walled }) => {
        const g = window.__stillshot;
        const run = (def) => {
          T.start(def);
          T.pass(1.0);
          const e = g.director.enemies[0];
          const target = [e.pos.x, e.pos.z];
          T.face(e.pos.x, 1.2, e.pos.z);
          g.input.tap('hotswitch');
          g.debugStep(1 / 60, 2);
          return {
            transfers: g.player.stats.transfers,
            at: Math.hypot(g.player.pos.x - target[0], g.player.pos.z - target[1]),
            enemies: g.director.enemies.length,
            bursts: g.fx.shards.burstCount,
            airborneWeapon: g.level.items.some((it) => it.kind === 'pistol' && !it.settled),
          };
        };
        return { open: run(open), walled: run(walled) };
      },
      {
        open: sandbox({ waves: [{ trigger: 'start', enemies: [{ pos: [0, 0, -9], weapon: 'pistol', yaw: Math.PI }] }] }),
        walled: sandbox({
          colliders: [{ pos: [0, 3, -4], size: [6, 6, 0.5], kind: 'wall' }],
          waves: [{ trigger: 'start', enemies: [{ pos: [0, 0, -9], weapon: 'pistol', yaw: Math.PI }] }],
        }),
      },
    );
    check('a transfer puts you in the target body, breaks yours, and leaves its weapon in the air', transfer.open.transfers === 1 && transfer.open.at < 0.5 && transfer.open.enemies === 0 && transfer.open.bursts >= 1 && transfer.open.airborneWeapon, JSON.stringify(transfer.open));
    check('a transfer needs a clear line of sight', transfer.walled.transfers === 0 && transfer.walled.enemies === 1, JSON.stringify(transfer.walled));

    const melee = await page.evaluate((def) => {
      const g = window.__stillshot;
      const run = (retreat) => {
        T.start(def);
        const e = g.director.enemies[0];
        let i = 0;
        while (e.aiState !== 'strike' && i++ < 1200) {
          g.time.spendAction(0.05);
          g.debugStep(1 / 60, 1);
        }
        const windupAt = Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z);
        for (let k = 0; k < 90; k++) {
          if (retreat) g.input.setAction('back', true);
          else g.time.spendAction(0.05);
          g.debugStep(1 / 60, 1);
        }
        g.input.releaseAll();
        return { hits: g.player.hitsTaken, windupAt };
      };
      return { stand: run(false), retreat: run(true) };
    }, sandbox({ waves: [{ trigger: 'start', enemies: [{ pos: [0, 0, -4], yaw: Math.PI }] }] }));
    check('a melee swing lands if you stand in it', melee.stand.hits === 1, JSON.stringify(melee.stand));
    check('…and whiffs if you step out during the wind-up', melee.retreat.hits === 0, JSON.stringify(melee.retreat));

    const walls = await page.evaluate(
      ({ gunDef, grabDef, meleeDef }) => {
        const g = window.__stillshot;
        const out = {};
        // Fire with the muzzle pressed into a thin wall: the round must not appear beyond it.
        T.start(gunDef);
        g.input.tap('use');
        g.debugStep(1 / 60, 2);
        g.input.setAction('forward', true);
        T.step(0.5);
        g.input.setAction('forward', false);
        out.distToWall = Math.abs(g.player.pos.z - -1.25);
        g.input.tap('fire');
        g.debugStep(1 / 60, 1);
        T.flow(0.4);
        out.enemyAlive = g.director.enemies.length === 1 && g.director.enemies[0].alive;
        // A weapon on the far side of a wall cannot be taken through it.
        T.start(grabDef);
        T.face(0, 0.6, -2.4);
        out.grabThroughWall = g.player.grabTarget(true) !== null;
        // A figure on the far side of a wall cannot strike through it.
        T.start(meleeDef);
        T.flow(3.5);
        out.hitsThroughWall = g.player.hitsTaken;
        return out;
      },
      {
        gunDef: sandbox({
          colliders: [{ pos: [0, 3, -1.5], size: [8, 6, 0.5], kind: 'wall' }],
          weapons: [{ kind: 'pistol', pos: [0, 0.3, -0.5] }],
          waves: [{ trigger: 'start', enemies: [{ pos: [0, 0, -4], yaw: Math.PI }] }],
        }),
        grabDef: sandbox({ colliders: [{ pos: [0, 3, -1.5], size: [8, 6, 0.5], kind: 'wall' }], weapons: [{ kind: 'pistol', pos: [0, 0.3, -2.4] }] }),
        meleeDef: sandbox({
          spawn: { pos: [0, 0, -0.9], yaw: 0 },
          colliders: [{ pos: [0, 3, -1.5], size: [40, 6, 0.5], kind: 'wall' }],
          waves: [{ trigger: 'start', enemies: [{ pos: [0, 0, -3], yaw: Math.PI }] }],
        }),
      },
    );
    check('a round fired with the muzzle against a wall does not come out the other side', walls.enemyAlive && walls.distToWall < 0.7, JSON.stringify(walls));
    check('a weapon behind a wall cannot be taken through it', walls.grabThroughWall === false);
    check('a figure behind a wall cannot strike through it', walls.hitsThroughWall === 0, `hits ${walls.hitsThroughWall}`);

    const constant = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      T.pass(0.9);
      T.step(1.5); // let time settle back to still
      const [grunt, cons] = g.director.enemies;
      const g0 = grunt.pos.clone();
      const c0 = cons.pos.clone();
      T.step(4); // stand perfectly still for four seconds
      const out = { grunt: grunt.pos.distanceTo(g0), constant: cons.pos.distanceTo(c0) };
      // …but borrowed time stops even a Constant.
      g.input.tap('borrow');
      g.debugStep(1 / 60, 1);
      const c1 = cons.pos.clone();
      T.step(1);
      out.duringBorrow = cons.pos.distanceTo(c1);
      return out;
    }, sandbox({ waves: [{ trigger: 'start', enemies: [{ pos: [-6, 0, -14], yaw: Math.PI }, { pos: [6, 0, -14], kind: 'constant', yaw: Math.PI }] }] }));
    check('a Constant keeps moving while you stand still; a normal figure does not', constant.constant > 1.5 && constant.grunt < 0.1, JSON.stringify(constant));
    check('borrowed time stops a Constant too', constant.duringBorrow === 0, `moved ${constant.duringBorrow}`);

    const field = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def);
      const inside = T.bullet([0, 1.2, -6], [1, 0, 0], { speed: 30 });
      const outside = T.bullet([0, 1.2, 8], [1, 0, 0], { speed: 30 });
      const a0 = inside.pos.x;
      const b0 = outside.pos.x;
      T.pass(0.2);
      return { inside: inside.pos.x - a0, outside: outside.pos.x - b0 };
    }, sandbox({ fields: [{ pos: [0, 1.2, -6], radius: 3, kind: 'still' }] }));
    check('a round inside a still field crawls', field.inside < field.outside * 0.1 && field.outside > 4, JSON.stringify(field));
  },

  // -------------------------------------------------------------------------
  async audio(page) {
    // The graph can be exercised headlessly; what it SOUNDS like cannot be judged here.
    const a = await page.evaluate(() => {
      const g = window.__stillshot;
      const audio = g.audio;
      const names = ['shoot', 'shotgun', 'nail', 'glass', 'impact', 'shatter', 'slice', 'slash', 'deflect', 'ricochet', 'throw', 'thud', 'punch', 'pickup', 'catch', 'dryfire', 'swing', 'windup', 'hotswitch', 'death', 'ui', 'whiz', 'tick', 'arrive', 'borrow', 'collect', 'repaid', 'chime', 'complete'];
      const state = audio.ctx ? audio.ctx.state : 'none';
      let threw = null;
      try {
        for (const scale of [0, 0.005, 0.3, 1, 2]) {
          audio.setTimeScale(scale, scale === 0);
          for (const n of names) audio.play(n, { x: 3, y: 1, z: -4 }, 1.2);
        }
        // Flood: far more triggers than the mixer should accept.
        for (let i = 0; i < 400; i++) audio.play(i % 2 ? 'impact' : 'shatter', { x: i % 7, y: 1, z: -3 });
        audio.setHold(true);
        audio.setHold(false);
        audio.setPulse(true);
        audio.update();
        audio.setPulse(false);
      } catch (e) {
        threw = String(e);
      }
      return { state, threw, voices: audio.voices };
    });
    check('the audio context is running', a.state === 'running', a.state);
    check('every sound can be triggered at every time scale without error', a.threw === null, a.threw ?? '');
    check('the mixer caps simultaneous voices', a.voices <= 46, `${a.voices} voices after flooding`);
    await page.waitForTimeout(5200);
    const after = await page.evaluate(() => window.__stillshot.audio.voices);
    check('voices are released when sounds end', after === 0, `${after} still held`);
  },

  // -------------------------------------------------------------------------
  async mix(page) {
    // Render the synthesis OFFLINE and measure it. This is not listening — it
    // cannot say whether anything sounds good — but it can say whether a sound
    // is silent, clipped, or fails to follow the clock.
    const m = await page.evaluate(async () => {
      const Engine = window.__stillshot.audio.constructor;
      const RealCtx = window.AudioContext;
      const render = async (seconds, setup) => {
        let made = null;
        window.AudioContext = function () {
          made = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
          Object.defineProperty(made, 'state', { get: () => 'running' });
          return made;
        };
        const engine = new Engine();
        engine.resume();
        window.AudioContext = RealCtx;
        setup(engine);
        const buf = await made.startRendering();
        const l = buf.getChannelData(0);
        const r = buf.getChannelData(1);
        let peak = 0;
        let sum = 0;
        let zc = 0;
        let active = 0;
        let nan = false;
        let prev = 0;
        for (let i = 0; i < l.length; i++) {
          const v = (l[i] + r[i]) * 0.5;
          if (Number.isNaN(v)) nan = true;
          peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
          sum += v * v;
          if (Math.abs(v) > 0.002) {
            active++;
            if ((v > 0) !== (prev > 0)) zc++;
            prev = v;
          }
        }
        // Zero-crossing rate over the audible part: a cheap proxy for brightness.
        return { peak, rms: Math.sqrt(sum / l.length), zcr: active > 0 ? zc / active : 0, active: active / 44100, nan, left: Math.max(...l.slice(0, 20000).map(Math.abs)), right: Math.max(...r.slice(0, 20000).map(Math.abs)) };
      };
      const names = ['shoot', 'shotgun', 'nail', 'glass', 'impact', 'shatter', 'slice', 'slash', 'deflect', 'ricochet', 'throw', 'thud', 'punch', 'pickup', 'catch', 'dryfire', 'swing', 'windup', 'hotswitch', 'death', 'ui', 'whiz', 'tick', 'arrive', 'borrow', 'collect', 'repaid', 'chime', 'complete'];
      const each = {};
      for (const n of names) each[n] = await render(3.5, (e) => { e.setTimeScale(1); e.play(n, null, 1.0); });
      const flow = await render(3, (e) => { e.setTimeScale(1); e.play('shatter'); });
      const still = await render(3, (e) => { e.setTimeScale(0.005); e.play('shatter'); });
      const flood = await render(3, (e) => { e.setTimeScale(1); for (let i = 0; i < 60; i++) e.play(i % 3 === 0 ? 'shotgun' : i % 3 === 1 ? 'shatter' : 'shoot'); });
      const leftSide = await render(1, (e) => { e.setTimeScale(1); e.setListener({ x: 0, y: 1.6, z: 0 }, { x: 1, y: 0, z: 0 }); e.play('shoot', { x: -6, y: 1.6, z: 0 }); });
      const near = await render(1, (e) => { e.setTimeScale(1); e.setListener({ x: 0, y: 1.6, z: 0 }, { x: 1, y: 0, z: 0 }); e.play('shoot', { x: 0, y: 1.6, z: -2 }); });
      const far = await render(1, (e) => { e.setTimeScale(1); e.setListener({ x: 0, y: 1.6, z: 0 }, { x: 1, y: 0, z: 0 }); e.play('shoot', { x: 0, y: 1.6, z: -30 }); });
      return { each, flow, still, flood, leftSide, near, far };
    });
    const silent = Object.entries(m.each).filter(([, v]) => v.peak < 0.01).map(([k]) => k);
    const hot = Object.entries(m.each).filter(([, v]) => v.peak > 0.99).map(([k]) => k);
    const bad = Object.entries(m.each).filter(([, v]) => v.nan).map(([k]) => k);
    check('every sound renders an audible signal', silent.length === 0, silent.length ? `silent: ${silent.join(', ')}` : `quietest peak ${Math.min(...Object.values(m.each).map((v) => v.peak)).toFixed(3)}`);
    check('no single sound clips', hot.length === 0 && bad.length === 0, hot.length ? `at full scale: ${hot.join(', ')}` : `loudest peak ${Math.max(...Object.values(m.each).map((v) => v.peak)).toFixed(3)}`);
    check('a flood of the loudest sounds stays under full scale', m.flood.peak < 1.0, `peak ${m.flood.peak.toFixed(3)}`);
    check('the same sound is darker and longer when time is still', m.still.zcr < m.flow.zcr * 0.75 && m.still.active > m.flow.active * 1.2, `brightness ${m.flow.zcr.toFixed(3)} → ${m.still.zcr.toFixed(3)}, length ${m.flow.active.toFixed(2)}s → ${m.still.active.toFixed(2)}s`);
    check('a sound to the left is louder in the left ear', m.leftSide.left > m.leftSide.right * 1.5, `L ${m.leftSide.left.toFixed(3)} / R ${m.leftSide.right.toFixed(3)}`);
    check('a distant sound is quieter than a near one', m.far.peak < m.near.peak * 0.6, `near ${m.near.peak.toFixed(3)}, far ${m.far.peak.toFixed(3)}`);
  },

  // -------------------------------------------------------------------------
  async replay(page) {
    const info = await playPlate(page, 0, { maxSeconds: 120 });
    check('the bot finishes plate 01', info.state === 'level-complete', `state ${info.state}`);
    const kills = info.stats.kills;

    // Tableau → replay.
    const started = await page.evaluate(() => {
      const g = window.__stillshot;
      for (let i = 0; i < 200 && g.state !== 'replay'; i++) g.debugStep(1 / 60, 1);
      return g.debugInfo();
    });
    check('the tableau hands over to the replay', started.state === 'replay' && started.replay !== null);

    const rec = await page.evaluate(() => {
      const g = window.__stillshot;
      const r = g.lastRecording;
      const killEvents = r.events.filter((e) => e.k === 'kill');
      const bursts = r.events.filter((e) => e.k === 'fx' && e.ev.k === 'burst');
      // Every kill must be backed by a shatter at the same instant, and the
      // figure must be present just before and absent just after.
      let consistent = 0;
      for (const k of killEvents) {
        const hasBurst = bursts.some((b) => Math.abs(b.w - k.w) < 0.02);
        const before = r.frames.filter((f) => f.tau < k.tau).pop();
        const after = r.frames.find((f) => f.tau > k.tau + 0.05);
        const wasThere = before && before.figs.some((f) => f.id === k.id);
        const isGone = !after || !after.figs.some((f) => f.id === k.id);
        if (hasBurst && wasThere && isGone) consistent++;
      }
      let ordered = true;
      for (let i = 1; i < r.frames.length; i++) if (r.frames[i].tau < r.frames[i - 1].tau) ordered = false;
      for (let i = 1; i < r.events.length; i++) if (r.events[i].tau < r.events[i - 1].tau) ordered = false;
      const sounds = r.events.filter((e) => e.k === 'snd').length;
      const shots = r.events.filter((e) => e.k === 'snd' && e.name === 'shoot').length;
      return {
        frames: r.frames.length,
        events: r.events.length,
        kills: killEvents.length,
        bursts: bursts.length,
        consistent,
        ordered,
        sounds,
        shots,
        duration: r.duration,
        exposure: r.exposure,
        bytes: JSON.stringify(r).length,
      };
    });
    check('every kill is in the recording', rec.kills === kills, `${rec.kills} of ${kills}`);
    check('every kill has its shatter, and its figure before and not after', rec.consistent === kills, `${rec.consistent} of ${kills}`);
    check('frames and events are in timeline order', rec.ordered);
    check('gunshots are in the recording', rec.shots >= info.stats.shots * 0.5 && rec.sounds > 10, `${rec.shots} shot sounds, ${rec.sounds} sounds`);
    check('the timeline length is the exposure (no borrowing in this run)', Math.abs(rec.duration - rec.exposure) < 0.2, `${rec.duration.toFixed(2)} vs ${rec.exposure.toFixed(2)}`);
    console.log(`       recording: ${rec.frames} frames, ${rec.events} events, ~${(rec.bytes / 1024).toFixed(0)} KB as JSON for ${rec.duration.toFixed(1)}s`);

    // Playback reproduces recorded poses exactly at recorded instants.
    const fidelity = await page.evaluate(() => {
      const g = window.__stillshot;
      const st = g.stage;
      const r = g.lastRecording;
      let worst = 0;
      let n = 0;
      for (let i = 10; i < r.frames.length; i += Math.max(1, Math.floor(r.frames.length / 25))) {
        const f = r.frames[i];
        st.seek(f.tau);
        st.paused = true;
        st.update(0);
        for (const fig of f.figs) {
          const rig = st.figures.get(fig.id);
          if (!rig) {
            worst = 99;
            continue;
          }
          worst = Math.max(worst, Math.hypot(rig.root.position.x - fig.pose.x, rig.root.position.z - fig.pose.z));
          n++;
        }
      }
      st.paused = false;
      st.seek(0);
      return { worst, n };
    });
    check('replayed figures stand exactly where they were recorded', fidelity.n > 5 && fidelity.worst < 0.02, `max error ${fidelity.worst.toFixed(4)}m over ${fidelity.n} samples`);

    const play = await page.evaluate(() => {
      const g = window.__stillshot;
      const shots = new Set();
      let maxBursts = 0;
      let frames = 0;
      while (!g.debugInfo().results && frames < 6000) {
        g.debugStep(1 / 60, 1);
        const i = g.debugInfo();
        if (i.replay) shots.add(i.replay.shot);
        maxBursts = Math.max(maxBursts, i.bursts);
        frames++;
      }
      const end = g.debugInfo();
      return { shots: [...shots], maxBursts, frames, results: end.results, edit: end.replay, world: g.time.worldElapsed, saved: JSON.parse(localStorage.getItem('stillshot.v2') || '{}') };
    });
    check('the replay plays through to the results card', play.results === true, `${(play.frames / 60).toFixed(1)}s of playback`);
    check('the edit uses more than one kind of shot', play.shots.length >= 3, play.shots.join(', '));
    check('shatters are regenerated during playback', play.maxBursts >= 2, `peak ${play.maxBursts} bursts`);
    check('playback does not advance the game clock', Math.abs(play.world - rec.exposure) < 1e-6, `${play.world} vs ${rec.exposure}`);
    check('finishing a plate saves progress', play.saved.progress?.unlocked >= 2 && play.saved.progress?.best?.['first-light']?.exposure > 0, JSON.stringify(play.saved.progress));

    const scrub = await page.evaluate(() => {
      const g = window.__stillshot;
      g.onKey('ArrowLeft');
      g.debugStep(1 / 60, 5);
      const a = g.debugInfo();
      g.onKey('Digit2');
      g.debugStep(1 / 60, 5);
      const b = g.debugInfo();
      g.onKey('Space');
      const t0 = g.stage.tau;
      g.debugStep(1 / 60, 30);
      const held = g.stage.tau === t0;
      g.onKey('Space');
      g.onKey('Enter');
      g.debugStep(1 / 60, 80);
      const c = g.debugInfo();
      g.onKey('KeyR');
      g.debugStep(1 / 60, 3);
      const d = g.debugInfo();
      return { a: a.replay, resultsHidden: a.results === false, shot: b.replay.shot, held, resultsAgain: c.results, retried: d.state, replayGone: d.replay === null };
    });
    check('scrubbing back hides the results and rewinds', scrub.resultsHidden && scrub.a.tau < scrub.a.duration);
    check('camera mode can be switched to first person', scrub.shot === 'first person', scrub.shot);
    check('space holds playback', scrub.held);
    check('enter skips to the results; R starts the plate again', scrub.resultsAgain === true && scrub.retried === 'playing' && scrub.replayGone);
  },

  // -------------------------------------------------------------------------
  async campaign(page) {
    for (let i = 0; i < 8; i++) {
      const info = await playPlate(page, i, { maxSeconds: 420 });
      check(`plate ${String(i + 1).padStart(2, '0')} can be completed`, info.state === 'level-complete', `exposure ${info.world.toFixed(1)}s, ${info.stats.kills} figures, ${info.stats.shots} rounds`);
    }
    const a = await playPlate(page, 2, { maxSeconds: 300 });
    const b = await playPlate(page, 2, { maxSeconds: 300 });
    check('the same inputs produce the same run (deterministic simulation)', a.world === b.world && JSON.stringify(a.stats) === JSON.stringify(b.stats), `${a.world} vs ${b.world}`);
  },

  // -------------------------------------------------------------------------
  async lifecycle(page) {
    const leak = await page.evaluate(() => {
      const g = window.__stillshot;
      const cycle = () => {
        g.debugStart(1);
        g.player.invulnerable = true;
        g.input.setAction('forward', true);
        g.debugStep(1 / 60, 90, false);
        g.input.setAction('forward', false);
        g.debugStep(1 / 60, 1, true); // render once so GPU resources are actually created
      };
      cycle();
      cycle();
      const base = g.debugInfo().gl;
      for (let i = 0; i < 14; i++) cycle();
      const end = g.debugInfo().gl;
      return { base, end };
    });
    check('retrying a plate does not leak geometries', leak.end.geometries <= leak.base.geometries + 2, `${leak.base.geometries} → ${leak.end.geometries}`);
    check('…or textures', leak.end.textures <= leak.base.textures + 1, `${leak.base.textures} → ${leak.end.textures}`);
    check('…or shader programs', leak.end.programs <= leak.base.programs + 1, `${leak.base.programs} → ${leak.end.programs}`);

    const pause = await page.evaluate(() => {
      const g = window.__stillshot;
      const canvas = document.getElementById('scene');
      let locked = canvas;
      Object.defineProperty(document, 'pointerLockElement', { get: () => locked, configurable: true });
      g.debugStart(0);
      document.dispatchEvent(new Event('pointerlockchange'));
      g.input.setAction('forward', true);
      g.debugStep(1 / 60, 20);
      const before = g.debugInfo();
      locked = null; // the browser took the pointer back (Esc, alt-tab…)
      document.dispatchEvent(new Event('pointerlockchange'));
      const w0 = g.time.worldElapsed;
      const z0 = g.player.pos.z;
      g.debugStep(1 / 60, 60);
      const paused = g.debugInfo();
      const frozen = g.time.worldElapsed === w0 && g.player.pos.z === z0;
      const overlay = document.querySelector('.overlay.show') !== null;
      locked = canvas;
      document.dispatchEvent(new Event('pointerlockchange'));
      g.debugStep(1 / 60, 30);
      const resumed = g.debugInfo();
      const drift = Math.abs(g.player.pos.z - z0);
      delete document.pointerLockElement;
      return { before: before.state, paused: paused.state, frozen, overlay, resumed: resumed.state, drift };
    });
    check('losing the pointer pauses', pause.before === 'playing' && pause.paused === 'paused' && pause.overlay);
    check('nothing advances while paused', pause.frozen);
    check('resuming continues, with no stuck keys', pause.resumed === 'playing' && pause.drift < 0.05, `drift ${pause.drift.toFixed(3)}m`);

    const death = await page.evaluate((def) => {
      const g = window.__stillshot;
      T.start(def, false);
      T.bullet([0, 1.3, -6], [0, 0, 1]);
      T.pass(0.5);
      const dead = g.debugInfo();
      const w0 = g.time.worldElapsed;
      g.debugStep(1 / 60, 40);
      const frozen = g.time.worldElapsed === w0;
      g.input.tap('restart');
      g.debugStep(1 / 60, 3);
      const again = g.debugInfo();
      return { dead: dead.state, alive: dead.alive, frozen, again: again.state, world: again.world, projectiles: again.projectiles };
    }, sandbox());
    check('a hit kills, and the world stops', death.dead === 'dead' && death.alive === false && death.frozen);
    check('R restarts immediately with a clean slate', death.again === 'playing' && death.world < 0.05 && death.projectiles === 0, JSON.stringify(death));
  },
};

// ---------------------------------------------------------------------------

const server = await serve();
const browser = await launch();
const t0 = Date.now();
let pageErrors = [];
try {
  for (const [name, fn] of Object.entries(groups)) {
    if (filters.length && !filters.some((f) => name.includes(f))) continue;
    current = name;
    console.log(`\n${name}`);
    const { page, errors } = await openGame(browser, server.url);
    await page.evaluate(installHelpers);
    try {
      await fn(page);
    } catch (e) {
      check(`${name} ran to completion`, false, String(e.message ?? e).split('\n')[0]);
    }
    check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    pageErrors = pageErrors.concat(errors);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  [${f.group}] ${f.name}  ${f.detail}`);
  process.exit(1);
}
