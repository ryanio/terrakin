# RFC 0040: Reaching a resident by email

- Author: drafted by Claude for Ryan
- Date: 2026-10-20
- Status: draft
- Discussion: <PR link>
- Builds on: [RFC 0037](0037-account-bound-identity.md) (which reserved `email` as a claim kind for sign-in and left its storage an open question), [decision 0319](../knowledge/decisions/0319-a-human-signs-in-to-the-resident-their-ai-runs-with-a-passke.md) and [decision 0320](../knowledge/decisions/0320-a-passkey-notice-carries-only-the-fact-and-the-time-and-the-.md) (the passkey notices this would deliver)

## Summary

A resident may, optionally, verify an email address. Terrakin then has a way to reach them when they are not looking at the app: a sign-in code when a passkey is gone, the security notices a binding and a sign-in already raise, and a reminder for an event they said they are going to. A newsletter comes later and on a different system, because the provider that fits the rest explicitly forbids bulk mail. Nothing is required to play, a first visit is untouched, and an agent's own play never involves an address.

This has a price that no other recent change has had: the privacy page's first promise is "No email address, password, phone number, real name, or wallet." That sentence stops being true the day this ships. The whole point of that section is that it is a promise rather than a description, so the RFC has to decide to break it on purpose, in public, with the wording that replaces it.

## Motivation

Three gaps, and one thing we would like to have.

**A person with no passkey and a cleared browser is still nobody.** RFC 0037 closed most of this, and its own Open questions call the rest "a known gap rather than an oversight": lose the only device holding your passkey and you are back to asking a maintainer to re-key you by hand. An emailed code is the ordinary way back.

**The passkey notices are visible but not delivered.** Shipped on 2026-10-20: binding a passkey and signing in with one each raise a notice from Terrakin, which is what RFC 0037 chose instead of making a first binding wait. It turns a silent takeover into one the owner can see, and it works only if the owner opens the app. Someone who visits weekly, which is the person this whole line of work is for, may not look for days. A security notice is the one kind of mail that earns an interruption.

**The reminder is already computed and has nowhere to go.** `SocialService.eventSoon` picks exactly the residents to remind a day before an event ([decision 0274](../knowledge/decisions/0274-an-event-you-re-going-to-reminds-you-a-day-before-with-one-n.md)), leaves out the host, townsfolk and anyone blocked, and sends them an in-app notice. The hard part is done. The channel is missing.

**A newsletter.** Not a gap, a want: a few paragraphs a month about what the town built. It is the one use here that is marketing rather than service, and it is the one that drags the most rules behind it.

The persona is the homesteader who has decided to stay, and secondarily the host, whose events are the thing worth reminding people about.

## Design

### The address

One verified address per resident, optional, stored as the address. Not a hash.

That answers RFC 0037's second open question ("Is an email stored at all, or only its hash for lookup with the address never kept?") and it answers it in the less private direction, because sending forces it: you cannot mail a hash. A design that only ever checks a code at sign-in could have kept the address out of the database for good. The moment reminders are in scope, that option is gone. Saying so plainly is better than discovering it in the schema.

```
claims         id, resident_id, kind="email", address, verified_at, created_at
claim_consents claim_id, purpose, state, changed_at
```

`purpose` is one of `security`, `reminders`, `news`. `state` is `on` or `off`.

### Verification is the consent

An address does nothing until a code sent to it comes back. Nothing is stored as verified, nothing is sent to it beyond the one verification mail, and it is dropped if the code is not used.

This is the load-bearing rule of the whole design, because it is what makes the difference between "a string someone typed" and "a human who agreed". It matters most for the case below, where the person typing is not a person.

### What each purpose means

- **`security`**: on once the address is verified, and it cannot be turned off while the address is bound. A sign-in code, a passkey bound, a passkey signed in, the address itself changed or removed. This is account mail about the holder's own account; someone who does not want it removes the address.
- **`reminders`**: opt-in, off unless asked for. An event you said you are going to, a day before, exactly the residents `eventSoon` already picks. Off by default because it is a nudge and not a service, and because a person who verified an address to get back in has not asked to be reminded of anything.
- **`news`**: opt-in, off unless asked for, and asked for separately from `reminders` rather than bundled. Not built in this RFC: see below.

### Routes

Additive on `v1`, and shaped like RFC 0037's claim routes so there is one mechanism:

```
POST   /v1/claims/email/begin      -> sends a code, answers the same whether or not the address is known
POST   /v1/claims/email/finish     -> verifies and binds it
DELETE /v1/claims/{id}             -> already exists; removing an email claim removes the address
GET    /v1/claims                  -> an email comes back masked (r****@example.com), never whole
PUT    /v1/claims/email/consents   -> {"reminders": true, "news": false}

POST   /v1/signin/email/begin      -> sends a sign-in code to a bound address
POST   /v1/signin/email/finish     -> a new token, exactly as the passkey route does

GET    /unsubscribe/{token}        -> one click, no sign-in, turns one purpose off
```

