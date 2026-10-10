import {
  COLLECTION_WORDS,
  type CollectedView,
  type CollectionGroup,
  type CollectionGroupId,
  type CollectionKind,
  type CollectionView,
  WEAR_GROUP,
} from "@terrakin/protocol";
import {
  CATALOG,
  CROP_INFO,
  FAMILIES,
  type Family,
  type FamilyInfo,
  FIND_SPAWNS,
  type FindSpawn,
  type FirstsCredit,
  familyPath,
  firstSkill,
  type Holiday,
  type Input,
  ITEM_INFO,
  type ItemKind,
  isEarnedWear,
  isExclusiveWear,
  isShopSku,
  isShownFind,
  isTownsfolk,
  kindsIn,
  residentById,
  type Season,
  sortWear,
  stockHoliday,
  WEAR_INFO,
  WEAR_ITEMS,
  type WorldEvent,
  type WorldState,
} from "@terrakin/sim";
import type { SqlExec } from "./sql-store";
import { utcDay } from "./together";

/**
 * The collection book (RFC 0021, decision 0100): for every resident, every kind of thing they have
 * ever held and every piece of wear they have worn or bought, with the UTC day they first did.
 *
 * It's a table here, not world state: no rule reads it, so it needs no switch and changes nothing
 * about how the log replays. It fills in as the world commits inputs (`noteCommitted`, from
 * `WorldService.onCommitted`): an `inventory` event that adds a stack or brings a made thing, and
 * wear in `joined`, `profile_changed`, and `wear_bought`. Before the book existed, `backfill` fills
 * it once from what the world holds. A row is written once, on the first day; later ones are
 * ignored, and a resident's rows are kept in memory once read, so a gain of something already
 * collected touches no table.
 */

export interface CollectionOptions {
  sql: SqlExec;
  now: () => number;
}

/** Which shelf a row is on: a kind from the catalog, or a piece of wear. */
type Shelf = "thing" | "wear";
const keyOf = (shelf: Shelf, kind: string) => `${shelf}:${kind}`;

/**
 * Every piece of wear the book counts, by slot: everything but partner wear, which few can wear,
 * and earned wear (RFC 0029), which takes a skill's level 5. Leaving both out keeps "Full
 * wardrobe" something the shop alone finishes.
 */
export const COLLECTIBLE_WEAR = sortWear(
  WEAR_ITEMS.filter((w) => !isExclusiveWear(w) && !isEarnedWear(w)),
);

/** The seasons a kind turns up in: a find's on the ground, or the shop's for seasonal stock. */
function seasonsOf(kind: ItemKind): readonly Season[] | undefined {
  const spawn = (FIND_SPAWNS as readonly FindSpawn[]).find((f) => f.kind === kind);
  return spawn ? spawn.seasons : CATALOG[kind].shop?.seasons;
}

/** The holiday the shop sells a kind or a piece of wear for, if it's holiday stock (RFC 0022). */
const holidayOf = (kind: string): Holiday | undefined =>
  isShopSku(kind) ? stockHoliday(kind) : undefined;

function entry(kind: string, name: string, first: number | undefined, seasons?: readonly Season[]) {
  const out: CollectionKind = { kind, name };
  if (first !== undefined) out.firstDay = first;
  if (seasons) out.seasons = [...seasons];
  const holiday = holidayOf(kind);
  if (holiday) out.holiday = holiday;
  return out;
}

function group(
  id: CollectionGroupId,
  name: string,
  path: string[],
  kinds: CollectionKind[],
): CollectionGroup {
  const count = kinds.filter((k) => k.firstDay !== undefined).length;
  const { hint, badge } = COLLECTION_WORDS[id];
  return {
    family: id,
    name,
    path,
    hint,
    count,
    total: kinds.length,
    ...(badge ? { badge } : {}),
    done: count === kinds.length,
    kinds,
  };
}

/**
 * A book from a resident's first days, by `thing:<kind>` and `wear:<item>`: each family that holds
 * kinds, in the catalog's order, then wear. Rows for kinds the catalog no longer has, or for
 * partner wear, show nowhere and count for nothing.
 */
