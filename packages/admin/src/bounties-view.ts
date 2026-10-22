/**
 * Bounties, for maintainers (decision 0062): town bounties whose claimants say they're done, to
 * check and confirm (which pays them from the coins the bounty holds), and every other bounty
 * still running, any of which can be cancelled with a reason. Titles, texts, and names are
 * residents' words, so they go in as text. The server checks every step again.
 */
import { type AdminOverviewResponse, AWARD_RULES, type BountyView } from "@terrakin/protocol";
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
import { awardedWords, awardProblem, bountyActions, mainSite, reasonProblem } from "./logic";
import { button, pageHead, quoted, type View } from "./view";

export function bountiesView(overview: AdminOverviewResponse): View {
  const { me } = overview;
  const site = mainSite(location.origin);
  const waiting = h("div", { class: "stack queue-list" });
  const running = h("div", { class: "stack queue-list" });
  // What waits on a maintainer in the main column; every other running bounty beside it.
  const { el, head, main, side } = pageLayout("queue", "Still running", { sideLast: true });
  head.append(
    pageHead({
      id: "bounties-title",
      title: "Town coins, on your word",
      lede: "A town bounty pays its claimant from the treasury once a maintainer checks the work. Look at what they did in the world before you confirm. You can't confirm one that you, your own AI, or your person claimed or proposed, or send back or void one any of you posted.",
    }),
  );
  main.append(h("h2", { class: "section-title", text: "Waiting for you" }), waiting);
  side.append(awardCard(), h("h2", { class: "section-title", text: "Still running" }), running);
  let destroyed = false;

  /**
   * Awarding treasury coins for good work (RFC 0036). No vote and no second maintainer, so the
   * card says the caps out loud and takes two taps. An award to your own household goes through
   * and is flagged where residents can see it; the card says so rather than hiding the case.
   */
  function awardCard(): HTMLElement {
    const to = h("input", {
      class: "field-input",
      attrs: { id: "award-to", placeholder: "Resident id (r_...)", autocomplete: "off" },
    });
    const coins = h("input", {
      class: "field-input",
      attrs: {
        id: "award-coins",
        type: "number",
        min: "1",
        max: String(AWARD_RULES.max),
        placeholder: "Coins",
        autocomplete: "off",
      },
    });
    const reason = h("input", {
      class: "field-input",
      attrs: { id: "award-reason", placeholder: "Why (kept in the log)", autocomplete: "off" },
    });
    const status = h("p", { class: "field-hint item-status", attrs: { role: "status" } });
    const pressed = button("Award coins", () => {}, true);
    pressed.dataset.part = "action-award";
    const problem = () => awardProblem(to.value, Number(coins.value), reason.value);
    confirmTwice(
      pressed,
      "Tap again to pay them",
      () => {
        const why = problem();
        if (why) {
          status.textContent = why.message;
          // The field comes from `awardProblem`, so rewording a message never misplaces focus.
          ({ to, coins, reason })[why.field].focus();
          return;
        }
        void (async () => {
          const res = await whileBusyAll([pressed], pressed, status, () =>
            api.award(to.value.trim(), Number(coins.value), reason.value.trim()),
          );
          if (destroyed || !res.ok) return;
          status.textContent = awardedWords(
            res.data.coins,
            res.data.left,
            res.data.household === true,
          );
          toast("Awarded. It's in the log.");
          to.value = "";
          coins.value = "";
          reason.value = "";
        })();
      },
      () => problem() === undefined,
    );
    return h(
      "section",
      { class: "stack paper card staff-form", attrs: { "aria-labelledby": "award-title" } },
      h("h2", { class: "card-title", attrs: { id: "award-title" }, text: "Award coins" }),
      h("p", {
        class: "field-hint",
        text: `Up to ${AWARD_RULES.max} coins each, ${AWARD_RULES.perMonth} across every award in ${AWARD_RULES.windowDays} days, out of what the treasury can spare. Awarding your own AI or person works, and the town is told it was your household.`,
      }),
      h("label", { class: "field-label", attrs: { for: "award-to" }, text: "Who" }),
      to,
      h("label", { class: "field-label", attrs: { for: "award-coins" }, text: "Coins" }),
      coins,
      h("label", { class: "field-label", attrs: { for: "award-reason" }, text: "Why" }),
      reason,
      h("div", { class: "cluster" }, pressed),
      status,
    );
  }

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
      { class: "stack paper card item bounty", attrs: { "data-bounty": b.id } },
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
            h("div", { class: "cluster" }, ...buttons),
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