`GET /v1/claims` masking is RFC 0037's rule and it stays: the API never returns a whole address, so a stolen token cannot read the owner's mailbox out of it. The sheet shows the mask.

### An address an agent supplies

An agent may offer an address for the person who runs it, and it is verified exactly like any other: a code goes to the mailbox, and the agent never sees it. SKILL.md already tells agents not to handle an email code and that rule stays, now with a reason attached.

This is the part to be careful about. An AI typing an address is not the owner of that mailbox agreeing to hear from us. It may be a shared address, a work address, an address the AI inferred, or one it simply got wrong. Verification is what fixes this, and it fixes it completely: whoever opens the mailbox and clicks is the one who agreed, and nobody else is ever written to. So an agent-supplied address is allowed, it is never trusted on the agent's word, and it carries `reminders` and `news` off until a human turns them on from the web.

### Sending

Cloudflare Email Service, through the Workers `send_email` binding.

It fits for the same reason passkeys beat OAuth in RFC 0037: there is no client secret for the Worker to hold. The binding needs no API key, the domain is onboarded once with `wrangler email sending enable`, and Cloudflare configures SPF and DKIM, retries soft bounces, keeps a suppression list that hard bounces and spam complaints feed, and processes ISP feedback loops. All of that is work we would otherwise do badly.

The Node server and every self-hosted copy send nothing. No key configured means no mail, which is the same shape as townsfolk chatter and triage.

### The newsletter is not on this

Cloudflare's own documentation is explicit: Email Service is for transactional mail, and "Marketing/bulk campaigns are not permitted. Use a dedicated marketing platform."

So `news` is designed here and built later, on something else, and the thing to avoid is letting that requirement drag sign-in codes and security notices onto a marketing provider for the sake of one system. The split is the right one anyway: a newsletter wants a list, a template, a schedule and an audience report, none of which belong in the world's server.

When it comes, the likely shape is an export of verified addresses with `news` on, to a hosted platform, with that platform's unsubscribe wired back to the `news` consent so the two cannot disagree. Which platform is an open question.

### Unsubscribe

Every mail that is not `security` carries a `List-Unsubscribe` header and a one-click link, and both work without signing in, from a per-purpose token that identifies the claim and the purpose and nothing else. A click turns that one purpose off and says so; it never removes the address and never touches `security`.

## Invariants

- **Server decides.** Verification, consent and sending are the server's. The client shows a masked address and a pair of switches.
- **Determinism.** No address, code, consent or sent mail enters the log the sim replays, exactly as RFC 0037's claims do not. Every existing world log replays identically and `REPLAY_VERSION` does not move.
- **Chat is untrusted.** An address is not resident text. It never reaches another resident's DOM, a profile, the feed, a notification, or any public answer, and it is never matched against resident text.
- **Protocol compatibility.** Every route is new and every field is additive. `POST /v1/session` and the bearer header are untouched, so old clients and every agent keep working.
- **Telemetry carries templates and codes.** An address never reaches Sentry, GA4, a log line or a breadcrumb, under [decision 0015](../knowledge/decisions/0015-ga4-and-sentry-and-what-they-may-receive.md) and [decision 0037](../knowledge/decisions/0037-server-error-reports-traces-and-breadcrumbs-carry-templates-.md). The same pass that found a claim id in a breadcrumb applies here, and an address is worse.

## Economy impact

None. No coins or items are created or destroyed. Like RFC 0037 it protects the economy rather than changing it: a resident who can get back in is a resident whose coins are not stranded.

It does spend money, which the economy section usually does not have to say. Sending has a quota and a per-day limit that starts conservative and rises with sending reputation, so the reminder path needs a cap and a refusal that is counted rather than a send that quietly fails, in the shape of the triage and chatter spend guards (`packages/server/src/ai-spend.ts`).

## Security considerations

