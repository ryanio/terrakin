import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { plotPlan } from "./build";
import { designNotes } from "./design";
import { edgeKey } from "./edges";
import { REGRID_CONFIG, REGRID_HASH, REGRID_LOG } from "./fixtures/regrid-log";
import { baseTile, moveCoord } from "./grid";
import { hashWorld } from "./hash";
import { inLot } from "./lots";
import { plotMap } from "./map";
import { landlocked, openingFacts } from "./openings";
import { regridWorld } from "./regrid";
import { replay } from "./replay";
import { faceKey } from "./surfaces";
import { expectSupplyHolds } from "./test-support";
import { type Input, TOWN_ACTOR, type WorldConfig, type WorldState } from "./types";
import { DIRECTIONS, stepFrom, worldGround } from "./walk";
import { cloneWorld, createWorld, gameTableTiles, spawnTile } from "./world";

type Fixture = { name: string; config: WorldConfig; log: Input[] };

/** Every fixture log in `fixtures/`, as `replay.test.ts` reads them. */
const fixtures: Fixture[] = await Promise.all(
  readdirSync(new URL("./fixtures/", import.meta.url))
    .filter((file) => file.endsWith("-log.ts"))
    .sort()
    .map(async (file) => {
      const mod = (await import(`./fixtures/${file}`)) as Record<string, unknown>;
      const logName = Object.keys(mod).find((key) => key.endsWith("_LOG")) as string;
      const config = mod[logName.replace(/_LOG$/, "_CONFIG")] as WorldConfig;
      return { name: file, config, log: mod[logName] as Input[] };
    }),
);

