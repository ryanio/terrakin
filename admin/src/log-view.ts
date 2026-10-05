/** The moderation log, newest first: every staff, triage, and automatic action, with its reason. */
import type { ModerationLogView } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { fullDate, relativeTime } from "@terrakin/ui/format";
import { stateCard } from "@terrakin/ui/ui";
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

  async function load(before?: string) {
    const res = await api.log(before);
    if (destroyed) return;
    if (!res.ok) {
      if (res.code !== "unauthorized") {
        more.replaceChildren(
          stateCard({
            title: "Couldn't load the log",
            body: res.message,
            actions: [button("Try again", () => void load(before))],
          }),
        );
      }
      return;
    }
    if (!before && res.data.entries.length === 0) {
      more.replaceChildren(
        stateCard({ title: "Nothing yet", body: "No moderation actions so far." }),
      );
      return;
    }
    list.append(...res.data.entries.map(entryRow));
    const next = res.data.next;
    more.replaceChildren(
      next
        ? button("Show older", (b) => {
            b.disabled = true;
            void load(next);
          })
        : h("p", { class: "field-hint", text: "That's the start of the log." }),
    );
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
