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
import { itemRow, itemRows, kindPill, pageLayout } from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { api } from "./api";
import { savedToken } from "./net";
import { pageData, withOptional } from "./page-data";
import { balanceLine, coins } from "./purse";
import { aNamed, learnedLine, needsListLine, stackCount } from "./things";
import { failInto, notOpenCard, type View, type ViewContext } from "./view";

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

type Shop = NonNullable<ShopResponse["shop"]>;

/**
 * The shelves in the order they're shown, with what goes on each: a holiday's stock on a shelf of
 * its own, first, while it runs (RFC 0022); the Recipes shelf once recipes are learned here (RFC
 * 0024), whose cards the page lays out itself; then the four sections, without the holiday's
 * stock. Pure.
 */
export function shelvesOf(
  shop: Pick<Shop, "items" | "holiday" | "recipes">,
): { key: string; title: string; hint: string; items: ShopItemView[] }[] {
  return [
    ...(shop.holiday
      ? [
          {
            key: "holiday",
            title: `For ${holidayName(shop.holiday.id)}`,
            hint: holidayHint(shop.holiday.id, shop.holiday.lastDay),
            items: shop.items.filter((i) => i.holiday),
          },
        ]
      : []),
    ...(shop.recipes && shop.recipes.length > 0
      ? [{ key: "recipes", title: "Recipes", hint: "", items: [] }]
      : []),
    ...SHELVES.map(({ section, title, hint }) => ({
      key: section,
      title,
      hint,
      items: shop.items.filter((i) => i.section === section && !i.holiday),
    })),
  ];
}

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

type Holiday = NonNullable<ShopItemView["holiday"]>;

/** A holiday's name, or its id for a holiday this client doesn't know yet. */
const holidayName = (holiday: Holiday) =>
  Object.hasOwn(HOLIDAY_INFO, holiday) ? HOLIDAY_INFO[holiday].name : holiday;

/**
 * The small tag on seasonal or holiday stock: "This autumn" or "This winter" (RFC 0017), or the
 * holiday's name (RFC 0022). The server lists such stock only while it's sold, so the tag never
 * names another season. Everything sold all year has none. Pure.
 */
export function stockTag(item: Pick<ShopItemView, "season" | "holiday">): {
  text: string;
  tone: "sun" | "moss";
  className: "shop-season" | "shop-holiday";
} | null {
  if (item.season) return { text: seasonWords(item.season), tone: "sun", className: "shop-season" };
  if (item.holiday)
    return { text: holidayName(item.holiday), tone: "moss", className: "shop-holiday" };
  return null;
}

function tagOf(item: Pick<ShopItemView, "season" | "holiday">): HTMLElement | null {
  const tag = stockTag(item);
  return tag && kindPill(tag.text, tag.tone, tag.className);
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
  // The shelves in the main column; your purse and what the town buys today beside them.
  const { el, head, main, side } = pageLayout("shop-page", "Your purse and what the town buys");
  head.append(h("h1", { class: "page-title", text: "The town shop" }));
  let landed = false;
  const signedIn = savedToken() !== null;

  const act = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, { gone: loader.gone, after: loader.refresh });

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
      act(button, { type: "shop_buy", sku: item.sku }, `You bought ${aNamed(item.name)}.`),
    );
    const held = item.section === "wear" ? 0 : heldOf(inv?.inventory ?? null, item.sku);
    return h(
      "li",
      { class: "paper shop-item", attrs: { "data-sku": item.sku } },
      itemArt(item.sku, { size: 56 }),
      tagOf(item),
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
      tagOf(card),
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
      lines: [`${coins(order.price)} each, ${left}`, tagOf(order)],
      trail: signedIn ? sell : null,
    });
  }

  function paint(data: ShopResponse, inv: InventoryResponse | null) {
    const { shop, you } = data;
    if (!shop) {
      main.replaceChildren(notOpenCard("The shop isn't open yet"));
      side.replaceChildren();
      return;
    }
    side.replaceChildren(
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
    );
    main.replaceChildren(
      ...shelvesOf(shop).map(({ key, title, hint, items }) =>
        key === "recipes"
          ? shelf(
              "recipes",
              title,
              recipesHint(inv?.inventory?.recipePicks ?? 0),
              (shop.recipes ?? []).map((c) => cardItem(c, data, inv)),
            )
          : shelf(
              key,
              title,
              hint,
              items.map((i) => shelfItem(i, data, inv)),
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

  /**
   * One shelf. Only the Recipes shelf takes an id of its own (`recipes`), since `/shop#recipes`
   * lands on it; the rest have none to clash with anything else on the page.
   */
  function shelf(key: string, title: string, hint: string, items: HTMLLIElement[]) {
    return h(
      "section",
      {
        class: "stack shop-section",
        attrs: {
          ...(key === "recipes" ? { id: "recipes" } : {}),
          "aria-labelledby": `shop-${key}-title`,
        },
      },
      h("h2", { class: "section-title", attrs: { id: `shop-${key}-title` }, text: title }),
      h("p", { class: "hint", text: hint }),
      h("ul", { class: "stack plain-list shop-shelf" }, ...items),
    );
  }

  // Your things say what you can sell and what you already hold; the page shows without them.
  const loader = pageData({
    ask: () => withOptional(api.shop(), signedIn ? api.inventory() : null),
    paint: ([shop, inv]) => paint(shop, inv),
    fail: failInto(main),
  });
  return { el, ready: loader.ready, destroy: loader.leave };
}
