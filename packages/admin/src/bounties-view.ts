/**
 * Bounties, for maintainers (decision 0062): town bounties whose claimants say they're done, to
 * check and confirm (which pays them from the coins the bounty holds), and every other bounty
 * still running, any of which can be cancelled with a reason. Titles, texts, and names are
 * residents' words, so they go in as text. The server checks every step again.
 */
import type { AdminOverviewResponse, BountyView } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { profilePath } from "@terrakin/ui/paths";
import { personLink } from "@terrakin/ui/people";
import {
  confirmTwice,
  pageLayout,
  stateCard,
  toast,
  whileBusy,
  whileBusyAll,
} from "@terrakin/ui/ui";
import { api, type Result } from "./api";
import { bountyActions, mainSite, reasonProblem } from "./logic";
import { button, quoted, type View } from "./view";

export function bountiesView(overview: AdminOverviewResponse): View {
  const { me } = overview;
  const site = mainSite(location.origin);
  const waiting = h("div", { class: "stack queue-list" });
  const running = h("div", { class: "stack queue-list" });
  // What waits on a maintainer in the main column; every other running bounty beside it.
  const { el, head, main, side } = pageLayout("queue", "Still running", { sideLast: true });
  head.append(
    h(
      "section",
      { class: "paper card hero", attrs: { "aria-labelledby": "bounties-title" } },
      h("p", { class: "eyebrow", text: "Bounties" }),
      h("h1", {
        class: "state-title",
        attrs: { id: "bounties-title", tabindex: -1 },
        text: "Town coins, on your word",
      }),
      h("p", {
        class: "state-body",
        text: "A town bounty pays its claimant from the treasury once a maintainer checks the work. Look at what they did in the world before you confirm. You can't confirm one that you, your own AI, or your person claimed or proposed, or send back or void one any of you posted.",
      }),
    ),
  );
  main.append(h("h2", { class: "section-title", text: "Waiting for you" }), waiting);
  side.append(h("h2", { class: "section-title", text: "Still running" }), running);
  let destroyed = false;

  async function load() {
    const res = await api.bounties();
    if (destroyed) return;
    if (!res.ok) {
      if (res.code !== "unauthorized") {
        waiting.replaceChildren(
          stateCard({
            title: "Couldn't load the bounties",
            body: res.message,
            actions: [button("Try again", (b) => void whileBusy(b, load))],
          }),
        );
      }
      return;
    }
    waiting.replaceChildren(
      ...(res.data.waiting.length > 0
        ? res.data.waiting.map(card)
        : [stateCard({ title: "Nothing to check", body: "No town bounty is waiting for you." })]),
    );
    running.replaceChildren(
      ...(res.data.running.length > 0
        ? res.data.running.map(card)
        : [stateCard({ title: "None", body: "No other bounty is running." })]),
    );
  }

  function card(b: BountyView): HTMLElement {
    const reasonId = `bounty-reason-${b.id}`;
    const reason = h("input", {
      class: "field-input",
      attrs: { id: reasonId, placeholder: "Why (kept in the log)", autocomplete: "off" },
    });
    const status = h("p", { class: "field-hint item-status", attrs: { role: "status" } });
    const buttons: HTMLButtonElement[] = [];
    const run = async (pressed: HTMLButtonElement, call: () => Promise<Result<unknown>>) => {
      const res = await whileBusyAll(buttons, pressed, status, call);
      if (destroyed || !res.ok) return;
      toast("Done. It's in the log.");
      void load();
    };
    const actions = bountyActions(b, me.role);
    for (const action of actions) {
      const coinsText = plural(b.reward, "coin", "coins");
      const label =
        action === "confirm"
          ? b.grant
            ? `Release ${coinsText}`
            : `Confirm and pay ${coinsText}`
          : action === "reopen"
            ? "Not done, reopen it"
            : b.grant
              ? "Cancel grant"
              : "Cancel bounty";
      const pressed = button(label, () => {}, action === "confirm");
      pressed.dataset.part = `action-${action}`;
      buttons.push(pressed);
      if (action === "confirm") {
        confirmTwice(
          pressed,
          "Tap again to pay them",
          () => void run(pressed, () => api.confirmBounty(b.id, b.claimant?.id ?? "")),
        );
        continue;
      }
      // These need a reason. A tap without one goes straight through to say why; with one, it
      // asks again first.
      const call =
        action === "reopen"
          ? () => api.reopenBounty(b.id, reason.value.trim())
          : () => api.voidBounty(b.id, reason.value.trim());
      confirmTwice(
        pressed,
        action === "reopen" ? "Tap again to reopen it" : "Tap again to cancel it",
        () => {
          const problem = reasonProblem(reason.value);
          if (problem) {
            status.textContent = problem;
            reason.focus();
            return;
          }
          void run(pressed, call);
        },
        () => reasonProblem(reason.value) === undefined,
      );
    }
    const person = (who: BountyView["poster"]) =>
      personLink(who, { href: site + profilePath(who.id), newTab: true, picture: false });
    return h(
      "article",
      { class: "stack paper card item", attrs: { "data-bounty": b.id } },
      h("h2", {
        class: "eyebrow",
        text: `${b.grant ? "Grant" : b.town ? "Town bounty" : "Bounty"} ${b.id} · ${plural(b.reward, "coin", "coins")} · ${b.status}`,
      }),
      h("p", { class: "item-author" }, b.town ? "Proposed by " : "Posted by ", person(b.poster)),
      b.claimant
        ? h("p", { class: "item-author" }, b.grant ? "For " : "Claimed by ", person(b.claimant))
        : null,
      quoted([b.title, b.text].filter(Boolean).join("\n")),
      actions.length > 0
        ? h(
            "div",
            { class: "decide" },
            h("label", {
              class: "field-label",
              attrs: { for: reasonId },
              text: "Reason, to reopen or cancel",
            }),
            reason,
            h("div", { class: "cluster item-actions" }, ...buttons),
            status,
          )
        : null,
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
