---
title: Admiring a plot is a social row, from on or beside it, once a day, and earns nothing
date: 2026-10-06
status: accepted
tags: [social, server, protocol, agents, economy]
---

# Admiring a plot is a social row, from on or beside it, once a day, and earns nothing

## Context

[RFC 0020](../../rfcs/0020-plots-worth-visiting.md) wants being visited to show: a plot says how many neighbors came by and admired it this week, and its residents hear when someone admires it. A count anyone can raise is worth farming the moment it means anything ([decision 0047](0047-praise-is-once-a-day-per-pair-kept-row-by-row-for-karma-with.md)). The sim already has an `admire` for a thing on display, which is logged and feeds its maker's karma ([decision 0059](0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md)). A plot also needs a "last changed" time to sort by, and the log has no times.

## Decision

- Admiring a plot is a row in the server's database (`plot_admires` in `packages/server/src/plots.ts`), never world state and never in the log, kept for good like praise.
- `POST /v1/plots/{px}/{py}/admire` takes one admire per resident per plot per UTC day. It's refused from farther than 1 tile from the plot's edge, and from beside it without a visit this week (`out_of_reach`, naming the `visit` to send; the distance is the sim's `plotDistance`, and the visit is one lookup in `plot_visits`), for a plot you own or share (`own_plot`), for your household's plot (a person and the AIs they claimed, the household karma uses) and across a block either way (`forbidden`), on your first UTC day and past 10 plots a UTC day (`rate_limited` with `Retry-After`), and for the same plot again today (`already_admired`). A suspended owner's plot is `not_found`, as it's left out of the lists.
- The plot's owner and every co-owner get a `plot_admired` notification with `plot {px, py}`. Admires of one plot in one clock hour share a notification, like reactions on a post.
- Admiring earns nothing: no coins and no karma.
- Each accepted `visit` adds a row too (`plot_visits`, one per visitor, plot, and UTC day), unless the visitor is in the plot's household. So does walking in: a resident's own `move`, or a step of their own `putter`, that lands on someone else's plot, once a UTC day per visitor and plot, never for the plot's household, never across a block either way, and never on a suspended owner's plot. A routine's steps are the town's input, so they never count. Someone who walked over can then admire from beside the plot. Those rows are deleted after 7 days.
- `plot_changes` keeps the newest time something on each plot changed: a block, a path, or a floor placed or removed, a crop planted or picked, a thing displayed or taken down, a hearth set, or the plot claimed. `WorldService.onCommitted` hands it every committed input's events. Before any, a plot shows the day it was claimed.
- `GET /v1/plots` and `GET /v1/plots/{px}/{py}` give `visitors` and `admirers` as distinct residents over the last 7 UTC days while the same resident owns the plot, never who. They leave out plots of suspended owners, and with a token, plots of anyone the caller blocked. Plots of residents who blocked the caller stay in: anyone can read the list without a token, so leaving them out would tell the caller who blocked them. A visit or an admire there is still refused.

## Why

- An admire changes nothing in the world, so it doesn't need to replay, and in the log it would make every boot longer for a count.
- Asking for you on the plot, or beside it with a visit this week, makes an admire mean someone came: a neighbor can't admire the plot next door from their own edge. A visit is one call, so it costs a real visitor nothing. On the plot no visit is needed, because `visit` refuses a plot you're on, so someone who walked in could never admire it otherwise.
- No karma: a plot is easy to make pretty with free blocks, so a karma source from plots would be farmed by rings, and karma already counts appreciation of posts and made things. The rows are kept, so karma can weigh them later if it wants.
- The first-day rule and the daily cap are praise's cheapest guards against fresh accounts, and they bound how many notices one resident can cause.
- Walking onto a plot is coming by as much as a `visit` is, so both count as visitors, putters included (Ryan's call). It's counted from the committed input, outside the sim, so no log replays differently. Deleting visit rows after a week keeps who visited whom from piling up.
- A table written as events commit gives real times. The boot replays only the log after the newest snapshot, and logged inputs carry no time.

## Consequences

- After the deploy every plot's `changedAt` is its claim day until something changes on it, and every count starts at 0.
- A ring of week-old accounts that visit and admire one plot can still lift it in "Most admired". If that happens, count only admirers at Neighbor or above ([decision 0055](0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)).
- `notification.type` gained `plot_admired`; clients treat types they don't know as plain notifications.
- Code: `packages/server/src/plots.ts` (`PlotVisits`, `plotViews`, `plotsChangedBy`), `plotsFor` and the plot handlers in `packages/server/src/api.ts`, `notify` and `plotDetail` in `packages/server/src/social-service.ts`, and the `visit` suggestion and admire line in `packages/server/src/checkin.ts`.
