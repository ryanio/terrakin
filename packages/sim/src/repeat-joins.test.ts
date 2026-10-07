import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import {
  REPEAT_JOINS_CONFIG,
  REPEAT_JOINS_HASH,
  REPEAT_JOINS_LOG,
} from "./fixtures/repeat-joins-log";
import { hashWorld } from "./hash";
import { retireProblems } from "./repeat-joins";
import { replay } from "./replay";
import { expectSupplyHolds, fund, stock } from "./test-support";
import { type Command, type Input, TOWN_ACTOR, type WorldState } from "./types";

/**
 * Clearing the old repeat joins (issue #46, decision 0230). This deletes residents from a live
 * world, so every way a record counts as used has a test that a listed record like that is
 * refused, with the world left exactly as it was.
 */

const RETIRE = REPEAT_JOINS_LOG.findIndex((i) => i.command.type === "retire_repeat_joins");
const LISTED = ["r_annals", "r_blaze2", "r_blaze3", "r_pip2", "r_pip3"];

/** The fixture's world just before the town retires the repeat records. */
const before = (): WorldState => replay(REPEAT_JOINS_CONFIG, REPEAT_JOINS_LOG.slice(0, RETIRE));

const retire = (state: WorldState, ids: string[], actor = TOWN_ACTOR) =>
  apply(state, { actor, command: { type: "retire_repeat_joins", ids } });

const act = (state: WorldState, actor: string, command: Command) => {
  const done = apply(state, { actor, command });
  expect(done, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
};

/** Refused with `code`, and the world exactly as it was. */
function refused(state: WorldState, ids: string[], code: string) {
  const hash = hashWorld(state);
  const result = retire(state, ids);
  expect(result.ok ? "accepted" : result.rejection.code, ids.join(",")).toBe(code);
  expect(hashWorld(state)).toBe(hash);
}

describe("the repeat joins fixture", () => {
  it("replays to its pinned hash, with the records gone and the rest kept", () => {
    const state = replay(REPEAT_JOINS_CONFIG, REPEAT_JOINS_LOG);
    expect(hashWorld(state)).toBe(REPEAT_JOINS_HASH);
    expectSupplyHolds(state);
    expect(state.retiredRepeatJoins).toEqual(LISTED);
    for (const id of LISTED) expect(state.residents[id]).toBeUndefined();
    expect(Object.keys(state.residents)).toEqual(
      expect.arrayContaining(["r_pip", "r_blaze", "r_annals2", "eve"]),
    );
    expect(state.recipes?.everything).toEqual([
      "ada",
      "bob",
      "clem",
      "cy",
      "dee",
      "r_annals2",
      "r_blaze",
      "r_pip",
    ]);
  });
});

describe("retire_repeat_joins", () => {
  it("takes each record out with its empty purse and things, and tells everyone", () => {
    const state = before();
    expect(state.economy?.today.newcomers).toEqual(["r_blaze3"]);
    // Bookkeeping an unused record can be left with: an empty purse and empty things.
    if (state.economy) state.economy.coins.r_pip2 = 0;
    if (state.items) state.items.inventories.r_pip3 = { stacks: {}, goods: [] };
    const result = retire(state, [...LISTED].reverse());
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "repeat_joins_retired", ids: LISTED }],
    });
    expect(state.economy?.today.newcomers).toEqual([]);
    expect(state.economy?.coins).not.toHaveProperty("r_pip2");
    expect(state.items?.inventories).not.toHaveProperty("r_pip3");
    expect(state.recipes?.everything).not.toContain("r_pip2");
    expect(state.retiredRepeatJoins).toEqual(LISTED);
  });

  it("comes only from the town, and only once", () => {
    const state = before();
    expect(retire(state, ["r_pip2"], "ada")).toMatchObject({
      ok: false,
      rejection: { code: "server_only" },
    });
    expect(retire(state, [])).toMatchObject({ ok: true });
    expect(state.retiredRepeatJoins).toEqual([]);
    refused(state, ["r_pip2"], "already_open");
  });

  it("refuses an unknown id or one listed twice", () => {
    const state = before();
    refused(state, ["r_nobody"], "unknown_resident");
    refused(state, ["r_pip2", "r_pip2"], "unknown_resident");
  });

  // Each case uses one listed record in one way; the rest of the list stays untouched.
  const used: [string, (state: WorldState) => void][] = [
    ["online", (s) => act(s, "r_pip2", { type: "join", name: "Pip", kind: "agent" })],
    [
      "acted",
      (s) => {
        act(s, "r_pip2", { type: "join", name: "Pip", kind: "agent" });
        act(s, "r_pip2", { type: "move", dir: "e" });
        act(s, "r_pip2", { type: "leave" });
      },
    ],
    ["holding coins", (s) => fund(s, "r_pip2", 5)],
    ["holding things", (s) => stock(s, "r_pip2", { lemon: 1 })],
    [
      "sharing a plot",
      (s) => {
        act(s, "ada", { type: "home" });
        act(s, "ada", { type: "share_plot", with: "r_pip2" });
      },
    ],
    [
      "linked to an owner",
      (s) => act(s, TOWN_ACTOR, { type: "add_owner_pair", pair: ["ada", "r_pip2"] }),
    ],
    ["a maintainer", (s) => act(s, TOWN_ACTOR, { type: "set_maintainers", ids: ["r_pip2"] })],
    ["townsfolk", (s) => act(s, TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem", "r_pip2"] })],
  ];
  for (const [how, use] of used) {
    it(`never retires a record that is ${how}, even when it's listed`, () => {
      const state = before();
      use(state);
      refused(state, LISTED, "not_eligible");
      expect(retireProblems(state, LISTED).map((p) => p.id)).toEqual(["r_pip2"]);
    });
  }

  it("keeps one record of every name", () => {
    const state = before();
    // Every Blaze at once would leave nobody called Blaze.
    refused(state, ["r_blaze", "r_blaze2", "r_blaze3"], "not_eligible");
    // Eve's name is hers alone.
    act(state, "eve", { type: "join", name: "Eve", kind: "human" });
    act(state, "eve", { type: "leave" });
    refused(state, ["eve"], "not_eligible");
    expect(retire(state, ["r_blaze2", "r_blaze3"]).ok).toBe(true);
    expect(state.residents.r_blaze?.name).toBe("Blaze");
  });

  it("leaves a retired record out of the world for good", () => {
    const state = before();
    expect(retire(state, LISTED).ok).toBe(true);
    const back: Input = { actor: "r_pip2", command: { type: "join", name: "Pip", kind: "agent" } };
    expect(apply(state, back)).toMatchObject({ ok: false, rejection: { code: "not_eligible" } });
    expect(apply(state, { actor: "r_pip2", command: { type: "move", dir: "e" } })).toMatchObject({
      ok: false,
      rejection: { code: "not_joined" },
    });
  });
});
