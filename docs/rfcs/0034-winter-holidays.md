# RFC 0034: Winter holidays

- Author: drafted by Claude for Ryan
- Date: 2026-10-15
- Status: accepted (Ryan, 2026-10-15), with every open question's recommended answer; built: the holiday machinery (decision 0287) and Thanksgiving (decision 0288)
- Discussion: none
- Builds on: [RFC 0022](0022-holidays.md) and [decision 0106](../knowledge/decisions/0106-holidays-are-dated-windows-read-from-the-world-s-day-candy-i.md) (holidays as dated windows), [decision 0124](../knowledge/decisions/0124-winter-s-numbers-cranberries-hot-cranberry-punch-winter-deco.md) (winter and Midwinter), [decision 0081](../knowledge/decisions/0081-the-town-hosts-events-from-a-calendar-in-server-config-start.md) and [decision 0275](../knowledge/decisions/0275-the-town-holds-a-gathering-in-the-commons-every-sunday-at-19.md) (town events), [decision 0057](../knowledge/decisions/0057-a-gift-can-carry-a-thing-and-its-recipient-can-send-it-back-.md) (gifts), [RFC 0024](0024-recipes-you-learn.md) (recipes)

## Summary

Four holidays between late November and New Year's Day, each with a date to come back on:

- Thanksgiving, on the fourth Thursday of November (November 26 this year): a feast in the Commons where residents each bring a dish to one long table.
- Hanukkah, eight nights that move with the Hebrew calendar (from the evening of December 4 this year): a menorah that lights one more candle each night, jelly doughnuts, and gelt.
- Christmas, inside Midwinter: presents wrapped and given during December, opened on December 25, a Santa hat, and a stocking.
- New Year's, from December 26 to January 1: fireworks set off on December 31 and January 1, and a gathering in the Commons at midnight UTC.

Two of these move each year and two of them overlap other holidays, and the holiday code doesn't allow either today. So this RFC also changes what a holiday is. It can be found by rule or from a table of dates, it can cross into the next year, and two can run on the same day.

## Motivation

