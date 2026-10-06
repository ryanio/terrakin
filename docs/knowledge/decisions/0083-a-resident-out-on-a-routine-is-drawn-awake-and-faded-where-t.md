---
title: A resident out on a routine is drawn awake and faded where they are, with a moon, then sleeps at home again
date: 2026-10-06
status: accepted
tags: [client, design, 3d]
---

# A resident out on a routine is drawn awake and faded where they are, with a moon, then sleeps at home again

## Context

[Decision 0086](0086-residents-who-are-away-sleep-at-their-hearths-drawn-but-neve.md) draws everyone who is offline and has a hearth asleep beside it, wherever the server has them. Routines ([RFC 0009](../../rfcs/0009-offline-routines.md), [decision 0082](0082-routines-are-logged-steps-the-sim-checks-due-from-their-utc-.md)) move offline residents for real: a walk home, and a stroll out across their plot and back a few minutes later. Drawn as a sleeper, a stroll would never show, and a resident would seem to teleport from their hearth to wherever a step put them. Drawn as online, they'd count as here, which they aren't. And it has to read on a phone, at about 30 pixels a tile.

## Decision

Presentation only, like facing and motion ([decision 0067](0067-facing-and-motion-are-drawing-only-kept-out-of-the-sim-and-the-l.md)):

- **Out on a routine:** for `ROUTINE_LIMITS.awakeMinutes` (4) after a routine's step reaches the client (a `moved` event with `routine`), the resident is drawn where the server has them, walking the step's tiles like anyone else's, awake, and faded like a sleeper. On the map a small crescent moon sits beside their name, where a sleeper's z goes, saying "away" without a word. Then they sleep at home again (0086), with no slide back.
- A walk home is one jump, so it shows as a puff at the hearth and a few minutes standing on it before lying down beside it. A stroll walks out of the door, stands in the garden for the pause, walks back, and lies down a few minutes later, so a neighbor looking at the map sees someone pottering about rather than a blink.
- A page loaded meanwhile knows from the snapshot: residents carry `routine` for those minutes, kept by the server in memory like `facing`.
- They're never here: online counts, the pulse, "Nearby" in 3D, and presence still read `online`. Tapping one says "Bram is away, out on a stroll" (or "just walked home") and walks on.
- In 3D they're faded pegs walking the same steps, in the places online residents leave free, before anyone asleep; no moon, since the 3D tag already fades and the map is the phone's default.
- A routine wave reaches its recipient as a live `gesture` with `routine: true`. The waver, asleep or out, waves on the recipient's screen, and waves close together fold into one line: "Bram waved from home", "3 neighbors waved from home".

## Why

- Real positions while a routine walks, and the hearth otherwise, means the drawing never claims someone is somewhere they aren't for more than a few minutes, and `walk_home` makes the drawing and the server agree.
- Awake and faded keeps the one rule people already read: faded means away. The moon tells a stroller from a sleeper at a glance and from an online resident at once.

## Consequences

- `Mirror.outOnRoutine` (with a clock it takes, so tests drive it) and `Mirror.asleep` split the away residents; the map, the 3D world, and taps read both.
- A client that misses the step (it loaded after the window) draws a sleeper, which is what the world will look like a minute later anyway.
- Code: `client/src/mirror.ts`, `client/src/render.ts`, `client/src/scene3d/world.ts`, `setOut` in `client/src/motion.ts`, the `moon` sign in `ui/src/figure.ts`, `foldWaves` in `client/src/together.ts`, and the `routine` field on residents in `server/src/world-service.ts`.
