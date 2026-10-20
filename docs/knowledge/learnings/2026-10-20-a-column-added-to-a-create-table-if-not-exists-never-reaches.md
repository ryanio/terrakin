---
title: A column added to a CREATE TABLE IF NOT EXISTS never reaches a world that already booted
date: 2026-10-20
tags: [server, sqlite, deploy, process]
---

# A column added to a CREATE TABLE IF NOT EXISTS never reaches a world that already booted

## What happened

[Decision 0337](../decisions/0337-a-roof-can-wear-a-vane-a-flag-or-a-nest-on-its-ridge.md) gave a
plot's news a `ridge` count, one more name in `NEWS_FIELDS`
([`plot-news.ts`](../../../packages/server/src/plot-news.ts)), which
[`plots.ts`](../../../packages/server/src/plots.ts) interpolates into
`CREATE TABLE IF NOT EXISTS plot_news`. On terrakin.org that table had existed since the feature
shipped, so `IF NOT EXISTS` did nothing and the column was never added. Every read and write
naming it answered `no such column: ridge at offset 76: SQLITE_ERROR`, and
`GET /v1/plots/{px}/{py}` went down (TERRAKIN-API-2).

`pnpm verify` was green and stayed green. Every test builds a fresh world, where the `CREATE`
runs for the first time and the column is right there. The only world that could meet the bug was
one that already existed, and there is exactly one of those.

## What to do about it

A `CREATE TABLE IF NOT EXISTS` is a first-boot statement, never a migration. Adding a column needs
an `ALTER TABLE ... ADD COLUMN` beside it, run every boot inside a `try`/`catch` because SQLite has
no `IF NOT EXISTS` for a column. Most tables here already do this by hand
(`profiles`, `reactions`, `notices`, `media`, `gestures`, `reports`, `moderation_log`,
`chatter_usage`, `chatter_log`); `plot_news` is the one that builds its column list from a constant
and so looked like it maintained itself.

Two guards are in `plots.test.ts` now:

- One creates `plot_news` at the shape it had before `ridge`, boots the service against it, and
  checks every field in `NEWS_FIELDS` is on the table and the old row still reads. That is the
  shape of test a fresh-world suite can never write for itself, so write it deliberately.
- One reads the server source and fails on any `CREATE TABLE IF NOT EXISTS` whose columns come
  from a constant without an `ADD COLUMN` pass over the same constant. A table that keeps its
  column list in code will gain a column sooner or later.

## The wider shape

The bug class is "state that already exists in production and nowhere else". A fresh-world test
suite is blind to all of it: a migration, a backfill, a field that defaults differently for old
rows, a stored value written under a name since renamed. When a change touches a table, a stored
snapshot, or anything read back from before, the test worth writing is the one that starts from
the *old* shape and proves the new code copes. Starting from the new shape proves nothing, however
green it is.

It also argues for reading Sentry after a deploy that touches storage, rather than waiting for
somebody to notice. This one was found in Sentry, three hours after it started, with nothing red
anywhere in CI.
