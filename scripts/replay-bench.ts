/**
 * Replay cost at boot (RFC 0014). Builds a synthetic world log shaped like scheduled agent
 * check-ins, then measures what `WorldService` pays on every cold start: reading the rows, parsing
 * them, and replaying them through the real sim. Also measures what a snapshot of the final state
 * would cost to write, load, and verify.
 *
 *   node scripts/replay-bench.ts [--inputs 100000,1000000,5000000] [--agents 1000] [--batch 50] [--planner]
 *
 *   --inputs  log lengths to measure, comma-separated; each runs in its own Node process
 *   --agents  agents checking in (default 1000)
 *   --batch   agents online at once: each check-in round joins this many, putters each, then
 *             leaves them (default 50, about how many of 1,000 agents on a 3.5 hour schedule
 *             overlap inside the 10 minute idle timeout)
 *   --planner use the real `planPutter` for every putter's steps. It costs about 0.4 ms a call with
 *             1,000 residents, so 5M inputs take over half an hour to generate. Without it, each
 *             putter walks `PUTTER_MAX_STEPS` tiles out and back, which the sim checks the same way
 *             and which is the most a logged putter can cost to replay.
 *
 * The log opens a day, coins, items, gifts, plot pickups, the shop, the market, and bounties the
 * way the server's `tick()` does, then plays days of check-ins: every agent checks in 7 times a
 * day, and each check-in logs `join`, a `putter`, and `leave`. Every input is accepted by the sim as it is generated, so the log is one the server
 * could have written.
 *
 * Memory is the V8 heap after a forced GC, so it needs `--expose-gc`; the parent process passes it
 * to each child. A Durable Object has 128 MB per isolate for everything, so the numbers to watch
 * are "rows + parsed log" (what `SqlStore.loadLog()` holds at once) and the state on its own.
 */
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { parseArgs } from "node:util";

// The sim imports its own files without extensions, which Node does not resolve. Same hook as gen.ts.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) throw err;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});

import type { Command, Direction, Input, WorldState } from "../packages/sim/src/index.ts";

const {
  apply,
  canonicalJson,
  createWorld,
  DEFAULT_CONFIG,
  ECONOMY,
  hashWorld,
  inBounds,
  isSolid,
  PUTTER_MAX_STEPS,
  planPutter,
  STEP,
  TOWN_ACTOR,
} = await import("../packages/sim/src/index.ts");

const { values: args } = parseArgs({
  options: {
    inputs: { type: "string", default: "100000,1000000,5000000" },
    agents: { type: "string", default: "1000" },
    batch: { type: "string", default: "50" },
    planner: { type: "boolean", default: false },
    child: { type: "boolean", default: false },
  },
});

const AGENTS = Number(args.agents);
const BATCH = Number(args.batch);
const PLANNER = args.planner === true;
const CHECKINS_PER_DAY = 7;
/** A UTC day number near today, so `new_day` looks like the live log's. */
const FIRST_DAY = 20_366;

const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;
const ms = (t: number) => `${t.toFixed(0)} ms`;

function heap(): number {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error("Run with --expose-gc (the parent process does this for you).");
  gc();
  gc();
  return process.memoryUsage().heapUsed;
}

function time<T>(f: () => T): [T, number] {
  const t0 = performance.now();
  const out = f();
  return [out, performance.now() - t0];
}

/** Ids shaped like the server's (`r_` and 16 hex digits). */
const agentId = (i: number) => `r_${i.toString(16).padStart(16, "0")}`;

const BACK: Record<Direction, Direction> = {
  n: "s",
  s: "n",
  e: "w",
  w: "e",
  ne: "sw",
  sw: "ne",
  nw: "se",
  se: "nw",
};

/**
 * A putter of `PUTTER_MAX_STEPS` tiles: half out in the first open direction (turned by `seq`, so
 * agents don't all go the same way) and the same way back. Empty if no direction is open.
 */
function outAndBack(state: WorldState, id: string): Direction[] {
  const me = state.residents[id];
  if (!me) return [];
  const half = Math.floor(PUTTER_MAX_STEPS / 2);
  const dirs: Direction[] = ["n", "e", "s", "w"];
  for (let turn = 0; turn < dirs.length; turn++) {
    const dir = dirs[(state.seq + turn) % dirs.length] as Direction;
    const [dx, dy] = STEP[dir];
    let open = true;
    for (let k = 1; k <= half && open; k++) {
      const x = me.x + dx * k;
      const y = me.y + dy * k;
      open = inBounds(state.config, x, y) && !isSolid(state, x, y);
    }
    if (open) return [...Array(half).fill(dir), ...Array(half).fill(BACK[dir])];
  }
  return [];
}

