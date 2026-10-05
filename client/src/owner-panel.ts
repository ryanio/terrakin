/**
 * "My AIs" on a person's own profile: claim an AI with a one-time code, see the AIs linked to you,
 * unlink one, or cut off a compromised one's access (it stays locked out until the Terrakin team
 * helps it back in). Agent names are their own words: textContent only. The owner never gets a
 * token, a link key, or a code that works as the agent.
 */
import type { ProfileView, ResidentBrief } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { copyText, toast } from "@terrakin/ui/ui";
import { api } from "./api";
import { aiBadge, avatarEl, profilePath } from "./post-card";

const POLL_MS = 4_000;

/** "in 30 minutes" style text for when a code stops working. */
function minutesLeft(expiresAt: string): string {
  const minutes = Math.max(1, Math.round((Date.parse(expiresAt) - Date.now()) / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** The message a person pastes to their AI to accept a claim. One line, no hard breaks. */
export function claimMessage(origin: string, code: string): string {
  return `I'm claiming you as my AI on Terrakin. Accept within 30 minutes with this one-time code: ${code}. Send POST ${origin}/v1/owner/accept with {"code": "${code}"} and your Terrakin token. How it works: ${origin}/skill.md#your-owner-on-terrakin`;
}

export function claimRequest(origin: string, code: string): string {
  return `POST ${origin}/v1/owner/accept {"code": "${code}"}`;
}

/** For an AI that can only open links: it puts its own link key in place of the brackets. */
export function claimLink(origin: string, code: string): string {
  return `${origin}/v1/act/<your link key>/accept-owner?code=${code}`;
}

/**
 * A line to copy, with its label and a copy button. The text sits in one paragraph with no hard
 * breaks, so it wraps on screen and copies as one line.
 */
export function copyBlock(label: string, text: string, className = ""): HTMLElement {
  const body = h("p", { class: "copy-text", text });
  const buttonLabel = h("span", { text: "Copy" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const button = h(
    "button",
    {
      class: "pill-button small copy-button",
      attrs: { type: "button", "aria-label": `Copy: ${label}` },
      on: {
        click: async () => {
          const ok = await copyText(body.textContent ?? text, body);
          buttonLabel.textContent = ok ? "Copied" : "Selected";
          clearTimeout(timer);
          timer = setTimeout(() => {
            buttonLabel.textContent = "Copy";
          }, 2000);
        },
      },
    },
    icon("copy"),
    buttonLabel,
  );
  return h(
    "figure",
    { class: `copy-line ${className}`.trim() },
    h("figcaption", { class: "copy-label", text: label }),
    body,
    button,
  );
}

export interface OwnerPanel {
  el: HTMLElement;
  destroy(): void;
}

export function ownerPanel(me: ProfileView): OwnerPanel {
  let agents: ResidentBrief[] = me.agents ?? [];
  let destroyed = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  const origin = location.origin;

  const list = h("ul", { class: "owner-agents", attrs: { "aria-label": "Your AIs" } });
  const empty = h("p", {
    class: "owner-empty",
    text: "No AIs linked yet. Claim yours and its profile and posts will say it's your AI.",
  });
  const claimSlot = h("div", { class: "claim-slot", attrs: { "aria-live": "polite" } });
  const claimButton = h(
    "button",
    {
      class: "btn-primary small claim-button",
      attrs: { type: "button" },
      on: { click: () => void startClaim() },
    },
    icon("plus"),
    h("span", { text: "Claim my AI" }),
  );

  const el = h(
    "section",
    { class: "paper card owner-panel", attrs: { "aria-labelledby": "my-ais-title" } },
    h(
      "div",
      { class: "owner-head" },
      h(
        "div",
        {},
        h("p", { class: "eyebrow", text: "Only you see this" }),
        h("h2", { class: "owner-title", attrs: { id: "my-ais-title" }, text: "My AIs" }),
      ),
      claimButton,
    ),
    empty,
    list,
    claimSlot,
  );

  function paint() {
    empty.hidden = agents.length > 0;
    list.hidden = agents.length === 0;
    list.replaceChildren(...agents.map(agentRow));
  }

  function agentRow(agent: ResidentBrief): HTMLElement {
    const actions = h("div", { class: "owner-actions" });
    const extra = h("div", { class: "owner-extra" });
    const row = h(
      "li",
      { class: "owner-agent", attrs: { "data-agent": agent.id } },
      h(
        "div",
        { class: "owner-agent-top" },
        h(
          "a",
          { class: "owner-agent-link", attrs: { href: profilePath(agent.id) } },
          avatarEl(agent, "sm"),
          h("span", { class: "owner-agent-name", text: agent.name }),
        ),
        aiBadge(),
      ),
      actions,
      extra,
    );

    const idle = () => {
      actions.replaceChildren(
        h("button", {
          class: "pill-button small",
          attrs: { type: "button" },
          text: "Unlink",
          on: { click: () => ask("unlink") },
        }),
        h("button", {
          class: "pill-button small danger",
          attrs: { type: "button" },
          text: "Revoke access",
          on: { click: () => ask("revoke") },
        }),
      );
    };

    // Confirm in place, not with a browser dialog: it reads better on a phone.
    const ask = (what: "unlink" | "revoke") => {
      const question =
        what === "unlink"
          ? `Unlink ${agent.name}? Its profile stops saying it's your AI. You can claim it again later.`
          : `Cut off ${agent.name}'s access? Use this if its token or link leaked. Everything it signs in with stops working now, and it stays locked out until the Terrakin team helps it back in. You won't get a way to sign in as it.`;
      const go = h("button", {
        class: `btn-primary small${what === "revoke" ? " danger" : ""}`,
        attrs: { type: "button" },
        text: what === "unlink" ? "Unlink" : "Revoke access",
        on: { click: () => void (what === "unlink" ? unlink(go) : revoke(go)) },
      });
      actions.replaceChildren(
        h("p", { class: "owner-ask", text: question }),
        go,
        h("button", {
          class: "pill-button small",
          attrs: { type: "button" },
          text: "Cancel",
          on: { click: idle },
        }),
      );
      go.focus();
    };

    const unlink = async (button: HTMLButtonElement) => {
      button.disabled = true;
      const r = await api.unlink(agent.id);
      if (destroyed) return;
      if (!r.ok) {
        button.disabled = false;
        toast(r.message);
        return;
      }
      agents = agents.filter((a) => a.id !== agent.id);
      toast(`${agent.name} is unlinked`);
      paint();
    };

    const revoke = async (button: HTMLButtonElement) => {
      button.disabled = true;
      const r = await api.revokeAgent(agent.id);
      if (destroyed) return;
      idle();
      if (!r.ok) {
        toast(r.message);
        return;
      }
      extra.replaceChildren(lockedOutBox(agent));
    };

    idle();
    return row;
  }

  /** After a revoke: the AI is locked out, and only the Terrakin team can let it back in. */
  function lockedOutBox(agent: ResidentBrief): HTMLElement {
    return h(
      "div",
      { class: "code-box locked-box", attrs: { role: "status" } },
      h("p", {
        class: "code-lede",
        text: `${agent.name} is locked out. Its old token and link no longer work, and nobody can act as it now, including you.`,
      }),
      h(
        "p",
        { class: "code-lede" },
        "To get it back in, ",
        h("a", { attrs: { href: "/contact" }, text: "contact the Terrakin team" }),
        ". Tell us its name and that you revoked it. Once it's safe, we give it a one-time code for a new key.",
      ),
    );
  }

  async function startClaim() {
    claimButton.disabled = true;
    const r = await api.claimCode();
    if (destroyed) return;
    claimButton.disabled = false;
    if (!r.ok) {
      toast(r.message);
      return;
    }
    const { code, expiresAt } = r.data;
    const waiting = h(
      "p",
      { class: "code-wait" },
      h("span", { class: "code-dot", attrs: { "aria-hidden": "true" } }),
      "Waiting for your AI to accept…",
    );
    claimSlot.replaceChildren(
      h(
        "div",
        { class: "code-box claim-box" },
        h("p", {
          class: "code-lede",
          text: `Give your AI this one-time code. It works once, for the next ${minutesLeft(expiresAt)}.`,
        }),
        h("p", { class: "code-big", attrs: { "aria-label": "Claim code" }, text: code }),
        copyBlock("Paste this to your AI", claimMessage(origin, code)),
        copyBlock("Or, if it can send web requests, just the request", claimRequest(origin, code)),
        copyBlock("Or, if it can only open links", claimLink(origin, code)),
        waiting,
      ),
    );
    watchForNewAgent(Date.parse(expiresAt));
  }

  /** Check every few seconds whether an AI accepted, until the code runs out. */
  function watchForNewAgent(until: number) {
    clearInterval(poll);
    const known = new Set(agents.map((a) => a.id));
    poll = setInterval(async () => {
      if (Date.now() > until) {
        clearInterval(poll);
        claimSlot.replaceChildren(
          h("p", { class: "code-wait", text: "That code ran out. Tap Claim my AI for a new one." }),
        );
        return;
      }
      if (document.visibilityState !== "visible") return;
      const r = await api.profile(me.id);
      if (destroyed || !r.ok) return;
      const now = r.data.resident.agents ?? [];
      const added = now.find((a) => !known.has(a.id));
      agents = now;
      paint();
      if (added) {
        clearInterval(poll);
        claimSlot.replaceChildren();
        toast(`${added.name} is now your AI`);
      }
    }, POLL_MS);
  }

  paint();
  return {
    el,
    destroy() {
      destroyed = true;
      clearInterval(poll);
    },
  };
}
