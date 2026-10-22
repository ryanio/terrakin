import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { pickupLeft } from "./gather";
import { hashWorld } from "./hash";
import { isCrop } from "./items";
import { dayOfDate } from "./season";
import { townBuys } from "./shop";
import { fund, stock } from "./test-support";
import { type Command, type Tile, TOWN_ACTOR, type WorldConfig, type WorldState } from "./types";
import { route, worldGround } from "./walk";
import { chebyshev, createWorld, isSolid } from "./world";

/**
 * Every refusal for something out of reach names a walk, and an agent follows it word for word:
 * each `move` it names, then the same call again. This reads the real refusal, sends every move
 * it names (each must be accepted), and sends the call again, which must work. A straight line
 * from where you stand points through whatever is between, so a refusal that names one fails
 * here as soon as a wall is in the way.
 */

// 3x3 plots of 8 tiles. Ada's plot is (0, 0); the starter hut's walls run around (1, 1) to (5, 5),
// with the doorway at (3, 5). The Commons is plot (1, 1), with the shop on it.
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
// West of the hut, with the hut between Ada and the tile she works on, east of it.
const START: Tile = { x: 0, y: 3 };
const THERE: Tile = { x: 7, y: 3 };
// Within reach of THERE, for setting a case up.
const BESIDE: Tile = { x: 6, y: 3 };
// New Year's Eve, so fireworks go up too.
const DAY = dayOfDate(2026, 12, 31);
// A crop the town buys that day, which stacks, unlike a made good.
const CROP_SOLD = townBuys(DAY).find(isCrop) as string;

function world() {
  const state = createWorld(CONFIG);
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    return result;
  };
  const ok = (command: Command) => {
    const result = send("ada", command);
    expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
  };
  for (const command of [
    { type: "new_day", day: DAY },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
    { type: "shop_in_person" },
  ] as const) {
    expect(send(TOWN_ACTOR, command).ok).toBe(true);
  }
  ok({ type: "join", name: "ada", kind: "agent" });
  ok({ type: "settle", px: 0, py: 0 });
  ok({ type: "build_starter_home" });
  fund(state, "ada", 500);
  /** Walk Ada to `to` over the sim's own route, a step at a time. */
  const goTo = (to: Tile) => {
    const ada = state.residents.ada as Tile;
    for (const dir of route(worldGround(state), ada, to)) ok({ type: "move", dir });
    expect({ x: ada.x, y: ada.y }).toEqual(to);
  };
  /** Put blocks and ground on Ada's plot from anywhere, at plot tiles, which on plot (0, 0) are world tiles. */
  const build = (plan: Partial<Extract<Command, { type: "build" }>>) =>
    ok({ type: "build", px: 0, py: 0, ...plan });
  const goods = () => state.items?.inventories.ada?.goods ?? [];
  /** A pedestal on THERE, and a jar of lemonade made beside it, with Ada left BESIDE it. */
  const lemonade = () => {
    const kitchen = { x: THERE.x, y: THERE.y + 3 };
    build({
      blocks: [
        { ...THERE, block: "pedestal" },
        { ...kitchen, block: "kitchen" },
      ],
    });
    stock(state, "ada", { lemon: 2, sugar: 1, jar: 1 });
    goTo(BESIDE);
    ok({ type: "craft", recipe: "lemonade", ...kitchen });
  };
  return { state, send, ok, goTo, build, goods, lemonade };
}

type World = ReturnType<typeof world>;

/** A tile with a branch, a stone, or a find lying on it today, out of reach from START. */
function pickupTile(state: WorldState): Tile {
  for (let y = 0; y < CONFIG.height; y++) {
    for (let x = 0; x < CONFIG.width; x++) {
      if (chebyshev(START, { x, y }) <= CONFIG.reach + 2 || isSolid(state, x, y)) continue;
      if (pickupLeft(state, x, y)) return { x, y };
    }
  }
  throw new Error("nothing lies anywhere today");
}

