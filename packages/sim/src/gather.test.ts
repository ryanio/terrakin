import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { biomeAt } from "./biome";
import { CATALOG, FIND_KINDS } from "./catalog";
import { FINDS_CONFIG, FINDS_HASH, FINDS_LOG } from "./fixtures/finds-log";
import { GATHER_ALL_CONFIG, GATHER_ALL_HASH, GATHER_ALL_LOG } from "./fixtures/gather-all-log";
import {
  FIND_SPAWNS,
  type FindSpawn,
  GATHER,
  gatherableAt,
  mayGatherOn,
  pickupLeft,
} from "./gather";
import { hashWorld } from "./hash";
import { ITEM_INFO, ITEMS, RESOURCE_KINDS, STACK_KINDS, type StackKind } from "./items";
import { replay } from "./replay";
import { dayOfDate, seasonOf } from "./season";
import { type Command, type Input, TOWN_ACTOR, type WorldConfig, type WorldEvent } from "./types";
import { createWorld, DEFAULT_CONFIG } from "./world";

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const DAY = 20_000;

/**
 * A world and its log. Every rejection checks that nothing changed, and every input checks that
 * no inventory holds more than the cap or a stack at zero.
 */
function world(config = CONFIG) {
  const state = createWorld(config);
  const log: Input[] = [];
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    else expect(hashWorld(state)).toBe(before);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const code = (actor: string, command: Command) => {
    const result = send(actor, command);
    return result.ok ? null : result.rejection.code;
  };
  const day = (d: number) => ok(TOWN_ACTOR, { type: "new_day", day: d });
  const open = () => ok(TOWN_ACTOR, { type: "open_items" });
  const join = (name: string) => ok(name, { type: "join", name, kind: "human" });
  const has = (id: string, kind: StackKind) => state.items?.inventories[id]?.stacks[kind] ?? 0;
  return { state, log, send, ok, code, day, open, join, has };
}

