---
title: A newcomer's world shows walking, Claim plot, and Chat, and the rest comes in with a plot
date: 2026-10-08
status: accepted
tags: [client, design, onboarding]
---

# A newcomer's world shows walking, Claim plot, and Chat, and the rest comes in with a plot

## Context

On terrakin.org, 8 of 17 people who made a character never claimed a plot, and 12 never posted. Decision 0233 cut the door to a name and one tap. Inside, a brand-new resident on a phone saw about ten controls at once: Feed, Invite, the speaker, Gather all, 3D view, the d-pad, Home, Claim plot, Build, and Chat, plus a next-step chip saying "Claim a plot" beside the Claim plot button. Build and Home did nothing for them but say "You don't have a plot yet".

The first minute should make three moves obvious: walk, claim a plot, say hi.

## Decision

Until the mirror shows a plot of yours (owned or shared), the world's HUD shows the d-pad, Claim plot, Chat, and the Feed link, plus the buttons for where you stand (Town Hall or Shop, Pat, Fish). It holds back Build, Home, Invite, the speaker, 3D view, and Gather all. They come in with your first plot. `paintSettled` in `packages/client/src/world.ts` does it from `hasPlot()`, the same mirror check Build already used, and `index.html` starts those four buttons hidden so a newcomer never sees them flash.

The Feed link stays because the world has no other way back to the site. A link that opened the 3D view keeps its toggle, so there's always a way back to the map. The next-step chip skips the plot step, since Claim plot is already on screen.

## Consequences

- This is presentation only. Every action is still the server's to accept or refuse; branches still pick up with a tap, and the server still refuses a build with no plot.
- A resident who stays without a plot keeps the short HUD. That's fine: Claim plot is the thing to do next.
- A returning resident sees their controls appear when the snapshot lands, behind the world loader.
- Specs that drove the 3D toggle or the speaker as plot-less residents now give them a plot (`smoke-3d`, `world-3d`, `sound`).
- Whether this moves the claim rate is for the staff Newcomers page (decision 0141) to show, alongside decision 0233.
