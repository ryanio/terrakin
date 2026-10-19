---
title: The dated reads and a cold walk through the skill file
date: 2026-10-19
tags: [onboarding, analytics, agents, admin, protocol]
---

# The dated reads and a cold walk through the skill file

Two halves: the reads the roadmap dated for 2026-10-19, and a cold walk through
`packages/protocol/SKILL.md` by two readers who had never seen this repo.

## The newcomer funnel, read 2026-10-19

From the staff app's Newcomers page. All time, 54 joined, 25 people and 29 AIs, 2 of them from
before the world counted days.

| Step | People (25) | AIs (29) |
|---|---|---|
| Claimed a plot | 13 (52%) | 28 (97%) |
| Set a hearth | 10 (40%) | 25 (86%) |
| Got a first thing | 5 (20%) | 21 (72%) |
| Changed their look | 13 (52%) | 20 (69%) |
| Did something social | 13 (52%) | 26 (90%) |
| Took a job | 1 (4%) | 4 (14%) |
| Adopted a pet | 4 (16%) | 2 (7%) |

Week of Oct 12, 16 joined (8 people, 8 AIs). People: 3 claimed, 1 hearth, 2 a thing, 8 a look,
4 social, 0 jobs, 1 pet. AIs: 8 claimed, 8 hearth, 7 a thing, 6 a look, 8 social, 0 jobs, 0 pets.
Week of Oct 5, 33 joined (14 people, 19 AIs): claimed 9 / 18, hearth 8 / 15, thing 2 / 12,
look 4 / 12, social 8 / 16, job 1 / 2, pet 2 / 2.

**The share with a first thing.** Built the way the roadmap builds it, things over hearths among
all-time people: 5 of 10, against 3 of 10 in [decision 0269](../decisions/0269-a-home-leads-straight-to-a-first-seed-planted-in-one-tap-and.md).
The one-tap seed moved the step it aimed at.

That ratio is an approximation, and before this session the page could not give the true one. The
funnel's counts are not nested: each step counts everyone who ever did it, in any order. The week
of Oct 12 proves they come apart, with 2 people holding a thing and only 1 holding a hearth. The
real share of hearth-holders with a thing is between 4 of 10 and 5 of 10.

**The leak moved upstream, and that is the finding.** Decision 0269 on 2026-10-12 had 19 people
joined, 11 claimed, 10 hearth. Now: 25 joined, 13 claimed, 10 hearth. Six more people arrived, two
claimed a plot, and **not one set a hearth in a week**. The week of Oct 12 is 8 people joined,
3 claimed, 1 hearth. The step that leaks is now claim to hearth, not hearth to thing.

Agents are not the problem and never have been: 97% claim, 86% hearth, 72% a thing.

**First jobs in a first week: 0 of 16.** The week of Oct 12 is the only cohort that joined entirely
after jobs opened on 2026-10-11, so for it "ever took a job" is "took one in a first week".
`take_job` needs a hearth (`takeJobProblem` in `packages/sim/src/jobs.ts`), so only 9 of those 16
could take one at all. None of the 9 did. All time, 5 of 54 residents have ever taken a job.

**Plot names and handles do still get set**, and more than they used to. The Newcomers page could
not answer this, so it came from `GET /v1/plots` (public, 48 plots, under the `PLOTS_MAX` of 100,
so the whole list), with the 8 townsfolk plots taken out:

| | plots | named | owner has a handle |
|---|---|---|---|
| People | 12 | 5 (42%) | 4 (33%) |
| AIs | 28 | 18 (64%) | 23 (82%) |

Split by when each plot last changed, as a rough recency cut: of the 21 that changed on or after
2026-10-12, 17 are named (81%) and 19 owners hold a handle (90%); of the 19 that changed before,
6 (32%) and 8 (42%).

## The market, read 2026-10-19

The Sell form began naming what the town buys in `e81827fa`, 2026-10-12.

- 19 open listings, **one seller**, a person, holding every one. 409 coins asked in total.
- Four of the 19 were listed after the Sell form change, all by that same seller. Nobody new has
  listed since.
- **No sale in eleven days.** A sale pays the treasury a 5% `market_fee`, and the public treasury
  ledger keeps the newest 50 lines (`ledgerMax` in `packages/sim/src/economy.ts`). It is currently
  exactly full and covers 2026-10-09 to 2026-10-19, three days before the change. There is not one
  `market_fee` line in it.
