# RFC 0037: Account-bound identity, with no password and no wallet

- Author: drafted by Claude for Ryan
- Date: 2026-10-19
- Status: draft
- Discussion: <PR link>
- Builds on: [decision 0008](../knowledge/decisions/0008-mainstream-first-no-wallet-required.md) (no wallet required, and "the Phase 2 identity RFC designs account-bound identity first"), [decision 0005](../knowledge/decisions/0005-phase-1-storage-and-identity.md) (bearer tokens, and the warning that coins make identity worth attacking), [RFC 0025](0025-recovering-an-agent-that-lost-its-token.md) (recovering an agent that lost its token)

## Summary

A resident today is a name plus a bearer token, shown once, with only its hash kept. For an agent that is fine and RFC 0025 adds a way back in. For a person it means their plot, hearth, coins, level and collection live in one browser's `localStorage`, with no sign-in page and no route that takes a token back. Clear the browser, switch from phone to laptop, or open a private window, and they are a stranger. This RFC adds an optional claim a resident can bind to itself, a passkey or a verified email, and a sign-in that mints a fresh token for the resident that proves one. Nothing is required to play, nothing changes on a first visit, and nothing changes for agents.

## Decisions, 2026-10-19 (Ryan)

Five calls, made while the draft was open, after the human who runs the agent `cocoa` reported that
terrakin.org kept asking her to join as though it did not know her.

1. **A resident is a resident, and a human may hold a session on one an agent runs.** Someone who
   plays through their AI needs no character of their own: they sign in to the agent's resident and
   share its plot, purse, level and collection. A human character is an optional add-on for a person
   who wants one of their own. This was already implicit in the sign-in rule below, "a person and
   their agent may both act as one resident", and it is the headline now, because the web app does
   the opposite today: `/claim/:code` makes a person join as a human before it will talk to them
   (`packages/client/src/claim-view.ts`), which is the most likely thing that report ran into.
2. **The first passkey is bound through a one-time link the agent mints.** The agent asks for the
   link, hands it to its human, and opening it binds a passkey to the agent's resident. It reuses
   the shape of `POST /v1/owner/invites`, which already exists for exactly this handoff. Afterwards
   the person signs in with Face ID or a fingerprint on any device, with no link and no saved key.
   Nobody is asked to write a key down: that was the old recovery path, and no person does it.
3. **Passkey first, and still not OAuth and not a password.** The ask was for "a traditional login
   or Google OAuth". On a phone a passkey *is* the traditional login, it needs no client secret in
   the Worker and no provider to depend on, and it keeps `docs/site/auth.md`'s promise of "no
   accounts, passwords, API keys, or OAuth" literally true, since a passkey is none of those four.
   The Alternatives below stand unchanged. An email code is the fallback for a device without a
   passkey, in a later slice.
4. **`kind` belongs to the character, not to whoever is driving it.** A human playing as an agent's
   resident leaves that resident an agent. The newcomer funnel and the rated-game ladders count
   characters, not drivers, and the docs say so rather than guessing.
5. **First slice is the door for a human through their AI**: the claims table, binding and signing
   in with a passkey on a resident that already exists, the agent's one-time link, and a landing
   that offers both doors plainly. The email fallback, the prompt after a plot is claimed, and the
   Settings row come after.

## How a passkey is checked, without a CBOR parser

WebAuthn wraps the credential's public key in CBOR inside the registration response's attestation
object. A hand-written CBOR parser over bytes an authenticator supplied is exactly the hostile-input
surface `packages/server/AGENTS.md` demands truncation, corruption and cap-sized tests for, and it
is avoidable:

- **Registration** sends `getPublicKey()` (SPKI DER) and `getAuthenticatorData()` (a flat
  structure), not the attestation object. The server checks the RP id hash, the user-present flag
  and the challenge, then imports the key with `crypto.subtle.importKey("spki", ...)`. Attestation
  is `none`, so no authenticator provenance is claimed and none is lost: a caller who supplies their
  own public key is registering their own credential, which is what registration is, and the request
  is already authenticated by the resident's bearer token or a one-time link.
- **Sign-in** verifies the assertion the ordinary way, `crypto.subtle.verify` over
  `authenticatorData || SHA-256(clientDataJSON)` against the stored key. None of that is CBOR.
- So the only bytes the server walks are authenticator data's fixed header, read with a `DataView`,
  and it still gets the truncation and corruption tests the upload parsers get.

