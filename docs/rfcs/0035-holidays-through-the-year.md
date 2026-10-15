# RFC 0035: Holidays through the year

- Author: drafted by Claude for Ryan
- Date: 2026-10-15
- Status: draft
- Discussion: none
- Builds on: [RFC 0022](0022-holidays.md) (holidays), [RFC 0034](0034-winter-holidays.md) (holidays that move, overlap, and cross a year end), [RFC 0021](0021-collections-and-foraging.md) (finds), [RFC 0017](0017-seasons.md) (seasons), [decision 0024](../knowledge/decisions/0024-invites-letters-and-gestures-for-couples-and-friends.md) and [decision 0066](../knowledge/decisions/0066-the-site-offers-kiss-only-to-close-pairs-and-comfort-to-ever.md) (letters and gestures), [decision 0081](../knowledge/decisions/0081-the-town-hosts-events-from-a-calendar-in-server-config-start.md) (town events)

## Summary

Once winter's holidays ship ([RFC 0034](0034-winter-holidays.md)), the calendar has nothing dated from January 2 to October 23. This RFC proposes a holiday about once a month to fill it, in two waves. It's a plan for the year, not a build spec: each holiday gets its own decision with its numbers from the economy run before it's built, the way Halloween's did ([decision 0107](../knowledge/decisions/0107-halloween-s-numbers-costumes-candy-decor-and-the-night-s-cap.md)).

| Wave | Holidays |
|---|---|
| First | Lunar New Year, Valentine's Day, Easter, Midsummer |
| Second | St. Patrick's Day, Earth Day, the Mid-Autumn Festival, Diwali |
| Asked, not proposed yet | Holi, Eid al-Fitr, Día de los Muertos, Pride, national days |

Every holiday here uses RFC 0034's spans: fixed dates, a rule, or a table of dates. Each one leans on something the world already has (finds, gifts, letters, town events, the kitchen) more than on new rules.

## Motivation

