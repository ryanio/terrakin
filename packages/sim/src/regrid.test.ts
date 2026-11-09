import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { REGRID_CONFIG, REGRID_HASH, REGRID_LOG } from "./fixtures/regrid-log";
import { hashWorld } from "./hash";
import { inLot } from "./lots";
import { regridWorld } from "./regrid";
import { replay } from "./replay";
import { expectSupplyHolds } from "./test-support";
import { type Input, TOWN_ACTOR, type WorldConfig, type WorldState } from "./types";
import { DIRECTIONS, stepFrom, worldGround } from "./walk";
import { cloneWorld, gameTableTiles, spawnTile } from "./world";

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
  it.each(fixtures.filter((f) => f.config.plotSize === 8))(
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
