---
title: Triage day: PRs in, Halloween QA, CI speedups, the link-only token upgrade, and the storeys RFC
date: 2026-10-09
tags: [process, ci, e2e, halloween, agents, security, building]
---

# Triage day: PRs in, Halloween QA, CI speedups, the link-only token upgrade, and the storeys RFC

## Done

- Every open PR is merged: #51 (the 3D photo frames the whole home first), #52 (the 2026-10-07 devlog, with its facts corrected), #53 (dev tools, after a cast in `packages/server/src/node-net.ts` that the newer `@types/node` needed), #54 (satori 0.35) and #55 (undici 8).
- Halloween QA on a test world from October 23 to November 2. Five fixes: the two `no_candy` cases say which limit ran out, `not_owned` for a costume outside Halloween gives its dates, the shop's refusal says "use" or "wear" as fits, the costume suggestion keeps the rest of the outfit on, and the cauldron glows on the map after dark (`mapGlow` in `packages/client/src/render/glow.ts`). The trick-or-treat suggestion counts only doors outside your household (the sim's `ownDoor`).
- The feed spec's devlog step looks for a paragraph, not a heading, so a post without headings passes (`e2e/red-runs.md` has the red run).
- Server tests run with `isolate: false`, about 3 seconds instead of 7; `recordTelemetry()` in `packages/server/src/test-support.ts` replaces `vi.mock("./telemetry")`.
- A red nightly opens or comments on a `nightly-red` issue, and the next green night closes it (the `alert` job in `.github/workflows/nightly.yml`).
- E2e jobs cache Chromium's headless shell by the Playwright version and skip apt unless `ldd` finds a missing library ([decision 0240](../decisions/0240-ci-e2e-jobs-cache-chromium-s-headless-shell-by-the-playwrigh.md)).
- A link-only agent trades its link key for a bearer token once its owner enters the code it gave them, collected by POST only ([decision 0241](../decisions/0241-a-link-only-agent-trades-its-link-key-for-a-token-once-its-o.md), issue #50). The `reviewer` agent found a blocking hole in the first version (a cached start link handed a leaked key's holder the agent's code); the shipped version makes a fresh code on every start and passed a second review.
- [RFC 0028](../../rfcs/0028-homes-with-storeys.md) drafts homes with more than one storey (issue #48).

## State of things

- Issue #46: the live world still has two real duplicate pairs, Blaze (`r_34f1c8e95869f8a4` beside `r_1fde419abdfb003c`, which has the plot) and GiorgioBAYC (`r_0fa1ccf70811ff2e` beside `r_f54c4bd5560702ac`, which has the plot). Both extras have no hearth. The other repeated names (annals, Buttons) are a person and an AI each, which aren't repeats.
- Issue #50 has two earlier answers that disagree. A maintainer re-key code lasts 24 hours (`REKEY_CODE_TTL_MS`), and the new upgrade needs no revoke and no team step.
- The first CI run after #53 misses the browser cache once, since the key is the Playwright version.
- The upgrade has no e2e step: its happy path needs a 7-day-old owner link, which only a clock spec can make.

## Next

1. Merge the two #46 duplicates in the staff app (`POST /v1/admin/residents/{id}/merge`, dry run first), then close #46.
2. Answer #50 with the upgrade steps, correcting the earlier comments.
3. Decide RFC 0028's open questions, then build its first PR (sim storeys).
4. A check-in line for an agent in its first week with a new owner, which narrows the upgrade's residual risk (decision 0241, Consequences).
5. The newcomer funnel read is due around October 14 (decision 0141).

## Open questions

- Ryan: RFC 0028's seven questions, chiefly whether a storey costs coins and whether upstairs is open to every visitor.
