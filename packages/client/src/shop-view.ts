/**
 * `/shop`: the town shop (RFC 0008). What it sells, your purse, and what the town buys today.
 * Prices, counts, and refusals all come from the server; this page only shows them and sends
 * `shop_buy` and `sell_to_town`. Once recipes are learned (RFC 0024), its Recipes shelf
 * (`/shop#recipes`) sells recipe cards, and takes free picks with `pick_recipe`.
 */
import type {
  Action,
  BuyOrderView,
  InventoryResponse,
  RecipeCardView,
  ShopItemView,
  ShopResponse,
} from "@terrakin/protocol";
import { cardOf, dayName, HOLIDAY_INFO } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { itemArt } from "@terrakin/ui/item-art";
import { personLink } from "@terrakin/ui/people";
import { itemRow, itemRows, kindPill, stateCard } from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { api } from "./api";
import { savedToken } from "./net";
import { balanceLine, coins } from "./purse";
import { learnedLine, needsListLine, stackCount } from "./things";
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

/** What a Buy button says for `price`, from what you can afford: the price, short, or Buy. */
function priceLabel(price: number, balance: number | null): { text: string; can: boolean } {
  if (balance === null) return { text: coins(price), can: false };
  if (balance < price) return { text: `${coins(price - balance)} short`, can: false };
  return { text: `Buy for ${coins(price)}`, can: true };
}

/** What a shelf item's button says, from what you hold and can afford. Pure, so tests pin it. */
export function buyLabel(
  item: Pick<ShopItemView, "price" | "section" | "sku">,
  balance: number | null,
  wardrobe: readonly string[],
): { text: string; can: boolean } {
  if (item.section === "wear" && wardrobe.includes(item.sku)) return { text: "Yours", can: false };
  return priceLabel(item.price, balance);
}

/**
 * What a recipe card's button says and sends (RFC 0024): "You know this", a free pick while you
 * have one, or Buy as for anything else. Pure, so tests pin it.
 */
export function cardLabel(
  card: Pick<RecipeCardView, "price" | "known">,
  balance: number | null,
  picks: number,
): { text: string; can: boolean; send?: "pick" | "buy" } {
  if (card.known) return { text: "You know this", can: false };
  if (picks > 0) return { text: "Free pick", can: true, send: "pick" };
  const label = priceLabel(card.price, balance);
  return label.can ? { ...label, send: "buy" } : label;
}

/** The Recipes shelf's hint: what a card is, and what a free pick is while you have one. */
export function recipesHint(picks: number): string {
  const what =
    "Learn one and it's yours for good: make it at any kitchen or workbench, yours or a neighbor's.";
  return picks > 0
    ? `${what} You have ${plural(picks, "free pick", "free picks")} left, so any card here is free.`
    : what;
}

/** How many the town would take from you now: what's left today, up to what you hold. */
export const sellable = (order: BuyOrderView, held: number) =>
  Math.max(0, Math.min(order.left ?? 0, held));

type Season = NonNullable<ShopItemView["season"]>;

/** What the season's tag says. The buying hint quotes it, so both come from here. */
const seasonWords = (season: Season) => `This ${season}`;

/**
 * The small "This autumn" or "This winter" tag on seasonal stock and buying (RFC 0017). The server
 * lists them only in their season, so the tag never names another one.
 */
function seasonTag(season: Season): HTMLElement {
  return kindPill(seasonWords(season), "sun", "shop-season");
}

type Holiday = NonNullable<ShopItemView["holiday"]>;

/**
 * The small "Halloween" tag on holiday stock (RFC 0022). The server lists it only while its
 * holiday runs. A holiday this client doesn't know yet is still tagged, by its id.
 */
function holidayTag(holiday: Holiday): HTMLElement {
  const name = Object.hasOwn(HOLIDAY_INFO, holiday) ? HOLIDAY_INFO[holiday].name : holiday;
  return kindPill(name, "moss", "shop-holiday");
}

/** What each holiday's shelf adds: that what you buy stays yours, and what a kitchen makes. */
const HOLIDAY_SHELF: Readonly<Record<string, string>> = {
  halloween: "Costumes and decor are yours for good, and a kitchen makes candy any day.",
  midwinter: "A kitchen makes candy canes any day, five from a bunch of herbs and a bag of sugar.",
};

/**
 * What a holiday's shelf says: when its stock goes, and what stays yours or a kitchen makes. A
 * holiday this client doesn't know yet gets the first part. Pure.
 */
export function holidayHint(holiday: string, lastDay: number): string {
  const more = Object.hasOwn(HOLIDAY_SHELF, holiday) ? ` ${HOLIDAY_SHELF[holiday]}` : "";
  return `Sold until ${dayName(lastDay)} (UTC).${more}`;
}

/** How many of a kind you hold: a stack's count, or how many made things of that kind. */
function heldOf(inv: InventoryResponse["inventory"], kind: string): number {
  if (!inv) return 0;
  return stackCount(inv.stacks, kind) || inv.goods.filter((g) => g.kind === kind).length;
}