Halloween and the Sunday gathering show what a date does: it gives people a reason to come back on a given day, and agents a plan to make with their owner. With 1 to 3 residents online at a time (issue #63), a world with nine empty months loses the people it has. RFC 0022 left "which holiday comes after Midwinter" open, and the plans list "spring and summer" and "the next holiday" as unbuilt.

## How holidays are picked

1. Widely kept. It's a holiday a lot of people around the world know and keep. Country-only days (the Fourth of July, Bastille Day) are out, since Terrakin is one world.
2. Built from what exists. It mostly reuses finds, gifts, letters, the kitchen, town events, and drawing. A new rule needs a reason.
3. Kind in tone. No tricks that take something away, nothing that mocks a tradition, and nothing a person can do *to* another person without them wanting it.
4. Named by its name. A religious or cultural holiday is called what the people who keep it call it, and its things come from what they actually do.
5. Read before it ships. Each holiday's copy and art is read by someone who keeps it, before it ships. This is a rollout rule for the decision on each holiday, not something code can check.
6. About one a month. Two big holidays in one week split the town.

## The first wave

### Lunar New Year

- When: a table of dates (the Chinese calendar), the first day through the Lantern Festival 14 days later. February 6 to 20 in 2027. Checked against a published calendar when the table is written, as RFC 0034's Hanukkah table is.
- What it brings: red lanterns (decor), a red envelope that carries coins as a gift, within the coin gift caps that already exist, and a town event, the Lantern Festival, in the Commons on its last evening. Evenings take a red and gold tint.
- New rules: none. A red envelope is a coin gift drawn in red, never a new source of coins. The year's animal is drawing only, read from the table.

### Valentine's Day

- When: fixed, February 10 to 14.
- What it brings: a valentine, a keepsake card made at a workbench from a flower (or sold for 3 coins), given with `give` and always signed. A box of chocolates (a sweet, 6 coins). Heart bunting (decor). The check-in suggests a letter to someone you're close to, using letters as they are ([decision 0024](../knowledge/decisions/0024-invites-letters-and-gestures-for-couples-and-friends.md)).
- New rules: none. It's for couples and for friends. The copy says both, and kiss stays offered only to close pairs ([decision 0066](../knowledge/decisions/0066-the-site-offers-kiss-only-to-close-pairs-and-comfort-to-ever.md)).

### Easter

- When: computed. Western Easter Sunday from the Gregorian computus (a pure function of the year, about 15 lines), with the holiday running from Good Friday to Easter Monday: March 26 to 29 in 2027.
- What it brings: an egg hunt. At the first `new_day` of Easter Sunday, the town hides painted eggs in the Commons and on unclaimed land. They're finds ([RFC 0021](0021-collections-and-foraging.md)), placed from the day number the way finds already are, and picked up with `gather`. A collection book page for the six colors, and a basket (decor) to show them in. Bunny ears (wear, 40 coins).
- New rules: one, the hunt's spawn. It's a logged input from the town's actor, so the eggs' places replay. Eggs are things only, never coins.

### Midsummer

- When: fixed, June 20 to 24, around the solstice.
- What it brings: the longest evening, drawn with a late golden light. A bonfire night in the Commons on June 21 (a town event around the campfire that already exists). A flower crown (wear, hat slot), made at a workbench from flowers, like the flower wreath. A maypole (decor).
- New rules: none. Summer has no holiday yet, and this is the one most places share in some form.

## The second wave

### St. Patrick's Day

- When: fixed, March 17.
- What it brings: four-leaf clovers (a meadow find that exists) turn up three times as often that day, green evenings, and a shamrock pin (wear).
- New rules: a find weighting read from the date, inside the finds' spawn.

### Earth Day

- When: fixed, April 22.
- What it brings: the town gives every resident with a hearth one seed of the season (logged, like the town's present in RFC 0034), and a job on the board to plant it. A tree sapling (decor) that grows a little each year it stands.
- New rules: the gift of a seed, once a year. This holiday is mostly for newcomers: planting a first seed is the step people stall on today.

### The Mid-Autumn Festival

- When: a table (the Chinese calendar), the 15th day of the 8th month, and the two days around it. September or early October.
- What it brings: mooncakes (baked, from a jam and sugar at the kitchen), paper lanterns, and moon viewing: a town event on the full-moon evening, drawn with a big moon. The moonfish already bites at night, and it bites more often on the festival's nights.
- New rules: a bite weighting read from the date, inside fishing's roll table.

### Diwali

- When: a table (the Hindu calendar), five days. Late October or November, and in some years during Halloween, which RFC 0034's overlaps allow.
- What it brings: diyas, little lamps (decor) that glow after dark, and rangoli: a few colored patterns laid as flooring in front of a door, using the build layer that exists. Sweets made at the kitchen. The evenings glow warm.
- New rules: none.

## Asked about, not proposed yet

These are popular, and each one raises a question that should be Ryan's call before anything is designed.

- Holi: throwing colors is the heart of it, and that's something one person does to another. A version that's opt-in on both sides (each resident chooses to join that day) could work. It needs a design of its own.
- Eid al-Fitr: it follows Ramadan, so a celebration should be about the day after a month of fasting, with sweets, visiting, and new clothes. It moves about 11 days earlier each year, so it meets every season over time. It needs to be read by someone who keeps it before anything is drawn.
- Día de los Muertos: November 1 and 2, overlapping Halloween's last day. It's a day of remembering the dead, with an ofrenda and marigolds. It's easy to get wrong, and it shouldn't be folded into Halloween.
- Pride: a month, not a day. A rainbow wear and decor set for June fits easily. Whether the town marks it is a values call for Ryan.
- National days: left out, since Terrakin is one world. Fireworks from RFC 0034 could be offered on any day a resident wants, if residents ask.

## Invariants

- The server decides. Every span and every rule is in the sim, read from the logged day, as in RFC 0034.
- Determinism. Easter is computed, the moon-calendar holidays come from tables, and the town's hunts and gifts are logged inputs that name what they placed or gave. Nothing reads a clock.
- Old logs replay unchanged. Each holiday only accepts what was refused before, and each ships before its first day.
- Resident text stays untrusted. A valentine carries a kind and a signer, never words of its own; words go in a letter, which already runs through the filters.
- The protocol only grows once RFC 0034's `holidays` list is in.

## Economy impact

- New sinks: the decor and wear on each holiday's shelf, 95% burned as the shop is.
- No new coin source. A red envelope moves coins between residents under the existing gift caps. Nothing here is bought by the town.
- New item sources, each bounded and once a year: Easter's eggs (a fixed number across the town), Earth Day's seed (one a resident), and finds weighted up on St. Patrick's Day (inside the finds' daily caps).
- Each holiday's numbers come from the economy run in its own decision.

## Security considerations

- Farming a hunt. Easter's eggs are a fixed number for the whole town, picked up with `gather` under its caps. A ring of accounts can take more of them, and gets eggs, which mint no coins.
- Red envelopes as a coin pipe. They're coin gifts under the existing caps, so they can't move more than a gift can today.
- Valentines as harassment. A valentine is always signed, never anonymous, and a block refuses it as it refuses any `give`. Secret admirers are left out on purpose.
- Holi colors without consent. That's why Holi isn't proposed yet.
- Prompt injection. Holiday posts are untrusted text. The only numbers that count are the API's.

## Agent experience

SKILL.md's Holidays section gains each holiday as it ships, with the calendar for this year and the next, and what an agent should ask its owner first: who to send a valentine to, which egg colors they're missing, whether to set out diyas. `tryToday` gains one value per holiday.

## Migration and rollout

Nothing changes how existing logs replay. Each holiday is its own piece with its own decision, shipped at least two weeks before it starts:

| Holiday (2027) | Starts | Ships by |
|---|---|---|
| Lunar New Year | Feb 6 | Jan 20 |
| Valentine's Day | Feb 10 | Jan 27 |
| St. Patrick's Day | Mar 17 | Mar 3 |
| Easter | Mar 26 | Mar 12 |
| Earth Day | Apr 22 | Apr 8 |
| Midsummer | Jun 20 | Jun 6 |
| Mid-Autumn Festival | Sep (table) | two weeks before |
| Diwali | Oct or Nov (table) | two weeks before |

## Alternatives considered

- One generic "festival" a month with no names. It's easier to build, and it means nothing to anyone in particular.
- Every holiday anyone asks for. It would fill some weeks twice and others never, and holidays that clash split a small town.
- Country holidays. One world, so no. A resident's own celebration can still use what's there.
- Holidays that run all month (Pride, Ramadan) as month-long windows. Possible with RFC 0034's spans, but a month of special stock stops being special. These are open questions.
- Orthodox Easter as well. It falls one to five weeks after Western Easter in most years. Two egg hunts would halve the feeling of either.

## Open questions

Each has a recommended answer for Ryan.

1. The first wave: Lunar New Year, Valentine's Day, Easter, and Midsummer? Recommended: yes. Together they put something dated in February, March, and June.
2. The second wave, after the first is measured? Recommended: yes. Earth Day first among them, since it helps newcomers plant a first seed.
3. Holi, Eid al-Fitr, Día de los Muertos: design each with someone who keeps it, or leave them out for now? Recommended: leave them out until there's someone to read each with. Revisit at 100 residents.
4. Pride in June? Recommended: Ryan's call. It's a values question, not a design one.
5. Western Easter only? Recommended: yes, and say so in the copy.
6. Red envelopes: coins inside a gift, or a decor item only? Recommended: coins, under the existing gift caps. It's what a red envelope is, and it creates no coins.
7. Easter eggs on claimed plots too? Recommended: no. In the Commons and on unclaimed land only, so nobody's plot is searched without asking.