/** The ground-floor tiles a walk from the spawn tile reaches. */
function reachable(state: WorldState): Set<string> {
  const ground = worldGround(state);
  const start = spawnTile(state);
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.shift() as { x: number; y: number };
    for (const dir of DIRECTIONS) {
      const step = stepFrom(ground, at, dir);
      if (!step.ok) continue;
      const key = `${step.to.x},${step.to.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(step.to);
    }
  }
  return seen;
}

const count = (rec: object | undefined) => Object.keys(rec ?? {}).length;

/** The way tiles that count as open ground: a walk from the Commons reaches them. */
const joinedWays = (s: WorldState) => {
  const facts = openingFacts(s);
  return Object.keys(s.ways ?? {})
    .map((k) => k.split(",").map(Number) as [number, number])
    .filter(([x, y]) => facts.way?.(x, y));
};

/**
 * Every way joined to the Commons before the regrid still is, where it moved, and no plot with an
 * exit before is landlocked after.
 */
function expectExitsKept(before: WorldState, after: WorldState) {
  const joined = new Set(joinedWays(after).map(([x, y]) => `${x},${y}`));
  const lost = joinedWays(before).filter(
    ([x, y]) => !joined.has(`${moveCoord(x, 16)},${moveCoord(y, 16)}`),
  );
  expect(lost).toEqual([]);
  const shut = new Set(landlocked(before).map((p) => `${p.px},${p.py}`));
  expect(landlocked(after).filter((p) => !shut.has(`${p.px},${p.py}`))).toEqual([]);
}

/** How many of each kind of keyed thing a world holds, which a regrid must never change. */
const tally = (s: WorldState) => ({
  blocks: count(s.blocks),
  edges: count(s.edges),
  grades: count(s.grades),
  turns: count(s.turns),
  ground: count(s.ground),
  floors: Object.values(s.floors ?? {}).map((f) => [
    count(f.blocks),
    count(f.ground),
    count(f.edges),
  ]),
  crops: count(s.items?.crops),
  displays: count(s.items?.displays),
  firings: count(s.items?.firings),
  pots: count(s.items?.pots),
  tops: count(s.items?.tops),
  built: count(s.town?.built),
  residents: count(s.residents),
});

/**
 * Every top-level field of a world, sorted by whether the regrid moves it. A new field fails the
 * test below until it's placed here, and, if it holds a tile, moved in `regridWorld`.
 */
const MOVED = [
  "config",
  "residents",
  "blocks",
  "edges",
  "grades",
  "turns",
  "ground",
  "floors",
  "ways",
  "lands",
  "items",
  "town",
  "games",
];
const NO_TILES = [
  "seq",
  "plots",
  "solidBuildings",
  "tableSpotsKept",
  "starterDoors",
  "starterEdges",
  "plotReach",
  "wallsOnLines",
  "lots",
  "regridded",
  "slimmed",
  "homesSlimmed",
  "proposeInPerson",
  "scheduleInPerson",
  "attendAtTen",
  "namedSales",
  "day",
  "townsfolk",
  "lastActiveDay",
  "ownerPairs",
  "ownerPairDays",
  "maintainers",
  "economy",
  "shop",
  "market",
  "plotMarket",
  "recipes",
  "entitlements",
  "bounties",
  "implicitPresence",
  "routines",
  "routineRuns",
  "events",
  "knocks",
  "retiredRepeatJoins",
  "mergedResidents",
  "progress",
  "jobs",
  "circles",
  "awards",
];

describe("regrid (RFC 0052)", () => {
  // Every log of 8-tile plots but the one that regrids already.
  // Every world still on 8-tile plots: a log that regrids already is pinned by its own test.
  it.each(fixtures.filter((f) => !f.log.some((i) => i.command.type === "regrid")))(
    "moves $name onto 16-tile slots and keeps everything",
    ({ config, log }) => {
      const before = replay(config, log);
      const after = cloneWorld(before);
      const given = regridWorld(after);
      expect(after.config.plotSize).toBe(16);
      expect(after.config.width).toBe(before.config.width * 2);

      // Nothing two things shared a key, and nothing was lost, but things hung across a slot border.
      const { ...was } = tally(before);
      expect(tally(after)).toEqual(was);
      const hungGone = count(before.items?.hung) - count(after.items?.hung);
      expect(hungGone).toBeGreaterThanOrEqual(0);
      if (hungGone === 0) expect(given).toEqual([]);
      expectSupplyHolds(after);

      // Everyone stands where they stood, moved: on a tile they can stand on, in their slot's lot.
      const ground = worldGround(after);
      for (const r of Object.values(after.residents)) {
        if ((r.floor ?? 0) !== 0) continue;
        const was0 = before.residents[r.id];
        if (was0 && worldGround(before).obstacle(was0.x, was0.y) === undefined) {
          expect(ground.obstacle(r.x, r.y), `${r.id} at ${r.x},${r.y}`).toBeUndefined();
        }
      }

      // Every hearth a walk from town reached still is reached.
      const r0 = reachable(before);
      const r1 = reachable(after);
      for (const r of Object.values(after.residents)) {
        const h0 = before.residents[r.id]?.hearth;
        if (!h0 || !r.hearth || !r0.has(`${h0.x},${h0.y}`)) continue;
        expect(r1.has(`${r.hearth.x},${r.hearth.y}`), `${r.id}'s hearth`).toBe(true);
        expect(inLot(after, r.hearth.x, r.hearth.y)).toBe(true);
      }

      expectExitsKept(before, after);

      // Every plot reads the same from its lot's corner as it did from its own: its plan, its
      // map, and its notes.
      const differ = Object.values(before.plots).filter(
        ({ px, py }) =>
          JSON.stringify([plotPlan(before, px, py), plotMap(before, px, py)]) !==
            JSON.stringify([plotPlan(after, px, py), plotMap(after, px, py)]) ||
          JSON.stringify(designNotes(before, px, py)) !==
            JSON.stringify(designNotes(after, px, py)),
      );
      expect(differ.map((p) => `${p.px},${p.py}`)).toEqual([]);

      // Open game tables still stand on the Commons' table spots.
      const spots = gameTableTiles(after).map((t) => `${t.x},${t.y}`);
      for (const table of Object.values(after.games?.tables ?? {})) {
        expect(spots).toContain(`${table.place.x},${table.place.y}`);
      }
    },
  );

  it("knows every field a world holds, and moves each one that holds a tile", () => {
    const known = new Set([...MOVED, ...NO_TILES]);
    const unknown = new Set<string>();
    for (const { config, log } of fixtures) {
      for (const key of Object.keys(replay(config, log))) if (!known.has(key)) unknown.add(key);
    }
    expect([...unknown]).toEqual([]);
  });

  it("carries a way across its yard to whatever it stepped onto: the Commons, and a plot whose exit it was", () => {
    // Nine 8-tile slots, the Commons in the middle and every other slot claimed. A way runs down
    // the west column of Bob's plot (1, 0): its south end steps onto the Commons, and it is the only
    // exit of Ada's plot (0, 0), boxed in by Bob and Cy.
    const state = createWorld({
      width: 24,
      height: 24,
      plotSize: 8,
      maxPlotsPerResident: 1,
      reach: 3,
    });
    const slots: [string, number, number][] = [
      ["ada", 0, 0],
      ["bob", 1, 0],
      ["cy", 0, 1],
      ["dee", 2, 0],
      ["eve", 2, 1],
      ["fay", 0, 2],
      ["gus", 1, 2],
      ["hal", 2, 2],
    ];
    for (const [id, px, py] of slots) {
      expect(
        apply(state, { actor: id, command: { type: "join", name: id, kind: "agent" } }).ok,
      ).toBe(true);
      expect(apply(state, { actor: id, command: { type: "settle", px, py } }).ok).toBe(true);
    }
    const tiles = Array.from({ length: 8 }, (_, y) => [8, y] as [number, number]);
    expect(apply(state, { actor: TOWN_ACTOR, command: { type: "open_way", tiles } }).ok).toBe(true);
    expect(joinedWays(state)).toHaveLength(8);
    expect(landlocked(state)).toEqual([]);

    const after = cloneWorld(state);
    expect(apply(after, { actor: TOWN_ACTOR, command: { type: "regrid" } }).ok).toBe(true);
    expectExitsKept(state, after);
  });

  it("reads a yard tile as the nearest tile of its slot's middle, and every tile of smaller plots as itself", () => {
    // Slot (1, 0) of 16 is tiles 16 to 31; its middle 8 is 20 to 27, standing for 8 to 15.
    expect(baseTile({ plotSize: 16 }, 21, 5)).toEqual({ x: 9, y: 1, ring: false });
    expect(baseTile({ plotSize: 16 }, 17, 30)).toEqual({ x: 8, y: 15, ring: true });
    for (const plotSize of [4, 8]) {
      expect(baseTile({ plotSize }, 5, 6)).toEqual({ x: 5, y: 6, ring: false });
    }
  });

  it("keeps a household's border line beside its north or west tile, with what hangs on that face", () => {
    // Ada holds plots (0, 0) and (1, 0); a wood wall stands on the line between (7, 3) and (8, 3),
    // with a mirror hung on each face of it.
    const state = replay(
      REGRID_CONFIG,
      REGRID_LOG.slice(
        0,
        REGRID_LOG.findIndex((i) => i.command.type === "regrid"),
      ),
    );
    state.plots["1,0"] = { px: 1, py: 0, ownerId: "ada" };
    state.edges = { ...state.edges, [edgeKey(8, 3, "w")]: "wood" };
    const mirror = { thing: "mirror", by: "ada", day: state.day ?? 0 } as const;
    const items = state.items;
    if (!items) throw new Error("items aren't open");
    items.hung = { [faceKey(7, 3, "e", 0)]: mirror, [faceKey(8, 3, "w", 0)]: mirror };
    const given = regridWorld(state);
    // (7, 3) moves to (11, 7) and the line to its east side; (8, 3) moves to (20, 7), 8 tiles on.
    expect(state.edges?.[edgeKey(11, 7, "e")]).toBe("wood");
    expect(Object.keys(state.items?.hung ?? {})).toEqual([faceKey(11, 7, "e", 0)]);
    expect(given).toHaveLength(1);
    expectSupplyHolds(state);
  });

  it("comes once, from the town, in a world of 8-tile plots", () => {
    const state = replay(REGRID_CONFIG, REGRID_LOG);
    const again = apply(state, { actor: TOWN_ACTOR, command: { type: "regrid" } });
    expect(again).toMatchObject({ ok: false, rejection: { code: "already_open" } });
  });

  it("refuses building in the wild yard past the lot, and builds in the lot", () => {
    const state = replay(REGRID_CONFIG, REGRID_LOG);
    const ada = state.residents.ada as { x: number; y: number };
    // Ada's plot (0, 0) is tiles 0 to 15 now, its lot 4 to 11.
    const yard = apply(state, {
      actor: "ada",
      command: { type: "place", x: 2, y: 9, block: "planter" },
    });
    expect(yard).toMatchObject({ ok: false, rejection: { code: "outside_lot" } });
    expect(inLot(state, ada.x, ada.y)).toBe(true);
  });

  it("replays the regrid log to its pinned hash", () => {
    expect(hashWorld(replay(REGRID_CONFIG, REGRID_LOG))).toBe(REGRID_HASH);
  });
});
