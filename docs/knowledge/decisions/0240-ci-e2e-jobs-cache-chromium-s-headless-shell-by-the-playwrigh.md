---
title: CI e2e jobs cache Chromium's headless shell by the Playwright version and install no apt packages unless a library is missing
date: 2026-10-09
status: accepted
tags: [e2e, ci, tooling]
---

# CI e2e jobs cache Chromium's headless shell by the Playwright version and install no apt packages unless a library is missing

## Context

Each e2e job ran `playwright install --with-deps --only-shell chromium`. The browser itself already came from `actions/cache`, keyed on the whole `pnpm-lock.yaml`, so any dependency bump downloaded it again. The step's time was apt. In run 37804057662 it took 11 to 16 seconds in the 2D shards and 269 seconds in the 3D smoke, against 29 seconds of tests.

That job's log shows what apt did. Every library the headless shell links (libnss3, libgbm1, libatk, libcups, libxkbcommon and the rest) was "already the newest version" on the `ubuntu-latest` image. The only new packages were nine fonts (Japanese, Chinese, Thai, GNU Unifont, FreeFont, X core fonts) and a libfreetype6 upgrade: 21.5 MB from the Azure Ubuntu mirror at 83.5 kB/s. No spec or client page shows text in those scripts.

## Decision

- The e2e jobs in `.github/workflows/ci.yml` and `nightly.yml` cache `~/.cache/ms-playwright` under `playwright-<os>-<version>`, the exact `@playwright/test` version installed from the lockfile, which pins its browser builds. On a miss they install Chromium's headless shell alone (`--only-shell chromium`), the one browser every project uses.
- They run no apt step by default. A step runs `ldd` over the shell and its bundled libraries, and only when one reports a library `not found` does it run `playwright install-deps chromium`. A runner image that drops a library costs that job the old apt time instead of failing the launch.

## Consequences

- An e2e job's browser setup is a cache restore and an `ldd` pass, a few seconds, and the mirror's speed no longer decides the slowest job.
- A lockfile change that doesn't move Playwright keeps the cached browser. A Playwright bump misses once and downloads the shell from Playwright's CDN.
- A spec that needs one of those fonts (a page showing Japanese, Chinese, or Thai text) would draw boxes for it. Such a spec installs the font it needs (`fonts-noto-cjk`, say) in the workflow.
- The `ldd` check doesn't cover libraries Chromium opens at run time, only those it links. If a launch fails on one, add it to the check or put `install-deps` back.
