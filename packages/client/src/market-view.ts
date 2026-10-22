/**
 * `/market`: residents selling to residents (RFC 0008, phase 4). Plots for sale first, once the
 * world sells them (RFC 0039, `plot-market-section.ts`), then the things for sale, 200 at a time
 * with "Show more listings" after, your purse, and a form to list something you hold. Prices,
 * fees, and refusals come from the server; this page shows them and sends `list_item`,
 * `unlist_item`, and `buy_listing`, and anyone's listing but your own can be reported from its
 * "More" menu. Labels on made things and sellers' names are other residents' words: text nodes
 * only.
 */
import type {
  Action,
  InventoryResponse,
  ListingView,
  MarketResponse,
  PlotMarketResponse,
  ShopView,
  WorldSnapshot,
} from "@terrakin/protocol";
import {
  BUY_ORDERS,
  ITEM_INFO,
  type ItemKind,
  isShopSku,
  type SellKind,
  SHOP_CATALOG,
} from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { formatCount } from "@terrakin/ui/format";
import { thingPicture } from "@terrakin/ui/item-art";
import { personLink } from "@terrakin/ui/people";
import {
  coinField,
  confirmTwice,
  emptyNote,
  itemRow,
  itemRows,
  landOnHash,
  moreButton,
  pageLayout,
  toast,
} from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { inventoryApi } from "./api/inventory";
import { marketApi } from "./api/market";
import { plotMarketApi } from "./api/plot-market";
import { shopApi } from "./api/shop";
import { worldApi } from "./api/world";
import { listingAction } from "./market-words";
import { savedResidentId, savedToken } from "./net";
import { pageData, withOptional } from "./page-data";
import { plotMarketProblem } from "./plot-market";
import { drawsAPlot, plotMarketSection } from "./plot-market-section";
import { balanceLine, coins } from "./purse";
import { reportMenu } from "./report-sheet";
import { lotWords, thingName } from "./things";
import { failInto, notOpenCard, type View, type ViewContext } from "./view";

/**
 * A price to start the form at: what the town pays, else the shop's price, else the cheapest that
 * other sellers ask a thing (`asks`, from `asksFor`), else 3 a thing.
 */
export function suggestedPrice(
  kind: ItemKind,
  count: number,
  asks: readonly number[] = [],
): number {
  const each = Object.hasOwn(BUY_ORDERS, kind)
    ? BUY_ORDERS[kind as SellKind].price
    : isShopSku(kind)
      ? SHOP_CATALOG[kind].price
      : (asks[0] ?? 3);
  return Math.max(1, Math.round(each * count));
}

/**
 * What other sellers on the page ask for one of a kind, cheapest first. Your own listings don't
 * count.
 */
export function asksFor(
  kind: ItemKind,
  listings: readonly (Pick<ListingView, "kind" | "count" | "price"> & {
    seller: { id: string };
  })[],
  me: string | null,
): number[] {
  return listings
    .filter((l) => l.kind === kind && l.seller.id !== me && l.count > 0)
    .map((l) => l.price / l.count)
    .sort((a, b) => a - b);
}

const pluralOf = (kind: ItemKind) => ITEM_INFO[kind].plural.toLowerCase();

/** What `townLine` reads of `GET /v1/shop`: today's buy orders and what the shop sells today. */
export type TownShop = Pick<ShopView, "buying" | "items">;

/**
 * What the town does with a kind, from `GET /v1/shop`: buys it today (with its price, and `sell`
 * when the seller can still sell some there), buys it on other days, or never buys it, so the
 * market is the only place it sells. When the shop sells the kind today, its price is what a
 * neighbor could pay there instead. Null when the shop's answer isn't in.
 */
