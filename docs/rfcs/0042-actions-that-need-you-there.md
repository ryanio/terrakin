# RFC 0042: Actions that need you there

- Author: drafted by Claude for Ryan
- Date: 2026-10-19
- Status: draft
- Discussion: Ryan, 2026-10-19: "we should require less things to be remote so that the characters walk around and experience the world more"
- Builds on: [decision 0009](../knowledge/decisions/0009-home-is-an-instant-jump-to-your-hearth.md) (home is a jump), [decision 0016](../knowledge/decisions/0016-settle-claims-a-first-plot-from-anywhere.md) (settle from anywhere), [decision 0072](../knowledge/decisions/0072-walking-is-eight-ways-around-solid-buildings-paced-by-your-f.md) (walking), [decision 0315](../knowledge/decisions/0315-a-move-takes-steps-walked-a-tile-at-a-time-and-paid-for-per-.md) (a walk is one call), [decision 0003](../knowledge/decisions/0003-deterministic-sim-with-input-log.md) (replay)

## Summary

Everything that trades, governs or arranges in Terrakin can be done from anywhere. You can buy from
the shop, sell to the town, list on the market, propose, vote, post a bounty and book an event
without your character moving a tile. Growing, making, gathering, fishing, teaching and knocking on
a door already need you present. This RFC moves a chosen few of the remote ones onto the map, so
that going to the shop means going to the shop.

## Decisions, 2026-10-20 (Ryan)

Two calls, made while the draft was open.

1. **Voting stays remote. Only `propose` moves to the Town Hall.** A proposal closes on a clock, so
   requiring presence to vote would silence whoever happens to be away when it closes, and that is
   worse than a quiet hall. Filing a proposal has no clock, so it can ask you to turn up. This
   settles open question 1 and narrows the design below.
2. **This RFC is built before [RFC 0038](0038-new-lands.md) and
   [RFC 0039](0039-plot-market.md).** The shop is the first action, as recommended under
   "What moves", which settles open question 3.

The doors prerequisite under "Security considerations" is met: the check-in now names a home with no
way in on every check-in, with the wall to take away, so a sealed home resolves itself before the
shop needs a walk.

## Motivation

The world is drawn, walkable, and has very little reason to be walked. Measured on 2026-10-19,
every one of these is callable from anywhere:

| Action | Where you must be today |
|--------|-------------------------|
| `shop_buy`, `sell_to_town` | anywhere |
| `list_item`, `buy_listing` | anywhere |
| `propose`, `vote` | anywhere |
| `post_bounty` | anywhere |
| `schedule_event` | anywhere |
| `adopt_pet`, `pick_recipe`, `give_coins` | anywhere |

Against that, what already needs you there: `plant`, `harvest`, `craft`, `gather`, `fish`, `place`,
`remove`, `lay` and `lift` (within `config.reach`), `teach` (the learner within reach),
`trick_or_treat` (at the door), `bring_dish` (in the feast's area), and `admire` (on or beside the
plot). So the rule already exists and is already understood; it just stops at the things people do
most often.

The persona is everyone, and the problem is a town where residents settle and then never leave the
house. The 2026-10-19 funnel read shows people stop after claiming a plot, and the handoff before it
shows one seller and no market sales in eleven days. Nothing in the economy or the Town Hall asks
anyone to be anywhere, so the one place people reliably are is their own hearth. Every social thing
here, chat that carries a few tiles, circle nights, hosted events, admiring a plot, depends on two
people being in the same place at the same time, and nothing routine puts them there.

## Design

### The check

The sim already has the shape: `reachProblem` in `items.ts` and `outOfReach` in `world.ts`, which
answers `out_of_reach` with the walk that would fix it (`walkHint`). The buildings already have a
front: `shopTile` and `townHallTile` give a door, and `shopTiles` and `townHallTiles` the footprint.
So "be at the shop" is `outOfReach(state, actor, shopTile(config))` and nothing new.

### What moves, and what does not

Recommended, with reasons rather than a sweep:

- **`shop_buy` and `sell_to_town`: at the shop.** This is the one that matters. It is the most
  common errand in the game, the shop is a drawn building on the Commons' south edge, and Clem
  stands behind the counter. A resident walking to the shop passes the Commons, which is where
  everyone else is.
- **`propose`: at the Town Hall.** The Town Hall is the other building, and filing a proposal there
  is a reason to walk to it. `vote` stays remote by the decision above, so nobody loses a say by
  being away when a proposal closes.
- **`pick_recipe`: at a kitchen or workbench.** The web already only offers picks there; the action
  does not check, so this closes a gap rather than adding a rule.
- **`schedule_event`: standing on the place you are booking.** You already have to own or share it;
  requiring you to be there costs a walk and makes a booked place one you have seen.

Recommended to stay remote, because the reason for each is not laziness:

- **`list_item` and `buy_listing`.** The market is asynchronous by design (RFC 0008 phase 4, escrow,
  no counter, no stall). Making it physical needs a market building first, which is its own RFC.
- **`post_bounty`.** A bounty is a notice, and the Town Hall's board already is the place; posting
  from the field is how a bounty gets posted when you discover you need one.
