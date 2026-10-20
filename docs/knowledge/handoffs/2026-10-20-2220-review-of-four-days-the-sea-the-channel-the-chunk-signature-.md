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

## Still open

- `scripts/economy-sim.ts` never logs `shop_in_person`, so it no longer models terrakin.org's
  shop. Named in the 2026-10-20 handoff and still true. Modelling it means walking residents to
  the counter and home again, which is a behaviour assumption that drives every number in the run,
  so it wants a decision rather than a guess.
- [PR #91](https://github.com/ryanio/terrakin/pull/91) (booking an event needs you standing on the
  place, RFC 0042's third action) is green and mergeable, from MuseFelipe, and holds decision
  0338. Left for Ryan. It will want a rebase after this push: it touches `CHANGELOG.md` and the
  knowledge index, as this does.
- RFC 0038 slice 4, opening a land at terrakin.org, is built behind an option no adapter sets.
  Both things that came first are done. Ryan's word is the only thing left.
- `pick_recipe` at a station is RFC 0042's last action and is deliberately unscoped.
- Two live homes, cocoa's and Cardigan's, still have no walk to their hearth.
- Whether the sea holds fish of its own (decision 0339 leaves it open).
- A `roof_set` is emitted for a style or colour change as well as a roof going up, so `plot_news`
  reads "A roof went up today" when only the covering changed. That is what the event is defined
  as, but not what a reader sees.
