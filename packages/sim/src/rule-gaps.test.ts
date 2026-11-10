import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { RULE_GAPS_CONFIG, RULE_GAPS_HASH, RULE_GAPS_LOG } from "./fixtures/rule-gaps-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import { expectSupplyHolds, fund } from "./test-support";
import { type Command, type Rejection, TOWN_ACTOR } from "./types";
import { createWorld } from "./world";

/**
 * `close_rule_gaps` (RFC 0053): townsfolk don't buy upstairs or lot steps, and a Town Hall build
 * puts no block in the Commons' wild yard. The world is the fixture's up to the switch, where Tom
 * is townsfolk on plot (2, 2) and the Commons' lot is tiles 20 to 27. Every refusal is checked to
 * leave the world byte-identical.
 */
const SWITCH = RULE_GAPS_LOG.findIndex((i) => i.command.type === "close_rule_gaps");

function world(upTo = SWITCH) {
  const state = replay(RULE_GAPS_CONFIG, RULE_GAPS_LOG.slice(0, upTo));
  const refused = (actor: string, command: Command): Rejection => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    expect(result.ok, `${actor} ${JSON.stringify(command)} should be refused`).toBe(false);
    expect(hashWorld(state)).toBe(before);
    return result.ok ? { code: "internal" as never, message: "" } : result.rejection;
  };
  const ok = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
  };
  return { state, ok, refused, close: () => ok(TOWN_ACTOR, { type: "close_rule_gaps" }) };
}

const yardBench: Command = {
  type: "propose",
  kind: "commons_build",
  title: "A bench in the yard",
  text: "",
  blocks: [{ x: 17, y: 22, block: "bench" }],
};

describe("closing the rule gaps (close_rule_gaps)", () => {
  it("replays a log with inputs on both sides of the switch to its pinned hash", () => {
    const state = createWorld(RULE_GAPS_CONFIG);
    for (const input of RULE_GAPS_LOG) {
      expect(apply(state, input), JSON.stringify(input)).toMatchObject({ ok: true });
      expectSupplyHolds(state);
    }
    expect(hashWorld(state)).toBe(RULE_GAPS_HASH);
    // Tom's upstairs from before the switch stays.
    expect(state.plots["2,2"]?.floors).toBe(1);
    // Ada's yard bench went up before it; Bob's, closed after it, was skipped.
    expect(state.blocks["18,18"]).toBe("bench");
    expect(state.blocks["26,26"]).toBe("bench");
    expect(state.blocks["29,29"]).toBeUndefined();
    // Cy's yard path, filed after the switch, was laid.
    expect(state.ground?.["18,20"]).toBe("cobble");
  });

  it("comes only from the server, once", () => {
    const w = world();
    expect(w.refused("ada", { type: "close_rule_gaps" }).code).toBe("server_only");
    w.close();
    expect(w.refused(TOWN_ACTOR, { type: "close_rule_gaps" }).code).toBe("already_open");
  });

  it("refuses a townsfolk's upstairs and lot step, and nobody else's", () => {
    const w = world();
    // Cy joins the townsfolk with a home that has no upstairs yet.
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["cy", "tom"] });
    for (const id of ["cy", "tom", "bob"]) fund(w.state, id, 2_000);
    w.close();
    const floor = w.refused("cy", { type: "add_floor", px: 0, py: 2 });
    expect(floor.code).toBe("not_eligible");
    expect(floor.message).toContain("Townsfolk don't add upstairs");
    const lot = w.refused("tom", { type: "grow_lot", px: 2, py: 2 });
    expect(lot.code).toBe("not_eligible");
    expect(lot.message).toContain("Townsfolk don't grow lots");
    w.ok("bob", { type: "add_floor", px: 2, py: 0 });
    expectSupplyHolds(w.state);
  });

  it("refuses a block in the Commons yard when filed, and still takes a path there", () => {
    const before = world();
    before.ok("cy", yardBench);
    const w = world();
    w.close();
    const filed = w.refused("cy", yardBench);
    expect(filed.code).toBe("invalid_proposal");
    expect(filed.message).toContain("(17, 22) is in the Commons' wild yard");
    w.ok("cy", {
      ...yardBench,
      blocks: [{ x: 20, y: 22, block: "bench" }],
      ground: [{ x: 17, y: 22, ground: "cobble" }],
    });
  });
});
