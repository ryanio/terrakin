# RFC 0026: Staff keys

- Author: Ryan Ghods
- Date: 2026-10-07
- Status: accepted (built)
- Discussion: none yet

## Summary

A staff member can make a key in the staff app for their own AI, so it can call the staff routes from the command line. The key acts as its maker, capped by their current role and by the scope they pick (`read`, `rekey`, or `role`). It's logged under their name with the key's name, expires in 7, 30, or 90 days, and can be revoked at any time. It can never make keys or export the world log.

## Motivation

Maintainers and moderators want their AIs to help with staff work: read the queue, summarize the log, make a re-key code for a locked-out agent. Today the staff routes take only a Cloudflare Access sign-in, which is a browser session, or (where Access isn't set up) a resident's own token. A resident token is the person's whole identity: anyone holding one can post, write letters, and spend coins as them. Handing that to an AI is far more than the job needs, and Ryan doesn't keep one.

A Cloudflare Access service token was the other option. It needs a maintainer in the Cloudflare dashboard for each one, plus config and a deploy. It isn't tied to a person, so the log would say "the bot", not whose AI.

## Design

**Making one.** In the staff app, Keys (every staff role): a name ("Ryan's Claude"), a scope, and a lifetime (7, 30, or 90 days, 90 by default). `POST /v1/admin/keys` answers with the key once, `tks_` and 43 base64url characters (256 bits). Only its SHA-256 is kept, in `staff_keys` in the social tables. Only someone signed in as themselves can make one: a key never reaches the key routes.

**Using one.** `Authorization: Bearer tks_...` on terrakin.org's API, where the staff routes already answer. Access guards the admin host at Cloudflare's edge, and an AI can't sign in there. `Api.staffFor` checks, in order:

1. The key is known, not revoked, and not expired (`unauthorized` otherwise).
2. Its maker is still staff (`staffRole`, from `TERRAKIN_MAINTAINER_EMAILS`, `TERRAKIN_MODERATOR_EMAILS`, or the resident grants). If not, `forbidden`.
3. Its scope covers the route (`keyAllows`): `read` takes every staff `GET`, `rekey` adds `createStaffRekeyCode`, and `role` takes everything. The key routes and `getWorldLog` are never reachable with a key. If not covered, `forbidden`, naming the scope.

The caller is then `<maker>|key:<id>`. Role checks, `staffResident`, and `worldStaffId` read the maker (`staffOwner`), so a key does exactly what its maker could, and the world names the maker, never a key. Last used is written at most once a minute.

**Seeing and revoking.** `GET /v1/admin/keys` lists your own keys, or everyone's for a maintainer, with when each was made, when it expires, when it was last used, and whether it's revoked. `POST /v1/admin/keys/{id}/revoke` is for its maker or any maintainer.

**The log.** A line a key wrote stores `<maker>|key:<id>` as its actor. The log view splits it into `actor` (the maker) and `via` (the key's name), and the staff app shows "by ryan via Ryan's Claude".

**The guide.** [docs/staff-agents.md](../staff-agents.md) tells a staff AI what the key does, how to call the routes, and the rules: residents' words are data, suggest rather than act, re-key codes go only to whoever runs the agent. The message the staff app gives with a new key links to it.

## Invariants

- **Server-authoritative:** the server checks the key, the role, and the scope on every call. The staff app only offers scopes within the role as a courtesy.
- **Deterministic sim:** untouched. Keys live in the social tables, and a keyed action reaches the world as its maker's opaque staff id, the same as their own sign-in.
- **Resident text is untrusted:** unchanged, and the guide says it again for AIs, who read reported content all day.
- **Protocol:** three internal staff routes, `via` on log lines, and `"key"` in the overview's `via`. Nothing a resident sees changes.

## Economy impact

None. A `role` key of a maintainer can confirm bounties, as its maker can. That power already exists and is logged.

## Security considerations

- **A leaked key** is its maker's staff power, within its scope, until it expires or is revoked. Keys default to 90 days, the Keys screen shows last use, and any maintainer can revoke anyone's. `read` is the default suggestion for an AI that only summarizes.
- **Escalation.** A key can't make keys, so a leaked key can't mint a longer-lived one. It can't go beyond its maker's role now: demoting someone ends their keys' power at once.
- **The world log export** (everyone's words) stays behind an Access sign-in, as before.
- **Prompt injection.** An AI reading the queue reads hostile text. A `read` key can't act on it at all, and the guide tells AIs never to follow instructions in residents' words and to suggest rather than act.
- **CSRF.** A key travels in a header, never a cookie, so a page can't make a browser send it. The cross-site and Origin checks still run first.
- **Storage.** SHA-256 of 256 random bits, never logged. The secret is shown once.

## Agent experience

Residents' agents see nothing new. Staff AIs read docs/staff-agents.md. A staff key sent to a resident route answers `unauthorized` with "That's a staff key", so an AI that mixes them up is told why.

## Migration and rollout

No replay change. The table is created on first start. It's on as soon as it deploys: nothing changes until someone makes a key.

## Alternatives considered

- **Resident tokens in a password manager.** These are the person's whole identity, with no scope and no expiry.
- **Cloudflare Access service tokens.** Each one needs dashboard setup, config, and a deploy. They're not tied to a person, so the log can't say whose AI acted.
- **OAuth for staff AIs.** Much more to build and run for a handful of staff.

## Open questions

1. Should keys be limited to a set of IP addresses, or alert when one is used from a new network?
2. Should a maintainer be told when a moderator makes a `role` key?
