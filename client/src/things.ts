/**
 * Plain words for the world's HUD: things you grow and make (RFC 0005), your coins, and the
 * server's refusals. Pure, so tests pin them. The names come from the sim's catalog; nothing here
 * decides a rule.
 */
import type { WorldEvent } from "@terrakin/protocol";
import {
  CROP_INFO,
  type Crop,
  FURNITURE_RECIPES,
  type FurnitureKind,
  type GoodKind,
  ITEM_INFO,
  type ItemKind,
  isFurnitureKind,
  OTHERS_PLOT_GATHER,
  RECIPES,
} from "@terrakin/sim";
import { coins } from "./purse";

/** "Lemon", "Bunch of herbs". */
export const thingName = (kind: ItemKind) => ITEM_INFO[kind].name;

/** How many of a stack kind are in a list of stacks: 0 when it's absent. */
export const stackCount = (stacks: readonly { kind: string; count: number }[], kind: string) =>
  stacks.find((s) => s.kind === kind)?.count ?? 0;

/** "1 lemon", "3 lemons", "2 bunches of herbs". */
export function thingCount(kind: ItemKind, n: number): string {
  const info = ITEM_INFO[kind];
  return `${n} ${(n === 1 ? info.name : info.plural).toLowerCase()}`;
}

/** What a recipe uses, as one line: "3 lemons, 1 bag of sugar, 1 jar", or "3 wood" for a table. */
export function needsLine(recipe: GoodKind | FurnitureKind): string {
  const needs = isFurnitureKind(recipe) ? FURNITURE_RECIPES[recipe].needs : RECIPES[recipe].needs;
  return Object.entries(needs)
    .map(([kind, n]) => thingCount(kind as ItemKind, n ?? 0))
    .join(", ");
}

/** What you still lack for a recipe, or null when you hold enough: "Needs 1 more lemon". */
export function missingLine<K extends ItemKind>(
  needs: readonly { kind: K; count: number }[],
  held: (kind: K) => number,
): string | null {
  const short = needs
    .filter((n) => held(n.kind) < n.count)
    .map((n) => {
      const more = n.count - held(n.kind);
      const info = ITEM_INFO[n.kind];
      return `${more} more ${(more === 1 ? info.name : info.plural).toLowerCase()}`;
    });
  return short.length > 0 ? `Needs ${short.join(", ")}` : null;
}

/** The crop a seed kind grows, if it is one. */
export function cropOfSeed(kind: ItemKind): Crop | undefined {
  return (Object.keys(CROP_INFO) as Crop[]).find((c) => CROP_INFO[c].seed === kind);
}

/** How a crop is doing today: "Ready to pick", "Ready tomorrow", "Ready in 3 days". */
export function growthLine(readyDay: number, today: number | undefined): string {
  if (today === undefined) return "Growing";
  const left = readyDay - today;
  if (left <= 0) return "Ready to pick";
  if (left === 1) return "Ready tomorrow";
  return `Ready in ${left} days`;
}

type InventoryEvent = Extract<WorldEvent, { type: "inventory" }>;

/**
 * A short line for your own inventory event, for a toast in the world. Never a name, a note, or a
 * label: those are other residents' words.
 */
