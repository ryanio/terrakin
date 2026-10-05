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

**The same day, the other way round:** a session squashed with `git reset --soft origin/main` in a worktree whose files were based on an older main, after another session's fetch had moved the shared `origin/main` ref. The commit recorded the old tree on top of the new main, so it deleted everything landed in between (938a564, repaired in 7ec6535). `origin/main` is shared by every worktree of the repo, so it can move under you at any moment. Squash against your branch's own base (`git reset --soft $(git merge-base HEAD origin/main)`), then rebase, and before every push check that `git diff origin/main --stat` lists only your own files.