function collectionView(resident: string, firsts: ReadonlyMap<string, number>): CollectionView {
  const groups: CollectionGroup[] = [];
  for (const [family, info] of Object.entries(FAMILIES) as [Family, FamilyInfo][]) {
    const kinds = kindsIn(family);
    if (kinds.length === 0) continue;
    groups.push(
      group(
        family,
        info.name,
        familyPath(family),
        kinds.map((kind) =>
          entry(kind, ITEM_INFO[kind].name, firsts.get(keyOf("thing", kind)), seasonsOf(kind)),
        ),
      ),
    );
  }
  groups.push(
    group(
      WEAR_GROUP,
      "Wear",
      [WEAR_GROUP],
      COLLECTIBLE_WEAR.map((item) =>
        entry(item, WEAR_INFO[item].label, firsts.get(keyOf("wear", item))),
      ),
    ),
  );
  return {
    resident,
    count: groups.reduce((n, g) => n + g.count, 0),
    total: groups.reduce((n, g) => n + g.total, 0),
    groups,
    badges: groups.flatMap((g) => (g.done && g.badge ? [g.badge] : [])),
  };
}

export class CollectionBook {
  /** Each resident's rows once read, by `thing:<kind>` and `wear:<item>`, to the first day. */
  private readonly known = new Map<string, Map<string, number>>();

  constructor(private readonly o: CollectionOptions) {
    for (const statement of [
      // One row per resident and kind or piece of wear, written once, on the first day.
      `CREATE TABLE IF NOT EXISTS collection (
        resident TEXT NOT NULL,
        shelf TEXT NOT NULL,
        kind TEXT NOT NULL,
        day INTEGER NOT NULL,
        PRIMARY KEY (resident, shelf, kind)
      )`,
      // The day the book was filled from the world as it was, once.
      "CREATE TABLE IF NOT EXISTS collection_backfill (day INTEGER NOT NULL)",
    ]) {
      o.sql.exec(statement);
    }
  }

  /** One resident's rows, read once and kept. */
  private firsts(resident: string): Map<string, number> {
    let mine = this.known.get(resident);
    if (!mine) {
      mine = new Map();
      for (const row of this.o.sql.exec(
        "SELECT shelf, kind, day FROM collection WHERE resident = ?",
        resident,
      )) {
        mine.set(keyOf(String(row.shelf) as Shelf, String(row.kind)), Number(row.day));
      }
      this.known.set(resident, mine);
    }
    return mine;
  }

  /** Add one to the book, unless it's there already. */
  private note(resident: string, shelf: Shelf, kind: string, day: number) {
    const mine = this.firsts(resident);
    const key = keyOf(shelf, kind);
    if (mine.has(key)) return;
    this.o.sql.exec(
      "INSERT OR IGNORE INTO collection (resident, shelf, kind, day) VALUES (?, ?, ?, ?)",
      resident,
      shelf,
      kind,
      day,
    );
    mine.set(key, day);
  }

  /** The world's day, or today by the clock in a world that doesn't count days. */
  private today(state: WorldState): number {
    return state.day ?? utcDay(this.o.now());
  }

  /**
   * After the world commits an input: every kind it brought anyone (grown, made, found, bought, or
   * given, alike), and every piece of wear someone put on or bought.
   */
  noteCommitted(state: WorldState, _input: Input, events: readonly WorldEvent[]): void {
    const day = this.today(state);
    for (const e of events) {
      if (e.type === "inventory") {
        for (const c of e.changes ?? []) {
          if (c.amount > 0) this.note(e.residentId, "thing", c.kind, day);
        }
        for (const g of e.gained ?? []) this.note(e.residentId, "thing", g.kind, day);
      } else if (e.type === "wear_bought") {
        this.note(e.residentId, "wear", e.wear, day);
      } else if (e.type === "profile_changed") {
        for (const w of e.wear ?? []) this.note(e.residentId, "wear", w, day);
      } else if (e.type === "joined") {
        for (const w of e.resident.wear ?? []) this.note(e.resident.id, "wear", w, day);
      }
    }
  }

