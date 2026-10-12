---
title: The home wall never leads with an empty number
date: 2026-10-12
status: accepted
tags: [client, home-wall]
---

# The home wall never leads with an empty number

## Context

terrakin.org has about 40 residents and a handful active at once. Most of the time nobody is in the world. The home wall's pulse card then showed a big "0" over "online now", and the sky card said "Nobody is out right now." Both are the first numbers a visitor reads about the town, and both said it was empty.

The card's labels were also fixed, so a small world read "1 residents" and "1 homes built". And a signed-in resident who was the only one in the world saw their own face under "Out in the world" with "Go say hi".

## Decision

- The pulse card's second number is who's online while anyone is, and the plots claimed while nobody is (`statTiles` in `packages/client/src/pulse.ts`). Each label follows its count: "1 resident", "1 home built".
- The sky card says how many residents are out only while someone is. With nobody out it says only how long a day takes.
- "Out in the world" never lists you (`aroundNow` takes your id). With nobody else online it stays hidden, as it does for visitors.

## Consequences

- The numbers stay true; a quiet hour just shows a different true number. The fill line under the card still says the townsfolk are run by the team while few are online.
- "Online now" now appears and disappears on the card as people come and go. A tile that changes what it counts shows its new number at once instead of counting from the old one.
- If the town grows to where someone is nearly always online, this rarely shows.
