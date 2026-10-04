/**
 * The looks catalog (RFC 0005, section 1): themes, patterns, and things to wear. Plain data shared
 * by the sim (which validates a look), the protocol (which lists the choices), and the client
 * (which draws them). Colors here are presentation only: no rule ever reads them.
 */

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

export const WEAR_SLOTS = ["hat", "top", "accessory"] as const;
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
] as const;
export type WearItem = (typeof WEAR_ITEMS)[number];

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
};

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
}

export const LOOK_KEYS = [
  "theme",
  "pattern",
  "wear",
  "patternMedia",
  "homeArt",
  "homeModel",
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
  return null;
}

/** Copy only the look fields a resident actually has. */
export function lookOf(source: { [K in keyof Look]?: Look[K] | undefined }): Look {
  const out: Look = {};
  if (source.theme !== undefined) out.theme = source.theme;
  if (source.pattern !== undefined) out.pattern = source.pattern;
  if (source.wear !== undefined) out.wear = [...source.wear];
  if (source.patternMedia !== undefined) out.patternMedia = source.patternMedia;
  if (source.homeArt !== undefined) out.homeArt = source.homeArt;
  if (source.homeModel !== undefined) out.homeModel = source.homeModel;
  return out;
}
