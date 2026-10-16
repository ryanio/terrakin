---
title: The move pad is drawn as the joystick it already was
date: 2026-10-16
status: accepted
tags: [client, design, mobile]
---

# The move pad is drawn as the joystick it already was

## Context

The world's move pad was drawn as four arrow buttons in a 3x3 grid, 164 pixels square in the
bottom left corner of a phone. On a 375 pixel screen it and the column of actions on the right took
304 of the width between them, which is most of why the world felt crowded.

Underneath, it had never been four buttons. `padWay` read how far the thumb was from the middle of
the pad, not which arrow it was over, with a dead middle of a sixth of the width, and it captured
the pointer so a thumb that slid off the pad kept steering. That is a joystick. The arrows were
the paint over it, and the gap between what it looked like and what it did was the whole problem:
it asked to be tapped four ways when it could be held and steered eight.

## Decision

Draw it as what it is. One round pad, three cells of 44 pixels across rather than three taps of 52
with gaps, so 132 pixels instead of 164. The four arrows stay around the rim as faint marks and
light up the way you are walking. The hub becomes a knob that sits under the thumb while you hold
it and springs back when you let go; in 3D it still carries the needle pointing north, which a
round knob suits better than a square hub did.

The geometry moves out of the view and into `padThumb` in `packages/client/src/walk.ts`, beside
the walking it drives: given the pad's width and the thumb's offset from the middle, it answers
with the direction and where the knob goes, clamped to the rim. `world.ts` only reads the pad's box
and sets two custom properties.

The four arrows stay real buttons with their labels. They are how a keyboard and a screen reader
take one step, and `click` on them is still the only path that does not go through the pointer.

## Consequences

The pad gives back 32 pixels each way, and the hold-and-steer walk it always had now looks
available instead of hidden.

The column of actions on the right (Home, Your things, Build, Chat) is now the biggest block of
chrome on a phone, at 140 pixels wide. Two ways to shrink it were tried against the real HUD and
both were worse: letting the buttons hug their labels makes the column ragged and barely narrower,
because "Your things" is already wider than 140; and laying them out as a 2x2 grid halves the
height but leaves holes, because which of them show depends on where a resident has got to, and a
newcomer has only Claim plot and Chat ([decision 0234](0234-a-newcomer-s-world-shows-walking-claim-plot-and-chat-and-the.md)).
Dropping the words for icons would cost a newcomer the one button that tells them what to do next.
A column that degrades gracefully is worth more than the pixels, so it stays until there is a
better idea than those three.

The knob follows the thumb under `prefers-reduced-motion` too, because that is direct manipulation
rather than decoration; only its spring back to the middle is a transition, and that is turned off.
