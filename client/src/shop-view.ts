/**
 * `/shop`: the town shop (RFC 0008). What it sells, your purse, and what the town buys today.
 * Prices, counts, and refusals all come from the server; this page only shows them and sends
 * `shop_buy` and `sell_to_town`.
 */
import type {
  BuyOrderView,
  InventoryResponse,
  ShopItemView,
  ShopResponse,
} from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { itemArt } from "@terrakin/ui/item-art";
import { personLink } from "@terrakin/ui/people";
import { stateCard, toast, whileBusy } from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { savedToken } from "./net";
import { balanceLine, coins, refreshPurse } from "./purse";
import { stackCount } from "./things";
import { errorCard, type View, type ViewContext } from "./view";

type Section = ShopItemView["section"];

/** The shop's shelves, in the order they're shown. */
export const SHELVES: { section: Section; title: string; hint: string }[] = [
  {
    section: "decor",
    title: "For your plot",
    hint: "Place them from the build bar in the world. Take one back up and it's yours to place again.",
  },
  { section: "wear", title: "To wear", hint: "One of a kind, and yours for good." },
  { section: "garden", title: "Seeds", hint: "One planter each. A harvest gives a seed back." },
  {
    section: "pantry",
    title: "Pantry",
    hint: "For making more than the daily pantry gives.",
  },
];

/** What a shelf item's button says, from what you hold and can afford. Pure, so tests pin it. */
export function buyLabel(
  item: Pick<ShopItemView, "price" | "section" | "sku">,
  balance: number | null,
  wardrobe: readonly string[],
): { text: string; can: boolean } {
  if (item.section === "wear" && wardrobe.includes(item.sku)) return { text: "Yours", can: false };
  if (balance === null) return { text: coins(item.price), can: false };
  if (balance < item.price) return { text: `${coins(item.price - balance)} short`, can: false };
  return { text: `Buy for ${coins(item.price)}`, can: true };
}

/** How many the town would take from you now: what's left today, up to what you hold. */
export const sellable = (order: BuyOrderView, held: number) =>
  Math.max(0, Math.min(order.left ?? 0, held));

/** How many of a kind you hold: a stack's count, or how many made things of that kind. */
function heldOf(inv: InventoryResponse["inventory"], kind: string): number {
  if (!inv) return 0;
  return stackCount(inv.stacks, kind) || inv.goods.filter((g) => g.kind === kind).length;
}

