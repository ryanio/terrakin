---
title: The townsfolk's homes wear roofs in the free coverings, and no made materials
date: 2026-10-20
status: accepted
tags: [design, tooling, ops, onboarding]
---

# The townsfolk's homes wear roofs in the free coverings, and no made materials

## Context

[RFC 0041](../../rfcs/0041-materials-and-roofs.md) left an open question about the founding
townsfolk: "Do the townsfolk's homes get the new materials, seeded like their routines and pets
([decision 0113](0113-townsfolk-have-routines-and-a-pet-each-set-by-the-seed-like-.md))? They are
the first homes a newcomer sees, so probably yes, and that is a seed change rather than a rule."

Roofs shipped the same day ([decision 0324](0324-a-roof-is-a-look-on-the-plot-over-the-box-around-each-group-.md)),
which made the question sharper and a little embarrassing: `scripts/townsfolk/iso.ts` has drawn
gables and hip roofs in their postcards and avatars since the cast was written, so the eight
pictures a newcomer meets in the feed had roofs while the eight plots on the map were flat-topped.

## Decision

**Roofs yes, seeded the way routines and pets are.** Each persona's `home` in
`scripts/townsfolk/personas.ts` carries a `roof`, `scripts/townsfolk/roof-plan.ts` decides from the
`roof` the plot already has, and `seed.ts` sends `set_roof` as its last step. `--roofs` puts them up
on their own for townsfolk seeded before roofs existed, a dry run unless `--send` comes too.

**The coverings are the four free blocks, and no made material.** `plaster`, `brickwork`,
`timber_frame`, `driftwood_plank` and `sea_glass_pane` were left out for two reasons. The first is
what it would take: 8 of a material is two crafts at a workbench none of them owns, from stone they
would have to gather or finds that spawn by chance per tile per day, so the seed would grow walking,
gathering, placing a workbench and crafting across several days, all to change one roof's colour.
The second is the better one. A made material is meant to say where its builder forages, and the
townsfolk forage nowhere: they are eight API calls in a two-minute run. A brickwork roof on Bram's
workshop would be a picture of work nobody did, which is the opposite of what the materials are for.
A free covering is taken and given straight back, so a roof costs nothing, a rerun sends nothing,
and changing our minds is one call.

**Eight pairs, each covering once as a gable and once as a hip.** Juniper a glass gable (the
greenhouse her postcard draws), Bram a wood gable (a barn in sawn boards), Clem a leaf hip (green,
sloping to the two streets her tables are on), Pip a leaf gable (low and plain, like the post stop
under it), Otis a stone gable (slate, the ridge down the long side), Marlo a wood hip (the cap his
postcard draws, in the boards his stilts are), Sable a glass hip (four slopes where the postcard has
a dome), Ansel a stone hip (pale slate over the white atelier, its glass wall doing the light).
`scripts/townsfolk/townsfolk.test.ts` fails if two ever match.

**Nobody wears `pitched`.** One slope reads as a roof on a small home and as a flat plane on these:
every townsfolk plot is 5 to 7 tiles across once its signature blocks count as walls, and a pitched
roof at that width draws as a shallow grey deck over the whole plot. Bram wore one in the test world
first and it looked like a car park. A gable keeps its ridge at any size and a hip reads as
concentric slopes, so those are what the cast wears.

## Consequences

The roof a townsfolk wears covers more than its house, because decision 0324 reads the footprint
from the walls and their signature blocks are wall blocks: Bram's stone pillars and Marlo's stilts
touch the hut's ring, so each of those two is roofed plot-wide. That is 0324's own known trade ("a
decorative wall stuck to a house, which stretches the roof to reach it"), and it is why those two
wear a barn's gable and a pavilion's hip rather than anything that would read as a lid. It cannot be
tuned from here either: the seed only ever adds blocks, so what their roofs cover is already fixed
by what stands on the live plots.

Juniper's leaf windows are hedges, which hold nothing up, so her wall ring is cut in two and her
roof covers only the northern strip: the greenhouse row and the top of the cottage. That is the one
place where the box rule flatters a home, since the glass gable then sits over the greenhouse
exactly as her postcard has it.

What to revisit: made materials, once the townsfolk are the platform-run agents RFC 0041's last
section imagines. An agent that walks the shore and crafts driftwood planks has earned a driftwood
roof, and that is the point at which seeding one stops being a costume.
