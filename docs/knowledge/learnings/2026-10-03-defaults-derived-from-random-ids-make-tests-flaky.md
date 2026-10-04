---
title: Defaults derived from random ids make tests flaky
date: 2026-10-03
tags: [testing, server, sim]
---

# Defaults derived from random ids make tests flaky

**Symptom:** A server test that changes a resident's shape to `square` failed about one run in three with `Cannot read properties of undefined (reading '0')`.

**Cause:** Resident ids are random (`r_` plus random bytes), and the default look is picked from a hash of the id. Sometimes the default was already `square`, so the sim rejected the change as a no-op with `invalid_profile` and there were no events to read.

**Fix or workaround:** In tests, set every field you later change or assert on (join with an explicit `shape`). Sim tests use fixed ids, so this only bites server and e2e tests. When a test fails "sometimes", look for a value derived from an id, token, or clock.
