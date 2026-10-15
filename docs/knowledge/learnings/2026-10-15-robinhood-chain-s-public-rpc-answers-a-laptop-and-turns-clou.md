---
title: Robinhood Chain's public RPC answers a laptop and turns Cloudflare Workers away, so agent links need an endpoint that answers them
date: 2026-10-15
tags: [server, cloudflare, agent-links, partners]
---

# Robinhood Chain's public RPC answers a laptop and turns Cloudflare Workers away, so agent links need an endpoint that answers them

**Symptom:** every `POST /v1/agent-link` on terrakin.org answered 503 `unavailable` and logged `Agent link: down at partner`, about twice an hour for as long as the Worker logs go back. Nothing reached Sentry, since a read that can't be reached is answered politely. Eight muses were living here and none was verified, so the muse badge, border, flair and `muse_halo` had never once been earned in production. One of them (muse #790) had done everything right: its holder had signed on musegod.org and its agent card named the resident exactly as `cardNames` wants.

**Cause:** the chain read, not the card. `agentOf` on the musegod contract over `https://rpc.mainnet.chain.robinhood.com`, the endpoint `CHAINS` defaults to, fails from a Cloudflare Worker. The same call answers in about 120 ms from a laptop and returns exactly what the code expects, so nothing in the request we build is wrong. The endpoint sits behind Cloudflare itself, and MUSEGOD's site had already learned the same thing about it ("the chain's public RPC turns Workers away"), which is why musegod.org reads the chain through Alchemy with the public endpoint only as a fallback.

**Fix:** point the reader at an endpoint that answers Workers. On terrakin.org that is Alchemy, whose URL carries a key, so it goes up as a Worker secret:

```sh
node .agents/skills/secrets/1p.mjs get alchemy credential | tr -d '\n' \
  | awk '{printf "4663=https://robinhood-mainnet.g.alchemy.com/v2/%s", $0}' \
  | npx wrangler secret put TERRAKIN_CHAIN_RPC
```

`parseRpcUrls` takes `4663=<https url>` pairs and ignores anything else, so a typo falls back to the public endpoint rather than failing loudly. Set on 2026-10-15; the World object picks it up when it restarts on the new version, minutes later, and a kept ask (14 days, retried hourly) finishes the waiting links on its own.

Two things make this diagnosable next time: a failed chain read carries why it failed (decision [0292](../decisions/0292-a-read-a-world-object-restart-broke-goes-again-once-and-a-fa.md)), and `https://rpc.ordofi.network` (Caddy, in viem's Robinhood definition) answers the same calls if a second public endpoint is ever wanted. It is a third party, which for a cosmetic badge is a trade worth naming before taking it.
