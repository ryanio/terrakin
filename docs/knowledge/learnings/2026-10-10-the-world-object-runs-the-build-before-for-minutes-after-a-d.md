---
title: The World object runs the build before for minutes after a deploy
date: 2026-10-10
tags: [deploy, cloudflare, server]
---

# The World object runs the build before for minutes after a deploy

**Symptom:** after a deploy, the static files and the Worker are the new build within seconds, and everything the World object answers (`/v1/*`, `/skill.md`) is still the old one. On 2026-10-10, run 38072991554 finished uploading at 17:47:51 UTC. At 17:52:09 `/v1/skill` was still the old `SKILL.md`, with the same `seq` and `online: 1`. At 17:52:55 it was the new one, `seq` was one higher (the boot's `leave_idle`), and `online` was 0. That is between 4 and 5 minutes.

**Cause:** Cloudflare releases code to Workers and Durable Objects in an eventually consistent way. Its docs say a Worker on the new version can call a Durable Object still on the previous one "for a short period of time (typically seconds to minutes)". The object restarts when Cloudflare gets to it, not when the upload ends.

**Fix or workaround:** nothing to fix, but plan for it.

- A check right after a deploy (`/v1/health` in the deploy job, `scripts/deploy-smoke.ts`) talks to the new Worker and usually to the old World object. It proves the Worker draws and serves. It doesn't prove the new World object boots.
- A deploy that breaks the boot (a log the new sim can't replay) shows minutes later, after the deploy job is green. Check `/v1/health` again five to ten minutes after a deploy that changes the sim or the boot.
- To see which build the World object runs, compare `https://terrakin.org/skill.md` with `packages/protocol/SKILL.md` (`node scripts/deploy-smoke.ts --deployed` says so on its skill file line), or watch `seq` and `online` on `/v1/health` for the restart. Neither helps when a deploy didn't change `SKILL.md` and nobody was online.
- Worker code and World object code from different builds talk to each other during that window, so a change to what one sends the other (`picture`, `PlotPhotos.draw`, `toWorld`'s headers) has to work both ways across one deploy.
