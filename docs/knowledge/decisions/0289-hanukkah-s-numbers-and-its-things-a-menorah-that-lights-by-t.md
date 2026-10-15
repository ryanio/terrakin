---
title: "Hanukkah's numbers and its things: a menorah that lights by the night, a dreidel, gelt, and jelly doughnuts"
date: 2026-10-15
status: accepted
tags: [sim, economy, numbers, holidays, client]
---

# Hanukkah's numbers and its things: a menorah that lights by the night, a dreidel, gelt, and jelly doughnuts

## Context

[RFC 0034](../../rfcs/0034-winter-holidays.md) adds Hanukkah, on holidays that can come from a table of dates and run beside Midwinter ([decision 0287](0287-holidays-have-span-rules-may-overlap-and-cross-a-year-end-an.md)). It proposed a menorah made at a workbench and sold for 40 coins, a dreidel, gelt sold by the shop, and jelly doughnuts from any jam and sugar. Two of those don't fit the sim as it is: the shop sells decor, wear, seeds, staples, and sweets but no furniture, and a recipe uses only things that stack, which jam isn't (it's a made thing with an id). A sweet always has a recipe.

## Decision

- Hanukkah's dates are a table of first-candle dates, 2026 to 2040, checked against Hebcal's (hebcal.com) on 2026-10-15, eight days from each. `hanukkah.test.ts` reads the clock and fails once fewer than three years are left in the table.
- The menorah is shop decor, 15 coins while Hanukkah runs (the price of Halloween's cauldron), not workbench furniture. On the map it lights the helper candle and one more candle each night of Hanukkah (`hanukkahNight`, drawing only), the first night's on the far right. In 3D and in plot photos its candles stand unlit, since a decor model is built once for every day.
- The dreidel is decor at 6 coins. It doesn't spin and decides nothing.
- Gelt is a sweet at 2 coins while Hanukkah runs, and a kitchen makes five from 2 bags of sugar any day. It's never money.
- The jelly doughnut (`sufganiyah`) is a baked good a kitchen makes from 2 strawberries and a bag of sugar, the strawberry standing for the jam inside. Gelt and the doughnut are holiday recipes, so everyone knows them.
- The check-in suggests a menorah once a Hanukkah (`tryToday: "menorah"`) to a resident with a home and none in their things or on their plot.
- Left for later: windows on a plot with a menorah glowing warmer, and candles lit in 3D.

## Consequences

- Hanukkah ran beside Midwinter in 2025 and does again in 2027; `holidaysOf` lists both and the shop gives each its shelf.
- A new year of dates goes on the end of the table before the test fails. Adding one can't change a logged day, since no logged day falls in a year the table lacked.
- Code: Hanukkah's dates and `hanukkahNight` in `packages/sim/src/holiday.ts`, the catalog's `menorah`, `dreidel`, `gelt`, and `sufganiyah`, `paintMenorah` in `packages/client/src/render/decor-hanukkah.ts`, and the `menorah` suggestion in `packages/server/src/checkin-suggest.ts`.
