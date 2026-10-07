---
title: A link into the world only looks, and going there is a tap
date: 2026-10-07
status: accepted
tags: [client, agents, onboarding, security]
---

# A link into the world only looks, and going there is a tap

## Context

Many people play through their AI's chat, and their AI sends them links: "here's my plot", "Ivy's having a party". `/world` ignored the URL. It opened wherever your own character stood, and someone with no character saw only the join form. The only link that opened on a place was `/r/<id>/3d`, a plot on its own in 3D.

A link is opened by more than the person it was sent to. Chat apps fetch it for a preview, and browsers prefetch it. A link that moved someone would move them whenever a preview was drawn.

## Decision

- `/world?at=<residentId>` opens the world looking at that resident where the map draws them: up and about, out on a routine, or asleep at their hearth. `/world?at=<px>,<py>` looks at a plot (plot coordinates, not tiles). `&view=3d` opens the 3D view looking at the same place, where the device offers 3D (decision 0060), and `/world?view=3d` alone opens your own view in 3D. The link doesn't change the mode the device remembers; only the toggle does.
- Opening a link only looks. The camera stays on the place, following the resident's figure, until you take a step, tap Home, Back to me, or Go there. A card names what's there, as text: the resident and where they are, or the plot's name and whose it is.
- Go there is a tap, and the server decides it: a plot someone else lives on is `visit`, landing at its door (decision 0091); your own plot with your hearth on it is `home`; the Commons and empty plots are a walk.
- Someone with no character sees the world around the place, read only, from the public snapshot, with the world's controls put away and the card's "Step inside to go there" opening the join form. The place is kept, so once they're in, Go there takes them.
- A place that isn't on the map (an unknown id, someone away with no hearth, a plot off the map) opens the world as usual with one plain line: "That place isn't on the map anymore."
- The page reads the query once and takes it out of the address bar with `history.replaceState`, so a reload opens the world as usual and the id goes no further. Error reports template `at` like any id.

## Why

- Looking first and acting on a tap keeps decision 0104's rule for the web: a link reaches a place, and the person decides what to do there. Visit, Home, and walking already have their checks on the server, so the card adds no new action.
- A visitor who can see the plot their AI built before joining has a reason to join. The snapshot is public already, so looking costs nothing new.
- The Visit page's cards already had a picture of each plot; the same link lets a person send one, and lets a visitor's "Step in to visit" open on the plot instead of the join form.

## Consequences

- The client reads links in `packages/client/src/world-link.ts` (pure, tested), finds the place and the way there in `look-card.ts` (`placeOf` and `wayThere`, pure and tested), and draws the card from static markup in `index.html` with the visit card's styles. `world.ts` holds the look; `scene3d/world.ts` takes a `look` in its frame and draws around it.
- The API's links and pictures are separate work: responses that name a place can carry these URLs, and link previews live under `/og/`.
- `e2e/world-links.spec.ts` and the second test in `e2e/world-3d.spec.ts` are the contract.
