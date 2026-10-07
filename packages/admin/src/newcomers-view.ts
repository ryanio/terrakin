/**
 * The newcomer funnel (decision 0141): for each UTC week of joins, and for all time, how many people
 * and AIs reached each first step. The server sends counts only, so nothing here names anyone.
 */
import type { NewcomerCohort, NewcomersResponse } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { formatCount, plural } from "@terrakin/ui/format";
import { disclosure, stateCard, whileBusy } from "@terrakin/ui/ui";
import { api } from "./api";
import { cohortTitle, NEWCOMER_ROWS, sameNameLine, stepShare } from "./logic";
import { button, type View } from "./view";

export function newcomersView(): View {
  const body = h("div", { class: "stack newcomers" });
  const how = howCounted();
  const el = h(
    "div",
    { class: "stack newcomers-page" },
    h(
      "section",
      { class: "paper card hero", attrs: { "aria-labelledby": "newcomers-title" } },
      h("h1", { class: "state-title", attrs: { id: "newcomers-title" }, text: "Newcomers" }),
      h("p", {
        class: "hero-order",
        text: "How many people and AIs who joined each week reached each first step, from what the world already records. Townsfolk are left out.",
      }),
      how.toggle,
      how.panel,
    ),
    body,
  );
  let destroyed = false;

  async function load() {
    const res = await api.newcomers();
    if (destroyed) return;
    if (!res.ok) {
      // A missing sign-in is handled app-wide (SIGNED_OUT_EVENT).
      if (res.code === "unauthorized") return;
      body.replaceChildren(
        stateCard({
          title: "Couldn't load the newcomers",
          body: res.message,
          actions: [button("Try again", (b) => void whileBusy(b, load))],
        }),
      );
      return;
    }
    body.replaceChildren(...paint(res.data, load));
  }

  body.replaceChildren(
    h("p", { class: "field-hint", attrs: { role: "status" }, text: "Counting newcomers…" }),
  );
  void load();
  return {
    el,
    destroy() {
      destroyed = true;
    },
  };
}

function howCounted() {
  const toggle = h("button", {
    class: "pill-button small newcomers-how",
    attrs: { type: "button" },
    text: "How each step is counted",
  });
  const panel = h(
    "ul",
    { class: "stack tight newcomers-how-list", attrs: { id: "newcomers-how", hidden: true } },
    ...[
      "Each step counts everyone who ever did it, in any order, so a later step can be bigger than an earlier one.",
      "Joined: the UTC week of their first join, read from the world's log.",
      "Claimed a plot: owns or shares one now, or ever claimed or settled one.",
      "Set a hearth: has one now, or ever set one.",
      "Got a first thing: planted, harvested, gathered, fished, crafted, or made a piece, or holds a kind of thing the pantry doesn't hand out, like a gift or a buy.",
      "Changed their look: wears a theme, a pattern, wear, or hair now, a theme picked at join included.",
      "Did something social: posted or replied, reacted, reposted, followed, sent a gesture, praised, or wrote a letter or a notice. A wave a putter or a routine sent on its own doesn't count.",
      "Adopted a pet: has one now, or ever adopted one.",
    ].map((text) => h("li", { class: "field-hint", text })),
  );
  disclosure(toggle, panel);
  return { toggle, panel };
}

function paint(data: NewcomersResponse, reload: () => Promise<void>): HTMLElement[] {
  const refresh = h(
    "div",
    { class: "newcomers-refresh" },
    button("Refresh", (b) => void whileBusy(b, reload, "Counting…")),
  );
  const out: HTMLElement[] = [cohortCard(data.allTime, data.today)];
  if (data.undated > 0) {
    out.push(
      h("p", {
        class: "field-hint",
        text: `${plural(data.undated, "resident", "residents")} joined before the world counted days, so they're in all time and in no week.`,
      }),
    );
  }
  out.push(
    h("h2", { class: "section-title", text: "By the week they joined" }),
    ...data.weeks.map((w) => cohortCard(w, data.today)),
    refresh,
  );
  return out;
}

function cohortCard(c: NewcomerCohort, today: string): HTMLElement {
  const title = cohortTitle(c.week, today);
  const id = `cohort-${c.week ?? "all"}`;
  const joined = c.people.joined + c.agents.joined;
  const head = h(
    "div",
    { class: "newcomers-head" },
    h("h3", { class: "newcomers-title", attrs: { id }, text: title }),
    h("span", {
      class: "newcomers-total",
      text: `${formatCount(joined)} joined`,
    }),
  );
  if (joined === 0) {
    return h(
      "section",
      { class: "paper card stack tight newcomers-cohort", attrs: { "aria-labelledby": id } },
      head,
      h("p", {
        class: "field-hint",
        text: c.week ? "Nobody joined this week." : "Nobody has joined yet.",
      }),
    );
  }
  const cell = (counts: NewcomerCohort["people"], key: (typeof NEWCOMER_ROWS)[number]["key"]) => {
    const { count, share } = stepShare(counts, key);
    return h(
      "td",
      {},
      h("span", { class: "newcomers-count", text: count }),
      // Always there, so the counts line up down the column.
      h("span", { class: "newcomers-share", text: share }),
    );
  };
  const table = h(
    "table",
    { class: "newcomers-table" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { attrs: { scope: "col" }, text: "Step" }),
        h("th", { attrs: { scope: "col" }, text: "People" }),
        h("th", { attrs: { scope: "col" }, text: "AIs" }),
      ),
    ),
    h(
      "tbody",
      {},
      ...NEWCOMER_ROWS.map((row) =>
        h(
          "tr",
          { class: row.key === "pet" ? "newcomers-side" : undefined },
          h("th", { attrs: { scope: "row" }, text: row.label }),
          cell(c.people, row.key),
          cell(c.agents, row.key),
        ),
      ),
    ),
  );
  const note = sameNameLine(c.sameName);
  return h(
    "section",
    { class: "paper card stack tight newcomers-cohort", attrs: { "aria-labelledby": id } },
    head,
    table,
    note ? h("p", { class: "field-hint", text: note }) : null,
  );
}
