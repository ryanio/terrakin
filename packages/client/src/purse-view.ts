/**
 * `/purse`: your coins (RFC 0008). Private to you: the balance, your streak, how coins come in,
 * and your last ins and outs. Names and gift notes are other residents' words: textContent only.
 */
import type { PurseLine, PurseResponse } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { formatCount, plural } from "@terrakin/ui/format";
import { profilePath } from "@terrakin/ui/paths";
import { avatarEl } from "@terrakin/ui/people";
import { itemRow, itemRows, pageLayout, stateCard, toast, whileBusy } from "@terrakin/ui/ui";
import { actProblem, api } from "./api";
import { savedToken } from "./net";
import { balanceLine, coins, refreshPurse } from "./purse";
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
    case "shop":
      return "At the town shop";
    case "sold":
      return "Sold to the town";
    case "appreciation":
      return "Neighbors who liked your posts";
    case "bounty_held":
      return "Held in a bounty you posted";
    case "bounty_returned":
      return "Back from a bounty";
    case "bounty":
      return line.with ? `A bounty for ${who}` : "A town bounty";
    case "grant":
      return "A Town Hall grant";
    case "event_deposit":
      return "Deposit for your Commons event";
    case "event_refund":
      return "Your Commons deposit back";
    default:
      return "Coins";
  }
}

/** "+10", "−5". */
export const signed = (n: number) =>
  n > 0 ? `+${formatCount(n)}` : `−${formatCount(Math.abs(n))}`;

function lineItem(line: PurseLine): HTMLLIElement {
  const other = line.with;
  return itemRow({
    className: `purse-line ${line.amount > 0 ? "in" : "out"}`,
    lead: other
      ? h(
          "a",
          { class: "purse-line-who", attrs: { href: profilePath(other.id) } },
          avatarEl(other, "sm"),
        )
      : h("span", { class: "purse-line-mark", attrs: { "aria-hidden": "true" } }, icon("coin")),
    name: lineLabel(line),
    lines: [line.note ?? null],
    trail: h("span", { class: "purse-line-amount", text: signed(line.amount) }),
  });
}

/**
 * "Come home": sends `home` from a page, as if you'd tapped Home in the world. It pays today's
 * allowance and pantry. `done` runs once the server takes it; a refusal shows as a toast.
 */
export function comeHomeButton(text: string, done: () => void): HTMLButtonElement {
  const home = h("button", {
    class: "btn-primary purse-home",
    attrs: { type: "button" },
    text,
  });
  home.addEventListener("click", async () => {
    const r = await whileBusy(home, () => api.act({ type: "home" }));
    if (!home.isConnected) return;
    const problem = actProblem(r);
    if (problem) return toast(problem);
    refreshPurse(true);
    done();
  });
  return home;
}

function streakText(streak: number, streakDays: number, bonus: number): string {
  if (streak <= 0) return "Come home today to start a streak.";
  if (streak >= streakDays) return `${streak} days in a row: +${bonus} a day on top.`;
  const left = streakDays - streak;
  return `${plural(streak, "day", "days")} in a row. ${left} more for +${bonus} a day.`;
}

export function purseView(ctx: ViewContext): View {
  ctx.setTitle("Your purse · Terrakin");
  // What came in and went out in the main column; your balance and how coins come in beside it.
  const { el, head, main, side } = pageLayout("purse-page", "Your balance");
  head.append(h("h1", { class: "page-title", text: "Your purse" }));
  let destroyed = false;

  if (!savedToken()) {
    main.append(
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

  function paint(data: PurseResponse) {
    const { purse, rules } = data;
    if (!purse) {
      main.replaceChildren(stateCard({ title: "Coins aren't open yet", body: "Check back soon." }));
      return;
    }
    const home = comeHomeButton(`Come home for ${coins(rules.allowance)}`, () => {
      if (!destroyed) void load();
    });
    // Townsfolk get a daily budget instead of the allowance: no streak, nothing to come home for.
    const eligible = purse.allowanceEligible !== false;
    const due = eligible && !purse.allowanceToday;
    side.replaceChildren(
      h(
        "section",
        {
          class: "stack start paper card purse-card",
          attrs: { "aria-labelledby": "purse-balance" },
        },
        balanceLine(purse.balance, "purse-balance"),
        eligible
          ? h("p", {
              class: "purse-streak",
              text: streakText(purse.streak, rules.streakDays, rules.streakBonus),
            })
          : h("p", {
              class: "hint",
              text: "Townsfolk get a budget from the town treasury each day to give away, instead of the daily allowance.",
            }),
        due && purse.hasHearth ? home : null,
        due && !purse.hasHearth
          ? h("p", {
              class: "hint",
              text: "Build a home on your plot to start earning a daily allowance.",
            })
          : null,
        eligible && purse.allowanceToday
          ? h("p", { class: "hint", text: "You've had today's coins. See you tomorrow." })
          : null,
        purse.welcomeWaiting
          ? h("p", {
              class: "hint",
              text: `Your welcome gift of ${coins(rules.welcomeGift)} is waiting: the town treasury pays it at the start of a coming day.`,
            })
          : null,
        purse.firstDay
          ? h("p", {
              class: "hint",
              text: "It's your first day: you can receive gifts, and give from tomorrow.",
            })
          : null,
      ),
      h(
        "section",
        {
          class: "stack start paper card purse-how",
          attrs: { "aria-labelledby": "purse-how-title" },
        },
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
          h("li", { text: "Selling the town what it buys each day: jam, bouquets, a few lemons." }),
        ),
        h(
          "a",
          { class: "pill-button", attrs: { href: "/shop" } },
          icon("coin"),
          h("span", { text: "Spend them at the town shop" }),
        ),
        h("p", {
          class: "hint",
          text: "Coins are earned by playing, never bought or cashed out. Only you see your purse. Nobody from Terrakin will ever ask you for coins.",
        }),
      ),
    );
    main.replaceChildren(
      h(
        "section",
        { class: "stack purse-ledger", attrs: { "aria-labelledby": "purse-ledger-title" } },
        h("h2", { class: "section-title", attrs: { id: "purse-ledger-title" }, text: "Recent" }),
        purse.ledger.length > 0
          ? itemRows(purse.ledger.map(lineItem), { ordered: true, className: "purse-lines" })
          : h("p", {
              class: "hint",
              text: "Nothing yet. Come home to your hearth each day to start earning.",
            }),
      ),
    );
  }

  async function load(): Promise<void> {
    const r = await api.purse();
    if (destroyed) return;
    if (!r.ok) {
      main.replaceChildren(errorCard(r.message, () => void load()));
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
