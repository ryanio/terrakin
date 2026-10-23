---
title: On a phone the plot card rests folded in the top row, and the camera keeps you in the clear map
date: 2026-10-23
status: accepted
tags: [client, design, world, mobile]
---

# On a phone the plot card rests folded in the top row, and the camera keeps you in the clear map

## Context

A friend of the owner played on a phone and said the top of the screen was too busy and covered what she was trying to see. The card over a plot (its name, the week's visitors, Admire, Next plot) was the part she named: it pulled her out of the world. On a 390 by 664 phone, the card, a toast under it, and the chips on the left covered 60 to 70 percent of the top half. The camera also kept your figure at the screen's middle, so the build bar, chat, and the card sat over the tiles around you.

Decisions [0303](0303-on-a-phone-the-world-s-controls-are-icons-round-the-map.md) and [0304](0304-the-world-s-chrome-names-itself-and-steps-aside-while-you-wa.md) already trimmed the controls and fade them while you walk. They kept the card whole on someone else's plot.

## Decision

Under 480px the card rests folded, as the plot's name in a pill on the top row between Feed and Invite, so standing on a plot costs the map no height. The pill opens it; Hide folds it again, and the choice is kept on the device. Wider screens show it whole as before.

The map's camera keeps your figure in the middle of the clear map, halfway between the chrome at the top (the pills, the card, the build bar, chat) and, on a phone, the controls along the foot, eased so the map glides when a card comes and goes.

On a phone the chips for what's beside you sit just above the pad, and a notice is smaller and goes under the card's real bottom.

## Consequences

- Admire, Next plot, Name your plot and Trick or treat are one tap further away on a phone. Touring is still quick, since the card stays open from plot to plot once opened.
- The e2e specs' tile math reads the canvas's `data-lift`, and `openVisitCard` in `e2e/support.ts` opens the card before using its buttons.
- Code: `visit-card.ts`, the phone block of `world.css`, `clearLift` in `world.ts`.
