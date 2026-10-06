---
title: Walking is eight ways around solid buildings, paced by your figure and drawn before the server answers
date: 2026-10-06
status: accepted
tags: [sim, protocol, server, client, design]
---

# Walking is eight ways around solid buildings, paced by your figure and drawn before the server answers

## Context

Walking was four ways only, and residents walked straight across the Town Hall and the shop, because worlds from before the buildings had to replay as they were made. A held key stepped once per server answer, at most every 110ms, so the pace was set by the network, and each tile eased to a stop before the next one started. With a fast key repeat it read as quick and jittery. The camera chased the server's tile while the figure slid, so the two disagreed on every step. A putter's six steps arrived at once and were drawn as a jump.

Reach, earshot, and the putter's search already count distance as Chebyshev (a diagonal is one tile), so four-way walking was the one place the world measured differently.

## Decision

- **One rule, in the sim.** `stepFrom` in `sim/src/walk.ts` takes one tile in any of eight directions. A step can't go off the world, into a block, or onto the Town Hall or shop once they're solid. A diagonal also needs both tiles beside it open, so it never slips between blocks that touch at their corners or clips a building. The sim checks every `move` and putter step with it.
- **Buildings turn solid with a logged switch.** The server logs `solid_buildings` once (`solidBuildings: true` in both adapters), after the shop has had its chance to open. From then on `state.solidBuildings` is set, a step onto either building is `blocked` with words that name it, and anyone standing on one is moved to the nearest open tile with a `moved` event. If the shop opens after the switch, it does the same for its tiles. Logs from before the switch replay exactly, so `REPLAY_VERSION` doesn't move.
- **One planner over the same rule.** `walkTree` and `route` search breadth first with `stepFrom`. The putter planner uses them on the server, and tap-to-walk uses them on the client, so a tapped walk goes around the Town Hall rather than stopping at it.
- **Your own steps are drawn before the server answers.** `client/src/walk.ts` turns input into steps:
  - Two keys held together make a diagonal, with a 50ms chord window from standing and a 60ms grace for letting go of a diagonal's keys.
  - The d-pad is pressed and slid: each button is its direction, and the corners between buttons are diagonals.
  - Each tap is one step.
  - Before sending a step, the walker checks it with the sim's own `stepFrom` on the mirror's ground (decision 0052), and your figure walks it at once. A blocked diagonal slides along the open side, and a dead end bumps your figure once it stops, with nothing sent. A tapped walk is planned when its first step is due and again whenever you're off it, so a tap made while going home walks from the hearth. At most two steps wait on the server, and none are taken while the mirror reloads after a gap.
- **The pace is the figure's.** The next step goes when your figure is within `LEAD` (0.45 tiles) of the end of the last one. A held key walks at `WALK_SPEED` (5 tiles a second, a diagonal taking √2 as long) whatever the key repeat rate, the frame rate, or the connection. That is 5 actions a second, under the action limit of 10.
- **Every figure walks its path at one pace.** `client/src/motion.ts` gives each figure a path of tiles. It eases in where a walk starts and out where it ends, never in between, and hurries when it falls more than 1.5 tiles behind. Someone else's steps join their path as the server reports them, each step of a burst included. Their walk starts 90ms after the first step arrives and then keeps the pace their steps arrive at, so a slow or uneven connection doesn't stop them at every tile. The map's camera follows the drawn figure, not the server's tile, at the same rate on any display.

## Consequences

- Facing ([decision 0067](0067-facing-and-motion-are-drawing-only-kept-out-of-the-sim-and-the-l.md)) is any of eight ways where it's drawn from live steps, so the 3D figure turns to the true angle. The snapshot's `facing` stays `n`, `s`, `e`, or `w`, a diagonal sent as the side it heads toward (`fourWayFacing` in `protocol/src/facing.ts`), because a client built for four values would refuse a whole snapshot with a fifth. The 2D figure draws diagonals the same way.
- `move` gains four enum values, and the snapshot gains `solidBuildings` and the `buildings_solid` event. All additive in v1.
- Old logs replay exactly and old snapshots stay good, so `REPLAY_VERSION` stays 1 ([decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)). `sim/src/fixtures/walk-log.ts` pins a log with diagonal steps and the switch. Once a world has logged `solid_buildings` or a diagonal step, code from before this change can't replay it, so it can't be rolled back past.
- The walker's prediction is a drawing, never the truth: the mirror moves only on `moved` events. A step refused for a reason the mirror couldn't see (a block placed a moment before) stops the walk, and your figure walks back to the server's tile. A second step already sent behind it may still land, from the tile the server has you on; once both are answered your figure goes wherever that left you.
- Code: `sim/src/walk.ts` (with `walk.test.ts`), the `move` and `putter` cases in `sim/src/apply.ts`, `planPutter` in `sim/src/putter.ts`, `checkOpenShop` in `sim/src/shop.ts`, `solidBuildings` in `server/src/world-service.ts`, `client/src/walk.ts` and `client/src/motion.ts` (each with tests), the d-pad and keys in `client/src/world.ts`, and `Mirror.ground()`.