/** Walk Ada, one tile at a time, to the nearest tile with a `kind` pickup still lying there. */
function walkTo(w: ReturnType<typeof world>, kind: "wood" | "stone") {
  const me = () => {
    const r = w.state.residents.ada;
    expect(r, "ada joined").toBeDefined();
    return r as { x: number; y: number };
  };
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < CONFIG.height; y++) {
    for (let x = 0; x < CONFIG.width; x++) {
      if (pickupLeft(w.state, x, y) !== kind) continue;
      const d = Math.abs(x - me().x) + Math.abs(y - me().y);
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  expect(best, `a ${kind} tile`).not.toBeNull();
  const target = best as { x: number; y: number };
  while (me().x !== target.x) w.ok("ada", { type: "move", dir: me().x < target.x ? "e" : "w" });
  while (me().y !== target.y) w.ok("ada", { type: "move", dir: me().y < target.y ? "s" : "n" });
  return target;
}

describe("the spawn", () => {
  it("is pinned: logged gathers replay only while the spawn stays the same", () => {
    // Changing biomeAt, its regions, the hash, or GATHER's chances moves these, and a logged
    // `gather` on a tile that no longer spawns stops replaying. That change needs an RFC.
    const lying = (day: number) => {
      const out: string[] = [];
      for (let y = 0; y < CONFIG.height; y++) {
        for (let x = 0; x < CONFIG.width; x++) {
          const kind = gatherableAt(CONFIG, x, y, day);
          if (kind) out.push(`${x},${y}:${kind}`);
        }
      }
      return out;
    };
    expect(lying(DAY)).toEqual([
      "5,0:wood",
      "21,4:wood",
      "0,5:stone",
      "7,5:stone",
      "15,8:wood",
      "15,9:wood",
      "0,10:wood",
      "2,10:wood",
      "1,11:wood",
      "4,15:wood",
    ]);
    expect(lying(DAY + 1)).toEqual([
      "7,1:wood",
      "2,6:stone",
      "3,6:stone",
      "7,6:stone",
      "20,7:wood",
      "3,10:wood",
      "2,13:wood",
      "0,14:wood",
      "2,14:wood",
      "5,14:wood",
      "4,15:wood",
      "3,17:wood",
      "0,19:wood",
    ]);
  });

  it("only falls in forests and on stone ground", () => {
    for (let y = 0; y < CONFIG.height; y++) {
      for (let x = 0; x < CONFIG.width; x++) {
        const kind = gatherableAt(CONFIG, x, y, DAY);
        const biome = biomeAt(CONFIG, x, y);
        if (kind === "wood") expect(biome).toBe("forest");
        if (kind === "stone") expect(biome).toBe("stone");
        if (biome === "meadow" || biome === "sand") expect(kind).toBeNull();
      }
    }
  });

  it("drops about as many as the chances say", () => {
    let wood = 0;
    let stone = 0;
    for (let y = 0; y < CONFIG.height; y++) {
      for (let x = 0; x < CONFIG.width; x++) {
        const kind = gatherableAt(CONFIG, x, y, DAY);
        if (kind === "wood") wood++;
        if (kind === "stone") stone++;
      }
    }
    // 24x24 with 8% chances: expect roughly a dozen of each; the band is wide on purpose.
    expect(wood).toBeGreaterThan(0);
    expect(stone).toBeGreaterThan(0);
    expect(wood).toBeLessThan(60);
    expect(stone).toBeLessThan(60);
  });
});

describe("gather", () => {
  it("picks up a fallen branch into the inventory, with public and private events", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    const t = walkTo(w, "wood");
    const events = w.ok("ada", { type: "gather", x: t.x, y: t.y });
    expect(w.has("ada", "wood")).toBe(GATHER.perPickup);
    const gathered = events.find((e) => e.type === "gathered");
    expect(gathered).toMatchObject({ type: "gathered", x: t.x, y: t.y, kind: "wood", by: "ada" });
    const inv = events.find((e) => e.type === "inventory");
    expect(inv).toMatchObject({
      type: "inventory",
      residentId: "ada",
      reason: "gather",
      changes: [{ kind: "wood", amount: GATHER.perPickup, count: GATHER.perPickup }],
    });
  });

  it("picks up a loose stone too", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    const t = walkTo(w, "stone");
    w.ok("ada", { type: "gather", x: t.x, y: t.y });
    expect(w.has("ada", "stone")).toBe(GATHER.perPickup);
  });

  it("refuses before items open, before joining, out of bounds, and out of reach", () => {
    const w = world();
    w.day(DAY);
    w.join("ada");
    expect(w.code("ada", { type: "gather", x: 0, y: 0 })).toBe("items_closed");
    w.open();
    expect(w.code("zed", { type: "gather", x: 0, y: 0 })).toBe("not_joined");
    expect(w.code("ada", { type: "gather", x: -1, y: 0 })).toBe("out_of_bounds");
    expect(w.code("ada", { type: "gather", x: 23, y: 23 })).toBe("out_of_reach");
  });

  it("refuses where nothing lies", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    // Find a meadow or sand tile next to Ada: nothing ever grows there.
    const me = w.state.residents.ada;
    expect(me, "ada joined").toBeDefined();
    const at = me as { x: number; y: number };
    let bare: { x: number; y: number } | null = null;
    for (let y = 0; y < CONFIG.height && !bare; y++) {
      for (let x = 0; x < CONFIG.width && !bare; x++) {
        const biome = biomeAt(CONFIG, x, y);
        if (
          (biome === "meadow" || biome === "sand") &&
          Math.max(Math.abs(x - at.x), Math.abs(y - at.y)) <= CONFIG.reach
        ) {
          bare = { x, y };
        }
      }
    }
    expect(bare).not.toBeNull();
    const t = bare as { x: number; y: number };
    expect(w.code("ada", { type: "gather", x: t.x, y: t.y })).toBe("nothing_to_gather");
  });

  it("refuses the same tile twice in one day, and under a block", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    const t = walkTo(w, "wood");
    w.ok("ada", { type: "gather", x: t.x, y: t.y });
    expect(w.code("ada", { type: "gather", x: t.x, y: t.y })).toBe("nothing_to_gather");
    // A pickup under a block is gone too.
    const u = walkTo(w, "wood");
    expect(u.x !== t.x || u.y !== t.y).toBe(true);
    w.state.blocks[`${u.x},${u.y}`] = "stone";
    expect(w.code("ada", { type: "gather", x: u.x, y: u.y })).toBe("nothing_to_gather");
    expect(pickupLeft(w.state, u.x, u.y)).toBeNull();
  });

  it("grows back the next day, and forgets yesterday's pickups", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    const t = walkTo(w, "wood");
    w.ok("ada", { type: "gather", x: t.x, y: t.y });
    expect(Object.keys(w.state.items?.gathered ?? {}).length).toBe(1);
    w.day(DAY + 1);
    // Yesterday's pickup is forgotten, whether or not the tile has one today.
    expect(w.state.items?.gathered?.[`${t.x},${t.y}`]).toBeUndefined();
    // On the next day a branch falls there again, it gathers again.
    let again = DAY + 2;
    while (gatherableAt(CONFIG, t.x, t.y, again) !== "wood") again++;
    w.day(again);
    w.ok("ada", { type: "gather", x: t.x, y: t.y });
    expect(w.has("ada", "wood")).toBe(GATHER.perPickup * 2);
  });

  it("refuses when the inventory is full", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    const items = w.state.items;
    expect(items, "items open").toBeDefined();
    if (items) items.inventories.ada = { stacks: { sugar: ITEMS.inventoryMax }, goods: [] };
    const t = walkTo(w, "wood");
    expect(w.code("ada", { type: "gather", x: t.x, y: t.y })).toBe("inventory_full");
  });

  it("replays to the same hash", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    const t = walkTo(w, "wood");
    w.ok("ada", { type: "gather", x: t.x, y: t.y });
    w.day(DAY + 1);
    const hash = hashWorld(w.state);
    expect(hashWorld(replay(CONFIG, w.log))).toBe(hash);
    // Pinned, so a change to the spawn or to what a gather stores shows up here.
    expect(hash).toBe("565a8ad8");
  });

  it("leaves resources in the catalog as stack kinds", () => {
    expect(RESOURCE_KINDS).toEqual(["wood", "stone"]);
    expect(STACK_KINDS).toContain("wood");
    expect(STACK_KINDS).toContain("stone");
    expect(ITEM_INFO.wood).toMatchObject({ category: "resource" });
    expect(ITEM_INFO.stone).toMatchObject({ category: "resource" });
  });
});

