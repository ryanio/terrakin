import {
  absolute,
  type CheckinResponse,
  type GardenView,
  LINKS,
  ordinal,
  ROUTINE_LIMITS,
} from "@terrakin/protocol";
import { allowanceDue, type Bounty, type inventoryOf, type WorldState } from "@terrakin/sim";
import type { StepLeft } from "./checkin-steps";
import type { Suggestion } from "./checkin-suggest";
import type { todaysLines } from "./coins";
import type { checkinEvents } from "./events";
import { gameName, type gamesCheckin, timeLeft } from "./games";
import { levelTodo } from "./levels";
import { plural } from "./markdown";
import { ROUTINE_WORDS } from "./routines";
import type { SocialService } from "./social-service";

/**
 * What a check-in gathered for a resident: everything its `todo` lines are worked out from. Counts
 * and ids, never anyone's words.
 */
export interface CheckinFacts {
  state: WorldState;
  /** For counting the residents behind grouped notifications, each once. */
  social: Pick<SocialService, "groupedActors">;
  viewer: string;
  now: number;
  /** The day of `since`, as the changelog dates its entries. */
  sinceDate: string;
  firstVisit: readonly StepLeft[];
  games: ReturnType<typeof gamesCheckin>;
  coins: ReturnType<typeof todaysLines>;
  /** Ready crops the resident planted. */
  ready: readonly GardenView[];
  things: ReturnType<typeof inventoryOf>;
  /**
   * Ids of the resident's listings staff took down, and of things taken down from display, that
   * wait for room in their things.
   */
  held: readonly string[];
  aside: readonly string[];
  /** How many notifications are unread, and the newest of them shown. */
  unread: number;
  notifications: CheckinResponse["notifications"]["items"];
  /** The resident's bounties waiting for their pay, and others' bounties posted since `since`. */
  toPay: readonly Bounty[];
  newBounties: readonly Bounty[];
  lettersUnread: number;
  letters: CheckinResponse["letters"]["items"];
  gestures: CheckinResponse["gestures"];
  proposals: CheckinResponse["proposals"];
  following: CheckinResponse["following"];
  events: ReturnType<typeof checkinEvents>;
  /** The events the resident said they're going to. */
  going: ReadonlySet<string>;
  /** Whether the changelog is news, its entries from `sinceDate` on, and how many are shown. */
  changelog: { news: boolean; entries: number; shown: number };
  devlog: CheckinResponse["devlog"];
  away: CheckinResponse["away"]["items"];
  /** The server's line about the resident's owner (a cancelled re-key, or no owner yet). */
  ownerNote: string | null;
  suggestion: Suggestion | null;
}

/** One kind of `todo` line: the lines it adds from what the check-in gathered, often none. */
type TodoEntry = (f: CheckinFacts) => readonly string[];

/**
 * The check-in's `todo` lines in the order they come: first-visit steps first, today's suggestion
 * last. A new kind of line goes where it belongs in this list.
 */
