/**
 * The roof picker (RFC 0041): what the Roof chip on the build bar's floors row opens, for someone
 * standing on a plot they can build on. A roof is chosen, not built, so this is two rows of chips,
 * a style and a covering, and a line saying what the covering takes. The server decides: the sheet
 * sends `set_roof` and says what came back, and nothing here checks a rule the sim doesn't own.
 */
import type { BlockKind, RoofStyle } from "@terrakin/sim";
import { BLOCK_COLORS, isMaterialKind, ROOFS } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { itemArt } from "@terrakin/ui/item-art";
import {
  chips,
  closeOverlay,
  errorLine,
  openOverlay,
  overlayShowing,
  sheet,
  whileBusy,
} from "@terrakin/ui/ui";
import { actProblem, worldApi } from "./api/world";
import type { Holdings } from "./build-palette";
import {
  ROOF_PICKS,
  ROOF_STYLE_ABOUT,
  ROOF_STYLE_WORDS,
  type RoofChoice,
  roofChoices,
  roofLine,
  roofMaterialName,
} from "./roofs";
import "./roof-sheet.css";

export interface RoofSheetOptions {
  px: number;
  py: number;
  /** The roof the plot has now, from the mirror. */
  roof?: { style: RoofStyle; material: BlockKind } | undefined;
  holdings: Holdings;
  /** Where to say it worked: the world has its own toast. */
  say: (text: string) => void;
}

/** A covering's chip: its picture for a made material, a block of its color for a free one. */
function materialChip(choice: RoofChoice): Node[] {
  const chip = h("span", { class: "chip roof-swatch" });
  if (isMaterialKind(choice.kind)) chip.append(itemArt(choice.kind, { size: 26 }));
  else chip.style.background = BLOCK_COLORS[choice.kind];
  return [chip, h("span", { class: "roof-chip-name", text: roofMaterialName(choice.kind) })];
}

/** Pick the roof over plot (px, py), or take it down. */
export function openRoofSheet(o: RoofSheetOptions) {
  const choices = roofChoices(o.holdings, o.roof?.material);
  let style: RoofStyle = o.roof?.style ?? "gable";
  let material: BlockKind = o.roof?.material ?? "wood";
  const about = h("p", { class: "roof-about", text: ROOF_STYLE_ABOUT[style] });
  const line = h("p", { class: "palette-line", attrs: { "aria-live": "polite" } });
  const error = errorLine("roof-error");
  const set = h("button", {
    class: "btn-primary",
    attrs: { type: "button", id: "roof-set" },
    text: "Put it up",
  });
  const chosen = () => choices.find((c) => c.kind === material);

  function say() {
    const c = chosen();
    about.textContent = ROOF_STYLE_ABOUT[style];
    line.textContent = style === "flat" || !c ? "" : roofLine(c);
    set.textContent = style === "flat" ? "Take it down" : o.roof ? "Change it" : "Put it up";
    materials.hidden = style === "flat";
    // The roof it has already is the one the sheet opens on, and the world would refuse it, so
    // the button waits for a change rather than answering "That's the roof it has already."
    set.disabled = o.roof?.style === style && o.roof.material === material;
  }

  const styleRow = chips(
    [...ROOF_PICKS],
    style,
    (s) => [h("span", { text: ROOF_STYLE_WORDS[s] })],
    (s) => {
      style = s;
      say();
    },
    h("div", { class: "pick-row roof-styles" }),
  ).row;
  styleRow.setAttribute("aria-label", "Roof shapes");

  const materialRow = chips(
    choices.map((c) => c.kind),
    material,
    (kind) => materialChip(choices.find((c) => c.kind === kind) as RoofChoice),
    (kind) => {
      material = kind;
      say();
    },
    h("div", { class: "pick-row roof-materials" }),
    (kind) => (choices.find((c) => c.kind === kind)?.short ? "dim" : undefined),
  ).row;
  materialRow.setAttribute("aria-label", "Roof coverings");
  const materials = h(
    "div",
    { class: "stack roof-covering" },
    h("p", { class: "field-label", text: "Covered in" }),
    materialRow,
  );

  const s = sheet(
    {
      id: "roof-title",
      title: "Your roof",
      className: "roof-sheet",
      closeOnBackdrop: true,
      lede: `A roof is a look, not a build: pick one and it covers whatever walls your home's top floor has. It takes ${ROOFS.blocks} of its covering, which comes back when you change your mind, and a free block costs nothing. Stand on your plot and it lifts away, so you can still see inside.`,
    },
    styleRow,
    about,
    materials,
    line,
    error,
    h("div", { class: "cluster roof-actions" }, set),
  );
  say();

  set.addEventListener("click", () => {
    void (async () => {
      error.textContent = "";
      const r = await whileBusy(set, () =>
        worldApi.act({
          type: "set_roof",
          px: o.px,
          py: o.py,
          style,
          ...(style === "flat" ? {} : { material }),
        }),
      );
      const problem = actProblem(r);
      if (problem) {
        if (overlayShowing(s.dialog)) error.textContent = problem;
        else o.say(problem);
        return;
      }
      closeOverlay(s.dialog);
      o.say(
        style === "flat"
          ? "Your roof is down."
          : `Your home has a ${ROOF_STYLE_WORDS[style].toLowerCase()} roof of ${roofMaterialName(material).toLowerCase()}.`,
      );
    })();
  });
  openOverlay(s.dialog);
  return s;
}