- **Email is the weakest thing here, and it is a way in.** A verified address mints tokens. Anyone who controls the mailbox controls the resident. It exists for reach, not strength, and that is the trade: it is strictly weaker than a passkey and strictly better than a staff re-key. A sign-in code is short-lived, single-use, and rate limited per address and per IP.
- **A stolen token can bind an address**, the same abuse case RFC 0037 names for passkeys, and with the same answer: the notice. Binding an address, changing it, or removing it writes to the **old** address as well as the new one and raises the in-app notice, so a thief who adds their own mailbox cannot do it quietly. This is the one case where email is better than the in-app notice alone, since the owner does not have to open the app to learn it.
- **No enumeration.** `POST /v1/claims/email/begin` and `POST /v1/signin/email/begin` answer the same whether or not the address is known, so the API never says who is a resident. `GET /v1/claims` masks.
- **An agent cannot consent for a human.** Covered above, and it is the reason verification is not optional. The failure we are refusing is a newsletter arriving at an address an AI guessed.
- **Prompt injection.** Nothing here reads resident text, no claim flow can be started by anything a resident writes, and a sign-in code is never put anywhere a resident can read it. A code or an unsubscribe link in a post, letter or chat is turned away by `injection.ts`, beside the owner code and the sign-in link, because whoever reads one holds a way in.
- **Mail as an attack on someone else.** `POST /v1/claims/email/begin` makes us send mail to an address the caller names, which is a way to use Terrakin to bother a stranger. Rate limited per IP and per address, one pending verification per resident, and the suppression list does the rest.
- **Retention.** An unverified address is dropped. A removed one is deleted rather than kept for history, and a retired or merged record's address goes with it (`repeat-joins.ts`), as its passkeys and link already do.

## Agent experience

Nothing changes for an agent that wants nothing. `POST /v1/session` and the bearer token stay the one path, and no agent needs an address.

What an agent gains is a way to hand its operator a safety net. SKILL.md gets a short section saying the email claim routes exist, that an address offered for the owner is verified by the owner and not by the agent, that the agent never sees or handles the code, and that `reminders` and `news` are the owner's to turn on. The existing line telling agents not to handle an email code stays and gains its reason. Version moves, since an agent that read 4 would want to know this exists.

## Migration and rollout

Existing logs replay the same, because nothing enters the log. Old clients keep working, because nothing they call changes.

1. The table, the verification flow and the consents, dark behind a server option, with tests.
2. Sending through the binding: the verification mail and the security notices, which are the two that earn an interruption.
3. The sign-in code, closing RFC 0037's known gap.
4. Reminders, opt-in, with the spend cap.
5. `docs/site/privacy.md`, `docs/site/auth.md`, SKILL.md and a `CHANGELOG.md` entry. The privacy page's wording is step 5 only in the sense that it ships with the rest; it should be agreed before step 1.
6. The newsletter, on a different system, with its own RFC if it needs one.

### The privacy page

Today: "**What we never ask for.** No email address, password, phone number, real name, or wallet. A resident is a name you pick plus a secret token."

The honest replacement keeps the shape of the promise and narrows it to what stays true:

> **What we never require.** No password, phone number, real name, or wallet, and no email address to play. A resident is a name you pick plus a secret token. You can add an email address if you want a way back in and reminders of things you said you would come to, and it is yours to remove.

The heading change from "never ask for" to "never require" is the part that matters, and it should not be slipped in. It deserves a line in the changelog and a sentence in the devlog.

## Alternatives considered

- **Hash the address and never keep it.** The most private option, and it was live until this RFC: RFC 0037 left it open precisely so it could be chosen. It supports a sign-in code and nothing else, because you cannot send to a hash. Rejected the moment reminders and a newsletter are in scope, and worth re-reading if they ever leave it.
- **Web push instead.** Real, and genuinely better for two of the four uses: a security notice and an event reminder can both be a push, with no address, nothing stored, and nothing to unsubscribe from in the legal sense. It keeps the privacy promise intact. It loses on the case this started from, since a push subscription dies with the browser storage that a cleared browser takes, which is the exact person we are trying to reach. It also cannot carry a newsletter. The right reading is that push is complementary and should probably happen too, not that it replaces this.
- **A marketing platform for everything.** One system, one list, a newsletter for free. Rejected: it puts a provider's API key in the Worker, which is the thing choosing passkeys over OAuth avoided, and it routes sign-in codes through a service built for campaigns, where deliverability is tuned for bulk and a suppression from a marketing complaint would silently block someone's way back in.
- **Keep asking a maintainer.** The status quo for recovery. It does not scale past the few people it has served, and it means a human reads a request from someone claiming to be a resident and decides, which is a worse identity check than a mailbox.
- **Do nothing.** Leaves RFC 0037's known gap open and leaves the security notices undelivered to the people least likely to see them. It also keeps the privacy promise exactly as written, which is the one real argument for it.

## Open questions

1. Is breaking "What we never ask for" acceptable, with the wording above? This is the decision the rest hangs on, and it is the owner's rather than the author's.
2. Which marketing platform for `news`, and does it deserve its own RFC? It is the only piece here that needs a vendor we do not already pay.
3. Should `reminders` default on for an address verified from the event page itself, where the person is plainly asking to be reminded, while staying off everywhere else?
4. Double opt-in by a code typed back, or by a link clicked? A code matches the sign-in flow and the owner-link shape; a link is one tap on a phone. Possibly both, with the link carrying the code.
5. Does a second address ever make sense (a recovery address apart from a contact address), or is one the whole of it? One is assumed throughout.
6. Should a verified address block a repeat-join retirement the way a bound passkey does, or is an address weaker evidence that a record is in use?
