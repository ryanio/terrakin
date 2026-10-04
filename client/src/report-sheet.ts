/**
 * The Report sheet (RFC 0006): pick a reason, add a note if it helps, send. Opened from a post's
 * and a profile's "More" menu. The reported resident never learns who reported them.
 */
import { REPORT_NOTE_MAX_LENGTH, type ReportKind, type ReportReason } from "@terrakin/protocol";
import { api } from "./api";
import { h, icon } from "./dom";
import { savedToken } from "./net";
import { closeOverlay, openOverlay, toast } from "./ui";

/** Each reason in plain words, in the order the sheet lists them. */
export const REPORT_CHOICES: { reason: ReportReason; label: string; hint: string }[] = [
  { reason: "spam", label: "Spam", hint: "Ads, floods, or the same thing again and again" },
  { reason: "scam", label: "Scam", hint: "Asking for money, wallet keys, or passwords" },
  { reason: "hate", label: "Hate", hint: "Slurs, or attacks on who someone is" },
  { reason: "harassment", label: "Harassment", hint: "Bullying, threats, or piling on" },
  { reason: "sexual", label: "Sexual content", hint: "Nudity or sexual talk" },
  {
    reason: "self_harm",
    label: "Someone may be at risk",
    hint: "Talk of hurting themselves",
  },
  {
    reason: "impersonation",
    label: "Pretending to be someone",
    hint: "Another person, or the Terrakin team",
  },
  { reason: "other", label: "Something else", hint: "Say what in the note" },
];

export function openReportSheet(target: { kind: ReportKind; id: string; label: string }) {
  if (!savedToken()) {
    toast("Join to report things to the maintainers.", { href: "/#join", label: "Join" });
    return;
  }
  const close = h(
    "button",
    {
      class: "sheet-close",
      attrs: { type: "button", "aria-label": "Close" },
      on: { click: () => closeOverlay() },
    },
    icon("close"),
  );
  const choices = h("div", {
    class: "check-group",
    attrs: { role: "radiogroup", "aria-labelledby": "report-title" },
  });
  for (const c of REPORT_CHOICES) {
    const id = `report-${c.reason}`;
    choices.append(
      h(
        "label",
        { class: "check-row", attrs: { for: id } },
        h("input", {
          class: "check-input",
          attrs: { type: "radio", name: "report-reason", id, value: c.reason },
        }),
        h(
          "span",
          { class: "check-text" },
          h("span", { class: "check-label", text: c.label }),
          h("span", { class: "check-hint", text: c.hint }),
        ),
      ),
    );
  }
  const note = h("textarea", {
    class: "field-input report-note",
    attrs: {
      id: "report-note",
      rows: 3,
      maxlength: REPORT_NOTE_MAX_LENGTH,
      placeholder: "Anything that helps (optional)",
    },
  });
  const status = h("p", { class: "field-hint", attrs: { role: "status", "aria-live": "polite" } });
  const send = h("button", {
    class: "btn-primary report-send",
    attrs: { type: "submit" },
    text: "Send report",
  });
  const form = h(
    "form",
    { class: "report-form", attrs: { novalidate: true } },
    choices,
    h("label", { class: "field-label", attrs: { for: "report-note" }, text: "Note" }),
    note,
    status,
    send,
  );

  const dialog = h(
    "dialog",
    { class: "sheet report-sheet", attrs: { "aria-labelledby": "report-title" } },
    h(
      "div",
      { class: "sheet-card paper" },
      h(
        "div",
        { class: "sheet-head" },
        h("h2", { class: "sheet-title", attrs: { id: "report-title" }, text: "Report" }),
        close,
      ),
      h("p", {
        class: "sheet-lede",
        text: `What's wrong with this ${target.label}? A maintainer will look. Nobody else sees who reported it.`,
      }),
      form,
    ),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const picked = form.querySelector<HTMLInputElement>('input[name="report-reason"]:checked');
    if (!picked) {
      status.textContent = "Pick a reason first.";
      return;
    }
    const reason = picked.value as ReportReason;
    send.disabled = true;
    status.textContent = "Sending…";
    const text = note.value.trim();
    const res = await api.report({
      kind: target.kind,
      id: target.id,
      reason,
      ...(text ? { note: text } : {}),
    });
    send.disabled = false;
    if (!res.ok) {
      status.textContent = res.message;
      return;
    }
    closeOverlay();
    toast(
      reason === "self_harm"
        ? "Thanks. A maintainer will look soon. If someone is in danger right now, call local emergency services."
        : "Thanks. A maintainer will take a look.",
    );
  });

  openOverlay(dialog);
  close.focus();
}
