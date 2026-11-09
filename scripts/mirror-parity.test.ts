/**
 * The client's mirror against the server's snapshot, over every sim fixture log. For each input, a
 * Mirror built from the world snapshot before it, with the input's events applied as the server
 * sends them (`toWire`), must hold what a Mirror built from the snapshot after it holds. A case in
 * `Mirror.apply` that drops a field, or a snapshot field no event keeps up to date, fails here.
 *
 * It lives in `scripts/` because it needs both sides: the wire shaping and the snapshot are the
 * server's, the mirror is the client's, and neither package may import the other.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Mirror } from "../packages/client/src/mirror";
import { toWire, worldSnapshot } from "../packages/server/src/world-wire";
import {
  apply,
  createWorld,
  type Input,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldState,
} from "../packages/sim/src/index";

const FIXTURES = new URL("../packages/sim/src/fixtures/", import.meta.url);

/**
 * A few inputs past the end of a fixture, for events no fixture logs (`taken_off`, `roof_top_set`,
 * `gallery_set`, `admired`, `way_pickups_opened`).
 */
const MORE: Record<string, Input[]> = {
  SURFACES_LOG: [
    { actor: "dee", command: { type: "take_off", x: 10, y: 3 } },
    { actor: TOWN_ACTOR, command: { type: "open_way_pickups" } },
  ],
  ROOF_LOG: [
    // The same roof with something on its ridge, then bare again.
    {
      actor: "dee",
      command: { type: "set_roof", px: 1, py: 0, style: "pitched", material: "wood", top: "vane" },
    },
    {
      actor: "dee",
      command: { type: "set_roof", px: 1, py: 0, style: "pitched", material: "wood" },
    },
    { actor: "dee", command: { type: "set_gallery", px: 1, py: 0, open: true } },
  ],
  KILN_LOG: [{ actor: "bob", command: { type: "admire", x: 3, y: 2 } }],
};

/** Every `X_LOG` with its `X_CONFIG`, by fixture file. */
const fixtures: { name: string; config: WorldConfig; log: readonly Input[] }[] = [];
for (const file of readdirSync(fileURLToPath(FIXTURES)).sort()) {
  if (!file.endsWith("-log.ts")) continue;
  const mod = (await import(new URL(file, FIXTURES).href)) as Record<string, unknown>;
  for (const [name, log] of Object.entries(mod)) {
    if (!name.endsWith("_LOG")) continue;
    const config = mod[`${name.slice(0, -"_LOG".length)}_CONFIG`] as WorldConfig | undefined;
    if (config) fixtures.push({ name, config, log: [...(log as Input[]), ...(MORE[name] ?? [])] });
  }
}

/**
 * What the server keeps in memory and the snapshot reads, never logged: nobody faces anywhere, no
 * routine stepped, no note held back, no repeat joins. The same on both sides, so they compare.
 */
const snapshotOf = (state: WorldState) =>
  worldSnapshot(state, {
    nowMs: 0,
    hash: "",
    facing: new Map(),
    routineSteps: new Map(),
    noteHidden: () => false,
    repeatJoins: [],
  });

/**
 * Mirror fields left out of the comparison: `walkable` is a cache built on first read,
 * `groundRev` counts events by design, `facing` comes from the server's memory (empty in these
 * snapshots) and `moved`, and `seq` moves only when an input had events.
 */
const NOT_STATE = new Set(["walkable", "groundRev", "facing", "seq"]);

const isEmpty = (v: unknown): boolean =>
  v === undefined ||
  ((v instanceof Map || v instanceof Set) && v.size === 0) ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && v !== null && !(v instanceof Map) && Object.values(v).every(isEmpty));

/**
 * A value as plain data in a fixed order. A map entry that holds nothing is left out, since the
 * mirror makes some layers lazily and leaves them empty when the last thing on them goes.
 */
function plain(v: unknown): unknown {
  if (v instanceof Map) {
    return Object.fromEntries(
      [...v.entries()]
        .filter(([, x]) => !isEmpty(x))
        .map(([k, x]) => [String(k), plain(x)] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  if (v instanceof Set) return [...v].map((x) => JSON.stringify(plain(x))).sort();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => [k, plain(o[k])]),
    );
  }
  return v;
}

/** The mirror's fields as plain data, by name. */
function fieldsOf(m: Mirror): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(m)) {
    if (!NOT_STATE.has(k)) out.set(k, JSON.stringify(plain(v)));
  }
  return out;
}

/**
 * Mismatches the test knows about, as `command: field`, each with what is wrong. Remove a line
 * when its gap is fixed; a line nothing hits any more fails the test, so the table stays true.
 */
const KNOWN_GAPS: Record<string, string> = {
  // `toWire` keeps `page_edition_set` off the wire, so a live mirror keeps drawing the old
  // edition's recipe pages on the ground until something makes it load a snapshot.
  "set_page_edition: pageEdition": "page_edition_set never reaches the mirror",
};

describe("the mirror keeps up with the snapshot", () => {
  const hit = new Set<string>();
  const checked = new Set<string>();

  it.each(fixtures.map((f) => [f.name, f] as const))("%s", (_, { name, config, log }) => {
    const state = createWorld(config);
    let before = snapshotOf(state);
    const found = new Set<string>();
    for (const [index, input] of log.entries()) {
      const result = apply(state, input);
      if (!result.ok) throw new Error(`${name} refused entry ${index}: ${result.rejection.code}`);
      const after = snapshotOf(state);
      // A log built on another repeats its inputs; each prefix only needs checking once.
      const key = `${JSON.stringify(config)}|${JSON.stringify(log.slice(0, index + 1))}`;
      if (!checked.has(key)) {
        checked.add(key);
        const mirror = new Mirror(before, () => 0);
        const wire = toWire(result.events, state.townsfolk ?? []);
        // A gap (`world_regridded` answers one) makes the client load the snapshot after.
        const reloads = wire
          .map((event) => mirror.apply({ seq: result.seq, event }))
          .includes("gap");
        const got = fieldsOf(mirror);
        const want = fieldsOf(new Mirror(after, () => 0));
        for (const field of reloads ? [] : new Set([...got.keys(), ...want.keys()])) {
          if (got.get(field) === want.get(field)) continue;
          const gap = `${input.command.type}: ${field}`;
          hit.add(gap);
          if (!(gap in KNOWN_GAPS)) {
            found.add(`${gap} (entry ${index}, events ${wire.map((e) => e.type).join(", ")})`);
          }
        }
      }
      before = after;
    }
    expect([...found]).toEqual([]);
  });

  it("lists only gaps that still happen", () => {
    expect(Object.keys(KNOWN_GAPS).filter((gap) => !hit.has(gap))).toEqual([]);
  });
});
