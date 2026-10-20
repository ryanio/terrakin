---
title: "Review of four days: the sea, the channel, the chunk signature, and eleven more"
date: 2026-10-20
tags: [review, lands, roofs, walk, cards, process]
---

# Review of four days: the sea, the channel, the chunk signature, and eleven more

A read of everything between c3ad8ad6 (2026-10-17) and 9c02d7d3: islands, materials and roofs,
the ridge, prints, plot cards, the in-person rules, the walk hints, musegod. 97 commits, 389
files. `pnpm verify` and `pnpm e2e` were green before it started and are green after, which is
the point worth sitting with: everything below was shipped past a green gate.

## What was wrong, and is now fixed

**A resident could own the channel and cut an island off.** `settle` asks `onLand`; `claim` never
did. A bridge tile sits inside a water plot slot, so the first resident across could `claim` the
crossing, place two blocks on it, and nobody but them or staff could take those down (`remove`
needs `canBuildOn`). They could also build out into open water and set a hearth on a sea tile with
no step off it. `claim` now refuses with `settle`'s own words. This is the one finding that would
have been a live griefing hole the day a land opened.

**Fishing read the sea as nothing.** `isWater` was a pond block and nothing else, so anyone beside
the open water was refused `no_water` and told to dig a pond out of their own stone. The sea is
water now and the same fish bite ([decision 0339](../decisions/0339-the-sea-is-water-you-can-fish-in-and-the-same-fish-bite.md)).
Whether the sea gets fish **of its own** is still nobody's decision.

**The free-plot hint pointed at water.** `nearestFreePlot` walked the grown grid and skipped only
squares and claimed plots, so "Try settle at px 3, py 0" could name the channel, which `settle`
then refuses. An agent following the refusal looped. Both server-side pickers had been fixed in
the slice; the sim's own hint had not.

