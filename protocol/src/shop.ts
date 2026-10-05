import {
  isShopWear,
  SHOP,
  SHOP_CATALOG,
  SHOP_SKUS,
  SHOP_WEAR,
  type ShopSku,
  skuName,
  WEAR_INFO,
  WEAR_SLOTS,
} from "@terrakin/sim";
import { z } from "zod";
import { CropKind, GoodKind, ShopSku as ShopSkuSchema } from "./schemas";
import { AuthorView } from "./social";

/**
 * The town shop (RFC 0008, phase 2) as the REST API shows it. The catalog and today's buy orders
 * are public. What you sold today, the wear you own, and your balance are yours alone.
 */

/** Something the town shop sells. */
export const ShopItemView = z.object({
  /** Send this as `sku` in `shop_buy`. */
  sku: ShopSkuSchema,
  name: z.string(),
  price: z.number().int(),
  section: z.enum(["decor", "wear", "garden", "pantry"]),
  /** Wear only: where it goes. Wear is one of a kind and yours for good. */
  slot: z.enum(WEAR_SLOTS).optional(),
});
export type ShopItemView = z.infer<typeof ShopItemView>;

/** What the town pays for something, on a day it's buying it. */
export const BuyOrderView = z.object({
  /** Send this as `item` in `sell_to_town`. */
  kind: z.union([GoodKind, CropKind]),
  name: z.string(),
  price: z.number().int(),
  /** The most the town buys from each resident today. */
  perDay: z.number().int(),
  /** With a token: how many more of these you can sell today. */
  left: z.number().int().optional(),
});
export type BuyOrderView = z.infer<typeof BuyOrderView>;

/** The numbers a client can show next to the shop. */
export const ShopRules = z.object({
  /** The most of one thing in a single `shop_buy` or `sell_to_town`. */
  countMax: z.number().int(),
  /** Kinds of made things and of produce the town buys each UTC day. */
  goodsPerDay: z.number().int(),
  producePerDay: z.number().int(),
  /** The town treasury's share of what you spend, in percent. The rest is retired. */
  treasuryShare: z.number().int().min(0).max(100),
});

export const SHOP_RULES = {
  countMax: SHOP.countMax,
  goodsPerDay: SHOP.goodsPerDay,
  producePerDay: SHOP.producePerDay,
  treasuryShare: SHOP.treasuryShare,
} as const;

/** Every sku, in catalog order, from the sim's data. */
export const SHOP_ITEMS: ShopItemView[] = SHOP_SKUS.map((sku: ShopSku) => ({
  sku,
  name: skuName(sku),
  price: SHOP_CATALOG[sku].price,
  section: SHOP_CATALOG[sku].section,
  ...(isShopWear(sku) ? { slot: WEAR_INFO[sku].slot } : {}),
}));

export const ShopYouView = z.object({
  balance: z.number().int(),
  /** Shop wear you own. Wear it with the `profile` action's `wear`. */
  wardrobe: z.array(z.enum(SHOP_WEAR)),
});

export const ShopView = z.object({
  /** Today, in UTC days since 1970-01-01. The buy orders change at midnight UTC. */
  day: z.number().int(),
  /** The townsfolk resident who keeps the shop, when they're around. */
  keeper: AuthorView.nullable(),
  items: z.array(ShopItemView),
  /** What the town buys today. */
  buying: z.array(BuyOrderView),
  /** The Commons tiles the shop stands on. */
  tiles: z.array(z.object({ x: z.number().int(), y: z.number().int() })),
});
export type ShopView = z.infer<typeof ShopView>;

export const ShopResponse = z.object({
  /** Null until the town shop opens in this world. */
  shop: ShopView.nullable(),
  /** You, with a token, once the shop is open. */
  you: ShopYouView.nullable(),
  rules: ShopRules,
});
export type ShopResponse = z.infer<typeof ShopResponse>;

/** The shop as `GET /v1/town` shows it: where it stands and what the town buys today. */
export const TownShopView = z.object({
  tiles: z.array(z.object({ x: z.number().int(), y: z.number().int() })),
  buying: z.array(BuyOrderView),
});
