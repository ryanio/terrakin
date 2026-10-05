/**
 * Galleries (RFC 0005 step 3): plots their residents opened as galleries, and what's on display in
 * each. `/galleries` lists them all; `galleryCards` is the same card on a resident's profile. Anyone
 * signed in can admire a piece once a day, never their own. Titles, labels, and names are other
 * residents' words: text only.
 */
import type { GalleryPieceView, GalleryView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { thingPicture } from "@terrakin/ui/item-art";
import { personLink } from "@terrakin/ui/people";
import { itemRow, itemRows, stateCard, toast, whileBusy } from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { shownName } from "./display-sheet";
import { savedResidentId, savedToken } from "./net";
import { admiredLine } from "./things";
import { errorCard, type View, type ViewContext } from "./view";

/** Who may admire a piece: someone signed in who neither made it nor put it up. */
export function canAdmire(piece: GalleryPieceView, me: string | null): boolean {
  return me !== null && me !== piece.good.makerId && me !== piece.by?.id;
}

/** One piece in a gallery: its picture, its name, its maker, how often it was admired. */
function pieceRow(piece: GalleryPieceView, me: string | null): HTMLLIElement {
  const count = h("span", { text: admiredLine(piece.good.admired) ?? "Not admired yet" });
  const admire = canAdmire(piece, me)
    ? h(
        "button",
        {
          class: "pill-button small gallery-admire",
          attrs: { type: "button", "data-item": piece.good.id },
        },
        icon("sparkle"),
        h("span", { text: "Admire" }),
      )
    : null;
  admire?.addEventListener("click", async () => {
    const r = await whileBusy(admire, () => api.act({ type: "admire", x: piece.x, y: piece.y }));
    const problem = actProblem(r);
    if (problem) return toast(problem);
    const event = r.ok && r.data.ok ? r.data.events.find((e) => e.type === "admired") : undefined;
    if (event?.type === "admired") count.textContent = admiredLine(event.admired) ?? "";
    admire.disabled = true;
    toast("You admired it. Its maker will be glad.");
  });
  return itemRow({
    className: "gallery-piece",
    attrs: { "data-item": piece.good.id },
    lead: thingPicture(piece.good, { size: 72, title: shownName(piece.good) }),
    name: shownName(piece.good),
    lines: [
      h(
        "span",
        { class: "things-good-maker" },
        h("span", { text: "Made by " }),
        piece.good.maker ? personLink(piece.good.maker) : h("span", { text: "a former resident" }),
      ),
      count,
    ],
    trail: admire,
  });
}

/** One gallery: whose it is, and what's on display there. */
export function galleryCard(g: GalleryView, me: string | null): HTMLElement {
  const who = [g.owner, ...g.coOwners];
  return h(
    "section",
    {
      class: "stack paper card gallery-card",
      attrs: { "data-plot": `${g.px},${g.py}`, "aria-label": `${g.owner.name}'s gallery` },
    },
    h("div", { class: "cluster gallery-owners" }, ...who.map((a) => personLink(a))),
    g.pieces.length > 0
      ? itemRows(
          g.pieces.map((p) => pieceRow(p, me)),
          { className: "gallery-pieces" },
        )
      : h("p", {
          class: "purse-hint",
          text: "Nothing on display yet. What goes up on its pedestals and frames shows here.",
        }),
  );
}

/** A resident's galleries, for their profile. Empty when they have none. */
export function galleryCards(galleries: readonly GalleryView[]): HTMLElement[] {
  const me = savedToken() ? savedResidentId() : null;
  return galleries.map((g) => galleryCard(g, me));
}

/** `/galleries`: every gallery, most admired first. */
export function galleriesView(ctx: ViewContext): View {
  ctx.setTitle("Galleries · Terrakin");
  const body = h("div", { class: "stack cards galleries-body" });
  const el = h(
    "div",
    { class: "column stack cards page galleries-page" },
    h("h1", { class: "page-title", text: "Galleries" }),
    h("p", {
      class: "purse-hint",
      text: "Residents open their plots as galleries and put what they made on pedestals and in frames. Admire what you like, once a day.",
    }),
    body,
  );
  let destroyed = false;

  async function load(): Promise<void> {
    const r = await api.galleries();
    if (destroyed) return;
    if (!r.ok) {
      body.replaceChildren(errorCard(r.message, () => void load()));
      return;
    }
    const { galleries } = r.data;
    body.replaceChildren(
      ...(galleries.length > 0
        ? galleryCards(galleries)
        : [
            stateCard({
              title: "No galleries yet",
              body: "Put something you made on a pedestal on your plot, then tap it and open your plot as a gallery.",
            }),
          ]),
    );
  }

  return {
    el,
    ready: load(),
    destroy() {
      destroyed = true;
    },
  };
}

/**
 * A resident's galleries on their profile, under "On display", with a way to every gallery. Null
 * when they have none.
 */
export async function profileGalleries(resident: { id: string }): Promise<HTMLElement | null> {
  const r = await api.galleries(resident.id);
  if (!r.ok || r.data.galleries.length === 0) return null;
  return h(
    "section",
    { class: "stack profile-galleries", attrs: { "aria-labelledby": "galleries-title" } },
    h("h2", { class: "section-title", attrs: { id: "galleries-title" }, text: "On display" }),
    ...galleryCards(r.data.galleries),
    h(
      "a",
      { class: "pill-button small galleries-all", attrs: { href: "/galleries" } },
      h("span", { text: "All galleries" }),
      icon("arrow"),
    ),
  );
}
