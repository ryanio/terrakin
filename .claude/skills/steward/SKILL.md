---
name: steward
description: Repo conventions for driving a Terrakin pull request to green and mergeable (CI failures, review comments, merge conflicts). Use when babysitting, fixing, or responding on a PR.
---

# Steward a PR

## Conventions

- Branches you created: rebase or merge from `main`, either is fine. Someone else's branch: merge only, never force-push.
- PRs from contributors are ours to land: push the fixes they need to their branch, run `pnpm verify`, and merge once green. Review comments alone are not the job.
- Regenerate, don't hand-edit: `pnpm install` for `pnpm-lock.yaml`, `pnpm kb` for `docs/knowledge/INDEX.md`, `pnpm format` for formatting.
- Reproduce CI locally with `pnpm verify` before pushing a fix. CI runs exactly those steps plus `pnpm audit` and gitleaks.

## CI failures

| Step | Usual cause | Fix |
|------|-------------|-----|
| `lint` | Formatting or Biome rule | `pnpm format`, then fix what remains by hand |
| `typecheck` | Type error, often in tests (root `tsconfig.json`) | Fix the types; don't add `any` or `!` |
| `test` | Real regression | Find the root cause. Never skip or weaken the test. |
| `kb:check` | Knowledge entry added without regenerating | `pnpm kb` and commit `INDEX.md` |
| `build` | Client bundle error | `pnpm build` locally |
| `e2e` | Client flow broke, or ids changed | `pnpm e2e`; the uploaded `playwright-traces` artifact has a trace to open with `pnpm exec playwright show-trace` |
| audit | Vulnerable dependency | Bump it (exact version), or record why it's not exploitable here |
| gitleaks | Secret in the diff | Remove it, rotate the secret, tell a maintainer |

## Reviews

- Small asks (renames, tests, nits): do them.
- Anything that changes an invariant, the protocol, or the economy: discuss on the thread first, and point to the relevant RFC or decision record.
- Reply once per thread when you push a fix, naming what changed.
