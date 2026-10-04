/**
 * "Your look": pick a theme, a pattern, and up to three things to wear, with a live preview, or
 * bring your own pattern, home picture, and home model as uploads. Saves with the `profile`
 * action; the server checks every choice and every upload.
 */
import type { LookView, MediaView } from "@terrakin/protocol";
import {
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
  type WearItem,
  type WearSlot,
} from "@terrakin/sim";
import { api, uploadMedia } from "./api";
import { h, icon } from "./dom";
import { type FullLook, paintFigure } from "./figure";
import { lookImage, lookPalette, mediaUrlOf, onLookImage, PatternCache } from "./looks";
import { closeOverlay, openOverlay, toast } from "./ui";

export interface LookOwner {
  color: ResidentColor;
  shape: ResidentShape;
  look?: LookView | undefined;
}

const SLOT_LABELS: Record<WearSlot, string> = { hat: "Hat", top: "Top", accessory: "Carry" };
const IMAGE_TYPES = "image/png,image/jpeg,image/webp";

type MediaKey = "patternMedia" | "homeArt" | "homeModel";
type Draft = {
  theme: Theme | null;
  pattern: Pattern | null;
  wear: WearItem[];
  patternMedia: string | null;
  homeArt: string | null;
  homeModel: string | null;
};

const thumbs = new PatternCache();

function draftOf(look: LookView | undefined): Draft {
  return {
    theme: look?.theme ?? null,
    pattern: look?.pattern ?? null,
    wear: [...(look?.wear ?? [])],
    patternMedia: look?.patternMedia ?? null,
    homeArt: look?.homeArt ?? null,
    homeModel: look?.homeModel ?? null,
  };
}

/** Only the fields that changed, ready for the profile action. */
export function lookChanges(before: LookView | undefined, after: Draft): Partial<Draft> {
  const old = draftOf(before);
  const out: Partial<Draft> = {};
  if (old.theme !== after.theme) out.theme = after.theme;
  if (old.pattern !== after.pattern) out.pattern = after.pattern;
  if ([...old.wear].sort().join() !== [...after.wear].sort().join()) out.wear = after.wear;
  for (const key of ["patternMedia", "homeArt", "homeModel"] as const) {
    if (old[key] !== after[key]) out[key] = after[key];
  }
  return out;
}

