/**
 * The sheet a planter, kitchen, or workbench opens in the world (RFC 0005): plant a seed you
 * hold, pick a ready crop, or make something. It only sends actions; the server decides, and its
 * answer shows as a toast in the world. Labels are your own words, sent as text.
 */
import { type Action, type InventoryResponse, ITEM_CATALOG, ITEM_RULES } from "@terrakin/protocol";
import type { BlockKind, Crop } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { closeOverlay, openOverlay, sheet } from "@terrakin/ui/ui";
import { api } from "./api";
import { cropOfSeed, growthLine, needsLine, thingCount, thingName } from "./things";

export interface TileSheetOptions {
  block: BlockKind;
  x: number;
  y: number;
  /** What grows in the planter, as the world shows it. */
  planting?: { crop: Crop; readyDay: number };
  day: number | undefined;
  act: (action: Action) => void;
}

const title = (block: BlockKind) =>
  block === "planter" ? "Planter" : block === "kitchen" ? "Kitchen" : "Workbench";

/** A row with a name, a line under it, and one button. */
function row(name: string, line: string, button: HTMLButtonElement): HTMLElement {
  return h(
    "li",
    { class: "workshop-row" },
    h(
      "span",
      { class: "workshop-row-body" },
      h("span", { class: "workshop-row-name", text: name }),
      h("span", { class: "workshop-row-line", text: line }),
    ),
    button,
  );
}

export function openTileSheet(o: TileSheetOptions) {
  const list = h("ul", { class: "workshop-list" });
  const hint = h("p", { class: "sheet-lede workshop-hint", text: "Looking in your things…" });
  const things = h(
    "a",
    { class: "pill-button small workshop-things", attrs: { href: "/inventory" } },
    h("span", { text: "All your things" }),
    icon("arrow"),
  );
  things.addEventListener("click", () => closeOverlay());
  const label = h("input", {
    class: "field-input",
    attrs: {
      id: "workshop-label",
      maxlength: ITEM_RULES.labelMax,
      placeholder: "Sunny jar",
      autocomplete: "off",
    },
  });
  const station = o.block === "kitchen" || o.block === "workbench";
  const labelField = station
    ? h(
        "div",
        { class: "workshop-label" },
        h("label", {
          class: "field-label",
          attrs: { for: "workshop-label" },
          text: "Label it (optional)",
        }),
        label,
      )
    : null;
  const s = sheet(
    {
      id: "workshop-title",
      title: title(o.block),
      className: "workshop-sheet",
      closeOnBackdrop: true,
    },
    hint,
    labelField,
    list,
    things,
  );
  const send = (action: Action) => {
    o.act(action);
    closeOverlay();
  };
  const button = (text: string, action: () => Action, primary = true) =>
    h("button", {
      class: primary ? "btn-primary small" : "pill-button small",
      attrs: { type: "button" },
      text,
      on: { click: () => send(action()) },
    });

  function paint(data: InventoryResponse) {
    const inv = data.inventory;
    if (!inv) {
      hint.textContent = "Growing and making aren't open in this world yet.";
      return;
    }
    const held = new Map(inv.stacks.map((st) => [st.kind, st.count]));
    if (o.block === "planter") {
      if (o.planting) {
        const ready = growthLine(o.planting.readyDay, o.day);
        hint.textContent = `${thingName(o.planting.crop)}: ${ready.toLowerCase()}.`;
        list.replaceChildren(
          row(
            thingName(o.planting.crop),
            ready,
            button(
              "Harvest",
              () => ({ type: "harvest", x: o.x, y: o.y }),
              ready === "Ready to pick",
            ),
          ),
        );
        return;
      }
      const seeds = inv.stacks.filter((st) => cropOfSeed(st.kind) !== undefined);
      hint.textContent =
        seeds.length > 0
          ? "Pick a seed to plant. It grows a little each day, at midnight UTC."
          : "You have no seeds. Come home to your hearth: your first pantry brings some.";
      list.replaceChildren(
        ...seeds.map((st) => {
          const crop = cropOfSeed(st.kind) as Crop;
          const info = ITEM_CATALOG.crops.find((c) => c.crop === crop);
          return row(
            thingName(crop),
            `${thingCount(st.kind, st.count)}. Ready in ${info?.days ?? "a few"} days.`,
            button("Plant", () => ({ type: "plant", x: o.x, y: o.y, seed: crop })),
          );
        }),
      );
      return;
    }
    const recipes = ITEM_CATALOG.recipes.filter((r) => r.station === o.block);
    hint.textContent = `What you make here keeps your name. Up to ${ITEM_RULES.craftPerDay} a day.`;
    list.replaceChildren(
      ...recipes.map((r) => {
        const enough = r.needs.every((n) => (held.get(n.kind) ?? 0) >= n.count);
        return row(
          r.name,
          `Needs ${needsLine(r.recipe)}`,
          button(
            "Make",
            () => {
              const text = label.value.trim();
              return {
                type: "craft",
                recipe: r.recipe,
                x: o.x,
                y: o.y,
                ...(text ? { label: text } : {}),
              };
            },
            enough,
          ),
        );
      }),
    );
  }

  openOverlay(s.dialog);
  void api.inventory().then((r) => {
    if (!r.ok) {
      hint.textContent = r.message;
      return;
    }
    paint(r.data);
  });
}
