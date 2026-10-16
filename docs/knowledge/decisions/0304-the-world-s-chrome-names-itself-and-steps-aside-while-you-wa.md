---
title: The world's chrome names itself and steps aside while you walk
date: 2026-10-16
status: accepted
tags: [client, design, mobile]
---

# The world's chrome names itself and steps aside while you walk

## Context

[Decision 0303](0303-on-a-phone-the-world-s-controls-are-icons-round-the-map.md) took the world's
HUD on a phone from 42% of the screen to 25%, and the way it got the last of that was by dropping
the words from the four actions, leaving a house, a backpack, blocks and a speech bubble. It said
at the time that this was the change to undo first if people could not tell them apart. They
could not. A backpack is not "your things" to anyone who has not been told.

The obvious repair is a "..." button with the four behind it, and it is the wrong one: Build and
Chat are opened constantly, and a menu charges a tap for each of them every time, which is a worse
trade than the words ever were.

## Decision

The words come back, under their icons rather than beside them. The four actions are a 2 by 2 of
82 by 60 buttons, the icon over its own word at `--text-xs`. That is 172 by 180 with the two
settings on a row above, against 140 by 292 for the labelled column it replaced and 112 by 172 for
the icons alone. So the labels cost three points of the screen and buy back every name: the HUD
sits at 28% rather than 25%, and nothing on it is a guess.

The speaker and the 3D view stay icons, because they are settings you touch once and both are
conventional signs.

Then, since the chrome is as small as it is going to get while it says what it does, it gets out
of the way instead. Once you have been walking `WALK_FADE_MS` (400ms, longer than a single step,
so one step never flickers the screen), everything but the move pad and what the world is telling
you fades to 0.32; the moment you stop it comes back, quicker than it left. `Walker.walking()` is
the signal, true while a key or the pad is asking and until the last step has landed, and
`world.ts` puts it on the HUD as `data-walking` each frame.

What fades is the chrome in the corners: the actions, the settings, the two top pills, the card
over the plot, and the chips above the pad. What stays bright is anything pinned to your figure or
the world's own voice: Go up and Go down beside you on the stairs, the toast, the status pill, and
the points that float over your head. It dims and never moves or hides, so a button you reach for
mid-walk is still under your thumb and nothing leaves the accessibility tree.

## Consequences

The actions are wider than the column they replaced (172 against 140) and much shorter (180
against 292). On a phone that is the right way round: the bottom corners are where thumbs are,
and the middle of the screen is where the world is.

Fading is per frame from the walker, so it costs one attribute toggle and nothing else. Under
`prefers-reduced-motion` the fade stays, because an opacity change is not what that setting is
about, and nothing slides.

Go up is the one button the world moves each frame, to keep it beside your figure, and fading it
made `build.spec.ts` time out waiting for it to settle. That is the rule earning itself: what the
world pins to you is not chrome.

Laying the actions out as a grid turned up something older: the column has always been a box with
`pointer-events: auto`, so the space between its buttons swallowed taps meant for the map, and
once the 3D toggle moved next to it that box ate its clicks too. The box is the world now
(`pointer-events: none` on `.actions`, `auto` on its children), which is what it should always
have been.

0303's measurement stands and its other two parts (the 2 by 2 itself, and the card over your own
quiet plot) are untouched. Only its icon-only choice is replaced here.
