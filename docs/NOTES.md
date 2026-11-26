# Development notes

Short record of what was changed between the original build and STILLSHOT 2, why, what was measured, what was tried and dropped, and what has *not* been verified.

## 1. Starting point

The original (see `docs/before/`, `docs/blueprint.md`) was a complete, playable SUPERHOT study: input-driven time scale, physical projectiles, seven weapons, hotswitch, grid A*, cube-shard deaths, a CRT pass, a positional replay, faux-DOS framing. Read in full before changing anything. What it already got right and was kept: the player integrating on real time while the world integrates on scaled time; swept projectile collision; no reloading; the white / black / red reading of the world; deterministic, predictable enemies.

Problems found by reading and by measurement:

| Finding | Evidence |
| --- | --- |
| Look cost depended on frame rate (mouse pixels were normalised *per rendered frame*) | A 2 s, 600 px/s sweep cost 0.765 world-s at 30 fps, 0.235 at 60, 0.071 at 120 — a ×10.8 spread |
| Actions were free | Weapon cooldown ran on real time: standing still you could empty a magazine for ~0.007 world-s |
| Holding a katana made you immune from the front | Always-on 1.1 m slice sphere |
| Enemy melee was an invisible timer | 0.35 s inside 1.7 m = death, no animation, no line-of-sight test |
| Hotswitch worked through walls and destroyed your weapon and theirs | No LOS test |
| With CRT on, the image was displayed un-encoded (linear shown as sRGB) | Scene → render target → custom quad with no colour-space conversion; it is why the "white" world in `docs/before/play.jpg` is grey |
| Each transient light was added/removed from the scene | Changes the light count, which forces three.js to recompile lit shaders |
| Each enemy, weapon and bullet allocated its own geometry | Disposed again on death |
| Replay stored camera, enemy position/yaw and bullet positions only | No poses, weapons, shatters, glass, sounds, thrown objects; enemies/bullets were not interpolated |
| The smoke test asserted nothing but "no console errors", with a Windows-only Chromium path and an undeclared Playwright dependency | `scripts/smoke.mjs` |
| Title, boot text, win screen, replay typography and voice were SUPERHOT's | "SUPER / HOT", "THE MOST INNOVATIVE SHOOTER…", `SUPERHOT_TEAM BIOS` |

## 2. The direction chosen

One sentence: **time is a currency, and the game is honest about every transaction.**

That gave the identity (a photographic archive: *plates*, *exposure*, *developing*, the *negative*, *overexposed*, STILL. / SHOT.), the score (exposure = world-time spent), and the test for every mechanic: does it create a decision about spending time, and can the player see the price?

Deliberately a small number of deep things rather than many shallow ones:

1. Make the core rule exact and fair (frame-rate independence, action costs, the subjective clock).
2. One new temporal mechanic that inverts the rule instead of adding an exception: **Borrowed Time**.
3. Make the room a sandbox by removing special cases (rounds hit anyone, thrown things are solid, blades transform rounds rather than deleting them).
4. Destruction worth standing still for.
5. A replay that is a reason to play.

## 3. Decisions, with reasons

**Look cost as angular velocity.** `lookSpeed` is radians per second, low-passed with a 60 ms time constant, and divided by a reference of 4 rad/s. The instantaneous speed is measured against the raw frame delta so a stalled frame does not read as a flick; the filter coefficient uses the clamped delta. Result: ×1.001 spread across 30–240 fps (was ×10.8), ×1.04 including coarse mouse report rates.

**Action costs.** `time.spendAction(seconds)` forces full-speed time until that much has been released. Fire 0.05, melee 0.09, throw 0.05, grab 0.03, transfer 0.08 world-seconds, plus roughly 0.11 s the release curve adds as time settles. A pistol shot fired from rest measures 0.176 world-s in total — about a quarter of an enemy's 0.62 s aim.

**Subjective clock for the player's weapons.** Cooldowns tick on *time spent*. Consequence: a click on a cycling weapon would do nothing while you stand still. Tried that first; it read as an unresponsive gun. Now the click **commits**: the remaining cycle time is spent (the world lurches) and then the round leaves. Every click does something, and every click is paid for.

**Borrowed Time.** Considered three signature mechanics:
- *Pinned shots* (place a round in the air, release later). Interesting pictures, but a separate rule with no use against enemies that do not dodge.
- *Stasis on a target.* Powerful, but it is "freeze the thing I'm looking at", which every time-themed game has.
- *A loan.* World rate is exactly 0 for up to 1.6 s; then world rate is `spend + 1` until the debt is cleared. The two phases are mirror images, which makes it explainable in one sentence and makes the cost legible. Chosen. It also turned out to *contain* pinned shots for free: rounds fired during a loan hang at the muzzle and leave together when it ends.

During the loan the replay clock advances at 30 % of real time while world time stands still, so in the replay the room visibly stops while the player's body crosses it.

