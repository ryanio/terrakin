import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { displayAt } from "./display";
import { hashWorld } from "./hash";
import { ITEMS, inventorySize } from "./items";
import { replay } from "./replay";
import { stock } from "./test-support";
import { type Command, type Input, TOWN_ACTOR, type WorldConfig, type WorldEvent } from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles; the Commons is plot (1, 1). Settling plot (0, 0) and building the starter
// home leaves you on the hearth at (3, 3), inside a hut from (1, 1) to (5, 5).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const DAY = 20_000;
const ART = "m_0123456789abcdef";

/** A world where every rejection leaves state as it was, and no inventory passes the cap. */
function world() {
  const state = createWorld(CONFIG);
  const log: Input[] = [];
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    else expect(hashWorld(state)).toBe(before);
    for (const inv of Object.values(state.items?.inventories ?? {})) {
      expect(inventorySize(inv)).toBeLessThanOrEqual(ITEMS.inventoryMax);
    }
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
  const settle = (name: string, px: number, py: number) => {
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py });
    ok(name, { type: "build_starter_home" });
  };
  const goods = (id: string) => state.items?.inventories[id]?.goods ?? [];
  return { state, log, ok, code, settle, goods };
}

/** Ada on plot (0, 0) with a pedestal at (2, 2) and a frame at (4, 2). */
function gallery() {
  const w = world();
  w.ok(TOWN_ACTOR, { type: "new_day", day: DAY });
  w.ok(TOWN_ACTOR, { type: "open_items" });
  w.settle("ada", 0, 0);
  w.ok("ada", { type: "place", x: 2, y: 2, block: "pedestal" });
  stock(w.state, "ada", { frame: 1 });
  w.ok("ada", { type: "place", x: 4, y: 2, block: "frame" });
  return w;
}

describe("make_piece", () => {
  it("makes a signed piece from an upload, counted as made today", () => {
    const w = gallery();
    const events = w.ok("ada", { type: "make_piece", media: ART, title: "Morning" });
    const piece = {
      id: "i_1",
      kind: "piece",
      maker: "ada",
      madeDay: DAY,
      label: "Morning",
      media: ART,
    };
    expect(events).toEqual([
      { type: "inventory", residentId: "ada", reason: "craft", gained: [piece] },
    ]);
    expect(w.goods("ada")).toEqual([piece]);
    expect(w.state.items?.today.crafted.ada).toBe(1);
    w.ok("ada", { type: "make_piece", media: ART, title: "Model", model: true });
    expect(w.goods("ada")[1]).toMatchObject({ kind: "piece", model: true });
  });

  it("refuses a bad upload id, a missing or long title, and past the daily limit", () => {
    const w = gallery();
    expect(w.code("ada", { type: "make_piece", media: "nope", title: "A" })).toBe("invalid_piece");
    expect(w.code("ada", { type: "make_piece", media: ART, title: "" })).toBe("invalid_piece");
    const long = "x".repeat(ITEMS.labelMax + 1);
    expect(w.code("ada", { type: "make_piece", media: ART, title: long })).toBe("invalid_piece");
    const items = w.state.items;
    if (!items) throw new Error("items");
    items.today.crafted.ada = ITEMS.craftPerDay;
    expect(w.code("ada", { type: "make_piece", media: ART, title: "A" })).toBe("craft_limit");
    items.today.crafted.ada = 0;
    const room = ITEMS.inventoryMax - inventorySize(items.inventories.ada);
    stock(w.state, "ada", { tomato: room });
    expect(w.code("ada", { type: "make_piece", media: ART, title: "A" })).toBe("inventory_full");
  });

  it("waits for items to open", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "new_day", day: DAY });
    w.ok("ada", { type: "join", name: "ada", kind: "human" });
    expect(w.code("ada", { type: "make_piece", media: ART, title: "A" })).toBe("items_closed");
  });
});

