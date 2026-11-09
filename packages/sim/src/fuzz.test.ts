import { describe, expect, it } from "vitest";
import { BOUNTIES_CONFIG, BOUNTIES_LOG } from "./fixtures/bounties-log";
import { CIRCLES_CONFIG, CIRCLES_LOG } from "./fixtures/circles-log";
import { EDGES_CONFIG, EDGES_LOG } from "./fixtures/edges-log";
import { EVENTS_CONFIG, EVENTS_LOG } from "./fixtures/events-log";
import { FLOORS_CONFIG, FLOORS_LOG } from "./fixtures/floors-log";
import { GAMES_CONFIG, GAMES_LOG } from "./fixtures/games-log";
import { GRADES_CONFIG, GRADES_LOG } from "./fixtures/grades-log";
import { JOBS_CONFIG, JOBS_LOG } from "./fixtures/jobs-log";
import { KILN_CONFIG, KILN_LOG } from "./fixtures/kiln-log";
import { LANDS_CONFIG, LANDS_LOG } from "./fixtures/lands-log";
import { LOTS_CONFIG, LOTS_LOG } from "./fixtures/lots-log";
import { MARKET_CONFIG, MARKET_LOG } from "./fixtures/market-log";
import { PLOT_MARKET_CONFIG, PLOT_MARKET_LOG } from "./fixtures/plot-market-log";
import { REGRID_CONFIG, REGRID_LOG } from "./fixtures/regrid-log";
import { SURFACES_CONFIG, SURFACES_LOG } from "./fixtures/surfaces-log";
import { COMMAND_TYPES, deepen, describeFailure, fuzz, KNOWN_FAILURES } from "./fuzz-support";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import type { CommandType, Input, WorldConfig } from "./types";

/**
 * The seeded fuzz: from the end of a spread of fixture logs, throw generated commands at the
 * rules and check every invariant after each one (`step` in `fuzz-support.ts`), then replay the
 * accepted inputs from the start and expect the same world. The short run is fixed and part of
 * the suite. `pnpm fuzz` runs far more; `FUZZ_SEEDS` (how many), `FUZZ_FIRST` (the first seed),
 * and `FUZZ_STEPS` (inputs per seed) set any run, and `FUZZ_SEED=123` runs one seed alone. A
 * failure names its seed, step, input, and the accepted inputs it still needs on top of its start.
 */

const STARTS: { name: string; config: WorldConfig; log: Input[] }[] = [
  { name: "jobs-log", config: JOBS_CONFIG, log: JOBS_LOG },
  { name: "circles-log", config: CIRCLES_CONFIG, log: CIRCLES_LOG },
  { name: "market-log", config: MARKET_CONFIG, log: MARKET_LOG },
  { name: "lots-log", config: LOTS_CONFIG, log: LOTS_LOG },
  { name: "lands-log", config: LANDS_CONFIG, log: LANDS_LOG },
  { name: "games-log", config: GAMES_CONFIG, log: GAMES_LOG },
  { name: "grades-log", config: GRADES_CONFIG, log: GRADES_LOG },
  { name: "bounties-log", config: BOUNTIES_CONFIG, log: BOUNTIES_LOG },
  { name: "events-log", config: EVENTS_CONFIG, log: EVENTS_LOG },
  { name: "floors-log", config: FLOORS_CONFIG, log: FLOORS_LOG },
  { name: "edges-log", config: EDGES_CONFIG, log: EDGES_LOG },
  { name: "regrid-log", config: REGRID_CONFIG, log: REGRID_LOG },
  { name: "plot-market-log", config: PLOT_MARKET_CONFIG, log: PLOT_MARKET_LOG },
  { name: "kiln-log", config: KILN_CONFIG, log: KILN_LOG },
  { name: "surfaces-log", config: SURFACES_CONFIG, log: SURFACES_LOG },
];

const env = (name: string) => {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? undefined : Number(raw);
};
const one = env("FUZZ_SEED");
const first = env("FUZZ_FIRST") ?? 1;
const SEEDS =
  one !== undefined ? [one] : Array.from({ length: env("FUZZ_SEEDS") ?? 15 }, (_, i) => first + i);
const STEPS = env("FUZZ_STEPS") ?? 160;
// A long run's seeds take longer than the suite's 5 seconds each.
const TIMEOUT = Math.max(5_000, STEPS * 60);

const generated = new Set<CommandType>();
const accepted = new Set<CommandType>();

describe("the seeded fuzz", () => {
  for (const seed of SEEDS) {
    const start = STARTS[seed % STARTS.length] as (typeof STARTS)[number];
    // Even seeds start after `deepen`, with every system open and every resident funded.
    const deep = seed % 2 === 0;
    const name = deep ? `${start.name} then deepen()` : start.name;
    it(
      `keeps every invariant for seed ${seed} from ${name}`,
      () => {
        const world = replay(start.config, start.log);
        const opened = deep ? deepen(world) : [];
        const run = fuzz({
          seed,
          start: world,
          startName: name,
          steps: STEPS,
          known: KNOWN_FAILURES,
        });
        for (const t of run.generated) generated.add(t);
        for (const t of run.acceptedTypes) accepted.add(t);
        const wrong = run.failures.map(describeFailure);
        if (wrong.length === 0) {
          const straight = replay(start.config, [...start.log, ...opened, ...run.accepted]);
          if (hashWorld(straight) !== hashWorld(run.final)) {
            wrong.push(`seed ${seed}: a straight replay of ${run.accepted.length} inputs differs`);
          }
        }
        expect(wrong).toEqual([]);
      },
      TIMEOUT,
    );
  }

  it("draws from every command type and gets most of them accepted", () => {
    if (SEEDS.length < 15) return;
    const missing = COMMAND_TYPES.filter((t) => !generated.has(t));
    const never = COMMAND_TYPES.filter((t) => !accepted.has(t));
    const summary = `${generated.size} of ${COMMAND_TYPES.length} command types generated, ${accepted.size} accepted at least once; never accepted: ${never.join(" ")}`;
    console.log(summary);
    expect(missing, summary).toEqual([]);
    // The short run accepts 83 types; a generator that stops reaching its rule shows here.
    expect(accepted.size, summary).toBeGreaterThanOrEqual(80);
  });
});
