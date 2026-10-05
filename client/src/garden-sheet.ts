/**
 * The sheet a planter, kitchen, or workbench opens in the world (RFC 0005): plant a seed you
 * hold, pick a ready crop, or make something. It only sends actions; the server decides, and its
 * answer shows as a toast in the world. A button your things already show the server would turn
 * down (an unripe crop, missing ingredients, today's making done) is off, with the reason in its
 * row. Labels are your own words, sent as text.
 */
import { type Action, type InventoryResponse, ITEM_CATALOG, ITEM_RULES } from "@terrakin/protocol";
import { type BlockKind, type Crop, harvestFits, isReady } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { closeOverlay, errorLine, itemRow, itemRows, openOverlay, sheet } from "@terrakin/ui/ui";
import { api } from "./api";
import {
  cropOfSeed,
  growthLine,
  missingLine,
  needsLine,
  noSeedsHint,
  thingCount,
  thingName,
} from "./things";

export interface TileSheetOptions {
  block: BlockKind;
  x: number;
  y: number;
  /** What grows in the planter, as the world shows it. */
  planting?: { crop: Crop; readyDay: number };
  day: number | undefined;
  /** Whether the tile is on a plot you own or share, as the world shows it. */
  yours: boolean;
  /** Whose plot it is otherwise. Their own words: text only. */
  ownerName?: string;
  /** Send an action. Undefined means it wasn't sent: the world isn't connected. */
  act: (action: Action) => string | undefined;
}

const title = (block: BlockKind) =>
  block === "planter" ? "Planter" : block === "kitchen" ? "Kitchen" : "Workbench";

/** A row with a name, a line under it, and one button (none on someone else's planter). */
function row(name: string, line: string, button: HTMLButtonElement | null): HTMLLIElement {
  return itemRow({ className: "workshop-row", plain: true, name, lines: [line], trail: button });
}

export function openTileSheet(o: TileSheetOptions) {
  const list = itemRows([], { className: "workshop-list" });
  const hint = h("p", { class: "sheet-lede workshop-hint", text: "Looking in your things…" });
  const things = h(
    "a",
    { class: "pill-button small workshop-things", attrs: { href: "/inventory" } },
    h("span", { text: "All your things" }),
    icon("arrow"),
  );
  // No closeOverlay here: the router closes the sheet as it goes, and takes over its history
  // entry, so the URL and the page stay in step.
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
  const problem = errorLine("workshop-error");
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
    problem,
    things,
  );
  const send = (action: Action) => {
    // Not connected: keep the sheet open and say so, rather than drop the tap.
    if (o.act(action) === undefined) {
      problem.textContent = "Not connected yet. Try again in a moment.";
      return;
    }
    closeOverlay(s.dialog);
  };
  /** A button, or an off one when `ok` is false: its row says why. */
  const button = (text: string, action: () => Action, ok = true) =>
    h("button", {
      class: ok ? "btn-primary small" : "pill-button small",
      attrs: { type: "button", disabled: !ok },
      text,
      on: { click: () => send(action()) },
    });

  function paint(data: InventoryResponse) {
    const inv = data.inventory;
    if (!inv) {
      hint.textContent = "Growing and making aren't open in this world yet.";
      return;
    }
    const { rules } = data;
    const held = new Map(inv.stacks.map((st) => [st.kind, st.count]));
    if (o.block === "planter") {
      // Only the plot's owner, and whoever they share it with, plant and pick here.
      if (!o.yours) {
        hint.textContent = o.ownerName
          ? `This planter is on ${o.ownerName}'s plot. Only they and the people they share it with can plant or pick here.`
          : "This planter isn't on anyone's plot, so nobody can plant here.";
        list.replaceChildren(
          ...(o.planting
            ? [row(thingName(o.planting.crop), growthLine(o.planting.readyDay, inv.day), null)]
            : []),
        );
        return;
      }
      if (o.planting) {
        const ready = growthLine(o.planting.readyDay, inv.day);
        // The sim's own checks, so the sheet never disagrees with what harvest would answer.
        const ripe = isReady(o.planting.readyDay, inv.day);
        const full = !harvestFits(inv.size, o.planting.crop);
        hint.textContent = `${thingName(o.planting.crop)}: ${ready.toLowerCase()}.`;
        list.replaceChildren(
          row(
            thingName(o.planting.crop),
            ripe && full ? "Your bag is full. Make or give something first." : ready,
            button("Harvest", () => ({ type: "harvest", x: o.x, y: o.y }), ripe && !full),
          ),
        );
        return;
      }
      const seeds = inv.stacks.filter((st) => cropOfSeed(st.kind) !== undefined);
      hint.textContent =
        seeds.length > 0
          ? "Pick a seed to plant. It grows a little each day, at midnight UTC."
          : noSeedsHint(inv);
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
    const doneToday = inv.craftedToday >= rules.craftPerDay;
    hint.textContent = doneToday
      ? `You've made ${inv.craftedToday} things today, the most for one day. Come back tomorrow.`
      : `What you make here keeps your name. Up to ${rules.craftPerDay} a day.`;
    list.replaceChildren(
      ...recipes.map((r) => {
        const short = missingLine(r.needs, (kind) => held.get(kind) ?? 0);
        const enough = short === null && !doneToday;
        return row(
          r.name,
          doneToday
            ? `You've made ${inv.craftedToday} today`
            : (short ?? `Uses ${needsLine(r.recipe)}`),
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
