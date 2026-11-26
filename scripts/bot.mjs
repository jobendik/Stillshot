// A simple autoplayer used by the tests. It reads game state (which a player
// reads off the screen) but ACTS only through the input layer — the same
// setAction / tap / addLook calls a keyboard and mouse produce.
//
// It is not a good player. It exists to prove that plates can be finished,
// to exercise every system, and to produce recordings for the replay tests.

/** Runs inside the page. Advances up to `frames` frames; returns a status object. */
export function botChunk({ frames, dt, god }) {
  const g = window.__stillshot;
  const p = g.player;
  const input = g.input;
  const SENS = 0.0022 * (g.store?.values.sensitivity ?? 1);
  p.invulnerable = !!god;
  const st = (window.__bot ??= { t: 0, strafe: 1, strafeT: 0, stuckT: 0, lastX: 0, lastZ: 0 });

  const aimAt = (x, y, z, maxTurn = 0.16) => {
    const dx = x - p.headPos.x, dy = y - p.headPos.y, dz = z - p.headPos.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    let dYaw = wantYaw - p.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const dPitch = wantPitch - p.pitch;
    const ty = Math.max(-maxTurn, Math.min(maxTurn, dYaw));
    const tp = Math.max(-maxTurn, Math.min(maxTurn, dPitch));
    input.addLook(-ty / SENS, -tp / SENS);
    return Math.hypot(dYaw - ty, dPitch - tp);
  };
  const firearm = (k) => k === 'pistol' || k === 'rifle' || k === 'shotgun' || k === 'nailgun';
  const los = (a, b) => {
    const d = b.clone().sub(a); const len = d.length();
    return g.level.rayToSolid(a, d.multiplyScalar(1 / len), len) >= len;
  };

  for (let f = 0; f < frames; f++) {
    if (g.state !== 'playing') break;
    st.t += dt;
    for (const a of ['forward', 'back', 'left', 'right']) input.setAction(a, false);
    const enemies = g.director.enemies.filter((e) => e.alive);
    const held = p.heldKind;
    let target = null, best = 1e9;
    for (const e of enemies) {
      const d = e.pos.distanceTo(p.pos) + (los(p.headPos, e.eye) ? 0 : 30);
      if (d < best) { best = d; target = e; }
    }
    const abilities = g.level.def.abilities;

    // Strafe rhythm (dodging), flipping when blocked.
    st.strafeT -= dt;
    const moved = Math.hypot(p.pos.x - st.lastX, p.pos.z - st.lastZ);
    st.lastX = p.pos.x; st.lastZ = p.pos.z;
    if (st.strafeT <= 0) { st.strafe = -st.strafe; st.strafeT = 0.5 + (Math.floor(st.t * 7) % 5) * 0.12; }

    if (!target) {
      // Between waves: keep a little time flowing so the next one arrives.
      input.setAction(st.strafe > 0 ? 'right' : 'left', true);
    } else if (firearm(held) && p.heldAmmo > 0) {
      const c = target.center;
      const visible = los(p.headPos, target.eye);
      const err = aimAt(c.x, c.y + 0.1, c.z);
      if (visible) {
        input.setAction(st.strafe > 0 ? 'right' : 'left', true);
        if (err < 0.012 && p.readiness <= 0) input.tap('fire');
      } else if (abilities.hotswitch && p.hotswitchReady && p.hotswitchTarget()) {
        input.tap('hotswitch');
      } else {
        input.setAction('forward', true);
        if (moved < 0.2 * dt) input.setAction(st.strafe > 0 ? 'right' : 'left', true);
      }
    } else if (held !== 'fist') {
      // Spent gun, orb, bat or blade.
      const c = target.center;
      const err = aimAt(c.x, c.y, c.z);
      const dist = target.pos.distanceTo(p.pos);
      if (held === 'bat' || held === 'katana') {
        input.setAction('forward', true);
        if (dist < 2.0 && err < 0.3) input.tap('fire');
      } else if (err < 0.05 && los(p.headPos, target.eye)) input.tap('altFire');
      else input.setAction('forward', true);
    } else {
      // Empty hands: catch / take a weapon, else transfer, else punch.
      const grab = p.grabTarget(true);
      if (grab) { input.tap('use'); }
      let item = null, bi = 1e9;
      for (const it of g.level.items) {
        if (it.type === 'weapon' && it.ammo === 0 && firearm(it.kind)) continue;
        const d = it.pos.distanceTo(p.pos);
        if (d < bi) { bi = d; item = it; }
      }
      if (item && bi < 14 && los(p.headPos, item.pos.clone().setY(Math.max(item.pos.y, 1.1)))) {
        aimAt(item.pos.x, item.pos.y, item.pos.z, 0.25);
        input.setAction('forward', true);
      } else if (abilities.hotswitch && p.hotswitchReady) {
        const c = target.center;
        aimAt(c.x, c.y, c.z);
        if (p.hotswitchTarget()) input.tap('hotswitch');
        else input.setAction('forward', true);
      } else {
        const c = target.center;
        const err = aimAt(c.x, c.y, c.z);
        input.setAction('forward', true);
        if (target.pos.distanceTo(p.pos) < 1.9 && err < 0.3) input.tap('fire');
      }
    }
    g.debugStep(dt, 1, false);
  }
  for (const a of ['forward', 'back', 'left', 'right']) input.setAction(a, false);
  return g.debugInfo();
}

/** Drive a plate with the bot until it ends or `maxSeconds` of real time pass. */
export async function playPlate(page, level, { dt = 1 / 60, maxSeconds = 240, god = true } = {}) {
  await page.evaluate((level) => {
    window.__bot = undefined;
    window.__stillshot.debugStart(level);
  }, level);
  let info = null;
  const chunk = 240;
  for (let t = 0; t < maxSeconds; t += chunk * dt) {
    info = await page.evaluate(botChunk, { frames: chunk, dt, god });
    if (info.state !== 'playing') break;
  }
  return info;
}
