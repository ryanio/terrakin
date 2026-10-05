---
title: Live posts, media stripping, did you mean, coins follow-ups; four agents stopped mid-work
date: 2026-10-05
tags: [process, deploy, social, economy, safety, agents]
---

# Live posts, media stripping, did you mean, coins follow-ups; four agents stopped mid-work

## Done

All on main and deployed (last deploy from f1a1617; docs since). Verify and e2e green.

- Coins follow-ups (decision 0042): owner pairs logged one at a time, townsfolk tips script, no allowance prompt for townsfolk. Tips run daily on Ryan's laptop (launch agent `org.terrakin.townsfolk-tips`, see scripts/townsfolk/README.md); first budgets go out at midnight UTC.
- Did you mean and dry runs (#35, decision 0044). Upload metadata stripping for MP4, WebM, GLB (#27, decision 0043). Live post ids over the socket and check-in digest (#20, #31, decision 0046). Biomes from Felipe's PR #38 with a fix-up (decision 0045). Staff app hides actions moderators may not take. e2e test clock starts in the world's morning.
- RFC drafts 0009 (offline routines), 0010 (hosted events), 0011 (party games) for Ryan's review.
- Closed #19, #20, #22, #27, #31, #35 and PR #38.

## State of things

Usage ran out; four agents were stopped mid-work. Their uncommitted and committed work is in these worktrees (check `git -C <path> status` and `git -C <path> log origin/main..`):

| Work | Worktree |
|---|---|
| Hygiene pass (Opus): dead code, duplication, docs drift | `.claude/worktrees/agent-ad48cc3e5f15d6d0d` |
| Partners phase 1 (RFC 0007, #29): was verifying contracts on the explorer | `.claude/worktrees/agent-a52fa538fe797e696` |
| RFC 0005 step 2 (seeds, growing, crafting, give): was on protocol schemas | `.claude/worktrees/agent-a16ab5ebd5e34785a` |
| Townsfolk handles, praise (#36), plot photos (#34) | `.claude/worktrees/agent-a8a08acbb8cef3fd8` |

Each was told: don't push, run the reviewer, pick the next free decision number (0047 and up) right before committing.

## Next

1. Resume each stopped worktree: commit what's there, finish, verify, e2e, reviewer, land through a guarded push (see the learning on guarded pushes).
2. Ryan: `npx wrangler secret put TERRAKIN_MAINTAINER_EMAILS`; harden the Access cookie in Zero Trust (SameSite Lax, HttpOnly, a week); review RFCs 0009 to 0011.

## Open questions

See the open questions in RFCs 0009, 0010, 0011, and the previous handoff's.
