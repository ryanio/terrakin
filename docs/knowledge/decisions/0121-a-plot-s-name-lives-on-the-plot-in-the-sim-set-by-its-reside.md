---
title: A plot's name lives on the plot in the sim, set by its residents once a day with two free renames, filtered at the edge, and cleared by release or staff
date: 2026-10-06
status: accepted
tags: [sim, protocol, server, client, safety, agents, replay]
---

# A plot's name lives on the plot in the sim, set by its residents once a day with two free renames, filtered at the edge, and cleared by release or staff

## Context

Ryan asked for plot names: a plot's owner, or a resident it's shared with, names it ("Juniper's Lemon Grove"), and the name shows wherever the plot does, on the map, the cards, profiles, photos, and to agents. A name could live on the plot in the sim, like its `gallery` flag, or in a row the server keeps beside the world. It is resident text drawn on everyone's map, so it needs the edge filters, a report path, a way for staff to take it down, and a limit on how often it changes. A limit that counted the first name made a typo wait a day, so Ryan asked for a couple of free renames on top of it (2026-10-06). Names were live by then, so the live log may hold `name_plot` inputs.

## Decision

- **The name lives on the plot in the sim.** `Plot.name`, with who set it (`namedBy`) and the world's day it was set (`namedDay`), all absent until the first name (`packages/sim/src/plot-names.ts`). `release` drops the plot's record, so the name goes with the plot, and whoever claims it next starts with none.
- **`name_plot {px, py, name}`** names a plot its owner or a co-owner lives on, from anywhere: 1 to 40 characters after trimming (`PLOT_NAMES.max`). A name changes once a world day. On a day it already changed, a change takes one of the plot's 2 free renames (`PLOT_NAMES.freeRenames`), counted in `freeRenamesUsed` on the plot, absent until the first, and `plot_named` carries `freeRenamesLeft` after one. A free rename only changes a name that's up, and they don't come back; `release` drops them with the record. With none left, or once the name came down that day, it's `rename_limit`, and the message says how many the plot has left. `"name": null` clears it at any time, and keeps `namedDay`, so clearing never makes room for another name that day. Refusals: `out_of_bounds`, `plot_is_commons`, `plot_unclaimed`, `not_your_plot`, `invalid_name`, `rename_limit`, and `already_set` (the name it has, or no name to clear).
- **Filtered at the edge.** The server cleans the name and runs it through a new surface, `plot_name`, held to the rules for names (strong language, staff-sounding names, and link shorteners refused), before it's logged. `plot_named` goes out marked `trust: "untrusted"`, and plots carry `name` with the same marker in `GET /v1/world` and `GET /v1/plots`. Profiles carry `home`, the plot they call home, with its name. Link pages quote names under the untrusted line, the profile's Markdown twin fences it, and a plot photo wears it as its title.
- **Its writer answers for it.** While staff hold back the words of whoever named a plot (a quarantine), the name is held back everywhere, as a pet's is. A report on a plot's owner (`resident`) shows staff the names that are theirs to answer for, on plots they own and names they wrote on plots shared with them, saying who wrote a name someone else did. `POST /v1/admin/residents/{id}/clear-plot-names` takes them down: one server-only `clear_plot_name {px, py}` in the log for each (`plot_name_removed` on the wire), one `clear_plot_names` line in the moderation log, the reports closed, and a `takedown` notice (`what: "plot_name"`, with `plot`) to whoever wrote each name. The day it was named stays.
- **Asked for once there's a plot.** The web asks right after a claim, and the visit card on your own plot and your profile rename it later. Agents get `plot_name` in `firstVisit`, done once a plot they live on has a name (or they named one and took it down). An unnamed plot still reads "Tansy's plot".
- **On the map** a name is a soft paper label along the top of the plot, in full from on it or beside it and fading out by 6 tiles off. On a map drawn at 44 pixels a tile or more (a tablet or desktop), every plot on screen shows its name. A label slides down below the visit card and stays on screen sideways.

## Why

- In the sim, who may name a plot is the sim's own rule (`canBuildOn`), the name dies with the plot on `release` without a hook, the once-a-day limit is state the log replays, and `plot_named` reaches every client live with the rest of the world's events. A server row would need its own copy of who owns what, a hook on every release and claim, and its own way to push changes. Pet names set the pattern ([decision 0089](0089-pets-live-on-the-resident-in-the-sim-where-they-are-is-drawi.md)).
- Once a day, with two free renames: a plot's name is drawn on everyone's map, so a name that churns is louder than a pet's, and one change a day is easy to say. Two changes on top of it fix a typo or a second thought without a wait, and they don't come back, so a name still can't churn. Taking words down should never wait, so clearing is always open, but it can't be used to rename twice, and a free rename only changes a name that's up: after a resident clears a name, or staff take one down, a new one still waits for the next day.
- The free renames need no logged switch. One is used only by a change the once-a-day limit refused before, and a refused input is never logged, so every logged name takes the once-a-day path it always took, writes no `freeRenamesUsed`, and its `plot_named` carries no `freeRenamesLeft`. A switch from `TOWN_ACTOR`, like `keep_table_spots`, would add a command, a flag, and a server hook to guard inputs that can't reach the new path. A counter on every name would have changed the hash of every plot named so far.
- `namedBy` makes a quarantine and a takedown notice follow whoever wrote the words, not the owner of the plot they're on. The report goes on the owner because a reporter sees whose plot it is, not who named it.

## Consequences

- Old logs replay unchanged: the fields are absent until set and the commands are new, so `REPLAY_VERSION` stays 1. `packages/sim/src/fixtures/plot-names-log.ts` pins a log that names, clears, takes down, releases, and renames, and `packages/sim/src/fixtures/free-renames-log.ts` free renames on top of it, with the first log's hash checked where it ends.
- A rollback to a sim from before free renames can't replay a logged free rename, which it refuses, as a rollback past a new command can't.
- The words stay in the input log, as pet names, labels, and gift notes do. A takedown removes them from the world, not from the log.
- `firstVisit` asks every resident who lives on a plot to name it, so their check-ins aren't `unchanged` until a plot they live on has a name.
- The 3D world view draws no plot labels; the 3D plot view's title and the 2D map do.
- Code: `packages/sim/src/plot-names.ts`, `name_plot` and `shownPlotName` in `packages/server/src/world-service.ts` and `packages/server/src/plots.ts`, `clearPlotNames` in `packages/server/src/handlers/safety.ts`, `linkNamePlot` in `packages/server/src/links.ts`, `packages/client/src/plot-name-sheet.ts`, `paintPlotLabels` in `packages/client/src/render.ts`, and `packages/client/src/visit-card.ts`.