**Blades.** The always-on slice sphere was an automatic solution. Now a blade is only live during a swing (0.24 s real). Swinging spends ~0.2 world-s, which is what carries a round the last few metres into the blade — so you swing *when the round is about 4–6 m out*, a skill with a visible cue. A sliced round is not deleted: it becomes two live rounds of yours, ±6.3° either side of your aim. Aim between two figures.

**Friendly fire, with one courtesy.** Hostile rounds kill hostile bodies. To stop the result being slapstick, a figure will not fire while a friend is in its line; it side-steps (a fixed side per figure, so it is predictable) until the line is clear. Rounds that *miss you* still find whoever is behind you. Standing so that happens is now a tactic, and unarmed runners become moving cover.

**Bulwark reflects rather than absorbs.** A shield with hit points is a number. A slab that returns rounds is a rule the player can use (bank a shot into someone else) and a hazard they created themselves. Turn rate is hard-capped at 2.2 rad/s so flanking works; anything thrown knocks the slab aside; piercing rounds ignore it.

**Constant.** `dt = max(worldDt, realDt × 0.28)`. One line, a completely different problem: you cannot deliberate forever. It ticks audibly and its halo turns at a steady rate so the exception is always visible. A loan stops it too — the loan is absolute.

**Time fields.** `level.localDt(pos)` is the delta every world object asks for. Still fields multiply it by 0.06; rush fields floor it at 45 % of real time. Fields never affect the player.

**Enemies stay simple.** No cover, no retreat, no flanking. The additions are all about legibility: a 0.75 s harmless materialisation, a red aim line that firms up before every shot, a visible melee wind-up that whiffs if you leave the arc, eye-to-eye sight lines, and an off-screen indicator for arrivals and for rounds that will pass through you from outside your view.

**Movement.** Jump apex raised from 1.14 m to 1.36 m and top surfaces made standable, so waist-high cover can be mounted. Jump buffering (0.12 s) and coyote time (0.1 s). Acceleration is an exponential approach rather than `min(1, a·dt)`, so it is the same at any frame rate.

**Hang time is deferred, not free.** The original capped time at 25 % while airborne with jump held, which made bunny-hopping a 4× discount on movement. The cap stays (a moment to think in mid-air is good), but the time held back is booked and 85 % of it is collected on landing. Measured: 3 s of walking costs 3.07 world-s; 3 s of continuous hopping over the same ground now costs 2.60 instead of roughly a quarter of that.

**Fracture.** See README. Two things worth recording: glass is fractured in 2D by zeroing the thin coordinate of every Voronoi seed (the first attempt, stretching the pane before seeding, sliced it into *layers*); and the shard shader has a depth-only twin so hanging debris casts shadows.

**Lens instead of CRT.** Curvature, scanlines, flicker and constant chromatic aberration all cost clarity in a game about reading small fast objects, and they were someone else's look. Replaced with: HDR scene target with MSAA, quarter-res bloom keyed on saturation (red crystal blooms, white walls do not), a shoulder-only tone curve so paper stays paper, and grading by time state. Grain is added after sRGB encoding (in linear it crawled over black objects).

**Replay architecture.** Deterministic re-simulation was rejected: the player integrates on a variable real-time step, so it would need a fixed-step input log and lockstep, and it cannot be scrubbed. Snapshots + events can, and since figures are posed from a dozen numbers and shards are a pure function of the clock, snapshots are small and effects are exact. Cost: ~77 KB of JSON-equivalent per second of timeline; frames are capped at 14 000 and thinned oldest-first.

**Kill events at the instant of death.** The director used to announce a kill when it tidied its list, one frame after the fact. The replay-fidelity test caught it (the figure was already gone from the snapshot the event pointed at).

## 4. Tried and dropped

| Tried | Why it went |
| --- | --- |
| Ignoring clicks while a weapon cycles | Felt broken while standing still → click commits |
| Additive blending for time fields | Invisible on a white world → normal blending, tinted |
| Negative with a gentle curve | Came out mid-grey; the point is black paper and white ink → gamma 2.1 |
| Death as a red desaturated wash | Pink. Now the frame blows out and burns in from the edges, keeping reds |
| 0.4 rad recoil in the enemy aim pose | From the player's view the rifle appeared to point at the ceiling → 0.13 |
| Film grain in linear space | Speckled every black object |
| Katana held straight across the view | Covered the crosshair third of the screen |
| Front-facing-only streak ribbons | They were always back-facing: no trail, threat line or telegraph rendered until this was found in a close-up |
| A separate "pin a bullet" ability | Subsumed by Borrowed Time |
| Shield hit points | Replaced by reflection |
| Enemy cover / retreat | Not built: predictability is what makes the room a puzzle |
| WebGPU, an engine, a physics library | No evidence any would make the game better |

## 5. Measurements

All taken in headless Chromium (SwiftShader) on a 4-core cloud container, driving the production build through `scripts/`.

**Time**

| | 30 fps | 60 | 120 | 144 | 240 |
| --- | --- | --- | --- | --- | --- |
| Before: world-s for a 2 s, 600 px/s look sweep | 0.765 | 0.235 | 0.071 | — | — |
| After: same sweep | 0.1914 | 0.1913 | 0.1912 | 0.1912 | 0.1912 |
| After: a 0.25 s step forward | 0.338 | 0.322 | 0.323 | 0.323 | 0.323 |

