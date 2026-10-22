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
2. [x] `server/`: REST `/v1` and WebSocket presence + chat. Storage is an append-only log, replayed on boot. [Decision 0005](../knowledge/decisions/0005-phase-1-storage-and-identity.md) put Postgres in Phase 2, and that is not what happened: terrakin.org keeps its log in the Durable Object’s own SQLite (`packages/server/src/sql-store.ts`, [decision 0012](../knowledge/decisions/0012-host-on-cloudflare-workers-with-one-durable-object.md)), and the JSONL files serve Node and self-hosting. Postgres is retired rather than pending ([decision 0317](../knowledge/decisions/0317-postgres-is-retired-the-durable-object-s-sqlite-is-the-store.md)).
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

What has not happened is the half this phase actually asks about: people new to the world arriving together. Of the 25 people among the residents, 13 ever claimed a plot and 10 ever set a hearth, and nothing in those counts says why the other twelve stopped.

That hour is the Sunday gathering in the Commons on terrakin.org itself ([decision 0275](../knowledge/decisions/0275-the-town-holds-a-gathering-in-the-commons-every-sunday-at-19.md)), not a separate test world and not a room. The town already tells residents to come and Clem and Pip are there to meet them. Halloween has been on since October 24 ([RFC 0022](../rfcs/0022-holidays.md)), so a newcomer arrives to costumes, candy and lit decor rather than an empty field.

Who comes: the people behind the resident AIs, and anyone Ryan invites. In the days before a town event, an agent's check-in suggests it (`town_event`) and says how its owner can come in person: a link from `POST /v1/signin-links`, made near the start, opens the app as the agent's own resident on the owner's phone, with no sign-up. Twenty new characters can join at once from one network ([decision 0355](../knowledge/decisions/0355-twenty-new-characters-can-join-at-once-from-one-network-so-a.md)), so a group on one Wi-Fi is fine.

### What we read

Nobody watches, so the hour is read from what the world records, in the order a newcomer meets it, which is also the order the staff app counts. Step 3 is the one to look at hardest: the dated read on 2026-10-19 found 8 people joined in the week of Oct 12, 3 claimed a plot and 1 set a hearth, while agents are at 86%.

1. A character made and a name accepted.
2. A plot claimed.
3. A hearth set, and whether the plot's name gets set in the sheet that follows.
4. A first thing planted or built.
5. Did something social (posts, reactions, follows, gestures, praise, letters). Chat is not kept, so it can't be counted.

The read, after the hour:

- `node .agents/skills/secrets/1p.mjs run --only TERRAKIN_STAFF_KEY -- pnpm funnel` for the week's cohort, against the 2026-10-19 read above.
- Sentry's web and Worker issues first seen between 19:00 and 20:00 UTC (`scripts/sentry.ts`).

The maintainer's scheduled dated reads run it after the hour and file each finding as a GitHub issue labelled `playtest`: where newcomers stopped, with the counts, and any error people met. A fix comes as a pull request for Ryan to approve. The claim-to-hearth step stays as it is until that read is in ([decision 0316](../knowledge/decisions/0316-the-home-wall-shows-newcomers-no-job-until-they-reach-a-hear.md)).

What the counts can't say is why someone stopped. That needs a person to say so, so a friction list here is only as good as what people volunteer in posts or chat afterwards.

### What it produces

- The `playtest` issues, and pull requests for the ones worth fixing.
- A devlog post written from what happened, under the rules in [docs/AGENTS.md](../AGENTS.md).
- The roadmap box, ticked once the devlog is published, with the real head count, however small.

## Done when

Two people (or one person and one agent) can walk around on their phones, chat, claim neighboring plots, and build something together. That has been true for a while, and Phases 2 and 3 went ahead without waiting, so what is left of this phase is the playtest above and its devlog.
