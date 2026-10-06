/**
 * `/r/:id/collection`: a resident's collection book (RFC 0021). Everything they've ever held and
 * every piece of wear they've worn, grouped by the catalog's families, each family with how many of
 * its kinds they have and its badge once they have them all. What they haven't found yet is a
 * silhouette with a "?" and the family's hint, so a book is something to fill in. Public, like the
 * profile, and it never says how many of anything they hold. Their name is their own words: text
 * only.
 */
import type { CollectionGroup, CollectionKind, CollectionView } from "@terrakin/protocol";
import type { Family } from "@terrakin/sim";
import { h, icon } from "@terrakin/ui/dom";
import { isArtKind, itemArt } from "@terrakin/ui/item-art";
import { profilePath } from "@terrakin/ui/paths";
import { kindPill } from "@terrakin/ui/ui";
import { api } from "./api";
import { savedResidentId } from "./net";
import { collectedLine, dayLabel, familyLabel, holidayLine, seasonsLine } from "./things";
import { errorCard, notFoundCard, type View, type ViewContext } from "./view";

/** One kind in a family's grid: its picture and name once collected, else its outline and "?". */
function kindTile(k: CollectionKind, now: number): HTMLElement {
  const got = k.firstDay !== undefined;
  const art = isArtKind(k.kind)
    ? itemArt(k.kind, {
        size: 48,
        title: got ? k.name : "Not found yet",
        ...(got ? {} : { className: "silhouette" }),
      })
    : null;
  const under =
    k.firstDay !== undefined
      ? dayLabel(k.firstDay, now)
      : k.seasons
        ? seasonsLine(k.seasons)
        : k.holiday
          ? holidayLine(k.holiday)
          : null;
  return h(
    "li",
    { class: got ? "collection-kind got" : "collection-kind", attrs: { "data-kind": k.kind } },
    art,
    h("span", { class: "collection-kind-name", text: got ? k.name : "?" }),
    under ? h("span", { class: "collection-kind-when", text: under }) : null,
  );
}

/** A family's card: its name, how many of its kinds are in, its badge or hint, and its grid. */
function groupCard(g: CollectionGroup, now: number): HTMLElement {
  const label = g.family === "wear" ? g.name : familyLabel(g.family as Family);
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
      : h("p", { class: "purse-hint collection-hint", text: g.hint }),
    h("ul", { class: "plain-list collection-kinds" }, ...g.kinds.map((k) => kindTile(k, now))),
  );
}

/** The book's first card: whose it is, how far along, and the badges earned. */
function headCard(c: CollectionView, name: string, mine: boolean): HTMLElement {
  const done = c.total > 0 ? Math.round((c.count / c.total) * 100) : 0;
  const bar = h(
    "div",
    {
      class: "collection-bar",
      attrs: {
        role: "progressbar",
        "aria-label": "Collected",
        "aria-valuemin": "0",
        "aria-valuemax": String(c.total),
        "aria-valuenow": String(c.count),
      },
    },
    h("span", { class: "collection-bar-fill" }),
  );
  bar.style.setProperty("--done", `${done}%`);
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
          class: "purse-hint",
          text: mine
            ? "Have every kind in a family to earn its badge."
            : `${name} hasn't finished a family yet.`,
        }),
    mine
      ? h(
          "p",
          { class: "purse-hint" },
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
  let destroyed = false;
  const el = h("div", { class: "column stack cards page collection-page" });

  async function load(): Promise<void> {
    const [profile, book] = await Promise.all([api.profile(id), api.collection(id)]);
    if (destroyed) return;
    if (!profile.ok || !book.ok) {
      const failed = !profile.ok ? profile : book.ok ? undefined : book;
      if (failed?.status === 404) {
        el.replaceChildren(notFoundCard("We couldn't find that resident"));
        return;
      }
      el.replaceChildren(errorCard(failed?.message ?? "Something went wrong.", () => void load()));
      return;
    }
    const r = profile.data.resident;
    const mine = savedResidentId() === r.id;
    const c = book.data.collection;
    const now = Date.now();
    ctx.setTitle(`${mine ? "Your" : `${r.name}'s`} collection · Terrakin`);
    el.replaceChildren(
      h(
        "a",
        { class: "text-link back-link", attrs: { href: profilePath(r.id) } },
        icon("back"),
        h("span", { text: mine ? "Your profile" : r.name }),
      ),
      headCard(c, r.name, mine),
      // Finds first: they're what a walk adds to the book. The rest in the catalog's order.
      ...[
        ...c.groups.filter((g) => g.path[0] === "find"),
        ...c.groups.filter((g) => g.path[0] !== "find"),
      ].map((g) => groupCard(g, now)),
    );
  }

  const ready = load();
  return {
    el,
    ready,
    destroy() {
      destroyed = true;
    },
  };
}
