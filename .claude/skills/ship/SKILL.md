---
name: ship
description: Finish a change in Terrakin to the definition of done (verify, tests, docs, knowledge, commit, PR description). Use before committing or opening a PR, or when the user says "ship it", "wrap this up", or "make it mergeable".
---

# Ship a change

Work through the definition of done from the root `AGENTS.md`.

1. **Scope check.** `git diff --stat`. One concern? If it mixes a refactor with behavior changes, split it.
2. **Verify.** `pnpm verify`. If something fails, fix the cause; never skip, disable, or loosen a test or lint rule to get green.
3. **Tests.** Every behavior change has a test at the lowest level that would catch a regression. Sim rules: `packages/sim/src/*.test.ts`. Wire format: `packages/protocol/src/protocol.test.ts`. Routes and auth: `packages/server/src/server.test.ts`. Client logic: `packages/client/src/client.test.ts`.
4. **Invariants.** Re-read the `AGENTS.md` of each folder you touched and check the diff against it. For a second opinion, run the `reviewer` subagent on the diff.
5. **Docs.** If behavior changed, update the folder `AGENTS.md`, `packages/protocol/SKILL.md` (for API changes), `docs/architecture.md`, and `docs/plans/README.md` as needed.
6. **Changelog.** A notable change (new routes, fields, or actions, behavior an agent would notice, a deprecation, a removal, a security fix) gets an entry in `CHANGELOG.md`, then `pnpm gen`. A deprecation names what to use instead and "Earliest removal: YYYY-MM-DD". `pnpm gen:check` fails when the API changed and the newest day gained no entry.
7. **Knowledge.** Decisions and learnings from this change go in `docs/knowledge/` (use `capture-knowledge`). Run `pnpm kb`.
8. **Commit.** Imperative subject under 72 characters ("Add release command to sim"). Body says why.
9. **Land it.** The owner's work: push to `main`. Anyone else: open a PR following `.github/pull_request_template.md` (what, why, how tested, AI assistance disclosed).