export function townLine(
  kind: ItemKind,
  shop: TownShop | null,
): { text: string; sell: boolean } | null {
  if (!shop) return null;
  const what = pluralOf(kind);
  const order = shop.buying.find((o) => o.kind === kind);
  if (order) {
    if (order.left === 0)
      return { text: `You've sold the town all the ${what} it takes from you today.`, sell: false };
    const left = order.left === undefined ? "" : `, ${order.left} more from you`;
    return {
      text: `The town buys ${what} today for ${coins(order.price)} each${left}. That pays now, where a listing waits for a neighbor.`,
      sell: true,
    };
  }
  const stocked = shop.items.find((i) => i.sku === kind);
  const someDays = Object.hasOwn(BUY_ORDERS, kind);
  const town = someDays
    ? `The town buys ${what} on some days, not today`
    : `The town never buys ${what}`;
  const text = stocked
    ? `${town}, and the shop sells them for ${coins(stocked.price)} each, so a neighbor won't pay more than that here.`
    : someDays
      ? `${town}.`
      : `${town}, so the market is where they find a new home.`;
  return { text, sell: false };
}

/**
 * What other sellers ask for a kind, a thing at a time (`asks`, from `asksFor`), so a price starts
 * from the market rather than from nothing.
 */
export function othersAsk(kind: ItemKind, asks: readonly number[]): string {
  if (asks.length === 0) return `Nobody else has ${pluralOf(kind)} listed right now.`;
  // A thing's price to a tenth of a coin, when a lot doesn't divide evenly.
  const low = Math.round(Math.min(...asks) * 10) / 10;
  const high = Math.round(Math.max(...asks) * 10) / 10;
  const range = low === high ? coins(low) : `${formatCount(low)} to ${coins(high)}`;
  return asks.length === 1
    ? `One other listing asks ${range} each.`
    : `${asks.length} other listings ask ${range} each.`;
}

/** "…" with Report, on listings that aren't yours. */
function listingMore(l: ListingView): HTMLElement {
  return reportMenu(
    { kind: "listing", id: l.id, label: "listing" },
    { id: `listing-more-${l.id}`, text: "Report listing" },
  );
}

/**
 * One listing as a row: the thing, who sells it, a button when there's something to do, and a
 * "More" menu to report it when it isn't yours.
 */
export function listingRow(
  l: ListingView,
  action: ReturnType<typeof listingAction>,
  onPress: (button: HTMLButtonElement) => void,
): HTMLLIElement {
  const label = l.goods?.find((g) => g.label)?.label;
  const maker = l.goods?.[0]?.maker;
  const lines: (string | Node | null)[] = [
    label ? `“${label}”` : null,
    h(
      "span",
      {},
      `${coins(l.price)} from `,
      personLink(l.seller),
      maker && maker.id !== l.seller.id ? h("span", { text: `, made by ${maker.name}` }) : null,
    ),
  ];
  let trail: HTMLButtonElement | null = null;
  if (action.kind !== "none") {
    trail = h("button", {
      class: "pill-button small market-act",
      attrs: { type: "button", "aria-label": `${action.text}: ${l.name}` },
      text: action.text,
    });
    trail.disabled = !action.can;
    const button = trail;
    // Paying is a second tap, so a stray one while scrolling a stall spends nothing.
    if (action.kind === "buy")
      confirmTwice(button, `Tap again to pay ${coins(l.price)}`, () => onPress(button));
    else button.addEventListener("click", () => onPress(button));
  }
  const more = action.kind === "take" ? null : listingMore(l);
  return itemRow({
    className: "market-listing",
    attrs: { "data-listing": l.id },
    // A piece shows its own picture; everything else its drawn one.
    lead: thingPicture({ kind: l.kind, ...l.goods?.[0] }, { size: 32 }),
    name: l.name,
    lines,
    trail: more ? h("span", { class: "cluster listing-trail" }, trail, more) : trail,
  });
}

