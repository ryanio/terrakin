/**
 * The Report sheet (RFC 0006): pick a reason, add a note if it helps, send. Opened from a post's
 * and a profile's "More" menu. The reported resident never learns who reported them.
 */
import { REPORT_NOTE_MAX_LENGTH, type ReportKind, type ReportReason } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { REPORT_CHOICES } from "@terrakin/ui/safety";
import {
  checkRow,
  closeOverlay,
  openOverlay,
  overlayShowing,
  sheet,
  toast,
  whileBusy,
} from "@terrakin/ui/ui";
import { api } from "./api";
import { savedToken } from "./net";

const CRISIS_LINE =
  "Thanks. A maintainer will look soon. If someone is in danger right now, call local emergency services.";

export function openReportSheet(target: { kind: ReportKind; id: string; label: string }) {
  if (!savedToken()) {
    toast("Join to report things to the maintainers.", { href: "/#join", label: "Join" });
    return;
  }
  const choices = h("div", {
    class: "check-group",
    attrs: { role: "radiogroup", "aria-labelledby": "report-title" },
  });
  for (const c of REPORT_CHOICES) {
    choices.append(
      checkRow({
        id: `report-${c.reason}`,
        label: c.label,
        hint: c.hint,
        radio: { name: "report-reason", value: c.reason },
      }).el,
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

  const { dialog, title, close } = sheet(
    {
      id: "report-title",
      title: "Report",
      className: "report-sheet",
      lede: `What's wrong with this ${target.label}? A maintainer will look. Nobody else sees who reported it.`,
    },
    form,
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const picked = form.querySelector<HTMLInputElement>('input[name="report-reason"]:checked');
    if (!picked) {
      status.textContent = "Pick a reason first.";
      return;
    }
    const reason = picked.value as ReportReason;
    status.textContent = "Sending…";
    const text = note.value.trim();
    const res = await whileBusy(send, () =>
      api.report({ kind: target.kind, id: target.id, reason, ...(text ? { note: text } : {}) }),
    );
    // Closed while it sent: say it in a toast, since the sheet is gone.
    const showing = overlayShowing(dialog);
    if (!res.ok) {
      if (showing) status.textContent = res.message;
      else toast(res.message);
      return;
    }
    if (reason !== "self_harm" || !showing) {
      closeOverlay(dialog);
      toast(reason === "self_harm" ? CRISIS_LINE : "Thanks. A maintainer will take a look.");
      return;
    }
    // The crisis line stays until they close it, instead of a toast that goes by.
    const done = h("button", {
      class: "btn-primary",
      attrs: { type: "button" },
      text: "Done",
      on: { click: () => closeOverlay(dialog) },
    });
    title.textContent = "Report sent";
    dialog.querySelector(".sheet-lede")?.remove();
    form.replaceWith(
      h(
        "div",
        { class: "sheet-body" },
        h("p", { class: "sheet-lede", attrs: { role: "status" }, text: CRISIS_LINE }),
        done,
      ),
    );
    done.focus();
  });

  openOverlay(dialog);
  close.focus();
}
