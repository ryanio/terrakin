---
title: On the web a job is a row at the Town Hall, a chip and a toast in the world, and a card on the home wall only while it's held
date: 2026-10-11
status: accepted
tags: [client, jobs, e2e, protocol]
---

# On the web a job is a row at the Town Hall, a chip and a toast in the world, and a card on the home wall only while it's held

## Context

[RFC 0030](../../rfcs/0030-jobs.md)'s PR 5 puts jobs on the web. The API already had them, behind a switch no server sets ([decision 0260](0260-jobs-reach-the-api-behind-an-option-no-adapter-sets-with-fiv.md)), and turning it on is PR 6. So the web has to show jobs in a world that opened them and look exactly as it did in every world that hasn't: no empty section, card, chip, or row.

The RFC's "On a phone" section names the places. It leaves open where on the Town Hall page the section sits, how each page learns that jobs are open, what a toast calls the thing a deed counted, what the web calls a giver who doesn't live in a world, and how the home wall shows a card without growing the first load or moving the page.

## Decision

- The client reads everything from `GET /v1/jobs` and decides nothing. A row's Take button shows when `you.canTake` is true, the row for `you.held` is marked "Yours", and when nothing can be taken the server's `you.why` is the one line that says so. `jobs.ts` holds the words and that choice, pure and tested.
- Nothing about jobs is asked for or drawn until the world says they're open. The Town Hall and the home wall read `jobsOpen` from the world snapshot they already fetch, and only then ask for the board. The world reads the mirror's `jobsOpen`. The skills sheet shows its row only when a profile carries `jobs`. The look editor and the bounties page ask `GET /v1/jobs` once and read `open`, since neither has a snapshot.
- The Town Hall's Jobs section sits in the main column after the proposals and before past results, at `/town#jobs`. Proposals can be waiting on a vote today, and the RFC wants no daily prompt, so jobs don't go first. The board comes in with the page's first load, so the section never pushes the page down later.
- A giver is drawn and named while that townsfolk lives in the world (`from.id`), and otherwise the job is "for the town" with the town's mark, as the server's own lines say "the town's job".
- `you.held` on `GET /v1/jobs` gained `from`, `skill`, and `deed` or `bring`. A job held from an earlier day is no longer on the board, and without these the web couldn't say who asked or what a deed counted.
- In the world a chip, "Job: 1 of 3", is first in the column where Fish and Gather all show, and opens the job's sheet. The four job events are private and arrive on the socket, so each toast joins the line the same action's coins and things made. A progress toast says "2 of 3 harvests of herbs for Juniper", where the RFC wrote "2 of 3 herbs": one harvest brings up three bunches and counts once, and "1 of 3 herbs" beside "You picked 3 bunches of herbs" reads as a mistake.
- A townsfolk who asks for something today wears a note, a sixth sign on the paper disc feelings' signs use, on the map and in 3D. It shows whether they're awake, asleep at home, or out on a routine, since the job is asked either way, and gives way only to a sign of the moment (a heart, a sparkle, thinking dots). A tap on them, asleep or not, opens their job with Take.
- The home wall's card shows only while a job is held. Its code and its read load with `import()`, and only once the wall's first world snapshot says jobs are open, and the card goes in with the wall's first paint like the Getting started card. The first load went from 115.4 kB to 115.6 kB gzipped.
- Hand in asks for a second tap, since the thing leaves your things for good. Let go doesn't: it costs nothing.
- Once jobs are open, `/bounties` says "bounties" where it said "jobs" and points to the Town Hall's section, and the section points back. Before they're open the page reads as it did.
- The e2e steps are a fifth serial test in `town.spec.ts`, the Town Hall's journey, which has a server of its own. Which three jobs a day has depends on the date, so the test moves that server's clock on until the chair job is up (`jobDay`), up to 36 days. `recipes.spec.ts`, where levels open, shares its server with `bounties.spec.ts`, whose bounty a jump like that could expire.

## Consequences

- A world without jobs asks for one thing more than before: the look editor and the bounties page each read `GET /v1/jobs` once and get `open: false`. Everything else is unasked and undrawn. `town.spec.ts` checks the Town Hall has no Jobs section before the switch.
- The Town Hall's jobs steps open levels and jobs on the town spec's server at its very end, after everything else there has run.
- `pnpm persona stocked --open-jobs --job bram_chair` opens jobs on a test world and moves its clock to a day with that job, so a person can look.
- The note is drawn but can't be seen in a world whose givers aren't townsfolk, which is every dev and e2e world until someone seeds them. It was looked at with one resident named as townsfolk through `TERRAKIN_TOWNSFOLK`.
- For PR 6: nothing on the web needs turning on. It follows `jobsOpen`.
- Code: `packages/client/src/jobs.ts` (words and choices), `job-parts.ts` (a board row and the held job), `jobs-section.ts` (the Town Hall), `job-sheet.ts` and `world-jobs.ts` (the world), `job-card.ts` (the home wall), `api/jobs.ts`, `level-sheet.ts`, `look-editor.ts`, `bounties-view.ts`, the `note` sign in `packages/ui/src/figure.ts`, `HeldJobView` in `packages/protocol/src/jobs.ts`, and `e2e/town.spec.ts`.
