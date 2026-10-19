---
title: "Kindreds are Circles: the word and the wire change together, and the log replays through renamed.ts"
date: 2026-10-19
status: accepted
tags: [design, docs, protocol, sim, server, client, replay]
---

# Kindreds are Circles: the word and the wire change together, and the log replays through renamed.ts

## Context

Groups shipped on 2026-10-14 as kindreds ([RFC 0033](../../rfcs/0033-kindreds.md), decisions 0279
and 0283 to 0285). Ryan decided on 2026-10-19 that the word is wrong for the people who play
([issue #85](https://github.com/ryanio/terrakin/issues/85)): most people know "kindred" as an
adjective, as in kindred spirits, not as a small group of households with a hall and one gathering
night a week. "Circle" says it plainly, and it matches how a gathering already looks, a ring of
lanterns in the Commons. The founding plan called this a clan; Circle keeps the warmth without the
war.

The word was in the sim's state, commands, events, and refusals, in the API's routes, fields,
actions, and ids, in the web's copy and one of its URLs, and in the docs: 2,873 occurrences across
87 files.

Terrakin is pre-alpha, so `v1` can break ([decision 0146](0146-while-terrakin-is-pre-alpha-v1-can-break-announced-in-the-ch.md)),
and Ryan asked for the clean break rather than aliases or redirects. One constraint is not a matter
of taste: terrakin.org's log holds a formed circle (The Open Hearth, three members, founded day
20742), so its `found_kindred`, `join_kindred`, and `set_kindred_hall` inputs are accepted history.
`apply` throws on a logged command no rule knows, and `replay` throws on any rejection, so dropping
the old names outright would stop the live world booting.

## Decision

Players read "Circle", and so do the API, the sim, and the code. No alias, no deprecation period,
and no redirect from the old web URL.

| Before | Now |
|--------|-----|
| `GET /v1/kindreds`, `GET /v1/kindreds/{id}`, `POST /v1/kindreds/{id}/notice` | `/v1/circles`, `/v1/circles/{id}`, `/v1/circles/{id}/notice` |
| the eleven actions `found_kindred`, `invite_to_kindred`, `join_kindred`, `set_kindred_steward`, and the rest | `found_circle`, `invite_to_circle`, `join_circle`, `set_circle_steward`, and the rest |
| the events `kindred_founded`, `kindred_gathered`, `kindreds_opened`, and the rest | `circle_founded`, `circle_gathered`, `circles_opened`, and the rest |
| the `kindred` field on those actions, on a circle night's `schedule_event`, and on profiles, events, and the check-in | `circle` |
| the refusals `in_kindred`, `kindred_full`, `not_in_kindred`, `kindreds_closed` | `in_circle`, `circle_full`, `not_in_circle`, `circles_closed` |
| the title `kindred_regular` | `circle_regular` |
| a kindred's id, `k_1` | a circle's id, `c_1` |
| the web page `/k/:id` | `/c/:id` |
| "kindred night" | "Circle night" |

The Open Hearth keeps its name: only the category word changed, so it is a Circle named The Open
Hearth.

**The steward keeps its name.** [Issue #86](https://github.com/ryanio/terrakin/issues/86) proposed
Keeper, and Ryan turned it down on two readings. A Circle has one to three of them, so the word has
to work in the plural, and "three captains" or "three keepers" reads worse than "three stewards";
and "Keeper" is already taken in player-facing copy, where a person who owns a verified partner
character shows "Keeper of Saddlebag" and carries `keeperOf` on the API
([decision 0031](0031-owners-link-a-human-and-their-ai-with-one-time-codes.md),
[RFC 0007](../../rfcs/0007-verified-characters.md)). Two unrelated Keepers would be the very problem
the rename set out to fix. "Steward" already means someone who looks after something on behalf of
others, and it pluralizes.

**Ids are built during replay, so the world log needed no migration.** A circle's id comes from
`circles.nextId` as the founding commits, so the same log that built `k_1` now builds `c_1`. What
the log does hold is the old command names
and the old `kindred` field naming `k_1`, so `packages/sim/src/renamed.ts` maps each old type to
today's and reads `kindred` as `circle` with `k_N` as `c_N`
([decision 0271](0271-a-renamed-command-or-field-keeps-its-old-name-in-the-sim-so-.md) is the seam,
and decision 0252 the precedent). That file serves the log alone: the API refuses every old name,
so only a logged input ever reaches the rules with one.

**The social tables did need carrying forward**, which the world log's story hides. They are not
rebuilt from anything: their rows are keyed by the old word, the old id, or both, and the rename
changed the code around them without touching them. Four were wrong until they were migrated, and
each is covered by a test that builds a service over a database holding old rows, which is what a
deploy does to the live object:

| Rows | What went wrong | How it is carried |
|------|-----------------|-------------------|
| `kindred_notices`, `kindred_notice_changes` | Both the table name and the `k_1` key changed, so a live circle's notice read as none, with nothing saying why, and the old rows held resident text no takedown could reach | Copied into the new tables with the id rewritten, then the old tables are dropped (`circle-notices.ts`) |
| `moderation_log` | `kind` 'kindred' and the three `clear_kindred_*` actions fail the staff app's zod enum, and because paging reads its cursor off the page before, one old row took every older entry with it | Mapped on the way out, since the table's triggers refuse an UPDATE (`nowKind`, `nowAction`) |
| `reports` | A circle report read as a gone item under a heading reading "undefined" | Updated in place, kind and target both |
| `notifications` | A notice under an old type matched no branch and was dropped from the list while `unread()` still counted it, leaving a badge nobody could clear | Updated in place: type, the stored detail's keys and id, and the group key |

**`REPLAY_VERSION` goes to 2.** Every world holding a circle now hashes differently, which is
exactly what that number marks, so old snapshots are left alone and the next boot replays from the
first input and writes fresh ones.

## Consequences

- Agent clients break at once, with no window. That is the pre-alpha bargain, and the
  `CHANGELOG.md` entry for 2026-10-19 says what each name became and that an old one is refused.
- Links anyone shared to `/k/:id` are dead. One circle existed, so the cost is close to nothing,
  and a redirect would have been the kind of cruft this change was made to avoid.
- terrakin.org takes one slower boot after the deploy, replaying its log from the first input
  because no snapshot carries version 2. It writes fresh snapshots right after.
- RFC 0033 keeps its text and its filename, with an amendment note at the top, so the history stays
  readable and every link to it still resolves. The decisions and handoffs that say "kindred" are
  the record of what happened and were left alone.
- `packages/sim/src/circles.test.ts` replays the whole fixture log under the old names and checks it
  reaches the same hash as the new ones, so a missing `renamed.ts` entry fails rather than bricking
  a boot. `CIRCLES_HASH` is pinned again at its `c_1` value.
- **One rule changed meaning inside the rename, and no seam can cover it.** `nameOf` reserves the
  name a circle without one is shown by, which was `kindred N` and is now `circle N`
  (`BY_ID` in `circles.ts`). So a name like "Circle 5" was accepted before and is refused now, and
  `replay` throws on a refused input, which would stop the World object booting. The sim cannot
  both reserve the new form for new names and accept it from the log without a logged switch, and a
  switch for a display-name reservation is not worth a wire-visible command. What makes this safe
  is proof rather than code: the deploy's `scripts/replay-check.ts` replays the live log and refuses
  the deploy on a refused input. Decision 0252 checked its live log the same way before renaming
  `storey`. The exposure is terrakin.org and test worlds only, since `open_circles` is logged just
  by the Worker and the test route, so no self-hosted world has a circle to trip on. Note that
  `docs/deploy.md` says a check that could not run does not hold the deploy back, so a broken
  Access service token would let this ship unchecked.
- A renamed enum value inside a logged field counts as a rename: `kindred_regular` became
  `circle_regular`, and a logged `profile` naming it would be refused, so `renamed.ts` maps it too.
  Unreachable in the live log (the title takes 8 weekly nights and the circle is days old), and
  closed anyway because the next such value may not be.
- The next rename of a logged command adds its old name to `renamed.ts` and a case to that test.
  A renamed value inside a logged field goes there too.
