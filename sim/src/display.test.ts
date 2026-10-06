import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import {
  displayAt,
  displaysOf,
  everyGood,
  findsHeldAsideOf,
  findsOnDisplay,
  heldAsideOf,
} from "./display";
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
  return { state, log, send, ok, code, settle, goods };
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

  it("holds a former co-owner's thing aside when they're full, so the plot can still be released", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "new_day", day: DAY });
    w.ok(TOWN_ACTOR, { type: "open_items" });
    w.ok("ada", { type: "join", name: "ada", kind: "human" });
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    const ada = w.state.residents.ada;
    if (!ada) throw new Error("ada");
    const at = { x: ada.x < 7 ? ada.x + 1 : ada.x - 1, y: ada.y };
    w.ok("ada", { type: "place", ...at, block: "pedestal" });
    // Bob shares the plot, puts his piece up, and is then unshared.
    w.ok("bob", { type: "join", name: "bob", kind: "human" });
    w.ok("ada", { type: "share_plot", with: "bob" });
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("bob");
    bob.x = ada.x;
    bob.y = ada.y;
    w.ok("bob", { type: "make_piece", media: ART, title: "Bob's" });
    w.ok("bob", { type: "display", item: "i_1", ...at });
    w.ok("ada", { type: "unshare_plot", with: "bob" });
    bob.x = 12;
    bob.y = 12;
    const room = ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.bob);
    stock(w.state, "bob", { tomato: room });
    // Ada takes it down anyway: it waits for Bob instead of pinning her pedestal.
    expect(w.ok("ada", { type: "take_down", ...at })).toEqual([
      { type: "taken_down", ...at, by: "ada" },
    ]);
    expect(heldAsideOf(w.state, "bob").map((d) => d.good.id)).toEqual(["i_1"]);
    expect(w.goods("ada")).toEqual([]);
    w.ok("ada", { type: "remove", ...at });
    expect(w.ok("ada", { type: "release" })).toContainEqual(
      expect.objectContaining({ type: "plot_released", px: 0, py: 0 }),
    );
    // Bob makes room, and his piece comes back with that same action.
    w.ok("bob", { type: "give", item: "tomato", to: "ada", count: 1 });
    expect(w.goods("bob").map((g) => g.id)).toEqual(["i_1"]);
    expect(w.state.items?.heldAside).toBeUndefined();
  });

  it("waits for room in your own things when you take your own thing down", () => {
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

describe("finds on display (RFC 0021)", () => {
  it("puts one of a find up by its kind and back on its stack, apart from the made things", () => {
    const w = gallery();
    expect(w.code("ada", { type: "display", item: "geode", x: 2, y: 2 })).toBe("not_enough_items");
    stock(w.state, "ada", { geode: 2, wood: 1 });
    // Wood stacks too, but only a find may stand on a pedestal.
    expect(w.code("ada", { type: "display", item: "wood", x: 2, y: 2 })).toBe("unknown_item");
    expect(w.ok("ada", { type: "display", item: "geode", x: 2, y: 2 })).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "displayed",
        changes: [{ kind: "geode", amount: -1, count: 1 }],
      },
      { type: "find_displayed", x: 2, y: 2, kind: "geode", by: "ada" },
    ]);
    expect(displayAt(w.state, 2, 2)).toEqual({ find: "geode", by: "ada", day: DAY });
    expect(findsOnDisplay(w.state)).toEqual([{ x: 2, y: 2, kind: "geode", by: "ada", day: DAY }]);
    // Galleries, reports, and karma read made things only: a find has no maker and no id.
    expect(displaysOf(w.state)).toEqual({});
    expect(everyGood(w.state)).toEqual([]);
    expect(w.code("ada", { type: "remove", x: 2, y: 2 })).toBe("tile_occupied");
    expect(w.ok("ada", { type: "take_down", x: 2, y: 2 })).toEqual([
      { type: "taken_down", x: 2, y: 2, by: "ada" },
      {
        type: "inventory",
        residentId: "ada",
        reason: "off_display",
        changes: [{ kind: "geode", amount: 1, count: 2 }],
      },
    ]);
    expect(w.state.items?.displays).toEqual({});
  });

  it("can't be admired, since nobody made it, and says to admire the plot instead", () => {
    const w = gallery();
    stock(w.state, "ada", { seashell: 1 });
    w.ok("ada", { type: "display", item: "seashell", x: 4, y: 2 });
    w.settle("bob", 2, 0);
    const refused = w.send("bob", { type: "admire", x: 4, y: 2 });
    expect(refused).toMatchObject({ ok: false, rejection: { code: "not_eligible" } });
    expect(refused.ok ? "" : refused.rejection.message).toContain("POST /v1/plots/0/0/admire");
  });

  it("waits for its owner when it's taken down while their things are full, then rejoins the stack", () => {
    const w = gallery();
    w.settle("bob", 2, 0);
    w.ok("ada", { type: "share_plot", with: "bob" });
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("bob");
    bob.x = 3;
    bob.y = 2;
    stock(w.state, "bob", { fossil: 1 });
    w.ok("bob", { type: "display", item: "fossil", x: 2, y: 2 });
    w.ok("ada", { type: "unshare_plot", with: "bob" });
    const room = ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.bob);
    stock(w.state, "bob", { tomato: room });
    expect(w.ok("ada", { type: "take_down", x: 2, y: 2 })).toEqual([
      { type: "taken_down", x: 2, y: 2, by: "ada" },
    ]);
    expect(findsHeldAsideOf(w.state, "bob")).toEqual([{ find: "fossil", by: "bob", day: DAY }]);
    expect(heldAsideOf(w.state, "bob")).toEqual([]);
    // Bob makes room, and the fossil comes back to his stack with that same action.
    const events = w.ok("bob", { type: "give", item: "tomato", to: "ada", count: 1 });
    expect(events).toContainEqual({
      type: "inventory",
      residentId: "bob",
      reason: "held",
      changes: [{ kind: "fossil", amount: 1, count: 1 }],
    });
    expect(w.state.items?.heldAside).toBeUndefined();
  });
});

