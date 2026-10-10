/**
 * "Your look": pick a theme, a hair style and color, a pattern, and one thing to wear in each slot
 * (hat, top, carry, bottom, feet), give any of them its own color and pattern, with a live preview,
 * or bring your own pattern, home picture, and home model as uploads. Saves with the `profile`
 * action; the server checks every choice and every upload.
 */
import type { LookView, MediaView } from "@terrakin/protocol";
import {
  DEFAULT_HAIR_COLOR,
  FULL_LENGTH,
  type GarmentPattern,
  type HairColor,
  type HairStyle,
  isCostume,
  isEarnedWear,
  isExclusiveWear,
  isShopWear,
  PATTERN_LABELS,
  PATTERNS,
  type Pattern,
  type ResidentColor,
  type ResidentShape,
  THEME_INFO,
  THEMES,
  type Theme,
  WEAR_INFO,
  WEAR_ITEMS,
  WEAR_SLOTS,
  type WearItem,
  type WearSlot,
  type WearStyle,
  type WearStyles,
} from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { type FullLook, garmentLook, paintFigure } from "@terrakin/ui/figure";
import { itemArt } from "@terrakin/ui/item-art";
import {
  garmentName,
  hairName,
  lookImage,
  lookPalette,
  mediaUrlOf,
  onLookImage,
  PatternCache,
  swatchBacking,
} from "@terrakin/ui/looks";
import {
  closeOverlay,
  errorLine,
  openOverlay,
  overlayShowing,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { actProblem, api, uploadMedia } from "./api";
import { colorChips, hairChips, hairColorChips } from "./join-form";
import { coins } from "./purse";

export interface LookOwner {
  color: ResidentColor;
  shape: ResidentShape;
  look?: LookView | undefined;
  /**
   * Changes picked elsewhere and not saved yet, like a new color on the profile's look card. The
   * preview shows them, so Save saves them too.
   */
  pending?: { color?: ResidentColor; shape?: ResidentShape; note?: string };
  /** Partner wear they may put on (`ProfileView.entitled`). Other partner wear isn't offered. */
  entitled?: readonly string[] | undefined;
}

/**
 * The wear one slot offers: everything, except partner wear (RFC 0007) and earned wear (RFC 0029)
 * the resident may not put on and isn't wearing, and a holiday's costumes (RFC 0022) they don't own
 * while the shop isn't selling them. Neither partner nor earned wear can be bought, so neither is
 * shown locked at a price. `entitled` is the partner and earned wear they may put on, `owned` the
 * shop wear they own, and `onSale` what the shop sells today, both from the shop's answer.
 */
export function wearChoices(
  slot: WearSlot,
  entitled: readonly string[],
  wearing: readonly WearItem[],
  owned: ReadonlySet<string> = new Set(),
  onSale: ReadonlySet<string> = new Set(),
): WearItem[] {
  return WEAR_ITEMS.filter(
    (w) =>
      WEAR_INFO[w].slot === slot &&
      ((!isExclusiveWear(w) && !isEarnedWear(w)) || entitled.includes(w) || wearing.includes(w)) &&
      (!isCostume(w) || owned.has(w) || wearing.includes(w) || onSale.has(w)),
  );
}

const SLOT_LABELS: Record<WearSlot, string> = {
  hat: "Hat",
  top: "Top",
  accessory: "Carry",
  bottom: "Bottom",
  feet: "Feet",
};
const IMAGE_TYPES = "image/png,image/jpeg,image/webp";

type MediaKey = "patternMedia" | "homeArt" | "homeModel";
type Draft = {
  theme: Theme | null;
  pattern: Pattern | null;
  wear: WearItem[];
  patternMedia: string | null;
  homeArt: string | null;
  homeModel: string | null;
  /** A style per garment, kept for pieces not worn too, as the world keeps them. */
  wearStyle: WearStyles;
  hair: HairStyle | null;
  /** Kept while there's no style, as the world keeps it. */
  hairColor: HairColor | null;
};

/** The profile action's fields for a look: garment styles go as a partial map, null to clear. */
type LookChanges = Partial<Omit<Draft, "wearStyle">> & {
  wearStyle?: Partial<Record<WearItem, WearStyle | null>>;
};

const thumbs = new PatternCache();

/** A garment style with only the fields it has, or undefined when it has none. */
/**
 * Styles with `own` taken off every garment (keeping its color), for when your own pattern goes:
 * the sim refuses a look whose garments use a pattern you no longer have. Pure, so tests pin it.
 */
export function withoutOwnPattern(styles: WearStyles): WearStyles {
  const out: WearStyles = {};
  for (const item of WEAR_ITEMS) {
    const style = styles[item];
    if (!style) continue;
    const kept = style.pattern === "own" ? cleanStyle({ color: style.color }) : style;
    if (kept) out[item] = kept;
  }
  return out;
}

function cleanStyle(
  style: { pattern?: GarmentPattern | undefined; color?: ResidentColor | undefined } | undefined,
): WearStyle | undefined {
  if (!style) return undefined;
  const out: WearStyle = {};
  if (style.pattern) out.pattern = style.pattern;
  if (style.color) out.color = style.color;
  return out.pattern || out.color ? out : undefined;
}

function stylesOf(view: LookView["wearStyle"]): WearStyles {
  const out: WearStyles = {};
  for (const item of WEAR_ITEMS) {
    const style = cleanStyle(view?.[item]);
    if (style) out[item] = style;
  }
  return out;
}

function draftOf(look: LookView | undefined): Draft {
  return {
    theme: look?.theme ?? null,
    pattern: look?.pattern ?? null,
    wear: [...(look?.wear ?? [])],
    patternMedia: look?.patternMedia ?? null,
    homeArt: look?.homeArt ?? null,
    homeModel: look?.homeModel ?? null,
    wearStyle: stylesOf(look?.wearStyle),
    hair: look?.hair ?? null,
    hairColor: look?.hairColor ?? null,
  };
}

const sameStyle = (a: WearStyle | undefined, b: WearStyle | undefined) =>
  a?.pattern === b?.pattern && a?.color === b?.color;

/** Only the fields that changed, ready for the profile action. */
export function lookChanges(before: LookView | undefined, after: Draft): LookChanges {
  const old = draftOf(before);
  const out: LookChanges = {};
  if (old.theme !== after.theme) out.theme = after.theme;
  if (old.pattern !== after.pattern) out.pattern = after.pattern;
  if ([...old.wear].sort().join() !== [...after.wear].sort().join()) out.wear = after.wear;
  for (const key of ["patternMedia", "homeArt", "homeModel"] as const) {
    if (old[key] !== after[key]) out[key] = after[key];
  }
  if (old.hair !== after.hair) out.hair = after.hair;
  if (old.hairColor !== after.hairColor) out.hairColor = after.hairColor;
  const styles: Partial<Record<WearItem, WearStyle | null>> = {};
  for (const item of WEAR_ITEMS) {
    const next = cleanStyle(after.wearStyle[item]);
    if (!sameStyle(old.wearStyle[item], next)) styles[item] = next ?? null;
  }
  if (Object.keys(styles).length > 0) out.wearStyle = styles;
  return out;
}

/**
 * Put on `item` (or take off what's in `slot` when it's null). A dress covers the bottom half, so
 * putting one on takes off the bottom, and putting on a bottom takes off the dress.
 */
export function wearWith(
  wear: readonly WearItem[],
  slot: WearSlot,
  item: WearItem | null,
): WearItem[] {
  let out = wear.filter((w) => WEAR_INFO[w].slot !== slot);
  if (item && FULL_LENGTH.includes(item)) out = out.filter((w) => WEAR_INFO[w].slot !== "bottom");
  if (item && slot === "bottom") out = out.filter((w) => !FULL_LENGTH.includes(w));
  if (item) out.push(item);
  return out;
}

/** The look as a view: unset fields left out. */
function viewOf(d: Draft): LookView {
  const styles = stylesOf(d.wearStyle);
  return {
    ...(d.theme ? { theme: d.theme } : {}),
    ...(d.pattern ? { pattern: d.pattern } : {}),
    ...(d.wear.length ? { wear: [...d.wear] } : {}),
    ...(d.patternMedia ? { patternMedia: d.patternMedia } : {}),
    ...(d.homeArt ? { homeArt: d.homeArt } : {}),
    ...(d.homeModel ? { homeModel: d.homeModel } : {}),
    ...(Object.keys(styles).length ? { wearStyle: styles } : {}),
    ...(d.hair ? { hair: d.hair } : {}),
    ...(d.hairColor ? { hairColor: d.hairColor } : {}),
  };
}

/** The town shop's wear: what you own, and what the rest costs. Unknown until the shop answers. */
interface Wardrobe {
  owned: ReadonlySet<WearItem>;
  prices: ReadonlyMap<string, number>;
}

/** Open the look editor. `onSaved` gets the new look once the world accepts it. */
export function openLookEditor(owner: LookOwner, onSaved: (look: LookView) => void) {
  const draft = draftOf(owner.look);
  const figureLook = (): FullLook => ({
    color: owner.color,
    shape: owner.shape,
    ...(draft.theme ? { theme: draft.theme } : {}),
    ...(draft.pattern ? { pattern: draft.pattern } : {}),
    wear: draft.wear,
    ...(draft.patternMedia ? { patternMedia: draft.patternMedia } : {}),
    wearStyle: draft.wearStyle,
    ...(draft.hair ? { hair: draft.hair } : {}),
    ...(draft.hairColor ? { hairColor: draft.hairColor } : {}),
  });
  // Shop wear you have on is yours; the rest waits for the shop to say.
  let wardrobe: Wardrobe = {
    owned: new Set((owner.look?.wear ?? []).filter(isShopWear)),
    prices: new Map(),
  };

  // ---- preview ----
  const preview = h("canvas", { class: "look-preview-figure", attrs: { "aria-hidden": "true" } });
  const previewBox = h(
    "div",
    { class: "look-preview", attrs: { role: "img", "aria-label": "Preview of your look" } },
    preview,
  );
  const summary = h("p", { class: "look-summary", attrs: { "aria-live": "polite" } });

  // ---- theme ----
  const themeRow = h("div", { class: "look-themes" });
  const themeButtons = new Map<Theme | null, HTMLButtonElement>();
  const themeButton = (theme: Theme | null) => {
    const colors = theme
      ? Object.values(THEME_INFO[theme].palette)
      : Object.values(lookPalette(undefined, owner.color));
    const swatch = h("span", { class: "look-swatch", attrs: { "aria-hidden": "true" } });
    swatch.style.background = `linear-gradient(135deg, ${colors
      .slice(0, 4)
      .map((c, i) => `${c} ${i * 25}% ${(i + 1) * 25}%`)
      .join(", ")})`;
    const b = h(
      "button",
      {
        class: "look-theme",
        attrs: { type: "button", "data-theme": theme ?? "none" },
        on: {
          click: () => {
            draft.theme = theme;
            paint();
          },
        },
      },
      swatch,
      h("span", { class: "look-theme-name", text: theme ? THEME_INFO[theme].label : "Your color" }),
    );
    themeButtons.set(theme, b);
    return b;
  };
  themeRow.append(themeButton(null), ...THEMES.map(themeButton));

  // ---- hair: a style, each chip showing you in it, then its color ----
  const hair = hairChips(
    draft.hair,
    (style) => {
      draft.hair = style;
      paint();
    },
    h("div", { class: "cluster look-chips" }),
    { chip: "look-chip", none: "look-chip text" },
  );
  const hairColors = hairColorChips(draft.hairColor ?? DEFAULT_HAIR_COLOR, (c) => {
    draft.hairColor = c;
    paint();
  });
  // The color waits for a style; it's kept while there's none.
  const hairColorBox = h(
    "div",
    { class: "look-hair-colors" },
    h("p", { class: "look-sub", text: "Color" }),
    hairColors.row,
  );

  // ---- pattern chips, for the outfit and for one garment ----
  type Thumb = { canvas: HTMLCanvasElement; pattern: Pattern | "own" };
  const outfitThumbs: Thumb[] = [];

  /** A chip with a round swatch of the pattern, painted by `paintThumb`. */
  function patternChip(
    pattern: Pattern | "own",
    label: string,
    data: Record<string, string>,
    onClick: () => void,
    into: Thumb[],
  ) {
    const canvas = h("canvas", { class: "look-chip-thumb", attrs: { "aria-hidden": "true" } });
    into.push({ canvas, pattern });
    return h(
      "button",
      { class: "look-chip", attrs: { type: "button", ...data }, on: { click: onClick } },
      canvas,
      h("span", { text: label }),
    );
  }

  /**
   * Paint a pattern swatch: the base color (a shade darker under a motif when it's pale, so the
   * motif shows), then the motif, or your own tile once it loads.
   */
  function paintThumb(t: Thumb, base: string, palette: ReturnType<typeof lookPalette>) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.round(28 * dpr);
    t.canvas.width = px;
    t.canvas.height = px;
    const ctx = t.canvas.getContext("2d");
    if (!ctx) return;
    // A plain swatch and your own tile show the cloth as it is; only a motif needs the backing.
    const motif = t.pattern !== "own" && t.pattern !== "plain";
    ctx.fillStyle = motif ? swatchBacking(base) : base;
    ctx.fillRect(0, 0, px, px);
    const img = t.pattern === "own" ? lookImage(draft.patternMedia ?? undefined) : undefined;
    const fill =
      t.pattern === "own"
        ? img && draft.patternMedia
          ? thumbs.image(ctx, draft.patternMedia, img, px)
          : null
        : thumbs.named(ctx, t.pattern, palette, px / 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, px, px);
    }
  }

  const patternRow = h("div", { class: "cluster look-chips" });
  const patternButtons = new Map<Pattern, HTMLButtonElement>();
  for (const pattern of PATTERNS) {
    const b = patternChip(
      pattern,
      PATTERN_LABELS[pattern],
      { "data-pattern": pattern },
      () => {
        draft.pattern = pattern;
        setPatternMedia(null);
        paint();
      },
      outfitThumbs,
    );
    patternButtons.set(pattern, b);
    patternRow.append(b);
  }

  /** Change your own pattern. Without one, no garment can wear it, so those lose that pattern. */
  function setPatternMedia(id: string | null) {
    draft.patternMedia = id;
    if (id) return;
    draft.wearStyle = withoutOwnPattern(draft.wearStyle);
    if (styling) openStyler(styling);
  }

  // ---- wear ----
  const wearButtons = new Map<string, HTMLElement>();
  const styleButtons = new Map<WearSlot, HTMLButtonElement>();
  const stylerSlots = new Map<WearSlot, HTMLElement>();
  const chipRows = new Map<WearSlot, HTMLElement>();
  /** The slot whose garment the styler is open for, if any. */
  let styling: WearSlot | null = null;

  const worn = (slot: WearSlot) => draft.wear.find((w) => WEAR_INFO[w].slot === slot);

  const wearRows = WEAR_SLOTS.map((slot) => {
    const row = h("div", { class: "cluster look-chips", attrs: { "data-slot": slot } });
    chipRows.set(slot, row);
    const holder = h("div", {
      class: "look-styler-slot",
      attrs: { id: `look-styler-${slot}`, "data-styler": slot },
    });
    stylerSlots.set(slot, holder);
    const style = h(
      "button",
      {
        class: "pill-button small look-style",
        attrs: {
          type: "button",
          "aria-expanded": "false",
          "aria-controls": `look-styler-${slot}`,
          "data-style": slot,
        },
        on: { click: () => (styling === slot ? closeStyler() : openStyler(slot)) },
      },
      icon("sparkle"),
      h("span", { text: "Style" }),
    );
    styleButtons.set(slot, style);
    return h(
      "div",
      { class: "look-wear-row" },
      h(
        "div",
        { class: "look-slot-head" },
        h("p", { class: "look-sub", text: SLOT_LABELS[slot] }),
        style,
      ),
      row,
      holder,
    );
  });

  /** One slot's chips: none, then each piece, with shop wear you don't own locked at its price. */
  function fillWearRow(slot: WearSlot) {
    const row = chipRows.get(slot);
    if (!row) return;
    row.replaceChildren();
    const none = h("button", {
      class: "look-chip text",
      attrs: { type: "button", "data-wear": `none-${slot}` },
      text: "None",
      on: { click: () => pick(slot, null) },
    });
    wearButtons.set(`none-${slot}`, none);
    row.append(none);
    const sold = new Set(wardrobe.prices.keys());
    const choices = wearChoices(
      slot,
      owner.entitled ?? [],
      owner.look?.wear ?? [],
      wardrobe.owned,
      sold,
    );
    for (const item of choices) {
      const art = itemArt(item, { size: 28, className: "look-chip-art" });
      const name = h("span", { text: WEAR_INFO[item].label });
      if (isShopWear(item) && !wardrobe.owned.has(item)) {
        const price = wardrobe.prices.get(item);
        const cost = price === undefined ? "sold" : coins(price);
        const link = h(
          "a",
          {
            class: "look-chip locked",
            attrs: {
              href: "/shop",
              "data-wear": item,
              "aria-label": `${WEAR_INFO[item].label}, ${cost} at the town shop`,
            },
          },
          art,
          name,
          h(
            "span",
            { class: "look-chip-price" },
            icon("coin"),
            h("span", { text: price === undefined ? "Shop" : String(price) }),
          ),
        );
        // No closeOverlay here: the router closes the editor as it goes to the shop.
        wearButtons.set(item, link);
        row.append(link);
        continue;
      }
      const b = h(
        "button",
        {
          class: "look-chip wear",
          attrs: { type: "button", "data-wear": item },
          on: {
            // Tapping what you have on opens its styler.
            click: () => (worn(slot) === item ? openStyler(slot) : pick(slot, item)),
          },
        },
        art,
        name,
      );
      wearButtons.set(item, b);
      row.append(b);
    }
  }
  for (const slot of WEAR_SLOTS) fillWearRow(slot);

  function pick(slot: WearSlot, item: WearItem | null) {
    draft.wear = wearWith(draft.wear, slot, item);
    if (styling) {
      // Keep the styler on the slot, now for what's in it; close it once the slot is empty.
      if (worn(styling)) openStyler(styling);
      else closeStyler();
    }
    paint();
  }

  // The shop says what you own and what the rest costs. Until then shop wear shows locked.
  void api.shop().then((result) => {
    if (!result.ok) return;
    const owned = new Set<WearItem>([...wardrobe.owned, ...(result.data.you?.wardrobe ?? [])]);
    const prices = new Map((result.data.shop?.items ?? []).map((i) => [i.sku as string, i.price]));
    wardrobe = { owned, prices };
    for (const slot of WEAR_SLOTS) fillWearRow(slot);
    paint();
  });

  // ---- the styler: one garment's own color and pattern ----
  type StylerPaint = () => void;
  let paintStyler: StylerPaint = () => {};

  function setStyle(
    item: WearItem,
    change: { pattern?: GarmentPattern | undefined; color?: ResidentColor | undefined },
  ) {
    const next = cleanStyle({ ...draft.wearStyle[item], ...change });
    if (next) draft.wearStyle[item] = next;
    else delete draft.wearStyle[item];
  }

  function closeStyler() {
    if (styling) stylerSlots.get(styling)?.replaceChildren();
    styling = null;
    paintStyler = () => {};
    paint();
  }

  function openStyler(slot: WearSlot) {
    const item = worn(slot);
    if (styling && styling !== slot) stylerSlots.get(styling)?.replaceChildren();
    if (!item) {
      closeStyler();
      return;
    }
    styling = slot;
    const holder = stylerSlots.get(slot);
    if (!holder) return;
    const style = () => draft.wearStyle[item];
    const name = WEAR_INFO[item].label.toLowerCase();

    const colors = colorChips<"usual">(
      style()?.color ?? "usual",
      (c) => {
        setStyle(item, { color: c === "usual" ? undefined : c });
        paint();
      },
      undefined,
      { value: "usual", label: "Usual" },
    );
    colors.row.setAttribute("aria-label", `Color of your ${name}`);

    const patternThumbs: Thumb[] = [];
    const patternChips = new Map<GarmentPattern | "usual", HTMLElement>();
    const patterns = h("div", {
      class: "cluster look-chips",
      attrs: { role: "group", "aria-label": `Pattern of your ${name}` },
    });
    const usual = h("button", {
      class: "look-chip text",
      attrs: { type: "button", "data-garment-pattern": "usual" },
      text: "Usual",
      on: {
        click: () => {
          setStyle(item, { pattern: undefined });
          paint();
        },
      },
    });
    patternChips.set("usual", usual);
    patterns.append(usual);
    const choices: (Pattern | "own")[] = draft.patternMedia ? [...PATTERNS, "own"] : [...PATTERNS];
    for (const pattern of choices) {
      const label = pattern === "own" ? "Your own pattern" : PATTERN_LABELS[pattern];
      const b = patternChip(
        pattern,
        label,
        { "data-garment-pattern": pattern },
        () => {
          setStyle(item, { pattern });
          paint();
        },
        patternThumbs,
      );
      patternChips.set(pattern, b);
      patterns.append(b);
    }

    const clear = h("button", {
      class: "pill-button small",
      attrs: { type: "button", "data-clear-style": item },
      text: "Clear style",
      on: {
        click: () => {
          delete draft.wearStyle[item];
          openStyler(slot);
          paint();
          // The styler was rebuilt: keep focus on the same control, not the top of the sheet.
          stylerSlots
            .get(slot)
            ?.querySelector<HTMLElement>(`[data-clear-style="${item}"]`)
            ?.focus();
        },
      },
    });
    const done = h("button", {
      class: "pill-button small",
      attrs: { type: "button" },
      text: "Done",
      on: {
        click: () => {
          const back = styleButtons.get(slot);
          closeStyler();
          back?.focus();
        },
      },
    });

    paintStyler = () => {
      const g = garmentLook(figureLook(), item);
      const base = g.color ?? g.palette.main;
      for (const t of patternThumbs) paintThumb(t, base, g.palette);
      const chosen = style()?.pattern ?? "usual";
      for (const [value, b] of patternChips)
        b.setAttribute("aria-pressed", String(value === chosen));
    };
    holder.replaceChildren(
      h(
        "div",
        {
          class: "look-styler",
          attrs: { role: "group", "aria-labelledby": `look-styler-title-${slot}` },
        },
        h("h3", {
          class: "look-styler-title",
          attrs: { id: `look-styler-title-${slot}` },
          text: `Style your ${name}`,
        }),
        h("p", { class: "look-sub", text: "Color" }),
        colors.row,
        h("p", { class: "look-sub", text: "Pattern" }),
        patterns,
        h("div", { class: "look-styler-actions" }, clear, done),
      ),
    );
    paint();
  }

  // ---- bring your own ----
  // Uploads still on their way. Save waits for them (or the upload would be lost), and closing
  // the sheet stops them.
  const uploads = new Set<{ abort(): void }>();
  const mediaRows = (
    [
      [
        "patternMedia",
        "Your own pattern",
        "A small square image that repeats on your clothes and walls.",
        IMAGE_TYPES,
      ],
      [
        "homeArt",
        "A picture of your home",
        "Stands over your hearth in the world and shows on your profile.",
        IMAGE_TYPES,
      ],
      ["homeModel", "Your home in 3D", "A .glb model for the 3D views.", ".glb,model/gltf-binary"],
    ] as const
  ).map(([key, title, help, accept]) => mediaRow(key, title, help, accept));

  function mediaRow(key: MediaKey, title: string, help: string, accept: string) {
    const input = h("input", {
      class: "visually-hidden",
      attrs: { type: "file", accept, tabindex: -1, "aria-hidden": "true", "data-media": key },
    });
    const thumb = h("span", { class: "look-media-thumb", attrs: { "aria-hidden": "true" } });
    const status = h("span", { class: "look-media-status", attrs: { "aria-live": "polite" } });
    const add = h(
      "button",
      {
        class: "pill-button small",
        attrs: { type: "button" },
        on: { click: () => input.click() },
      },
      icon("plus"),
      h("span", { text: "Upload" }),
    );
    const remove = h("button", {
      class: "pill-button small",
      attrs: { type: "button" },
      text: "Remove",
      on: {
        click: () => {
          if (key === "patternMedia") setPatternMedia(null);
          else draft[key] = null;
          paint();
        },
      },
    });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      add.disabled = true;
      status.textContent = "Uploading…";
      const upload = uploadMedia(file, (f) => {
        status.textContent = `Uploading ${Math.round(f * 100)}%`;
      });
      uploads.add(upload);
      paintSave();
      const result = await upload.promise;
      uploads.delete(upload);
      paintSave();
      add.disabled = false;
      // Closed while it uploaded: the sheet is gone, and the upload was stopped.
      if (!overlayShowing(dialog)) return;
      if (!result.ok) {
        status.textContent = result.message;
        return;
      }
      const problem = mediaProblem(key, result.data);
      if (problem) {
        status.textContent = problem;
        return;
      }
      status.textContent = "";
      draft[key] = result.data.id;
      if (key === "patternMedia") {
        draft.pattern = null;
        // The styler offers your own pattern now.
        if (styling) openStyler(styling);
      }
      paint();
    });
    const repaint = () => {
      const id = draft[key];
      remove.hidden = !id;
      thumb.replaceChildren();
      thumb.hidden = !id;
      const url = mediaUrlOf(id ?? undefined);
      if (url && key !== "homeModel") {
        thumb.append(h("img", { attrs: { src: url, alt: "", decoding: "async" } }));
      } else if (url) thumb.append(icon("cube"));
    };
    return {
      el: h(
        "div",
        { class: "look-media" },
        thumb,
        h(
          "div",
          { class: "look-media-text" },
          h("p", { class: "look-media-title", text: title }),
          h("p", { class: "look-media-help", text: help }),
          status,
        ),
        h("div", { class: "look-media-actions" }, add, remove),
        input,
      ),
      repaint,
    };
  }

  // ---- paint everything from the draft ----
  function paint() {
    paintFigure(preview, figureLook(), 150, "full");
    // Each style on you, without a hat over it.
    hair.paint(figureLook());
    hairColorBox.hidden = draft.hair === null;
    const color = draft.hairColor ?? DEFAULT_HAIR_COLOR;
    for (const b of hairColors.row.querySelectorAll<HTMLElement>("[data-value]"))
      b.setAttribute("aria-pressed", String(b.dataset.value === color));
    const palette = lookPalette(draft.theme ?? undefined, owner.color);
    for (const [theme, b] of themeButtons)
      b.setAttribute("aria-pressed", String(theme === draft.theme));
    for (const [pattern, b] of patternButtons) {
      const on = !draft.patternMedia && (draft.pattern ?? "plain") === pattern;
      b.setAttribute("aria-pressed", String(on));
    }
    for (const t of outfitThumbs) paintThumb(t, palette.main, palette);
    for (const [key, b] of wearButtons) {
      // A locked chip is a link to the shop, never pressed.
      if (!(b instanceof HTMLButtonElement)) continue;
      const on = key.startsWith("none-")
        ? !draft.wear.some((w) => WEAR_INFO[w].slot === key.slice(5))
        : draft.wear.includes(key as WearItem);
      b.setAttribute("aria-pressed", String(on));
    }
    for (const [slot, b] of styleButtons) {
      const item = worn(slot);
      b.hidden = !item;
      b.setAttribute("aria-expanded", String(styling === slot));
      b.setAttribute(
        "aria-label",
        item ? `Style your ${WEAR_INFO[item].label.toLowerCase()}` : "Style",
      );
    }
    paintStyler();
    for (const row of mediaRows) row.repaint();
    summary.textContent = lookSummary(draft);
  }
  const stopImages = onLookImage(paint);
  // Start loading a custom pattern so the preview can show it.
  lookImage(draft.patternMedia ?? undefined);

  // ---- save ----
  const error = errorLine();
  const saveLabel = h("span", { text: "Save my look" });
  const save = h(
    "button",
    { class: "btn-primary look-save", attrs: { type: "button" } },
    saveLabel,
  );
  function paintSave() {
    save.disabled = uploads.size > 0;
    saveLabel.textContent = uploads.size > 0 ? "Uploading…" : "Save my look";
  }
  const form = h(
    "form",
    { class: "look-form", attrs: { novalidate: true } },
    section("Theme", "Colors for your clothes, your plot, and your blocks.", themeRow),
    section("Hair", "A style, then its color. A hat sits on top.", hair.row, hairColorBox),
    section("Pattern", null, patternRow),
    section(
      "Wear",
      "One of each. Tap Style, or what you have on, to give it its own color and pattern.",
      ...wearRows,
    ),
    section(
      "Make it yours",
      "Bring your own art. Uploads are public, like a post.",
      ...mediaRows.map((r) => r.el),
    ),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (uploads.size > 0) return;
    const changes = { ...owner.pending, ...lookChanges(owner.look, draft) };
    if (Object.keys(changes).length === 0) {
      closeOverlay();
      return;
    }
    error.textContent = "";
    const result = await whileBusy(
      save,
      () => api.act({ type: "profile", ...changes }),
      "Saving…",
      saveLabel,
    );
    // A 200 can still be the world saying no (an unknown theme, an upload that isn't yours).
    const problem = actProblem(result);
    if (problem) {
      // Closed while it saved: the error line is gone with it.
      if (overlayShowing(dialog)) error.textContent = problem;
      else toast(problem);
      return;
    }
    const look = viewOf(draft);
    owner.look = look;
    toast("Look saved");
    onSaved(look);
    closeOverlay(dialog);
  });

  const closeBtn = h(
    "button",
    {
      class: "look-close pill-button small",
      attrs: { type: "button", "aria-label": "Close" },
      on: { click: () => closeOverlay() },
    },
    icon("close"),
  );
  const dialog = h(
    "dialog",
    { class: "fullscreen look-editor", attrs: { "aria-labelledby": "look-title" } },
    h(
      "div",
      { class: "look-sheet paper" },
      h(
        "header",
        { class: "look-editor-head" },
        h("h2", { attrs: { id: "look-title" }, text: "Your look" }),
        closeBtn,
      ),
      h("div", { class: "look-top" }, previewBox, summary),
      form,
      h("div", { class: "look-foot" }, error, save),
    ),
  );
  // The button lives in the sticky footer, outside the scrolling form.
  save.addEventListener("click", () => form.requestSubmit());

  paint();
  openOverlay(dialog, () => {
    stopImages();
    for (const upload of uploads) upload.abort();
    uploads.clear();
  });
  closeBtn.focus();
}

