/**
 * The looks catalog (RFC 0005, section 1): themes, patterns, and things to wear. Plain data shared
 * by the sim (which validates a look), the protocol (which lists the choices), and the client
 * (which draws them). Colors here are presentation only: no rule ever reads them.
 */

import type { ResidentColor } from "./types";

/** Roles a theme's colors play when a resident or their plot is drawn. */
export interface ThemePalette {
  /** Clothes: the body of the figure. */
  main: string;
  /** Pattern motifs and small details (a hat band, a scarf). */
  accent: string;
  /** Trim, shade, and darker wear (a beret, overalls). */
  deep: string;
  /** Highlights, stripes, aprons, and themed wood. */
  light: string;
  /** The tint laid over the resident's plot. */
  ground: string;
}

export const THEMES = [
  "lemon",
  "berry",
  "ocean",
  "forest",
  "sunset",
  "night",
  "candy",
  "autumn",
  "meadow",
  "rose_garden",
  "lavender",
  "frost",
] as const;
export type Theme = (typeof THEMES)[number];

/** `plain` means no motif. Every other pattern is a small repeating tile. */
export const PATTERNS = [
  "plain",
  "dots",
  "stripes",
  "gingham",
  "florals",
  "citrus",
  "stars",
  "waves",
  "hearts",
  "leaves",
] as const;
export type Pattern = (typeof PATTERNS)[number];

/** Slots, in drawing and sorting order. New slots go on the end, so older wear lists sort the same. */
export const WEAR_SLOTS = ["hat", "top", "accessory", "bottom", "feet"] as const;
export type WearSlot = (typeof WEAR_SLOTS)[number];

export const WEAR_ITEMS = [
  "straw_hat",
  "beret",
  "flower_crown",
  "beanie",
  "apron",
  "scarf",
  "cardigan",
  "overalls",
  "basket",
  "satchel",
  "glasses",
  "bow",
  "top_hat",
  "raincoat",
  "umbrella",
  "dress",
  "skirt",
  "trousers",
  "shorts",
  "socks",
  "boots",
  "sneakers",
  "muse_halo",
  "muse_lantern",
] as const;
export type WearItem = (typeof WEAR_ITEMS)[number];

/**
 * Wear sold at the town shop (RFC 0008). The rest stays free. Wearing one of these takes having
 * bought it, and once bought it's yours for good.
 */
export const SHOP_WEAR = ["top_hat", "raincoat", "umbrella"] as const satisfies readonly WearItem[];
export type ShopWear = (typeof SHOP_WEAR)[number];
export const isShopWear = (w: unknown): w is ShopWear =>
  typeof w === "string" && (SHOP_WEAR as readonly string[]).includes(w);

/**
 * Partner wear (RFC 0007): only residents the server entitled with `set_entitlements` may put it on,
 * and it comes off when the entitlement goes. Cosmetic only. Never sold, given, or traded.
 */
export const EXCLUSIVE_WEAR = ["muse_halo", "muse_lantern"] as const satisfies readonly WearItem[];
export type ExclusiveWear = (typeof EXCLUSIVE_WEAR)[number];
export const isExclusiveWear = (w: unknown): w is ExclusiveWear =>
  typeof w === "string" && (EXCLUSIVE_WEAR as readonly string[]).includes(w);

/** One item per slot, so at most this many at once. */
export const MAX_WEAR = WEAR_SLOTS.length;

export interface ThemeInfo {
  label: string;
  palette: ThemePalette;
  /** The pattern that suits it, also the motif on themed blocks. */
  motif: Exclude<Pattern, "plain">;
}

/**
 * Curated palettes, picked to sit well on the storybook world (cream paper, sage grass, clay roofs).
 * See decision 0029 for why themes are curated and custom art comes in as uploads.
 */
