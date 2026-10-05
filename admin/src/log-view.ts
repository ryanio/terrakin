/** The moderation log, newest first: every staff, triage, and automatic action, with its reason. */
import type { ModerationLogView } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { fullDate, relativeTime } from "@terrakin/ui/format";
import { moreButton, stateCard, whileBusy } from "@terrakin/ui/ui";
import { api } from "./api";
import { actorLabel, logHeadline } from "./logic";
import { button, type View } from "./view";

export function logView(): View {
  const list = h("ol", { class: "log-list", attrs: { "aria-label": "Moderation log" } });
  const more = h("div", { class: "log-more" });
  const el = h(
    "div",
    { class: "log" },
    h(
      "section",
      { class: "paper card hero", attrs: { "aria-labelledby": "log-title" } },
      h("p", { class: "eyebrow", text: "Moderation log" }),
      h("h1", { class: "state-title", attrs: { id: "log-title" }, text: "What staff did" }),
      h("p", {
        class: "state-body",
        text: "Every action by staff, AI triage, and the automatic rules, newest first. The log can't be edited or deleted.",
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
    }
    list.append(...res.data.entries.map(entryRow));
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
  const when = `${actorLabel(entry)}, ${relativeTime(entry.at, Date.now())}`;
  return h(
    "li",
    { class: "paper card log-entry", attrs: { "data-action": entry.action } },
    h("p", { class: "log-headline", text: logHeadline(entry) }),
    entry.reason ? h("p", { class: "log-reason", text: entry.reason }) : null,
    entry.until ? h("p", { class: "field-hint", text: `Until ${fullDate(entry.until)}` }) : null,
    h("p", { class: "field-hint", text: when, attrs: { title: fullDate(entry.at) } }),
  );
}
