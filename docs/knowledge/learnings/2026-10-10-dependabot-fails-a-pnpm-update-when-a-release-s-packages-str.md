---
title: Dependabot fails a pnpm update when a release's packages straddle its three-day cooldown
date: 2026-10-10
tags: [dependabot, pnpm, ci, tooling]
---

# Dependabot fails a pnpm update when a release's packages straddle its three-day cooldown

**Symptom:** Dependabot's npm run 38043855808 failed with `Error processing @sentry/browser (Dependabot::SharedHelpers::HelperSubprocessFailed)`, "Scope: all 8 workspace projects". Under it, pnpm's own error:

```
ERR_PNPM_NO_MATURE_MATCHING_VERSION  Version 11.5.0 (released 2 days ago) of @sentry/replay-canvas does not meet the minimumReleaseAge constraint
This error happened while installing the dependencies of @sentry/browser@11.5.0
```

**Cause:** two gates on a release's age that look at different packages. Dependabot holds a new version back for three days by default (the log's "Filtered out 2 versions due to cooldown"), judged by the publish time of the dependency it is updating. It then runs `pnpm update @sentry/browser@11.5.0 --lockfile-only --no-save -r --config.minimum-release-age=4320`, and pnpm applies the same 4320 minutes to every package in the tree. Sentry publishes a release's packages over about two minutes:

| Package at 11.5.0 | Published (UTC, 2026-10-07) |
|-------------------|-----------------------------|
| `@sentry/browser` | 10:09:18 |
| `@sentry/core` | 10:09:51 |
| `@sentry/replay` | 10:09:59 |
| `@sentry/replay-canvas` | 10:10:06 |
| `@sentry/cloudflare` | 10:11:05 |

The run checked `@sentry/browser` at 10:09:51 on 2026-10-10, three days and about half a minute after it was published, so 11.5.0 passed the cooldown. pnpm ran four seconds later and refused `@sentry/replay-canvas@11.5.0`, which `@sentry/browser@11.5.0` pins and which was 11 seconds short of three days. The same run had already left `@sentry/core` and `@sentry/cloudflare` at 11.4.0 ("Filtered out 3 versions"), since their 11.5.0 was still inside the cooldown. The run started then because commit 273ff0e5 edited `.github/dependabot.yml` at 10:08:07, and Dependabot runs when its config changes.

Nothing in the repo sets a release age: not `.npmrc`, `pnpm-workspace.yaml`, or `packageManager` (pnpm 10.28.0, which Dependabot installed for the run). The 4320 is on Dependabot's command line.

**Fix or workaround:** none needed here. Any run after 10:11:06 on 2026-10-10 finds every 11.5.0 package past three days. If it happens again, read `gh run view <id> --log-failed` for `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, compare `npm view <package> time --json` for the packages named with the run's time, and let the next run try again. Adding the package to pnpm's `minimumReleaseAgeExclude` would turn the gate off for it, which isn't worth it for a two-minute window.
