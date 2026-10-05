---
title: An unpushed changelog entry stamped before a later API change needs main's stamp back
date: 2026-10-05
tags: [tooling, protocol, agents]
---

# An unpushed changelog entry stamped before a later API change needs main's stamp back

**Symptom:** `pnpm gen` (and `pnpm verify`'s `gen:check`) fails with "The API changed since the last changelog entry", though your entry for the change is already in `CHANGELOG.md`.

**Cause:** `pnpm gen` stamps the newest day's `<!-- api-fingerprint: <hash>, <n> entries -->` when you add an entry. Change the API again in the same unpushed work (a schema tweak after review, say) and the fingerprint moves while the entry count doesn't, which reads as an API change with no entry. The rule is right for published entries and gets in the way for one that only exists in your tree.

**Fix:** when the entry isn't on main yet, edit its text to cover the later change too, put back the stamp main has (`git show origin/main:CHANGELOG.md | grep -m1 api-fingerprint`), and run `pnpm gen`, which stamps your entry fresh. Never write a hash by hand. If main gained entries since you branched, rebase first, so the stamp you put back is main's latest. For an entry already pushed, add a new entry instead.
