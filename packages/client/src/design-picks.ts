/**
 * The designs a new home can start from (RFC 0032), drawn as they'd stand on your plot: the home
 * sheet loads this with `import()`, so their maps never ride in the world's own code. A pick is a
 * design and its walls; the server builds it with `build`'s `design`, as an assistant's would.
 */
import {
  DESIGNS,
  type DesignId,
  type DesignView,
  designToPlan,
  designViews,
  type PlotMapView,
} from "@terrakin/protocol";
import type { BlockKind, Season, WorldConfig } from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { mapThumb } from "./design-thumb";

export interface DesignChoice {
  design: DesignId;
  walls: BlockKind;
}

/** A design's map in the walls picked, where it takes them, else in its own first walls. */
function drawn(view: DesignView, walls: BlockKind): PlotMapView {
  const design = DESIGNS.find((d) => d.id === view.id);
  const choices = view.options.walls.includes(walls) ? { walls } : {};
  const out = design && designToPlan(design, choices);
  if (!out || "problem" in out) return view.map;
  return {
    floors: out.map.floors.map((f) => ({
      floor: f.floor ?? 0,
      blocks: f.blocks ?? [],
      ground: f.ground ?? [],
      ...(f.edges ? { edges: f.edges } : {}),
    })),
  };
}

/** A wall material in words, for its chip. */
const WALL_WORDS: Partial<Record<BlockKind, string>> = { wood: "Wood", stone: "Stone" };

/**
 * The picker: a row of the designs drawn on your plot in the walls picked, scrolling sideways on a
 * phone, the first picked, what the picked one is, and its wall materials. `choice()` says what's
 * picked now.
 */
export function designPicker(
  where: { config: WorldConfig; season?: Season | undefined },
  plot: { px: number; py: number },
): { element: HTMLElement; choice: () => DesignChoice } {
  const designs: readonly DesignView[] = designViews().designs;
  const first = designs[0];
  if (!first) throw new Error("no designs");
  let picked: DesignView = first;
  let walls: BlockKind = first.options.walls[0] ?? "wood";
  const about = h("p", { class: "field-hint design-about" });
  const wallRow = h("div", {
    class: "pick-row design-walls",
    attrs: { role: "group", "aria-label": "Walls" },
  });
  const buttons = designs.map((d) => {
    const button = h(
      "button",
      {
        class: "design-pick",
        attrs: { type: "button", "data-design": d.id, "aria-pressed": String(d === picked) },
      },
      mapThumb(where, plot, drawn(d, walls), undefined, 88),
      h("span", { class: "design-name", text: d.name }),
    );
    button.addEventListener("click", () => {
      picked = d;
      if (!d.options.walls.includes(walls)) walls = d.options.walls[0] ?? "wood";
      paint();
    });
    return button;
  });
  /** The walls the pictures were last drawn in. */
  let drawnIn = walls;
  function paint() {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.design === picked.id));
    if (walls !== drawnIn) {
      drawnIn = walls;
      for (const [i, d] of designs.entries()) {
        buttons[i]
          ?.querySelector("canvas")
          ?.replaceWith(mapThumb(where, plot, drawn(d, walls), undefined, 88));
      }
    }
    about.textContent = picked.about;
    wallRow.replaceChildren(
      h("span", { class: "design-walls-label", text: "Walls" }),
      ...picked.options.walls.map((kind) => {
        const chip = h("button", {
          attrs: { type: "button", "data-walls": kind, "aria-pressed": String(kind === walls) },
          text: WALL_WORDS[kind] ?? kind,
        });
        chip.addEventListener("click", () => {
          walls = kind;
          paint();
        });
        return chip;
      }),
    );
  }
  paint();
  const element = h(
    "div",
    { class: "stack design-picker" },
    h(
      "div",
      { class: "pick-row design-picks", attrs: { role: "group", "aria-label": "Designs" } },
      ...buttons,
    ),
    about,
    wallRow,
  );
  return {
    element,
    choice: () => ({ design: picked.id, walls }),
  };
}
