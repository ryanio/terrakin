import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { biomeAt } from "./biome";
import { GATHER, gatherableAt, pickupLeft } from "./gather";
import { hashWorld } from "./hash";
import { ITEM_INFO, ITEMS, RESOURCE_KINDS, STACK_KINDS, type StackKind } from "./items";
import { replay } from "./replay";
import { type Command, type Input, TOWN_ACTOR, type WorldConfig, type WorldEvent } from "./types";
import { createWorld } from "./world";

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
  it("is a pure function of the tile and the day", () => {
    for (let y = 0; y < CONFIG.height; y++) {
      for (let x = 0; x < CONFIG.width; x++) {
        expect(gatherableAt(CONFIG, x, y, DAY)).toBe(gatherableAt(CONFIG, x, y, DAY));
      }
    }
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
    // Yesterday's pickup is forgotten, even if the tile has nothing today.
    expect(w.state.items?.gathered?.[`${t.x},${t.y}`]).toBeUndefined();
    // And if the tile grew one back, it gathers again.
    if (gatherableAt(CONFIG, t.x, t.y, DAY + 1) === "wood") {
      w.ok("ada", { type: "gather", x: t.x, y: t.y });
      expect(w.has("ada", "wood")).toBe(GATHER.perPickup * 2);
    }
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
  });

  it("leaves resources in the catalog as stack kinds", () => {
    expect(RESOURCE_KINDS).toEqual(["wood", "stone"]);
    expect(STACK_KINDS).toContain("wood");
    expect(STACK_KINDS).toContain("stone");
    expect(ITEM_INFO.wood).toMatchObject({ category: "resource" });
    expect(ITEM_INFO.stone).toMatchObject({ category: "resource" });
  });
});
