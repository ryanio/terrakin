---
title: A moved workspace package needs its lockfile importer renamed, which pnpm install can't do offline
date: 2026-10-06
tags: [tooling]
---

# A moved workspace package needs its lockfile importer renamed, which pnpm install can't do offline

**Symptom:** after `git mv` of a workspace package (the move to `packages/`, [decision 0111](../decisions/0111-every-workspace-package-lives-in-packages-apps-and-libraries.md)), `pnpm install --offline` fails with `ERR_PNPM_NO_OFFLINE_META` for one of the moved package's dependencies, like `@types/ws`.

**Cause:** `pnpm-lock.yaml` keys each package's `importers` entry by its folder (`server:`). Under a new folder the entry isn't found, so pnpm resolves that package's dependencies from scratch, which needs registry metadata the offline cache doesn't have. Online it would resolve them again too, and could pick new versions or peer sets instead of just renaming.

**Fix or workaround:** when the packages keep their places relative to each other, the `link:../sim` entries stay right and only the importer keys change. Rename those keys and nothing else (`server:` to `packages/server:`), then let pnpm check it: `pnpm install --frozen-lockfile --offline` must pass, and a plain `pnpm install --offline` must say "Lockfile is up to date" and leave the file unchanged. Never delete and regenerate the lockfile: on macOS that drops the Linux optional binaries the deploy needs.
