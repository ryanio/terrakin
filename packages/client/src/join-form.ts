/**
 * The onboarding form the feed pages share: a name, a character (hair, a top, and a color), and a
 * short note. Used by the invite page, the claim page, and "Join and follow" on a profile. The
 * world's own landing has the name and note in static markup and the same character picker (see
 * landing.ts). The chip rows here are shared with the look editor and the profile's look card.
 */

import type { LookView } from "@terrakin/protocol";
import {
  DEFAULT_HAIR_COLOR,
  HAIR_COLOR_INFO,
  HAIR_COLORS,
  HAIR_LABELS,
  HAIR_STYLES,
  type HairColor,
  type HairStyle,
  isEarnedWear,
  isExclusiveWear,
  isShopWear,
  NAME_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  RESIDENT_COLORS,
  RESIDENT_SHAPES,
  type ResidentColor,
  type ResidentShape,
  WEAR_INFO,
  WEAR_ITEMS,
  type WearItem,
} from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { type FullLook, paintFigure } from "@terrakin/ui/figure";
import { itemArt } from "@terrakin/ui/item-art";
import { COLOR_WORDS, hairName } from "@terrakin/ui/looks";
import { paintAvatar } from "@terrakin/ui/people";
import { chips, errorLine, whileBusy } from "@terrakin/ui/ui";

/** What every join form says when the name is taken: words for people, not the API's (decision 0148). */
export const NAME_TAKEN_LINE =
  "Someone here already goes by that name. Pick another, or restore your character with your key.";

/** What a join form shows when the server turns a join down: its own words, or ours for a taken name. */
export const joinProblem = (code: string, message: string): string =>
  code === "name_taken" ? NAME_TAKEN_LINE : message;

/** The look fields a join sends: always a color and shape, and hair and a top when picked. */
export interface JoinLook {
  color: ResidentColor;
  shape: ResidentShape;
  hair?: HairStyle;
  hairColor?: HairColor;
  wear?: WearItem[];
}

interface JoinChoice {
  name: string;
  note: string;
  look: JoinLook;
}

export interface JoinFormOptions {
  /** Prefix for element ids, so two forms never clash. */
  id: string;
  submitLabel: string;
  busyLabel: string;
  /** Extra controls (checkboxes) shown above the button. */
  extras?: HTMLElement[];
  /** Do the join. Resolve with an error message to show, or null when it worked. */
  onSubmit(choice: JoinChoice): Promise<string | null>;
}

const SHAPE_LABELS: Record<ResidentShape, string> = {
  round: "Round",
  square: "Square",
  diamond: "Diamond",
};

/**
 * The resident colors as chips: a dot in the color and its name. With `none`, a first chip that
 * picks no color at all (a garment keeping its usual color, in the look editor).
 */
export function colorChips<N extends string = never>(
  first: ResidentColor | N,
  onPick?: (c: ResidentColor | N) => void,
  row?: HTMLElement,
  none?: { value: N; label: string },
) {
  const options: readonly (ResidentColor | N)[] = none
    ? [none.value, ...RESIDENT_COLORS]
    : RESIDENT_COLORS;
  const picker = chips(
    options,
    first,
    (c) => {
      const dot = h("span", { class: "swatch-dot", attrs: { "aria-hidden": "true" } });
      const blank = none !== undefined && c === none.value;
      dot.style.background = blank ? "var(--paper-2)" : `var(--resident-${c})`;
      return [dot, h("span", { class: "swatch-name", text: blank ? none.label : c })];
    },
    onPick,
    row,
  );
  picker.row.setAttribute("aria-label", "Colors");
  return picker;
}

/** The hair colors as chips, like `colorChips`: a dot in the color and its name. */
export function hairColorChips(
  first: HairColor,
  onPick?: (c: HairColor) => void,
  row?: HTMLElement,
) {
  const picker = chips(
    HAIR_COLORS,
    first,
    (c) => {
      const dot = h("span", { class: "swatch-dot", attrs: { "aria-hidden": "true" } });
      dot.style.background = HAIR_COLOR_INFO[c].hex;
      return [dot, h("span", { class: "swatch-name", text: c })];
    },
    onPick,
    row,
  );
  picker.row.setAttribute("aria-label", "Hair colors");
  return picker;
}

/**
 * The hair styles as chips, None first, each a small picture of you in that style. `paint` draws
 * the pictures for a look (your color and hair color, without a hat). `chipClass` styles the chips
 * for the row they sit in.
 */
