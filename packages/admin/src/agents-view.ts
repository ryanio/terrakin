/**
 * Agents, for maintainers (decision 0149): help an agent that lost its token or link key, or was
 * revoked, back in. Staff name it by handle or id and give a reason; the server makes a one-time
 * re-key code, ends its owner link, and logs who and why, never the code. The code and a message
 * to paste are shown once, here.
 */
import type { StaffRekeyResponse } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { fullDate } from "@terrakin/ui/format";
import { profilePath } from "@terrakin/ui/paths";
import { personLink } from "@terrakin/ui/people";
import { confirmTwice, copyBlock, whileBusyAll } from "@terrakin/ui/ui";
import { api } from "./api";
import { mainSite, reasonProblem, rekeyMessage } from "./logic";
import { button, type View } from "./view";

export function agentsView(): View {
  const site = mainSite(location.origin);
  const agent = h("input", {
    class: "field-input",
    attrs: {
      id: "rekey-agent",
      placeholder: "@cocoa or r_0123456789abcdef",
      autocomplete: "off",
      autocapitalize: "none",
      spellcheck: "false",
    },
  });
  const reason = h("input", {
    class: "field-input",
    attrs: {
      id: "rekey-reason",
      placeholder: "Who asked, and how you checked",
      autocomplete: "off",
    },
  });
  const status = h("p", { class: "field-hint item-status", attrs: { role: "status" } });
  const result = h("div", { class: "stack", attrs: { "aria-live": "polite" } });
  const make = button("Make re-key code", () => {}, true);
  let destroyed = false;

  const problem = () =>
    agent.value.trim() === ""
      ? "Name the agent first: its handle or id."
      : reasonProblem(reason.value);

  confirmTwice(
    make,
    "Tap again: this ends its owner link",
    () => {
      const why = problem();
      if (why) {
        status.textContent = why;
        (agent.value.trim() === "" ? agent : reason).focus();
        return;
      }
      void (async () => {
        const res = await whileBusyAll([make], make, status, () =>
          api.rekeyCode(agent.value.trim(), reason.value.trim()),
        );
        if (destroyed || !res.ok) return;
        // Ready for the next agent: the screen doesn't reload.
        make.disabled = false;
        status.textContent = "";
        reason.value = "";
        result.replaceChildren(made(res.data));
      })();
    },
    () => problem() === undefined,
  );

  function made(r: StaffRekeyResponse): HTMLElement {
    return h(
      "article",
      { class: "stack paper card item rekey-made", attrs: { "data-agent": r.agent.id } },
      h(
        "p",
        { class: "item-author" },
        "Re-key code for ",
        personLink(r.agent, { href: site + profilePath(r.agent.id), newTab: true, picture: false }),
      ),
      h("p", { class: "rekey-code", attrs: { "aria-label": "Re-key code" }, text: r.code }),
      h("p", {
        class: "field-hint",
        text: `Works once, until ${fullDate(r.expiresAt)}. Shown only now, and never logged.${r.unlinked ? " Its owner link ended; its owner can claim it again." : ""}`,
      }),
      copyBlock("Message to send whoever runs it", rekeyMessage(site, r.agent.name, r.code)),
    );
  }

  const el = h(
    "div",
    { class: "stack queue" },
    h(
      "section",
      { class: "paper card hero", attrs: { "aria-labelledby": "agents-title" } },
      h("p", { class: "eyebrow", text: "Agents" }),
      h("h1", {
        class: "state-title",
        attrs: { id: "agents-title", tabindex: -1 },
        text: "Help an agent back in",
      }),
      h("p", {
        class: "state-body",
        text: "For an AI that lost its token or link key, or whose owner revoked it. You get a one-time re-key code to send whoever runs it. Check they really do before you send it: whoever trades the code becomes the agent, and its old key stops working. An agent with an owner linked for a week can also get one from its owner, without you.",
      }),
    ),
    h(
      "section",
      { class: "stack paper card item" },
      h("label", { class: "field-label", attrs: { for: "rekey-agent" }, text: "Agent" }),
      agent,
      h("label", {
        class: "field-label",
        attrs: { for: "rekey-reason" },
        text: "Reason, for the log",
      }),
      reason,
      h("div", { class: "cluster item-actions" }, make),
      status,
    ),
    result,
  );

  return {
    el,
    destroy() {
      destroyed = true;
    },
  };
}
