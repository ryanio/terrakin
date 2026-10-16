---
title: On a phone the world's controls are icons round the map
date: 2026-10-16
status: accepted
tags: [client, design, mobile]
---

# On a phone the world's controls are icons round the map

## Context

On a 375 by 812 phone the world's chrome covered 42% of the screen, measured by adding up every
visible box in the HUD. The map showed through the gap left over, which is not a world you want to
spend time in.

Where it went: the card over the plot you stand on, 351 by 123 (14%); the column of actions on the
right, 140 by 292 (13%); the move pad, 134 square (6%, already down from 164 by
[decision 0301](0301-the-move-pad-is-drawn-as-the-joystick-it-already-was.md)); then the 3D
toggle, the chips, the top pills.

The two big ones were both permanent. The action column is up whenever you are in the world, and
the card is up whenever you stand on a plot someone lives on, which at home is always.

## Decision

Under 480 pixels, three changes, in `packages/client/src/world.css` behind one media query:

The four actions (Home, Your things, Build, Chat) become a 2 by 2 of round icon buttons, one tap
each, 112 by 172 with the speaker above them instead of 140 by 292. Each keeps its words in the
accessible tree, and keeps them on screen from 480 pixels up. Claim plot is the exception and keeps
its words always: it is a newcomer's one thing to do and the only action up at that point
([decision 0234](0234-a-newcomer-s-world-shows-walking-claim-plot-and-chat-and-the.md)), so a flag
on its own would not do.

The 3D toggle shrinks to a 44 pixel circle beside the pad, since it is a setting you touch once.

The card over a plot you live on, with nobody in it that week, shows only what you can do there
(Name your plot, Next plot) and drops its title and its week line: the map draws the plot's name
under your feet, and the line would only say that nothing happened. The moment somebody visits or
admires, the words come back. On anyone else's plot the card is unchanged, because that is where
its words are the point: whose plot this is and how admired it is. `quietWeek` in `visits.ts` is
the one condition, and the card carries it to CSS as `data-mine` and `data-quiet`.

Together the HUD went from 42% of the screen to 25%.

## Consequences

Four buttons now say what they do with an icon alone on a phone. House, backpack, blocks and
speech bubble are conventional enough, and the same four keep their words on every other screen,
but this is the change to undo first if people cannot find their things.

The rule for the card is about what a screen already tells you, not about saving pixels, so it has
to stay honest: if the map ever stops labelling plots, the card has to start again.

`e2e/praise.spec.ts` ran at phone width and asserted the card's title on her own plot. Hidden text
still passes `toHaveText`, so that assertion would have gone on passing while proving nothing; it
now asserts what a phone shows, and the card with a name in it is still proven on a neighbour's
plot later in the same spec.

What is left on screen is the pad (6%), the actions (6%), the card (6% on someone else's plot),
and the top pills. Going further means taking something away rather than shrinking it: folding
Feed, Invite and the speaker behind one button, or letting the chrome fade while you walk. Neither
was worth doing without asking.
