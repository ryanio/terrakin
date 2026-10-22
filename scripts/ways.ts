/**
 * Downtown's public ways as a dry run ([RFC 0046](../docs/rfcs/0046-streets.md), Option 1). It reads
 * the live world from the public `GET /v1/world`, no token, plans the network that joins every
 * claimed plot and the bridge landing to the Commons with the server's own `planWays`, and prints
 * it: the tiles on each plot, the blocks the town would clear and give back, the homes it would
 * rebuild, and who would hear about it.
 *
 *   node --import ./scripts/resolve-ts.mjs scripts/ways.ts [--base https://terrakin.org]
 *                                                          [--file world.json] [--keep-free] [--json]
 *
 * Read-only: one GET, or none with `--file`. Applying a plan is the staff route
 * `POST /v1/admin/ways` (maintainers only), never this script. It names plots by their coordinates
 * and owners by their ids, never anything a resident wrote.
 *
 * Exit codes: 0 it ran, 2 it couldn't read the world.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  planWays,
  type WayFacts,
  type WayPlan,
  wayLanding,
} from "../packages/server/src/way-plan.ts";
import {
  type BlockKind,
  openingFactsFrom,
  plotKey,
  type Tile,
  tileKey,
  walkTree,
} from "../packages/sim/src/index.ts";
import { landlockedIn, type WorldRead } from "./landlocked.ts";

/** The parts of `GET /v1/world` the plan reads, beyond what the landlocked check does. */
export interface WaysRead extends WorldRead {
  plots: { px: number; py: number; ownerId: string; floors?: number }[];
  townsfolk?: string[];
  townsfolkResidents?: { hearth?: Tile }[];
  crops?: Tile[];
  displays?: Tile[];
  /** Paths and flooring, the floors above with `floor`. */
  ground?: (Tile & { floor?: number })[];
  /**
   * Plots for sale. The snapshot doesn't carry listings (the plot market is dark), so the dry run
   * reads none and the staff route, which reads the world, is what routes around them.
   */
  listed?: { px: number; py: number }[];
}

/** The planner's facts from the snapshot. */
export function wayFactsOf(world: WaysRead): WayFacts {
  const blocks = new Map<string, BlockKind>();
  for (const b of world.blocks) if ((b.floor ?? 0) === 0) blocks.set(tileKey(b.x, b.y), b.block);
  const downtown = world.lands?.home ?? { width: world.config.width, height: world.config.height };
  const hearths = [...world.residents, ...(world.townsfolkResidents ?? [])].flatMap((r) =>
    r.hearth ? [r.hearth] : [],
  );
  return {
    config: world.config,
    openings: openingFactsFrom(world),
    downtown,
    commons: world.commons,
    plots: world.plots,
    townsfolk: new Set(world.townsfolk ?? []),
    hearths,
    blocks,
    fixed: new Set(
      [...(world.crops ?? []), ...(world.displays ?? [])].map((t) => tileKey(t.x, t.y)),
    ),
    upstairs: new Set(
      [...world.blocks, ...(world.ground ?? [])]
        .filter((t) => (t.floor ?? 0) > 0)
        .map((t) => tileKey(t.x, t.y)),
    ),
    listed: new Set((world.listed ?? []).map((p) => plotKey(p.px, p.py))),
    ways: new Set((world.ways ?? []).map((t) => tileKey(t.x, t.y))),
    landing: wayLanding(world.config, downtown, world.commons),
  };
}

/**
 * The world as the plan would leave it, as far as the snapshot can say: the blocks on way tiles
 * gone, the rebuilt homes' blocks up, and the ways laid. The sim checks the real inputs when the
 * staff route lays them; this is for reading the plan's effect on ways out.
 */
export function afterPlan(world: WaysRead, plan: WayPlan): WaysRead {
  const gone = new Set(plan.blocks.map((b) => tileKey(b.x, b.y)));
  const blocks = world.blocks.filter((b) => (b.floor ?? 0) !== 0 || !gone.has(tileKey(b.x, b.y)));
  for (const h of plan.homes)
    for (const b of h.rebuild) blocks.push({ x: b.x, y: b.y, block: b.block });
  return { ...world, blocks, ways: [...(world.ways ?? []), ...plan.tiles] };
}

/**
 * How many hearths walk to the Commons in the world the snapshot shows, over the sim's own step
 * rule: the count the staff route refuses a plan for lowering (`walled_in`).
 */