export function inventoryLine(e: InventoryEvent): string | null {
  const gained = (e.changes ?? []).filter((c) => c.amount > 0);
  const list = (cs: typeof gained) => cs.map((c) => thingCount(c.kind, c.amount)).join(", ");
  switch (e.reason) {
    case "starter":
      return "Your first pantry: seeds, sugar, and jars. Place a planter to start a garden.";
    case "pantry":
      return gained.length > 0 ? `From the pantry: ${list(gained)}.` : null;
    case "harvest":
      return `You picked ${list(gained)}.`;
    case "gather":
      return `You picked up ${list(gained)}.`;
    case "craft": {
      const made = e.gained?.[0];
      if (made?.kind === "piece") return "You made a piece of art.";
      if (made) return `You made ${thingName(made.kind).toLowerCase()}.`;
      // Furniture stacks: it arrives as a change, not a made thing.
      const piece = gained.find((c) => isFurnitureKind(c.kind));
      return piece
        ? `You made ${thingCount(piece.kind, piece.amount)}. Place it from Build, on the Furniture tab.`
        : null;
    }
    case "gift_in": {
      const goods = e.gained ?? [];
      const what =
        goods.length > 0
          ? goods.map((g) => thingName(g.kind).toLowerCase()).join(", ")
          : list(gained);
      return `A gift arrived: ${what}.`;
    }
    case "gift_out":
      return "Your gift is on its way.";
    case "declined":
      return "You sent the gift back.";
    case "displayed":
      return "It's on display for everyone who passes.";
    case "off_display":
      return "Taken down. It's back in your things.";
    case "returned": {
      const goods = e.gained ?? [];
      const what =
        goods.length > 0
          ? goods.map((g) => thingName(g.kind).toLowerCase()).join(", ")
          : list(gained);
      return `A gift came back to you: ${what}.`;
    }
    case "bought":
      return `From the town shop: ${list(gained)}.`;
    case "sold":
      return "Sold to the town.";
    case "taken_down":
      return "Staff took down something of yours from the market or a display. It's back in your things.";
    case "held":
      return "Something taken down while your things were full is back in your things.";
    default:
      return null;
  }
}

/** "Admired once", "Admired 4 times", or null for a thing nobody has admired yet. */
export function admiredLine(n: number | undefined): string | null {
  if (!n || n <= 0) return null;
  return n === 1 ? "Admired once" : `Admired ${n.toLocaleString("en-US")} times`;
}

/** How long a gift can still be sent back, in plain words. */
export function sendBackLine(lastDay: number, today: number): string {
  const left = lastDay - today;
  if (left <= 0) return "You can send it back until midnight UTC.";
  if (left === 1) return "You can send it back until tomorrow ends.";
  return `You can send it back for ${left} more days.`;
}

/** What to say when a planter is empty and you hold no seeds. */
export function noSeedsHint(inv: { hasHearth: boolean; pantryToday: boolean }): string {
  if (!inv.hasHearth) {
    return "You have no seeds. Set a hearth on your plot and come home to it: your first pantry brings some.";
  }
  // Only the first pantry ever brings seeds. After that they come from harvests and friends.
  if (inv.pantryToday) {
    return "You have no seeds. Every harvest gives some back, and a friend can give you some.";
  }
  return "You have no seeds. Come home to your hearth: your first pantry brings some, and every harvest gives some back.";
}

type CoinsEvent = Extract<WorldEvent, { type: "coins" }>;

/** A short line for your own coins event, for a toast in the world. Never a name or a note. */
export function coinsLine(e: CoinsEvent): string | null {
  const n = Math.abs(e.amount);
  switch (e.reason) {
    case "allowance":
      return e.amount > 0 ? `+${coins(n)} for coming home today.` : null;
    case "streak":
      return e.amount > 0 ? `+${coins(n)} for coming home days in a row.` : null;
    case "welcome":
      return e.amount > 0 ? `+${coins(n)} to welcome you to your first plot.` : null;
    case "appreciation":
      return `+${coins(n)} from neighbors who liked your posts.`;
    case "bounty":
      return e.amount > 0 ? `+${coins(n)} for a bounty you finished.` : null;
    case "grant":
      return e.amount > 0 ? `+${coins(n)} from a Town Hall grant.` : null;
    case "gift_in":
      return `A gift of ${coins(n)} arrived.`;
    case "gift_out":
      return `You gave ${coins(n)}.`;
    default:
      return null;
  }
}

/**
 * A toast line for one of your own events in the world: a plot claimed, a hearth set, coins, or
 * things. Null for everyone else's events and for ones that go without saying.
 */
