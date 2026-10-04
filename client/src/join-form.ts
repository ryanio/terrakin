/**
 * The onboarding form the feed pages share: a name, a color, a shape, and a short note. Used by
 * the invite page and by "Join and follow" on a profile. The world's own landing has the same
 * fields in static markup (see landing.ts).
 */
import {
  NAME_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  RESIDENT_COLORS,
  RESIDENT_SHAPES,
  type ResidentColor,
  type ResidentShape,
} from "@terrakin/sim";
import { h, icon } from "./dom";
import { initial } from "./format";

export interface JoinChoice {
  name: string;
  color: ResidentColor;
  shape: ResidentShape;
  note: string;
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
export function tokenPreview(color: ResidentColor, shape: ResidentShape, name: string) {
  const el = h("span", { class: "avatar lg", attrs: { "aria-hidden": "true" } });
  const paint = (c: ResidentColor, s: ResidentShape, n: string) => {
    el.className = `avatar lg${s === "round" ? "" : ` ${s}`}`;
    el.dataset.color = c;
    el.style.setProperty("--avatar", `var(--resident-${c})`);
    el.replaceChildren(h("span", { text: n.trim() ? initial(n) : "?" }));
  };
  paint(color, shape, name);
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
  const repaint = () => preview.paint(color.value(), shape.value(), name.value);

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
    busy = true;
    submit.disabled = true;
    label.textContent = options.busyLabel;
    error.textContent = "";
    const problem = await options.onSubmit({
      name: value,
      color: color.value(),
      shape: shape.value(),
      note: note.value.trim(),
    });
    busy = false;
    submit.disabled = false;
    label.textContent = options.submitLabel;
    if (problem) error.textContent = problem;
  });

  return { el: form, focus: () => name.focus({ preventScroll: true }) };
}

/** A labeled checkbox row with a 44px tap target. */
export function checkRow(id: string, text: string, hint: string | null, checked: boolean) {
  const input = h("input", { class: "check-input", attrs: { type: "checkbox", id, checked } });
  const el = h(
    "label",
    { class: "check-row", attrs: { for: id } },
    input,
    h(
      "span",
      { class: "check-text" },
      h("span", { class: "check-label", text }),
      hint ? h("span", { class: "check-hint", text: hint }) : null,
    ),
  );
  return { el, input };
}