/**
 * The look in a line under the preview: "Lemon, auburn bob, citrus slices, citrus dress in sun
 * yellow".
 */
function lookSummary(d: Draft): string {
  const hair = d.hair ? hairName(d.hair, d.hairColor ?? undefined)?.toLowerCase() : undefined;
  const parts = [
    d.theme ? THEME_INFO[d.theme].label : "Your color",
    ...(hair ? [hair] : []),
    d.patternMedia ? "your own pattern" : PATTERN_LABELS[d.pattern ?? "plain"].toLowerCase(),
    ...d.wear.map((w) => garmentName(w, d.wearStyle[w]).toLowerCase()),
  ];
  return parts.join(", ");
}

function section(title: string, help: string | null, ...children: HTMLElement[]) {
  return h(
    "fieldset",
    { class: "look-section" },
    h("legend", { class: "look-legend", text: title }),
    help ? h("p", { class: "look-help", text: help }) : null,
    ...children,
  );
}

/** A friendly word when an upload is the wrong kind for its slot. The server checks it too. */
export function mediaProblem(
  key: MediaKey,
  media: Pick<MediaView, "kind" | "type">,
): string | null {
  if (key === "homeModel") return media.kind === "model" ? null : "That isn't a .glb model.";
  if (media.kind !== "image" || media.type === "image/gif")
    return "Use a PNG, JPEG, or WebP image.";
  return null;
}