/** What you hold, as choices for the Sell form: made things by id, stacks by kind with a count. */
function choices(
  inv: InventoryResponse["inventory"],
): { value: string; text: string; max: number; kind: ItemKind; stack: boolean }[] {
  if (!inv) return [];
  return [
    ...inv.goods.map((g) => ({
      value: g.id,
      text: g.label ? `${thingName(g.kind)} “${g.label}”` : thingName(g.kind),
      max: 1,
      kind: g.kind as ItemKind,
      stack: false,
    })),
    ...inv.stacks.map((s) => ({
      value: s.kind,
      text: `${thingName(s.kind)} (you have ${s.count})`,
      max: s.count,
      kind: s.kind as ItemKind,
      stack: true,
    })),
  ];
}

export function marketView(ctx: ViewContext): View {
  ctx.setTitle("The market · Terrakin");
  // What's for sale in the main column; your purse, the sell form, and anything taken down beside it.
  const { el, head, main, side } = pageLayout("market-page", "Your purse and selling", {
    sideLast: true,
  });
  head.append(h("h1", { class: "page-title", text: "The market" }));
  const signedIn = savedToken() !== null;
  const me = signedIn ? savedResidentId() : null;

  const act = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, { gone: loader.gone, after: loader.refresh });
  // A link to the plots for sale lands on them once.
  const land = landOnHash("#plots", () => main.querySelector("#plots"));

  function sellForm(
    data: MarketResponse,
    inv: InventoryResponse | null,
    shop: TownShop | null,
  ): HTMLElement {
    const you = data.you;
    if (!you) return h("p", { class: "hint", text: "Join to sell what you make." });
    if (!you.canList) return h("p", { class: "hint", text: you.why ?? "You can't list yet." });
    const options = choices(inv?.inventory ?? null);
    if (options.length === 0) {
      return h("p", {
        class: "hint",
        text: "You have nothing to sell yet. Grow, make, or buy something first.",
      });
    }
    const pick = h(
      "select",
      { class: "field-input", attrs: { id: "market-pick" } },
      ...options.map((o) => h("option", { attrs: { value: o.value }, text: o.text })),
    );
    const count = coinField({ id: "market-count", value: 1 });
    const price = coinField({ id: "market-price", max: data.rules.priceMax });
    const countRow = h(
      "div",
      { class: "coin-row" },
      h("label", { class: "field-label", attrs: { for: "market-count" }, text: "How many?" }),
      count,
    );
    const chosen = () => options.find((o) => o.value === pick.value) ?? options[0];
    // Where the picked thing sells: to the town today, or only here, and what others here ask.
    const advice = h("div", {
      class: "stack tight start market-advice",
      attrs: { id: "market-advice", "aria-live": "polite" },
    });
    const listed = data.market?.listings ?? [];
    const advise = (kind: ItemKind, asks: readonly number[]) => {
      const town = townLine(kind, shop);
      advice.replaceChildren(
        ...(town ? [h("p", { class: "field-hint market-town", text: town.text })] : []),
        ...(town?.sell
          ? [
              h(
                "a",
                {
                  class: "pill-button small market-to-town",
                  attrs: { href: "/shop", id: "market-to-town" },
                },
                h("span", { text: "Sell to the town" }),
                icon("arrow"),
              ),
            ]
          : []),
        h("p", { class: "field-hint market-others", text: othersAsk(kind, asks) }),
      );
    };
    /** The last price we suggested, so a price the seller typed is never overwritten. */
    let suggested = "";
    const sync = () => {
      const o = chosen();
      if (!o) return;
      const asks = asksFor(o.kind, listed, me);
      advise(o.kind, asks);
      countRow.hidden = !o.stack;
      const most = Math.min(o.max, data.rules.countMax);
      count.max = String(most);
      const n = Math.min(Math.max(1, Number(count.value) || 1), most);
      count.value = String(n);
      if (price.value === "" || price.value === suggested) {
        suggested = String(suggestedPrice(o.kind, n, asks));
        price.value = suggested;
      }
    };
    pick.addEventListener("change", sync);
    count.addEventListener("change", sync);
    sync();
    const submit = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit", id: "market-list" },
      text: `List for ${coins(data.rules.listingFee)}`,
    });
    const form = h(
      "form",
      { class: "stack tight paper card market-form", attrs: { novalidate: true } },
      h("label", { class: "field-label", attrs: { for: "market-pick" }, text: "What to sell" }),
      pick,
      advice,
      countRow,
      h("label", {
        class: "field-label",
        attrs: { for: "market-price" },
        text: "Price for all of it",
      }),
      h("div", { class: "coin-row" }, price, submit),
      h("p", {
        class: "field-hint",
        text: `Listing costs ${coins(data.rules.listingFee)}. It stays in the market until it sells or you take it back. ${data.rules.feePercent}% of a sale goes to the town.`,
      }),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const o = chosen();
      const p = Number(price.value);
      const n = Number(count.value);
      if (!o) return;
      if (!Number.isInteger(p) || p < 1) {
        toast("A price is a whole number of coins, at least 1.");
        price.focus();
        return;
      }
      void act(
        submit,
        {
          type: "list_item",
          item: o.value,
          price: p,
          ...(o.stack ? { count: n } : {}),
        },
        "It's in the market.",
      );
    });
    return form;
  }

  function paint(
    data: MarketResponse,
    inv: InventoryResponse | null,
    shop: TownShop | null,
    plots: PlotMarketResponse | null,
    world: WorldSnapshot | null,
  ) {
    const { market, you } = data;
    if (!market) {
      main.replaceChildren(notOpenCard("The market isn't open yet"));
      side.replaceChildren();
      return;
    }
    const balance = you?.balance ?? null;
    const row = (l: ListingView) => {
      const action = listingAction(l, me, balance);
      return listingRow(l, action, (button) =>
        action.kind === "take"
          ? void act(button, { type: "unlist_item", listing: l.id }, "It's back in your things.")
          : void act(
              button,
              { type: "buy_listing", listing: l.id },
              `You bought ${lotWords(l.kind, l.count)}.`,
            ),
      );
    };
    const rows = market.listings.map(row);
    const list = itemRows(rows, { className: "market-listings" });
    let next = market.next;
    const more = moreButton("Show more listings", async () => {
      if (!next) return;
      const r = await marketApi.market({ before: next });
      if (loader.gone()) return;
      if (!r.ok) return r.message;
      list.append(...(r.data.market?.listings ?? []).map(row));
      next = r.data.market?.next ?? null;
      more.el.hidden = next === null;
    });
    more.el.hidden = next === null;
    const held = (you?.takenDown ?? []).map((l) =>
      listingRow(
        l,
        { kind: "take", text: "Take back", can: true },
        (button) =>
          void act(button, { type: "unlist_item", listing: l.id }, "It's back in your things."),
      ),
    );
    side.replaceChildren(
      h(
        "section",
        {
          class: "stack paper card market-card",
          attrs: { "aria-label": "The market and your purse" },
        },
        h("p", {
          class: "hint",
          text: "Residents sell what they grow and make to each other here. A little of each sale goes to the town.",
        }),
        you
          ? balanceLine(you.balance, "market-balance")
          : h(
              "a",
              { class: "btn-primary", attrs: { href: "/#join" } },
              h("span", { text: "Join to buy and sell" }),
              icon("arrow"),
            ),
      ),
      ...(held.length > 0
        ? [
            h(
              "section",
              {
                class: "stack market-section",
                attrs: { "aria-labelledby": "market-held-title" },
              },
              h("h2", {
                class: "section-title",
                attrs: { id: "market-held-title" },
                text: "Taken down",
              }),
              h("p", {
                class: "hint",
                text: "Staff took these out of the market while your things were full. Make room, then take them back.",
              }),
              itemRows(held, { className: "market-listings market-held" }),
            ),
          ]
        : []),
      ...(signedIn
        ? [
            h(
              "section",
              { class: "stack market-section", attrs: { "aria-labelledby": "market-sell-title" } },
              h("h2", {
                class: "section-title",
                attrs: { id: "market-sell-title" },
                text: "Sell something",
              }),
              sellForm(data, inv, shop),
            ),
          ]
        : []),
    );
    const plotSection = plots
      ? plotMarketSection(plots, {
          me,
          world,
          moves: {
            unlist: (button, at) =>
              void actFromButton(
                button,
                { type: "unlist_plot", px: at.px, py: at.py },
                "Your plot is yours again, and off the market.",
                {
                  gone: loader.gone,
                  after: loader.refresh,
                  words: (code, message) => plotMarketProblem(code, message, plots.rules, "unlist"),
                },
              ),
          },
        })
      : null;
    main.replaceChildren(
      ...(plotSection ? [plotSection] : []),
      h(
        "section",
        { class: "stack market-section", attrs: { "aria-labelledby": "market-sale-title" } },
        h("h2", {
          class: "section-title",
          attrs: { id: "market-sale-title" },
          // Beside plots for sale, these are the things; alone, just what's for sale.
          text: plotSection ? "Things for sale" : "For sale",
        }),
        ...(rows.length > 0
          ? [list, h("div", { class: "feed-foot" }, more.el)]
          : [emptyNote("Nothing for sale yet", "Be the first: list something you grew or made.")]),
      ),
    );
    land();
  }

  // Your things say what you can sell, the shop what the town buys today, and the plot market
  // whether plots are for sale; the page shows without any of them. The world snapshot draws the
  // plots, so it's asked for only when there's a plot to draw.
  const loader = pageData({
    ask: async () => {
      const first = await withOptional(
        withOptional(
          withOptional(marketApi.market(), signedIn ? inventoryApi.inventory() : null),
          signedIn ? shopApi.shop() : null,
        ),
        plotMarketApi.plotMarket(),
      );
      const plots = first.ok ? first.data[1] : null;
      return withOptional(
        Promise.resolve(first),
        plots && drawsAPlot(plots) ? worldApi.world() : null,
      );
    },
    paint: ([[[[market, inv], shop], plots], world]) =>
      paint(market, inv, shop?.shop ?? null, plots, world),
    fail: failInto(main),
  });
  return { el, ready: loader.ready, destroy: loader.leave };
}

