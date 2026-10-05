/**
 * The sheet a pedestal or a frame opens in the world (RFC 0005 step 3): what's on display there,
 * who made it and who put it up, or, on your own plot, which of your made things to put up. It only
 * sends actions; the server decides, and its answer shows as a toast in the world. Labels, titles,
 * and names are other residents' words: text only.
 */
import type { Action, GoodView } from "@terrakin/protocol";
import type { BlockKind } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { thingPicture } from "@terrakin/ui/item-art";
import { closeOverlay, errorLine, itemRow, itemRows, openOverlay, sheet } from "@terrakin/ui/ui";
import { api } from "./api";
import type { DisplayView } from "./mirror";
import { thingName } from "./things";

export interface DisplaySheetOptions {
  block: BlockKind;
  x: number;
  y: number;
  /** What's on display there, as the world shows it. */
  shown?: DisplayView;
  /** Whether the tile is on a plot you own or share, as the world shows it. */
  yours: boolean;
  /** Your resident id, if you're in the world. */
  me: string | undefined;
  /** A resident's name from the world, for "Made by". Their own words: text only. */
  nameOf: (id: string) => string | undefined;
  /** Send an action. Undefined means it wasn't sent: the world isn't connected. */
  act: (action: Action) => string | undefined;
}

/** A made thing's name and, when it has one, its label or title in quotes. */
export function shownName(good: Pick<GoodView, "kind" | "label">): string {
  return good.label ? `${thingName(good.kind)} “${good.label}”` : thingName(good.kind);
}

export function openDisplaySheet(o: DisplaySheetOptions) {
  const where = o.block === "frame" ? "Frame" : "Pedestal";
  const problem = errorLine("display-error");
  const body = h("div", { class: "stack display-body" });
  const things = h(
    "a",
    { class: "pill-button small workshop-things", attrs: { href: "/inventory" } },
    h("span", { text: "All your things" }),
    icon("arrow"),
  );
  const s = sheet(
    { id: "display-title", title: where, className: "display-sheet", closeOnBackdrop: true },
    body,
    problem,
    o.yours ? things : null,
  );
  const send = (action: Action) => {
    // Not connected: keep the sheet open and say so, rather than drop the tap.
    if (o.act(action) === undefined) {
      problem.textContent = "Not connected yet. Try again in a moment.";
      return;
    }
    closeOverlay(s.dialog);
  };

  const shown = o.shown;
  if (shown) {
    const good = shown.good;
    const maker = o.nameOf(good.maker);
    const by = o.nameOf(shown.by);
    const lines = [
      maker ? `Made by ${maker}` : "Made by a resident",
      shown.by !== good.maker && by ? `Put up by ${by}` : null,
    ];
    const canTakeDown = o.yours || (o.me !== undefined && o.me === shown.by);
    body.append(
      h(
        "figure",
        { class: "stack tight showcase" },
        thingPicture(good, { size: 160, className: "showcase-art", title: shownName(good) }),
        h(
          "figcaption",
          { class: "stack tight showcase-caption" },
          h("span", { class: "showcase-name", text: shownName(good) }),
          ...lines.flatMap((line) =>
            line ? [h("span", { class: "showcase-line", text: line })] : [],
          ),
        ),
      ),
      ...(canTakeDown
        ? [
            h("button", {
              class: "pill-button small",
              attrs: { type: "button", id: "display-take-down" },
              text: "Take down",
              on: { click: () => send({ type: "take_down", x: o.x, y: o.y }) },
            }),
          ]
        : []),
    );
    openOverlay(s.dialog);
    return;
  }

  if (!o.yours) {
    body.append(h("p", { class: "sheet-lede", text: "Nothing on display here yet." }));
    openOverlay(s.dialog);
    return;
  }
  const hint = h("p", { class: "sheet-lede", text: "Looking in your things…" });
  const list = itemRows([], { className: "display-list" });
  body.append(hint, list);
  openOverlay(s.dialog);
  void api.inventory().then((r) => {
    if (!r.ok) {
      hint.textContent = r.message;
      return;
    }
    const goods = r.data.inventory?.goods ?? [];
    hint.textContent =
      goods.length > 0
        ? "Pick something to show. Everyone who passes can see it."
        : "You have nothing to show yet. Make something at a kitchen or a workbench, or turn one of your pictures into a piece of art on your things page.";
    list.replaceChildren(
      ...goods.map((g) =>
        itemRow({
          className: "workshop-row",
          plain: true,
          lead: thingPicture(g, { size: 32 }),
          name: shownName(g),
          lines: [g.maker ? `Made by ${g.maker.name}` : null],
          trail: h("button", {
            class: "btn-primary small",
            attrs: { type: "button" },
            text: "Display",
            on: { click: () => send({ type: "display", item: g.id, x: o.x, y: o.y }) },
          }),
        }),
      ),
    );
  });
}
