/**
 * The sheet a surface or a wall opens in the world (RFC 0050): what stands on the surface or hangs
 * on that wall face, and who put it there, or, on your own plot, which of your things to put there.
 * It only sends actions; the server decides, and its answer shows as a toast in the world. Labels
 * and names are other residents' words: text only.
 */
import type { Action, Side } from "@terrakin/protocol";
import {
  type BlockKind,
  CATALOG,
  isFindKind,
  type StackKind,
  TRINKET_KINDS,
  WALL_DECOR_KINDS,
} from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { itemArt, thingPicture } from "@terrakin/ui/item-art";
import { closeOverlay, errorLine, itemRow, itemRows, openOverlay, sheet } from "@terrakin/ui/ui";
import { inventoryApi } from "./api/inventory";
import { shownName } from "./display-sheet";
import type { ShownOnHome } from "./mirror";
import { thingCount, thingName } from "./things";

export interface RoomSheetOptions {
  /** A surface's tile, or the tile a wall face is seen from. */
  x: number;
  y: number;
  floor: number;
  /** The surface's block, or the wall face's side. */
  place: { surface: BlockKind } | { side: Side };
  /** What stands or hangs there now, as the world shows it. */
  shown?: ShownOnHome | undefined;
  /** Whether the tile is on a plot you own or share, as the world shows it. */
  yours: boolean;
  /** Your resident id, if you're in the world. */
  me: string | undefined;
  /** A resident's name from the world. Their own words: text only. */
  nameOf: (id: string) => string | undefined;
  /** Send an action. Undefined means it wasn't sent: the world isn't connected. */
  act: (action: Action) => string | undefined;
}

const SIDE_WORDS: Readonly<Record<Side, string>> = {
  n: "north",
  e: "east",
  s: "south",
  w: "west",
};

/** What the kinds you can put in this place are: trinkets on a surface, wall things on a wall. */
const kindsFor = (onWall: boolean): readonly StackKind[] =>
  onWall ? WALL_DECOR_KINDS : TRINKET_KINDS;

export function openRoomSheet(o: RoomSheetOptions) {
  const onWall = "side" in o.place;
  const title =
    "side" in o.place
      ? `The ${SIDE_WORDS[o.place.side]} wall`
      : (CATALOG[o.place.surface as keyof typeof CATALOG]?.name ?? "Surface");
  const floor = o.floor === 0 ? {} : { floor: o.floor };
  const where =
    "side" in o.place
      ? { x: o.x, y: o.y, side: o.place.side, ...floor }
      : { x: o.x, y: o.y, ...floor };
  const problem = errorLine("room-error");
  const body = h("div", { class: "stack room-body" });
  const s = sheet(
    { id: "room-title", title, className: "room-sheet", closeOnBackdrop: true },
    body,
    problem,
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
    const name = shown.good
      ? shownName(shown.good)
      : thingName((shown.find ?? shown.thing) as StackKind);
    const picture = shown.good
      ? thingPicture(shown.good, { size: 120, className: "showcase-art", title: name })
      : itemArt((shown.find ?? shown.thing) as StackKind, {
          size: 120,
          className: "showcase-art",
          title: name,
        });
    const by = o.nameOf(shown.by);
    const canTake = o.yours || (o.me !== undefined && o.me === shown.by);
    body.append(
      h(
        "figure",
        { class: "stack tight showcase" },
        picture,
        h(
          "figcaption",
          { class: "stack tight showcase-caption" },
          h("span", { class: "showcase-name", text: name }),
          by ? h("span", { class: "showcase-line", text: `Put here by ${by}` }) : null,
        ),
      ),
      ...(canTake
        ? [
            h("button", {
              class: "pill-button small",
              attrs: { type: "button", id: "room-take" },
              text: onWall ? "Take down" : "Take off",
              on: {
                click: () =>
                  send(
                    "side" in where ? { type: "unhang", ...where } : { type: "take_off", ...where },
                  ),
              },
            }),
          ]
        : []),
    );
    openOverlay(s.dialog);
    return;
  }

  if (!o.yours) {
    body.append(h("p", { class: "sheet-lede", text: "Nothing here yet." }));
    openOverlay(s.dialog);
    return;
  }
  const hint = h("p", { class: "sheet-lede", text: "Looking in your things…" });
  const list = itemRows([], { className: "room-list" });
  body.append(hint, list);
  openOverlay(s.dialog);
  void inventoryApi.inventory().then((r) => {
    if (!r.ok) {
      hint.textContent = r.message;
      return;
    }
    const kinds = kindsFor(onWall);
    const goods = r.data.inventory?.goods ?? [];
    // Only plain stacks: a graded stack is a made material (RFC 0051), which nothing puts on a
    // surface or hangs on a wall, so its own entry is never one to offer here.
    const stacks = (r.data.inventory?.stacks ?? []).filter(
      (st) => st.grade === undefined && (kinds.includes(st.kind) || isFindKind(st.kind)),
    );
    hint.textContent =
      goods.length + stacks.length > 0
        ? onWall
          ? "Pick something to hang here."
          : "Pick something to put on it."
        : onWall
          ? "You have nothing to hang yet. The shop sells clocks, mirrors, wreaths and more, and anything you made or a find hangs too."
          : "You have nothing to put on it yet. The shop sells candles, lamps, books and more, and anything you made or a find stands here too.";
    const put = (item: string) =>
      h("button", {
        class: "btn-primary small",
        attrs: { type: "button" },
        text: onWall ? "Hang" : "Put on",
        on: {
          click: () =>
            send(
              "side" in where
                ? { type: "hang", ...where, item }
                : { type: "put_on", ...where, item },
            ),
        },
      });
    list.replaceChildren(
      ...stacks.map((st) =>
        itemRow({
          className: "workshop-row",
          plain: true,
          lead: itemArt(st.kind, { size: 32 }),
          name: thingName(st.kind),
          lines: [`You have ${thingCount(st.kind, st.count)}`],
          trail: put(st.kind),
        }),
      ),
      ...goods.map((g) =>
        itemRow({
          className: "workshop-row",
          plain: true,
          lead: thingPicture(g, { size: 32 }),
          name: shownName(g),
          lines: [g.maker ? `Made by ${g.maker.name}` : null],
          trail: put(g.id),
        }),
      ),
    );
  });
}
