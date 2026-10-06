---
title: Residents who are away sleep at their hearths, drawn but never counted
date: 2026-10-06
status: accepted
tags: [client, design, 3d]
---

# Residents who are away sleep at their hearths, drawn but never counted

## Context

The map and the 3D world drew only residents who are online, and most of the day nobody is, so the town looked empty: on the live world, 48 residents on 27 plots, 25 of them with a hearth, and usually no one in sight. Drawing offline residents where they last stood doesn't work either, since 13 of them had stopped on the same Commons tile. The 3D plot view already drew an absent owner at home, dozing at night ([RFC 0013](../../rfcs/0013-expressive-characters.md)).

## Decision

Presentation only, with no sim or protocol change:

- On the map, in the 3D world, and in the 3D plot view, a resident who is offline and has a hearth is drawn asleep at it, at any hour: the `sleepy` feeling (closed eyes and a drifting z), a slow breath, faded toward the paper and the haze, with a fainter name tag. Residents without a hearth stay hidden while away. You are never drawn asleep in your own view.
- They lie beside the hearth, on its open sides, east then west then in front and behind, so the hearth still shows between them. Residents who share a hearth (an owner and co-owners) take one side each in id order, and a little along a side once every open side has someone (`dozers` in `client/src/scene3d/layout.ts`, shared by the three views). On the map a sleeper's z sits beside their name rather than over it, so two tags at one hearth stay close.
- They are never "here". Online counts, the pulse, presence labels, the 3D view's "Nearby" label, and tapping someone all still read `online`. Tapping a sleeper says they are away, asleep at home, and walks on as if the tile were empty.
- A sleeper's pose keeps no motion track (`awayPose` in `client/src/motion.ts`), so when they come back they appear where the server says they are, awake, with no slide from their hearth.
- In 3D they fill only the places online residents leave free under the 24-figure cap ([decision 0060](0060-the-world-in-3d-draws-a-view-radius-around-you-within-a-fram.md)), nearest first, so the frame budget holds.
- Someone asleep keeps an umbrella rolled up even in the rain ([decision 0073](0073-weather-is-a-pure-function-of-the-world-day-and-the-utc-hour.md)).

## Consequences

- The town looks lived in without a single new field or input. The mirror works out who sleeps where after every event (`Mirror.asleep`).
- Showing them where they last stood was rejected: it piles residents on the spawn tile and suggests they are about.
- A busy town can fill the 3D cap with sleepers near you; online residents always come first.