describe("remove_display", () => {
  const remove = (item: string, picture?: true): Command => ({
    type: "remove_display",
    item,
    ...(picture ? { picture } : {}),
  });
  const ART2 = "m_fedcba9876543210";

  it("only comes from the server", () => {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "A" });
    w.ok("ada", { type: "display", item: "i_1", x: 2, y: 2 });
    w.settle("bob", 2, 0);
    expect(w.code("ada", remove("i_1"))).toBe("server_only");
    expect(w.code("bob", remove("i_1", true))).toBe("server_only");
    expect(displaysOf(w.state)["2,2"]?.good.id).toBe("i_1");
  });

  it("gives a displayed thing back to whoever put it up, label and picture and all", () => {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "Rude words" });
    const [piece] = w.goods("ada");
    w.ok("ada", { type: "display", item: "i_1", x: 4, y: 2 });
    expect(w.ok(TOWN_ACTOR, remove("i_1"))).toEqual([
      { type: "display_removed", x: 4, y: 2, item: "i_1", by: "ada" },
      { type: "inventory", residentId: "ada", reason: "taken_down", gained: [piece] },
    ]);
    expect(w.goods("ada")).toEqual([piece]);
    expect(w.state.items?.displays).toEqual({});
    // The frame is free again.
    w.ok("ada", { type: "remove", x: 4, y: 2 });
  });

  it("holds the thing aside when their things are full, and gives it back once there's room", () => {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "A" });
    w.ok("ada", { type: "display", item: "i_1", x: 2, y: 2 });
    const room = ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.ada);
    stock(w.state, "ada", { tomato: room });
    expect(w.ok(TOWN_ACTOR, remove("i_1"))).toEqual([
      { type: "display_removed", x: 2, y: 2, item: "i_1", by: "ada" },
    ]);
    // Nothing went past the cap, and nothing was lost: it waits for Ada alone.
    expect(inventorySize(w.state.items?.inventories.ada)).toBe(ITEMS.inventoryMax);
    expect(heldAsideOf(w.state, "ada").map((d) => d.good.id)).toEqual(["i_1"]);
    expect(heldAsideOf(w.state, "bob")).toEqual([]);
    expect(displayAt(w.state, 2, 2)).toBeUndefined();
    // The pedestal is free, and an input that leaves her full brings nothing back.
    expect(w.ok("ada", { type: "remove", x: 2, y: 2 })).not.toContainEqual(
      expect.objectContaining({ reason: "held" }),
    );
    expect(heldAsideOf(w.state, "ada")).toHaveLength(1);
    // Making room brings it back with the same input.
    w.settle("bob", 2, 0);
    const events = w.ok("ada", { type: "give", item: "tomato", to: "bob", count: 1 });
    expect(events).toContainEqual({
      type: "inventory",
      residentId: "ada",
      reason: "held",
      gained: [expect.objectContaining({ id: "i_1", label: "A", media: ART })],
    });
    expect(w.state.items?.heldAside).toBeUndefined();
    expect(w.goods("ada").map((g) => g.id)).toEqual(["i_1"]);
  });

  it("with picture, takes the picture off every piece made from that upload, wherever it is", () => {
    const w = gallery();
    w.settle("bob", 2, 0);
    w.ok("ada", { type: "make_piece", media: ART, title: "One" });
    w.ok("ada", { type: "make_piece", media: ART, title: "Two", model: true });
    w.ok("ada", { type: "make_piece", media: ART, title: "Three" });
    w.ok("ada", { type: "make_piece", media: ART2, title: "Other" });
    w.ok("ada", { type: "display", item: "i_1", x: 2, y: 2 });
    w.ok("ada", { type: "give", item: "i_3", to: "bob" });
    expect(w.ok(TOWN_ACTOR, remove("i_1", true))).toEqual([
      { type: "picture_removed", items: expect.arrayContaining(["i_1", "i_2", "i_3"]) },
      { type: "display_removed", x: 2, y: 2, item: "i_1", by: "ada" },
      {
        type: "inventory",
        residentId: "ada",
        reason: "taken_down",
        gained: [{ id: "i_1", kind: "piece", maker: "ada", madeDay: DAY, label: "One" }],
      },
    ]);
    const all = [...w.goods("ada"), ...w.goods("bob")];
    expect(all.filter((g) => g.media === ART)).toEqual([]);
    expect(all.filter((g) => g.model)).toEqual([]);
    // Titles stay, and a piece from another upload keeps its picture.
    expect(all.map((g) => g.label).sort()).toEqual(["One", "Other", "Three", "Two"]);
    expect(all.find((g) => g.id === "i_4")?.media).toBe(ART2);
  });

  it("with picture, works on a piece that isn't on display", () => {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "One" });
    expect(w.ok(TOWN_ACTOR, remove("i_1", true))).toEqual([
      { type: "picture_removed", items: ["i_1"] },
    ]);
    expect(w.goods("ada")[0]).not.toHaveProperty("media");
    // Nothing left to remove.
    expect(w.code(TOWN_ACTOR, remove("i_1", true))).toBe("unknown_item");
  });

  it("refuses what isn't on display, a picture that isn't there, a bad id, and before items open", () => {
    const w = gallery();
    w.ok("ada", { type: "make_piece", media: ART, title: "A" });
    stock(w.state, "ada", { lemon: 3, sugar: 1, jar: 1 });
    expect(w.code(TOWN_ACTOR, remove("i_1"))).toBe("nothing_displayed");
    expect(w.code(TOWN_ACTOR, remove("i_9"))).toBe("nothing_displayed");
    expect(w.code(TOWN_ACTOR, remove("i_9", true))).toBe("unknown_item");
    expect(w.code(TOWN_ACTOR, remove("lemon"))).toBe("unknown_item");
    expect(
      w.code(TOWN_ACTOR, { type: "remove_display", item: "i_1", picture: false } as never),
    ).toBe("unknown_item");
    // A made thing that isn't a piece has no picture to take.
    w.ok("ada", { type: "place", x: 3, y: 2, block: "kitchen" });
    w.ok("ada", { type: "craft", recipe: "lemon_jam", x: 3, y: 2, label: "Jam" });
    const jam = w.goods("ada").find((g) => g.kind === "lemon_jam")?.id ?? "";
    w.ok("ada", { type: "display", item: jam, x: 2, y: 2 });
    expect(w.code(TOWN_ACTOR, remove(jam, true))).toBe("unknown_item");
    w.ok(TOWN_ACTOR, remove(jam));
    const fresh = world();
    expect(fresh.code(TOWN_ACTOR, remove("i_1"))).toBe("items_closed");
  });

  it("replays to the same world", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "new_day", day: DAY });
    w.ok(TOWN_ACTOR, { type: "open_items" });
    w.settle("ada", 0, 0);
    w.ok("ada", { type: "place", x: 2, y: 2, block: "pedestal" });
    w.ok("ada", { type: "make_piece", media: ART, title: "A" });
    w.ok("ada", { type: "make_piece", media: ART, title: "B" });
    w.ok("ada", { type: "display", item: "i_1", x: 2, y: 2 });
    w.ok(TOWN_ACTOR, remove("i_1"));
    w.ok("ada", { type: "display", item: "i_2", x: 2, y: 2 });
    w.ok(TOWN_ACTOR, remove("i_2", true));
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
    expect(displaysOf(w.state)["2,2"]?.good.admired).toBe(2);
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