/** Walk a resident, one tile at a time, until (x, y) is within reach. No blocks in these worlds. */
function walkNear(w: ReturnType<typeof world>, id: string, to: { x: number; y: number }) {
  const at = () => w.state.residents[id] as { x: number; y: number };
  const far = () => Math.max(Math.abs(at().x - to.x), Math.abs(at().y - to.y)) > CONFIG.reach;
  while (far() && Math.abs(at().x - to.x) > CONFIG.reach) {
    w.ok(id, { type: "move", dir: at().x < to.x ? "e" : "w" });
  }
  while (far()) w.ok(id, { type: "move", dir: at().y < to.y ? "s" : "n" });
}

describe("gathering on someone's plot", () => {
  // On DAY, plot (0, 0) has a branch at 5,0 and stones at 0,5 and 7,5; the Commons (1, 1) has a
  // branch at 15,8; plot (0, 1), left unclaimed, has a branch at 0,10. The spawn test pins them.
  const MINE = { x: 5, y: 0 };
  const COMMONS = { x: 15, y: 8 };
  const OPEN = { x: 0, y: 10 };

  /** Ada settles plot (0, 0) and shares it with Cy; Bob is a stranger to it. */
  function neighbors() {
    const w = world();
    w.day(DAY);
    w.open();
    for (const id of ["ada", "bob", "cy"]) w.join(id);
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    w.ok("ada", { type: "share_plot", with: "cy" });
    return w;
  }
  const gather = (t: { x: number; y: number }) => ({ type: "gather" as const, ...t });
  const switchOn = (w: ReturnType<typeof world>) =>
    expect(w.ok(TOWN_ACTOR, { type: "own_plot_pickups" })).toEqual([
      { type: "plot_pickups_owned" },
    ]);

  it("is open to anyone before the server logs own_plot_pickups, as logs from then replay", () => {
    const w = neighbors();
    walkNear(w, "bob", MINE);
    w.ok("bob", gather(MINE));
    expect(w.has("bob", "wood")).toBe(GATHER.perPickup);
  });

  it("after the switch, is for the plot's owner and co-owners only", () => {
    const w = neighbors();
    switchOn(w);
    walkNear(w, "bob", MINE);
    const refused = w.send("bob", gather(MINE));
    expect(refused).toMatchObject({ ok: false, rejection: { code: "not_your_plot" } });
    const message = refused.ok ? "" : refused.rejection.message;
    expect(message).toContain("That's ada's plot");
    expect(message).toContain("The Commons and unclaimed land are free to gather");
    // The next step names the nearest pickup Bob may take: here, unclaimed land.
    expect(message).toMatch(/The nearest one you may take is at x \d+, y \d+\./);
    expect(w.has("bob", "wood")).toBe(0);
    expect(pickupLeft(w.state, MINE.x, MINE.y)).toBe("wood");

    // The owner may, and so may a co-owner on another of the plot's tiles.
    walkNear(w, "ada", MINE);
    w.ok("ada", gather(MINE));
    expect(w.has("ada", "wood")).toBe(GATHER.perPickup);
    walkNear(w, "cy", { x: 7, y: 5 });
    w.ok("cy", gather({ x: 7, y: 5 }));
    expect(w.has("cy", "stone")).toBe(GATHER.perPickup);
  });

  it("after the switch, leaves the Commons and unclaimed land open to everyone", () => {
    const w = neighbors();
    switchOn(w);
    walkNear(w, "bob", COMMONS);
    w.ok("bob", gather(COMMONS));
    walkNear(w, "bob", OPEN);
    w.ok("bob", gather(OPEN));
    expect(w.has("bob", "wood")).toBe(GATHER.perPickup * 2);
  });

  it("follows the plot: a share opens it, an unshare or a release changes it back", () => {
    const w = neighbors();
    switchOn(w);
    walkNear(w, "bob", MINE);
    expect(w.code("bob", gather(MINE))).toBe("not_your_plot");
    w.ok("ada", { type: "share_plot", with: "bob" });
    w.ok("bob", gather(MINE));
    w.ok("ada", { type: "unshare_plot", with: "bob" });
    walkNear(w, "bob", { x: 0, y: 5 });
    expect(w.code("bob", gather({ x: 0, y: 5 }))).toBe("not_your_plot");
    // Released, the plot is unclaimed land again.
    w.ok("ada", { type: "release" });
    w.ok("bob", gather({ x: 0, y: 5 }));
  });

  it("answers nothing_to_gather first where nothing lies, mine or not", () => {
    const w = neighbors();
    switchOn(w);
    walkNear(w, "bob", MINE);
    // 6,0 is on Ada's plot, within reach, with nothing on it today.
    expect(gatherableAt(CONFIG, 6, 0, DAY)).toBeNull();
    expect(w.code("bob", gather({ x: 6, y: 0 }))).toBe("nothing_to_gather");
  });

  it("is a pure question clients can ask", () => {
    const plot = { ownerId: "ada", coOwners: ["cy"] };
    expect(mayGatherOn(plot, "bob", false)).toBe(true);
    expect(mayGatherOn(plot, "bob", true)).toBe(false);
    expect(mayGatherOn(plot, "ada", true)).toBe(true);
    expect(mayGatherOn(plot, "cy", true)).toBe(true);
    expect(mayGatherOn(undefined, "bob", true)).toBe(true);
  });

  it("is switched on only by the server, once, after items open", () => {
    const w = world();
    w.day(DAY);
    expect(w.code("ada", { type: "own_plot_pickups" })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "own_plot_pickups" })).toBe("items_closed");
    w.open();
    switchOn(w);
    expect(w.state.items?.plotPickupsOwned).toBe(true);
    expect(w.code(TOWN_ACTOR, { type: "own_plot_pickups" })).toBe("already_open");
  });

  it("replays a log with a stranger's gather before the switch, and refuses it after", () => {
    const w = neighbors();
    walkNear(w, "bob", MINE);
    w.ok("bob", gather(MINE));
    switchOn(w);
    walkNear(w, "bob", { x: 7, y: 5 });
    const before = hashWorld(w.state);
    expect(w.code("bob", gather({ x: 7, y: 5 }))).toBe("not_your_plot");
    expect(hashWorld(w.state)).toBe(before);
    w.day(DAY + 1);
    const hash = hashWorld(w.state);
    expect(hashWorld(replay(CONFIG, w.log))).toBe(hash);
    // Pinned, so a change to the rule or to where it starts shows up here.
    expect(hash).toBe("de0e7cd5");
  });
});