/** A log of exactly `total` accepted inputs, as the JSON text rows `world_log` would hold. */
function generate(total: number): { rows: string[]; hash: string; days: number; skipped: number } {
  const state: WorldState = createWorld(DEFAULT_CONFIG);
  const rows: string[] = [];
  let skipped = 0;
  const push = (actor: string, command: Command): boolean => {
    if (rows.length >= total) return false;
    const input: Input = { actor, command };
    const result = apply(state, input);
    if (!result.ok)
      throw new Error(`${command.type} by ${actor} refused: ${result.rejection.code}`);
    rows.push(JSON.stringify(input));
    return true;
  };

  let day = FIRST_DAY;
  push(TOWN_ACTOR, { type: "new_day", day });
  for (const type of [
    "open_economy",
    "open_items",
    "open_gifts",
    "own_plot_pickups",
    "open_shop",
    "open_market",
    "open_bounties",
  ] as const) {
    push(TOWN_ACTOR, { type });
  }

  let days = 0;
  while (rows.length < total) {
    if (days > 0) push(TOWN_ACTOR, { type: "new_day", day: ++day });
    days++;
    for (let round = 0; round < CHECKINS_PER_DAY && rows.length < total; round++) {
      for (let start = 0; start < AGENTS && rows.length < total; start += BATCH) {
        const ids: string[] = [];
        for (let i = start; i < Math.min(start + BATCH, AGENTS); i++) ids.push(agentId(i));
        for (const id of ids)
          push(id, { type: "join", name: `Agent ${id.slice(-4)}`, kind: "agent" });
        for (const id of ids) {
          const steps = PLANNER ? planPutter(state, id) : outAndBack(state, id);
          if (steps.length === 0) skipped++;
          else push(id, { type: "putter", steps });
        }
        for (const id of ids) {
          if (state.residents[id]?.online) push(id, { type: "leave" });
        }
      }
    }
  }
  return { rows, hash: hashWorld(state), days, skipped };
}

function measure(total: number) {
  const base = heap();
  const [{ rows, hash, days, skipped }, genMs] = time(() => generate(total));
  const rowBytes = rows.reduce((n, r) => n + r.length, 0);
  const withRows = heap();

  // What SqlStore.loadLog() does: parse every row, holding the text and the objects at once.
  const [log, parseMs] = time(() => rows.map((r) => JSON.parse(r) as Input));
  const withParsed = heap();

  const [state, replayMs] = time(() => {
    const s = createWorld(DEFAULT_CONFIG);
    for (const [i, input] of log.entries()) {
      const r = apply(s, input);
      if (!r.ok) throw new Error(`Replay diverged at entry ${i}: ${r.rejection.code}`);
    }
    return s;
  });
  const withState = heap();
  const [replayHash, hashMs] = time(() => hashWorld(state));
  if (replayHash !== hash) throw new Error(`Replay hash ${replayHash} != generated ${hash}`);

  // The same replay without holding the parsed log: parse a row, apply it, drop it. A Durable
  // Object's SQL cursor can feed rows one at a time, so only the state stays in memory.
  const [streamed, streamMs] = time(() => {
    const s = createWorld(DEFAULT_CONFIG);
    for (const row of rows) {
      const r = apply(s, JSON.parse(row) as Input);
      if (!r.ok) throw new Error(`Streamed replay diverged at seq ${s.seq + 1}`);
    }
    return s;
  });
  if (hashWorld(streamed) !== hash) throw new Error("Streamed replay hash differs");

  // WorldService's constructor walks the log a second time for join days, karma credits, the
  // command kinds each resident has done, and today's putters. This is the same shape of pass.
  const [, scanMs] = time(() => {
    const joined = new Map<string, number>();
    const done = new Map<string, Set<string>>();
    let d = 0;
    for (const { actor, command } of log) {
      if (command.type === "new_day") d = command.day;
      if (command.type === "join" && !joined.has(actor)) joined.set(actor, d);
      const kinds = done.get(actor);
      if (kinds) kinds.add(command.type);
      else done.set(actor, new Set([command.type]));
    }
    return done.size;
  });

  // The snapshot path: write the state, read it back, verify it against the logged hash.
  const [snapshot, writeMs] = time(() => canonicalJson(state));
  rows.length = 0;
  log.length = 0;
  const stateOnly = heap();
  const [loaded, loadMs] = time(() => JSON.parse(snapshot) as WorldState);
  const [loadedHash, verifyMs] = time(() => hashWorld(loaded));
  if (loadedHash !== hash) throw new Error(`Snapshot hash ${loadedHash} != ${hash}`);

  // These agents never settle, so they have no hearth, allowance, or ledger, and the state above
  // is lean. A grown world has a full ledger per active resident (ECONOMY.ledgerMax lines), which
  // is most of a snapshot's size. Pad a copy that way to size a realistic snapshot.
  const fat = structuredClone(state);
  const econ = fat.economy;
  if (econ) {
    for (const id of Object.keys(fat.residents)) {
      econ.coins[id] = 240;
      econ.allowance[id] = { day: fat.day ?? 0, streak: 30 };
      econ.ledgers[id] = Array.from({ length: ECONOMY.ledgerMax }, (_, k) => ({
        seq: fat.seq - k * 1000,
        day: (fat.day ?? 0) - k,
        amount: 5,
        reason: "allowance" as const,
      }));
    }
  }
  const [fatSnapshot, fatWriteMs] = time(() => canonicalJson(fat));
  const [fatLoaded, fatLoadMs] = time(() => JSON.parse(fatSnapshot) as WorldState);
  const [, fatVerifyMs] = time(() => hashWorld(fatLoaded));

  return {
    inputs: total,
    days,
    skippedPutters: skipped,
    residents: Object.keys(state.residents).length,
    hash,
    generateMs: genMs,
    rowBytes,
    heapRows: withRows - base,
    heapRowsAndParsed: withParsed - base,
    heapPeak: withState - base,
    heapState: stateOnly - base,
    parseMs,
    replayMs,
    scanMs,
    hashMs,
    replayUsPerInput: (replayMs * 1000) / total,
    snapshotBytes: snapshot.length,
    snapshotWriteMs: writeMs,
    snapshotLoadMs: loadMs,
    snapshotVerifyMs: verifyMs,
    streamMs,
    fatSnapshotBytes: fatSnapshot.length,
    fatWriteMs,
    fatLoadMs,
    fatVerifyMs,
    maxRss: process.resourceUsage().maxRSS * 1024,
  };
}

