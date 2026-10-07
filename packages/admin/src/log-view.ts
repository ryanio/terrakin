/** The moderation log, newest first: every staff, triage, and automatic action, with its reason. */
import type { ModerationLogView } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { fullDate, relativeTime } from "@terrakin/ui/format";
import { ACTION_LABELS } from "@terrakin/ui/safety";
import { moreButton, stateCard, whileBusy } from "@terrakin/ui/ui";
import { api } from "./api";
import { dayLabel, logTarget, ruleLine } from "./logic";
import { actorName, button, type View } from "./view";

export function logView(): View {
  const list = h("ol", {
    class: "paper card plain-list log-list",
    attrs: { "aria-label": "Moderation log" },
  });
  const more = h("div", { class: "log-more" });
  const el = h(
    "div",
    { class: "column stack log" },
    h(
      "section",
      { class: "paper card hero", attrs: { "aria-labelledby": "log-title" } },
      h("h1", { class: "state-title", attrs: { id: "log-title" }, text: "Moderation log" }),
      h("p", {
        class: "hero-order",
        text: "Staff, AI triage, and the automatic rules, newest first. It can't be edited or deleted.",
      }),
    ),
    list,
    more,
  );
  let destroyed = false;

  const end = h("p", {
    class: "field-hint",
    attrs: { hidden: true },
    text: "That's the start of the log.",
  });
  const loading = h("p", {
    class: "field-hint",
    attrs: { role: "status" },
    text: "Loading the log…",
  });
  let cursor: string | undefined;
  /** The day heading last added, so a day split across pages gets one. */
  let lastDay: string | undefined;
  const older = moreButton("Show older", () => load(cursor));
  more.append(loading, older.el, end);

  async function load(before?: string): Promise<string | undefined> {
    const res = await api.log(before);
    if (destroyed) return;
    if (!res.ok) {
      // A missing sign-in is handled app-wide (SIGNED_OUT_EVENT).
      if (res.code === "unauthorized") return;
      // A later page says so on its button; the first page gets a card.
      if (before) return res.message;
      more.replaceChildren(
        stateCard({
          title: "Couldn't load the log",
          body: res.message,
          actions: [button("Try again", (b) => void whileBusy(b, () => load()))],
        }),
      );
      return;
    }
    if (!before && res.data.entries.length === 0) {
      more.replaceChildren(
        stateCard({ title: "Nothing yet", body: "No moderation actions so far." }),
      );
      return;
    }
    if (!before) {
      more.replaceChildren(older.el, end);
      // A first page again (after Try again) starts the list over.
      list.replaceChildren();
      lastDay = undefined;
    }
    for (const entry of res.data.entries) {
      const day = dayLabel(entry.at, Date.now());
      if (day !== lastDay) {
        list.append(h("li", { class: "log-day", text: day }));
        lastDay = day;
      }
      list.append(entryRow(entry));
    }
    cursor = res.data.next ?? undefined;
    older.el.hidden = cursor === undefined;
    end.hidden = cursor !== undefined;
    return;
  }

  void load();
  return {
    el,
    destroy() {
      destroyed = true;
    },
  };
}

function entryRow(entry: ModerationLogView): HTMLElement {
  const notes = [
    entry.until ? `Until ${fullDate(entry.until)}` : null,
    entry.rule ? ruleLine(entry.rule) : null,
  ].filter((n): n is string => n !== null);
  return h(
    "li",
    { class: "log-entry", attrs: { "data-action": entry.action } },
    h(
      "div",
      { class: "log-top" },
      h("span", { class: "log-headline", text: ACTION_LABELS[entry.action] }),
      h("span", {
        class: "log-time",
        text: relativeTime(entry.at, Date.now()),
        attrs: { title: fullDate(entry.at) },
      }),
    ),
    h("p", { class: "log-meta" }, `${logTarget(entry)} · by `, actorName(entry)),
    entry.reason ? h("p", { class: "log-reason", text: entry.reason }) : null,
    notes.length
      ? h(
          "ul",
          { class: "item-chips" },
          ...notes.map((n) => h("li", { class: "item-chip", text: n })),
        )
      : null,
  );
}