describe("display and take_down", () => {
  it("puts a made thing on a pedestal for everyone to see, and back again", () => {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "Morning" });
    const [piece] = w.goods("ada");
    const shown = w.ok("ada", { type: "display", item: "i_1", x: 4, y: 2 });
    expect(shown).toEqual([
      { type: "inventory", residentId: "ada", reason: "displayed", lost: ["i_1"] },
      { type: "displayed", x: 4, y: 2, good: piece, by: "ada" },
    ]);
    expect(w.goods("ada")).toEqual([]);
    expect(displayAt(w.state, 4, 2)).toEqual({ good: piece, by: "ada", day: DAY });
    // The frame can't come up while something hangs on it.
    expect(w.code("ada", { type: "remove", x: 4, y: 2 })).toBe("tile_occupied");
    const down = w.ok("ada", { type: "take_down", x: 4, y: 2 });
    expect(down).toEqual([
      { type: "taken_down", x: 4, y: 2, by: "ada" },
      { type: "inventory", residentId: "ada", reason: "off_display", gained: [piece] },
    ]);
    expect(w.goods("ada")).toEqual([piece]);
    expect(w.state.items?.displays).toEqual({});
    w.ok("ada", { type: "remove", x: 4, y: 2 });
  });

  it("refuses a tile with no pedestal, a full one, someone else's plot, out of reach, and things you lack", () => {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "A" });
    w.ok("ada", { type: "make_piece", media: ART, title: "B" });
    expect(w.code("ada", { type: "display", item: "i_1", x: 3, y: 2 })).toBe("no_display");
    w.ok("ada", { type: "display", item: "i_1", x: 2, y: 2 });
    expect(w.code("ada", { type: "display", item: "i_2", x: 2, y: 2 })).toBe("tile_occupied");
    expect(w.code("ada", { type: "display", item: "i_1", x: 4, y: 2 })).toBe("not_enough_items");
    expect(w.code("ada", { type: "display", item: "lemon", x: 4, y: 2 })).toBe("unknown_item");
    expect(w.code("ada", { type: "display", item: "i_2", x: 10, y: 2 })).toBe("out_of_reach");
    w.settle("bob", 2, 0);
    expect(w.code("ada", { type: "take_down", x: 3, y: 3 })).toBe("nothing_displayed");
    // Bob can't display on Ada's plot, or take down her things there.
    w.ok("bob", { type: "make_piece", media: ART, title: "Bob's" });
    const bobs = w.goods("bob")[0]?.id ?? "";
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("bob");
    bob.x = 4;
    bob.y = 3;
    expect(w.code("bob", { type: "take_down", x: 2, y: 2 })).toBe("not_your_plot");
    expect(w.code("bob", { type: "display", item: bobs, x: 4, y: 2 })).toBe("not_your_plot");
  });

  it("lets a co-owner take a thing down, and it goes back to whoever put it up", () => {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "A" });
    w.ok("ada", { type: "display", item: "i_1", x: 2, y: 2 });
    w.settle("bob", 2, 0);
    w.ok("ada", { type: "share_plot", with: "bob" });
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("bob");
    bob.x = 3;
    bob.y = 2;
    const events = w.ok("bob", { type: "take_down", x: 2, y: 2 });
    expect(events[1]).toMatchObject({ residentId: "ada", reason: "off_display" });
    expect(w.goods("ada").map((g) => g.id)).toEqual(["i_1"]);
    expect(w.goods("bob")).toEqual([]);
  });

  it("waits for room in the things of whoever put it up", () => {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "A" });
    w.ok("ada", { type: "display", item: "i_1", x: 2, y: 2 });
    const room = ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.ada);
    stock(w.state, "ada", { tomato: room });
    expect(w.code("ada", { type: "take_down", x: 2, y: 2 })).toBe("inventory_full");
  });

  it("replays to the same world", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "new_day", day: DAY });
    w.ok(TOWN_ACTOR, { type: "open_items" });
    w.settle("ada", 0, 0);
    w.ok("ada", { type: "place", x: 2, y: 2, block: "pedestal" });
    w.ok("ada", { type: "make_piece", media: ART, title: "A" });
    w.ok("ada", { type: "make_piece", media: ART, title: "B", model: true });
    w.ok("ada", { type: "display", item: "i_2", x: 2, y: 2 });
    expect(hashWorld(replay(CONFIG, w.log))).toBe(hashWorld(w.state));
  });
});

