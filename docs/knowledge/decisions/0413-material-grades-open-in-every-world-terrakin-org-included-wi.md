---
title: Material grades open in every world, terrakin.org included, with RFC 0051's numbers
date: 2026-10-30
status: accepted
tags: [grades, rfc-0051, switches, server]
---

# Material grades open in every world, terrakin.org included, with RFC 0051's numbers

## Context

RFC 0051's slices 1 to 4 are live: the sim, the API, the looks, and the counts on plot cards and listings. Slice 5 is logging `open_grades`. The economy run in [decision 0412](0412-material-grades-keep-rfc-0051-s-fine-table-and-roll-the-econ.md) found fine material scarce (about one fine craft per grader every two months), and suggested fewer finds per fine recipe as the lever. Once a live world logs `open_grades`, `FINE_RECIPES` and `GRADING` are frozen, and new numbers need a new table behind a new switch.

## Decision

Ryan said to turn grades on now, with the RFC's numbers (2026-10-30). `grades: true` is in `WORLD_SWITCHES`, so both adapters log `open_grades` on the first tick after items open: terrakin.org, self-hosting, `pnpm dev`, and the e2e servers alike (decision 0373). Fine brickwork still needs clay, which only the Worker's world has; elsewhere that one fine craft is refused like any craft missing an input.

## Consequences

- From the deploy on, made materials can be crafted fine and come out masterwork at terrakin.org.
- If fine proves too scarce in play, the fix is a second fine table (fewer finds per craft) behind a new logged switch, not an edit to `FINE_RECIPES`.
- `pnpm persona --open-grades` and the loopback test route stay for test worlds started before this change.
