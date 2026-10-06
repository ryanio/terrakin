---
title: Every workspace package lives in packages, apps and libraries alike
date: 2026-10-06
status: accepted
tags: [tooling, process]
---

# Every workspace package lives in packages, apps and libraries alike

## Context

The repo started with its packages at the root ([decision 0002](0002-typescript-monorepo-toolchain.md)): `client/`, `server/`, `sim/`, and `protocol/`. `cards/`, `ui/`, and `admin/` joined them, so seven package folders sat beside `docs/`, `e2e/`, `scripts/`, and a dozen config files, and every new package added another. Ryan asked for one place for them.

The usual split in JavaScript monorepos is `apps/` for what deploys and `packages/` for libraries. There will be more kinds of things than apps over time, and the line already blurs here: the client's build carries the staff app, and the server is both a Node app and the Worker.

## Decision

Every workspace package lives in `packages/<name>/`: `client`, `server`, `admin`, `sim`, `protocol`, `ui`, and `cards`. `e2e/`, `scripts/`, `docs/`, and the root config files stay at the root.

- `pnpm-workspace.yaml` is one glob, `packages/*`, so a new package needs only its folder.
- Package names don't change (`@terrakin/sim`), so imports by name and `pnpm --filter` work as before.
- Rejected: `apps/` for client, server, and admin beside `packages/` for the rest. Each new package would have to pick a side, and one folder reads better.
- Rejected: leaving the packages at the root, where the list keeps growing next to the docs and config.

## Consequences

- Repo paths name the folder: `packages/sim/src/apply.ts`, `packages/server/cloudflare/worker.ts`, `TERRAKIN_STATIC_DIR=packages/client/dist`. `wrangler.jsonc` (`main` and the assets directory), the Dockerfile, CODEOWNERS, the Vitest projects, the root `tsconfig.json`, Biome's ignores, and the files `pnpm gen` writes all use them.
- Packages are still siblings, so paths from one package to another didn't change (`../ui/src/tokens.css`, the `link:../sim` entries in `pnpm-lock.yaml`). Paths from a package to the root go up one more level (`../../tsconfig.base.json`, tests that read `CHANGELOG.md` or `docs/`).
- Git follows the renames (`git log --follow`). Old commits, CHANGELOG entries, handoffs, and devlog posts keep the paths they were written with, and decision 0002 and the founding plan describe the layout the repo started with.
- The comment at the top of SKILL.md's endpoint table still says `protocol/src/routes.ts`. The API fingerprint covers that block ([decision 0036](0036-the-agent-changelog-is-one-file-published-as-a-page-a-feed-a.md)), so its words change with the next real API change and its changelog entry.
- A branch from before the move rebases cleanly in two steps: onto the commit that only moves files, with `git -c merge.directoryRenames=true rebase <that commit>`, which carries its edits and its new files into `packages/`, then onto main. Straight onto main, `packages/client/AGENTS.md` changed too much in the move for git to match it to its old path.
