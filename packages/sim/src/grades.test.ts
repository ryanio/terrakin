import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { plotPlan } from "./build";
import { GRADES_CONFIG, GRADES_HASH, GRADES_LOG } from "./fixtures/grades-log";
import { FINE_RECIPES, GRADING, type Grade, gradeAt } from "./grades";
import { hashWorld } from "./hash";
import { heldGraded, type StackKind } from "./items";
import { replay } from "./replay";
import { expectMaterialsHold, stock } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldEvent, type WorldState } from "./types";
import { cloneWorld } from "./world";

/**
 * Material grades (RFC 0051). The world is the grades fixture just before `open_grades`: Ada, at
 * (3, 3) in her wood hut on plot (0, 0) with a workbench at (4, 3), holds 4 plain plaster, 34
 * stone and 17 seashells. Every input that moves a material runs through `expectMaterialsHold`.
 */

const BEFORE = GRADES_LOG.slice(
  0,
  GRADES_LOG.findIndex((i) => i.command.type === "open_grades"),
);
let built: WorldState | undefined;
const shut = (): WorldState => {
  built ??= replay(GRADES_CONFIG, BEFORE);
  return cloneWorld(built);
};
const open = (): WorldState => {
  const s = shut();
  ok(s, TOWN_ACTOR, { type: "open_grades" });
  return s;
};

