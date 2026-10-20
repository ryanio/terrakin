---
title: A plot card says what is new on it, from a day's counts in a table of its own
date: 2026-10-20
status: accepted
tags: [server, client, protocol, design, privacy]
---

# A plot card says what is new on it, from a day's counts in a table of its own

## Context

Every card on `/visit` carried the same two lines: "Changed just now" and "No visitors yet this
week". Fifteen plots in the test world meant fifteen identical captions, and the live town is
bigger. A page whose job is to say where to go was telling you nothing about where to go.

[`photo-story.ts`](../../../packages/server/src/photo-story.ts) already does most of the thinking
for a plot photo ([decision 0307](0307-a-plot-photo-says-what-is-new-since-the-last-one.md)): one
line of what is new, in our own words, from counts alone. But its `photo_marks` is one row per
resident and plot, because a photo's story is personal: what is new since *your* last photo. A card
on a public page needs one line per plot whoever is looking.

Two things had to be settled: where the mark lives, and what a public line may say.

## Decision

**A sibling table, `plot_news`, one row per plot**, filled from `WorldService.onCommitted` the way
`plot_changes` already is, in the same class
([`plots.ts`](../../../packages/server/src/plots.ts)). A row holds the owner, a UTC day, and a
count per kind of thing that arrived: a gallery opened, a roof, floors, the plot claimed, blocks,
beds planted, things on display, paths, crops picked. Each committed input adds its own counts to
the row when the row already holds that plot's own today, and replaces it otherwise.

**A day, not an input, and not a running tally.** A day of building is one line rather than its last
block, and yesterday's line stands until today brings something.

**Only what arrived.** A wall taken down, a display taken down, a roof removed, a gallery closed:
none is news. An input that only takes things away still moves `changedAt` and leaves the day before
it standing. A card is a reason to come and look.

**One part, the biggest.** [`plot-news.ts`](../../../packages/server/src/plot-news.ts) orders the
kinds by how visibly they change a place (gallery, roof, upstairs, moved in, blocks, beds, ridge,
display, paths, picked) and says the first that happened, with the day in words: "A roof went up on Tuesday",
"3 beds planted today", "Opened as a gallery yesterday". Two parts joined with "and" wrap to three
lines in the card's column at 375px, which is the width the card is built for. Nothing older than
`NEWS_DAYS` (7, the week the visitor counts cover), where the card falls back to "Changed 2h".

**What a public line may say.** Everything it can say is already public in the world snapshot, which
lists every plot's blocks, crops, displays, floors and roof for anyone. It is written from counts
and event codes alone, never from a resident's text, so it carries no `trust` and never needs
holding back for a quarantine. It never says who did it, never counts what went into anyone's
things, and never quotes a name, a label or a note. Suspensions and blocks need no new rule: the
line rides on the plot view, and `Api.plotViewer` already drops the whole plot.

**`changedAt` grew with it.** A floor, a roof, and the gallery switch now count as changes to a
plot. They change how it looks from above and they are three of the things the line says, so a plot
that got a roof rising in "Recently changed" is the fix, not a side effect. `name_plot` still
doesn't: a name is the plot's own words rather than a change to the place, and it is already on the
card.

**Who is there now goes on the drawing, not in the words.** `plotMarks` ends with a mark for each
online resident standing on the plot, drawn last, over roofs and upper floors, as a head and
shoulders in a rim of paper. Both were built and looked at on a phone: "2 here now" is a third line
in a column that is already two lines plus two buttons at 375px, while the figures cost no line and
say *where* on the plot people are. Nothing on the drawing names anyone; `plotThumb` puts the count
in the canvas's `aria-label` ("Ivy's plot, from above, 2 here now") so a screen reader hears what
the drawing shows. The home wall's strip gets the figures with the shared drawing and no line: a
card that small is a picture with a name under it.

The quiet week line went with it. A card with nobody's visit to report says nothing rather than
"No visitors yet this week"; `quietWeek` already existed for the world's own visit card.

## Consequences

- A fresh deploy starts with an empty `plot_news`, so no card says anything until something changes
  on that plot. `plot_changes` has the same shape and nothing backfills from the log. Within a day
  of ordinary play the live town fills in.
- The list is built at most once a minute (`PLOT_LIST_MS`), so a line can be a minute behind, and
  "today" is read once for a whole page rather than per card. `GET /v1/plots/{px}/{py}` is current.
- A clock that goes backwards (the test world's `advance-day` resets on a restart) leaves rows dated
  in the future, which read as no line at all rather than as nonsense.
- A new kind of news is a column, a case in `newsOfEvent`, and a line in `whatHappened`, in the order
  that says how much of the place it changed. Think about where it sits before adding it: the order
  is the whole design, since only the first part is said.
- The protocol gained `PlotView.news`, so `GET /v1/plots` and `GET /v1/plots/{px}/{py}` carry it for
  agents too, with a `CHANGELOG.md` entry for it and for `changedAt`.
