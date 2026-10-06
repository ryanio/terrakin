/**
 * The review queue: open reports grouped by what they point at, the content as it is now, the
 * author's record, and AI triage's suggestion. The suggestion is advice; nothing happens until a
 * person picks an action and writes a reason. Every quoted word (the content, report notes, and
 * the triage rationale, which can quote residents) goes into the page as text.
 */
import type {
  AdminOverviewResponse,
  MediaView,
  ReportQueueItem,
  ReportReason,
} from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { fullDate, isMediaUrl, plural, relativeTime } from "@terrakin/ui/format";
import { postPath, profilePath } from "@terrakin/ui/paths";
import { personLink } from "@terrakin/ui/people";
import { reasonLabel } from "@terrakin/ui/safety";
import { confirmTwice, holdFocus, stateCard, toast, whileBusy } from "@terrakin/ui/ui";
import { api, type Result } from "./api";
import {
  type ActionKind,
  chatterLine,
  checkinLine,
  daysProblem,
  defaultRule,
  draftLabel,
  type ItemAction,
  itemActions,
  itemHeading,
  itemTags,
  mainSite,
  participationLine,
  RULE_CHOICES,
  reasonProblem,
  recordLine,
  spendLine,
  suspendLimits,
  TAKEDOWN_ACTIONS,
  tipsLine,
  triageLine,
  triageSummary,
} from "./logic";
import { button, outLink, quoted, type View } from "./view";

