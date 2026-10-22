/**
 * The nightly check that every claimed plot has a way out (decision 0351). It reads the live
 * world from the public `GET /v1/world`, no token, and walks every claimed plot with the sim's own
 * `landlockedFrom`: its own tiles from its hearth, then one step off it onto a tile nobody has
 * claimed. It prints each landlocked plot and how many there are.
 *
 *   node --import ./scripts/resolve-ts.mjs scripts/landlocked.ts [--base https://terrakin.org]
 *                                                                [--out landlocked.md]
 *
 * `--out` writes the body of the issue the nightly workflow opens or updates, and in GitHub
 * Actions the count goes to `$GITHUB_OUTPUT` as `count`. Read-only: one GET. It names plots by
 * their coordinates and owners by their ids, never anything a resident wrote, since the body goes
 * into a public issue.
 *
 * Exit codes: 0 it ran (whatever it found), 2 it couldn't read the world.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  type BlockKind,
  blocksWalkers,
  groundOf,
  joinedWays,
  type Landlocked,
  landlockedFrom,
  type OpeningFacts,
  plotKey,
  seaFrom,
  type Tile,
  tileKey,
  type WorldConfig,
} from "../packages/sim/src/index.ts";

/** The parts of `GET /v1/world` the check reads. */
export interface WorldRead {
  config: WorldConfig;
  plots: { px: number; py: number; ownerId: string }[];
  blocks: { x: number; y: number; block: BlockKind; floor?: number }[];
  residents: { hearth?: Tile }[];
  solidBuildings?: boolean;
  townHall: Tile[];
  shop?: Tile[];
  /** Public ways (RFC 0046): a step onto one is a way out, whoever's plot it is on. */
  ways?: Tile[];
  lands?: {
    home: { width: number; height: number };
    list: {
      plots: { px: number; py: number }[];
      bridge: Tile[];
      square: { px: number; py: number };
      streets?: { px: number; py: number }[];
    }[];
  };
}

/** The sim's opening facts from the snapshot: the ground floor's blocks, the sea, the buildings. */
export function factsOf(world: WorldRead): OpeningFacts {
  const solid = new Set(
    world.blocks
      .filter((b) => (b.floor ?? 0) === 0 && blocksWalkers(b.block))
      .map((b) => tileKey(b.x, b.y)),
  );
  const lands = world.lands && {
    home: world.lands.home,
    list: world.lands.list.map((l) => ({
      plots: l.plots.map((p) => [p.px, p.py] as const),
      bridge: l.bridge.map((t) => [t.x, t.y] as const),
      square: [l.square.px, l.square.py] as const,
      streets: (l.streets ?? []).map((p) => [p.px, p.py] as const),
    })),
  };
  const sea = seaFrom(world.config, lands);
  const claimed = new Set(world.plots.map((p) => plotKey(p.px, p.py)));
  const ways = new Set((world.ways ?? []).map((t) => tileKey(t.x, t.y)));
  const downtown = world.lands?.home ?? world.config;
  const commons = {
    px: Math.floor(downtown.width / world.config.plotSize / 2),
    py: Math.floor(downtown.height / world.config.plotSize / 2),
  };
  const facts: OpeningFacts = {
    ground: groundOf({
      config: world.config,
      hasBlock: (x, y) => solid.has(tileKey(x, y)),
      solidBuildings: world.solidBuildings === true,
      townHall: world.townHall,
      shop: world.shop ?? [],
      ...(sea ? { sea } : {}),
    }),
    claimed: (px, py) => claimed.has(plotKey(px, py)),
  };
  if (ways.size === 0) return facts;
  // A way counts only where it joins the Commons, as the sim's own `openingFacts` reads it.
  return { ...facts, way: joinedWays(facts, (x, y) => ways.has(tileKey(x, y)), commons) };
}

/** Every landlocked plot in the world the snapshot shows, north to south, then west to east. */
export function landlockedIn(world: WorldRead): Landlocked[] {
  const hearths = world.residents.flatMap((r) => (r.hearth ? [r.hearth] : []));
  return landlockedFrom(factsOf(world), world.plots, hearths);
}

/** The issue's body: the count, then a line per plot with a link that looks at it in the world. */
export function issueBody(found: readonly Landlocked[], claimed: number, base: string): string {
  const count = (why: Landlocked["why"]) => found.filter((p) => p.why === why).length;
  const lines = [
    `${found.length} of ${claimed} claimed plots have no way out onto open ground: no walk from the hearth, on the plot's own tiles, reaches a step off it onto a tile nobody has claimed. Each reaches the town only across a neighbor's yard, if at all (decision 0351).`,
    "",
    `${count("surrounded")} are surrounded: every tile around them is someone's plot, water, or the world's edge. ${count("walled")} are walled: open ground touches them, but blocks, or water at a corner, keep every walk off it.`,
    "",
    ...found.map(
      (p) =>
        `- Plot (${p.px}, ${p.py}), ${p.why}, owner \`${p.ownerId}\`: ${base}/world?at=${p.px},${p.py}`,
    ),
    "",
    "This issue is updated by the nightly run (nightly.yml) and closed by the first night with none.",
  ];
  return lines.join("\n");
}

/** One line per landlocked plot, for the run's own output. */
export function summary(found: readonly Landlocked[], claimed: number): string[] {
  return [
    `${found.length} of ${claimed} claimed plots are landlocked.`,
    ...found.map((p) => `  (${p.px}, ${p.py}) ${p.why} ${p.ownerId}`),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "https://terrakin.org" },
      out: { type: "string" },
    },
  });
  const base = values.base.replace(/\/$/, "");
  let world: WorldRead;
  try {
    const res = await fetch(`${base}/v1/world`);
    if (!res.ok) throw new Error(`GET /v1/world answered ${res.status}`);
    world = (await res.json()) as WorldRead;
  } catch (err) {
    console.error(`Couldn't read the world: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const found = landlockedIn(world);
  for (const line of summary(found, world.plots.length)) console.log(line);
  if (values.out) writeFileSync(values.out, `${issueBody(found, world.plots.length, base)}\n`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `count=${found.length}\n`);
}
