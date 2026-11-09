---
title: A build tap only adds with a pick and only takes away with Remove, walls go only on lines, and building frames the plot
date: 2026-11-09
status: accepted
tags: [client, design, mobile]
---

# A build tap only adds with a pick and only takes away with Remove, walls go only on lines, and building frames the plot

## Context

The owner built on his phone and found it frustrating. He had to stand close to what he built, taps landed on the neighbouring tile, a tap meant to remove something sometimes added something, and thin walls were hard to select.

Each had a cause in the client. A build tap toggled: on a block it removed, on an empty tile it placed, so a tap a little off did the opposite of what was meant. The bar started on "Walls: on tiles", so with Wood picked, a tap on a thin wall (a line, with no block on its tile) dropped a thick wall block on the tile instead of taking the wall down. The side of a line came only from which edge of the tapped tile the tap was nearest. Building reached 3 tiles from where you stood, and the map drew a tile at 30 pixels on a 390 by 844 phone.

The sim now has two switches for this: `plot_reach`, after which building reaches every tile of a plot from on it or near it (`plotReachOk`), and `walls_on_lines`, after which a wall sent without a side is refused.

## Decision

- A pick only adds. On an empty tile or line it places; on a piece of the same kind that turns, facing another way, it turns it (decision 0426); on anything else it says what's there and changes nothing.
- Remove is a choice of its own, first in every row of the bar and kept in view while the row scrolls. It only takes away: the wall on a line near the tap, else the block on the tile, else (on the Paths tab) the path. It stays picked from tab to tab.
- A wall, window, hedge or door always goes on a line. The Walls chip and the Slim the walls chip are gone. The line is the one nearest where the tap touched the ground, measured to every line around it, not only the four sides of the tile it fell in. Remove looks 0.6 of a tile from the tap when the tile holds nothing else, and 0.22 when it holds a block or a path it could mean instead. Placing next to a taken line, an empty one at most 0.15 of a tile farther takes the wall, so a wall carries on round a corner. A 3D tap that hits a wall is that wall's line.
- Under a mouse the line or tile the next tap acts on is ringed; on touch what a tap acted on flashes for 650 ms.
- With plot reach on, the build outline is the plot, the client holds back with the sim's `plotReachOk`, and a tap out of reach walks into reach and then acts.
- Building frames the plot you stand on in the clear band under the bar, as big as fits and never smaller than the usual view nor closer than the close view (`frameTiles`). On a 390 by 844 phone an 8-tile plot draws at 46 pixels a tile, up from 30. A pinch, a wheel, or + and - hand the camera back; leaving building restores the usual view. In 3D the camera looks at the plot's middle.
- A vase or pot picked in the bar and tapped on a table or shelf of yours (the sim's `isSurface`, not the kitchen) stands on it with `put_on`.

The rules live in `packages/client/src/build-taps.ts`, pure and tested, and the words for what a tap found in `builtHereLine` in `things.ts`.

The bar keeps decision 0422's layout: three rows, the tabs with this plot's chips after them, the palette, and the line about the pick folded to one row on a phone. Each wall's line now leads with how it goes up, since a phone shows only the line's first row.

## Consequences

- Taking something up is now two taps the first time (Remove, then the thing), where a toggle did it in one. In exchange no tap undoes what you meant.
- Thick wall blocks still drawn in a world are taken up with Remove like any block, and can't be placed again from the bar.
- `e2e/support.ts`'s `tapTile` reads the canvas's `data-view` (your tile on screen and a tile's size) rather than assuming you're in the middle at the usual scale, since the camera frames the plot while you build.
- `plotReachOk` asks for a whole `WorldState` and reads only `plotReach` and `config`, so the client passes those two through a cast. A narrower parameter type in the sim would remove it.
- Code: `packages/client/src/build-taps.ts`, `buildTapOn`, `buildFrame` and `reachBox` in `packages/client/src/world.ts`, `frameTiles` in `map-zoom.ts`, `removeChoice` in `build-palette.ts`, `paintBuildMark` in `render/hover.ts`, the line each wall mesh carries in `scene3d/edges.ts`, and `e2e/build.spec.ts`. Builds on [decision 0077](0077-the-build-bar-sits-under-the-top-bar-in-three-tabs-and-keeps.md) and [decision 0422](0422-while-you-build-on-a-phone-the-build-bar-takes-the-top-row-a.md), and replaces 0077's rule that a tap on a block removes it.