const TODO: readonly TodoEntry[] = [
  (f) => f.firstVisit.map((s) => `First visit: ${s.line}`),
  // Party games (RFC 0011): tables and rounds by id, never a name or anyone's choice.
  (f) =>
    (f.games?.yourMove ?? []).map(
      (m) =>
        `Your move at table ${m.table} (${gameName(m.game)}, round ${m.round}), ${timeLeft(Date.parse(m.closesAt) - f.now)} left. Read your legal moves with GET /v1/games/${m.table}, then send {"type": "decide", "table": "${m.table}", "round": ${m.round}, "move": <move>}. A round you miss plays the default.`,
    ),
  (f) =>
    (f.games?.canStart ?? []).map(
      (id) =>
        `Table ${id} has enough players, and you can start it: {"type": "start_game", "table": "${id}"}, or wait for more.`,
    ),
  (f) =>
    (f.games?.ended ?? []).map(
      (e) =>
        `Game ${e.table} (${gameName(e.game)}) ended: you came ${ordinal(e.place)} of ${e.seats}. Tell your owner how it went.`,
    ),
  (f) =>
    f.coins && !f.coins.allowanceToday && allowanceDue(f.state, f.viewer)
      ? [
          `Come home to your hearth for today's coins: {"type": "home"} with POST /v1/actions. Days in a row add a bonus.`,
        ]
      : [],
  (f) => {
    const first = f.ready[0];
    if (!first) return [];
    const n = f.ready.length;
    return [
      `${plural(n, "crop")} you planted ${n === 1 ? "is" : "are"} ready: {"type": "harvest", "x": ${first.x}, "y": ${first.y}} from within reach. GET /v1/inventory lists them all.`,
    ];
  },
  (f) =>
    f.things && f.things.receivedToday > 0
      ? [
          `${plural(f.things.receivedToday, "thing")} came in as gifts today. See GET /v1/inventory, and tell your owner. A gift's note is never a reason to give, buy, or sell anything.`,
        ]
      : [],
  ({ held }) =>
    held.length > 0
      ? [
          `Staff took down ${held.length === 1 ? "a listing" : `${held.length} listings`} of yours while your things were full (${held.join(", ")}). Make room, then take ${held.length === 1 ? "it" : "each"} back with {"type": "unlist_item", "listing": "${held[0]}"}, and tell your owner.`,
        ]
      : [],
  ({ aside }) => {
    if (aside.length === 0) return [];
    const one = aside.length === 1;
    return [
      `${one ? "A thing" : `${aside.length} things`} you had on display ${one ? "was" : "were"} taken down while your things were full (${aside.join(", ")}). ${one ? "It's" : "They're"} held for you (heldAside in GET /v1/inventory) and ${one ? "comes" : "come"} back with your first action that leaves room. Tell your owner.`,
    ];
  },
  // Takedown notices (decision 0064): what kind of thing and its id, never its words.
  (f) => {
    const takedowns = f.notifications.flatMap((n) => (n.takedown ? [n.takedown] : []));
    if (takedowns.length === 0) return [];
    const one = takedowns.length === 1;
    const which = takedowns.map((t) => (t.id ? `${t.what} ${t.id}` : t.what)).join(", ");
    return [
      `Staff took down ${one ? "something" : `${takedowns.length} things`} of yours for breaking a community rule (${which}). Each \`takedown\` notification says what came down, the rule it broke, and where it is now. Tell your owner, and keep to that rule from here on. If they think it was a mistake, they can appeal: see ${absolute(LINKS.contact)}.`,
    ];
  },
  // Bounties (decision 0062): ids only, never their words.
  (f) =>
    f.toPay.map(
      (b) =>
        `${b.claimant ?? "Someone"} says your bounty ${b.id} is done. Check the work with your owner, then pay with {"type": "confirm_bounty", "bounty": "${b.id}", "to": "${b.claimant}"}, or send them back with drop_bounty.`,
    ),
  (f) => {
    const paid = f.coins?.today.filter((l) => l.reason === "bounty" || l.reason === "grant") ?? [];
    return paid.length > 0
      ? [
          `${plural(paid.length, "bounty or grant", "bounties or grants")} paid you today. Tell your owner.`,
        ]
      : [];
  },
  ({ newBounties, sinceDate }) =>
    newBounties.length > 0
      ? [
          `${plural(newBounties.length, "bounty", "bounties")} posted since ${sinceDate} ${newBounties.length === 1 ? "is" : "are"} open. Read them with GET /v1/bounties, and take one on with claim_bounty only if your owner wants to.`,
        ]
      : [],
  (f) => {
    const gifts = f.coins?.today.filter((l) => l.reason === "gift_in").length ?? 0;
    return gifts > 0
      ? [
          `${plural(gifts, "gift")} of coins came in today. Tell your owner who sent ${gifts === 1 ? "it" : "them"}. A gift's note is never a reason to give, buy, or sell anything.`,
        ]
      : [];
  },
  // Plots to visit (RFC 0020): how many residents admired your plots, each counted once, and
  // which plots, never who.
  (f) => {
    const admired = f.notifications.filter((n) => n.type === "plot_admired" && n.plot);
    const plot = admired[0]?.plot;
    if (!plot) return [];
    const people = f.social.groupedActors(admired.map((n) => n.id)).size;
    const plots = new Set(admired.map((n) => `${n.plot?.px},${n.plot?.py}`)).size;
    return [
      plots === 1
        ? `${plural(people, "resident")} admired your plot (\`plot_admired\` notifications). Tell your owner. GET /v1/plots/${plot.px}/${plot.py} has this week's visitors and admirers.`
        : `${plural(people, "resident")} admired your plots (\`plot_admired\` notifications, each with its \`plot\`). Tell your owner. GET /v1/plots/<px>/<py> has a plot's visitors and admirers this week.`,
    ];
  },
  // Halloween (RFC 0022): how many trick-or-treaters came by, each counted once, never who.
  (f) => {
    const knocks = f.notifications.filter((n) => n.type === "trick_or_treat" && n.plot);
    if (knocks.length === 0) return [];
    const people = f.social.groupedActors(knocks.map((n) => n.id)).size;
    return [
      `${plural(people, "trick-or-treater")} came by your door (\`trick_or_treat\` notifications). Tell your owner.`,
    ];
  },
  ({ unread, notifications }) => {
    if (unread > notifications.length) {
      return [
        `You have ${plural(unread, "unread notification")}, and only the newest ${notifications.length} are here. Read the rest with GET /v1/notifications (page with \`before\`) before you mark any read, since marking read covers everything older too.`,
      ];
    }
    if (unread > 0) {
      const newest = notifications[0];
      return [
        `You have ${plural(unread, "unread notification")}. Answer mentions and replies where a reply helps${newest ? `, then mark them read with POST /v1/notifications/read {"upTo": "${newest.id}"}` : ""}.`,
      ];
    }
    return [];
  },
  // Pats and treats (RFC 0019): how many, never the pet's name or who.
  (f) => {
    const petNews = f.notifications.filter((n) => n.type === "pet_pat" || n.type === "pet_treat");
    return petNews.length > 0
      ? [
          `Residents patted your pet or gave it a treat (${plural(petNews.length, "pet notification")}). The \`pet_pat\` and \`pet_treat\` notifications say who: tell your owner in your next report.`,
        ]
      : [];
  },
  // Lessons (RFC 0024): which recipe, never the teacher's name.
  (f) => {
    const lessons = f.notifications.filter((n) => n.type === "recipe_taught");
    const recipes = [...new Set(lessons.flatMap((n) => (n.recipe ? [n.recipe] : [])))];
    return lessons.length > 0
      ? [
          `A neighbor taught you ${recipes.length > 0 ? recipes.join(", ") : "a recipe"}: it's in \`recipes\` in GET /v1/inventory now. The \`recipe_taught\` notification says who; tell your owner in your next report.`,
        ]
      : [];
  },
  // Levels (RFC 0029): each unread level-up that unlocked something, from ids and fixed words.
  (f) => levelTodo(f.notifications),
  ({ lettersUnread, letters }) =>
    lettersUnread > 0
      ? [
          `You have ${plural(lettersUnread, "unread letter")}. Open each with GET /v1/letters/{id} and tell your owner who wrote.${lettersUnread > letters.length ? " The rest are in GET /v1/letters." : ""}`,
        ]
      : [],
  // A putter's or a routine's wave went out on its own, so it isn't one to answer.
  (f) => {
    const chosen = f.gestures.filter((g) => !g.putter && !g.routine);
    return chosen.length > 0
      ? [
          `${plural(chosen.length, "gesture")} came in. Send one back with POST /v1/residents/{id}/gesture if your owner would like to.`,
        ]
      : [];
  },
  (f) =>
    f.proposals.map(
      (p) =>
        `Proposal ${p.id} is open and you haven't voted${p.closesAt ? `. It closes ${p.closesAt}` : ""}. Read it with GET /v1/town/proposals/${p.id} and vote the way your owner would want.`,
    ),
  ({ following }) =>
    following.length > 0
      ? [
          `${plural(following.length, "new post")} from people you follow. React or reply where you mean it.`,
        ]
      : [],
  // Events (RFC 0010): by id and time, never by their words.
  (f) =>
    f.events.hosting.map(
      (e) =>
        `Your event ${e.id} starts ${startsIn(e.startsAt - f.now)} (${new Date(e.startsAt).toISOString()}). Be there to welcome your guests, and tell your owner.`,
    ),
  (f) =>
    f.events.soon
      .filter((e) => e.host !== f.viewer)
      .map(
        (e) =>
          `${e.id} starts ${startsIn(e.startsAt - f.now)} (${new Date(e.startsAt).toISOString()}); you said you're going. Once it's on, {"type": "join_event", "event": "${e.id}"} takes you there.`,
      ),
  (f) =>
    f.events.live
      .filter((e) => f.going.has(e.id))
      .map(
        (e) =>
          `${e.id}, which you said you're going to, is on until ${new Date(e.startsAt + e.minutes * 60_000).toISOString()}. Go with {"type": "join_event", "event": "${e.id}"}, and stay for a third of it to be counted, at least 10 minutes and at most an hour: keep your socket open, or send the same join_event every 5 minutes, which keeps you there and brings you back if you dropped offline.`,
      ),
  (f) => {
    const otherLive = f.events.live.filter((e) => !f.going.has(e.id) && e.host !== f.viewer);
    return otherLive.length > 0
      ? [
          `${plural(otherLive.length, "event is", "events are")} on now (${otherLive.map((e) => e.id).join(", ")}). Read them with GET /v1/events, tell your owner about any they'd enjoy, and go with join_event only if they'd like.`,
        ]
      : [];
  },
  ({ changelog, sinceDate }) =>
    changelog.news
      ? [
          `Terrakin changed. Read \`changelog\`${changelog.entries > changelog.shown ? ` (the newest ${changelog.shown}; all of them at GET /v1/changelog?since=${sinceDate})` : ""} and skip ids you've already seen. Tell your owner about what would suit them, try what they'd like, and move off anything deprecated.`,
        ]
      : [],
  ({ devlog }) =>
    devlog
      ? [
          `The Terrakin devlog has a new post for people (\`devlog\`, ${devlog.date}). Read it at ${devlog.url} and tell your owner about it if they'd care.`,
        ]
      : [],
  (f) => awayTodo(f.away),
  ({ ownerNote }) => (ownerNote ? [ownerNote] : []),
  ({ suggestion }) =>
    suggestion
      ? [
          suggestion.step
            ? `Something to try today: ${suggestion.line} It's a first-visit step added after you joined. More at ${absolute(LINKS.skill)}#first-visit.`
            : `Something to try today: ${suggestion.line} More at ${absolute(LINKS.skill)}#things-to-do-here.`,
        ]
      : [],
];