Other: idle rate 0.00500; a 3 s stall with 6000 px of queued mouse movement advances the world 0.009 s; a pistol shot from rest costs 0.176 world-s; a 1.000 s loan is repaid with 1.117 world-s when standing still.

**Simulation cost** (plate 08, autoplayer, no rendering): mean 0.21 ms per frame, worst 120-frame average 1.0 ms. Replay playback: 0.05 ms per frame.

**Scene complexity at peak** (plate 08): 315 draw calls and 23.6 k triangles per frame including the shadow pass; 7 concurrent shard bursts (10.2 k triangles, 7 draw calls + 7 shadow); 22 rounds; 51 streak instances in one call.

**Memory**: JS heap 7.9 MB at the menu, 32 MB after a 60 s plate and its replay (the recording). Geometries, textures and shader programs do not grow across 14 retries.

**Bundle**: game code 186 kB (60 kB gzip), three.js 475 kB (120 kB gzip). Before: 73 kB and 485 kB.

**GPU frame time: not measured.** There is no GPU in the test environment; the software rasteriser's timings mean nothing for real hardware. Draw calls and triangle counts above are modest, the heaviest fragment work is one full-screen composite plus four quarter-res taps, and there is a render-scale setting — but 60 fps on real hardware is an expectation, not a measurement.

## 6. What was and was not verified

Verified by automated test (`npm test`, 80 assertions, all passing):

- frame-rate and report-rate independence of look cost; stall safety; idle rate; action costs; hang-time repayment; loan symmetry and cooldown
- no tunnelling at 20 fps or 240 fps; glass at 20 fps
- friendly fire; katana split (and no protection without a swing); slab reflection and piercing; disarm and mid-air catch; thrown object stops a round; transfer and its line-of-sight rule; melee landing and whiffing; no fire, grab or strike through walls; Constants; still fields
- audio graph: every sound at every time scale without error, voice cap, voice release
- recording: every kill present, with its shatter, with its figure before and not after; ordering; playback poses match recorded poses to < 2 cm; playback does not advance the game clock; scrub, hold, camera modes, skip, retry; progress saved
- all eight plates completable by the autoplayer (with lethal hits counted rather than applied); identical inputs give identical runs
- no growth in GPU resources across retries; pause freezes everything and resumes without stuck keys; death freezes the world and R restarts clean

Verified by looking at captured frames: the screenshots in `docs/after/`.

**Not verified:**

- **Fun.** No human has played this build. Every claim about feel, pacing, difficulty and whether the new mechanics are enjoyable is design judgement.
- **Audio by ear.** The synthesis code runs without error. Nobody has heard it. Balance, harshness at low time scales, and whether the kill motif reads as a phrase in the replay are unknown.
- **Real GPUs, real frame times, real pointer lock, real mice.** Pointer-lock loss/regain is simulated in the test.
- **Firefox, Safari, any mobile browser.** The lens pass needs WebGL2 with float render targets (falls back to 8-bit if `EXT_color_buffer_float` is missing; that path has not been exercised).
- **Fairness with a human at the controls.** The autoplayer takes many "lethal" hits per plate because it strafes blindly; that says nothing either way.
- **Par times.** Estimates from autoplayer runs.

## 7. Known limitations and loose ends

- No key remapping, gamepad or touch.
- Shards land on the floor plane only; they pass through cover blocks and plinths.
- Navigation is a grid baked from solid boxes; figures cannot climb onto cover. They can still strike you at its edge, and rounds do not care, but the middle of a large block (the dais in plate 08) is out of reach of anything unarmed.
- Aim telegraph lines are not recorded, so they do not appear in the replay.
- The replay cannot be exported.
- The autoplayer cannot use Borrowed Time; plate 05's opening is only "completed" in tests because lethal hits are counted, not applied.
- Enemy weapon cooldowns and bursts run on local world time, so a figure standing in a still field is nearly frozen — intended, but plates 06 and 08 lean on it and have not been tuned by hand.

## 8. Ideas that look promising and were not built

- A mirror plate built entirely around banking rounds off slabs.
- Borrowed Time as a scoring axis (a plate's exposure excludes loans; a separate "debt" figure could be par'd).
- Moving architecture on world time (a door that only opens while you spend).
- Exporting a replay as a seed + input log.
- Listening to it, and then rewriting half the sound design.

## 9. Intellectual property

Removed: the "SUPER / HOT" replay stamp and synthesized voice, the boot text quoting SUPERHOT's marketing line, `SUPERHOT_TEAM BIOS`, the "system has you" ending, the cracked-executable framing, the name "Fishgun". Remaining debt is to ideas, which the README states plainly: time moves when you move, one-hit kills, no reloading, throw–disarm–catch, body transfer on a cooldown, white / black / red.

No third-party art, audio, fonts or code beyond three.js (MIT) and the build tooling. Fonts are whatever the system provides. The repository has no licence file.
