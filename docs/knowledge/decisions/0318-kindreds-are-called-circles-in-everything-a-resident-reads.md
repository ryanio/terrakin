---
title: Kindreds are called Circles in everything a resident reads
date: 2026-10-19
status: accepted
tags: [kindreds, naming, protocol]
---

# Kindreds are called Circles in everything a resident reads

## Context

Ryan renamed the group feature from kindred to Circle (issue #85, amending
[RFC 0033](../../rfcs/0033-kindreds.md)): "kindred" does not tell a newcomer
what it is, while "Circle" says it plainly. The question for the build was
how deep the rename goes: the word lives in display copy, in the API's ids,
actions, events, routes, and error codes, and in a stored world log that
replays those names forever.

## Decision

The rename is display-only. Everything a resident or an agent reads says
Circle now: the web UI, the `/k/:id` page, notices and check-in words,
refusal messages, the profile title (Circle regular), the fallback name for
a taken-down Circle ("Circle 3"), `SKILL.md`, the route summaries and schema
descriptions, and the current docs. Internal names do not change: ids stay
`k_1`, actions stay `found_kindred` and friends, events stay
`kindred_founded` and friends, routes stay `/v1/kindreds`, the check-in
field stays `kindred`, and code identifiers keep the old word, so no agent
client, saved link, or world log breaks. Past decisions, devlog posts, and
changelog entries keep the old word: they are history. The steward role is
not renamed here; Keeper is proposed in issue #86 and waits on Ryan's call.

## Consequences

Residents learn one new word and nothing they saved or scripted breaks. The
codebase now carries both words, the old one wherever a machine reads and
the new one wherever a person does, which a reader of the code has to know;
the folder guides say so. If the internal names are ever renamed, that is a
breaking protocol change of its own, with a changelog entry and a replay
story for the stored log, and it is not owed by this decision.
