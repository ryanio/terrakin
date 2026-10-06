# admin/

The staff app at admin.terrakin.org: the review queue, AI triage's suggestions, and the moderation log ([RFC 0006](../docs/rfcs/0006-trust-and-safety.md), [decision 0040](../docs/knowledge/decisions/0040-a-staff-app-on-its-own-host-behind-cloudflare-access-with-st.md)). It shows what the staff routes answer and decides nothing; the server checks every action.

## Rules

- **Resident text is text.** Reported content, names, report notes, and triage rationales (which can quote residents) reach the DOM only through `h()` from `@terrakin/ui/dom` or `textContent`. Never `innerHTML`, `insertAdjacentHTML`, or a template string into markup.
- **Nothing inline, nothing from elsewhere.** The admin host sends `ADMIN_PAGE_HEADERS` (`server/src/pages.ts`): scripts, styles, fonts, and requests from the same origin only. No inline `<script>`, no `style` attributes, no `data:` fonts, no third-party script, font, or endpoint. No analytics and no error reporting here.
- **Same host, relative paths.** Every call goes to `/v1/admin/...` on the host the app came from, parsed with the protocol schemas (`src/api.ts`). On admin.terrakin.org, Cloudflare Access signs staff in and the Worker passes the email on; the app sends no credentials. Where Access isn't set up, staff paste a resident token, kept in sessionStorage for the tab.
- **Suggestions stay suggestions.** Triage's verdict is shown next to the content and never applied, prefilled, or preselected. A person picks the action and writes the reason.
- **Roles are the server's.** `src/logic.ts` decides what to offer (moderators see suspensions of up to 7 days), but hiding a button is a courtesy; the server refuses anyway.
- **Phone first.** Test at 390x844. Tap targets at least 44px, inputs at 16px or more, `env(safe-area-inset-*)` respected. Pictures under review load blurred until tapped.
- **What can't be undone takes two taps.** Deleting files (hiding a post, deleting profile pictures or a piece's picture), taking a listing or a display down, and suspending ask again first (`confirm` in `itemActions`).
- **Pure logic is tested.** Anything that decides (actions per item and role, limits, labels, routes) lives in `src/logic.ts` with `src/logic.test.ts`. The flow is covered by `e2e/safety.spec.ts` on `admin.localhost`.

## Where things are

- `index.html` the static shell. `src/jitless.ts`, imported first, keeps zod from probing `new Function`, which the admin host's policy forbids. `src/main.ts` boots: asks `GET /v1/admin/overview` who is signed in, then routes `/` (queue) and `/log`; it also shows the token sign-in and the staff-only screen.
- `src/queue-view.ts` the queue: items grouped by target, the author's record, reports (the first two, the rest folded), triage's suggestion (its rationale folded), and the reason, suspend length, and action buttons. A reported listing still in the market offers "Take down listing" (two taps), which sends the lot back to its seller. A reported thing still on display (a `display` report, or a `piece` report while it's up) offers "Take off display", and a reported piece that still shows a picture offers "Delete picture", which deletes the upload everywhere; both take two taps and link to the profile of whoever put it up, or the maker. Every action that takes down something a resident owns (`TAKEDOWN_ACTIONS`: hide, delete pictures, take down a listing, take off display, delete a piece's picture) also shows "Rule broken", the rule its owner's takedown notice names. It starts on the rule most residents' reports named (`defaultRule`, never triage's), so the usual case stays a reason and two taps; the log shows it as "Rule told to them" ([decision 0064](../docs/knowledge/decisions/0064-staff-takedowns-send-their-owner-a-notice-from-terrakin-nami.md)).
- `src/log-view.ts` the moderation log, paged with `before`, grouped under day headings.
- `src/bounties-view.ts` `/bounties`, maintainers only ([decision 0062](../docs/knowledge/decisions/0062-a-maintainer-confirms-town-bounties-and-bounties-and-grants-.md)): town bounties waiting for a maintainer to confirm (which pays the claimant from the treasury's coins the bounty holds) and every other running bounty, any of which can be cancelled with a reason. Both take two taps. A reported bounty in the queue offers Cancel bounty to maintainers. `bountyActions` and `screensFor` in `src/logic.ts` decide what to offer.
- `src/api.ts` the staff routes. `src/logic.ts` pure decisions and wording. `src/view.ts` the button and outbound link helpers, and `actorName`, which names who did something (a staff sign-in shows as the part of its email before the "@", full email on hover); use it wherever an actor appears. `src/style.css` the staff app's own styles, on top of `@terrakin/ui/tokens.css` and `base.css`. State cards, people, times, fields, and the toast come from `@terrakin/ui` with their styles ([ui/AGENTS.md](../ui/AGENTS.md)); don't copy them here.
- `vite.config.ts` builds into `client/dist/_admin/` with base `/_admin/`, after the client build (`pnpm build` runs both). Nothing is inlined.

## Running

- `pnpm dev` from the root starts the server, the client, and this app. Open http://admin.localhost:5174. Vite proxies `/v1` and `/media` to `TERRAKIN_SERVER` (default `http://localhost:8787`) and keeps the Host and Origin headers, so staff routes accept the calls.
- `pnpm start` serves the built app at http://admin.localhost:8787 from the Node server.
- Sign in with the token of a resident listed in `TERRAKIN_MAINTAINERS` or `TERRAKIN_MODERATORS` on the server you started.