export const THEME_INFO: Record<Theme, ThemeInfo> = {
  lemon: {
    label: "Lemon",
    motif: "citrus",
    palette: {
      main: "#f6d55c",
      accent: "#7fa94c",
      deep: "#d9982b",
      light: "#fff4c7",
      ground: "#f3df7e",
    },
  },
  berry: {
    label: "Berry",
    motif: "dots",
    palette: {
      main: "#c94f74",
      accent: "#5d3a78",
      deep: "#8c2b4a",
      light: "#f8d6df",
      ground: "#e6a2b6",
    },
  },
  ocean: {
    label: "Ocean",
    motif: "waves",
    palette: {
      main: "#5598c7",
      accent: "#f6f1e3",
      deep: "#2f5f87",
      light: "#d5ebf5",
      ground: "#9ccbe2",
    },
  },
  forest: {
    label: "Forest",
    motif: "leaves",
    palette: {
      main: "#6a8d4c",
      accent: "#c8e0a0",
      deep: "#3d5a2f",
      light: "#e3edcc",
      ground: "#8fb36a",
    },
  },
  sunset: {
    label: "Sunset",
    motif: "stripes",
    palette: {
      main: "#ef8f5e",
      accent: "#f6c453",
      deep: "#b4532f",
      light: "#ffe1bd",
      ground: "#f2b48c",
    },
  },
  night: {
    label: "Night sky",
    motif: "stars",
    palette: {
      main: "#46528a",
      accent: "#f6d978",
      deep: "#262e57",
      light: "#cdd5f3",
      ground: "#8a92c4",
    },
  },
  candy: {
    label: "Candy",
    motif: "hearts",
    palette: {
      main: "#f5abc9",
      accent: "#e0577f",
      deep: "#c24d7c",
      light: "#fff0f6",
      ground: "#f6c6da",
    },
  },
  autumn: {
    label: "Autumn",
    motif: "leaves",
    palette: {
      main: "#c97a3d",
      accent: "#ecbb45",
      deep: "#7c3f22",
      light: "#f7dfb8",
      ground: "#dba56b",
    },
  },
  meadow: {
    label: "Meadow",
    motif: "florals",
    palette: {
      main: "#9fcb6e",
      accent: "#f7dc6a",
      deep: "#5c873b",
      light: "#f4f8df",
      ground: "#bcdb8f",
    },
  },
  rose_garden: {
    label: "Rose garden",
    motif: "florals",
    palette: {
      main: "#e98fa1",
      accent: "#b8405a",
      deep: "#6f9a52",
      light: "#fde7ea",
      ground: "#efb6c0",
    },
  },
  lavender: {
    label: "Lavender",
    motif: "dots",
    palette: {
      main: "#b39ddb",
      accent: "#6e54a8",
      deep: "#56427f",
      light: "#f1eafb",
      ground: "#cdbcea",
    },
  },
  frost: {
    label: "Frost",
    motif: "stars",
    palette: {
      main: "#a9cfe6",
      accent: "#ffffff",
      deep: "#5a84a6",
      light: "#f4faff",
      ground: "#d4e7f2",
    },
  },
};

export const PATTERN_LABELS: Record<Pattern, string> = {
  plain: "Plain",
  dots: "Dots",
  stripes: "Stripes",
  gingham: "Gingham",
  florals: "Florals",
  citrus: "Citrus slices",
  stars: "Stars",
  waves: "Waves",
  hearts: "Hearts",
  leaves: "Leaves",
};

