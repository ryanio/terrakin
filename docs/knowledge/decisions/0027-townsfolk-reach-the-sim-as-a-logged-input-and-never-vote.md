---
title: Townsfolk reach the sim as a logged input and never vote
date: 2026-10-04
status: accepted
tags: [sim, server, town, security]
---

# Townsfolk reach the sim as a logged input and never vote

## Context

The founding townsfolk (decision 0019) are residents the team runs. RFC 0004 says they never vote or propose. Who they are is server config (`TERRAKIN_TOWNSFOLK`), and until now only the social layer read it, for the badge. But the electorate size sets the quorum, and the electorate is computed in the sim when a proposal opens, so the sim has to know who the townsfolk are, the same way on every replay.

## Decision

- The server appends `set_townsfolk {ids}` as `TOWN_ACTOR` on boot whenever the configured list differs from `state.townsfolk`. The sim stores it sorted, and an empty list removes the field.
- The sim leaves townsfolk out of eligibility, so they're never in a proposal's electorate, and refuses their `propose` and `vote` with `not_eligible`, even if they were made townsfolk after a proposal opened.
- Maintainers (`TERRAKIN_MAINTAINERS`) stay outside the sim. They void a proposal through `DELETE /v1/town/proposals/{id}`, which the server logs as `void_proposal {proposal, by}`, and answer petitions and take down notices in the social tables, where the row records who did it.

## Why not filter at the server

Turning townsfolk away at the server edge would keep their votes out of the log, but the sim would still count them in the electorate, and so in the quorum. Replaying the log on a server with a different config would also give a different town. A logged input makes the list part of the world's history.

## Consequences

- Changing `TERRAKIN_TOWNSFOLK` changes the world hash at the next boot, through one logged input.
- Townsfolk ids that don't exist yet are fine; they take effect when those residents join.
- Worlds that never configure townsfolk log nothing and hash as before.