describe("gathering everything within reach (decision 0125)", () => {
  // On DAY, plot (0, 0) has a branch at 5,0 and stones at 0,5 and 7,5, and plot (0, 1) branches at
  // 0,10, 2,10, and 1,11. The spawn test pins them.

  /** Walk a resident onto (x, y), one tile at a time. No blocks in these worlds. */
  function stand(w: ReturnType<typeof world>, id: string, to: { x: number; y: number }) {
    const at = () => w.state.residents[id] as { x: number; y: number };
    while (at().x !== to.x) w.ok(id, { type: "move", dir: at().x < to.x ? "e" : "w" });
    while (at().y !== to.y) w.ok(id, { type: "move", dir: at().y < to.y ? "s" : "n" });
  }

  /** Ada settles plot (0, 0); Bob is a stranger to it. */
  function neighbors() {
    const w = world();
    w.day(DAY);
    w.open();
    for (const id of ["ada", "bob"]) w.join(id);
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    return w;
  }
  const ALL = { type: "gather" } as const;

  it("picks up everything within reach, north to south and west to east, as one total per kind", () => {
    const w = neighbors();
    // From (2, 8) the reach runs off the world's west edge, over a stone on Ada's plot and three
    // branches on the land south of it.
    stand(w, "bob", { x: 2, y: 8 });
    const events = w.ok("bob", ALL);
    expect(events).toEqual([
      { type: "gathered", x: 0, y: 5, kind: "stone", by: "bob" },
      { type: "gathered", x: 0, y: 10, kind: "wood", by: "bob" },
      { type: "gathered", x: 2, y: 10, kind: "wood", by: "bob" },
      { type: "gathered", x: 1, y: 11, kind: "wood", by: "bob" },
      {
        type: "inventory",
        residentId: "bob",
        reason: "gather",
        changes: [
          { kind: "stone", amount: 1, count: 1 },
          { kind: "wood", amount: 3, count: 3 },
        ],
      },
    ]);
    // Each tile is picked clean for the day, so nothing is left to gather here.
    for (const t of [
      { x: 0, y: 5 },
      { x: 0, y: 10 },
      { x: 2, y: 10 },
      { x: 1, y: 11 },
    ]) {
      expect(pickupLeft(w.state, t.x, t.y)).toBeNull();
    }
    expect(w.code("bob", ALL)).toBe("nothing_to_gather");
  });

  it("leaves what lies on someone else's plot once the server logs own_plot_pickups", () => {
    const w = neighbors();
    w.ok(TOWN_ACTOR, { type: "own_plot_pickups" });
    stand(w, "bob", { x: 2, y: 8 });
    expect(w.ok("bob", ALL).filter((e) => e.type === "gathered")).toEqual([
      { type: "gathered", x: 0, y: 10, kind: "wood", by: "bob" },
      { type: "gathered", x: 2, y: 10, kind: "wood", by: "bob" },
      { type: "gathered", x: 1, y: 11, kind: "wood", by: "bob" },
    ]);
    expect(w.has("bob", "stone")).toBe(0);
    expect(pickupLeft(w.state, 0, 5)).toBe("stone");
    // Ada's own stone is still hers to take.
    stand(w, "ada", { x: 3, y: 3 });
    expect(w.ok("ada", ALL).filter((e) => e.type === "gathered")).toEqual([
      { type: "gathered", x: 5, y: 0, kind: "wood", by: "ada" },
      { type: "gathered", x: 0, y: 5, kind: "stone", by: "ada" },
    ]);
  });

  it("takes what fits, in order, and refuses when there's no room at all", () => {
    const w = neighbors();
    stand(w, "bob", { x: 2, y: 8 });
    const items = w.state.items;
    if (!items) throw new Error("items open");
    items.inventories.bob = { stacks: { sugar: ITEMS.inventoryMax }, goods: [] };
    expect(w.code("bob", ALL)).toBe("inventory_full");
    items.inventories.bob = { stacks: { sugar: ITEMS.inventoryMax - 2 }, goods: [] };
    expect(w.ok("bob", ALL).filter((e) => e.type === "gathered")).toEqual([
      { type: "gathered", x: 0, y: 5, kind: "stone", by: "bob" },
      { type: "gathered", x: 0, y: 10, kind: "wood", by: "bob" },
    ]);
    expect(pickupLeft(w.state, 2, 10)).toBe("wood");
    expect(pickupLeft(w.state, 1, 11)).toBe("wood");
  });

  it("refuses with nothing for you within reach, and names the nearest one you may take", () => {
    const w = neighbors();
    w.ok(TOWN_ACTOR, { type: "own_plot_pickups" });
    // From (3, 3) only Ada's branch and stone are within reach; the nearest open one is at 0,10.
    stand(w, "bob", { x: 3, y: 3 });
    const theirs = w.send("bob", ALL);
    expect(theirs).toMatchObject({ ok: false, rejection: { code: "nothing_to_gather" } });
    expect(theirs.ok ? "" : theirs.rejection.message).toBe(
      'What lies within reach is on someone else\'s plot: only its owner and the people they share it with can gather there. The nearest one you may take is at x 0, y 10. Walk closer first: move s 4 times. Then send {"type": "gather"} again.',
    );
    // Out on the bare southeast, nothing lies within reach at all.
    stand(w, "bob", { x: 20, y: 20 });
    const bare = w.send("bob", ALL);
    expect(bare).toMatchObject({ ok: false, rejection: { code: "nothing_to_gather" } });
    expect(bare.ok ? "" : bare.rejection.message).toContain(
      "Nothing lies within reach today. The nearest one you may take is at x 15, y 9. Walk closer first: move w 2 times, then move n 8 times.",
    );
  });

  it("refuses a tile with only x or only y", () => {
    const w = neighbors();
    expect(w.code("bob", { type: "gather", x: 12 })).toBe("out_of_bounds");
    expect(w.code("bob", { type: "gather", y: 12 })).toBe("out_of_bounds");
  });

  it("replays a log that gathers everything within reach on both sides of own_plot_pickups to its pinned hash", () => {
    const state = replay(GATHER_ALL_CONFIG, GATHER_ALL_LOG);
    expect(hashWorld(state)).toBe(GATHER_ALL_HASH);
    // The chestnut Bob found on the open land after the switch, beside everything from before it.
    expect(state.items?.inventories.bob?.stacks).toMatchObject({ wood: 2, stone: 4, chestnut: 1 });
  });
});

