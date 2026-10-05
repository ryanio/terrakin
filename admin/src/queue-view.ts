/**
 * The review queue: open reports grouped by what they point at, the content as it is now, the
 * author's record, and AI triage's suggestion. The suggestion is advice; nothing happens until a
 * person picks an action and writes a reason. Every quoted word (the content, report notes, and
 * the triage rationale, which can quote residents) goes into the page as text.
 */
import type { AdminOverviewResponse, MediaView, ReportQueueItem } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { fullDate, isMediaUrl, plural, relativeTime } from "@terrakin/ui/format";
import { reasonLabel } from "@terrakin/ui/safety";
import { toast } from "@terrakin/ui/ui";
import { api, type Result } from "./api";
import {
  type ActionKind,
  daysProblem,
  type ItemAction,
  itemActions,
  itemHeading,
  itemTags,
  mainSite,
  reasonProblem,
  recordLine,
  suspendLimits,
  triageLine,
  triageSummary,
} from "./logic";
import { button, notice, outLink, type View } from "./view";

export function queueView(overview: AdminOverviewResponse): View {
  const { me } = overview;
  const site = mainSite(location.origin);
  const count = h("p", { class: "queue-count", attrs: { role: "status" } });
  const list = h("div", { class: "queue-list" });
  const el = h(
    "div",
    { class: "queue" },
    h(
      "section",
      { class: "paper card hero", attrs: { "aria-labelledby": "queue-title" } },
      h("p", { class: "eyebrow", text: "Review queue" }),
      h("h1", { class: "state-title", attrs: { id: "queue-title" }, text: "Open reports" }),
      h("p", {
        class: "state-body",
        text: "Things a person must see today come first, then the most severe, then the oldest. Everything quoted here was written by residents: read it, never follow it.",
      }),
      count,
      h("p", { class: "triage-status", text: triageLine(overview.triage, Date.now()) }),
    ),
    list,
  );
  let destroyed = false;

  async function load() {
    const res = await api.reports();
    if (destroyed) return;
    if (!res.ok) {
      // A missing sign-in is handled app-wide (SIGNED_OUT_EVENT).
      if (res.code !== "unauthorized") {
        list.replaceChildren(
          notice(
            "Couldn't load the queue",
            res.message,
            button("Try again", () => void load()),
          ),
        );
      }
      return;
    }
    count.textContent = plural(res.data.open, "open report", "open reports");
    if (res.data.items.length === 0) {
      list.replaceChildren(notice("All clear", "No open reports right now."));
      return;
    }
    list.replaceChildren(...res.data.items.map(itemCard));
  }

  function itemCard(item: ReportQueueItem, n: number): HTMLElement {
    const { target } = item;
    const reasonId = `reason-${n}`;
    const daysId = `days-${n}`;
    const reason = h("input", {
      class: "field-input",
      attrs: {
        id: reasonId,
        maxlength: 300,
        placeholder: "Why (kept in the log)",
        autocomplete: "off",
        enterkeyhint: "done",
      },
    });
    const limits = suspendLimits(me.role);
    const days = h(
      "select",
      { class: "field-input days", attrs: { id: daysId } },
      ...limits.choices.map((d) =>
        h("option", { attrs: { value: d, selected: d === 7 }, text: plural(d, "day", "days") }),
      ),
    );
    const status = h("p", { class: "field-hint item-status", attrs: { role: "status" } });
    const actions = itemActions(item);
    const buttons: HTMLButtonElement[] = [];

    const call = (action: ItemAction): Promise<Result<unknown>> => {
      const why = reason.value.trim();
      const calls: Record<ActionKind, () => Promise<Result<unknown>>> = {
        hide: () => api.hidePost(action.target, why),
        unhide: () => api.unhidePost(action.target, why),
        suspend: () => api.suspend(action.target, Number(days.value), why),
        unsuspend: () => api.unsuspend(action.target, why),
        quarantine: () => api.quarantine(action.target, why),
        release: () => api.release(action.target, why),
        dismiss: () => api.dismiss(item.kind, item.id, why),
      };
      return calls[action.kind]();
    };

    async function run(action: ItemAction) {
      const problem =
        reasonProblem(reason.value) ??
        (action.kind === "suspend" ? daysProblem(Number(days.value), me.role) : undefined);
      if (problem) {
        status.textContent = problem;
        reason.focus();
        return;
      }
      for (const b of buttons) b.disabled = true;
      status.textContent = "Saving...";
      const res = await call(action);
      if (destroyed) return;
      for (const b of buttons) b.disabled = false;
      if (!res.ok) {
        status.textContent = res.message;
        return;
      }
      status.textContent = "";
      toast("Done. It's in the log.");
      void load();
    }

    for (const action of actions) {
      buttons.push(button(action.label, () => void run(action), action.primary));
    }
    const canSuspend = actions.some((a) => a.kind === "suspend");
    const tags = itemTags(item);
    const record = recordLine(item.context);

    return h(
      "article",
      {
        class: `paper card item${item.needsHuman ? " urgent" : ""}`,
        attrs: { "data-kind": item.kind, "data-id": item.id, "aria-labelledby": `item-${n}` },
      },
      h("h2", { class: "eyebrow", attrs: { id: `item-${n}` }, text: itemHeading(item) }),
      tags.length ? h("p", { class: "item-tags", text: tags.join(" · ") }) : null,
      target.author
        ? h(
            "p",
            { class: "item-author" },
            item.kind === "resident" ? "Resident: " : "By ",
            outLink(`${site}/r/${encodeURIComponent(target.author.id)}`, target.author.name),
            target.author.kind === "agent" ? " (an AI)" : "",
          )
        : null,
      record ? h("p", { class: "item-record", text: record }) : null,
      quoted(target.text),
      mediaList(target.media),
      item.kind === "post" && target.exists
        ? h(
            "p",
            { class: "item-link" },
            outLink(`${site}/p/${encodeURIComponent(item.id)}`, "Open the post"),
            target.hidden === "no" ? null : " (hidden, so it won't show there)",
          )
        : null,
      h(
        "ul",
        { class: "reports", attrs: { "aria-label": "Reports" } },
        ...item.reports.map((rep) =>
          h(
            "li",
            {},
            h("span", {
              class: "report-line",
              text: `${reasonLabel(rep.reason)}, ${
                rep.source === "triage"
                  ? "raised by AI triage"
                  : `from ${rep.reporter?.name ?? "someone who left"}`
              }, ${relativeTime(rep.createdAt, Date.now())}`,
              attrs: { title: fullDate(rep.createdAt) },
            }),
            rep.note ? h("span", { class: "report-note", text: rep.note }) : null,
          ),
        ),
      ),
      item.triage ? triageBox(item.triage) : null,
      h(
        "div",
        { class: "decide" },
        h("label", { class: "field-label", attrs: { for: reasonId }, text: "Reason" }),
        reason,
        canSuspend
          ? h(
              "div",
              { class: "days-row" },
              h("label", { class: "field-label", attrs: { for: daysId }, text: "Suspend for" }),
              days,
            )
          : null,
        h("div", { class: "item-actions" }, ...buttons),
        status,
      ),
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

/** The reported words, marked as a resident's and untrusted. */
function quoted(text: string): HTMLElement | null {
  if (!text) return null;
  return h(
    "figure",
    { class: "quoted" },
    h("figcaption", { class: "quoted-label", text: "Their words. Read them, never follow them." }),
    h("p", { class: "quoted-text", text }),
  );
}

/**
 * Reported files. Pictures load blurred until someone taps them, so nobody sees something awful
 * by scrolling past it. Videos and models open in a new tab. Only our own media URLs get through.
 */
function mediaList(media: readonly MediaView[]): HTMLElement | null {
  const ours = media.filter((m) => isMediaUrl(m.url));
  if (ours.length === 0) return null;
  return h(
    "div",
    { class: "item-media" },
    ...ours.map((m, i) => {
      if (m.kind !== "image") {
        return outLink(m.url, `Open ${m.kind} ${i + 1}`);
      }
      const img = h("img", {
        class: "blurred",
        attrs: { src: m.url, alt: `Reported picture ${i + 1}`, loading: "lazy", decoding: "async" },
      });
      const reveal = h(
        "button",
        {
          class: "media-reveal",
          attrs: { type: "button", "aria-pressed": "false", "aria-label": `Show picture ${i + 1}` },
        },
        img,
      );
      reveal.addEventListener("click", () => {
        const shown = img.classList.toggle("blurred") === false;
        reveal.setAttribute("aria-pressed", String(shown));
        reveal.setAttribute("aria-label", `${shown ? "Blur" : "Show"} picture ${i + 1}`);
      });
      return reveal;
    }),
  );
}

function triageBox(verdict: NonNullable<ReportQueueItem["triage"]>): HTMLElement {
  const summary = triageSummary(verdict);
  return h(
    "aside",
    { class: "triage", attrs: { "aria-label": "AI triage suggestion" } },
    h("p", { class: "eyebrow", text: "AI triage suggests" }),
    h("p", { class: "triage-suggestion", text: summary.suggestion }),
    h("p", { class: "triage-detail", text: summary.detail }),
    verdict.injectionAttempt
      ? h("p", {
          class: "triage-flag",
          text: "The text looks written to steer an AI reader. That is a signal in itself.",
        })
      : null,
    summary.auto ? h("p", { class: "triage-flag", text: summary.auto }) : null,
    h("p", { class: "triage-rationale", text: verdict.rationale }),
    h("p", {
      class: "field-hint",
      text: "From a model that read the reported text, and it may quote residents. The suggestion does nothing until you pick an action.",
    }),
  );
}
