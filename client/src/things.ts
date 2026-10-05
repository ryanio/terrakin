/**
 * Plain words for things you grow and make (RFC 0005). Pure, so tests pin them. The names come
 * from the sim's catalog; nothing here decides a rule.
 */
import type { WorldEvent } from "@terrakin/protocol";
import {
  CROP_INFO,
  type Crop,
  type GoodKind,
  ITEM_INFO,
  type ItemKind,
  RECIPES,
} from "@terrakin/sim";

/** "Lemon", "Bunch of herbs". */
export const thingName = (kind: ItemKind) => ITEM_INFO[kind].name;

/** "1 lemon", "3 lemons", "2 bunches of herbs". */
export function thingCount(kind: ItemKind, n: number): string {
  const info = ITEM_INFO[kind];
  return `${n} ${(n === 1 ? info.name : info.plural).toLowerCase()}`;
}

/** What a recipe uses, as one line: "3 lemons, 1 bag of sugar, 1 jar". */
export function needsLine(recipe: GoodKind): string {
  return Object.entries(RECIPES[recipe].needs)
    .map(([kind, n]) => thingCount(kind as ItemKind, n ?? 0))
    .join(", ");
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
    case "craft": {
      const made = e.gained?.[0];
      return made ? `You made ${thingName(made.kind).toLowerCase()}.` : null;
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
    default:
      return null;
  }
}

/** How far along a crop is, 0 to 1, for drawing it. */
export function growth(plantedDay: number, readyDay: number, today: number | undefined): number {
  if (today === undefined || readyDay <= plantedDay) return 0;
  return Math.max(0, Math.min(1, (today - plantedDay) / (readyDay - plantedDay)));
}