export function shopView(ctx: ViewContext): View {
  ctx.setTitle("The town shop · Terrakin");
  const body = h("div", { class: "shop-body" });
  const el = h(
    "div",
    { class: "column page shop-page" },
    h("h1", { class: "page-title", text: "The town shop" }),
    body,
  );
  let destroyed = false;
  const signedIn = savedToken() !== null;

  async function act(
    button: HTMLButtonElement,
    action: Parameters<typeof api.act>[0],
    done: string,
  ): Promise<void> {
    const r = await whileBusy(button, () => api.act(action));
    if (destroyed) return;
    const problem = actProblem(r);
    toast(problem ?? done);
    if (problem) return;
    refreshPurse(true);
    await load();
  }

  function shelfItem(item: ShopItemView, data: ShopResponse, inv: InventoryResponse | null) {
    const balance = data.you?.balance ?? null;
    const label = buyLabel(item, balance, data.you?.wardrobe ?? []);
    const button = h("button", {
      class: "pill-button shop-buy",
      attrs: { type: "button", "aria-label": `${label.text}: ${item.name}` },
      text: label.text,
    });
    button.disabled = !label.can;
    button.addEventListener("click", () =>
      act(button, { type: "shop_buy", sku: item.sku }, `You bought ${item.name.toLowerCase()}.`),
    );
    const held = item.section === "wear" ? 0 : heldOf(inv?.inventory ?? null, item.sku);
    return h(
      "li",
      { class: "paper shop-item", attrs: { "data-sku": item.sku } },
      itemArt(item.sku, { size: 56 }),
      h("span", { class: "shop-item-name", text: item.name }),
      h("span", {
        class: "shop-item-meta",
        text: held > 0 ? `You have ${held}` : coins(item.price),
      }),
      item.section === "decor"
        ? h("a", {
            class: "shop-item-3d",
            attrs: { href: `/gallery/3d?item=${item.sku}` },
            text: "See it in 3D",
          })
        : null,
      signedIn ? button : null,
    );
  }

  function buyingRow(order: BuyOrderView, inv: InventoryResponse | null) {
    const held = heldOf(inv?.inventory ?? null, order.kind);
    const n = sellable(order, held);
    const sell = h("button", {
      class: "pill-button small shop-sell",
      attrs: { type: "button" },
      text: n > 1 ? `Sell ${n}` : "Sell",
    });
    sell.disabled = n === 0;
    sell.addEventListener("click", () =>
      act(
        sell,
        { type: "sell_to_town", item: order.kind, count: n },
        `Sold to the town for ${coins(order.price * n)}.`,
      ),
    );
    const left =
      order.left === undefined
        ? `up to ${order.perDay} each`
        : order.left === 0
          ? "sold out for you today"
          : `${order.left} more today${held > 0 ? `, you have ${held}` : ""}`;
    return h(
      "li",
      { class: "shop-order", attrs: { "data-kind": order.kind } },
      itemArt(order.kind, { size: 32 }),
      h(
        "span",
        { class: "shop-order-body" },
        h("span", { class: "shop-order-name", text: order.name }),
        h("span", { class: "shop-order-meta", text: `${coins(order.price)} each, ${left}` }),
      ),
      signedIn ? sell : null,
    );
  }

  function paint(data: ShopResponse, inv: InventoryResponse | null) {
    const { shop, you } = data;
    if (!shop) {
      body.replaceChildren(
        stateCard({ title: "The shop isn't open yet", body: "Check back soon." }),
      );
      return;
    }
    body.replaceChildren(
      h(
        "section",
        { class: "paper card shop-card", attrs: { "aria-label": "The shop and your purse" } },
        shop.keeper
          ? h(
              "p",
              { class: "shop-keeper" },
              personLink(shop.keeper),
              h("span", { text: " keeps the shop. Half of what you spend goes to the town." }),
            )
          : h("p", { class: "shop-keeper", text: "Half of what you spend goes to the town." }),
        you
          ? balanceLine(you.balance, "shop-balance")
          : h(
              "a",
              { class: "btn-primary", attrs: { href: "/#join" } },
              h("span", { text: "Join to shop" }),
              icon("arrow"),
            ),
      ),
      h(
        "section",
        { class: "shop-section", attrs: { "aria-labelledby": "shop-buying-title" } },
        h("h2", {
          class: "section-title",
          attrs: { id: "shop-buying-title" },
          text: "The town buys today",
        }),
        h("ul", { class: "shop-orders" }, ...shop.buying.map((o) => buyingRow(o, inv))),
        h("p", {
          class: "purse-hint",
          text: "It buys different things each day, at midnight UTC. Make something at a kitchen or a workbench to sell.",
        }),
      ),
      ...SHELVES.map(({ section, title, hint }) =>
        h(
          "section",
          { class: "shop-section", attrs: { "aria-labelledby": `shop-${section}-title` } },
          h("h2", { class: "section-title", attrs: { id: `shop-${section}-title` }, text: title }),
          h("p", { class: "purse-hint", text: hint }),
          h(
            "ul",
            { class: "shop-shelf" },
            ...shop.items.filter((i) => i.section === section).map((i) => shelfItem(i, data, inv)),
          ),
        ),
      ),
    );
  }

  async function load(): Promise<void> {
    const [shop, inv] = await Promise.all([
      api.shop(),
      signedIn ? api.inventory() : Promise.resolve(null),
    ]);
    if (destroyed) return;
    if (!shop.ok) {
      body.replaceChildren(errorCard(shop.message, () => void load()));
      return;
    }
    paint(shop.data, inv?.ok ? inv.data : null);
  }

  return {
    el,
    ready: load(),
    destroy() {
      destroyed = true;
    },
  };
}