export function newsLine(event: WorldEvent, me: string): string | null {
  switch (event.type) {
    case "plot_claimed":
      return event.ownerId === me ? "This plot is yours. Tap Build to start." : null;
    case "hearth_set":
      return event.residentId === me
        ? "Your hearth is set. Tap Home to come back here from anywhere."
        : null;
    case "coins":
      return event.residentId === me ? coinsLine(event) : null;
    case "inventory":
      return event.residentId === me ? inventoryLine(event) : null;
    case "gallery_set":
      if (event.by !== me) return null;
      return event.open
        ? "Your plot is a gallery now. See it on the Galleries page."
        : "Your plot isn't a gallery anymore.";
    case "admired":
      if (event.by === me) return "You admired it. Its maker will be glad.";
      return event.maker === me ? "Someone admired something you made." : null;
    default:
      return null;
  }
}

/** The line for having no plot, wherever the HUD needs it. */
export const NO_PLOT_LINE =
  "You don't have a plot yet. Walk out of the Commons onto an empty plot and tap Claim plot.";

/**
 * Why a pickup on someone else's plot isn't yours to take. `name` is the owner's, untrusted text:
 * it only ever reaches the page through `textContent`.
 */
export function othersPickupLine(name?: string): string {
  const whose = name ? `${name}'s plot` : "someone else's plot";
  return `That's ${whose}, so it's theirs to gather. Your own plot, the Commons, and open land are free.`;
}

/** The first sentence of a server message, without the hint for agents that follows it. */
const firstSentence = (message: string) => message.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? message;

/**
 * The server's refusal in HUD words. Its messages are written for agents ("Try settle at px 3,
 * py 3."), so codes with agent hints get our own line, and the rest keep the server's text.
 * `you` is what the mirror shows about you; it only picks the wording.
 */
export function worldProblem(
  code: string,
  message: string,
  you: { hasPlot?: boolean } = {},
): string {
  switch (code) {
    case "no_plot":
      return NO_PLOT_LINE;
    case "no_hearth":
      return you.hasPlot === false
        ? NO_PLOT_LINE
        : "You don't have a hearth yet. Tap Build, pick the hearth, and tap a tile on your plot.";
    case "plot_owned":
      return "Someone already lives on this plot. Walk to an empty one and tap Claim plot.";
    case "plot_is_commons":
      return "The Commons belongs to everyone. Walk out of it onto an empty plot to claim one.";
    case "plot_limit":
      return "You already have as many plots as you can own.";
    case "not_your_plot":
      // A gather on someone else's plot: the sim's message names them by id, so say it our way.
      if (message.includes(OTHERS_PLOT_GATHER)) return othersPickupLine();
      return you.hasPlot === false ? NO_PLOT_LINE : firstSentence(message);
    case "out_of_reach":
      return "That's too far away. Walk closer first.";
    case "nowhere_to_go":
      return "There's nowhere to walk from here. Tap Home, or remove a block next to you.";
    case "already_home":
      if (message.includes("Try home")) return "That's already your hearth. Tap Home to go there.";
      if (message.includes("starter home")) return "Your home is already built.";
      return message;
    case "own_plot":
      return "That's your own plot. Tap Home to go there.";
    case "already_there":
      return "You're already on that plot.";
    case "plot_unclaimed":
      return "Nobody lives on that plot yet.";
    case "not_ready":
      return "It isn't ready to pick yet.";
    case "no_planter":
      return "Seeds go in a planter. Tap Build and pick the planter to place one.";
    case "no_station":
      return `${firstSentence(message)} Tap Build to place one.`;
    default:
      return message;
  }
}

/** How long a HUD toast stays up: longer for longer lines, so they can be read. */
export function toastMs(text: string, source: "system" | "player" = "system"): number {
  const base = source === "player" ? 4000 : 2600;
  return Math.min(7000, Math.max(base, 2600 + 40 * text.length));
}
