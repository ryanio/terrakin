/**
 * `/purse`: your coins (RFC 0008). Private to you: the balance, your streak, how coins come in,
 * and your last ins and outs. Names and gift notes are other residents' words: textContent only.
 */
import type { PurseLine, PurseResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { compactCount } from "@terrakin/ui/format";
import { profilePath } from "@terrakin/ui/paths";
import { avatarEl } from "@terrakin/ui/people";
import { stateCard, toast } from "@terrakin/ui/ui";
import { api } from "./api";
import { savedToken } from "./net";
import { coins, refreshPurse } from "./purse";
import { errorCard, type View, type ViewContext } from "./view";

/** What a purse line was, in plain words. Pure, so tests pin it. */
export function lineLabel(line: Pick<PurseLine, "reason" | "with">): string {
  const who = line.with?.name ?? "someone";
  switch (line.reason) {
    case "allowance":
      return "Coming home";
    case "streak":
      return "Days in a row";
    case "welcome":
      return "Welcome gift for your first plot";
    case "gift_in":
      return `A gift from ${who}`;
    case "gift_out":
      return `Your gift to ${who}`;
    case "budget":
      return "Today's townsfolk budget";
    case "budget_return":
      return "Unspent budget back to the town";
    default:
      return "Coins";
  }
}

/** "+10", "−5". */
export const signed = (n: number) =>
  n > 0 ? `+${n.toLocaleString("en-US")}` : `−${Math.abs(n).toLocaleString("en-US")}`;

function lineItem(line: PurseLine): HTMLElement {
  const other = line.with;
  return h(
    "li",
    { class: `purse-line ${line.amount > 0 ? "in" : "out"}` },
    other
      ? h(
          "a",
          { class: "purse-line-who", attrs: { href: profilePath(other.id) } },
          avatarEl(other, "sm"),
        )
      : h("span", { class: "purse-line-mark", attrs: { "aria-hidden": "true" } }, icon("coin")),
    h(
      "span",
      { class: "purse-line-body" },
      h("span", { class: "purse-line-label", text: lineLabel(line) }),
      line.note ? h("span", { class: "purse-line-note", text: line.note }) : null,
    ),
    h("span", { class: "purse-line-amount", text: signed(line.amount) }),
  );
}

function streakText(streak: number, streakDays: number, bonus: number): string {
  if (streak <= 0) return "Come home today to start a streak.";
  if (streak >= streakDays) return `${streak} days in a row: +${bonus} a day on top.`;
  const left = streakDays - streak;
  return `${streak} ${streak === 1 ? "day" : "days"} in a row. ${left} more for +${bonus} a day.`;
}

export function purseView(ctx: ViewContext): View {
  ctx.setTitle("Your purse · Terrakin");
  const el = h(
    "div",
    { class: "column page purse-page" },
    h("h1", { class: "page-title", text: "Your purse" }),
  );
  let destroyed = false;

  if (!savedToken()) {
    el.append(
      stateCard({
        title: "Join to earn coins",
        body: "Residents earn coins by coming home each day, and give them to friends. Coins are earned by playing, never bought.",
        actions: [
          h(
            "a",
            { class: "btn-primary", attrs: { href: "/#join" } },
            h("span", { text: "Join" }),
            icon("arrow"),
          ),
        ],
      }),
    );
    return { el, ready: Promise.resolve(), destroy() {} };
  }

  const body = h("div", { class: "purse-body" });
  el.append(body);

  function paint(data: PurseResponse) {
    const { purse, rules } = data;
    if (!purse) {
      body.replaceChildren(stateCard({ title: "Coins aren't open yet", body: "Check back soon." }));
      return;
    }
    const home = h("button", {
      class: "btn-primary purse-home",
      attrs: { type: "button" },
      text: `Come home for ${coins(rules.allowance)}`,
    });
    home.addEventListener("click", async () => {
      home.disabled = true;
      const r = await api.act({ type: "home" });
      if (destroyed) return;
      home.disabled = false;
      if (!r.ok) return toast(r.message);
      if (!r.data.ok) return toast(r.data.error.message);
      refreshPurse(true);
      void load();
    });
    const due = !purse.allowanceToday;
    body.replaceChildren(
      h(
        "section",
        { class: "paper card purse-card", attrs: { "aria-labelledby": "purse-balance" } },
        h(
          "p",
          { class: "purse-balance", attrs: { id: "purse-balance" } },
          icon("coin", "icon purse-balance-coin"),
          h("span", { class: "purse-balance-amount", text: compactCount(purse.balance) }),
          h("span", { class: "purse-balance-unit", text: purse.balance === 1 ? "coin" : "coins" }),
        ),
        h("p", {
          class: "purse-streak",
          text: streakText(purse.streak, rules.streakDays, rules.streakBonus),
        }),
        due && purse.hasHearth ? home : null,
        due && !purse.hasHearth
          ? h("p", {
              class: "purse-hint",
              text: "Build a home on your plot to start earning a daily allowance.",
            })
          : null,
        purse.allowanceToday
          ? h("p", { class: "purse-hint", text: "You've had today's coins. See you tomorrow." })
          : null,
        purse.welcomeWaiting
          ? h("p", {
              class: "purse-hint",
              text: `Your welcome gift of ${coins(rules.welcomeGift)} is waiting: the town treasury pays it at the start of a coming day.`,
            })
          : null,
        purse.firstDay
          ? h("p", {
              class: "purse-hint",
              text: "It's your first day: you can receive gifts, and give from tomorrow.",
            })
          : null,
      ),
      h(
        "section",
        { class: "paper card purse-how", attrs: { "aria-labelledby": "purse-how-title" } },
        h("h2", {
          class: "card-title",
          attrs: { id: "purse-how-title" },
          text: "How coins come in",
        }),
        h(
          "ul",
          { class: "purse-how-list" },
          h("li", {
            text: `Come home to your hearth once a day: ${coins(rules.allowance)}, and ${rules.streakBonus} more a day from ${rules.streakDays} days in a row.`,
          }),
          h("li", { text: `Your first plot: a welcome gift of ${coins(rules.welcomeGift)}.` }),
          h("li", {
            text: `Gifts from friends. You can give up to ${coins(rules.giveCap)} a day from a profile.`,
          }),
        ),
        h("p", {
          class: "purse-hint",
          text: "Coins are earned by playing, never bought or cashed out. Only you see your purse. Nobody from Terrakin will ever ask you for coins.",
        }),
      ),
      h(
        "section",
        { class: "purse-ledger", attrs: { "aria-labelledby": "purse-ledger-title" } },
        h("h2", { class: "section-title", attrs: { id: "purse-ledger-title" }, text: "Recent" }),
        purse.ledger.length > 0
          ? h("ol", { class: "purse-lines" }, ...purse.ledger.map(lineItem))
          : h("p", { class: "purse-hint", text: "Nothing yet." }),
      ),
    );
  }

  async function load(): Promise<void> {
    const r = await api.purse();
    if (destroyed) return;
    if (!r.ok) {
      body.replaceChildren(errorCard(r.message, () => void load()));
      return;
    }
    paint(r.data);
  }

  return {
    el,
    ready: load(),
    destroy() {
      destroyed = true;
    },
  };
}
