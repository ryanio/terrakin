/**
 * The sheet a pedestal or a frame opens in the world (RFC 0005 step 3): what's on display there,
 * who made it and who put it up, or, on your own plot, which of your made things and finds to put
 * up. It only sends actions; the server decides, and its answer shows as a toast in the world.
 * Labels, titles, and names are other residents' words: text only.
 */
import { type Action, COLLECTION_WORDS, type GoodView } from "@terrakin/protocol";
import { type BlockKind, CATALOG, isFindKind } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { itemArt, thingPicture } from "@terrakin/ui/item-art";
import { closeOverlay, errorLine, itemRow, itemRows, openOverlay, sheet } from "@terrakin/ui/ui";
import { api } from "./api";
import type { DisplayView, ShownFindView } from "./mirror";
import { openReportSheet, type ReportTarget } from "./report-sheet";
import { admiredLine, thingCount, thingName } from "./things";

export interface DisplaySheetOptions {
  block: BlockKind;
  x: number;
  y: number;
  /** What's on display there, as the world shows it. */
  shown?: DisplayView;
  /** A find on display there instead (RFC 0021). */
  find?: ShownFindView;
  /** Whether the tile is on a plot you own or share, as the world shows it. */
  yours: boolean;
  /** The plot the tile is on, and whether it's open as a gallery. */
  plot?: { px: number; py: number; gallery: boolean };
  /** Your resident id, if you're in the world. */
  me: string | undefined;
  /** A resident's name from the world, for "Made by". Their own words: text only. */
  nameOf: (id: string) => string | undefined;
  /** Send an action. Undefined means it wasn't sent: the world isn't connected. */
  act: (action: Action) => string | undefined;
}

/**
 * What reporting a thing on display reports: a piece with a picture by its id wherever it goes
 * (its picture and title), anything else as the display it's in (its label or title).
 */
export function displayReport(good: Pick<GoodView, "id" | "kind" | "media">): ReportTarget {
  return good.kind === "piece" && good.media !== undefined
    ? { kind: "piece", id: good.id, label: "piece of art" }
    : { kind: "display", id: good.id, label: "thing on display" };
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
  // On your own plot: open it as a gallery, so what's on display is listed for everyone, or close it.
  const plot = o.plot;
  const galleryRow =
    o.yours && plot
      ? h(
          "div",
          { class: "stack tight display-gallery" },
          h("p", {
            class: "hint",
            text: plot.gallery
              ? "Your plot is a gallery: what's on display here is listed on the Galleries page and your profile."
              : "Open your plot as a gallery, and what's on display here is listed on the Galleries page and your profile.",
          }),
          h(
            "div",
            { class: "cluster" },
            h("button", {
              class: plot.gallery ? "pill-button small" : "btn-primary small",
              attrs: { type: "button", id: "display-gallery" },
              text: plot.gallery ? "Close the gallery" : "Open as a gallery",
              on: {
                click: () =>
                  send({ type: "set_gallery", px: plot.px, py: plot.py, open: !plot.gallery }),
              },
            }),
            h(
              "a",
              { class: "pill-button small", attrs: { href: "/galleries" } },
              h("span", { text: "Galleries" }),
              icon("arrow"),
            ),
          ),
        )
      : null;
  const s = sheet(
    { id: "display-title", title: where, className: "display-sheet", closeOnBackdrop: true },
    body,
    problem,
    galleryRow,
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
      admiredLine(good.admired),
    ];
    const canTakeDown = o.yours || (o.me !== undefined && o.me === shown.by);
    // Anyone but its maker and whoever put it up can admire it, once a day: the server counts.
    const canAdmire = o.me !== undefined && o.me !== good.maker && o.me !== shown.by;
    // The same people can report it to the maintainers.
    const canReport = canAdmire;
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
      ...(canAdmire
        ? [
            h(
              "button",
              {
                class: "btn-primary",
                attrs: { type: "button", id: "display-admire" },
                on: { click: () => send({ type: "admire", x: o.x, y: o.y }) },
              },
              icon("sparkle"),
              h("span", { text: "Admire" }),
            ),
          ]
        : []),
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
      ...(canReport
        ? [
            h("button", {
              class: "pill-button small",
              attrs: { type: "button", id: "display-report" },
              text: "Report",
              on: {
                click: () => {
                  closeOverlay(s.dialog);
                  openReportSheet(displayReport(good));
                },
              },
            }),
          ]
        : []),
    );
    openOverlay(s.dialog);
    return;
  }

  // A find has nobody who made it, so it's never admired or reported: only taken down.
  const find = o.find;
  if (find) {
    const by = o.nameOf(find.by);
    const name = thingName(find.kind);
    const where = COLLECTION_WORDS[CATALOG[find.kind].family].hint;
    body.append(
      h(
        "figure",
        { class: "stack tight showcase" },
        itemArt(find.kind, { size: 160, className: "showcase-art", title: name }),
        h(
          "figcaption",
          { class: "stack tight showcase-caption" },
          h("span", { class: "showcase-name", text: name }),
          h("span", { class: "showcase-line", text: where }),
          by ? h("span", { class: "showcase-line", text: `Put up by ${by}` }) : null,
        ),
      ),
      ...(o.yours || (o.me !== undefined && o.me === find.by)
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
    const finds = (r.data.inventory?.stacks ?? []).filter((st) => isFindKind(st.kind));
    hint.textContent =
      goods.length + finds.length > 0
        ? "Pick something to show. Everyone who passes can see it."
        : "You have nothing to show yet. Make something at a kitchen or a workbench, turn one of your pictures into a piece of art on your things page, or go for a walk and pick up a find.";
    const display = (item: string) =>
      h("button", {
        class: "btn-primary small",
        attrs: { type: "button" },
        text: "Display",
        on: { click: () => send({ type: "display", item, x: o.x, y: o.y }) },
      });
    list.replaceChildren(
      ...goods.map((g) =>
        itemRow({
          className: "workshop-row",
          plain: true,
          lead: thingPicture(g, { size: 32 }),
          name: shownName(g),
          lines: [g.maker ? `Made by ${g.maker.name}` : null],
          trail: display(g.id),
        }),
      ),
      ...finds.map((st) =>
        itemRow({
          className: "workshop-row",
          plain: true,
          lead: itemArt(st.kind, { size: 32 }),
          name: thingName(st.kind),
          lines: [`You have ${thingCount(st.kind, st.count)}`],
          trail: display(st.kind),
        }),
      ),
    );
  });
}