describe("finds (RFC 0021)", () => {
  /** A week in each season of 2027, so every find's season comes up. */
  const WEEKS = [
    [2027, 1, 10],
    [2027, 4, 10],
    [2027, 7, 10],
    [2027, 10, 10],
  ].flatMap(([y, m, d]) => {
    const start = dayOfDate(y as number, m as number, d as number);
    return Array.from({ length: 7 }, (_, i) => start + i);
  });
  const inSeason = (f: FindSpawn, day: number) =>
    f.seasons === undefined || f.seasons.includes(seasonOf(day));

  it("each lie somewhere, once, and a family's finds share one ground", () => {
    const spawned = FIND_SPAWNS.map((f) => f.kind);
    expect([...spawned].sort()).toEqual([...FIND_KINDS].sort());
    const grounds = new Map<string, Set<string>>();
    for (const f of FIND_SPAWNS) {
      const family = CATALOG[f.kind].family;
      grounds.set(family, (grounds.get(family) ?? new Set()).add(f.biome));
    }
    for (const [family, biomes] of grounds) expect([...biomes], family).toHaveLength(1);
  });

  it("lie only where no branch or stone does, in their own biome and season", () => {
    // So turning finds on never moves a branch or a stone, and a client that hasn't heard of
    // the switch still draws every one of them right.
    for (const day of WEEKS) {
      for (let y = 0; y < CONFIG.height; y++) {
        for (let x = 0; x < CONFIG.width; x++) {
          const before = gatherableAt(CONFIG, x, y, day, false);
          const after = gatherableAt(CONFIG, x, y, day, true);
          if (before) {
            expect(after, `${x},${y} on ${day}`).toBe(before);
            continue;
          }
          if (!after) continue;
          const spawn = FIND_SPAWNS.find((f) => f.kind === after) as FindSpawn;
          expect(spawn.biome, `${after} at ${x},${y}`).toBe(biomeAt(CONFIG, x, y));
          expect(inSeason(spawn, day), `${after} on ${day}`).toBe(true);
        }
      }
    }
  });

  it("come about as often as their chances say, and are pinned", () => {
    // What a week a season holds on the real world's 72 by 72 tiles. Changing a find's chance,
    // order, biome, or season, or the roll, moves these counts, and logged gathers of finds stop
    // replaying: a change like that is a new table behind a new switch (decision 0099).
    const seen: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (const day of WEEKS) {
      for (let y = 0; y < DEFAULT_CONFIG.height; y++) {
        for (let x = 0; x < DEFAULT_CONFIG.width; x++) {
          if (gatherableAt(DEFAULT_CONFIG, x, y, day, false)) continue;
          const biome = biomeAt(DEFAULT_CONFIG, x, y);
          for (const f of FIND_SPAWNS) {
            if (f.biome === biome && inSeason(f, day)) {
              expected[f.kind] = (expected[f.kind] ?? 0) + f.chance;
            }
          }
          const kind = gatherableAt(DEFAULT_CONFIG, x, y, day, true);
          if (kind) seen[kind] = (seen[kind] ?? 0) + 1;
        }
      }
    }
    for (const f of FIND_SPAWNS) {
      const want = expected[f.kind] ?? 0;
      // Four standard deviations of a count this rare, and a little room for the smallest.
      expect(Math.abs((seen[f.kind] ?? 0) - want), f.kind).toBeLessThan(4 * Math.sqrt(want) + 3);
    }
    expect(seen).toEqual({
      acorn: 129,
      pinecone: 87,
      mushroom: 46,
      feather: 12,
      chestnut: 30,
      holly: 16,
      seashell: 137,
      driftwood: 66,
      sea_glass: 19,
      starfish: 18,
      crystal: 67,
      fossil: 33,
      geode: 11,
      four_leaf_clover: 14,
      maple_leaf: 27,
      cherry_blossom: 32,
    });
  });

  it("start with open_finds: a find's tile is bare before it and gathers after it", () => {
    // The finds log puts the switch on day 20023, with a fossil lying at (6, 6) from then on.
    const at = FINDS_LOG.findIndex((i) => i.command.type === "open_finds");
    const state = replay(FINDS_CONFIG, FINDS_LOG.slice(0, at));
    const gather: Input = { actor: "ada", command: { type: "gather", x: 6, y: 6 } };
    const before = hashWorld(state);
    expect(apply(state, gather)).toMatchObject({
      ok: false,
      rejection: { code: "nothing_to_gather" },
    });
    expect(hashWorld(state)).toBe(before);
    expect(apply(state, FINDS_LOG[at] as Input)).toMatchObject({
      ok: true,
      events: [{ type: "finds_opened" }],
    });
    expect(apply(state, gather)).toMatchObject({
      ok: true,
      events: [{ type: "gathered", x: 6, y: 6, kind: "fossil", by: "ada" }, { type: "inventory" }],
    });
  });

  it("replay a log that gathers, shows, gives, and sells them to its pinned hash", () => {
    expect(hashWorld(replay(FINDS_CONFIG, FINDS_LOG))).toBe(FINDS_HASH);
  });

  it("are switched on only by the server, once, after items open", () => {
    const w = world();
    w.day(DAY);
    expect(w.code("ada", { type: "open_finds" })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "open_finds" })).toBe("items_closed");
    w.open();
    expect(w.ok(TOWN_ACTOR, { type: "open_finds" })).toEqual([{ type: "finds_opened" }]);
    expect(w.state.items?.findsOpen).toBe(true);
    expect(w.code(TOWN_ACTOR, { type: "open_finds" })).toBe("already_open");
  });
});
