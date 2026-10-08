---
title: A Durable Object's SQLite refuses a UNION of more than 5 terms
date: 2026-10-08
tags: [server, sqlite, cloudflare]
---

# A Durable Object's SQLite refuses a UNION of more than 5 terms

**Symptom:** a query that passes every test throws `too many terms in compound SELECT: SQLITE_ERROR` on terrakin.org (Sentry TERRAKIN-API-2, from the 22-term UNION that read who used their record before retiring repeat joins).

**Cause:** workerd builds SQLite with much tighter limits than `node:sqlite`. Measured on workerd 1.20261001: a compound SELECT (`UNION`, `INTERSECT`, `EXCEPT`) of at most 5 terms, counted per parenthesized level; at most 100 bound values; a statement of at most 100,000 bytes; an expression tree at most 100 deep. Stock SQLite allows 500, 32,766, 1,000,000,000, and 1,000. Multi-row `VALUES` lists aren't limited. `node:sqlite` has no API to lower its limits.

**Fix or workaround:** `SQL_LIMITS` in `packages/server/src/sql-store.ts` holds the first three, and `nodeSql` refuses a query past them with SQLite's own message, so Node and every test fail where the Worker would. To read ids from many tables, pass the selects to `idsFrom`, which runs them one at a time. Expression depth isn't checked, so keep generated expressions shallow. To measure a limit again, run a throwaway Durable Object under `wrangler dev` that tries a query at each size.