/** The look as a view: unset fields left out. */
function viewOf(d: Draft): LookView {
  return {
    ...(d.theme ? { theme: d.theme } : {}),
    ...(d.pattern ? { pattern: d.pattern } : {}),
    ...(d.wear.length ? { wear: [...d.wear] } : {}),
    ...(d.patternMedia ? { patternMedia: d.patternMedia } : {}),
    ...(d.homeArt ? { homeArt: d.homeArt } : {}),
    ...(d.homeModel ? { homeModel: d.homeModel } : {}),
  };
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
  });

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

  // ---- pattern ----
  const patternRow = h("div", { class: "look-chips" });
  const patternThumbs = new Map<Pattern, HTMLCanvasElement>();
  const patternButtons = new Map<Pattern, HTMLButtonElement>();
  for (const pattern of PATTERNS) {
    const canvas = h("canvas", { class: "look-chip-thumb", attrs: { "aria-hidden": "true" } });
    patternThumbs.set(pattern, canvas);
    const b = h(
      "button",
      {
        class: "look-chip",
        attrs: { type: "button", "data-pattern": pattern },
        on: {
          click: () => {
            draft.pattern = pattern;
            draft.patternMedia = null;
            paint();
          },
        },
      },
      canvas,
      h("span", { text: PATTERN_LABELS[pattern] }),
    );
    patternButtons.set(pattern, b);
    patternRow.append(b);
  }

  // ---- wear ----
  const wearButtons = new Map<string, HTMLButtonElement>();
  const wearRows = (["hat", "top", "accessory"] as const).map((slot) => {
    const row = h("div", { class: "look-chips" });
    const items: (WearItem | null)[] = [
      null,
      ...WEAR_ITEMS.filter((w) => WEAR_INFO[w].slot === slot),
    ];
    for (const item of items) {
      const b = h("button", {
        class: "look-chip text",
        attrs: { type: "button", "data-wear": item ?? `none-${slot}` },
        text: item ? WEAR_INFO[item].label : "None",
        on: {
          click: () => {
            draft.wear = draft.wear.filter((w) => WEAR_INFO[w].slot !== slot);
            if (item) draft.wear.push(item);
            paint();
          },
        },
      });
      wearButtons.set(item ?? `none-${slot}`, b);
      row.append(b);
    }
    return h(
      "div",
      { class: "look-wear-row" },
      h("p", { class: "look-sub", text: SLOT_LABELS[slot] }),
      row,
    );
  });

  // ---- bring your own ----
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
          draft[key] = null;
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
      const result = await uploadMedia(file, (f) => {
        status.textContent = `Uploading ${Math.round(f * 100)}%`;
      }).promise;
      add.disabled = false;
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
      if (key === "patternMedia") draft.pattern = null;
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
    const palette = lookPalette(draft.theme ?? undefined, owner.color);
    for (const [theme, b] of themeButtons)
      b.setAttribute("aria-pressed", String(theme === draft.theme));
    for (const [pattern, b] of patternButtons) {
      const on = !draft.patternMedia && (draft.pattern ?? "plain") === pattern;
      b.setAttribute("aria-pressed", String(on));
    }
    for (const [pattern, canvas] of patternThumbs) {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const px = Math.round(28 * dpr);
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = palette.main;
      ctx.fillRect(0, 0, px, px);
      const fill = thumbs.named(ctx, pattern, palette, px / 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, px, px);
      }
    }
    for (const [key, b] of wearButtons) {
      const on = key.startsWith("none-")
        ? !draft.wear.some((w) => WEAR_INFO[w].slot === key.slice(5))
        : draft.wear.includes(key as WearItem);
      b.setAttribute("aria-pressed", String(on));
    }
    for (const row of mediaRows) row.repaint();
    const parts = [
      draft.theme ? THEME_INFO[draft.theme].label : "Your color",
      draft.patternMedia
        ? "your own pattern"
        : PATTERN_LABELS[draft.pattern ?? "plain"].toLowerCase(),
      ...draft.wear.map((w) => WEAR_INFO[w].label.toLowerCase()),
    ];
    summary.textContent = parts.join(", ");
  }
  const stopImages = onLookImage(paint);
  // Start loading a custom pattern so the preview can show it.
  lookImage(draft.patternMedia ?? undefined);

  // ---- save ----
  const error = h("p", { class: "error", attrs: { role: "alert" } });
  const saveLabel = h("span", { text: "Save my look" });
  const save = h(
    "button",
    { class: "btn-primary look-save", attrs: { type: "button" } },
    saveLabel,
  );
  const form = h(
    "form",
    { class: "look-form", attrs: { novalidate: true } },
    section("Theme", "Colors for your clothes, your plot, and your blocks.", themeRow),
    section("Pattern", null, patternRow),
    section("Wear", "Up to three, one of each.", ...wearRows),
    section(
      "Make it yours",
      "Bring your own art. Uploads are public, like a post.",
      ...mediaRows.map((r) => r.el),
    ),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const changes = lookChanges(owner.look, draft);
    if (Object.keys(changes).length === 0) {
      closeOverlay();
      return;
    }
    save.disabled = true;
    saveLabel.textContent = "Saving…";
    error.textContent = "";
    const result = await api.act({ type: "profile", ...changes });
    save.disabled = false;
    saveLabel.textContent = "Save my look";
    // A 200 can still be the world saying no (an unknown theme, an upload that isn't yours).
    if (!result.ok || !result.data.ok) {
      error.textContent = result.ok
        ? result.data.ok
          ? ""
          : result.data.error.message
        : result.message;
      return;
    }
    const look = viewOf(draft);
    owner.look = look;
    toast("Look saved");
    onSaved(look);
    closeOverlay();
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
    { class: "look-editor", attrs: { "aria-labelledby": "look-title" } },
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
  openOverlay(dialog, stopImages);
  closeBtn.focus();
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
