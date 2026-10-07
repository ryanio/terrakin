/**
 * `/market`: residents selling to residents (RFC 0008, phase 4). What's for sale, 200 at a time
 * with "Show more listings" after, your purse, and a form to list something you hold. Prices,
 * fees, and refusals come from the server; this page shows them and sends `list_item`,
 * `unlist_item`, and `buy_listing`, and anyone's listing but your own can be reported from its
 * "More" menu. Labels on made things and sellers' names are other residents' words: text nodes
 * only.
 */
import type { Action, InventoryResponse, ListingView, MarketResponse } from "@terrakin/protocol";
import { BUY_ORDERS, type ItemKind, isShopSku, type SellKind, SHOP_CATALOG } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { thingPicture } from "@terrakin/ui/item-art";
import { personLink } from "@terrakin/ui/people";
import {
  confirmTwice,
  emptyNote,
  itemRow,
  itemRows,
  moreButton,
  stateCard,
  toast,
} from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { api } from "./api";
import { savedResidentId, savedToken } from "./net";
import { balanceLine, coins } from "./purse";
import { reportMenu } from "./report-sheet";
import { thingName } from "./things";
import { errorCard, type View, type ViewContext } from "./view";

/** A price to start the form at: what the town pays, else the shop's price, else 3 a thing. */
export function suggestedPrice(kind: ItemKind, count: number): number {
  const each = Object.hasOwn(BUY_ORDERS, kind)
    ? BUY_ORDERS[kind as SellKind].price
    : isShopSku(kind)
      ? SHOP_CATALOG[kind].price
      : 3;
  return Math.max(1, each * count);
}

/**
 * What a listing's button does for the viewer: buy it, take it back (their own), or nothing
 * (signed out). Pure, so tests pin it.
 */
export function listingAction(
  l: Pick<ListingView, "price"> & { seller: { id: string } },
  viewerId: string | null,
  balance: number | null,
): { kind: "buy" | "take" | "none"; text: string; can: boolean } {
  if (viewerId === null || balance === null) return { kind: "none", text: "", can: false };
  if (l.seller.id === viewerId) return { kind: "take", text: "Take back", can: true };
  if (balance < l.price)
    return { kind: "buy", text: `${coins(l.price - balance)} short`, can: false };
  return { kind: "buy", text: `Buy for ${coins(l.price)}`, can: true };
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
  const body = h("div", { class: "stack cards market-body" });
  const el = h(
    "div",
    { class: "column stack cards page market-page" },
    h("h1", { class: "page-title", text: "The market" }),
    body,
  );
  let destroyed = false;
  const signedIn = savedToken() !== null;
  const me = signedIn ? savedResidentId() : null;

  const act = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, { gone: () => destroyed, after: load });

  function sellForm(data: MarketResponse, inv: InventoryResponse | null): HTMLElement {
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
    const count = h("input", {
      class: "field-input coin-amount",
      attrs: {
        id: "market-count",
        type: "number",
        inputmode: "numeric",
        min: 1,
        step: 1,
        value: "1",
      },
    });
    const price = h("input", {
      class: "field-input coin-amount",
      attrs: {
        id: "market-price",
        type: "number",
        inputmode: "numeric",
        min: 1,
        max: data.rules.priceMax,
        step: 1,
      },
    });
    const countRow = h(
      "div",
      { class: "coin-row" },
      h("label", { class: "field-label", attrs: { for: "market-count" }, text: "How many?" }),
      count,
    );
    const chosen = () => options.find((o) => o.value === pick.value) ?? options[0];
    /** The last price we suggested, so a price the seller typed is never overwritten. */
    let suggested = "";
    const sync = () => {
      const o = chosen();
      if (!o) return;
      countRow.hidden = !o.stack;
      const most = Math.min(o.max, data.rules.countMax);
      count.max = String(most);
      const n = Math.min(Math.max(1, Number(count.value) || 1), most);
      count.value = String(n);
      if (price.value === "" || price.value === suggested) {
        suggested = String(suggestedPrice(o.kind, n));
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

  function paint(data: MarketResponse, inv: InventoryResponse | null) {
    const { market, you } = data;
    if (!market) {
      body.replaceChildren(
        stateCard({ title: "The market isn't open yet", body: "Check back soon." }),
      );
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
              `You bought ${l.name.toLowerCase()}.`,
            ),
      );
    };
    const rows = market.listings.map(row);
    const list = itemRows(rows, { className: "market-listings" });
    let next = market.next;
    const more = moreButton("Show more listings", async () => {
      if (!next) return;
      const r = await api.market({ before: next });
      if (destroyed) return;
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
    body.replaceChildren(
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
      h(
        "section",
        { class: "stack market-section", attrs: { "aria-labelledby": "market-sale-title" } },
        h("h2", { class: "section-title", attrs: { id: "market-sale-title" }, text: "For sale" }),
        ...(rows.length > 0
          ? [list, h("div", { class: "feed-foot" }, more.el)]
          : [emptyNote("Nothing for sale yet", "Be the first: list something you grew or made.")]),
      ),
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
              sellForm(data, inv),
            ),
          ]
        : []),
    );
  }

  async function load(): Promise<void> {
    const [market, inv] = await Promise.all([
      api.market(),
      signedIn ? api.inventory() : Promise.resolve(null),
    ]);
    if (destroyed) return;
    if (!market.ok) {
      body.replaceChildren(errorCard(market.message, () => void load()));
      return;
    }
    paint(market.data, inv?.ok ? inv.data : null);
  }

  return {
    el,
    ready: load(),
    destroy() {
      destroyed = true;
    },
  };
}

/**
 * A resident's stall on their profile: what they have for sale, with Buy (or Take back on your
 * own), and a link to the whole market. Null when they're selling nothing or the market is closed.
 */
export async function stallCard(seller: { id: string; name: string }): Promise<HTMLElement | null> {
  const res = await api.market({ seller: seller.id });
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
            `You bought ${l.name.toLowerCase()}.`,
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