export function queueView(overview: AdminOverviewResponse): View {
  const { me } = overview;
  const site = mainSite(location.origin);
  const title = h("h1", {
    class: "state-title",
    attrs: { id: "queue-title", tabindex: -1 },
    text: "Open reports",
  });
  const count = h("p", { class: "queue-count", attrs: { role: "status" } });
  const list = h(
    "div",
    { class: "stack queue-list" },
    h("p", { class: "field-hint", attrs: { role: "status" }, text: "Loading the queue…" }),
  );
  /** Reasons, lengths, and rules picked so far, by item, so a reload of the list keeps them. */
  const drafts = new Map<string, { reason: string; days: string; rule: string }>();
  const el = h(
    "div",
    { class: "stack queue" },
    h(
      "section",
      { class: "paper card hero", attrs: { "aria-labelledby": "queue-title" } },
      h("div", { class: "hero-row" }, title, count),
      h("p", { class: "hero-order", text: "Urgent first, then most severe, then oldest." }),
      h("p", { class: "triage-status", text: triageLine(overview.triage, Date.now()) }),
      h("p", { class: "triage-status", text: checkinLine(overview.checkins) }),
      h("p", { class: "triage-status", text: spendLine(overview.spend) }),
      h("p", { class: "triage-status", text: chatterLine(overview.chatter, Date.now()) }),
      ...[participationLine(overview.chatter.participation, overview.spend.days)].map((line) =>
        line ? h("p", { class: "triage-status", text: line }) : null,
      ),
      h("p", { class: "triage-status", text: tipsLine(overview.tips) }),
      chatterDrafts(overview.chatter.drafts),
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
          stateCard({
            title: "Couldn't load the queue",
            body: res.message,
            actions: [button("Try again", (b) => void whileBusy(b, load))],
          }),
        );
      }
      return;
    }
    count.textContent = plural(res.data.open, "open report", "open reports");
    if (res.data.items.length === 0) {
      list.replaceChildren(stateCard({ title: "All clear", body: "No open reports right now." }));
      return;
    }
    // Rebuilding the cards would drop focus to the page; put it back on the same spot.
    const active = document.activeElement;
    const spot = active instanceof HTMLElement && list.contains(active) ? focusSpot(active) : null;
    list.replaceChildren(...res.data.items.map(itemCard));
    if (spot) {
      const card = [...list.children].find(
        (c) => c instanceof HTMLElement && c.dataset.key === spot.key,
      );
      const part = spot.part
        ? card?.querySelector<HTMLElement>(`[data-part="${spot.part}"]`)
        : card;
      if (part instanceof HTMLElement) part.focus({ preventScroll: true });
    }
  }

  /** Which card, and which control in it, has focus. */
  function focusSpot(el: HTMLElement): { key: string; part: string | undefined } | null {
    const card = el.closest<HTMLElement>("article.item");
    if (!card?.dataset.key) return null;
    return { key: card.dataset.key, part: el.closest<HTMLElement>("[data-part]")?.dataset.part };
  }

  function itemCard(item: ReportQueueItem, n: number): HTMLElement {
    const { target } = item;
    const key = `${item.kind}:${item.id}`;
    const draft = drafts.get(key);
    const reasonId = `reason-${n}`;
    const daysId = `days-${n}`;
    const ruleId = `rule-${n}`;
    const reason = h("input", {
      class: "field-input",
      attrs: {
        id: reasonId,
        maxlength: 300,
        placeholder: "Why (kept in the log)",
        autocomplete: "off",
        enterkeyhint: "done",
        "data-part": "reason",
      },
    });
    const limits = suspendLimits(me.role);
    const days = h(
      "select",
      { class: "field-input days", attrs: { id: daysId, "data-part": "days" } },
      ...limits.choices.map((d) =>
        h("option", { attrs: { value: d, selected: d === 7 }, text: plural(d, "day", "days") }),
      ),
    );
    // Decision 0064: a takedown tells its owner which rule it broke. It starts on the rule most
    // reports named, so the usual case is still the reason and the two taps.
    const startRule = defaultRule(item);
    const rule = h(
      "select",
      { class: "field-input rule", attrs: { id: ruleId, "data-part": "rule" } },
      ...RULE_CHOICES.map((c) =>
        h("option", {
          attrs: { value: c.reason, selected: c.reason === startRule },
          text: c.label,
        }),
      ),
    );
    if (draft) {
      reason.value = draft.reason;
      days.value = draft.days;
      rule.value = draft.rule;
    }
    const keep = () =>
      drafts.set(key, { reason: reason.value, days: days.value, rule: rule.value });
    reason.addEventListener("input", keep);
    days.addEventListener("change", keep);
    rule.addEventListener("change", keep);
    const status = h("p", { class: "field-hint item-status", attrs: { role: "status" } });
    const actions = itemActions(item, me.role);
    const buttons: HTMLButtonElement[] = [];
    const disarms = new Map<HTMLButtonElement, () => void>();

    const call = (action: ItemAction): Promise<Result<unknown>> => {
      const why = reason.value.trim();
      const broke = rule.value as ReportReason;
      const calls: Record<ActionKind, () => Promise<Result<unknown>>> = {
        hide: () => api.hidePost(action.target, why, broke),
        unhide: () => api.unhidePost(action.target, why),
        suspend: () => api.suspend(action.target, Number(days.value), why),
        unsuspend: () => api.unsuspend(action.target, why),
        quarantine: () => api.quarantine(action.target, why),
        release: () => api.release(action.target, why),
        remove_pictures: () => api.removePictures(action.target, why, broke),
        remove_listing: () => api.removeListing(action.target, why, broke),
        remove_display: () => api.removeDisplay(action.target, why, broke),
        remove_piece: () => api.removePiece(action.target, why, broke),
        void_bounty: () => api.voidBounty(action.target, why),
        dismiss: () => api.dismiss(item.kind, item.id, why),
      };
      return calls[action.kind]();
    };

    const problemWith = (action: ItemAction) =>
      reasonProblem(reason.value) ??
      (action.kind === "suspend" ? daysProblem(Number(days.value), me.role) : undefined);

    async function run(action: ItemAction, pressed: HTMLButtonElement) {
      const problem = problemWith(action);
      if (problem) {
        status.textContent = problem;
        reason.focus();
        return;
      }
      const refocus = holdFocus(pressed);
      for (const b of buttons) b.disabled = true;
      status.textContent = "Saving…";
      const res = await call(action);
      if (destroyed) return;
      if (!res.ok) {
        for (const b of buttons) b.disabled = false;
        status.textContent = res.message;
        refocus();
        return;
      }
      // It went through. The buttons stay off so a second tap can't send it again, and the card
      // goes now instead of when the list reloads. Focus moves to the next card.
      drafts.delete(key);
      const next = card.nextElementSibling ?? card.previousElementSibling;
      const hadFocus =
        card.contains(document.activeElement) || document.activeElement === document.body;
      card.remove();
      if (hadFocus) (next instanceof HTMLElement ? next : title).focus({ preventScroll: true });
      toast("Done. It's in the log.");
      void load();
    }

    for (const action of actions) {
      const b = button(
        action.label,
        (pressed) => {
          if (!action.confirm) void run(action, pressed);
        },
        action.primary,
      );
      b.dataset.part = `action-${action.kind}`;
      buttons.push(b);
      // What can't be undone takes a second tap. A tap that can't go through yet (no reason)
      // goes straight to run, which says why.
      if (action.confirm) {
        const ask = () => problemWith(action) === undefined;
        disarms.set(
          b,
          confirmTwice(b, action.confirm, () => void run(action, b), ask),
        );
      }
    }
    const actionsRow = h("div", { class: "cluster item-actions" }, ...buttons);
    // Arming one button puts the others back.
    actionsRow.addEventListener(
      "click",
      (e) => {
        for (const [b, disarm] of disarms)
          if (!(e.target instanceof Node && b.contains(e.target))) disarm();
      },
      true,
    );
    const canSuspend = actions.some((a) => a.kind === "suspend");
    const canTakeDown = actions.some((a) => TAKEDOWN_ACTIONS.has(a.kind));
    const tags = itemTags(item);
    const record = recordLine(item.context);
    const oldest = item.reports.reduce((a, b) =>
      Date.parse(b.createdAt) < Date.parse(a.createdAt) ? b : a,
    );

    const card = h(
      "article",
      {
        class: `stack paper card item${item.needsHuman ? " urgent" : ""}`,
        attrs: {
          "data-kind": item.kind,
          "data-id": item.id,
          "data-key": key,
          "aria-labelledby": `item-${n}`,
          tabindex: -1,
        },
      },
      h(
        "header",
        { class: "item-head" },
        h("h2", { class: "eyebrow", attrs: { id: `item-${n}` }, text: itemHeading(item) }),
        h("span", {
          class: "item-age",
          text: `since ${relativeTime(oldest.createdAt, Date.now())}`,
          attrs: { title: fullDate(oldest.createdAt) },
        }),
      ),
      tags.length
        ? h(
            "ul",
            { class: "item-chips", attrs: { "aria-label": "State" } },
            ...tags.map((t, i) =>
              h("li", {
                class: `item-chip${item.needsHuman && i === 0 ? " urgent" : ""}`,
                text: t,
              }),
            ),
          )
        : null,
      target.author || record
        ? h(
            "div",
            { class: "item-subject" },
            target.author
              ? h(
                  "p",
                  { class: "item-author" },
                  item.kind === "resident" ? "Resident: " : "By ",
                  personLink(target.author, {
                    href: site + profilePath(target.author.id),
                    newTab: true,
                    picture: false,
                  }),
                )
              : null,
            record ? h("p", { class: "item-record", text: record }) : null,
          )
        : null,
      quoted(target.text),
      mediaList(target.media),
      item.kind === "post" && target.exists
        ? h(
            "p",
            { class: "item-link" },
            outLink(site + postPath(item.id), "Open the post"),
            target.hidden === "no" ? null : " (hidden, so it won't show there)",
          )
        : null,
      item.kind === "listing" && target.exists && target.author
        ? h(
            "p",
            { class: "item-link" },
            outLink(site + profilePath(target.author.id), "Open their stall"),
          )
        : null,
      (item.kind === "display" || item.kind === "piece") && target.exists && target.author
        ? h(
            "p",
            { class: "item-link" },
            outLink(
              site + profilePath(target.author.id),
              item.kind === "display" ? "Open who put it up" : "Open its maker",
            ),
          )
        : null,
      reportList(item.reports),
      item.triage ? triageBox(item.triage) : null,
      h(
        "div",
        { class: "decide" },
        h("label", { class: "field-label", attrs: { for: reasonId }, text: "Reason" }),
        reason,
        canTakeDown || canSuspend
          ? h(
              "div",
              { class: "decide-options" },
              canTakeDown
                ? h(
                    "div",
                    { class: "rule-row" },
                    h("label", {
                      class: "field-label",
                      attrs: { for: ruleId },
                      text: "Rule broken (they see this)",
                    }),
                    rule,
                  )
                : null,
              canSuspend
                ? h(
                    "div",
                    { class: "days-row" },
                    h("label", {
                      class: "field-label",
                      attrs: { for: daysId },
                      text: "Suspend for",
                    }),
                    days,
                  )
                : null,
            )
          : null,
        actionsRow,
        status,
      ),
    );
    return card;
  }

  void load();
  return {
    el,
    destroy() {
      destroyed = true;
    },
  };
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
    { class: "cluster item-media" },
    ...ours.map((m, i) => {
      if (m.kind !== "image") {
        return outLink(m.url, `Open ${m.kind} ${i + 1}`);
      }
      const img = h("img", {
        class: "blurred",
        attrs: { src: m.url, alt: `Reported picture ${i + 1}`, loading: "lazy", decoding: "async" },
      });
      const caption = h("span", { class: "media-reveal-caption", text: "Tap to show" });
      const reveal = h(
        "button",
        {
          class: "media-reveal",
          attrs: { type: "button", "aria-pressed": "false", "aria-label": `Show picture ${i + 1}` },
        },
        img,
        caption,
      );
      // The tile is cropped small; judge from the whole picture once it's shown.
      const full = outLink(m.url, "Open full size");
      full.append(h("span", { class: "visually-hidden", text: ` (picture ${i + 1})` }));
      full.hidden = true;
      reveal.addEventListener("click", () => {
        const shown = img.classList.toggle("blurred") === false;
        reveal.setAttribute("aria-pressed", String(shown));
        reveal.setAttribute("aria-label", `${shown ? "Blur" : "Show"} picture ${i + 1}`);
        caption.hidden = shown;
        full.hidden = !shown;
      });
      return h("div", { class: "media-item" }, reveal, full);
    }),
  );
}