export function hearthsWalking(world: WaysRead): number {
  const { ground } = openingFactsFrom(world);
  const S = world.config.plotSize;
  const radius = Math.max(world.config.width, world.config.height);
  const hearths = [...world.residents, ...(world.townsfolkResidents ?? [])].flatMap((r) =>
    r.hearth ? [r.hearth] : [],
  );
  return hearths.filter((h) =>
    walkTree(ground, h, radius).some(
      (n) => Math.floor(n.x / S) === world.commons.px && Math.floor(n.y / S) === world.commons.py,
    ),
  ).length;
}

/** The plan in lines: totals, then each plot's tiles, the blocks, the homes, and who hears. */
export function planLines(
  plan: WayPlan,
  claimed: number,
  before?: number,
  after?: number,
  walking?: [number, number],
): string[] {
  const residents = plan.plots.filter((p) => !p.townsfolk);
  const townsfolk = plan.plots.filter((p) => p.townsfolk);
  const count = (rows: WayPlan["plots"]) => rows.reduce((n, p) => n + p.tiles.length, 0);
  const most = Math.max(0, ...residents.map((p) => p.tiles.length));
  const tiles = (list: readonly Tile[]) => list.map((t) => `(${t.x}, ${t.y})`).join(" ");
  return [
    `${plan.tiles.length} way tiles: ${count(residents)} on ${residents.length} residents' plots (at most ${most} from one), ${count(townsfolk)} on ${townsfolk.length} townsfolk plots, ${plan.free.length} on free slots. ${claimed} plots are claimed.`,
    `${plan.blocks.length} blocks to clear and give back, ${plan.homes.length} homes to rebuild, ${new Set(plan.plots.map((p) => p.ownerId)).size} owners to tell.`,
    ...(before !== undefined && after !== undefined
      ? [`Plots with no way out (decision 0351): ${before} now, ${after} once it is laid.`]
      : []),
    ...(walking
      ? [`Hearths that walk to the Commons: ${walking[0]} now, ${walking[1]} once it is laid.`]
      : []),
    ...(plan.unjoined.length > 0
      ? [`Not joined: ${plan.unjoined.map((u) => `${u.target} (${u.why})`).join("; ")}.`]
      : ["Every claimed plot and the bridge landing are joined to the Commons."]),
    "",
    "Tiles by plot:",
    ...plan.plots.map(
      (p) =>
        `  (${p.px}, ${p.py}) ${p.townsfolk ? "townsfolk" : "resident"} ${p.ownerId}: ${p.tiles.length} tiles ${tiles(p.tiles)}`,
    ),
    ...(plan.free.length > 0
      ? [`  free slots: ${plan.free.length} tiles ${tiles(plan.free)}`]
      : []),
    "",
    "Blocks to clear:",
    ...(plan.blocks.length > 0
      ? plan.blocks.map(
          (b) => `  (${b.x}, ${b.y}) ${b.block} on (${b.px}, ${b.py}), back to ${b.ownerId}`,
        )
      : ["  none"]),
    "",
    "Homes to rebuild:",
    ...(plan.homes.length > 0
      ? plan.homes.map(
          (h) =>
            `  (${h.px}, ${h.py}) ${h.ownerId}: ${h.walls.length > 0 ? `walls down at ${tiles(h.walls)}; ` : ""}put up ${h.rebuild.map((b) => `${b.block} (${b.x}, ${b.y})`).join(" ") || "nothing"}${h.left.length > 0 ? `; left open at ${tiles(h.left)}` : ""}`,
        )
      : ["  none"]),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "https://terrakin.org" },
      file: { type: "string" },
      "keep-free": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  let world: WaysRead;
  try {
    if (values.file) world = JSON.parse(readFileSync(values.file, "utf8")) as WaysRead;
    else {
      const res = await fetch(`${values.base.replace(/\/$/, "")}/v1/world`);
      if (!res.ok) throw new Error(`GET /v1/world answered ${res.status}`);
      world = (await res.json()) as WaysRead;
    }
  } catch (err) {
    console.error(`Couldn't read the world: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const plan = planWays(wayFactsOf(world), { layFree: !values["keep-free"] });
  if (values.json) console.log(JSON.stringify(plan, null, 2));
  else {
    const before = landlockedIn(world).length;
    const after = landlockedIn(afterPlan(world, plan)).length;
    const walking: [number, number] = [
      hearthsWalking(world),
      hearthsWalking(afterPlan(world, plan)),
    ];
    for (const line of planLines(plan, world.plots.length, before, after, walking))
      console.log(line);
    console.log(
      "\nNot checked here: whether each owner has room for what comes back (inventories are private), and plots for sale (none are listed while the plot market is dark). The staff route's dry run checks both.",
    );
  }
}
