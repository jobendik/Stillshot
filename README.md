# STILLSHOT

> *time moves only when you move.*

A complete, browser-native homage to the **SUPERHOT** temporal-shooter mechanic, built from the architectural blueprint in [`blueprint.md`](blueprint.md). Written in **TypeScript**, rendered with **three.js**, and served by a professional **Vite** setup. No game-engine, no art assets — every model, sound, and shader is procedural.

The core mandate is faithfully reproduced: the global time scale is mapped to the magnitude of your input. Stand perfectly still and the world decelerates to ~1/200th speed (it never fully freezes — bullets keep inching toward you). Move or look and time surges back to real-time.

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check (`tsc --noEmit`) + production bundle to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | Type-check only |

A headless smoke test (boots the game, drives the menu, plays a frame, asserts no runtime errors) lives at [`scripts/smoke.mjs`](scripts/smoke.mjs).

---

## Controls

| Input | Action |
| --- | --- |
| **W A S D** | Move (advances time) |
| **Mouse** | Look (advances time, weighted lower than movement) |
| **Space** | Jump — hold while airborne for aerial time-dilation |
| **LMB** | Fire / punch / swing |
| **Q** (or RMB) | Throw the held item (magnetized toward the crosshair) |
| **F** | Melee |
| **E** | Pick up the nearest weapon / object |
| **Shift** | **Hotswitch** — project into a targeted enemy's body |
| **R** | Retry (after death) |

---

## What's implemented (mapped to the blueprint)

**Temporal mechanics** — `src/core/Time.ts`
- `magnitude = √(translation² + (W·rotation)²)`, smoothstepped, with asymmetric attack/release smoothing (snappy speed-up, eased slow-down).
- Idle floor `MIN_TIME_SCALE = 0.005`; rotation weighted below translation (`ROTATION_WEIGHT`).
- Jump dilation caps the scale at `0.25` while airborne with jump held.
- Player kinematics run on **unscaled** time; the entire world runs on **scaled** time.

**Combat & ballistics** — `src/combat/`, `src/config/weapons.ts`
- *Physical* projectiles (never hitscan) governed by world time — they crawl and can be tracked, dodged, or sliced. Swept collision avoids tunneling at any time scale.
- Full weapon taxonomy: **Pistol** (5, semi, deflectable), **Assault Rifle** (12, uninterruptible 4-round burst, penetrates after the first glass break), **Shotgun** (2 shells × 9 pellets, extreme spread, near-undeflectable), **Fishgun/Nailgun** (3, pierces glass *and* enemies for collateral kills).
- One-hit-kill for player and enemies. No reload — depleted weapons are kept to throw.
- **Katana** slices incoming bullets (oversized trigger volume → two diverging cosmetic halves). **Bat** deflects bullets but degrades and shatters after 3 impacts. Fists need 3 combo strikes; thrown objects stagger + disarm.
- Throwables auto-magnetize toward enemies via a targeting cylinder; impacts disarm armed enemies (their weapon pops up as a grabbable pickup).
- FOV-aware player hitbox: a bullet you're actively tracking is far easier to evade than one you turn your back on.

**Hotswitch** — `src/player/Player.ts`
- Center-screen target acquisition, instant teleport into the body, old body shatters as crystal, the host immediately drops/shatters its weapon, hard cooldown before reuse.

**AI** — `src/ai/`
- Deterministic three-state behavior tree: **Acquire weapon → Engage (LOS + predictive lead) → Pursue (shortest path)**. No cover, no retreat, no coordination — relentless and predictable.
- Grid-based A* navigation (string-pulled) as a NavMesh stand-in.
- Wave director with the signature **spawn-behind** placement; arena completes when the last red falls, freezing all projectiles mid-air.

**Rendering** — `src/fx/`
- Strict tri-color isolation: matte white/grey environment, absolute-black interactives, glossy emissive-red enemies.
- Crystalline **Voronoi-style shatter** on death (shards live in world time, so kills landed while frozen hang in the air); breakable glass; muzzle flashes; sparks.
- Diegetic **CRT post-process** (scanlines, curvature, chromatic aberration, vignette, flicker) as a single dependency-free full-screen pass.

**Replay** — `src/replay/Replay.ts`
- Records against world time so dead time is compressed out, then plays the run back at hard-locked real-time 1.0 with the flashing **SUPER / HOT** typography and a synthesized title voice.

**Audio** — `src/audio/Audio.ts`
- Fully procedural Web Audio. Every effect's pitch and the ambient server-fan/CRT drone are tethered to the time scale — deep and muffled when frozen, bright and snappy at speed ("auditory whiplash").

**Meta-narrative** — `src/ui/Menu.ts`
- Faux-DOS boot spew, cracked-executable framing, a blinking shell, and mission briefings ("insert consciousness").

### Documented but intentionally out of scope
The blueprint also surveys **Superhot VR** (6DoF, Mindwave) and **Mind Control Delete** (roguelite Cores/Hacks, armored/mushroom/specialist archetypes). Those are platform/expansion rewrites; this build targets a faithful **keyboard-and-mouse core campaign** experience. The architecture (ScriptableObject-style weapon defs in `config/`, modular systems) is structured to make those extensions straightforward.

---

## Architecture

```
src/
├─ main.ts                 entry point
├─ core/
│  ├─ Game.ts              orchestrator + state machine + RAF loop
│  ├─ Time.ts              the temporal core (timescale ↔ input magnitude)
│  ├─ Input.ts             keyboard / pointer-lock mouse
│  ├─ Context.ts           shared service bag (avoids import cycles)
│  ├─ events.ts            typed event bus
│  └─ math.ts              vector/yaw helpers
├─ config/                 constants, palette, weapon taxonomy (data-driven)
├─ world/                  Level geometry, collision math, level definitions
├─ player/                 Player.ts (kinematics, weapons, melee, hotswitch)
├─ combat/                 Projectile, Weapon, Throwable systems
├─ ai/                     Enemy behavior tree, A* Navigation, wave Director
├─ fx/                     Materials, Models, FX (shatter), PostFX (CRT)
├─ audio/                  procedural Web Audio engine
├─ replay/                 record + SUPER HOT playback
└─ ui/                     HUD, faux-DOS Menu, styles.css
```

**The one rule that defines everything:** the player controller integrates on `time.unscaledDt` (instant, crisp); every other system — projectiles, enemies, shatter shards, the audio pitch — integrates on `time.scaledDt`. The act of moving is what spends time.

---

## License

Fan project / homage for educational purposes. SUPERHOT is a trademark of the SUPERHOT Team.