/**
 * A resident's stall on their profile: what they have for sale, with Buy (or Take back on your
 * own), and a link to the whole market. Null when they're selling nothing or the market is closed.
 */
export async function stallCard(seller: { id: string; name: string }): Promise<HTMLElement | null> {
  const res = await marketApi.market({ seller: seller.id });
  if (!res.ok || !res.data.market || res.data.market.listings.length === 0) return null;
  const me = savedToken() ? savedResidentId() : null;
  const balance = res.data.you?.balance ?? null;
  const card = h("section", {
    class: "stack paper card stall-card",
    attrs: { "aria-labelledby": "stall-title" },
  });
  const act = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, {
      after: async () => {
        const next = await stallCard(seller);
        if (next) card.replaceWith(next);
        else card.remove();
      },
    });
  const rows = res.data.market.listings.map((l) => {
    const action = listingAction(l, me, balance);
    return listingRow(l, action, (button) =>
      action.kind === "take"
        ? void act(button, { type: "unlist_item", listing: l.id }, "It's back in your things.")
        : void act(
            button,
            { type: "buy_listing", listing: l.id },
            `You bought ${lotWords(l.kind, l.count)}.`,
          ),
    );
  });
  card.append(
    h("h2", {
      class: "section-title",
      attrs: { id: "stall-title" },
      text: `${seller.name}'s stall`,
    }),
    itemRows(rows, { className: "market-listings" }),
    h("a", {
      class: "pill-button small",
      attrs: { href: "/market" },
      text: "See the whole market",
    }),
  );
  return card;
}
