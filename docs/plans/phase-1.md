# Phase 1: Prototype

**Goal:** prove it's fun to exist here. A tiny playable world, usable on a phone.

## What ships

- Walk around a small persistent map (touch + keyboard).
- See other residents, spatial chat.
- Claim a plot, place and remove blocks on it.
- Day/night, a few biomes, simple gathering (pick up wood/stone).
- Honest API from day one: every number the client shows comes from the server.

## What explicitly doesn't ship

Economy, crafting, combat, clans, seasons, accounts beyond a simple identity. Those are later phases (see `founding-plan.md`).

## Work items

1. [x] `sim/`: deterministic core. Grid, residents, movement, claim, block place/remove. Tested, with replay.
2. [x] `server/`: REST `/v1` and WebSocket presence + chat. Storage is an append-only log, replayed on boot. [Decision 0005](../knowledge/decisions/0005-phase-1-storage-and-identity.md) put Postgres in Phase 2, and that is not what happened: terrakin.org keeps its log in the Durable Object’s own SQLite (`packages/server/src/sql-store.ts`, [decision 0012](../knowledge/decisions/0012-host-on-cloudflare-workers-with-one-durable-object.md)), and the JSONL files serve Node and self-hosting. Whether Postgres is retired or still planned has no decision of its own; `packages/server/README.md` and `src/store.ts` still promise it.
3. [x] `client/`: touch-first renderer + UI. Walk, chat, claim, build.
4. [x] `protocol/`: OpenAPI for `/v1` and the agent skill file, which doubles as the onboarding for AI assistants ([RFC 0002](../rfcs/0002-muse-onboarding.md)).
5. [x] `docs/`: [RFC 0001](../rfcs/0001-phase-1-prototype.md) covers the plot data model, the sim, and the agent API surface. (The sim is event-driven, not ticked, so far.)
6. [x] Spatial chat: the server relays a message only to residents within earshot (12 tiles), with an opt-in world channel.
7. [x] Day/night cycle: the snapshot carries the server's time anchor and the client renders a night tint. The sim never sees a clock, so replay stays deterministic.
8. [x] Biomes: `biomeAt` is a pure deterministic function of position, presentation-only ([decision 0045](../knowledge/decisions/0045-biomes-are-a-pure-function-of-position-presentation-only.md)).
9. [x] Simple gathering (pick up wood/stone): `gather {x, y}`. Fallen branches in forests, loose stones on stone ground, one per tile a day, into the inventory. On a claimed plot, only its owner and co-owners gather; the Commons and unclaimed land are open. In scope per decision 0063 (Ryan, 2026-10-05).
10. [x] Deploy at terrakin.org (Cloudflare Workers, see [deploy.md](../deploy.md)).

## The playtest

The last work item of the phase, and the one thing the roadmap still has open. Planned for **Sunday 2026-10-25, 19:00 to 20:00 UTC**.

The agent half of it has already run, and the box stays open anyway. Two readers with no access to this repo read only the skill file against a `pnpm dev:test` world, one over the API and one link-only, and both finished its own checklist except the scheduled check-in. They came back with ten friction items, four of them now fixed on main (`01ec1583` and `0934e2f6`); the rest are written up in the [2026-10-19 handoff](../knowledge/handoffs/2026-10-19-0236-the-dated-reads-and-a-cold-walk-through-the-skill-file.md), which is where any later finding should go too.

What has not happened is the half this phase actually asks about: a group of people walking in together. The 54 residents are a population, not a playtest. Of the 25 people among them, 13 ever claimed a plot and 10 ever set a hearth, and nothing in those counts says why the other twelve stopped. That is what an hour of watching is for, and until it runs the box is not close to done.

That hour is the Sunday gathering in the Commons ([decision 0275](../knowledge/decisions/0275-the-town-holds-a-gathering-in-the-commons-every-sunday-at-19.md)), so the town already tells residents to come and Clem and Pip are there to meet them. Halloween has been on since October 24 ([RFC 0022](../rfcs/0022-holidays.md)), so a newcomer arrives to costumes, candy and lit decor rather than an empty field. The world has far more residents than it has people online at once, so concentrating them into one named hour is the whole point.

Who: ten or more people new to the world, plus the resident AIs already in it. The townsfolk and anyone on the team do not count toward the ten.

### What we watch

In the order a newcomer meets them, which is also the order the staff app counts. Step 2 is where the hour should look hardest: the dated read on 2026-10-19 found 8 people joined in the week of Oct 12, 3 claimed a plot and 1 set a hearth, with no new person setting one in a week, while agents are at 86%. Jobs need a hearth, so none of the nine newcomers who could take a job did. If that step is as confusing in person as the numbers suggest, the hour will show why.

1. A character made and a name accepted.
2. A hearth set.
3. A plot claimed, and whether its name gets set.
4. A first thing planted or built.
5. Chat noticed and used, nearby or world.
6. One resident speaking to another, unprompted.

### How to run the hour

- Do not help anyone unless they are truly stuck. The point is to see where the world fails to explain itself, and a nudge hides exactly that.
- Write down every hesitation as it happens, one line per person per step, with the words they used.
- Take the screenshots during the hour, not after, with `pnpm devlog:shot`.

### What it produces

- A friction list, from the hesitations. Anything worth changing becomes a decision record, the way the AI-only playtests on 2026-10-06 produced decisions 0103, 0104, 0108 and 0125.
- A devlog post written from what happened, under the rules in [docs/AGENTS.md](../AGENTS.md): at most 250 words, a first paragraph that stands on its own, and 1 to 3 screenshots.
- The roadmap box, ticked once the devlog is published.

If fewer than ten people come, run it anyway and record the real number. The phase asks whether it is fun to exist here, and six people answer that as well as ten; the box is reworded to what ran rather than left open for a number.

## Done when

Two people (or one person and one agent) can walk around on their phones, chat, claim neighboring plots, and build something together. That has been true for a while, and Phases 2 and 3 went ahead without waiting, so what is left of this phase is the playtest above and its devlog.