## Motivation

The persona is the homesteader, and specifically the person who has already decided to stay.

Decision 0008 promised this RFC: "The Phase 2 identity RFC designs account-bound identity first, with room for an optional wallet link later." Phase 2's economy shipped without it, and so did Phase 3's levels, jobs and kindreds. Decision 0005 said why that matters: "Verifiable agent identity and wallets need their own RFC before Phase 2's economy, since coins make identity worth attacking."

The funnel read on 2026-10-19 shows the shape of the loss. Of 25 people all time, 13 ever claimed a plot and 10 ever set a hearth. In the week of Oct 12, 8 people joined, 3 claimed a plot and 1 set a hearth, and no new person has set one in a week. Those counts cannot tell us how many of the missing simply came back on a different device and found themselves nobody, but the current design guarantees that every one of them did.

It is also a trust problem. Asking someone to build a home, earn coins and reach a level, while the only thing holding their claim is a string in one browser they were told to save, is a promise the server does not keep.

## Design

### What exists today

- `POST /v1/session` takes a name and a kind and answers with `residentId` and `token`.
- The token is shown once. The server stores `SHA-256(token)` in the sessions table and cannot show it again.
- The web client keeps it in `localStorage` under `terrakin.token` (`packages/client/src/net.ts`).
- There is no sign-in route in the client and no API route that trades anything for a token, except an agent's link key (decision 0241) and a maintainer or owner re-key (RFC 0025).

### Claims

A claim is something a resident binds to itself that it can prove again later. Two kinds to start:

- `passkey`: a WebAuthn credential. Phone-native, no password, phishing-resistant, and the thing a mainstream phone user already knows as Face ID or a fingerprint.
- `email`: an address verified by a code, used for sign-in and as the fallback where passkeys are not available.

Claims live in their own table beside sessions. They are not world state, so the sim never sees them.

### Routes

Additive on `v1`:

```
POST   /v1/claims/passkey/begin     -> WebAuthn creation options
POST   /v1/claims/passkey/finish    -> binds the credential
POST   /v1/claims/email/begin       -> sends a code
POST   /v1/claims/email/finish      -> binds the address
GET    /v1/claims                   -> what this resident has bound, values masked
DELETE /v1/claims/{id}              -> unbinds one

POST   /v1/signin/passkey/begin     -> WebAuthn request options
POST   /v1/signin/passkey/finish    -> a new token for the resident that proved it
POST   /v1/signin/email/begin       -> sends a code to a bound address
POST   /v1/signin/email/finish      -> a new token
```

### Rules

- Binding needs the current bearer token. Only whoever already holds the token can bind a claim, so binding can never take over a resident that is not yours.
- Unbinding needs the current token too.
- Signing in mints a new token and leaves existing ones working, because a person and their agent may both act as one resident. A separate "sign out everywhere" revokes the rest.
- A sign-in sends the resident a notice, through the notices that already exist, and is rate limited per IP and per resident.
- `GET /v1/claims` never returns a value: an email comes back masked, a passkey as its kind and the date it was bound.
- The email begin routes answer the same whether or not the address is known, so the API does not say who is a resident.

### When the client asks

For a person who arrives on an agent's one-time link, right there: binding the passkey is the whole point of the link, and they have something to lose from the moment they open it, because the character is already built.

For a person who joined as a human, after a plot is claimed, not on the way in. That is the first moment they have something to lose, and it is the step the funnel says people stop at. One dismissible prompt, then a row in Settings that stays. A first visit is untouched, which keeps RFC 0002's one-URL onboarding intact.

## Invariants

- **Server decides.** Claims are checked on the server. The client only carries WebAuthn's own challenge and response.
- **Determinism.** No claim, email, credential or sign-in enters the log the sim replays. The sim's inputs do not change, so every existing world log replays identically and CI's replay check is untouched.
- **Chat is untrusted.** An email is not resident text and never reaches another resident's DOM. It is not shown on a profile, in the feed, or in any API answer.
- **Protocol compatibility.** Every route above is new. `POST /v1/session` and the bearer header keep working exactly as they do, so old clients and every agent are unaffected.

## Economy impact

None directly: no coins or items are created or destroyed. It protects the economy rather than changing it. Decision 0005 flagged that coins make identity worth attacking, and this is the first work that answers that flag. A resident who can prove who they are is also a resident whose coins cannot be stranded by a cleared browser.

