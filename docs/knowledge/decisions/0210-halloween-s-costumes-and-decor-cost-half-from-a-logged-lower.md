---
title: Halloween's costumes and decor cost half from a logged lower_holiday_prices
date: 2026-10-07
status: accepted
tags: [sim, economy, numbers, holidays, server, scripts]
---

# Halloween's costumes and decor cost half from a logged lower_holiday_prices

## Context

[Decision 0107](0107-halloween-s-numbers-costumes-candy-decor-and-the-night-s-cap.md) priced Halloween's costumes at 40 to 70 coins and its decor at 12 to 30, against a regular's 10 to 15 coins a day. Most people who arrive in the weeks before Halloween are not regulars. The aim is that a newcomer with a week of allowance and a first sale or two can buy a costume and a piece of Halloween decor, so more people join the holiday, while holiday stock stays a coin sink under the shop's split ([decision 0052](0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md): 5% to the treasury, the rest burned).

Prices are read on every `shop_buy`. Lowering one changes what a logged purchase costs on replay, so the change needs a logged switch, the way `set_shop_share` changed the treasury's share.

## Decision

Halloween's costumes and decor cost half of decision 0107's prices, rounded up, from the moment the server logs `lower_holiday_prices`:

| Thing | Before | From the switch |
|---|---|---|
| Cat ears | 40 | 20 |
| Ghost sheet | 50 | 25 |
| Witch hat | 60 | 30 |
| Pumpkin head | 70 | 35 |
| Bat wings | 70 | 35 |
| Bat bunting | 12 | 6 |
| Candy bowl | 15 | 8 |
| Cauldron | 30 | 15 |
| Candy, candy canes | 2 | 2 |

`lower_holiday_prices` is a one-time switch from the town, taken once the shop is open. It sets `shop.holidayPricesLowered` and emits a public `holiday_prices_lowered`. `priceOf(state, sku)` in `packages/sim/src/shop.ts` gives what the shop asks: the catalog's price, or for holiday stock in a world without the switch, the frozen `HOLIDAY_PRICES_BEFORE`. The catalog, `WEAR_PRICES`, SKILL.md, and `GET /v1/catalog` carry the new prices; `GET /v1/shop` and the check-in's costume line carry the world's. The server logs the switch with `holidayPrices: true`, which only the Worker sets, so terrakin.org takes the new prices and a self-hosted world, `pnpm dev`, and the e2e servers keep the old ones unless they set it.

### The run

`scripts/economy-sim.ts` now plays Halloween. A resident keeps a holiday by chance (6 in 10 regulars, 5 in 10 visitors, 4 in 10 drifters, 3 in 10 one-day visitors, a guess), wants one of its costumes and one piece of its decor, each at random, and buys them while it runs once they can afford each with 10 coins to spare, before the rest of their wish list. The draws come from their own stream, so `--no-holidays` plays the month exactly as [decision 0186](0186-recipes-keep-the-rfc-s-card-prices-and-page-rate-the-economy.md) recorded it, and `--holiday-prices before` plays it without the switch. It also prints what each newcomer had to spend by the end of their seventh day (their purse plus what they spent at the shop).

Each run is 30 days from October 4, 2024, so Halloween is days 20 to 28. "Newcomers" are residents who kept Halloween and arrived in the week before it or during it. "Per active" is coins per active resident at month end: without holiday shopping, then at the old prices and the new.

| Run | Kept it | A costume, all | A costume, newcomers | Decor, newcomers | Holiday stock burned | Per active |
|-----|---------|----------------|----------------------|------------------|----------------------|------------|
| Seed 1, 300 residents | 99 | 80% → 100% | 70% → 100% | 62% → 92% | 5,712 → 3,765 | 326, 290 → 304 |
| Seed 2 | 87 | 82% → 98% | 73% → 98% | 64% → 96% | 5,126 → 3,205 | 318, 290 → 303 |
| Seed 3 | 73 | 85% → 100% | 76% → 100% | 67% → 100% | 4,469 → 2,801 | 321, 297 → 305 |
| 600 residents | 197 | 80% → 90% | 67% → 82% | 49% → 80% | 11,111 → 6,785 | 269, 234 → 246 |
| 150 residents | 37 | 92% → 100% | 86% → 100% | 67% → 95% | 2,505 → 1,416 | 380, 348 → 362 |

