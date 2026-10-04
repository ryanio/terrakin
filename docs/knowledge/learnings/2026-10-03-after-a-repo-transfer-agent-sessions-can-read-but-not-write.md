---
title: After a repo transfer, agent sessions can read but not write
date: 2026-10-03
tags: [tooling, agents, process]
---

# After a repo transfer, agent sessions can read but not write

**Symptom:** After the repo moved from musefelipe/terrakin to ryanio/terrakin, a cloud session started on the old name could fetch and read PRs, but `git push` and every GitHub API write returned 403. Attaching ryanio/terrakin to the same session was refused because both repos are named `terrakin`.

**Cause:** GitHub redirects the old name, so reads work. Writes need the Claude GitHub App installed on the new owner, and a session can't hold two repos with the same name.

**Fix or workaround:** Install the Claude GitHub App on ryanio/terrakin and start new sessions with ryanio/terrakin as the source. Re-connecting GitHub mid-session can also invalidate the session's GitHub tools ("invalid session"); start a fresh session if that happens.
