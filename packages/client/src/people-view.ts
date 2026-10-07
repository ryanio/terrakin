/**
 * `/r/:id/followers`, `/r/:id/following`, and `/r/:id/friends`: the people around a resident, as
 * three tabs. Friends are the residents they follow who follow them back. Names, handles, and notes
 * are residents' own words: textContent only.
 */

import type { AuthorView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { compactCount } from "@terrakin/ui/format";
import { profilePath } from "@terrakin/ui/paths";
import { personLink } from "@terrakin/ui/people";
import { emptyNote, linkTabs } from "@terrakin/ui/ui";
import { api } from "./api";
import { savedResidentId } from "./net";
import { errorCard, notFoundCard, type View, type ViewContext } from "./view";

export const PEOPLE_TABS = ["followers", "following", "friends"] as const;
export type PeopleTab = (typeof PEOPLE_TABS)[number];

export const peoplePath = (id: string, tab: PeopleTab) => `${profilePath(id)}/${tab}`;

const LABELS: Record<PeopleTab, string> = {
  followers: "Followers",
  following: "Following",
  friends: "Friends",
};

/** What an empty tab says, in the second person on your own page. Pure, so tests pin it. */
export function peopleEmpty(tab: PeopleTab, name: string, mine: boolean): [string, string] {
  if (tab === "followers")
    return mine
      ? ["No followers yet", "Post something you made, or say hi in the world. People follow back."]
      : ["No followers yet", `Follow ${name} and you'll be the first.`];
  if (tab === "following")
    return mine
      ? ["You don't follow anyone yet", "Open someone's profile and tap Follow."]
      : ["Not following anyone yet", `${name} hasn't followed anyone yet.`];
  return mine
    ? ["No friends yet", "Friends are people you follow who follow you back."]
    : ["No friends yet", `Friends are people ${name} follows who follow back.`];
}

export function peopleView(id: string, tab: PeopleTab, ctx: ViewContext): View {
  ctx.setTitle(`${LABELS[tab]} · Terrakin`);
  let destroyed = false;
  const el = h("div", { class: "column stack cards page people-page" });
  const list = h("ul", { class: "people-list", attrs: { id: "people-list" } });

  function row(person: AuthorView): HTMLElement {
    return h(
      "li",
      { class: "people-row" },
      personLink(person, { size: "md", className: "people-person" }),
      person.handle ? h("span", { class: "people-handle", text: `@${person.handle}` }) : null,
    );
  }

  async function load(): Promise<void> {
    const [profile, people] = await Promise.all([
      api.profile(id),
      tab === "followers"
        ? api.followers(id)
        : tab === "friends"
          ? api.friends(id)
          : api.following(id),
    ]);
    if (destroyed) return;
    if (!profile.ok || !people.ok) {
      const failed = !profile.ok ? profile : people.ok ? undefined : people;
      if (failed?.status === 404) {
        el.replaceChildren(notFoundCard("We couldn't find that resident"));
        return;
      }
      el.replaceChildren(errorCard(failed?.message ?? "Something went wrong.", () => void load()));
      return;
    }
    const r = profile.data.resident;
    const mine = savedResidentId() === r.id;
    ctx.setTitle(`${r.name}'s ${LABELS[tab].toLowerCase()} · Terrakin`);

    // Tabs are links, so each list has its own address; switching swaps this history entry.
    const tabs = linkTabs(
      PEOPLE_TABS.map((t) => ({
        href: peoplePath(r.id, t),
        current: t === tab,
        content: [
          h("span", { class: "people-tab-n", text: compactCount(r[t]) }),
          h("span", { text: LABELS[t] }),
        ],
      })),
      {
        label: "People",
        className: "people-tabs",
        tabClass: "people-tab",
        go: (href) => ctx.navigate(href, { replace: true }),
      },
    );

    const residents = people.data.residents;
    list.replaceChildren(...residents.map(row));
    const [title, body] = peopleEmpty(tab, r.name, mine);
    el.replaceChildren(
      h(
        "a",
        { class: "text-link back-link", attrs: { href: profilePath(r.id) } },
        icon("back"),
        h("span", { text: mine ? "Your profile" : r.name }),
      ),
      h("h1", { class: "page-title", text: mine ? "Your people" : `${r.name}'s people` }),
      tabs,
      residents.length > 0 ? list : emptyNote(title, body),
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
