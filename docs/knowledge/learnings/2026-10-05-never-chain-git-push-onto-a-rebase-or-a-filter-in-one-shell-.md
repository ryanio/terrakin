---
title: Never chain git push onto a rebase or a filter in one shell line
date: 2026-10-05
tags: [process, agents, tooling]
---

# Never chain git push onto a rebase or a filter in one shell line

**Symptom:** half of a change landed on main. `git rebase origin/main | grep ... ; git push origin HEAD:main` stopped on a conflict partway through, and the push sent the commits rebased so far, so main had the sim half of coins without the protocol and server half until the rest was pushed. The same day, `git push ... | tail -1 && pnpm cf:deploy` deployed a tree that the push had been refused for.

**Cause:** a pipe's exit status is its last command's (`grep`, `tail`), so `&&` after it doesn't see the rebase or push fail, and `;` doesn't look at all. Several sessions push to main, so a rebase stopping on a conflict is normal, not rare.

**Fix or workaround:** push only when the tree is what you verified and main hasn't moved:

```sh
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

Check `git status` shows no rebase in progress first. Deploy only after confirming `git rev-parse HEAD` equals `git rev-parse origin/main`, from a clean tree. When resolving rebase conflicts with a script, take a side only for generated files; a hand-written file that conflicts needs reading, or the change in it is silently dropped.
