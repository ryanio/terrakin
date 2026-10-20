# RFC 0041: Materials worth choosing, and an upstairs you can see

- Author: drafted by Claude for Ryan
- Date: 2026-10-20
- Status: draft
- Discussion: <PR link>
- Builds on: [RFC 0016](0016-build-with-what-you-gather.md) (held blocks and ground kinds, the model this copies), [RFC 0028](0028-homes-with-storeys.md) (the upstairs, and the roof it parked), [RFC 0021](0021-collections-and-foraging.md) (the finds these are made from), [RFC 0032](0032-homes-agents-can-design.md) (the designs that would offer them)

## Summary

Two changes with one purpose, which is that homes should look like someone chose them.

Walls are built from four blocks: wood, stone, glass and leaf. They are free, unlimited, and the same for everyone, so every home on the grid is a variation on the same two greys and one brown. This adds made materials, each a held block crafted at a workbench from what you gather, so a wall can say where you forage.

And an upstairs costs 200 coins and cannot be seen from outside. Homes have no roofs: from above you look straight into every room, on the ground floor and the one above it alike. A resident saves about nine days, spends the most expensive thing in the game, and their home looks the same from the street as their neighbour's bungalow. This gives the top floor a roof, chosen as a look rather than built tile by tile, so the money buys something the town can see.

## Motivation

The persona is the homesteader, and the problem is one the funnel cannot show: there is nothing to come back for once the hut is up.

**Four materials is not a choice.** `BUILDING_BLOCKS` is `wood, stone, glass, leaf`, and the design picker in RFC 0032 offers fewer still: `WALLS` is `["wood", "stone"]` and `WINDOWS` is `["glass", "leaf"]`. A newcomer picking a design picks between a brown house and a grey one. Plots to visit is a page of near-identical homes, which undercuts the one feature built to make people look at each other's work.

**The finds are already there and lead nowhere.** RFC 0021 put seventeen finds on the ground, sorted by biome: driftwood, sea glass, seashells and starfish on the shore; crystal, fossil and geode in the stone; acorns, pinecones, chestnuts, mushrooms, feathers and holly in the forest; clover, maple leaves and cherry blossom in the meadow. Today they go in the collection book and on a pedestal. They are the obvious source for a material that says where you walk, and using them gives foraging a second reason.

**200 coins buys something invisible.** This is the sharper of the two. RFC 0028 priced an upstairs at 200 coins deliberately, "a regular who saves for it holds it about nine days after arriving", and its own Alternatives parked the roof: "Homes have no roofs today, so this is a new art feature on top of storeys; a roof can be a later look on the top storey, and the cutaway works without it." That was right at the time and it is the thing now missing. The cutaway rule it shipped, "you see the storey you're on, and the rest of the world from above", is exactly the rule a roof needs: a roof is what "from above" should show.

## Design

### Part one: made materials

The four free blocks stay free and stay forever. Nothing a newcomer builds gets more expensive, no starter home changes, and no design stops working. New materials are extras on top.

A made material is a held block, like furniture (RFC 0016): crafted at a workbench, kept in your things, placed one per tile, and given back when taken up. Placing one is the same `place` with a different kind, and the existing `blockNeeds` and `blockPlaceProblem` already handle a held block, so the sim side is a catalog entry and a recipe rather than a new mechanic.

The proposed first set, chosen so each is one recipe deep and each points at a different biome:

| Material | Made from | Reads as |
|----------|-----------|----------|
| `plaster` | 2 stone | A clean white wall; the one everyone can make |
| `brick` | 2 stone, 1 wood (fired) | Warm red, the village terrace |
| `driftwood_wall` | 3 driftwood | Silver-grey and weathered; shore |
| `timber_frame` | 1 plaster, 2 wood | Dark beams over plaster; the storybook house |
| `sea_glass_pane` | 2 sea glass | A window with colour in it; shore |
| `crystal_pane` | 2 crystal | A window that catches the light; stone country |

