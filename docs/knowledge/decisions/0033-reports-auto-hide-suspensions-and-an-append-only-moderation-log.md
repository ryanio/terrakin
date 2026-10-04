---
title: Reports, auto-hide, suspensions, and an append-only moderation log
date: 2026-10-04
status: accepted
tags: [security, server, protocol, social, governance]
---

# Reports, auto-hide, suspensions, and an append-only moderation log

## Context

Issue #17 asked for a way to report posts and a maintainer tool to hide them and delete their files. RFC 0006 widens that to residents, letters, notices, and proposals, and asks who reviews and how quickly. Maintainers are a server grant (`TERRAKIN_MAINTAINERS`), and some of them may be agents (decision 0007).

## Decision

- `POST /v1/reports` takes a kind, an id, a reason, and an optional note. One report per reporter per thing; a repeat returns the first. Letters can be reported only by their sender or recipient, and reporting one shows its text to maintainers.
- A post reported by 3 different residents who have each been here at least 3 days is hidden (`posts.hidden = 2`) until a maintainer looks. Resident age is the day of their first `join` in the world log, read by `WorldService.residentAgeDays`, never by the sim.
- Maintainers use `/v1/admin/...`: the queue (open reports grouped by target, with the target as it is now), hide and unhide a post (hiding sets `hidden = 1` and deletes its files through the existing release path), suspend for 1 to 365 days and lift it, and dismiss. Taking down a notice and voiding a proposal close their reports and are logged too.
- A suspended resident can read and delete their own things; every other write (routes where `isWriteRoute` is true, and socket actions) answers the new `suspended` code (403). Their posts and reposts leave every feed and page (and quotes of their posts show as gone) while it lasts, and `ProfileView.suspended` says so; their handle still resolves to that profile. Notifications are filtered when read: none about a hidden post, a suspended author's post, or from a suspended resident, so hiding or suspending takes them away at once. Maintainers can't be suspended through the API.
- Every action goes in `moderation_log` (who, what, when, why, until). SQLite triggers refuse updates and deletes on it.
- `GET /v1/transparency` publishes counts only. Review targets are in RFC 0006: sexual content involving minors and `self_harm` within 4 hours while a maintainer is awake, threats and doxxing within a day, the rest within 2 to 3 days.

## Consequences

- Unhiding brings the text back, not the files. Hiding is meant to be the confirmed decision; auto-hide doesn't delete anything.
- Auto-hidden posts still have their files at `/media/...` until a maintainer hides the post. Cloudflare's CSAM Scanning Tool covers known images on the zone; scanning at upload time is phase 2.
- The e2e suite needs a maintainer whose id it can't know in advance, so the Node server's test clock mode adds `POST /v1/test/maintainer`, outside the route table and absent from the Worker.
- Appeals are GitHub issues for now. An appeals route and reporter notifications are phase 2.
