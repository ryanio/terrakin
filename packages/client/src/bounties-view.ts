/**
 * `/bounties`: jobs residents and the town pay coins for (RFC 0008 phase 5, decision 0062). What's
 * open, who's on what, who was paid, and a form to post one. Every step and refusal comes from the
 * server: a bounty's `moves` say which buttons to show, from the sim's own checks. Titles, texts,
 * and names are other residents' words: text nodes only.
 */
import type { Action, BountiesResponse, BountyView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { personLink } from "@terrakin/ui/people";
import {
  confirmTwice,
  emptyNote,
  itemRow,
  itemRows,
  kindPill,
  stateCard,
  toast,
} from "@terrakin/ui/ui";
import { actFromButton } from "./act";
import { api } from "./api";
import { savedResidentId, savedToken } from "./net";
import { balanceLine, coins } from "./purse";
import { openReportSheet } from "./report-sheet";
import { errorCard, type View, type ViewContext } from "./view";

type Move = BountyView["moves"][number];

/** A button for one of the viewer's moves on a bounty. Pure, so tests pin it. */
export function moveButton(
  b: Pick<BountyView, "reward" | "claimant" | "poster">,
  move: Move,
  me: string | null,
): { text: string; again?: string; primary: boolean; done: string } {
  const who = b.claimant?.name ?? "them";
  switch (move) {
    case "claim_bounty":
      return {
        text: "Take it on",
        primary: true,
        done: "It's yours to do. Mark it done when it is.",
      };
    case "complete_bounty":
      return { text: "Mark done", primary: true, done: "Marked done. It pays once it's checked." };
    case "confirm_bounty":
      return {
        text: `Pay ${who} ${coins(b.reward)}`,
        again: `Tap again to pay ${coins(b.reward)}`,
        primary: true,
        done: `Paid ${who}.`,
      };
    case "drop_bounty":
      return b.claimant?.id === me
        ? { text: "Let it go", primary: false, done: "It's open again." }
        : { text: "Not done yet", primary: false, done: `${who} is off it. It's open again.` };
    case "cancel_bounty":
      return {
        text: "Take it back",
        again: "Tap again to take it back",
        primary: false,
        done: "Taken back. The coins are in your purse.",
      };
  }
}

/** What a bounty's status says, in plain words. Pure, so tests pin it. */
export function bountyStatus(
  b: Pick<BountyView, "status" | "claimant" | "town" | "grant">,
): string {
  const who = b.claimant?.name ?? "Someone";
  if (b.grant && b.status === "done") return `Granted to ${who}. A maintainer releases it.`;
  switch (b.status) {
    case "open":
      return "Open";
    case "claimed":
      return `${who} is on it`;
    case "done":
      return b.town ? `${who} says it's done. A maintainer will check.` : `${who} says it's done`;
    case "paid":
      return `Paid ${who}`;
    case "cancelled":
      return "Taken back";
    case "expired":
      return "Ran out of time";
  }
}

/** "Open until Nov 4". */
const until = (iso: string) =>
  `Open until ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(Date.parse(iso))}`;

export function bountiesView(ctx: ViewContext): View {
  ctx.setTitle("Bounties · Terrakin");
  const body = h("div", { class: "stack cards bounties-body" });
  const el = h(
    "div",
    { class: "column stack cards page bounties-page" },
    h("h1", { class: "page-title", text: "Bounties" }),
    body,
  );
  let destroyed = false;
  const signedIn = savedToken() !== null;
  const me = signedIn ? savedResidentId() : null;

  const act = (button: HTMLButtonElement, action: Action, done: string) =>
    actFromButton(button, action, done, { gone: () => destroyed, after: load });

  function moves(b: BountyView): HTMLElement | null {
    if (b.moves.length === 0) return null;
    const row = h("div", {
      class: "cluster bounty-moves",
      attrs: { role: "group", "aria-label": "What you can do" },
    });
    for (const move of b.moves) {
      const m = moveButton(b, move, me);
      const button = h("button", {
        class: m.primary ? "btn-primary small" : "pill-button small",
        attrs: { type: "button", "data-move": move },
        text: m.text,
      });
      const action =
        move === "confirm_bounty"
          ? { type: move, bounty: b.id, to: b.claimant?.id ?? "" }
          : { type: move, bounty: b.id };
      const go = () => void act(button, action as Action, m.done);
      if (m.again) confirmTwice(button, m.again, go);
      else button.addEventListener("click", go);
      row.append(button);
    }
    return row;
  }

  function card(b: BountyView): HTMLElement {
    const from = b.town
      ? h("span", { text: `${coins(b.reward)} from the town treasury` })
      : h("span", {}, `${coins(b.reward)} from `, personLink(b.poster));
    const report =
      signedIn && !b.town && b.poster.id !== me
        ? h("button", {
            class: "text-button",
            attrs: { type: "button" },
            text: "Report",
            on: { click: () => openReportSheet({ kind: "bounty", id: b.id, label: "bounty" }) },
          })
        : null;
    return h(
      "article",
      { class: "stack paper card proposal bounty", attrs: { "data-bounty": b.id } },
      h(
        "div",
        { class: "proposal-head" },
        kindPill(b.grant ? "Grant" : b.town ? "Town" : "Neighbor", b.town ? "sun" : "moss"),
        h("span", { class: `proposal-status s-${b.status}`, text: bountyStatus(b) }),
      ),
      h("h3", { class: "proposal-title", text: b.title }),
      b.text ? h("p", { class: "proposal-text", text: b.text }) : null,
      h("p", { class: "proposal-by bounty-reward" }, icon("coin"), from),
      b.town
        ? h("p", {
            class: "proposal-why",
            text: b.grant
              ? "A grant voted in at the Town Hall."
              : "Voted in at the Town Hall. A maintainer checks the work.",
          })
        : null,
      b.expiresAt && b.status !== "done"
        ? h("p", { class: "proposal-why", text: until(b.expiresAt) })
        : null,
      moves(b),
      report,
    );
  }

  function finishedRow(b: BountyView): HTMLLIElement {
    return itemRow({
      className: "bounty-done",
      attrs: { "data-bounty": b.id },
      lead: h("span", { class: "purse-line-mark", attrs: { "aria-hidden": "true" } }, icon("coin")),
      name: b.title,
      lines: [
        b.status === "paid" && b.claimant
          ? h("span", {}, `${coins(b.reward)} to `, personLink(b.claimant))
          : bountyStatus(b),
      ],
    });
  }

  function postForm(data: BountiesResponse): HTMLElement {
    const you = data.you;
    if (!you) return h("p", { class: "purse-hint", text: "Join to post a bounty." });
    if (!you.canPost)
      return h("p", { class: "purse-hint", text: you.why ?? "You can't post one yet." });
    const { rules } = data;
    const title = h("input", {
      class: "field-input",
      attrs: {
        id: "bounty-title",
        maxlength: rules.titleMax,
        autocomplete: "off",
        placeholder: "Water my lemons",
      },
    });
    const text = h("textarea", {
      class: "field-input",
      attrs: {
        id: "bounty-text",
        maxlength: rules.textMax,
        rows: 3,
        placeholder: "What needs doing, and when",
      },
    });
    const reward = h("input", {
      class: "field-input coin-amount",
      attrs: {
        id: "bounty-reward",
        type: "number",
        inputmode: "numeric",
        min: 1,
        max: Math.min(rules.rewardMax, you.balance),
        step: 1,
        value: String(Math.min(10, Math.max(1, you.balance))),
      },
    });
    const submit = h("button", {
      class: "btn-primary small",
      attrs: { type: "submit", id: "bounty-post" },
      text: "Post it",
    });
    const form = h(
      "form",
      { class: "stack tight paper card bounty-form", attrs: { novalidate: true } },
      h("label", { class: "field-label", attrs: { for: "bounty-title" }, text: "The job" }),
      title,
      h("label", {
        class: "field-label",
        attrs: { for: "bounty-text" },
        text: "Details (optional)",
      }),
      text,
      h("label", {
        class: "field-label",
        attrs: { for: "bounty-reward" },
        text: "Coins you'll pay",
      }),
      h("div", { class: "coin-row" }, reward, submit),
      h("p", {
        class: "field-hint",
        text: `Up to ${coins(rules.rewardMax)}. The coins leave your purse now and wait in the bounty until you pay, or take it back. It's open for ${rules.openDays} days.`,
      }),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const t = title.value.trim();
      const n = Number(reward.value);
      if (!t) {
        toast("Say what the job is.");
        title.focus();
        return;
      }
      if (!Number.isInteger(n) || n < 1) {
        toast("A reward is a whole number of coins, at least 1.");
        reward.focus();
        return;
      }
      const words = text.value.trim();
      void act(
        submit,
        { type: "post_bounty", title: t, reward: n, ...(words ? { text: words } : {}) },
        "Your bounty is up.",
      );
    });
    return form;
  }

  function paint(data: BountiesResponse) {
    const { bounties, you } = data;
    if (!bounties) {
      body.replaceChildren(
        stateCard({ title: "Bounties aren't open yet", body: "Check back soon." }),
      );
      return;
    }
    body.replaceChildren(
      h(
        "section",
        {
          class: "stack paper card bounties-card",
          attrs: { "aria-label": "Bounties and your purse" },
        },
        h("p", {
          class: "purse-hint",
          text: "Jobs neighbors and the town will pay coins for. Take one on, do it, mark it done, and get paid.",
        }),
        you
          ? balanceLine(you.balance, "bounties-balance")
          : h(
              "a",
              { class: "btn-primary", attrs: { href: "/#join" } },
              h("span", { text: "Join to take one on" }),
              icon("arrow"),
            ),
      ),
      h(
        "section",
        { class: "stack bounties-section", attrs: { "aria-labelledby": "bounties-open-title" } },
        h("h2", {
          class: "section-title",
          attrs: { id: "bounties-open-title" },
          text: "Open jobs",
        }),
        ...(bounties.running.length > 0
          ? bounties.running.map(card)
          : [
              emptyNote(
                "No jobs right now",
                "Post one, or propose one for the town at the Town Hall.",
              ),
            ]),
      ),
      ...(signedIn
        ? [
            h(
              "section",
              {
                class: "stack bounties-section",
                attrs: { "aria-labelledby": "bounties-post-title" },
              },
              h("h2", {
                class: "section-title",
                attrs: { id: "bounties-post-title" },
                text: "Post a bounty",
              }),
              postForm(data),
            ),
          ]
        : []),
      ...(bounties.finished.length > 0
        ? [
            h(
              "section",
              {
                class: "stack bounties-section",
                attrs: { "aria-labelledby": "bounties-paid-title" },
              },
              h("h2", {
                class: "section-title",
                attrs: { id: "bounties-paid-title" },
                text: "Lately",
              }),
              itemRows(bounties.finished.map(finishedRow), { className: "bounties-finished" }),
            ),
          ]
        : []),
    );
  }

  async function load(): Promise<void> {
    const res = await api.bounties();
    if (destroyed) return;
    if (!res.ok) {
      body.replaceChildren(errorCard(res.message, () => void load()));
      return;
    }
    paint(res.data);
  }

  return {
    el,
    ready: load(),
    destroy() {
      destroyed = true;
    },
  };
}
