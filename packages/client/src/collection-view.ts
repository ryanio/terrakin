/**
 * `/r/:id/collection`: a resident's collection book (RFC 0021). Everything they've ever held and
 * every piece of wear they've worn, grouped by the catalog's families, each family with how many of
 * its kinds they have and its badge once they have them all. What they haven't found yet is a
 * silhouette with a "?" and the family's hint, so a book is something to fill in. Public, like the
 * profile, and it never says how many of anything they hold. Their name is their own words: text
 * only.
 */
import {
  type CollectionGroup,
  type CollectionKind,
  type CollectionResponse,
  type CollectionView,
  FINISH_GROUP,
  GLAZE_GROUP,
  type ProfileView,
} from "@terrakin/protocol";
import {
  FAMILIES,
  type Family,
  FINISH_NAMES,
  type Finish,
  GLAZES,
  type Glaze,
} from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { isArtKind, itemArt, type ThingLook, thingPicture } from "@terrakin/ui/item-art";
import { profilePath } from "@terrakin/ui/paths";
import { kindPill, pageLayout, progressBar } from "@terrakin/ui/ui";
import { collectionApi } from "./api/collection";
import { residentsApi } from "./api/residents";
import { savedResidentId } from "./net";
import { both, pageData } from "./page-data";
import {
  collectedLine,
  dayLabel,
  familyLabel,
  finishOdds,
  holidayLine,
  seasonsLine,
} from "./things";
import { failInto, notFoundCard, type View, type ViewContext } from "./view";
import "./collection-view.css";

/** How pottery's pages draw a row: a vase in the glaze, or a sea vase with the finish. */
function potLook(family: string, kind: string): ThingLook | undefined {
  if (family === GLAZE_GROUP && (GLAZES as readonly string[]).includes(kind)) {
    return { kind: "vase", glaze: kind as Glaze };
  }
  if (family === FINISH_GROUP && (FINISH_NAMES as readonly string[]).includes(kind)) {
    return { kind: "vase", glaze: "sea", finish: kind as Finish };
  }
  return undefined;
}

/** One kind in a family's grid: its picture and name once collected, else its outline and "?". */
function kindTile(k: CollectionKind, now: number, family: string): HTMLElement {
  const got = k.firstDay !== undefined;
  // A finish (RFC 0047) shows what it looks like and how often it comes, to give a potter
  // something to hope for, faint until one of theirs has it.
  const finish = family === FINISH_GROUP && (FINISH_NAMES as readonly string[]).includes(k.kind);
  const opts = {
    size: 48,
    title: got || finish ? k.name : "Not found yet",
    ...(got ? {} : { className: finish ? "faint" : "silhouette" }),
  };
  // Pottery's pages (RFC 0047): a vase in each glaze, and one in each finish.
  const pot = potLook(family, k.kind);
  const art = pot ? thingPicture(pot, opts) : isArtKind(k.kind) ? itemArt(k.kind, opts) : null;
  const under =
    k.firstDay !== undefined
      ? dayLabel(k.firstDay, now)
      : finish
        ? finishOdds(k.kind as Finish)
        : k.seasons
          ? seasonsLine(k.seasons)
          : k.holiday
            ? holidayLine(k.holiday)
            : null;
  return h(
    "li",
    { class: got ? "collection-kind got" : "collection-kind", attrs: { "data-kind": k.kind } },
    art,
    h("span", { class: "collection-kind-name", text: got || finish ? k.name : "?" }),
    under ? h("span", { class: "collection-kind-when", text: under }) : null,
  );
}

/** A family's card: its name, how many of its kinds are in, its badge or hint, and its grid. */
function groupCard(g: CollectionGroup, now: number): HTMLElement {
  const label = Object.hasOwn(FAMILIES, g.family) ? familyLabel(g.family as Family) : g.name;
  const titleId = `collection-${g.family}`;
  return h(
    "section",
    {
      class: "paper card stack tight collection-group",
      attrs: { "aria-labelledby": titleId, "data-family": g.family },
    },
    h(
      "div",
      { class: "collection-group-head" },
      h("h2", { class: "card-title", attrs: { id: titleId }, text: label }),
      h("span", { class: "collection-group-count", text: `${g.count} of ${g.total}` }),
    ),
    g.done && g.badge
      ? kindPill(g.badge, "sun", "collection-badge")
      : h("p", { class: "hint collection-hint", text: g.hint }),
    h(
      "ul",
      { class: "plain-list collection-kinds" },
      ...g.kinds.map((k) => kindTile(k, now, g.family)),
    ),
  );
}

/** The book's first card: whose it is, how far along, and the badges earned. */
function headCard(c: CollectionView, name: string, mine: boolean): HTMLElement {
  const bar = progressBar(c.count, c.total, "Collected");
  return h(
    "section",
    { class: "paper card stack collection-head", attrs: { "aria-labelledby": "collection-title" } },
    h("p", { class: "eyebrow", text: "Collection book" }),
    h("h1", {
      class: "page-title",
      attrs: { id: "collection-title" },
      text: mine ? "Your collection" : `${name}'s collection`,
    }),
    h("p", {
      class: "collection-count",
      attrs: { id: "collection-count" },
      text: collectedLine(c),
    }),
    bar,
    c.badges.length > 0
      ? h(
          "ul",
          { class: "cluster plain-list collection-badges", attrs: { "aria-label": "Badges" } },
          ...c.badges.map((b) => h("li", {}, kindPill(b, "sun"))),
        )
      : h("p", {
          class: "hint",
          text: mine
            ? "Have every kind in a family to earn its badge."
            : `${name} hasn't finished a family yet.`,
        }),
    mine
      ? h(
          "p",
          { class: "hint" },
          "Finds lie on the ground now and then: acorns and mushrooms in forests, seashells on the sand, crystals on stony ground, a clover in a meadow, a few only in their season. Tap one in the world to pick it up.",
        )
      : null,
    mine
      ? h(
          "a",
          { class: "pill-button small", attrs: { href: "/world", id: "collection-forage" } },
          h("span", { text: "Go for a walk" }),
          icon("arrow"),
        )
      : null,
  );
}

export function collectionView(id: string, ctx: ViewContext): View {
  ctx.setTitle("Collection · Terrakin");
  // The families in the main column; whose book it is, how far along, and the badges beside them.
  const { el, head, main, side } = pageLayout("collection-page", "The book so far");

  function paint([profile, book]: [{ resident: ProfileView }, CollectionResponse]) {
    const r = profile.resident;
    const mine = savedResidentId() === r.id;
    const c = book.collection;
    const now = Date.now();
    ctx.setTitle(`${mine ? "Your" : `${r.name}'s`} collection · Terrakin`);
    head.replaceChildren(
      h(
        "a",
        { class: "text-link back-link", attrs: { href: profilePath(r.id) } },
        icon("back"),
        h("span", { text: mine ? "Your profile" : r.name }),
      ),
    );
    side.replaceChildren(headCard(c, r.name, mine));
    main.replaceChildren(
      h(
        "div",
        { class: "card-grid" },
        // Finds first: they're what a walk adds to the book. The rest in the catalog's order.
        ...[
          ...c.groups.filter((g) => g.path[0] === "find"),
          ...c.groups.filter((g) => g.path[0] !== "find"),
        ].map((g) => groupCard(g, now)),
      ),
    );
  }

  const loader = pageData({
    ask: () => both(residentsApi.profile(id), collectionApi.collection(id)),
    paint,
    fail: failInto(main, () => notFoundCard("We couldn't find that resident")),
  });
  return { el, ready: loader.ready, destroy: loader.leave };
}