function ok(s: WorldState, actor: string, command: Command): WorldEvent[] {
  const r = expectMaterialsHold(s, () => apply(s, { actor, command }));
  expect(r, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
  return r.ok ? r.events : [];
}

function refused(s: WorldState, actor: string, command: Command, code: string): string {
  const before = hashWorld(s);
  const r = apply(s, { actor, command });
  expect(r.ok, `${actor} ${JSON.stringify(command)}`).toBe(false);
  expect(hashWorld(s)).toBe(before);
  if (r.ok) return "";
  expect(r.rejection.code, r.rejection.message).toBe(code);
  return r.rejection.message;
}

const has = (s: WorldState, id: string, kind: StackKind, grade: Grade = "plain") =>
  heldGraded(s.items?.inventories[id], kind, grade);

const fine = (roll: number, recipe = "plaster"): Command =>
  ({ type: "craft", recipe, x: 4, y: 3, grade: "fine", roll }) as Command;

describe("material grades", () => {
  it("pins the fine table and the roll", () => {
    expect(GRADING).toEqual({ outOf: 10_000, masterwork: 800, floor: 15 });
    expect(FINE_RECIPES).toEqual({
      plaster: { needs: { stone: 2, seashell: 1 }, makes: 2 },
      brickwork: { needs: { stone: 2, wood: 1, clay: 1 }, makes: 2 },
      timber_frame: { needs: { wood: 2 }, fine: { plaster: 1 }, makes: 2 },
      driftwood_plank: { needs: { driftwood: 3, pinecone: 1 }, makes: 2 },
      sea_glass_pane: { needs: { sea_glass: 2, crystal: 1 }, makes: 2 },
    });
  });

  it("replays the grades log to its pinned hash", () => {
    expect(hashWorld(replay(GRADES_CONFIG, GRADES_LOG))).toBe(GRADES_HASH);
  });

  it("opens once, only from the town, and refuses every grade before it", () => {
    const s = shut();
    refused(s, "ada", { type: "open_grades" }, "server_only");
    refused(s, "ada", fine(9999), "grades_closed");
    // Any grade at all, plain included, waits for the switch.
    refused(
      s,
      "ada",
      { type: "craft", recipe: "plaster", x: 4, y: 3, grade: "plain" },
      "grades_closed",
    );
    refused(
      s,
      "ada",
      { type: "place", x: 3, y: 2, block: "plaster", grade: "fine" },
      "grades_closed",
    );
    refused(s, "ada", { type: "give", item: "plaster", to: "dee", grade: "fine" }, "grades_closed");
    ok(s, TOWN_ACTOR, { type: "open_grades" });
    refused(s, TOWN_ACTOR, { type: "open_grades" }, "already_open");
  });

  it("gives grades only to made materials, and only grades it knows", () => {
    const s = open();
    for (const command of [
      { type: "place", x: 3, y: 2, block: "wood", grade: "fine" },
      { type: "place", x: 3, y: 3, side: "n", block: "door", grade: "fine" },
      { type: "give", item: "sugar", to: "dee", grade: "fine" },
      { type: "craft", recipe: "chair", x: 4, y: 3, grade: "fine", roll: 1 },
      { type: "set_roof", px: 0, py: 0, style: "gable", material: "leaf", grade: "masterwork" },
      { type: "list_item", item: "jar", price: 1, grade: "fine" },
    ] as Command[]) {
      refused(s, "ada", command, "ungraded");
    }
    refused(
      s,
      "ada",
      { type: "place", x: 3, y: 2, block: "plaster", grade: "gold" } as unknown as Command,
      "unknown_item",
    );
    // Plain is what leaving it out means, on anything.
    ok(s, "ada", { type: "place", x: 3, y: 2, block: "wood", grade: "plain" });
  });

  it("takes the server's roll on a fine craft and nowhere else", () => {
    const s = open();
    const craft = { type: "craft", recipe: "plaster", x: 4, y: 3 } as const;
    refused(s, "ada", { ...craft, grade: "fine" }, "server_only");
    refused(s, "ada", fine(GRADING.outOf), "server_only");
    refused(s, "ada", fine(-1), "server_only");
    refused(s, "ada", fine(1.5), "server_only");
    refused(s, "ada", { ...craft, roll: 5 }, "server_only");
    refused(s, "ada", { ...craft, grade: "masterwork", roll: 5 }, "unknown_item");
  });

  it("makes fine from the plain recipe and a find, two at a time, masterwork by the roll", () => {
    const s = open();
    const events = ok(s, "ada", fine(GRADING.masterwork));
    expect(events[0]).toEqual({
      type: "inventory",
      residentId: "ada",
      reason: "craft",
      changes: [
        { kind: "stone", amount: -2, count: 32 },
        { kind: "seashell", amount: -1, count: 16 },
        { kind: "plaster", grade: "fine", amount: 2, count: 2 },
      ],
    });
    ok(s, "ada", fine(GRADING.masterwork - 1));
    expect(has(s, "ada", "plaster", "masterwork")).toBe(2);
    // Plain plaster was never touched.
    expect(has(s, "ada", "plaster")).toBe(4);
    expect(s.items?.fineRun).toEqual({ ada: 0 });
  });

  it("makes the next fine craft masterwork once the floor's run of fine ones is reached", () => {
    const s = open();
    stock(s, "ada", { stone: 40, seashell: 20 });
    for (let i = 0; i < GRADING.floor; i++) ok(s, "ada", fine(GRADING.outOf - 1));
    expect(has(s, "ada", "plaster", "masterwork")).toBe(0);
    expect(s.items?.fineRun).toEqual({ ada: GRADING.floor });
    ok(s, "ada", fine(GRADING.outOf - 1));
    expect(has(s, "ada", "plaster", "masterwork")).toBe(2);
    expect(s.items?.fineRun).toEqual({ ada: 0 });
  });

  it("makes fine timber frame from fine plaster only, and names what's short", () => {
    const s = open();
    stock(s, "ada", { wood: 4 });
    const words = refused(s, "ada", fine(9999, "timber_frame"), "not_enough_items");
    expect(words).toContain("1 fine plaster block");
    expect(words).toContain('craft {"recipe": "plaster", "grade": "fine"}');
    ok(s, "ada", fine(9999));
    ok(s, "ada", fine(9999, "timber_frame"));
    expect(has(s, "ada", "plaster", "fine")).toBe(1);
    expect(has(s, "ada", "timber_frame", "fine")).toBe(2);
    expect(has(s, "ada", "plaster")).toBe(4);
  });

  it("refuses fine brickwork where no clay lies, as any missing input", () => {
    const s = open();
    stock(s, "ada", { wood: 2 });
    expect(refused(s, "ada", fine(9999, "brickwork"), "not_enough_items")).toContain("1 clay");
  });

  it("places and takes up a graded block and line, giving back the grade that stood", () => {
    const s = open();
    stock(s, "ada", { plaster: 1 }, "fine");
    stock(s, "ada", { sea_glass_pane: 1 }, "masterwork");
    expect(
      refused(
        s,
        "ada",
        { type: "place", x: 3, y: 2, block: "plaster", grade: "masterwork" },
        "not_enough_items",
      ),
    ).toBe(
      'You have no masterwork plaster blocks. Masterwork comes by chance from a fine craft: craft {"recipe": "plaster", "grade": "fine"}.',
    );
    expect(ok(s, "ada", { type: "place", x: 3, y: 2, block: "plaster", grade: "fine" })[0]).toEqual(
      {
        type: "block_placed",
        x: 3,
        y: 2,
        block: "plaster",
        grade: "fine",
        by: "ada",
      },
    );
    ok(s, "ada", {
      type: "place",
      x: 3,
      y: 3,
      side: "n",
      block: "sea_glass_pane",
      grade: "masterwork",
    });
    expect(gradeAt(s, "3,2")).toBe("fine");
    expect(gradeAt(s, "3,3,n")).toBe("masterwork");
    ok(s, "ada", { type: "remove", x: 3, y: 2 });
    ok(s, "ada", { type: "remove", x: 3, y: 3, side: "n" });
    expect(has(s, "ada", "plaster", "fine")).toBe(1);
    expect(has(s, "ada", "sea_glass_pane", "masterwork")).toBe(1);
    expect(s.grades).toBeUndefined();
    // A plain block there afterwards is plain.
    ok(s, "ada", { type: "place", x: 3, y: 2, block: "plaster" });
    expect(gradeAt(s, "3,2")).toBe("plain");
  });

  it("swaps a plain wall for a fine one in a plan, counting each grade on its own", () => {
    const s = open();
    stock(s, "ada", { plaster: 2 }, "fine");
    ok(s, "ada", { type: "place", x: 3, y: 2, block: "plaster" });
    // The same kind at another grade is something else there, until the plan takes it away.
    const plan = {
      type: "build",
      px: 0,
      py: 0,
      blocks: [{ x: 3, y: 2, block: "plaster", grade: "fine" }],
    } as Command;
    refused(s, "ada", plan, "tile_occupied");
    const events = ok(s, "ada", { ...plan, remove: [{ x: 3, y: 2 }] } as Command);
    expect(events.at(-1)).toMatchObject({
      reason: "built",
      changes: [
        { kind: "plaster", amount: 1, count: 4 },
        { kind: "plaster", grade: "fine", amount: -1, count: 1 },
      ],
    });
    expect(gradeAt(s, "3,2")).toBe("fine");
    refused(
      s,
      "ada",
      { type: "build", px: 0, py: 0, blocks: [{ x: 3, y: 2, block: "plaster", grade: "fine" }] },
      "already_set",
    );
    const short = refused(
      s,
      "ada",
      {
        type: "build",
        px: 0,
        py: 0,
        edges: [
          { x: 3, y: 3, side: "n", block: "plaster", grade: "fine" },
          { x: 3, y: 3, side: "w", block: "plaster", grade: "fine" },
        ],
      },
      "not_enough_items",
    );
    expect(short).toContain("This plan needs 1 fine plaster block more than you have.");
  });

  it("copies a plot's grades into its plan", () => {
    const s = replay(GRADES_CONFIG, GRADES_LOG);
    const plan = plotPlan(s, 0, 0);
    expect(plan?.edges?.find((e) => e.x === 1 && e.y === 1 && e.side === "n")).toEqual({
      x: 1,
      y: 1,
      side: "n",
      block: "plaster",
      grade: "fine",
    });
    expect(plan?.edges?.find((e) => e.block === "glass")).not.toHaveProperty("grade");
  });

  it("tops up a first slim by kind and grade, never in another grade", () => {
    const log = GRADES_LOG.slice(
      0,
      GRADES_LOG.findIndex((i) => i.command.type === "slim_walls"),
    );
    const slim = GRADES_LOG.find((i) => i.command.type === "slim_walls")?.command as Extract<
      Command,
      { type: "slim_walls" }
    >;
    // With every line plain, the fine blocks it takes up earn no gift of plain: it's short.
    const s = replay(GRADES_CONFIG, log);
    const plain = slim.edges.map(({ grade: _, ...e }) => e);
    expect(refused(s, "ada", { ...slim, edges: plain }, "not_enough_items")).toContain(
      "13 plaster blocks",
    );
    // As the fixture has it, 17 fine lines from 13 fine blocks: the town gives the 4 more.
    const before = has(s, "ada", "plaster", "fine");
    ok(s, "ada", slim);
    expect(has(s, "ada", "plaster", "fine")).toBe(before);
  });

  it("roofs in a grade, and gives that grade back when the roof changes", () => {
    const s = open();
    stock(s, "ada", { plaster: 8 }, "fine");
    stock(s, "ada", { plaster: 8 }, "masterwork");
    const roof = { type: "set_roof", px: 0, py: 0, style: "gable", material: "plaster" } as const;
    ok(s, "ada", { ...roof, grade: "fine" });
    refused(s, "ada", { ...roof, grade: "fine" }, "already_set");
    expect(ok(s, "ada", { ...roof, grade: "masterwork" })[0]).toMatchObject({
      type: "roof_changed",
      grade: "masterwork",
    });
    expect(has(s, "ada", "plaster", "fine")).toBe(8);
    expect(has(s, "ada", "plaster", "masterwork")).toBe(0);
    ok(s, "ada", { type: "set_roof", px: 0, py: 0, style: "flat" });
    expect(has(s, "ada", "plaster", "masterwork")).toBe(8);
    expect(s.plots["0,0"]?.roof).toBeUndefined();
  });

  it("gives, sends back, and wraps at a grade", () => {
    const s = open();
    ok(s, TOWN_ACTOR, { type: "open_gifts" });
    stock(s, "ada", { plaster: 4 }, "fine");
    expect(
      refused(
        s,
        "ada",
        { type: "give", item: "plaster", count: 5, to: "bob", grade: "fine" },
        "not_enough_items",
      ),
    ).toBe("You have 4 fine plaster blocks.");
    const events = ok(s, "ada", {
      type: "give",
      item: "plaster",
      count: 2,
      to: "bob",
      grade: "fine",
    });
    expect(events.at(-1)).toEqual({
      type: "item_given",
      from: "ada",
      to: "bob",
      kind: "plaster",
      grade: "fine",
    });
    expect(has(s, "bob", "plaster", "fine")).toBe(2);
    expect(has(s, "bob", "plaster")).toBe(0);
    const gift = Object.values(s.items?.gifts ?? {}).at(-1);
    expect(gift?.grade).toBe("fine");
    ok(s, "bob", { type: "decline_gift", gift: gift?.id ?? "" });
    expect(has(s, "ada", "plaster", "fine")).toBe(4);
    // A present holds its grade until it's opened.
    ok(s, TOWN_ACTOR, { type: "new_day", day: 20_058 });
    ok(s, "ada", {
      type: "give",
      item: "plaster",
      count: 3,
      to: "dee",
      grade: "fine",
      wrapped: true,
    });
    expect(Object.values(s.items?.presents ?? {})[0]?.grade).toBe("fine");
    ok(s, TOWN_ACTOR, { type: "new_day", day: 20_082 });
    ok(s, "dee", { type: "open_present", present: "present_1" });
    expect(has(s, "dee", "plaster", "fine")).toBe(3);
  });

  it("escrows a graded lot and gives it back at its grade", () => {
    const s = open();
    stock(s, "ada", { plaster: 6 }, "fine");
    ok(s, "ada", { type: "list_item", item: "plaster", count: 2, price: 5, grade: "fine" });
    ok(s, "ada", { type: "unlist_item", listing: "l_3" });
    ok(s, "ada", { type: "list_item", item: "plaster", count: 2, price: 5, grade: "fine" });
    ok(s, TOWN_ACTOR, { type: "remove_listing", listing: "l_4" });
    expect(has(s, "ada", "plaster", "fine")).toBe(6);
    expect(has(s, "ada", "plaster")).toBe(4);
    ok(s, "ada", { type: "list_item", item: "plaster", count: 3, price: 5, grade: "fine" });
    const sold = ok(s, "bob", { type: "buy_listing", listing: "l_5" });
    expect(sold.find((e) => e.type === "listing_sold")).toMatchObject({
      kind: "plaster",
      grade: "fine",
      count: 3,
    });
    expect(has(s, "bob", "plaster", "fine")).toBe(3);
  });

  it("gives a plot's owner back the grade that stood, from staff's clear_block and rebuild_home", () => {
    const s = open();
    stock(s, "ada", { plaster: 3 }, "masterwork");
    ok(s, "ada", { type: "place", x: 3, y: 2, block: "plaster", grade: "masterwork" });
    ok(s, "ada", { type: "place", x: 3, y: 3, side: "n", block: "plaster", grade: "masterwork" });
    ok(s, "ada", {
      type: "build",
      px: 0,
      py: 0,
      remove: [{ x: 1, y: 2 }],
      blocks: [{ x: 1, y: 2, block: "plaster", grade: "masterwork" }],
    });
    ok(s, TOWN_ACTOR, { type: "clear_block", x: 3, y: 2 });
    ok(s, TOWN_ACTOR, { type: "clear_block", x: 3, y: 3, side: "n" });
    ok(s, TOWN_ACTOR, {
      type: "rebuild_home",
      px: 0,
      py: 0,
      blocks: [{ x: 1, y: 2, block: "wood" }],
      remove: [{ x: 1, y: 2 }],
    });
    expect(has(s, "ada", "plaster", "masterwork")).toBe(3);
    expect(s.grades).toBeUndefined();
  });

  it("moves graded things in a merge and drops the floor's run", () => {
    const s = open();
    ok(s, "eve", { type: "join", name: "eve", kind: "human" });
    ok(s, "eve", { type: "leave" });
    stock(s, "eve", { plaster: 3, brickwork: 1 }, "fine");
    stock(s, "eve", { plaster: 1 }, "masterwork");
    if (s.items) s.items.fineRun = { eve: 7 };
    const events = ok(s, TOWN_ACTOR, { type: "merge_resident", from: "eve", into: "dee" });
    expect(events.find((e) => e.type === "inventory")).toMatchObject({
      changes: [
        { kind: "plaster", grade: "fine", amount: 3, count: 3 },
        { kind: "plaster", grade: "masterwork", amount: 1, count: 1 },
        { kind: "brickwork", grade: "fine", amount: 1, count: 1 },
      ],
    });
    expect(s.items?.fineRun).toBeUndefined();
  });

  it("counts graded things toward what a resident can hold", () => {
    const s = open();
    const room =
      200 -
      Object.values(s.items?.inventories.bob?.stacks ?? {}).reduce((a, n) => a + (n ?? 0), 0) -
      (s.items?.inventories.bob?.goods.length ?? 0);
    stock(s, "bob", { plaster: room }, "fine");
    refused(s, "ada", { type: "give", item: "sugar", to: "bob" }, "inventory_full");
  });
});