export const WEAR_INFO: Record<WearItem, { slot: WearSlot; label: string }> = {
  straw_hat: { slot: "hat", label: "Straw hat" },
  beret: { slot: "hat", label: "Beret" },
  flower_crown: { slot: "hat", label: "Flower crown" },
  beanie: { slot: "hat", label: "Beanie" },
  apron: { slot: "top", label: "Apron" },
  scarf: { slot: "top", label: "Scarf" },
  cardigan: { slot: "top", label: "Cardigan" },
  overalls: { slot: "top", label: "Overalls" },
  basket: { slot: "accessory", label: "Basket" },
  satchel: { slot: "accessory", label: "Satchel" },
  glasses: { slot: "accessory", label: "Glasses" },
  bow: { slot: "accessory", label: "Bow" },
  top_hat: { slot: "hat", label: "Top hat" },
  raincoat: { slot: "top", label: "Raincoat" },
  umbrella: { slot: "accessory", label: "Umbrella" },
  dress: { slot: "top", label: "Dress" },
  skirt: { slot: "bottom", label: "Skirt" },
  trousers: { slot: "bottom", label: "Trousers" },
  shorts: { slot: "bottom", label: "Shorts" },
  socks: { slot: "feet", label: "Socks" },
  boots: { slot: "feet", label: "Boots" },
  sneakers: { slot: "feet", label: "Sneakers" },
  muse_halo: { slot: "hat", label: "Muse halo" },
  muse_lantern: { slot: "accessory", label: "Muse lantern" },
};

/** Wear that covers the bottom half too, so nothing goes in the bottom slot with it. */
export const FULL_LENGTH: readonly WearItem[] = ["dress"];

/** `own` means the resident's own uploaded pattern tile (`patternMedia`). */
export const GARMENT_PATTERNS = [...PATTERNS, "own"] as const;
export type GarmentPattern = (typeof GARMENT_PATTERNS)[number];

/**
 * How one garment looks on its own: a pattern and a color of its own instead of the outfit's.
 * Either may be absent, and then the theme decides, as before.
 */
export interface WearStyle {
  pattern?: GarmentPattern;
  color?: ResidentColor;
}

/** A style per garment, keyed by wear item. Kept for items not worn now, so they come back styled. */
export type WearStyles = Partial<Record<WearItem, WearStyle>>;

/** A media id exactly as the server makes them: `m_` and 16 hex digits. */
export const MEDIA_ID_PATTERN = /^m_[0-9a-f]{16}$/;

/** The look fields a resident may have. Each is absent until set, so old worlds hash unchanged. */
export interface Look {
  theme?: Theme;
  pattern?: Pattern;
  /** One item per slot, kept in slot order (hat, top, accessory). Absent when empty. */
  wear?: WearItem[];
  /** An image the resident uploaded, used as their own pattern tile (clothes and walls). */
  patternMedia?: string;
  /** An image the resident uploaded of their home, shown over their plot and on their profile. */
  homeArt?: string;
  /** A `.glb` model the resident uploaded of their home, for the 3D views. */
  homeModel?: string;
  /** A pattern or color per garment ("a lemon dress"). Absent until set, and when empty. */
  wearStyle?: WearStyles;
}

export const LOOK_KEYS = [
  "theme",
  "pattern",
  "wear",
  "patternMedia",
  "homeArt",
  "homeModel",
  "wearStyle",
] as const satisfies readonly (keyof Look)[];

/** The look media fields, which hold upload ids. */
export const LOOK_MEDIA_KEYS = [
  "patternMedia",
  "homeArt",
  "homeModel",
] as const satisfies readonly (keyof Look)[];
export type LookMediaKey = (typeof LOOK_MEDIA_KEYS)[number];