**`merge_resident` burned a roof's covering.** It checks `plotHasAnything`, which a roof is not on
(a roof lives on the plot's record), then deletes the record. `release` refuses exactly this case
and says why. Eight brickwork could go with no event and no refund, and nothing catches it after,
since items have no supply identity the way coins do.

**The 3D world rebuilt every roofed plot on every input.** `readChunk` put a roof in a chunk's
signature and `chunkSignature`, the cheap twin that decides whether to rebuild, did not, so the
two could never match for a plot with a roof. Every geometry on those plots was disposed and
recreated on each input anyone sent. The ridge was missing from both, so fixing the first alone
would have left a new vane invisible until something else changed the plot.

**A walk a refusal names could ask for more steps than one `move` takes.** `move e 7 times` is the
contract for `{"steps": 7}`, capped at 10. A detour round a wall could say `move s 36 times`,
which fails the schema before the sim sees it. Legs are split at `WALK_LEG_MAX` now, and the
protocol pins the two constants together, because the sim can't import the protocol.

**The refusal you get upstairs named a walk from the wrong tile.** `move down` puts you on the
staircase, not on the tile you stand on upstairs, so the walk planned from up there pointed at
your own walls. It now gives the distance and no walk; the refusal after you come down names a
right one.

**`noFlooringHint` named a `lay` the sim refuses**, for the plot the step aimed at rather than the
one you stand on, and the refusal that led to offered to spend 200 coins adding an upstairs to
someone else's plot.

**A plot photo at night was a dark rectangle on a pale field.** The paper wash on the sliver of
world round a plot sits under the night, which is a multiply, so after dark the band stayed light
and the plot went muddy ([decision 0340](../decisions/0340-a-plot-photo-s-surround-wash-fades-out-as-the-light-goes.md)).
Ryan spotted it on a posted photo. The samples had a night photo and a photo with the sliver and
never one with both, which is why nothing caught it.

**Server-drawn pictures painted the sea and the bridge as grass**, so a cached public PNG
contradicted the live client. **The link pages called the water column "free"**, which is the
wrong instruction in a link-only agent's hands. **The mirror never learned an island's hall and
counter**, so a tab open when a land opens would route walks through buildings it can't see.
**`offBuildings` built its ground without the sea** (unreachable today, one line). **A card
clipped a roof's tiles before working out its ridge**, so a neighbour's roof at the picture's edge
drew its ridge along the highest visible tile. **The published changelog stated the wrong rule for
where the ridge mark stands** (the middle, not the first of the highest tiles), and the test meant
to pin decision 0337 only checked it was *a* highest tile. **SKILL.md said the counter and the hall
rules were terrakin.org-only**; both adapters set them, so every self-hosted and dev world has
them.

Three pins were added where an invariant was stated and nothing held it: prints at the end of
`PATTERNS`, the ridge tile in reading order, and `WALK_LEG_MAX` against `MOVE_MAX_STEPS`.

## What this says about the gate

Six of these were in code with tests around it, and the tests passed. The pattern, three times
over: **a list the compiler doesn't check, or a pair of functions that have to agree and nothing
compares them.** `chunkSignature` against `readChunk` is the sharpest case, and `world-3d.test.ts`
already asserted that equality for presents, blocks, ground, paving, crops, displays, `lit` and
`cut`, and had no roof row. One line in a table would have caught it.

The plot photo is the other shape: two features that are each right alone and wrong together, with
a sample for each and none for the pair. Where a renderer stacks washes and glazes, the pair is
the test.

## What came after the review, in the same session

**A production outage the review didn't find, Sentry did.** `GET /v1/plots/{px}/{py}` had been
answering 500 since the ridge shipped: `no such column: ridge`. `NEWS_FIELDS` gained a field and
`plots.ts` interpolates that list into `CREATE TABLE IF NOT EXISTS plot_news`, which does nothing
to a table that already exists. Every read **and every write** of a plot's news failed for about a
day, so no plot recorded news in that window and those days' counts are gone. The column is added
on boot now, with two guards and a rule in `packages/server/AGENTS.md`
([learning](../learnings/2026-10-20-a-column-added-to-a-create-table-if-not-exists-never-reaches.md)).
The gate was green the whole time, because every test builds a fresh world where the column is
right there. **That is the bug class worth remembering: state that exists only in production.**

Client sourcemaps are on, so the next browser error is readable. The one open web issue
(TERRAKIN-WEB-7, a `TypeError` on `/world`, once, 2026-10-18, release long superseded) has a single
frame reading `du /assets/world-Ckfpyn3b.js:2:125058` and cannot be localised without them.

**Reviewing the review** found that the leg cap went on `walkWords` and not on `walkHint`, the
straight-line sibling every build and item reach refusal carries, while the changelog claimed the
bug was gone. Both go through one formatter now, and the test reads a real refusal and parses the
calls out of it rather than pinning two constants against each other, which is what passed while a
second path ignored them. Also: `reaches()` hung on the spawn tile being standable, and the Commons
is where the town builds, so a passed `commons_build` could have stopped any land from ever opening
with nothing saying so.

**PR #91 is merged**, with two fixes on top: `notAtThePlace` asked for a walk onto the plot's
nearest tile, which on a built plot is usually a wall, so a plot anyone could stroll onto answered
"something has you closed in"; and it named a walk to someone upstairs, which starts from the wrong
tile for the same reason the shop's and the hall's did.

**The economy run walks to the counter now.** The only channel the rule has on the coin numbers is
whether a trade happens, since walking is free in the sim, so that one assumption is a flag
(`--shop-trips`, default 100) rather than a guess baked in. Measured: the counter suppresses buying
(down 17%) more than selling (down 5%), so residents end the month richer (274 to 302 per active
resident) and the treasury thins (3744 to 3633), which is the direction RFC 0042 bracketed by hand.
Its residents were also walling themselves into their huts, which is why the first run had 8% of
shop visits arrive.

## Still open

- **What share of residents actually walk to the shop.** `--shop-trips` defaults to 100 because
  nobody has measured it. The rule has been on at terrakin.org since 2026-10-20, so a week of the
  live log will say, and that measurement should set the default. Until then every number the run
  prints assumes residents shop as they always did.
- RFC 0038 slice 4, opening a land at terrakin.org, is built behind an option no adapter sets.
  Both things that came first are done. Ryan's word is the only thing left.
- `pick_recipe` at a station is RFC 0042's last action and is deliberately unscoped.
- Two live homes, cocoa's and Cardigan's, still have no walk to their hearth. The economy run just
  reproduced the same mistake at scale, which says how easy it is to make.
- Whether the sea holds fish of its own (decision 0339 leaves it open).
- A `roof_set` is emitted for a style or colour change as well as a roof going up, so `plot_news`
  reads "A roof went up today" when only the covering changed. That is what the event is defined
  as, but not what a reader sees.
- Two changes still have no test, both low value and both noted rather than written: `plotLabel`'s
  water and bridge words (nothing covers `plotLabel` at all) and `counterNote` on the shop
  suggestion.
