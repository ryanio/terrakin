---
name: handoff
description: Write an end-of-session handoff note in docs/knowledge/handoffs so the next human or agent can continue without asking questions. Use when wrapping up a session, when pausing work that's in flight, when the user says "hand off", "wrap up", or "we'll continue later", or after finishing a milestone others will build on.
---

# Handoff

The next session starts with zero memory of this one. The handoff is how it catches up.

## Steps

1. Gather facts: `git log --oneline origin/main..HEAD`, `git status`, open PRs, and the result of `pnpm verify`.
2. Create the note:
   ```sh
   pnpm kb new handoff "What was accomplished, in a few words"
   ```
3. Fill in the template:
   - **Done**: what changed, with links to PRs, commits, or files.
   - **State of things**: what works, what's half-built, what's broken. If `pnpm verify` is red, say exactly what fails.
   - **Next**: ordered, concrete next steps. Each should be startable without questions ("Add `release` command to `packages/sim/src/apply.ts` mirroring `claim`").
   - **Open questions**: decisions that need a human.
4. If the session produced decisions or learnings, capture them as separate entries too (see `capture-knowledge`). The handoff links them.
5. If the roadmap moved, tick boxes in `docs/plans/README.md`.
6. Run `pnpm kb` and commit.

Keep it short. A reader should get the picture in two minutes.