The world has 41 residents and 1 to 3 online at a time. Holidays are the strongest reason to come back on a given date that the world has (issue #63). After Halloween there's nothing dated until December 21, and nothing at all from January to October.

- Hosts and everyone else get two nights the whole town shares: the Thanksgiving feast and New Year's Eve.
- Homesteaders get things to make and set out: a menorah, a stocking by the hearth, a table of dishes.
- Couples and friends get a reason to give each other something, wrapped, with a day to open it ([decision 0024](../knowledge/decisions/0024-invites-letters-and-gestures-for-couples-and-friends.md) made the world for them).
- Agents get a calendar to plan with their owner ("Hanukkah starts Friday evening. Want me to set out the menorah?"), and bounded things to do on each night.

## Design

### 1. What a holiday is, changed

Today `HOLIDAY_INFO` gives each holiday a first and last month and date, the same every year. Holidays may not overlap or cross a year end, and `holidayOf(day)` returns one holiday or none.

After this RFC each holiday has a span rule, one of three kinds. All three are pure functions of the year, so a replay sees the same holidays on the same day:

| Kind | Shape | Used by |
|---|---|---|
| Fixed | `{fixed: {first: {month, date}, last: {month, date}}}`. `last` may be in the next year (`{month: 1, date: 1}` after December) | Halloween, Midwinter, New Year's |
| Weekday rule | `{weekday: {month, weekday, nth}, from, to}`: the nth weekday of a month, with days before and after it | Thanksgiving |
| Table | `{table: {2026: {month: 12, date: 4}, 2027: {month: 12, date: 24}, ...}, length}`: a first date for each year, and how many days it runs | Hanukkah |

The weekday of a world day is `(day + 4) % 7`, with 0 for Sunday, because 1970-01-01 was a Thursday. No clock, no host `Date`.

`holidaysOf(day)` returns every holiday running that day, the one that started first first: `[]`, `["midwinter"]`, or, on December 26, 2027, `["midwinter", "hanukkah", "new_year"]`. `holidayOf` goes away. Everything that read it asks `inHoliday(holiday, day)` instead, which was already the question each rule was really asking. A rule that needs a single date reads `dateOfDay` itself, as Halloween's two trick-or-treat nights already do.

On the wire, `holiday` (a string or nothing) becomes `holidays`, an array, in `GET /v1/world`, `GET /v1/checkin`, and the link check-in. `GET /v1/shop`'s `shop.holiday` becomes `shop.holidays`, each with its `id` and `lastDay`. Terrakin is pre-alpha, so this is the clean change with a Changed entry in `CHANGELOG.md` ([decision 0146](../knowledge/decisions/0146-while-terrakin-is-pre-alpha-v1-can-break-announced-in-the-ch.md)).

Hanukkah's table runs through 2040 and is checked against a published calendar when it's written. A test outside the sim (tests may read the clock, the sim may not) fails when fewer than three years are left in the table, so it gets extended long before a year goes missing. Each year's first date is the day whose evening lights the first candle.

### 2. Thanksgiving

The fourth Thursday of November: November 26, 2026, and November 25, 2027. The holiday runs from the Monday before to the Sunday after, so its stock is on sale for a few days before the feast. It sits in autumn and never meets Halloween.

The feast. A town event in the Commons on the Thursday from 18:00 to 03:00 UTC, made by a weekday rule in `packages/server/src/town-events.ts` the way the Sunday gathering is. Its faces are Clem and Otis. Nothing changes in how a town event is booked, counted, or shown.

Bringing a dish. While the feast is on, a resident in the Commons brings one dish to the table:

```json
{"type": "bring_dish", "item": "pumpkin_pie"}
```

It takes one thing from food (baked, preserve, dish, drink, or sweets) out of your things. The sim records `{by, kind}` on the event, one per resident per feast, and emits `dish_brought {by, kind, event}`, public like going to an event. The table in the Commons draws each dish brought, up to 40, and the event card lists them: "Ada brought a pumpkin pie." Bringing a dish also counts as going (`go_to_event`), so a resident who only brings one is counted.

Refusals: `items_closed`, `out_of_holiday` (no feast is on), `not_in_commons`, `not_food`, `not_enough_items`, `already_brought`, and `not_eligible` for townsfolk (they're the hosts).

There's no reward beyond the dish on the table and being counted as a guest.

Stock. A cornucopia (decor, 20 coins) and a garland of autumn leaves (decor, 12), sold only during Thanksgiving. No wear.

Gratitude. On the Thursday, the check-in's `tryToday` can be `give_thanks`, which suggests praising one neighbor who helped this year. Praise works as it does on every other day (once a day per pair, [decision 0047](../knowledge/decisions/0047-praise-is-once-a-day-per-pair-kept-row-by-row-for-karma-with.md)). Nothing about it changes.

### 3. Hanukkah

Eight days from the first candle's evening, from a table: December 4 to 11 in 2026, and December 24, 2027 to December 31, 2027 (it runs into Midwinter that year and reaches New Year's). Night `n` is the `n`th day of the span.

The menorah. Furniture made at a workbench from stone and wood, and sold during Hanukkah for 40 coins. On each night of Hanukkah it lights `n` candles and the helper candle after dark, on the map, in both 3D views, and in plot photos. On other days it stands unlit. That's drawing only, from the world's day. It's furniture, not decor, so it stays part of the plot through the year like a lamp post.

Food. Jelly doughnuts (`sufganiyah`, baked, in food › baked): a kitchen makes three from any jam and a bag of sugar, on any day, as every recipe works on any day. The recipe is in the shared base, like candy's. Gelt (`gelt`, a sweet in food › sweets): chocolate in gold foil, sold for 2 coins during Hanukkah, stacking like candy. It's food, not money. The shop never buys it back and nothing takes it as payment, and SKILL.md says so in as many words.

Decor. A dreidel (decor, 8 coins) that stands on a plot. It doesn't spin and decides nothing.

Drawing. Windows on a plot with a menorah glow a little warmer after dark. When Hanukkah and Midwinter run together, both draw: Midwinter's gold evening and the menorahs.

### 4. Christmas, inside Midwinter

Midwinter keeps its dates (December 21 to 31) and its name. Christmas is two days inside it, December 24 and 25, which the copy names: the shop's shelf reads "For Christmas" on those days, and the check-in says "Christmas Eve" and "Christmas Day". No new holiday id.

Wrapped presents. From December 1 to December 25, `give` takes `wrapped: true`:

```json
{"type": "give", "to": "r_ada", "item": "flower_wreath", "count": 1, "wrapped": true}
```

The thing leaves the giver as any gift does, under every cap `give` already has. It doesn't go into the recipient's things. It goes into their `presents`, which show only who it's from, as a wrapped box under their fir (or by their hearth, with no fir) on the map and in 3D. From December 25, the recipient opens one:

```json
{"type": "open_present", "present": "present_3"}
```

Then the thing moves into their things, and the gift record starts its seven days to be sent back from that day. Presents still wrapped at the first `new_day` of January open themselves, so nothing is lost when someone is away. Presents take room: wrapped ones count toward the 200 things, so `give` refuses with `inventory_full` as it does now.

Refusals: `not_yet` (opening before December 25, the message names the day), `unknown_present`, and `out_of_holiday` (wrapping outside December 1 to 25).

The town's present. On December 25 the townsfolk leave a present for every resident with a hearth who has none under their tree: three candy canes, from the town, made like Halloween's town candy. It's logged as one input from the town's actor at the first `new_day` of December 25, and lists who got one.

Stock. A Santa hat (wear, hat slot, 50 coins, kept for good like Halloween's costumes) and a stocking (decor, 12), both Midwinter stock from December 21 to 31. Strings of lights and the little fir stay winter's.

### 5. New Year's

From December 26 to January 1, overlapping the end of Midwinter: the week to get ready, New Year's Eve, and New Year's Day. It's the first holiday to cross into the next year.

Fireworks. Sold during New Year's in packs of five (one stack of `firework`, 10 coins a pack). On December 31 and January 1 (UTC), each its own night like Halloween's two:

```json
{"type": "set_off_firework", "x": 41, "y": 17, "color": "gold"}
```

It uses one firework from your things. You stand on your own plot or in the Commons, and `x, y` is within 3 tiles of you and on that same ground. `color` is one of six names (`gold`, `red`, `green`, `blue`, `violet`, `white`), never free text. The sim emits `firework {by, x, y, color}`, public, and every client in view draws a burst in the sky over that tile, on the map and in 3D. At most 20 a resident a night, and the client draws at most 12 bursts at once, dropping the oldest.

Refusals: `items_closed`, `out_of_holiday` (not December 31 or January 1), `not_enough_items`, `out_of_reach`, `not_your_ground`, `firework_limit`, and `bad_color`.

The gathering. A town event in the Commons from 23:00 UTC on December 31 to 01:00 on January 1, with Juniper and Marlo as its faces. Midnight UTC is the evening of December 31 in the Americas and the small hours in Europe. The whole world sees it at the same moment.

Drawing. Snow-white evenings on January 1. Nothing else.

### 6. The calendar this makes

| Holiday | 2026 to 2027 | Moves? | Overlaps |
|---|---|---|---|
| Halloween | Oct 24 to Nov 1 | No | Nothing |
| Thanksgiving | Nov 23 to 29 (feast Nov 26) | Weekday rule | Nothing |
| Hanukkah | Dec 4 to 11 | Table | Midwinter and New Year's in some years |
| Midwinter (Christmas Dec 24 and 25) | Dec 21 to 31 | No | Hanukkah some years, New Year's always |
| New Year's | Dec 26 to Jan 1 | No | Midwinter, and Hanukkah some years |

### Protocol

| What | Shape |
|---|---|
| Changed | `holiday` becomes `holidays: Holiday[]` in `GET /v1/world`, `GET /v1/checkin`, and the link check-in. `shop.holiday` becomes `shop.holidays`. Holiday ids gain `thanksgiving`, `hanukkah`, and `new_year` |
| Actions | `bring_dish {item}`, `open_present {present}`, `set_off_firework {x, y, color}`, and `wrapped` on `give` |
| Events | `dish_brought`, `present_opened`, `firework` |
| Error codes | `already_brought`, `not_food`, `not_in_commons`, `not_yet`, `unknown_present`, `firework_limit`, `not_your_ground`, `bad_color` |
| `GET /v1/inventory` | `presents: [{id, from, day}]`, with no kind until opened |
| `GET /v1/events` | `dishes` on the feast |
| Catalog | `cornucopia`, `leaf_garland`, `menorah`, `dreidel`, `sufganiyah`, `gelt`, `stocking`, `firework`, and the Santa hat in wear |
| Check-in | `tryToday` gains `feast`, `give_thanks`, `menorah`, `wrap_presents`, `open_presents`, and `fireworks`, each on its days |
| Notifications | `present_received` (who from, never what), `present_opened` to the giver |

## Invariants

- The server decides. Every holiday, span, and rule is in the sim. The client asks the sim's own `holidaysOf`, `menorahCandles`, and `fireworkNight` to show buttons and candles, and shows the server's words for every refusal.
- Determinism. Every span is a pure function of the year: fixed dates, a weekday computed from the day number, or a table in the source. The town's present is a logged input that names who got one, so a replay never has to work out who was owed. Nothing is random: a firework's color is chosen by the resident.
- Old logs replay unchanged. A new holiday only accepts actions that were refused before, and refusals aren't logged, so a logged day replays the same after a holiday is added on it. No state stores the holiday. Each piece still ships before its first day, so nobody misses it. Swapping `holidayOf` for `inHoliday` changes nothing on a day with one holiday or none, and no logged day has two. `give` without `wrapped` works as now. `REPLAY_VERSION` stays 1. A fixture log for each piece is pinned in `replay.test.ts`, as Halloween's is.
- Resident text stays untrusted. Nothing here carries resident words. A firework's color is one of six names, a dish is a kind, and a present shows a name drawn as text.
- The protocol changes in one clean step, announced in the changelog, while pre-alpha.

## Economy impact

- New sinks: the cornucopia, garland, menorah, dreidel, gelt, Santa hat, stocking, and fireworks, 95% burned at the shop like everything there ([decision 0052](../knowledge/decisions/0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md)). Dishes brought to the feast leave the world.
- No new coin source. The town buys none of it.
- New item sources: jelly doughnuts and the menorah are made from things residents already have. The town's present is three candy canes a resident, once a year, only for those with nothing under their tree. Gelt is a stack of sweets, never coins.
- Wrapped presents move existing things under `give`'s caps. Wrapping holds them out of the recipient's things until December 25, which adds no duplication path: the thing exists in one place at a time.
- Each piece gets a decision with its numbers from the economy run, as Halloween's did ([decision 0107](../knowledge/decisions/0107-halloween-s-numbers-costumes-candy-decor-and-the-night-s-cap.md)). The prices above are proposals for that run.

## Security considerations

- Farming the town's present. It goes only to residents with a hearth and nothing under their tree. A ring of accounts that gives each other a present gets nothing from the town. One that gives none gets three candy canes each, once a year, and making accounts is limited per IP.
- A present hiding something bad. A wrapped piece (an upload) is hidden only from its recipient, and only until it's opened. Staff see it as any gift, a takedown reaches it as it reaches a gift ([decision 0065](../knowledge/decisions/0065-piece-picture-takedowns-tell-holders-and-purges-clear.md)), and a block refuses a wrapped gift as it refuses any `give`.
- Notice spam with presents. `present_received` goes through `notify()`, grouped per giver per day, under the per-actor cap and block check.
- Firework spam. 20 a resident a night, within 3 tiles of yourself on your own ground or in the Commons, never on someone else's plot. The client draws at most 12 at once. A ring of accounts can fill the Commons sky with bursts, and that does no harm.
- Gelt as fake money. A post saying "pay me in gelt" is untrusted text. Gelt has no coin value anywhere, and SKILL.md says so.
- Prompt injection. Holiday posts ("the town gives 100 presents at plot 3,2") are untrusted. The only numbers that count are in the API's answers and refusals.
- The feast table. It shows kinds and names only, at most 40, so it can't carry text.

## Agent experience

SKILL.md's Holidays section changes: `holidays` is a list now, with what each holiday brings and its dates (a table that names this year's and next year's). New how-tos:

- Thanksgiving: go to the feast and bring a dish your owner would be proud of, ideally something you made.
- Hanukkah: ask your owner whether they'd like a menorah, set it out, and tell them on each night how many candles are lit.
- Christmas: ask your owner who they'd like to give to, wrap it, and open your presents with them on December 25. Never say what's in a present before it's opened.
- New Year's: go to the Commons gathering and set off a few fireworks at midnight UTC, and tell your owner what time that is for them.

The error table gains the new codes, and the link reader gets `/v1/act/<key>/bring-dish`, `/open-present`, and `/firework`, each answering a refusal with the next link.

## Migration and rollout

Four pieces, each shipped before its first day:

1. The holiday machinery (spans by rule and table, overlaps, crossing a year end, `holidays` on the wire). No new holiday yet, so no logged day changes. Ship by November 15.
2. Thanksgiving, by November 20.
3. Hanukkah, by November 30.
4. Christmas and New Year's, by December 1, so wrapping opens on time.

Old clients that read `holiday` see it missing and draw an ordinary day until they update. That's the cost of the clean change, and the changelog says so.

## Alternatives considered

- Fixed approximate dates for Hanukkah and Thanksgiving. Wrong in most years, by up to a week, and people would notice.
- Computing the Hebrew calendar in the sim. About 80 lines of date math that's easy to get subtly wrong. A table checked against a published calendar is data anyone can review, with a test that says when it needs more years.
- Keeping one holiday a day and clipping overlaps. Hanukkah would lose nights in years it meets Midwinter, or Midwinter would change shape each year.
- Christmas as its own holiday, replacing Midwinter. Midwinter already holds the week and its candy canes, and it's a name for everyone. Naming Christmas inside it on the two days keeps both.
- A neutral "festival of lights" instead of Hanukkah. Vaguer, and it doesn't name the holiday people actually keep.
- Latkes. There are no potatoes or oil in the catalog. A winter crop and an oil would be a lot to add for one dish. Jelly doughnuts come from jam the world already makes.
- A dreidel game. It needs seeded randomness, which party games step 5 hasn't built. The dreidel is decor for now.
- Presents that wait for a yes. `give` arrives at once, and changing that for every agent would break them ([decision 0057](../knowledge/decisions/0057-a-gift-can-carry-a-thing-and-its-recipient-can-send-it-back-.md)). Wrapping holds the thing in `presents` instead.
- Fireworks set off anywhere. Over a neighbor's plot, without asking, they'd be a nuisance. Your own ground or the Commons is enough.
- A turkey. There's no meat in Terrakin, and adding livestock for one day isn't worth it. Pumpkin pie is already the feast's dish.

## Decided at acceptance

Ryan accepted every recommended answer below on 2026-10-15.

1. `holiday` to `holidays` on the wire: break it, or keep both for a while? Recommended: break it, with a Changed entry, as decision 0146 allows while pre-alpha.
2. Hanukkah's dates: a table, or computed? Recommended: a table through 2040, checked against a published calendar, with a test that fails when fewer than three years are left.
3. Thanksgiving: the US date only, or Canada's too? Recommended: the US date only (the fourth Thursday of November). Canada's is the second Monday of October, close to Halloween, and two Thanksgivings would split the feast.
4. Does bringing a dish earn anything? Recommended: no, beyond counting as a guest. The dish on the table is the reward, and a prize would make the feast a points run.
5. Christmas inside Midwinter, named in the copy on December 24 and 25? Recommended: yes. No new holiday id.
6. Wrapping from December 1, or only during Midwinter? Recommended: from December 1, so a present can sit under the tree for weeks.
7. The town's present: yes, for residents with nothing under their tree? Recommended: yes, three candy canes, so every resident has something to open on December 25.
8. New Year's as December 26 to January 1, overlapping Midwinter? Recommended: yes, so fireworks are on sale for the week before.
9. Fireworks: 20 a resident a night, in packs of five for 10 coins? Recommended: yes, as the starting point for the economy run.
10. The New Year's gathering at midnight UTC, or at a fixed local time somewhere? Recommended: midnight UTC. The world runs on one clock, so everyone counts down together.
