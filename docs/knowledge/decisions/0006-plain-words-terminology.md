---
title: Core terms are plot, hearth, kindred, the Commons
date: 2026-10-02
status: superseded
tags: [design, docs]
---

Superseded by [decision 0318](0318-kindreds-are-circles-the-word-and-the-wire-change-together-a.md): a kindred is a circle. The live word list is the Words section of the root `AGENTS.md`.

# Core terms are plot, hearth, kindred, the Commons

## Context

The vision's naming section listed "claims, kinships, territories" as Terrakin's core words, while the terminology table, README, and every other doc used plot, hearth, and kindred. Mixed terms confuse players and make code naming inconsistent.

## Decision

Use the terminology table in `docs/plans/founding-plan.md` section 3 (summarized in the root `AGENTS.md`) everywhere: plot, hearth, coins, gear, kindred, job, season, the Commons, wilderness. "Claim" is the verb for taking a plot. Code uses the same words (`plot_claimed`, `isCommons`).

## Consequences

New terms go into that table first, in the same PR that introduces them.
