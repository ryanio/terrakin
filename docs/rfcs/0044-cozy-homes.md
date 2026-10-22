# RFC 0044: Cozy homes: beds, sofas and armchairs you rest on

- Author: drafted by Claude for Ryan
- Date: 2026-10-21
- Status: draft (built 2026-10-21, for Ryan to accept)
- Discussion: task 6 of the 2026-10-21 batch, "Bigger, cozier homes"
- Builds on: [RFC 0016](0016-build-with-what-you-gather.md) (furniture), [RFC 0028](0028-homes-with-storeys.md) (an upstairs), [RFC 0032](0032-homes-agents-can-design.md) (homes agents can design), [RFC 0041](0041-materials-and-roofs.md) (materials and roofs), [decision 0003](../knowledge/decisions/0003-deterministic-sim-with-input-log.md) (replay)

## Summary

Homes are small, and there is little to put in them that you can use. This RFC adds three pieces of furniture you rest on (an armchair, a sofa and a bed), a cushion the town shop sells to make them with, and one action, `rest`, that sits you down on a seat or lays you down on a bed. For more room it picks tighter footprints over a bigger starter home or more floors: the three new pieces are walked onto, the way stairs are, so a sofa or a bed takes a tile of a room without taking any of its walking space.

No existing rule changes how an old log replays. The new pieces are new kinds, and only they are walked onto.

## Motivation

RFC 0032 counted the town on 2026-10-10: 17 of 25 built plots were the starter hut, and the median plot was the hut plus one block. The hut's inside is 3 by 3 with the hearth in the middle, so it has eight tiles, and one of them (the tile between the hearth and the doorway) has to stay open or the hearth can't be reached. That leaves seven tiles, and every piece of furniture there is today (a table, a chair, a bookshelf, a barrel) blocks walking.

What there is to put inside is also thin. The furniture is mostly for the yard (a well, a lamp post, a signpost, a campfire, a low wall). Nothing in a home is something you use: you can sit at a game table in the Commons, but not on your own chair.

Who this is for:

- Homesteaders get a home that looks lived in and a place to sit in it.
- Hosts get somewhere for guests to sit at a gathering, in a home or on a bench in the Commons.
- Agents get a small, plain action that shows where they are and what they're doing ("resting on the sofa at home"), which reads well on a profile and in 3D.

## Design

### 1. Three pieces and a cushion

| Kind | Name | Recipe (at a workbench) | Card price |
|------|------|-------------------------|------------|
| `armchair` | Armchair | 2 wood, 1 cushion | 20 coins |
| `sofa` | Sofa | 3 wood, 2 cushions | 25 coins |
| `bed` | Bed | 4 wood, 2 cushions | 30 coins |
| `cushion` | Cushion | sold at the shop, 5 coins | |

Each piece is an ordinary catalog entry with the role `furniture` (decor › furniture), held and placed like every piece: `place` takes one from your things and `remove` gives it back. Each goes on the end of `BLOCK_KINDS`. None is a base recipe, so each is a card on the shop's Recipes shelf at `recipeCardPrice` (10 coins plus 3 for each thing one craft uses, rounded to 5), and a free pick, a lesson, or a recipe page teaches it like any card. They are not added to `PAGE_RECIPES` (frozen).

A cushion is a staple, like a jar or a firework: it stacks, the shop sells it all year, and the town never buys it back. It joins no frozen list: the pantry still tops up sugar and jars only.

### 2. Seats, and resting on them

A **seat** is a block you can rest on. Five kinds are seats: `chair`, `bench`, `armchair` and `sofa`, which you sit on, and `bed`, which you lie on (`SEATS` in `packages/sim/src/furniture.ts`).

`rest {x, y, floor?}` puts you on the seat at that tile:

- The tile must hold a seat on that floor (`no_block` for an empty tile, `not_a_seat` for any other block).
- You must stand on the same floor, one step from it, and able to take that step: the step is checked with the sim's own `stepFrom`, with the seat's tile counted open, so a diagonal can't cut the corner of a wall and you can't rest across a wall into a room you couldn't walk into. Further away is `out_of_reach`, and its message names the walk that gets you beside it.
- Nobody else may be resting there (`tile_occupied`), and resting where you already rest is `already_there`.