const CASES: { name: string; setUp?: (w: World) => void; command: (w: World) => Command }[] = [
  { name: "place", command: () => ({ type: "place", ...THERE, block: "wood" }) },
  {
    name: "remove",
    setUp: (w) => w.build({ blocks: [{ ...THERE, block: "wood" }] }),
    command: () => ({ type: "remove", ...THERE }),
  },
  { name: "lay", command: () => ({ type: "lay", ...THERE, ground: "dirt" }) },
  {
    name: "lift",
    setUp: (w) => w.build({ ground: [{ ...THERE, ground: "dirt" }] }),
    command: () => ({ type: "lift", ...THERE }),
  },
  { name: "set_hearth", command: () => ({ type: "set_hearth", ...THERE }) },
  {
    name: "plant",
    setUp: (w) => {
      w.build({ blocks: [{ ...THERE, block: "planter" }] });
      stock(w.state, "ada", { flower_seed: 1 });
    },
    command: () => ({ type: "plant", ...THERE, seed: "flower" }),
  },
  {
    name: "harvest",
    setUp: (w) => {
      w.build({ blocks: [{ ...THERE, block: "planter" }] });
      stock(w.state, "ada", { flower_seed: 1 });
      w.goTo(BESIDE);
      w.ok({ type: "plant", ...THERE, seed: "flower" });
      expect(w.send(TOWN_ACTOR, { type: "new_day", day: DAY + 3 }).ok).toBe(true);
    },
    command: () => ({ type: "harvest", ...THERE }),
  },
  {
    name: "craft",
    setUp: (w) => {
      w.build({ blocks: [{ ...THERE, block: "kitchen" }] });
      stock(w.state, "ada", { lemon: 2, sugar: 1, jar: 1 });
    },
    command: () => ({ type: "craft", recipe: "lemonade", ...THERE }),
  },
  {
    name: "display",
    setUp: (w) => {
      w.lemonade();
    },
    command: (w) => ({ type: "display", item: w.goods()[0]?.id ?? "", ...THERE }),
  },
  {
    name: "take_down",
    setUp: (w) => {
      w.lemonade();
      w.ok({ type: "display", item: w.goods()[0]?.id ?? "", ...THERE });
    },
    command: () => ({ type: "take_down", ...THERE }),
  },
  { name: "gather a tile", command: (w) => ({ type: "gather", ...pickupTile(w.state) }) },
  {
    name: "set_off_firework",
    setUp: (w) => stock(w.state, "ada", { firework: 1 }),
    command: () => ({ type: "set_off_firework", ...THERE, color: "gold" }),
  },
  { name: "shop_buy", command: () => ({ type: "shop_buy", sku: "lantern" }) },
  {
    name: "sell_to_town",
    setUp: (w) => stock(w.state, "ada", { [CROP_SOLD]: 1 }),
    command: () => ({ type: "sell_to_town", item: CROP_SOLD }),
  },
];

describe("an out_of_reach refusal", () => {
  it.each(CASES)("names a walk that makes $name work once it's walked", (c) => {
    const w = world();
    c.setUp?.(w);
    w.goTo(START);
    const command = c.command(w);
    const refused = w.send("ada", command);
    expect(refused.ok ? null : refused.rejection.code, JSON.stringify(refused)).toBe(
      "out_of_reach",
    );
    const said = refused.ok ? "" : refused.rejection.message;
    const legs = [...said.matchAll(/move (\w+) (?:(\d+) times|once)/g)];
    expect(legs.length, `no walk in: ${said}`).toBeGreaterThan(0);
    for (const [, dir, n] of legs) {
      for (let i = 0; i < Number(n ?? 1); i++) {
        const step = w.send("ada", { type: "move", dir } as Command);
        expect(step.ok, `move ${dir} in "${said}": ${JSON.stringify(step)}`).toBe(true);
      }
    }
    const again = w.send("ada", command);
    expect(again.ok, `after "${said}": ${JSON.stringify(again)}`).toBe(true);
  });
});