- What the outside cannot see: sales before 2026-10-09, and listings made and then sold or
  withdrawn. Only the world log has those, and that needs a maintainer read.

## The cold walk through SKILL.md

Two readers with no access to this repo read only `http://localhost:8797/skill.md` and followed it
against a `pnpm dev:test` world, one over the API and one as a link-only reader. Both finished the
file's own done-checklist except the scheduled check-in, which neither could set up from inside the
walk. Neither hit a wall it could not get past. What they found, with what was fixed:

1. **The chair's wood was wrong.** Step 8 said "pick up three fallen branches" for a chair the
   workbench makes from two, and the file's own generated furniture table said 2. Fixed, and
   `protocol.test.ts` now pins step 8's wood words to the catalog's recipes.
2. **A refused join over REST never carried `free`.** The protocol's `ErrorBody` declares it,
   SKILL.md promises it twice, and the live socket's join already sent it, but the REST handler
   dropped it. Fixed, with a route test that goes red without it. The file's example format was
   wrong too: free names are "Juniper 2", with a space.
3. **The link craft page sent you to the API to gather**, although `/v1/act/<key>/gather` exists and
   the check-in points at it. It links the garden and gather links now.
4. **The link build page silently ignored `design=` and `path=`.** It takes only `walls` and
   `windows`. The page says so now, and the file's link list says the link builds the starter home.
5. Step 7 says settling leaves you on your hearth's tile with today's coins already in. Measured: a
   `settle` brings only the 50-coin welcome gift, and the pantry arrives with `set_hearth`. It
   works because step 6 comes first, so the sentence is loose rather than harmful. Not fixed.
6. The file is 304 KB, and a first visit reads about 850 lines across five regions of it. Both
   readers fetched the whole thing. A short first-visit file is a real change, not a fix.
7. Step 12 tells an agent to schedule a check-in every 3.5 hours; Routines says how often is the
   owner's call, and "Whose call it is" doesn't list it. There is nothing copy-ready to paste into
   a scheduler either.
8. Step 11 assumes a populated feed. With an empty one there is nothing to react or reply to, and
   the file gives no fallback (it has one for "no plots claimed").
9. The JSON check-in's `todo` said to wave back at a resident the server then refused with
   `rate_limited`, because the reader's own putter wave to them already counted.
10. Over the API, `move` walks one tile a call while the link path's walks ten, so reaching a
    pickup the gather hint names cost ten POSTs. The link path's own walk hint routed into a block
    with no way out.

## Shipped

- The Newcomers funnel counts two more steps, **named their plot** and **picked a handle**, so the
  roadmap's dated read is answerable from the page it names. `plotName` reuses the check-in's own
  `plotNamed`, so the page and the first-visit step agree; `handle` reads the handles table.
- `POST /v1/session` carries `free` on a `name_taken`, with a changelog entry.
- The three SKILL.md and link-page corrections above, and the test that pins step 8's numbers.

## Next

1. **The claim-to-hearth step for people.** This is where they stop now, and no new person has
   passed it in a week. The web's card puts Build a home right after Claim a plot and the home sets
   the hearth, so the question is what someone sees between claiming and building. Worth watching
   someone claim from a phone before changing anything.
2. **Whether the home wall shows newcomers a job** is still open and still Ryan's
   (decision 0269's open question). The number to decide it with: 0 of the 9 newcomers who could
   take a job took one.
3. **A short first-visit file.** `QUICKSTART_SECTIONS` already cuts SKILL.md down for `/docs`;
   serving something like it at a stable URL would save a cold reader 300 KB. Needs a decision.
4. The check-in's wave-back line should drop when the reader's own recent wave is what blocks it.
5. The funnel still cannot say what share of hearth-holders got a thing, only the two counts side
   by side. A nested count would answer it, and would be the first count in the funnel that isn't
   "everyone who ever did this".

## Open questions

- Should the market read change anything? One seller and no sales in eleven days is the second
  read in a row with no trade. The roadmap holds "whether the town buys finds, wood, stone, or
  furniture" behind market use that isn't coming.
- Seeding residents on terrakin.org for a playtest needs Ryan's own yes. Nothing here touched the
  live world beyond public reads and the staff page.
