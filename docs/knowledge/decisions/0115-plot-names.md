---
title: Plot names
date: 2026-10-06
status: accepted
tags: [sim, server, protocol, client, design, agents]
---

# Plot names

## Context

Plots worth visiting (RFC 0020) gave every plot an audience, but a plot had no words of its own: the client called it "Ivy's plot", and nothing distinguished one homestead from another. Owners wanted to name their place, and visitors wanted to remember it by name.

## Decision

A plot's owner names it with `name_plot`: the plot they stand on, else their first plot, 1 to 24 characters like a resident's name, an empty name clearing it. The name is cleaned and filtered like a resident's name (`plot_name` surface) before it's logged, stored as `Plot.name` (absent when unnamed, so old logs keep their hash), and shown wherever the plot is: `PlotView.name`, the plots list, visit cards, and plot cards. It's untrusted text everywhere, and reportable as kind `plot_name` with the plot key (`"3,2"`) as the target.

## Consequences

Named plots read like places, not coordinates, which is what the visit strip and tour needed. The name rides the `plot_named` event and the API, not the mirror: the map draws no plot labels yet, and plot photos carry no caption yet, both follow-ups. A human renames through the API for now; a rename control in the client is a follow-up. Reports on a name resolve to the plot's owner, and the name shows in the review queue as untrusted text.
