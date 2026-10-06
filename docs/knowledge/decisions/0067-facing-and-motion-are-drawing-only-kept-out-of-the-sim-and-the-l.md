---
title: Facing and motion are drawing only, kept out of the sim and the log
date: 2026-10-06
status: accepted
tags: [server, protocol, client, design]
---

# Facing and motion are drawing only, kept out of the sim and the log

## Context

Residents should look alive: turn the way they walk, slide and hop between tiles, doze when left alone, and show what people say over their heads. None of it changes what anyone owns, builds, or can do, and the sim and its log are where rules and history live.

## Decision

- `facing` on a resident in the snapshot is the way they last took a one-tile step (`facingFrom` in `packages/protocol/`). The server keeps it in memory and adds it to `snapshot()`. A restart forgets it, and a jump (going home) never turns anyone.
- How residents move between the server's answers is client-only, in `packages/client/src/motion.ts`, shared by the map and the 3D view: a slide and hop per step, a squash on landing, a lean and idle sway, a puff after a jump, dozing after two minutes still, and chat bubbles. Faces stay with RFC 0013's `feelings.ts`: a doze is handed to it as the `sleepy` feeling, and a feeling from a gesture wins over it. Under prefers-reduced-motion figures stand still; bubbles and dozing still show.
- Emotes that others can see wait for [RFC 0013](../../rfcs/0013-expressive-characters.md), which names them as feelings.

## Why

- Keeping these out of the log keeps replay and the world hash unchanged.
- Facing in memory costs a map the size of the population; losing it on a restart only means people face the camera until their next step.
- Chat bubbles come from messages the client already gets, so they need no new protocol and no new text path. Bubbles draw chat as canvas text only (decision 0004).

## Consequences

- Motion that should reach other people (a wave everyone sees) needs a server message, which is RFC 0013's `emote`; anything in `motion.ts` is seen only by the client drawing it.
