import {
  type AuthorView,
  type GardenView,
  type GoodView,
  type InventoryResponse,
  ITEM_CATALOG,
  ITEM_RULES,
  type KilnView,
} from "@terrakin/protocol";
import {
  canBuildOn,
  FINE_RECIPES,
  fineFindOf,
  firingsOf,
  type Good,
  heldAsideOf,
  inventoryMaxOf,
  inventoryOf,
  isReady,
  knownRecipes,
  lastDeclineDay,
  openDayOf,
  pantryNumbers,
  parseKey,
  picksLeft,
  pickupsFor,
  plotAtTile,
  presentsFor,
  TOWN_ACTOR,
  type WorldState,
} from "@terrakin/sim";

/**
 * Growing, making, and giving (RFC 0005) as the API shows them. The sim keeps the inventories;
 * this adds names. An inventory is private to its owner, like a purse.
 */

type Authors = (id: string) => AuthorView | undefined;

/** Crops on plots `viewer` can build on (theirs, or shared with them), soonest ready first. */
export function gardenOf(state: WorldState, viewer: string): GardenView[] {
  const crops = state.items?.crops ?? {};
  const out: GardenView[] = [];
  for (const [key, c] of Object.entries(crops)) {
    const [x, y] = parseKey(key);
    if (!canBuildOn(plotAtTile(state, x, y), viewer)) continue;
    out.push({
      x,
      y,
      crop: c.crop,
      plantedDay: c.plantedDay,
      readyDay: c.readyDay,
      ready: isReady(c.readyDay, state.day),
    });
  }
  return out.sort((a, b) => a.readyDay - b.readyDay || a.y - b.y || a.x - b.x);
}

/**
 * Kilns firing a pot on plots `viewer` can build on (RFC 0047), north to south. What's in one is
 * shown only to whoever loaded it.
 */
function kilnsOf(state: WorldState, viewer: string): KilnView[] {
  return firingsOf(state)
    .filter((k) => canBuildOn(plotAtTile(state, k.x, k.y), viewer))
    .map(({ x, y, firing, ready }) => {
      const yours = firing.by === viewer;
      const { kind, glaze, label } = firing.good;
      const pot =
        yours && glaze
          ? {
              kind,
              glaze,
              ...(label === undefined ? {} : { label }),
              trust: "untrusted" as const,
            }
          : null;
      return { x, y, readyDay: firing.readyDay, ready, yours, ...(pot ? { pot } : {}) };
    });
}

/** A made thing as the API shows it, with its maker's name. Its label is untrusted text. */
export function goodView(g: Good, author: Authors): GoodView {
  const maker = author(g.maker);
  return {
    id: g.id,
    kind: g.kind,
    ...(maker ? { maker } : {}),
    makerId: g.maker,
    madeDay: g.madeDay,
    ...(g.label === undefined ? {} : { label: g.label }),
    ...(g.media === undefined ? {} : { media: g.media }),
    ...(g.model ? { model: true as const } : {}),
    ...(g.admired ? { admired: g.admired } : {}),
    ...(g.glaze === undefined ? {} : { glaze: g.glaze }),
    ...(g.finish === undefined ? {} : { finish: g.finish }),
    ...(g.flower === undefined ? {} : { flower: g.flower }),
    ...(g.tea
      ? { tea: { event: g.tea.event, startsAt: new Date(g.tea.startsAt).toISOString() } }
      : {}),
    trust: "untrusted",
  };
}

/** `GET /v1/inventory`: the viewer's own things, their garden, the rules, and the catalog. */
export function inventoryView(
  state: WorldState,
  viewer: string,
  author: Authors,
): InventoryResponse {
  const read = inventoryOf(state, viewer);
  const held = heldAsideOf(state, viewer).map((d) => goodView(d.good, author));
  const kilns = kilnsOf(state, viewer);
  // The pantry gives less once the town shop sells sugar and jars, and the bag holds more once
  // `raise_inventory` is logged.
  const { pantry, stapleMax } = pantryNumbers(state);
  const rules = {
    ...ITEM_RULES,
    inventoryMax: inventoryMaxOf(state),
    pantrySugar: pantry.sugar,
    pantryJars: pantry.jar,
    stapleMax,
  };
  const base = { rules, catalog: ITEM_CATALOG };
  if (!read) return { inventory: null, ...base };
  return {
    inventory: {
      day: state.day ?? 0,
      stacks: read.stacks,
      goods: read.goods.map((g) => goodView(g, author)),
      size: read.size,
      pantryToday: read.pantryToday,
      hasHearth: state.residents[viewer]?.hearth != null,
      givenToday: read.givenToday,
      receivedToday: read.receivedToday,
      craftedToday: read.craftedToday,
      castToday: read.castToday,
      recipes: knownRecipes(state, viewer),
      recipePicks: picksLeft(state, viewer),
      garden: gardenOf(state, viewer),
      gifts: read.gifts.map((g) => {
        const from = author(g.from);
        return {
          id: g.id,
          ...(from ? { from } : {}),
          fromId: g.from,
          kind: g.kind,
          count: g.count,
          ...(g.grade ? { grade: g.grade } : {}),
          ...(g.goods ? { goods: g.goods } : {}),
          day: g.day,
          lastDay: lastDeclineDay(g.day),
        };
      }),
      ...(held.length > 0 ? { heldAside: held } : {}),
      ...presentsField(state, viewer, author),
      ...(kilns.length > 0 ? { kilns } : {}),
      ...fineFindsField(state, viewer),
    },
    ...base,
  };
}

/**
 * Each fine recipe's find and how many lie today where the viewer may pick them up (issue #138),
 * so a day of fine crafts is planned from one read. Absent until grades open.
 */
function fineFindsField(state: WorldState, viewer: string) {
  if (!state.items?.gradesOpen) return {};
  const lying = pickupsFor(state, viewer);
  const fineFinds = (Object.keys(FINE_RECIPES) as (keyof typeof FINE_RECIPES)[]).flatMap(
    (makes) => {
      const find = fineFindOf(makes);
      return find ? [{ makes, find, lying: lying[find as keyof typeof lying] ?? 0 }] : [];
    },
  );
  return { fineFinds };
}

/** A resident's presents waiting to be opened (RFC 0034), who from but never what, oldest first. */
function presentsField(state: WorldState, viewer: string, author: Authors) {
  const mine = presentsFor(state, viewer);
  if (mine.length === 0) return {};
  return {
    presents: mine.map((p) => {
      const from = p.from === TOWN_ACTOR ? undefined : author(p.from);
      return {
        id: p.id,
        ...(from ? { from } : {}),
        fromId: p.from,
        day: p.day,
        opensDay: openDayOf(p.day),
      };
    }),
  };
}