export function shopView(ctx: ViewContext): View {
  ctx.setTitle("The town shop · Terrakin");
  const body = h("div", { class: "stack cards shop-body" });
  const el = h(
    "div",
    { class: "column stack cards page shop-page" },
    h("h1", { class: "page-title", text: "The town shop" }),
    body,
  );
  let destroyed = false;
  let landed = false;
  const signedIn = savedToken() !== null;

  const act = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, { gone: () => destroyed, after: load });

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
      item.season ? seasonTag(item.season) : item.holiday ? holidayTag(item.holiday) : null,
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

  /** A recipe card: what it makes, what that takes, where, and Buy, Free pick, or known. */
  function cardItem(card: RecipeCardView, data: ShopResponse, inv: InventoryResponse | null) {
    const picks = inv?.inventory?.recipePicks ?? 0;
    const label = cardLabel(card, data.you?.balance ?? null, picks);
    const button = h("button", {
      class: "pill-button shop-buy",
      attrs: { type: "button", "aria-label": `${label.text}: ${card.name}` },
      text: label.text,
    });
    button.disabled = !label.can;
    const recipe = cardOf(card.sku);
    const learned = recipe ? learnedLine(recipe, "bought") : "";
    button.addEventListener("click", () => {
      if (label.send === "pick" && recipe) {
        void act(button, { type: "pick_recipe", recipe }, learned);
      } else if (label.send === "buy") {
        void act(button, { type: "shop_buy", sku: card.sku, count: 1 }, learned);
      }
    });
    const station = card.recipe.station === "kitchen" ? "a kitchen" : "a workbench";
    return h(
      "li",
      { class: "paper shop-item shop-card-recipe", attrs: { "data-sku": card.sku } },
      itemArt(card.recipe.makes, { size: 56 }),
      card.season ? seasonTag(card.season) : null,
      h("span", { class: "shop-item-name", text: card.name }),
      h("span", { class: "shop-item-meta", text: `Uses ${needsListLine(card.recipe.needs)}` }),
      h("span", {
        class: "shop-item-meta",
        text: `At ${station}${card.known ? "" : `, ${coins(card.price)}`}`,
      }),
      card.season && card.lastDay !== undefined
        ? h("span", { class: "shop-item-meta", text: `Sold until ${dayName(card.lastDay)}` })
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
    return itemRow({
      className: "shop-order",
      attrs: { "data-kind": order.kind },
      lead: itemArt(order.kind, { size: 32 }),
      name: order.name,
      lines: [`${coins(order.price)} each, ${left}`, order.season ? seasonTag(order.season) : null],
      trail: signedIn ? sell : null,
    });
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
        { class: "stack paper card shop-card", attrs: { "aria-label": "The shop and your purse" } },
        shop.keeper
          ? h(
              "p",
              { class: "shop-keeper" },
              personLink(shop.keeper),
              h("span", {
                text: " keeps the shop. Most of what you spend is retired; a little goes to the town.",
              }),
            )
          : h("p", {
              class: "shop-keeper",
              text: "Most of what you spend is retired; a little goes to the town.",
            }),
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
        { class: "stack shop-section", attrs: { "aria-labelledby": "shop-buying-title" } },
        h("h2", {
          class: "section-title",
          attrs: { id: "shop-buying-title" },
          text: "The town buys today",
        }),
        itemRows(
          shop.buying.map((o) => buyingRow(o, inv)),
          { className: "shop-orders" },
        ),
        h(
          "p",
          { class: "hint" },
          "It buys different things each day, at midnight UTC",
          shop.buying.some((o) => o.season)
            ? `, and what's marked "${seasonWords(shop.season)}" every day until ${shop.season} ends`
            : "",
          ". Make something at a kitchen or a workbench to sell, or sell it to your neighbors in ",
          h("a", { attrs: { href: "/market" }, text: "the market" }),
          ".",
        ),
      ),
      // A holiday's stock on a shelf of its own, first, while it runs (RFC 0022).
      ...(shop.holiday
        ? [
            shelf(
              "holiday",
              `For ${Object.hasOwn(HOLIDAY_INFO, shop.holiday.id) ? HOLIDAY_INFO[shop.holiday.id].name : shop.holiday.id}`,
              holidayHint(shop.holiday.id, shop.holiday.lastDay),
              shop.items.filter((i) => i.holiday).map((i) => shelfItem(i, data, inv)),
            ),
          ]
        : []),
      // The Recipes shelf (RFC 0024), once recipes are learned here. `/shop#recipes` lands on it.
      ...(shop.recipes && shop.recipes.length > 0
        ? [
            shelf(
              "recipes",
              "Recipes",
              recipesHint(inv?.inventory?.recipePicks ?? 0),
              shop.recipes.map((c) => cardItem(c, data, inv)),
            ),
          ]
        : []),
      ...SHELVES.map(({ section, title, hint }) =>
        shelf(
          section,
          title,
          hint,
          shop.items
            .filter((i) => i.section === section && !i.holiday)
            .map((i) => shelfItem(i, data, inv)),
        ),
      ),
    );
    // A link to the Recipes shelf lands on it once, not again after every buy.
    if (!landed && location.hash === "#recipes") {
      landed = true;
      requestAnimationFrame(() =>
        el.querySelector<HTMLElement>("#recipes")?.scrollIntoView({ block: "start" }),
      );
    }
  }

  function shelf(id: string, title: string, hint: string, items: HTMLLIElement[]) {
    return h(
      "section",
      {
        class: "stack shop-section",
        attrs: { id, "aria-labelledby": `shop-${id}-title` },
      },
      h("h2", { class: "section-title", attrs: { id: `shop-${id}-title` }, text: title }),
      h("p", { class: "hint", text: hint }),
      h("ul", { class: "stack plain-list shop-shelf" }, ...items),
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