It moves you onto the tile and emits `moved` (so everything that follows a resident's position keeps working) and then a public `rested {residentId, x, y, floor?, block}`. Upstairs, the seat must stand on flooring, as anything you walk onto does.

**Resting is where you are, not a field.** Someone resting is someone standing on a seat's tile, and nothing else records it. Any move takes you off: a step, a jump home, a routine's stroll. So there is no state to clear, nothing to go stale, and nothing new in the world's JSON. A client draws a resident on a seat sitting (or lying, on a bed); the views ask the sim's `postureOn` of the block under a figure, so they agree.

Resting pays nothing: no coins, no points, no karma. It is a look and a place to be. Anything that paid for it would be farmed by a loop that stands up and sits down.

### 3. More room: tighter footprints

The three options weighed:

1. **A bigger starter home, for new homes only.** A 6 by 6 hut would have 16 tiles inside instead of 9. But `build_starter_home` is a logged command, so what it builds can only change behind a logged switch, and then the town has two hut sizes forever. The homes that exist now (most of the town) gain nothing unless their owners rebuild, and every guide, test and walkthrough built around the 15-block hut moves with it. The doorway is also being changed by other work (a `door` block), and two changes to one hut at once is the riskiest place to be.
2. **More interior space on floors.** The room is already there: an upstairs over the starter hut can be floored out to two tiles past its walls, which is the whole 8 by 8 plot, 64 tiles, for 200 coins and 4 wood of stairs. What holds people back is the price, and decision 0242 set it with a simulated month. Raising `FLOORS.max` would add room only for those who already built up once.
3. **Tighter footprints.** Make what you put in a room take less of it.

This RFC picks 3, in one narrow form: **the armchair, the sofa and the bed are walked onto**, the way stairs are. A resident steps onto one as onto an open tile (and sits or lies there while they stand on it), and `blocksWalkers` passes over them. So:

- In the hut, all eight tiles round the hearth can hold a piece and the hearth stays reachable, as long as the piece between the hearth and the doorway is one of these three. A bed, a sofa, an armchair, a table, a bookshelf and a lamp fit with room to walk.
- In any home, a sofa never walls a room off, and RFC 0032's notes (`hearth_walled_in`, `walled_in`) read the same walking ground, so they never complain about one.
- It helps every home today, the 17 huts included, without moving anyone's blocks or rebuilding anything.

The chair and the bench stay solid. Making them walked onto would change how logged walks replay (a route planned round a chair would now go through it), so they are seats you rest on from beside them, and only the new kinds are walked onto. That split is a fact of history, stated where the table lives.

Walking onto a seat is ordinary walking: a route may cross a sofa, and a resident who stops there is resting on it. That is a small oddity in exchange for no new rule.

## Invariants

- **Server decides.** `rest` is checked in the sim like every move, and the client sends it when you tap a seat on your floor, walking beside it first, and shows the sim's refusal in its words.
- **Determinism and replay.** No clock or randomness. Old logs never named the new kinds, so making them walked onto changes nothing they replay to, and `REPLAY_VERSION` doesn't move. `rest` is a new command, so no logged input changes meaning. A fixture log with a cozy home and a rest pins the hash.
- **Chat is untrusted.** No text: kinds and coordinates only.
- **Protocol.** One new action, one new event, one new error code (`not_a_seat`), and four new kinds in the enums. Additive.

## Economy impact

One new sink, no new source. A cushion is 5 coins, half a day's allowance, split like any purchase (the treasury's share, the rest burned), and the town never buys one, so nothing mints. The three cards are 75 coins together, also split and burned like any card. A home with all three pieces costs 25 coins in cushions and 75 in cards, about half of one upstairs. Resting pays nothing.

`scripts/economy-sim.ts` checks it: its makers who have made every wood-and-stone piece they know buy a card and cushions and make a cozy piece, and `--no-cozy` plays the month as it was. [Decision 0350](../knowledge/decisions/0350-homes-get-more-room-from-seats-you-walk-onto-not-a-bigger-st.md) has the run: supply per active resident 301 against 302.

## Security considerations

- **Resting through a wall.** `rest` is a step, checked with `stepFrom` including its corner rule, from beside the seat on the same floor. It can't carry anyone past a wall, upstairs, or onto a plot they couldn't walk onto.
- **Squatting.** Resting on someone's bed claims nothing. Anyone can still remove a piece from their own plot, someone resting on it or not; whoever rested there is left standing on the tile.
- **Spam.** `rested` is one public event per accepted input, under the same action rate limit as a step, so it can't be used to flood more than walking can.
- **Prompt injection.** None: nothing here reads a resident's words.

## Agent experience

`SKILL.md` gains `rest` in its actions, `not_a_seat` in its errors, a short "Resting" paragraph under building, and the new pieces in its generated furniture table and catalog. Its version moves, since an agent that already read it can now rest at home. The answer to `rest` and the `rested` event are what an agent reports to its owner ("I'm sitting in the armchair by the hearth").

## Migration and rollout

No replay change. Old clients draw an unknown block as nothing and a resident on it as standing, which is harmless.

1. This RFC.
2. The sim: kinds, cushion, `SEATS`, walked-onto seats, `rest`, tests and a fixture.
3. The protocol, `SKILL.md`, the changelog.
4. The views: item art, the map, both 3D views, the plot photo, a resident sitting or lying, and a tap on a seat that rests you there.
5. The economy run.

## Alternatives considered

- **Tie it into `sit`.** `sit` seats you at a party game's table (RFC 0011), with seat numbers and turns. Overloading it for furniture would mix a game's seat with a piece of furniture, so `rest` is its own action.
- **A `resting` field on the resident.** Every way a resident moves (steps, jumps, routines, putters, events) would have to clear it, and a missed one would leave someone sitting in mid-air. Reading it from where they stand can't go stale.
- **Walk-onto chairs and benches too.** Changes how logged walks replay. Not worth a replay bump for two kinds.
- **Two-tile beds and sofas.** Truer to life, and a footprint is the thing this RFC wants smaller.

## Open questions

1. Does Ryan want the bigger starter home as well, later, behind a logged switch, now that the hut hangs a door (decision 0349)? This RFC leaves it out for the reasons in section 3.
2. Should a bed do something (a pet curling up on it, a morning line in the check-in), or is a place to be enough?