/** Put wear in slot order. Callers validate first; unknown items sort last. */
export function sortWear(items: readonly WearItem[]): WearItem[] {
  const rank = (w: WearItem) => WEAR_SLOTS.indexOf(WEAR_INFO[w]?.slot);
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** Why a wear list isn't allowed, or null when it is. */
export function wearProblem(items: readonly string[]): string | null {
  if (items.length > MAX_WEAR) return `Wear at most ${MAX_WEAR} things, one of each kind.`;
  const slots = new Set<WearSlot>();
  for (const item of items) {
    if (!(WEAR_ITEMS as readonly string[]).includes(item)) return "Unknown thing to wear.";
    const info = WEAR_INFO[item as WearItem];
    if (slots.has(info.slot)) return `Only one ${info.slot} at a time.`;
    slots.add(info.slot);
  }
  const full = items.find((w) => FULL_LENGTH.includes(w as WearItem));
  if (full && slots.has("bottom")) {
    return `A ${WEAR_INFO[full as WearItem].label.toLowerCase()} covers the bottom half: leave out the ${WEAR_SLOTS[3]} piece.`;
  }
  return null;
}

/** Why a set of garment styles isn't allowed, or null when it is. Values may be null (clear). */
export function wearStyleProblem(styles: unknown, colors: readonly string[]): string | null {
  if (typeof styles !== "object" || styles === null || Array.isArray(styles)) {
    return "wearStyle is an object from a wear item to its style.";
  }
  for (const [item, style] of Object.entries(styles)) {
    if (!(WEAR_ITEMS as readonly string[]).includes(item)) return `Unknown thing to wear: ${item}.`;
    if (style === null) continue;
    if (typeof style !== "object" || Array.isArray(style)) return `The ${item} style is an object.`;
    if (Object.keys(style).length === 0) {
      return `The ${item} style needs a pattern or a color. Send null to clear it.`;
    }
    for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
      if (key === "pattern") {
        if (!(GARMENT_PATTERNS as readonly unknown[]).includes(value)) return "Unknown pattern.";
      } else if (key === "color") {
        if (!colors.includes(value as string)) return "Unknown color.";
      } else return `A garment's style has a pattern and a color, not ${key}.`;
    }
  }
  return null;
}

/** Garment styles as a parser hands them over, where an optional field may be explicitly undefined. */
export type LooseWearStyles = Partial<
  Record<
    WearItem,
    { pattern?: GarmentPattern | undefined; color?: ResidentColor | undefined } | null | undefined
  >
>;

/**
 * The same styles with every undefined dropped, as the sim's types want them. Nulls (clears) stay.
 * Server and client both use it at the edge where parsed data becomes a command or a look.
 */
export function exactWearStyles(
  loose: LooseWearStyles,
): Partial<Record<WearItem, WearStyle | null>> {
  const out: Partial<Record<WearItem, WearStyle | null>> = {};
  for (const [item, style] of Object.entries(loose) as [WearItem, LooseWearStyles[WearItem]][]) {
    if (style === undefined) continue;
    if (style === null) {
      out[item] = null;
      continue;
    }
    out[item] = {
      ...(style.pattern === undefined ? {} : { pattern: style.pattern }),
      ...(style.color === undefined ? {} : { color: style.color }),
    };
  }
  return out;
}

/**
 * Garment styles after `changes` (already checked) over `base`: an item set to null loses its
 * style, an item set to a style takes it whole, and an empty style is dropped. Keys come out in
 * catalog order, so the same styles always serialize the same.
 */
export function mergeWearStyles(
  base: WearStyles | undefined,
  changes: Partial<Record<WearItem, WearStyle | null>>,
): WearStyles | undefined {
  const out: WearStyles = {};
  for (const item of WEAR_ITEMS) {
    const next = item in changes ? changes[item] : base?.[item];
    if (!next) continue;
    const style: WearStyle = {};
    if (next.pattern !== undefined) style.pattern = next.pattern;
    if (next.color !== undefined) style.color = next.color;
    if (style.pattern !== undefined || style.color !== undefined) out[item] = style;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Copy only the look fields a resident actually has. */
export function lookOf(
  source: { [K in Exclude<keyof Look, "wearStyle">]?: Look[K] | undefined } & {
    wearStyle?: LooseWearStyles | undefined;
  },
): Look {
  const out: Look = {};
  if (source.theme !== undefined) out.theme = source.theme;
  if (source.pattern !== undefined) out.pattern = source.pattern;
  if (source.wear !== undefined) out.wear = [...source.wear];
  if (source.patternMedia !== undefined) out.patternMedia = source.patternMedia;
  if (source.homeArt !== undefined) out.homeArt = source.homeArt;
  if (source.homeModel !== undefined) out.homeModel = source.homeModel;
  if (source.wearStyle !== undefined) {
    const copy = mergeWearStyles(undefined, exactWearStyles(source.wearStyle));
    if (copy) out.wearStyle = copy;
  }
  return out;
}
