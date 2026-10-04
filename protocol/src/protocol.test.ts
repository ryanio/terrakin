import { readFileSync } from "node:fs";
import {
  apply,
  CHAT_EARSHOT,
  type Command,
  createWorld,
  DEFAULT_CONFIG,
  spawnTile,
} from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { buildOpenApi } from "./openapi";
import { ACTION_TYPES, Action, ClientMessage, ERROR_CODES, WorldSnapshot } from "./schemas";

const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");

describe("SKILL.md stays in sync with the schemas", () => {
  it.each(ACTION_TYPES)("documents the %s action", (type) => {
    expect(skill).toContain(`### ${type}`);
  });

  it("states the chat earshot the server uses", () => {
    expect(skill).toContain(`within ${CHAT_EARSHOT} tiles`);
  });

  it.each(ERROR_CODES)("documents the %s error code", (code) => {
    expect(skill).toContain(`| \`${code}\` |`);
  });
});

describe("Action", () => {
  it("accepts valid actions and trims chat", () => {
    expect(Action.parse({ type: "chat", text: "  hi  " })).toEqual({ type: "chat", text: "hi" });
    expect(Action.safeParse({ type: "place", x: 1, y: 2, block: "stone" }).success).toBe(true);
  });

  it("rejects unknown types, bad blocks, and oversized chat", () => {
    expect(Action.safeParse({ type: "teleport", x: 1, y: 1 }).success).toBe(false);
    expect(Action.safeParse({ type: "place", x: 1, y: 2, block: "gold" }).success).toBe(false);
    expect(Action.safeParse({ type: "place", x: 1.5, y: 2, block: "wood" }).success).toBe(false);
    expect(Action.safeParse({ type: "chat", text: "x".repeat(281) }).success).toBe(false);
    expect(Action.safeParse({ type: "chat", text: "   " }).success).toBe(false);
  });
});

describe("ClientMessage", () => {
  it("parses hello and action envelopes", () => {
    expect(
      ClientMessage.safeParse({ type: "hello", v: 1, name: "Wren", kind: "agent" }).success,
    ).toBe(true);
    expect(
      ClientMessage.safeParse({ type: "action", id: "a1", action: { type: "claim" } }).success,
    ).toBe(true);
    expect(
      ClientMessage.safeParse({ type: "action", action: { type: "claim", extra: 1 } }).success,
    ).toBe(true);
    expect(ClientMessage.safeParse({ type: "nope" }).success).toBe(false);
  });
});

describe("OpenAPI", () => {
  it("builds a document that covers every REST path", () => {
    const doc = buildOpenApi();
    expect(Object.keys(doc.paths).sort()).toEqual(
      ["/v1/actions", "/v1/health", "/v1/session", "/v1/skill", "/v1/world"].sort(),
    );
    expect(JSON.stringify(doc)).toContain('"place"');
  });
});

describe("SKILL.md starter home", () => {
  it("builds on the default world exactly as written", () => {
    expect(skill).toContain(
      "stand at (19, 11), build the outline of (17, 9) to (21, 13), leave (19, 13) open",
    );
    const world = createWorld(DEFAULT_CONFIG);
    const act = (command: Command) => {
      const result = apply(world, { actor: "muse", command });
      expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
    };
    act({ type: "join", name: "Wren", kind: "agent" });

    // Walk from spawn to the center of the hut on plot (2, 1), then claim.
    const S = DEFAULT_CONFIG.plotSize;
    const [x0, y0] = [2 * S + 1, 1 * S + 1];
    const spawn = spawnTile(DEFAULT_CONFIG);
    for (let x = spawn.x; x > x0 + 2; x--) act({ type: "move", dir: "w" });
    for (let y = spawn.y; y > y0 + 2; y--) act({ type: "move", dir: "n" });
    act({ type: "claim" });

    let placed = 0;
    for (let x = x0; x <= x0 + 4; x++) {
      for (let y = y0; y <= y0 + 4; y++) {
        const edge = x === x0 || x === x0 + 4 || y === y0 || y === y0 + 4;
        const door = x === x0 + 2 && y === y0 + 4;
        if (edge && !door) {
          act({ type: "place", x, y, block: "wood" });
          placed++;
        }
      }
    }
    expect(placed).toBe(15);
    act({ type: "set_hearth", x: x0 + 2, y: y0 + 2 });
    act({ type: "move", dir: "s" });
    act({ type: "move", dir: "s" });
    expect(world.residents.muse).toMatchObject({ x: x0 + 2, y: y0 + 4 });
    act({ type: "home" });
    expect(world.residents.muse).toMatchObject({ x: x0 + 2, y: y0 + 2 });
  });
});

describe("WorldSnapshot time anchor", () => {
  const base = {
    v: 1,
    seq: 0,
    hash: "x",
    config: { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 },
    commons: { px: 1, py: 1 },
    residents: [],
    plots: [],
    blocks: [],
  };

  it("requires the time anchor and rejects a non-positive day length", () => {
    const good = { ...base, time: { nowMs: 1_700_000_000_000, dayLengthMs: 600_000 } };
    expect(WorldSnapshot.safeParse(good).success).toBe(true);
    const { time, ...noTime } = good;
    expect(WorldSnapshot.safeParse(noTime).success).toBe(false);
    expect(WorldSnapshot.safeParse({ ...good, time: { nowMs: 1, dayLengthMs: 0 } }).success).toBe(
      false,
    );
  });
});