Six is a guess at the right number and the exact list is an open question. The shape is the point: two anyone can make from what the ground gives everywhere, and four that need a biome you had to walk to.

Each needs a colour in the sim's palette, a drawn picture in `item-art.ts`, a map drawing in `render/blocks.ts`, and a `scene3d/palette.ts` entry with a `form` (`voxel` for the solid ones, the glass treatment for the panes). That is the real cost of a material and it is per material, which is the argument for a small set done well.

`WALLS` and `WINDOWS` in `designs.ts` grow to include them, so a design can be built in any material you hold enough of, with the free ones always offered and a made one offered when your things cover the count the design needs.

### Part two: a roof is a look, not a build

A roof belongs to the plot's top floor and is chosen, not placed. One field on the plot, set by a new action:

```json
{"type": "set_roof", "px": 7, "py": 8, "style": "gable", "material": "thatch"}
```

- `style`: `flat` (today, and the default), `gable`, `hip`, `pitched`.
- `material`: `thatch`, `slate`, `tile`, or a made material you hold.

It is a look rather than twenty-five placed blocks for three reasons. It is reversible, so people try one and change their mind, which is what makes it fun rather than a commitment. It takes no second build on a plot whose owner already did the hard part. And it cannot hide anything, which matters: RFC 0028's Security considerations worry about "hiding things under a roof", and a roof that is one field the server draws has nothing under it that the snapshot and the plan route do not already carry.

**When it is drawn** follows the rule RFC 0028 already shipped, with nothing new to learn: you see the floor you are on, and the rest of the world from above. A roof is part of "from above". Stand on the plot, or pick that floor in the 3D home view, and the roof lifts away exactly as flooring does today. Stand in the street and the home has a roof. So the same cutaway code answers it, and a neighbour's home finally reads as a home rather than a floor plan.

A plot with no upstairs may also set a roof, for the same 200-coin reason in reverse: it should be the floor that makes the roof worth having, not the roof that is gated. This is an open question below.

### What it costs

A roof style is free to choose and free to change. The material is held, like a wall: thatch from gathered straw, slate from stone, tile made at a workbench. So the roof costs the materials to cover the footprint once, and changing your mind costs the difference rather than the whole roof again.

## Invariants

- **Server decides.** `set_roof` is checked like every build: the plot is yours or shared with you, you hold the material, and the sim's own `canBuildOn` answers. The client offers a style only when the sim would take it.
- **Determinism.** A roof is a logged input and a field on the plot, so it replays like any build. No clock, no randomness. `REPLAY_VERSION` moves because the world gains a field, and every fixture in `packages/sim/src/fixtures/` is re-pinned, which is the ordinary cost of a world change.
- **Chat is untrusted.** A material and a style are enum values, never text. Nothing here takes a resident's words.
- **Protocol compatibility.** New block kinds are additive values on `BlockKind`, and `set_roof` is a new action; `roof` on a plot is a new optional field. A client that does not know a kind draws nothing for it, so the rule in `packages/protocol/AGENTS.md` about pre-alpha breaking changes is not needed: nothing existing changes meaning.

## Economy impact

New sinks, no new sources.

Every made material consumes gathered or found things that today have no use beyond the collection book and a pedestal, so this drains stock rather than creating it. Nothing here mints coins. The one coin interaction is the roof's relationship to `add_floor`'s 200, which it does not change: the floor still costs 200, and the roof makes that purchase visible, which is the point.

The risk to watch is the opposite of inflation: making a find worth spending could empty the collection book, since a resident may craft away the only geode they ever picked up. The book records the day you first held a kind and never unrecords it (`packages/server/src/collection.ts`), so spending a find does not lose the entry. Worth a test.

Numbers (how many finds per wall) want the same treatment the coin numbers got in decision 0039: a simulated month before they ship, not a guess in an RFC.

## Security considerations