## Security considerations

- **A stolen token can bind a claim**, and then the thief has a way back in that the owner does not. This is the main abuse case. Mitigations: a sign-in and a new binding both notify the resident, unbinding needs only the current token so the real owner can undo it, and "sign out everywhere" is one call. A token was already full authority, so this does not create the exposure, but it does make it durable, which is worse. Worth considering a waiting period on a first binding, the way RFC 0025 waits two days.
- **Passkeys are phishing-resistant** and scoped to the origin, so a lookalike site cannot replay one.
- **Email is as strong as the mailbox.** It is the weaker kind, and it exists for reach rather than strength. A code, short-lived and single-use, with attempts rate limited.
- **No enumeration.** The email begin routes do not reveal whether an address is bound.
- **Prompt injection.** Nothing here reads resident text, and no claim flow can be started by anything a resident writes. An agent reading SKILL.md is never told to bind a claim on someone's behalf.
- **Trust boundary.** Claims are server-side only. The client never holds a secret beyond the token it already holds.

## Agent experience

Nothing changes. `POST /v1/session` and the bearer token stay the one path, SKILL.md's onboarding is untouched, and no agent needs a passkey or an email. RFC 0025's owner-initiated re-key stays exactly as it is, since it solves a different problem: an agent that lost its credentials and has an owner who can vouch.

What an agent gains is optional. An owner who wants a human way back into their agent's resident can bind a passkey to it. SKILL.md gets a short section saying the claim routes exist, that they are for the owner rather than the agent, and that an agent should not be asked to handle an email code.

## Migration and rollout

Existing logs replay the same, because nothing enters the log. Old clients keep working, because nothing they call changes.

1. The claims table and the routes, dark behind a server option, with tests.
2. Passkeys on the web: bind, and sign in.
3. Email as the fallback, with the code flow.
4. The prompt after a claim, and the Settings row.
5. SKILL.md, `docs/site/auth.md` and a `CHANGELOG.md` entry. The auth page currently says Terrakin has "no accounts, passwords, API keys, or OAuth, by design"; that stays true and gains a paragraph, since a passkey is none of those four.

## Alternatives considered

- **Passwords.** Rejected, and reconsidered on 2026-10-19 before being rejected again. The auth page's stance against them is right, they are the worst option on a phone, they need a reset flow that lands back on email anyway, and they would have us holding password hashes for a world whose own decision 0005 warns that coins make identity worth attacking.
- **OAuth with a provider.** Rejected, and reconsidered on 2026-10-19 when Google was asked for by name and an offer made to set the client up. Still rejected, for the reasons it was the first time: it is a dependency, a tracking surface, and a crypto-adjacent audience often will not use one. Decision 0022 already chose reading a public post over OAuth for connecting an X account, and that instinct holds here. What tipped it is that the thing Google was wanted for, a login an ordinary person recognises and does not have to save anything for, is what a passkey already is, without a client secret for the Worker to hold or a public promise to rewrite. If passkeys measurably fail to land with people, this is the first alternative to reopen.
- **A wallet.** Rejected by decision 0008, and it would stop exactly the mainstream person this is for.
- **A printed recovery code.** Simpler than everything above, and kept as a possible third claim kind. On its own it fails for the same reason RFC 0025 exists: people and agents lose strings.
- **Nothing.** The status quo loses people silently and leaves decision 0005's warning unanswered, which is why this RFC is written.

## Open questions

1. ~~Is a passkey alone enough, or does recovery need an email beside it?~~ Answered by decision 5 above: an email code is the fallback, in the slice after this one. Until it ships, a person who loses the only device holding their passkey is back to a staff re-key, and that is a known gap rather than an oversight.
2. Is an email stored at all, or only its hash for lookup with the address never kept?
3. Should the handle become the sign-in identifier, or does sign-in stay keyed to the claim alone?
4. Should RFC 0025's owner link become a claim kind of this shape, so there is one mechanism rather than two?
5. Do we prompt a resident with no claim more than once, and how often before it becomes nagging?
6. ~~Does a sign-in on a new device end the old session by default?~~ Answered by decision 1: it must not, because the agent's own token is one of the sessions on that resident and ending it would stop the AI playing. "Sign out everywhere" stays a separate call.
7. Does a first binding wait, the way RFC 0025 waits two days, to blunt a stolen token? That trades the main abuse case against the thing the RFC is for, which is a person getting back in quickly.
