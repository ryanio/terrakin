---
title: A home's levels are floors in the API and an upstairs in what players read, and storey is retired
date: 2026-10-10
status: accepted
tags: [sim, protocol, server, client, floors, replay]
---

# A home's levels are floors in the API and an upstairs in what players read, and storey is retired

## Context

Homes with more than one level shipped on 2026-10-09 under the word "storey" ([RFC 0028](../../rfcs/0028-homes-with-storeys.md), decisions 0242 to 0245). Ryan decided the next day that the word is wrong for the people who play: it is a British spelling, and it reads as an Instagram or Facebook "story".

The word was in the sim's state keys, commands, events, and refusals, in the API, in the web's copy, and in the docs. The rename also ran into a word already in use: the sim and the docs called the planks and tiles a resident lays "floors", and had helpers named for them.

Terrakin is pre-alpha, so `v1` can break ([decision 0146](0146-while-terrakin-is-pre-alpha-v1-can-break-announced-in-the-ch.md)). On terrakin.org no plot had added a level yet: `add_storey` had never been accepted, so no logged input changed the world through the old names. The live log was read through a staff session on 2026-10-10 to check: 13,134 inputs, none an `add_storey` and none with a `storey` field of any value.

## Decision

Players read "upstairs". The API and the code say `floor`, a level of a home and always a number, with 0 the ground floor. What a resident lays on a tile is "flooring", and its API name stays `ground`. No alias and no deprecation period.

What players read:

| Before | Now |
|--------|-----|
| "Add a storey, 200 coins" | "Add an upstairs, 200 coins" |
| "2 storeys" under a plot photo | "2 floors" |
| "Ground floor" and "Upstairs" in the pickers | the same |
| "Plank floor" (the ground kind `planks`) | "Plank flooring" |
| "There's no floor there." (walking upstairs) | "There's no flooring there." |

The API and the sim:

| Before | Now |
|--------|-----|
| the field `storey` on `place`, `remove`, `lay`, `lift`, every `build` entry, blocks, ground, residents, and events | `floor` |
| the action `add_storey` | `add_floor` |
| the event `storey_added` | `floor_added` |
| a plot's `storeys` | `floors` |
| the coin reason `storey` | `floor` |
| the refusal `no_storey` | `no_floor` |
| `{"storey": n}` on `POST /v1/plots/photo` | `{"floor": n}` |
| the check-in suggestion `storey` (added on 2026-10-10) | `upstairs` |
| `state.storeys`, `plot.storeys`, `resident.storey` | `state.floors`, `plot.floors`, `resident.floor` |
| `STOREYS`, `StoreyLayer`, `StoreyView`, `storeyOf`, `storeyGround`, `storeyField`, `standingStorey`, `setStorey`, `checkAddStorey` | `FLOORS`, `FloorLayer`, `FloorView`, `floorOf`, `floorGround`, `floorField`, `standingFloor`, `setFloor`, `checkAddFloor` |
| `packages/sim/src/storeys.ts`, `storeys.test.ts`, `fixtures/storeys-log.ts` | `floors.ts`, `floors.test.ts`, `fixtures/floors-log.ts` |
| `packages/protocol/src/storeys.ts` with `storeyName` | `floors.ts` with `floorName` |
| `packages/client/src/storeys.ts`, `storey-chips.ts`, `#palette-storeys`, `#add-storey` | `floors.ts`, `floor-chips.ts`, `#palette-floors`, `#add-floor` |
| `scripts/economy-sim.ts --no-storeys` | `--no-floors` |

Names that meant laid tiles and would have collided now say flooring:

| Before | Now |
|--------|-----|
| the walking obstacle `no_floor` ("There's no floor there") | `no_flooring` |
| `floorProblem`, `floorHeld` in the sim | `flooringProblem`, `flooringHeld` |
| `upstairsGroundOf`'s fact `floor` | `flooring` |
| `floorSlabs` in the 3D views | `flooringSlabs` |
| `underFloor`, `UNDER_FLOOR_ALPHA`, `UNDER_FLOOR_OPACITY` | `underFlooring`, `UNDER_FLOORING_ALPHA`, `UNDER_FLOORING_OPACITY` |
| `PlotFloor` and a level's `floors` list in the plot photo's data | `PlotFlooring` and `flooring` |
| `PlotStorey` in the plot photo's data | `PlotFloor` |
| "paths and floors" in docs and comments | "paths and flooring" |

`floorPlan` on a plot photo keeps its name: it is the plan of one floor.

RFC 0028, decisions 0242 to 0245, the handoffs, the devlog post of 2026-10-09, and the changelog entries of 2026-10-09 and 2026-10-10 keep the old words. Read them with the tables above.

## Replay

`REPLAY_VERSION` stays at 1. [Decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md) bumps it only when existing logs replay to a different world, and a bump throws away every snapshot.

- The renamed state keys are absent until a plot adds a level, and no live world has one. A world without them serializes byte for byte as it did, so every verified snapshot is still the world the new code would rebuild, and the live log replays to the same hash.
- The live log holds no input with a `storey` field. A log elsewhere may carry `storey: 0` on a ground-floor action. The rules read `floor` now and never see the old key, and absent or 0 it always meant the ground floor. `floors.test.ts` replays the build log with `storey: 0` on every tile it touches, input by input, to the same events and the same hashes.
- Every fixture hash is unchanged but one. `FLOORS_HASH` (the log that adds a level and builds on it) moved from `0ec80c95` to `0147ec19`, because that world holds the renamed keys. The world is otherwise the same: the old fixture's canonical JSON with the keys `storeys` and `storey` and the coin reason renamed equals the new one's.
- The server's one-time switches and the Worker's options did not change.

## Consequences

- An agent on older docs is told what to send. `add_storey` is an unknown action whose answer carries `did_you_mean: "add_floor"`, from the shared-word match the protocol already had. A `storey` field with a level above the ground is refused with `did_you_mean: "floor"`, on an action and on a `build` plan's entries (`RENAMED_FIELDS` in `packages/protocol/src/suggest.ts`): dropped silently, it would build on the ground floor. `storey: 0` on an action is passed over like any unknown field. On `POST /v1/plots/photo` the old field is refused whatever it carries (`renamedField`, asked by the dispatcher before it parses any body but an action): there 0 asked for the ground floor's plan, and dropped it would draw the whole home and keep it as an upload.
- A world that did log `add_storey` (a dev or self-hosted world between 2026-10-09 and this change) will not boot on the new sim, which refuses the unknown command on replay. Start such a world fresh. For `pnpm dev:test` that means deleting `.dev-test-world/`.
- A resident the check-in suggested `storey` to on 2026-10-10 may get the `upstairs` suggestion once more within the month, since the suggestion table keys on the id.
- New code and docs keep the two words apart: `floor` for a level, flooring for what is laid.