- **Hiding things under a roof**, which RFC 0028 raised about floors, is answered by making the roof a field rather than a build: there is nothing between the roof and the floor below it, the snapshot and `GET /v1/plots/{px}/{py}/plan` carry it, and staff read a reported plot floor by floor with the same code the floor-plan photo uses.
- **No new text surface.** A style and a material are enums, so there is nothing to filter and nothing a resident can write into the world through this.
- **Prompt injection.** None: nothing here reads resident text, and no flow can be started by anything a resident writes.
- **Cost of drawing.** A roof is a mesh per plot in 3D and a pass on the map, both bounded by the plots already drawn, so decision 0030's frame budget and decision 0060's view radius hold. A roof must not add a light or a shadow.

## Agent experience

An agent gains one action and some kinds. `SKILL.md` gets the new materials in its generated catalog table (they come from the sim's catalog, so `pnpm gen` writes them), their recipes in the furniture table, and a short paragraph on `set_roof` under Building up. Its version moves, since an agent that read 4 would want to know a home can have a roof.

Nothing is required. An agent that never crafts a material builds exactly as it does today, and `build`'s `walls` and `windows` keep taking the four free kinds.

The nicer agent story is that a design plus a material is one call: an AI that knows its owner likes the shore can build the cottage in driftwood and sea glass, which is a better answer to "build me a home" than the same hut everyone else has.

## Migration and rollout

Existing logs replay the same up to the point the world gains the field: no past input changes meaning, and a plot with no roof reads as `flat`, which is what every plot looks like today. Old clients keep working and draw no roof.

1. The materials: catalog entries, recipes, palette colours, item art, the map and 3D looks. Shippable alone, and the smallest thing that makes the town look different.
2. `WALLS` and `WINDOWS` in `designs.ts`, so the picker offers them. One line and a test, and it is what makes step 1 reach a newcomer.
3. `set_roof`, the field, and the two renderers.
4. The build bar's roof picker, and the 3D home view.
5. `SKILL.md`, `docs/architecture.md`, a `CHANGELOG.md` entry, and a devlog post, which this is a good subject for.

Step 1 and step 2 together are a week's worth of small, safe work with a visible result, and they do not need steps 3 to 5 to be worth shipping.

## Alternatives considered

- **More free blocks.** Add four more colours of free wall and stop. Cheapest by far, and it fails the goal: free and unlimited means everyone uses the prettiest one, and the town becomes uniformly pink instead of uniformly grey. Scarcity is what makes a material a choice.
- **Paint a block rather than make a new one.** One `paint` action setting a colour on any wall. More expressive per block and much cheaper to draw, and rejected because a hex colour from a resident is a text surface with no enum to check, it makes the world's palette unbounded, and "my house is lime green" is the outcome the art direction in decision 0030 exists to avoid. A curated set is the same decision looks already made (decision 0029).
- **A roof as placed blocks on a third floor.** Consistent with how everything else is built, and rejected: it is another twenty-five-tile build on top of the one the resident just paid for, it reintroduces the hiding problem, and `FLOORS.max` is 1, so it would need raising for a reason that is not a floor.
- **Make the upstairs cheaper instead.** If 200 coins buys too little, lower it. Rejected because the price is not the problem; nine days of saving for something visible is a good goal, and nine days for something invisible is the bug.
- **Do nothing.** The grid fills around mid November (`docs/plans/README.md`), and RFC 0038's islands open more land. More land with the same four materials is more of the same town.

## Open questions

1. Which materials, and how many? Six above is a guess. The cost is per material and mostly art, so the right number is the one we can draw well.
2. How many finds does a wall take? Wants decision 0039's simulated month rather than a guess.
3. Can a plot with no upstairs set a roof? Saying yes makes a roof a thing everyone can have and weakens the 200 coins; saying no makes the floor the gate and the roof its reward. The draft leans yes, and the argument for no is good.
4. Does a made material belong in the collection book, like wear and finds, or is it a building supply the book ignores?
5. Should `FLOORS.max` rise above 1 at the same time, or does a roof give the top floor enough to say?
6. Do the townsfolk's homes get the new materials, seeded like their routines and pets (decision 0113)? They are the first homes a newcomer sees, so probably yes, and that is a seed change rather than a rule.
