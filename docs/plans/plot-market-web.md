# Plan: the plot market on the web, and switching it on

RFC 0039, slice 3. Commits 1 to 10 of the order of work are built, dark ([decision 0365](../knowledge/decisions/0365-plots-past-the-first-are-only-bought-the-market-opens-with-i.md)); the optional `forSale` on the snapshot and the switch-on are left. The market must open before downtown fills (around mid November).

## What existed, and five gaps, now closed

The sim (`packages/sim/src/plot-market.ts`), `GET /v1/plot-market` (`plotMarketView` in `packages/server/src/plot-market.ts`), `listing` on `GET /v1/plots/{px}/{py}` only (the `/v1/plots` list is built once a minute and doesn't carry it), `plotSale` on the `list_plot` and `buy_plot` answers real or dry, `plotMarketOpen` on the snapshot, `plot_sold` in the mirror, the `plot_sold` notice and the `plot_listing` takedown words in `notifications-view.ts`, and the staff queue.

Each is closed: the cap rides on `open_plot_market` (gap 1), the switch is the server's `plotMarket` option with `POST /v1/test/open-plot-market` (gap 2), `worldProblem` says `plot_listed` in plain words (gap 3), the HUD asks the sim's `claimLimit` (gap 4), and the purse names every market line (gap 5).

1. **The cap can't change without a logged input.** `maxPlotsPerResident` lives in `state.config`, a world booted from a snapshot keeps it, and no command changes it. `open_plot_market` should carry the cap. No live log holds `open_plot_market`, so only `packages/sim/src/fixtures/plot-market-log.ts` and its pinned hash move.
2. **Nothing logs the switch.** No `plotMarket` option on `WorldService`, no `DAY_SWITCHES` entry, no `POST /v1/test/open-plot-market`, nothing on the Worker.
3. **A listed plot shows raw JSON in the world.** The sim's `plot_listed` words include `{"type": "unlist_plot", ...}` and `worldProblem` in `packages/client/src/things.ts` has no case for it.
4. **The HUD changes at switch-on.** `paintClaim` in `packages/client/src/world.ts` shows Claim plot while `owned < maxPlotsPerResident`, so at a cap of 3 every settled resident gets Claim plot back, and `claim` of a second plot is free.
5. **The purse reads plot coins as "Coins".** `lineLabel` in `packages/client/src/purse-view.ts` has no case for `plot_buy`, `plot_sale`, `plot_listing_fee`, nor the item market's `market_*` reasons.

## Where it appears, on a 375px phone

**A section of `/market`, reached at `/market#plots`**, not a new route, like `/shop#recipes` and `/town#jobs`. "Plots for sale" leads (few listings, and 200 item rows would bury them); the item section becomes "Things for sale".

Each listing is an `itemRow` in `itemRows`:

- lead: a `plotThumb` at about 48px when the world snapshot is in (`withOptional(worldApi.world())` only when there are listings), otherwise nothing;
- name: `plotTitles(listing, [listing.seller.name]).title`, as text only;
- lines: `${coins(price)} from` with `personLink(seller)`; "12 blocks and an upstairs. Listed 2 days ago." (`plural`, the sim's `relativeDayWords`); a "Go see it" link to `worldLinkPath({kind: "plot", px, py})`;
- trail: Buy from `listingAction` ("Buy for 400 coins" or "70 coins short", disabled), which opens the buy sheet, plus `reportMenu({kind: "plot_listing", ...})` on anyone else's listing.

"Your plots" under the listings, one row per owned plot: listed shows "For sale at 400 coins" and Take back (`confirmTwice`, "Tap again: the 25 coins aren't returned"); `canList` shows Sell; otherwise the server's `why`. Open with no listings: `emptyNote("No plots for sale", "When a resident lists a plot, it shows here. Claiming an empty plot is still free.")`. Signed out: no Buy, one hint "Join to buy a plot."

**Sheets**, in a new lazy `packages/client/src/plot-sale-sheet.ts`, each a `sheet()` with an `errorLine()`:

- Buy: sends `buy_plot` with `dry: true` on open (button "Checking…" via `whileBusy`), shows "Price" and "Your coins after" as plain `itemRow`s, the server's `note`, and "It's sold as it stands. Nothing on it changes until it sells." Then "Buy for 400 coins" behind `confirmTwice` ("Tap again to pay 400 coins"), sent with `actFromButton`, done words "The plot is yours." with a Go there.
- List: a price `coinField`, "Check the sale" sends `list_plot` dry, then shows "Listing costs now", "When it sells you get" (after the town's 5%) and "Your coins after", the `note` (first line when `clearsHearth`), and "List for 25 coins" behind `confirmTwice`. Done words "Your plot is for sale." Changing the price clears the receipt.

**The visit card** (`visit-card.ts`, `#visit-card` in `index.html`): a `#visit-sale` line "For sale: 400 coins" and a `#visit-buy` pill on someone else's listed plot. `show()` already reads `listing`. No Sell on the card (the HUD's 28% budget).

**Purse** `lineLabel`: `plot_buy` "A plot from {who}", `plot_sale` "A plot you sold", `plot_listing_fee` "Listing a plot", and the item market's three reasons.

**Later, optional:** `forSale: {price}` on the snapshot's plots so the map, `/visit` cards and the profile can show a sign without a request per plot.

## Reuse, and what moves into `packages/ui`

Reused as is: `pageLayout`, `itemRow`, `itemRows`, `sheet`, `openOverlay`, `closeOverlay`, `confirmTwice`, `whileBusy`, `errorLine`, `emptyNote`, `kindPill`, `moreMenu`, `personLink`, `plural`, `formatCount`, and in the client `coins`, `balanceLine`, `actFromButton`, `actProblem`, `worldApi`, `listingAction`, `plotTitles`, `plotThumb`, `visitPlot`, `worldLinkPath`, `reportMenu`.

Moves into `packages/ui` first (rule 11):

1. `landOnHash(hash, target)`, copied today in `shop-view.ts:406`, `circles-section.ts:80`, `jobs-section.ts:67`. Add its `HAND_BUILT` pattern.
2. `coinField({ id, max, value })`, hand-built six times (`bounties-view.ts:209`, `market-view.ts:265` and `:276`, `profile-view.ts:1236` and `:1339`, `town-view.ts:709`), with its two rules from `packages/client/src/style.css:3050-3060` into `base.css`. Add its `HAND_BUILT` pattern.

`listingAction` moves from `market-view.ts` into a pure `packages/client/src/market-words.ts` so both views import it without a cycle.

## The dark switch

`/market` asks `GET /v1/plot-market` beside `/v1/market` with `withOptional`. While dark the answer is `{plotMarket: null, you: null, rules}`, a few bytes with no reads, so the page draws no plots section, no "Your plots", no teaser. (This differs from the jobs rule on purpose, and gets a decision record.) The mirror gains `plotMarketOpen`, set from the snapshot and `plot_market_opened`, which also sets `config.maxPlotsPerResident`. A new `packages/client/src/api/plot-market.ts`, imported only by lazy modules.

## Refusal copy

One pure `plotMarketProblem(code, message, rules)` in a new `packages/client/src/plot-market.ts`. The sim's words pass through where they're plain; these are replaced:

| Code | When | Web says |
|---|---|---|
| `market_closed` | dark or stale page | "Plots aren't on sale yet." |
| `not_joined` | | "Join Terrakin to buy or sell a plot." |
| `not_eligible`, display | list | "Something is on display on that plot, and it stays whoever put it up. Take it down first." |
| `out_of_bounds` | | "That plot isn't there anymore. Open the market again." |
| `not_your_plot` | list | "You can only sell a plot you own." |
| `invalid_amount` | list | "A price is a whole number of coins from 1 to {priceMax}." |
| `plot_listed` | list | "This plot is already for sale. Take it back first to change its price." |
| `plot_listed`, frozen | build and the rest, in `worldProblem` | "This plot is for sale, so nothing on it changes until it sells. Its owner can take it back at the market." |
| `unknown_listing` | buy | "That plot isn't for sale anymore. Someone bought it, or its owner took it back." |
| `unknown_listing` | unlist | "That plot isn't for sale anymore." |
| `own_listing` | buy | "That's your own plot. Take it back from Your plots instead." |
| `plot_limit`, cap 1 | buy | "You already own a plot, and a resident owns one here." |
| `plot_limit`, cap above 1 | buy | "You already own {cap} plots, the most a resident can. Sell one first." |

Shown as the sim says them: townsfolk, island, hall, event and household `not_eligible`, `not_yet`, both `not_enough_coins`. The display refusal in `checkListPlot` drops its trailing "with take_down." in the sim (refusal words are never logged).

## Order of work

Each commit ships dark.

Commits 1 to 10 are done.

1. ui: `landOnHash`, three callers switched, pattern in `shared-components.test.ts`.
2. ui: `coinField`, six copies replaced, styles to `base.css`, pattern.
3. sim: drop "with take_down" from the display refusal.
4. sim and protocol: `open_plot_market {maxPlotsPerResident}`, never lowering the cap, setting `config` in the same input, `plot_market_opened` carrying it; fixture re-pinned; mirror reads it. `claim` and `settle` stay first-plot-only after the switch (question 1). Test in `plot-market.test.ts`: a second `claim` refused before the switch and after it, a first claim still free after it, a `buy_plot` of a second plot accepted after, refused at the fourth; break the guard once to see it red. Run the `reviewer` subagent.
5. server: `plotMarket` option, a `DAY_SWITCHES` entry after lands (due when the market is on, a land is open, and the plot market isn't), `POST /v1/test/open-plot-market` (loopback only). Test in `packages/server/src/plot-market.test.ts`. The Worker still doesn't set it.
6. client words: `plot-market.ts` (`plotMarketProblem`, `priceProblem`, `listingFacts`, `saleRows`, `ownPlotLine`), `market-words.ts`, the `worldProblem` case, the purse labels. Tests in the existing tables in `market.test.ts`, `things.test.ts`, `coins.test.ts`.
7. client: API module and the market section, mounted only when `plotMarket` isn't null. Seen by hand at 375x812.
8. client: the sheets.
9. client: `Mirror.plotMarketOpen` and the visit card. Mirror flag tested in `client.test.ts`.
10. e2e: one `test.step` at the end of the existing test in `e2e/market.spec.ts` (Mara lists, Nils buys, Mara's notice), with persona and support helpers and `pnpm persona settled --open-plot-market`. No new spec; split into a second serial test only if it passes 30 seconds, inside the 58-test budget.
11. Optional: `forSale` on the snapshot.
12. Switch-on.

Docs with 6 to 10: `packages/client/AGENTS.md`, `packages/server/AGENTS.md`, `e2e/AGENTS.md`, the RFC 0039 line in `docs/plans/README.md`, and a decision record for the web's shape.

## Switch-on checklist

The market and the cap of 3 go live in one push.

| # | Must be true | Who decides |
|---|---|---|
| 1 | The first island is open (`lands` on `GET /v1/world`) | nobody, watch it |
| 2 | Issue #98 is closed | done |
| 3 | Commits 1 to 10 on main, verify and e2e green, the copy seen on a phone | built; Ryan on his phone |
| 4 | The cap rises in the same logged input that opens the market, reviewed | the agent and the reviewer |
| 5 | `scripts/economy-sim.ts` rerun with plot sales and the flip test (claim free, wait 14 days, sell), median purse and treasury reported. The sim has no plot sales yet, so they're added to it first | the agent builds and runs it; Ryan accepts 25 coins and 14 days |
| 6 | Question 1 below answered, and built if it changes `claim` | done: option b, built |
| 7 | SKILL.md "Plots for sale" section (escrow, `buy_plot` only with the owner's go-ahead and the `price` they said yes to, untrusted plot names, the cap), version bump, CHANGELOG entry, `pnpm gen` | done, version 37; a switch-on entry still to write |
| 8 | `plotMarket: true` in `packages/server/cloudflare/worker.ts`, with its own decision record | Ryan says go |
| 9 | `scripts/deploy-smoke.ts` expects `plotMarketOpen` and a cap of 3 | the agent |
| 10 | Staff know the `plot_listing` report and takedown | Ryan |
| 11 | It is one way: the cap can't come back down once someone owns 3 | Ryan accepts |
| 12 | Close issue #88, update the plans page, a devlog post | the agent; Ryan sends anything out |

## Ryan's answers (2026-10-22)

Recorded in [decision 0365](../knowledge/decisions/0365-plots-past-the-first-are-only-bought-the-market-opens-with-i.md).

1. A second and third plot come only by `buy_plot`: `claim` and `settle` take a first plot and no other, before the switch and after it (option b).
2. The market opens in a push Ryan approves, not on its own.
3. Nothing about plots for sale shows anywhere while the market is off.
4. No "For sale" sign on the map yet: that's the optional `forSale` on the snapshot, later.
5. After a purchase the toast offers Go there, and the buyer's hearth stays where it is.
