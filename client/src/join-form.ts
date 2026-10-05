/**
 * The onboarding form the feed pages share: a name, a color, a shape, and a short note. Used by
 * the invite page and by "Join and follow" on a profile. The world's own landing has the same
 * fields in static markup (see landing.ts).
 */

import type { LookView } from "@terrakin/protocol";
import {
  NAME_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  RESIDENT_COLORS,
  RESIDENT_SHAPES,
  type ResidentColor,
  type ResidentShape,
  THEME_INFO,
  THEMES,
  type Theme,
} from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { paintAvatar } from "@terrakin/ui/people";

export interface JoinChoice {
  name: string;
  color: ResidentColor;
  shape: ResidentShape;
  note: string;
  /** A look theme (RFC 0005). Absent for just your color. */
  theme?: Theme;
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

/** One pressable chip per option; returns the row and a getter for the current choice. */
function chips<T extends string>(
  options: readonly T[],
  first: T,
  draw: (value: T) => HTMLElement[],
  onPick: (value: T) => void,
): { row: HTMLElement; value: () => T } {
  let chosen = first;
  const row = h("div", { class: "swatch-row" });
  for (const value of options) {
    const b = h(
      "button",
      {
        attrs: { type: "button", "aria-pressed": String(value === first), "data-value": value },
        on: {
          click: () => {
            chosen = value;
            for (const other of row.children) {
              other.setAttribute("aria-pressed", String(other === b));
            }
            onPick(value);
          },
        },
      },
      ...draw(value),
    );
    row.append(b);
  }
  return { row, value: () => chosen };
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
  // The first color and shape, always: a choice that changes on every load reads as a glitch.
  const firstColor = RESIDENT_COLORS[0] ?? "sun";
  const firstShape = RESIDENT_SHAPES[0] ?? "round";

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
  const preview = tokenPreview(firstColor, firstShape, "");
  const repaint = () => {
    const t = theme.value();
    preview.paint(
      color.value(),
      shape.value(),
      name.value,
      t === "none" ? undefined : { theme: t },
    );
  };

  const color = chips(
    RESIDENT_COLORS,
    firstColor,
    (c) => {
      const dot = h("span", { class: "swatch-dot" });
      dot.style.background = `var(--resident-${c})`;
      return [dot, h("span", { class: "swatch-name", text: c })];
    },
    repaint,
  );
  color.row.setAttribute("aria-label", "Colors");
  const shape = chips(
    RESIDENT_SHAPES,
    firstShape,
    (s) => [
      h("span", { class: `shape-dot ${s}`, attrs: { "aria-hidden": "true" } }),
      h("span", { text: SHAPE_LABELS[s] }),
    ],
    repaint,
  );
  shape.row.classList.add("shape-row");
  // Optional: a theme dresses you from the first step. Pattern, wear, and your own art come later.
  const theme = chips<Theme | "none">(
    ["none", ...THEMES],
    "none",
    (t) => {
      const dot = h("span", { class: "swatch-dot" });
      dot.style.background =
        t === "none"
          ? "var(--paper-2)"
          : `linear-gradient(135deg, ${THEME_INFO[t].palette.main} 55%, ${THEME_INFO[t].palette.accent} 55%)`;
      const label = t === "none" ? "None" : THEME_INFO[t].label;
      return [dot, h("span", { class: "swatch-name", text: label })];
    },
    repaint,
  );
  theme.row.setAttribute("aria-label", "Themes");
  name.addEventListener("input", () => {
    error.textContent = "";
    repaint();
  });

  const error = h("p", { class: "error", attrs: { role: "alert" } });
  const label = h("span", { text: options.submitLabel });
  const submit = h(
    "button",
    { class: "btn-primary", attrs: { type: "submit" } },
    label,
    icon("arrow"),
  );

  const form = h(
    "form",
    { class: "onboard", attrs: { novalidate: true, id: `${id}-form` } },
    h(
      "div",
      { class: "onboard-name" },
      preview.el,
      h(
        "div",
        { class: "onboard-field" },
        h("label", { class: "field-label", attrs: { for: `${id}-name` }, text: "Your name" }),
        name,
      ),
    ),
    h(
      "fieldset",
      { class: "swatches", attrs: { id: `${id}-color` } },
      h("legend", { class: "field-label", text: "Your color" }),
      color.row,
    ),
    h(
      "fieldset",
      { class: "swatches", attrs: { id: `${id}-shape` } },
      h("legend", { class: "field-label", text: "Your shape" }),
      shape.row,
    ),
    h(
      "fieldset",
      { class: "swatches", attrs: { id: `${id}-theme` } },
      h("legend", { class: "field-label", text: "A theme (optional)" }),
      theme.row,
    ),
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
    h("div", { class: "join-submit" }, submit),
    error,
  );

  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const value = name.value.trim();
    if (!value) {
      error.textContent = `Pick a name first. Anything you like, up to ${NAME_MAX_LENGTH} letters.`;
      name.focus();
      return;
    }
    const chosenTheme = theme.value();
    busy = true;
    submit.disabled = true;
    label.textContent = options.busyLabel;
    error.textContent = "";
    const problem = await options.onSubmit({
      name: value,
      color: color.value(),
      shape: shape.value(),
      note: note.value.trim(),
      ...(chosenTheme === "none" ? {} : { theme: chosenTheme }),
    });
    busy = false;
    submit.disabled = false;
    label.textContent = options.submitLabel;
    if (problem) error.textContent = problem;
  });

  return { el: form, focus: () => name.focus({ preventScroll: true }) };
}