describe("admire", () => {
  /** Ada's piece on her pedestal, and Bob and Cy settled on other plots. */
  function shown() {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "Morning" });
    w.ok("ada", { type: "display", item: "i_1", x: 2, y: 2 });
    w.settle("bob", 2, 0);
    w.settle("cy", 0, 2);
    return w;
  }

  it("counts once a day per resident, from anywhere, and the count stays with the thing", () => {
    const w = shown();
    expect(w.ok("bob", { type: "admire", x: 2, y: 2 })).toEqual([
      { type: "admired", x: 2, y: 2, item: "i_1", maker: "ada", by: "bob", admired: 1 },
    ]);
    expect(w.code("bob", { type: "admire", x: 2, y: 2 })).toBe("already_admired");
    w.ok("cy", { type: "admire", x: 2, y: 2 });
    expect(displayAt(w.state, 2, 2)?.good.admired).toBe(2);
    w.ok(TOWN_ACTOR, { type: "new_day", day: DAY + 1 });
    expect(w.state.items?.today.admired).toBeUndefined();
    w.ok("bob", { type: "admire", x: 2, y: 2 });
    w.ok("ada", { type: "take_down", x: 2, y: 2 });
    expect(w.goods("ada")[0]?.admired).toBe(3);
  });

  it("refuses your own, an empty tile, and before items open", () => {
    const w = shown();
    expect(w.code("ada", { type: "admire", x: 2, y: 2 })).toBe("not_eligible");
    expect(w.code("bob", { type: "admire", x: 3, y: 2 })).toBe("nothing_displayed");
    expect(w.code("bob", { type: "admire", x: 999, y: 2 })).toBe("out_of_bounds");
    const fresh = world();
    fresh.ok(TOWN_ACTOR, { type: "new_day", day: DAY });
    fresh.ok("bob", { type: "join", name: "bob", kind: "human" });
    expect(fresh.code("bob", { type: "admire", x: 2, y: 2 })).toBe("items_closed");
  });

  it("replays to the same world", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "new_day", day: DAY });
    w.ok(TOWN_ACTOR, { type: "open_items" });
    w.settle("ada", 0, 0);
    w.settle("bob", 2, 0);
    w.ok("ada", { type: "place", x: 2, y: 2, block: "pedestal" });
    w.ok("ada", { type: "make_piece", media: ART, title: "A" });
    w.ok("ada", { type: "display", item: "i_1", x: 2, y: 2 });
    w.ok("bob", { type: "admire", x: 2, y: 2 });
    w.ok(TOWN_ACTOR, { type: "new_day", day: DAY + 1 });
    w.ok("bob", { type: "admire", x: 2, y: 2 });
    expect(hashWorld(replay(CONFIG, w.log))).toBe(hashWorld(w.state));
  });
});

describe("set_gallery", () => {
  it("marks a plot you can build on a gallery, and back", () => {
    const w = gallery();
    expect(w.ok("ada", { type: "set_gallery", px: 0, py: 0, open: true })).toEqual([
      { type: "gallery_set", px: 0, py: 0, open: true, by: "ada" },
    ]);
    expect(w.state.plots["0,0"]?.gallery).toBe(true);
    expect(w.code("ada", { type: "set_gallery", px: 0, py: 0, open: true })).toBe("already_set");
    w.ok("ada", { type: "set_gallery", px: 0, py: 0, open: false });
    expect(w.state.plots["0,0"]).not.toHaveProperty("gallery");
    expect(w.code("ada", { type: "set_gallery", px: 0, py: 0, open: false })).toBe("already_set");
  });

  it("refuses someone else's plot and an unclaimed one", () => {
    const w = gallery();
    w.settle("bob", 2, 0);
    expect(w.code("bob", { type: "set_gallery", px: 0, py: 0, open: true })).toBe("not_your_plot");
    expect(w.code("bob", { type: "set_gallery", px: 0, py: 2, open: true })).toBe("no_plot");
    w.ok("ada", { type: "share_plot", with: "bob" });
    w.ok("bob", { type: "set_gallery", px: 0, py: 0, open: true });
  });
});