type Result = ReturnType<typeof measure>;

if (args.child) {
  const total = Number(args.inputs);
  process.stdout.write(`${JSON.stringify(measure(total))}\n`);
} else {
  const sizes = args.inputs.split(",").map(Number);
  const results: Result[] = [];
  for (const total of sizes) {
    process.stderr.write(`measuring ${total.toLocaleString("en-US")} inputs...\n`);
    const run = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        "--max-old-space-size=16384",
        import.meta.filename,
        "--child",
        "--inputs",
        String(total),
        "--agents",
        String(AGENTS),
        "--batch",
        String(BATCH),
        ...(PLANNER ? ["--planner"] : []),
      ],
      { encoding: "utf8", maxBuffer: 16 * MB },
    );
    if (run.status !== 0) throw new Error(`child for ${total} failed:\n${run.stderr}`);
    results.push(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}") as Result);
  }

  const walks = PLANNER ? "planPutter walks" : `${PUTTER_MAX_STEPS}-step walks`;
  console.log(`Node ${process.version}, ${AGENTS} agents, ${BATCH} online at once, ${walks}\n`);
  const row = (label: string, f: (r: Result) => string) =>
    console.log(`${label.padEnd(34)}${results.map((r) => f(r).padStart(14)).join("")}`);
  row("inputs", (r) => r.inputs.toLocaleString("en-US"));
  row("days of check-ins", (r) => String(r.days));
  row("residents", (r) => String(r.residents));
  row("putters with nowhere to go", (r) => String(r.skippedPutters));
  row("log text (world_log rows)", (r) => mb(r.rowBytes));
  row("heap: rows", (r) => mb(r.heapRows));
  row("heap: rows + parsed log", (r) => mb(r.heapRowsAndParsed));
  row("heap: rows + parsed + state", (r) => mb(r.heapPeak));
  row("heap: state alone", (r) => mb(r.heapState));
  row("max RSS (includes generation)", (r) => mb(r.maxRss));
  row("parse rows", (r) => ms(r.parseMs));
  row("replay", (r) => ms(r.replayMs));
  row("replay per input", (r) => `${r.replayUsPerInput.toFixed(2)} us`);
  row("second log pass (server scan)", (r) => ms(r.scanMs));
  row("hashWorld", (r) => ms(r.hashMs));
  row("boot today (parse+replay+scan)", (r) => ms(r.parseMs + r.replayMs + r.scanMs));
  row("streamed replay (parse+apply/row)", (r) => ms(r.streamMs));
  row("snapshot size", (r) => mb(r.snapshotBytes));
  row("snapshot write (canonicalJson)", (r) => ms(r.snapshotWriteMs));
  row("snapshot load (JSON.parse)", (r) => ms(r.snapshotLoadMs));
  row("snapshot verify (hashWorld)", (r) => ms(r.snapshotVerifyMs));
  row("padded snapshot size (full ledgers)", (r) => mb(r.fatSnapshotBytes));
  row("padded snapshot write", (r) => ms(r.fatWriteMs));
  row("padded snapshot load", (r) => ms(r.fatLoadMs));
  row("padded snapshot verify", (r) => ms(r.fatVerifyMs));
  row("generate (live apply)", (r) => ms(r.generateMs));
}