export function hairChips(
  first: HairStyle | null,
  onPick?: (style: HairStyle | null) => void,
  row?: HTMLElement,
  chipClass?: { chip: string; none: string },
) {
  const thumbs: { canvas: HTMLCanvasElement; style: HairStyle }[] = [];
  const picker = chips<HairStyle | "none">(
    ["none", ...HAIR_STYLES],
    first ?? "none",
    (s) => {
      if (s === "none") return [h("span", { text: "None" })];
      const canvas = h("canvas", { class: "look-chip-thumb", attrs: { "aria-hidden": "true" } });
      thumbs.push({ canvas, style: s });
      return [canvas, h("span", { text: HAIR_LABELS[s] })];
    },
    (s) => onPick?.(s === "none" ? null : s),
    row,
    chipClass && ((s) => (s === "none" ? chipClass.none : chipClass.chip)),
  );
  picker.row.setAttribute("aria-label", "Hair styles");
  return {
    row: picker.row,
    value: (): HairStyle | null => {
      const v = picker.value();
      return v === "none" ? null : v;
    },
    paint(look: FullLook) {
      for (const t of thumbs) {
        paintFigure(t.canvas, { ...look, wear: [], hair: t.style }, 28, "bust");
      }
    },
  };
}

/** Tops anyone can wear from their first step: free ones, no shop, partner, or earned wear. */
export const STARTER_TOPS: readonly WearItem[] = WEAR_ITEMS.filter(
  (w) => WEAR_INFO[w].slot === "top" && !isShopWear(w) && !isExclusiveWear(w) && !isEarnedWear(w),
);

/** A new character as the join form holds it. */
export interface Character {
  color: ResidentColor;
  hair: HairStyle | null;
  hairColor: HairColor;
  top: WearItem | null;
}

/**
 * Where every new character starts: the first color, short brown hair, no top. The same every
 * time, since a choice that changes on each load reads as a glitch.
 */
export const FIRST_CHARACTER: Character = {
  color: RESIDENT_COLORS[0] ?? "sun",
  hair: HAIR_STYLES[0] ?? "short",
  hairColor: DEFAULT_HAIR_COLOR,
  top: null,
};

/**
 * A character picked for someone who steps straight into the world without opening the picker: any
 * hair style and color, a free top, and a color, so newcomers don't all arrive looking the same.
 */
export function randomCharacter(random: () => number = Math.random): Character {
  const pick = <T>(list: readonly T[], fallback: T): T =>
    list[Math.floor(random() * list.length)] ?? fallback;
  return {
    color: pick(RESIDENT_COLORS, FIRST_CHARACTER.color),
    hair: pick(HAIR_STYLES, FIRST_CHARACTER.hair),
    hairColor: pick(HAIR_COLORS, FIRST_CHARACTER.hairColor),
    top: pick(STARTER_TOPS, FIRST_CHARACTER.top),
  };
}

/**
 * The join's look fields for a character. The form doesn't ask for a shape, so it sends the first
 * one, which the picture showed (decision 0140); the hair color goes only with a style.
 */
export function joinLook(c: Character): JoinLook {
  return {
    color: c.color,
    shape: RESIDENT_SHAPES[0] ?? "round",
    ...(c.hair ? { hair: c.hair, hairColor: c.hairColor } : {}),
    ...(c.top ? { wear: [c.top] } : {}),
  };
}

/** The figure a character's join look draws. */
function figureOf(look: JoinLook): FullLook {
  return {
    color: look.color,
    shape: look.shape,
    ...(look.hair ? { hair: look.hair } : {}),
    ...(look.hairColor ? { hairColor: look.hairColor } : {}),
    wear: look.wear ?? [],
  };
}

/** A row of chips that scrolls sideways on a phone, so the whole picker fits one screen. */
const pickRow = () => h("div", { class: "pick-row" });

/**
 * The character picker: a picture of you and a line saying it in words, over rows for your hair
 * style, its color, a top, and your color, all repainted as you pick. Ids start with `id`
 * (`join-hair`, `join-hair-color`, `join-top`, `join-color`). It starts from `start`.
 */
export function characterPicker(id: string, start: Character = FIRST_CHARACTER) {
  const c: Character = { ...start };
  const figure = h("canvas", { attrs: { "aria-hidden": "true" } });
  const words = h("p", { class: "character-words", attrs: { "aria-live": "polite" } });

  const hair = hairChips(
    c.hair,
    (s) => {
      c.hair = s;
      paint();
    },
    pickRow(),
  );
  const hairColor = hairColorChips(
    c.hairColor,
    (v) => {
      c.hairColor = v;
      paint();
    },
    pickRow(),
  );
  const top = chips<WearItem | "none">(
    ["none", ...STARTER_TOPS],
    c.top ?? "none",
    (w) =>
      w === "none"
        ? [h("span", { text: "None" })]
        : [
            itemArt(w, { size: 28, className: "pick-art" }),
            h("span", { text: WEAR_INFO[w].label }),
          ],
    (w) => {
      c.top = w === "none" ? null : w;
      paint();
    },
    pickRow(),
  );
  top.row.setAttribute("aria-label", "Tops");
  const color = colorChips(
    c.color,
    (v) => {
      c.color = v;
      paint();
    },
    pickRow(),
  );

  const field = (key: string, legend: string, row: HTMLElement) =>
    h(
      "fieldset",
      { class: "swatches", attrs: { id: `${id}-${key}` } },
      h("legend", { class: "field-label", text: legend }),
      row,
    );
  const hairColorField = field("hair-color", "Hair color", hairColor.row);

  function paint() {
    paintFigure(figure, figureOf(joinLook(c)), 96, "full");
    hair.paint(figureOf(joinLook({ ...c, top: null })));
    // The color waits for a style, as in the look editor.
    hairColorField.hidden = c.hair === null;
    words.textContent = characterWords(c);
  }
  paint();

  const el = h(
    "div",
    { class: "stack character" },
    h("div", { class: "character-head" }, h("div", { class: "character-figure" }, figure), words),
    field("hair", "Hair", hair.row),
    hairColorField,
    field("top", "Something to wear", top.row),
    field("color", "Your color", color.row),
  );
  return { el, value: () => joinLook(c) };
}

