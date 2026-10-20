---
title: GitHub reads skip ci anywhere in a commit message, prose included
date: 2026-10-20
tags: [ci, deploy, process]
---

# GitHub reads skip ci anywhere in a commit message, prose included

## What happened

6773e424 fixed the musegod reports and needed a deploy. The commit after it was a knowledge-index
commit that skipped CI on purpose. The commit after **that** skipped CI by accident: its message
mentioned the flag in a sentence explaining that the commit did not use it.

GitHub matches the flag anywhere in the message, the title and the body alike, and it does not
read the sentence around it. So a commit saying "this does not need [skip ci]" skips CI exactly
as one saying "[skip ci]" does. Two commits in a row skipping meant the musegod fix sat unshipped
with nothing red to show for it, until 9c02d7d3 pushed an empty commit to start a run.

## What to do about it

Name the flag in a commit message only when you mean it. Writing *about* it, in a message, a
template, or a note to the next agent, needs the brackets broken: "skip ci" in words, or
`[skip` and `ci]` apart. The same goes for a PR title that lands as a squash message.

This repo's rule is that a commit changing only tests, docs or agent instructions carries the flag
in its **title**, once the verify gate has passed locally. Keeping it to the title is also what
makes an accidental one easy to see before pushing: `git log -1 --format=%s`.

## The wider shape

A deploy that does not happen looks exactly like a deploy that did, from inside the session that
pushed. Nothing is red, no job fails, and the previous run's green check is still the newest thing
on the branch. After pushing something that has to reach production, check that a run actually
started for **your** commit rather than that the branch is green: `gh run list --branch main
--limit 3` names the commit each run is for.