/** How many reports show before the rest fold away. */
const REPORTS_SHOWN = 2;

function reportRow(rep: ReportQueueItem["reports"][number]): HTMLElement {
  return h(
    "li",
    { class: "report" },
    h(
      "p",
      { class: "report-line", attrs: { title: fullDate(rep.createdAt) } },
      h("span", { class: "report-reason", text: reasonLabel(rep.reason) }),
      ` · ${
        rep.source === "triage"
          ? "raised by AI triage"
          : `from ${rep.reporter?.name ?? "someone who left"}`
      } · ${relativeTime(rep.createdAt, Date.now())}`,
    ),
    rep.note ? h("p", { class: "report-note", text: rep.note }) : null,
  );
}

/**
 * A dry run's answers, folded under the chatter line, so staff can read the townsfolk's voice before
 * posts go live. A model wrote them and they can quote residents, so they go in as text.
 */
function chatterDrafts(drafts: AdminOverviewResponse["chatter"]["drafts"]): HTMLElement | null {
  if (drafts.length === 0) return null;
  const now = Date.now();
  return h(
    "details",
    { class: "fold" },
    h("summary", { text: `Read ${plural(drafts.length, "chatter draft", "chatter drafts")}` }),
    h(
      "ul",
      { class: "reports", attrs: { "aria-label": "Chatter drafts" } },
      ...drafts.map((d) =>
        h(
          "li",
          { class: "report" },
          h(
            "p",
            { class: "report-line", attrs: { title: fullDate(d.at) } },
            h("span", { class: "report-reason", text: `@${d.persona}` }),
            ` · ${draftLabel(d)} · ${relativeTime(d.at, now)}`,
          ),
          d.text ? h("p", { class: "report-note", text: d.text }) : null,
        ),
      ),
    ),
    h("p", {
      class: "field-hint",
      text: "Newest first. Nothing here was posted. A model wrote these, and they can quote residents.",
    }),
  );
}

function reportList(reports: ReportQueueItem["reports"]): HTMLElement {
  const rest = reports.slice(REPORTS_SHOWN);
  return h(
    "div",
    { class: "reports-block" },
    h(
      "ul",
      { class: "reports", attrs: { "aria-label": "Reports" } },
      ...reports.slice(0, REPORTS_SHOWN).map(reportRow),
    ),
    rest.length
      ? h(
          "details",
          { class: "fold" },
          h("summary", { text: `Show ${plural(rest.length, "more report", "more reports")}` }),
          h(
            "ul",
            { class: "reports", attrs: { "aria-label": "More reports" } },
            ...rest.map(reportRow),
          ),
        )
      : null,
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
    h(
      "details",
      { class: "fold" },
      h("summary", { text: "Why it suggests this" }),
      h("p", { class: "triage-rationale", text: verdict.rationale }),
      h("p", {
        class: "field-hint",
        text: "From a model that read the reported text, and it may quote residents. The suggestion does nothing until you pick an action.",
      }),
    ),
  );
}