/** A character in words, beside its picture: "Auburn bob, cardigan, in sun yellow". */
export function characterWords(c: Character): string {
  const hair = c.hair ? hairName(c.hair, c.hairColor) : undefined;
  return [
    hair ?? "No hair",
    ...(c.top ? [WEAR_INFO[c.top].label.toLowerCase()] : []),
    `in ${COLOR_WORDS[c.color]}`,
  ].join(", ");
}

/** The resident shapes as chips: a dot in the shape and its name. */
export function shapeChips(
  first: ResidentShape,
  onPick?: (s: ResidentShape) => void,
  row?: HTMLElement,
) {
  const picker = chips(
    RESIDENT_SHAPES,
    first,
    (s) => [
      h("span", { class: `shape-dot ${s}`, attrs: { "aria-hidden": "true" } }),
      h("span", { class: "swatch-name", text: SHAPE_LABELS[s] }),
    ],
    onPick,
    row,
  );
  picker.row.classList.add("shape-row");
  picker.row.setAttribute("aria-label", "Shapes");
  return picker;
}

/** A small resident token (the same as an avatar) in a color and shape. */
export function tokenPreview(
  color: ResidentColor,
  shape: ResidentShape,
  name: string,
  look?: LookView,
) {
  const el = h("span");
  // With a look, the preview is your figure in it, like your avatar on the feed.
  const paint = (c: ResidentColor, s: ResidentShape, n: string, l?: LookView) =>
    paintAvatar(el, { name: n, color: c, shape: s, avatar: null, look: l }, "lg");
  paint(color, shape, name, look);
  return { el, paint };
}

export function joinForm(options: JoinFormOptions) {
  const { id } = options;

  const name = h("input", {
    class: "field-input",
    attrs: {
      id: `${id}-name`,
      name: "name",
      maxlength: NAME_MAX_LENGTH,
      autocomplete: "nickname",
      autocapitalize: "words",
      enterkeyhint: "next",
      placeholder: "Your name",
      required: true,
    },
  });
  const note = h("input", {
    class: "field-input",
    attrs: {
      id: `${id}-note`,
      name: "note",
      maxlength: NOTE_MAX_LENGTH,
      autocomplete: "off",
      enterkeyhint: "done",
      placeholder: "Loves gardens and rainy days",
    },
  });
  const character = characterPicker(id);
  name.addEventListener("input", () => {
    error.textContent = "";
    nameError.textContent = "";
    name.removeAttribute("aria-invalid");
  });

  // A missing name is said under the name field; anything the server says sits above the button,
  // inside its sticky bar, so a phone shows it without scrolling.
  const nameError = errorLine(`${id}-name-error`);
  name.setAttribute("aria-describedby", nameError.id);
  const error = errorLine();
  const label = h("span", { text: options.submitLabel });
  const submit = h(
    "button",
    { class: "btn-primary", attrs: { type: "submit" } },
    label,
    icon("arrow"),
  );

  const form = h(
    "form",
    { class: "stack onboard", attrs: { novalidate: true, id: `${id}-form` } },
    h(
      "div",
      { class: "onboard-field" },
      h("label", { class: "field-label", attrs: { for: `${id}-name` }, text: "Your name" }),
      name,
      nameError,
    ),
    character.el,
    h(
      "div",
      { class: "onboard-field" },
      h("label", {
        class: "field-label",
        attrs: { for: `${id}-note` },
        text: "A short note about you (optional)",
      }),
      note,
      h("p", {
        class: "field-hint",
        text: "Everyone can see it. Skip anything private, like your full name or where you live.",
      }),
    ),
    ...(options.extras ?? []),
    h("div", { class: "join-submit" }, error, submit),
  );

  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const value = name.value.trim();
    if (!value) {
      nameError.textContent = `Pick a name first. Anything you like, up to ${NAME_MAX_LENGTH} letters.`;
      name.setAttribute("aria-invalid", "true");
      name.focus();
      return;
    }
    busy = true;
    error.textContent = "";
    const problem = await whileBusy(
      submit,
      () => options.onSubmit({ name: value, note: note.value.trim(), look: character.value() }),
      options.busyLabel,
      label,
    );
    busy = false;
    if (problem) error.textContent = problem;
  });

  return { el: form, focus: () => name.focus({ preventScroll: true }) };
}
