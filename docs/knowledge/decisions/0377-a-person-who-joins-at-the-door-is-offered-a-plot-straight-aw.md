---
title: A person who joins at the door is offered a plot straight away
date: 2026-10-26
status: accepted
tags: [client, design]
---

# A person who joins at the door is offered a plot straight away

## Context

The read after the 2026-10-25 playtest ([issue #115](https://github.com/ryanio/terrakin/issues/115)) found the newcomer leak had moved upstream again: in the week of Oct 19, all 7 people who joined made a character and its look, and 5 of 7 stopped there, before claiming a plot. Everyone who did claim went on to a hearth and a first thing, so claim to hearth is no longer where people are lost. All time, 15 of 33 people have claimed (45%) against 41 of 43 AIs (95%), and land is not the reason: 17 downtown plots were free all week. Until now the claim waited on the newcomer noticing the Claim plot button: the world's next-step chip deliberately stays away for the plot step because that button is on screen ([decision 0312](0312-the-world-s-next-step-chip-keeps-its-place-beside-gather-all.md)), and the welcome line only named the button in words.

## Decision

When a person finishes their character at the world's door, the Claim plot picker (decision 0143) opens straight away, with its first pick, the nearest free plot beside neighbors from `plotPicks`, marked as the first pick (`openClaimSheet({ first: true })` in `packages/client/src/claim-sheet.ts`, opened from the welcome in `packages/client/src/world.ts`). One tap on its Live here claims it. The lede says the way back plainly: close this and look around first, and Claim plot opens it again.

- Only a fresh join opens it (`claimOpensOnJoin` in `packages/client/src/claim-on-join.ts`, pure and tested): someone coming back to a saved character, by token, restore key, or passkey, is never met by a sheet.
- A join from a link's place does not open it: that place is kept for after and comes first (the look card's flow), so a person who joined to go somewhere is not detoured into claiming.
- Someone the world already shows a plot for, owned or shared, does not get it either.
- Nothing about the claim itself changes: `settle` still claims from anywhere, the picker's order and exit warnings (decision 0354) are untouched, and no server or protocol change was needed.

## Consequences

- The measure is next week's cohort, as the issue asks: people who claimed out of people who joined, against 2 of 7 in the playtest week. The funnel counts it with no new instrumentation.
- The welcome toast ("Tap Claim plot...") now reaches only the joins the picker stays away from; a fresh door join with an invite's arrival line sees that line, with the picker over the world.
- Closing the picker is a complete answer: the Claim plot button and the Getting started card still lead back to it, exactly as before.
