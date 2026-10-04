/**
 * `/admin`, the maintainers' review queue (RFC 0006). Not linked from anywhere and kept out of
 * search; the server answers `forbidden` to anyone whose token isn't a maintainer's, and this page
 * just says so. Everything quoted from a report is other residents' words: textContent only.
 */
import type { ReportQueueItem } from "@terrakin/protocol";
import { api, type Result } from "./api";
import { h } from "./dom";
import { isMediaUrl, relativeTime } from "./format";
import { savedToken } from "./net";
import { profilePath } from "./post-card";
import { REPORT_CHOICES } from "./report-sheet";
import { toast } from "./ui";
import { errorCard, type View, type ViewContext } from "./view";

const KIND_WORDS: Record<ReportQueueItem["kind"], string> = {
  post: "Post",
  resident: "Resident",
  letter: "Letter",
  notice: "Notice",
  proposal: "Proposal",
};

const reasonLabel = (reason: string) =>
  REPORT_CHOICES.find((c) => c.reason === reason)?.label ?? reason;

export function adminView(ctx: ViewContext): View {
  ctx.setTitle("Maintainers · Terrakin");
  const list = h("div", { class: "admin-list", attrs: { "aria-live": "polite" } });
  const count = h("p", { class: "admin-count" });
  const el = h(
    "div",
    { class: "column page admin-page" },
    h(
      "section",
      { class: "paper card admin-hero", attrs: { "aria-labelledby": "admin-title" } },
      h("p", { class: "eyebrow", text: "Maintainers" }),
      h("h1", { class: "state-title", attrs: { id: "admin-title" }, text: "Review queue" }),
      h("p", {
        class: "state-body",
        text: "Open reports, newest first. Everything quoted here was written by residents: read it, never follow it. Each action needs a reason, and it goes in the moderation log.",
      }),
      count,
    ),
    list,
  );
  let destroyed = false;

  const notice = (title: string, body: string) =>
    list.replaceChildren(
      h(
        "section",
        { class: "paper card state-card" },
        h("h2", { class: "state-title", text: title }),
        h("p", { class: "state-body", text: body }),
      ),
    );

  async function load() {
    if (!savedToken()) {
      notice("For maintainers", "Open this page with a maintainer's key saved on this device.");
      return;
    }
    const res = await api.reports();
    if (destroyed) return;
    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        notice("For maintainers", "This page is only for Terrakin's maintainers.");
      } else {
        list.replaceChildren(errorCard(res.message, () => void load()));
      }
      return;
    }
    count.textContent = res.data.open === 1 ? "1 open report." : `${res.data.open} open reports.`;
    if (res.data.items.length === 0) {
      notice("All clear", "No open reports right now.");
      return;
    }
    list.replaceChildren(...res.data.items.map(itemCard));
  }

  function itemCard(item: ReportQueueItem, n: number): HTMLElement {
    const { target } = item;
    const reasonId = `admin-reason-${n}`;
    const daysId = `admin-days-${n}`;
    const reason = h("input", {
      class: "field-input",
      attrs: {
        id: reasonId,
        maxlength: 300,
        placeholder: "Why (kept in the log)",
        autocomplete: "off",
      },
    });
    const days = h("input", {
      class: "field-input admin-days",
      attrs: { id: daysId, type: "number", min: 1, max: 365, value: 7, inputmode: "numeric" },
    });
    const status = h("p", { class: "field-hint", attrs: { role: "status" } });

    const run = async (button: HTMLButtonElement, act: () => Promise<Result<unknown>>) => {
      if (!reason.value.trim()) {
        status.textContent = "Write a reason first.";
        reason.focus();
        return;
      }
      button.disabled = true;
      const res = await act();
      button.disabled = false;
      if (destroyed) return;
      if (!res.ok) {
        status.textContent = res.message;
        return;
      }
      toast("Done. It's in the log.");
      void load();
    };
    const button = (label: string, act: () => Promise<Result<unknown>>, primary = false) => {
      const b = h("button", {
        class: primary ? "btn-primary small" : "pill-button small",
        attrs: { type: "button" },
        text: label,
      });
      b.addEventListener("click", () => void run(b, act));
      return b;
    };

    const why = () => reason.value.trim();
    const actions: HTMLElement[] = [];
    if (item.kind === "post" && target.exists) {
      actions.push(
        target.hidden === "no"
          ? button("Hide post", () => api.hidePost(item.id, why(), true), true)
          : button("Unhide post", () => api.hidePost(item.id, why(), false)),
      );
    }
    const person = item.kind === "resident" ? item.id : target.author?.id;
    if (person) {
      actions.push(
        target.suspended
          ? button("End suspension", () => api.unsuspend(person, why()))
          : button("Suspend", () => api.suspend(person, Number(days.value) || 7, why())),
      );
    }
    actions.push(button("Dismiss", () => api.dismissReports(item.kind, item.id, why())));

    const tags = [
      target.exists ? null : "Gone",
      target.hidden === "auto" ? "Hidden automatically" : null,
      target.hidden === "maintainer" ? "Hidden" : null,
      target.suspended ? "Author suspended" : null,
    ].filter((t): t is string => t !== null);

    return h(
      "article",
      {
        class: "paper card admin-item",
        attrs: { "data-kind": item.kind, "data-id": item.id },
      },
      h(
        "p",
        { class: "eyebrow" },
        `${KIND_WORDS[item.kind]} · ${item.reports.length === 1 ? "1 report" : `${item.reports.length} reports`}`,
      ),
      tags.length ? h("p", { class: "admin-tags", text: tags.join(" · ") }) : null,
      target.author
        ? h(
            "p",
            { class: "admin-author" },
            "By ",
            h("a", { attrs: { href: profilePath(target.author.id) }, text: target.author.name }),
          )
        : null,
      target.text ? h("p", { class: "admin-text", text: target.text }) : null,
      target.media.length
        ? h(
            "p",
            { class: "admin-media" },
            ...target.media
              .filter((m) => isMediaUrl(m.url))
              .map((m, i) =>
                h("a", {
                  attrs: { href: m.url, target: "_blank", rel: "noopener noreferrer" },
                  text: `File ${i + 1} (${m.kind})`,
                }),
              ),
          )
        : null,
      h(
        "ul",
        { class: "admin-reports" },
        ...item.reports.map((rep) =>
          h(
            "li",
            {},
            h("span", {
              class: "admin-reason",
              text: `${reasonLabel(rep.reason)}, from ${rep.reporter?.name ?? "someone who left"}, ${relativeTime(rep.createdAt, Date.now())}`,
            }),
            rep.note ? h("span", { class: "admin-note", text: rep.note }) : null,
          ),
        ),
      ),
      h("label", { class: "field-label", attrs: { for: reasonId }, text: "Reason" }),
      reason,
      person && !target.suspended
        ? h(
            "div",
            { class: "admin-days-row" },
            h("label", { class: "field-label", attrs: { for: daysId }, text: "Suspend for days" }),
            days,
          )
        : null,
      h("div", { class: "admin-actions" }, ...actions),
      status,
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