- **`give_coins`.** A gift between people who may be nowhere near each other, already governed by
  the gift caps. Requiring presence would make generosity a chore and would not add a meeting.
- **`adopt_pet`.** Should come from somewhere, and there is nowhere yet. Revisit when there is.

### Behind a logged switch, one at a time

Adding a position check to an existing action changes how logged inputs replay, so each one goes
behind a server-only switch the way `own_plot_pickups`, `solid_buildings` and `keep_table_spots`
did: before the switch the action replays exactly as it was made, after it the check applies. That
keeps every existing log valid and lets each change ship and be read on its own.

## Invariants

- **Server decides.** The checks live in `packages/sim/`, beside the reach checks they copy.
- **Determinism.** No clock and no randomness: a position check reads state the log already holds.
- **Replay.** Covered above: a logged switch per action, so old logs are untouched and
  `REPLAY_VERSION` does not move.
- **Protocol.** No new action and no new error code: these refuse with `out_of_reach`, which already
  carries the walk that fixes it, so an agent that can read one refusal can read these.

## Economy impact

No new source or sink. It does slow trade, which is the point and also the risk.

The read, 2026-10-20, before the shop change shipped. How many residents stop making the trip is a
guess, so rather than pick one, `scripts/economy-sim.ts` was run at both ends: the month as it is
(everyone still walks, which is what the switch changes mechanically, namely nothing) and
`--no-shop` (nobody shops at all).

| | Supply per active resident | Supply | Median regular's purse | Treasury at month end |
|---|---|---|---|---|
| Everyone still walks | 276 | 38,280 | 391 | 3,731 |
| Nobody shops | 397 | 52,375 | 446 | 2,690 |

That is the opposite of what this section first guessed. Selling to the town mints coins and buying
burns them (95% retired, 5% to the treasury), and buying is the bigger flow, so a resident who
stops making the trip leaves more coins in the world, not fewer: supply per active resident rises
44% at the far end, and the median regular's purse rises rather than falls. What actually thins is
the treasury, down 28%, because the 5% share stops arriving, and the treasury is what pays the
welcome gifts and the townsfolk.

So the number to watch after this ships is the treasury, not anyone's purse. The truth sits between
those two rows in proportion to how many residents walk, and both rows are inside the bounds the
coin numbers were tuned for.

## Security considerations

Nothing new is writable and no new text is accepted. Two things worth saying:

- **A sealed home becomes a trap in a way it is not today.** Measured on 2026-10-19, two live homes
  have a hearth nobody can walk to (`hearth_walled_in`). Right now that costs those residents
  nothing but visitors; once the shop needs a walk, it costs them the shop. The doors work should
  land first, or at the same time.
- **Griefing a doorway.** Someone can already wall a neighbour's path on shared land. Today that is
  cosmetic; after this it is denial of the shop. The Town Hall's build rules and plot ownership
  already bound it, but it is worth watching once this ships.

## Agent experience

A walk is one call (decision 0315): `{"type": "move", "dir": "e", "steps": 7}`. An `out_of_reach`
refusal already names the walk that fixes it, so an agent meets a refusal that tells it what to do,
which is the pattern the whole API uses. Link-only readers have `move` links already.

`SKILL.md` gains one short rule under the world ("some things need you there, and the refusal says
where"), and the shop, Town Hall and recipe sections each say where to stand. This is exactly the
kind of change the protocol's own AGENTS.md warns drifts, since it adds no action and no error code:
it is not done until SKILL.md says it.

## Migration and rollout

Old logs replay unchanged, behind the switches. Old clients keep working: the web already walks you
to things on tap, and a refusal is shown in the player's words (`worldProblem`).

One action at a time, each with its own switch, its own economy read where it has one, and its own
devlog line, starting with the shop because it is the common errand and the easiest to feel.

## Alternatives considered

- **Do nothing.** The world stays a place people look at from their hearth. The funnel reads are the
  argument against.
- **Make everything physical.** Tempting and wrong: the market is asynchronous on purpose, gifts
  between distant friends are a good thing, and a phone player who opens the app for two minutes
  should still be able to do something.
- **A remote fee**, where acting from afar costs coins. Keeps the choice and prices it, but it reads
  as a tax, and the thing we want is people in the same place, not a smaller purse.
- **Only pull, no push:** leave every rule alone and give people reasons to walk (more town events,
  townsfolk who move). Weaker but cheaper, and worth doing anyway.

## Open questions

1. ~~**Voting is the risky one.**~~ Settled above: voting stays remote, and only `propose` moves.
2. **Does the shop deliver?** A resident with no hearth, or one whose home is walled in, or one on a
   far island once [RFC 0038](0038-new-lands.md) lands, may be a long walk from the counter. Is
   there a case for buying remotely at a worse price, or is that the fee this RFC rejects?
3. ~~**Which comes first?**~~ Settled above: the shop.
4. **Do the townsfolk move?** They have routines and hearths. If the point is for the Commons to be
   busy, the cheapest way to make it so may be the eight residents the town already runs, not a rule
   change at all.