A winter month (`--start 2024-12-04`) is the same at both prices: Midwinter sells only candy canes, so nobody in the run shops for it.

What a newcomer has in their first seven days, seed 1 (purse plus shop spending; seeds 2 and 3 are within 15 coins):

| Kind | p25 | Median |
|------|-----|--------|
| Regular | 164 | 192 |
| Drifter | 102 | 117 |
| Visitor | 81 | 98 |

Why these values:

- **The dearest pair fits a visitor's week.** At the old prices a pumpkin head and a cauldron cost 100, about a visitor's whole median week (90 to 111 across the runs), before seeds, cards, and the 10 coins everyone keeps back. Now the dearest costume and the dearest decor cost 50, and 60 with the 10 kept back fits under a visitor's p25 in every run (77 at 600 residents). The welcome gift alone is 50, and the cheapest pair (cat ears and bat bunting) is 26.
- **Half, not more or less.** At 25 to 40 for costumes and 8 to 20 for decor, 94% of seed 1's newcomers got a costume, against 100% at half. Going below half (15 to 30, decor 5 to 12) bought nobody a costume who couldn't at half, and burned about 640 coins less.
- **Still a sink, a smaller one per buyer.** Every purchase is split as before, so holiday stock burns about 97% of what it takes in. With one costume and one piece of decor each, the run burns 34% to 43% less on holiday stock, and month-end coins per active resident end 3% to 5% above the old prices and still 5% to 9% below the month with no holiday shopping. The run is a floor: real residents buy more than one piece of decor and sometimes a second costume, and cheaper decor is easier to buy in threes.
- **Costumes stay under all-year wear.** The cheapest all-year wear is the umbrella at 60. A costume is for one week a year, so it costs half that or less, and its order stays decision 0107's: cat ears cheapest, the pumpkin head and bat wings dearest.
- **Decor keeps its place among the seasons'.** Bat bunting at 6 is under a hay bale (8) and a string of lights (12); a candy bowl at 8 is a hay bale's price, cheap enough that anyone with candy puts one out; a cauldron at 15 is half a snowman.
- **Candy and candy canes stay at 2.** They are already the cheapest things in the shop, and 2 keeps the shop a little dearer than a kitchen, as decisions 0107 and [0124](0124-winter-s-numbers-cranberries-hot-cranberry-punch-winter-deco.md) set. They aren't what keeps a newcomer out.

## Consequences

- Old logs replay as they were. A world that never logs `lower_holiday_prices` charges `HOLIDAY_PRICES_BEFORE`, so the Halloween fixture keeps its hash, and a purchase logged before the switch keeps its price. `halloween.test.ts` pins both price lists, checks a buy before the switch at the old price and after it at the new, and checks that the switch moves the fixture's purchases only when it's logged before them.
- `HOLIDAY_PRICES_BEFORE` is frozen. Another change to holiday prices is a new list behind a new switch.
- The default economy month now has Halloween's shopping in it, so the numbers in decisions 0052, 0079, 0123, 0124, and 0186 come from `--no-holidays`. Who keeps a holiday (`KEEPS`) is a guess; if live Halloween spending per active resident runs well past the run's, that guess was low, not the prices.
- If a newcomer still can't afford a costume in a live Halloween, look at the welcome gift and the first week before cutting prices again.
- Code: `HOLIDAY_PRICES_BEFORE`, `priceOf`, and `checkLowerHolidayPrices` in `packages/sim/src/shop.ts`, the costume prices in `WEAR_PRICES` there, the `bat_bunting`, `cauldron`, and `candy_bowl` entries in `packages/sim/src/catalog.ts`, the `holidayPrices` option in `packages/server/src/world-service.ts` and `packages/server/cloudflare/worker.ts`, `itemsOn` in `packages/server/src/shop.ts`, and `keepHoliday` and `holidayLines` in `scripts/economy-sim.ts`.