  /**
   * Once, the first time the book meets a world: everything anyone holds now goes in, from their
   * things, what they have on display, held aside, or listed in the market, the seed of what they
   * planted, their shop wear, and the wear they have on. A made thing they made themselves counts
   * from the day they made it, a planted seed from the day it went in, and the rest from today.
   * Nothing happens when it has run before.
   */
  backfill(state: WorldState): void {
    if ([...this.o.sql.exec("SELECT day FROM collection_backfill LIMIT 1")].length > 0) return;
    const today = this.today(state);
    const earliest = new Map<
      string,
      { resident: string; shelf: Shelf; kind: string; day: number }
    >();
    const add = (resident: string, shelf: Shelf, kind: string, day = today) => {
      const key = `${resident}|${keyOf(shelf, kind)}`;
      const had = earliest.get(key);
      if (!had || day < had.day) {
        earliest.set(key, { resident, shelf, kind, day: Math.min(day, today) });
      }
    };
    const items = state.items;
    for (const [resident, inv] of Object.entries(items?.inventories ?? {})) {
      for (const kind of Object.keys(inv.stacks)) add(resident, "thing", kind);
      for (const g of inv.goods) {
        add(resident, "thing", g.kind, g.maker === resident ? g.madeDay : today);
      }
    }
    for (const shown of [...Object.values(items?.displays ?? {}), ...(items?.heldAside ?? [])]) {
      if (isShownFind(shown)) add(shown.by, "thing", shown.find);
      else {
        const g = shown.good;
        add(shown.by, "thing", g.kind, g.maker === shown.by ? g.madeDay : today);
      }
    }
    for (const listing of Object.values(state.market?.listings ?? {})) {
      add(listing.seller, "thing", listing.kind);
    }
    for (const planting of Object.values(items?.crops ?? {})) {
      add(planting.by, "thing", CROP_INFO[planting.crop].seed, planting.plantedDay);
    }
    for (const [resident, wear] of Object.entries(state.shop?.wardrobe ?? {})) {
      for (const w of wear) add(resident, "wear", w);
    }
    for (const r of Object.values(state.residents)) {
      for (const w of r.wear ?? []) add(r.id, "wear", w);
    }
    for (const { resident, shelf, kind, day } of earliest.values()) {
      this.o.sql.exec(
        "INSERT OR IGNORE INTO collection (resident, shelf, kind, day) VALUES (?, ?, ?, ?)",
        resident,
        shelf,
        kind,
        day,
      );
    }
    this.o.sql.exec("INSERT INTO collection_backfill (day) VALUES (?)", today);
    this.known.clear();
  }

  /** A resident's whole book. */
  view(resident: string): CollectionView {
    return collectionView(resident, this.firsts(resident));
  }

  /** How far along a resident's book is, for their profile. */
  collected(resident: string): CollectedView {
    const { count, total } = this.view(resident);
    return { count, total };
  }

  /** Whether a resident has ever had a kind of thing. */
  has(resident: string, kind: ItemKind): boolean {
    return this.firsts(resident).has(keyOf("thing", kind));
  }

  /**
   * The one-time credit `open_levels` carries (RFC 0029, section 12): for each resident in the
   * world who isn't townsfolk, the kinds in their book that a first counts (crops, made kinds,
   * finds, and fish, by the sim's `firstSkill`), sorted, residents in id order. The book doesn't
   * say how a kind came, so a gift counts too: generous, once. Residents with none are left out,
   * as the sim asks.
   */
  firstsCredit(state: WorldState): FirstsCredit[] {
    const byResident = new Map<string, string[]>();
    for (const row of this.o.sql.exec(
      "SELECT resident, kind FROM collection WHERE shelf = 'thing' ORDER BY resident, kind",
    )) {
      const resident = String(row.resident);
      const kind = String(row.kind);
      if (firstSkill(kind) === undefined) continue;
      if (!residentById(state, resident) || isTownsfolk(state, resident)) continue;
      byResident.set(resident, [...(byResident.get(resident) ?? []), kind]);
    }
    return [...byResident].map(([resident, kinds]) => ({ resident, kinds }));
  }
}