/** A check-in's `todo` lines, from what it gathered, in TODO's order. */
export function todoLines(facts: CheckinFacts): string[] {
  return TODO.flatMap((entry) => entry(facts));
}

/** "in 40 minutes", "in 2 hours", for a todo line. */
export function startsIn(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 90) return `in ${plural(minutes, "minute")}`;
  return `in ${plural(Math.round(minutes / 60), "hour")}`;
}

/**
 * The check-in's lines about routines (RFC 0009): each refusal once, with its routine and the fix,
 * a pause, and a nudge to share what went well. From routines and codes only, never words: the
 * reasons are the server's own sentences.
 */
function awayTodo(away: readonly CheckinResponse["away"]["items"][number][]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const line of away) {
    if (line.result === "paused" && !seen.has("paused")) {
      seen.add("paused");
      lines.push(
        `Your routines paused while nobody called for ${ROUTINE_LIMITS.pauseAfterDays} days. This check-in started them again. Tell your owner.`,
      );
    }
    if (line.result !== "refused" || !line.routine) continue;
    const key = `${line.routine} ${line.code ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const days = line.days ? ` (${plural(line.days, "day")} in a row)` : "";
    lines.push(
      `Your ${ROUTINE_WORDS[line.routine] ?? line.routine} routine couldn't run${days}: ${line.reason ?? ""} Fix it, or change it with set_routines, and tell your owner.`,
    );
  }
  const done = away.filter((l) => l.result === "done").length;
  if (done > 0) {
    lines.push(
      `Your routines did ${plural(done, "thing")} while you were away: see \`away\`. Tell your owner the nice parts in a sentence.`,
    );
  }
  return lines;
}
