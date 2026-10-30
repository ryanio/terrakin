/**
 * Make a resident at a stage on a local server, for checking a change by hand or with a browser
 * tool (decision 0147). Start the server with `pnpm dev:test`, which turns on the test routes, then:
 *
 *   pnpm persona settled --name Ivy
 *   pnpm persona stocked --coins 2000 --stacks tomato=10,sugar=6
 *   pnpm persona owner --agent Pip
 *   pnpm persona settled --days 24     (moves the world's clock on first: Halloween, a season)
 *   pnpm persona settled --open-land    (opens the next land, so there's an island to see)
 *   pnpm persona settled --open-plot-market  (puts plots on sale, and a land with it: RFC 0039, off elsewhere)
 *   pnpm persona stocked --open-clay    (puts clay out, so kilns fire pots: RFC 0047, off elsewhere)
 *   pnpm persona stocked --open-grades  (fine and masterwork materials: RFC 0051, off everywhere)
 *   pnpm persona stocked --job bram_chair  (moves the clock on to a day with that job)
 *
 * It prints who it made and a line of JavaScript that signs a browser tab in as them. Presets and
 * the steps are in `e2e/personas.ts`, which the Playwright specs build residents with too. Only
 * for servers on this machine: the test routes answer nothing else.
 */
import { parseArgs } from "node:util";
import {
  fetchHttp,
  isPreset,
  jobDayOver,
  makePersona,
  openClayOver,
  openGradesOver,
  openLandOver,
  openPlotMarketOver,
  type PersonaSpec,
  PRESETS,
  signInScript,
  stage,
} from "../e2e/personas.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    base: { type: "string", default: "http://localhost:8797" },
    coins: { type: "string" },
    stacks: { type: "string" },
    staff: { type: "boolean" },
    agent: { type: "string" },
    kind: { type: "string" },
    days: { type: "string" },
    "open-land": { type: "boolean" },
    "open-plot-market": { type: "boolean" },
    "open-clay": { type: "boolean" },
    "open-grades": { type: "boolean" },
    job: { type: "string" },
    path: { type: "string", default: "/world" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const preset = positionals[0] ?? "settled";
if (values.help || !isPreset(preset)) {
  console.log(`Usage: pnpm persona [${Object.keys(PRESETS).join("|")}] [--name N] [--coins N]
  [--stacks kind=n,kind=n] [--staff] [--agent Name] [--kind human|agent] [--days N]
  [--open-land] [--open-plot-market] [--open-clay] [--open-grades] [--job id] [--path /world] [--base http://localhost:8797] [--json]`);
  process.exit(values.help ? 0 : 2);
}

const base = new URL(values.base);
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
  console.error("persona only talks to a server on this machine.");
  process.exit(2);
}

const stacks = values.stacks
  ? Object.fromEntries(
      values.stacks.split(",").map((pair) => {
        const [kind, n] = pair.split("=");
        return [kind?.trim() ?? "", Number(n ?? 1)];
      }),
    )
  : undefined;
// Names are unique on a server (decision 0148), so a default name carries a number, and so does
// the AI a preset brings along, so a second run on the same dev server still works.
const suffix = Date.now() % 1000;
const name = values.name ?? `${preset[0]?.toUpperCase()}${preset.slice(1)}_${suffix}`;
const presetAgent = (PRESETS[preset] as { agent?: string }).agent;
const agent = values.agent ?? (presetAgent ? `${presetAgent}_${suffix}` : undefined);
const spec: PersonaSpec = {
  name,
  ...(values.coins ? { coins: Number(values.coins) } : {}),
  ...(stacks ? { stacks } : {}),
  ...(values.staff ? { staff: true } : {}),
  ...(agent ? { agent } : {}),
  ...(values.kind === "agent" || values.kind === "human" ? { kind: values.kind } : {}),
  // Only a downtown plot can be sold (RFC 0039), so a resident made for the plot market lives there.
  ...(values["open-plot-market"] ? { downtown: true } : {}),
};

const http = fetchHttp(base.href);
try {
  if (values.days) {
    const days = Number(values.days);
    const moved = await http.call("POST", `/v1/test/advance-day?days=${days}`);
    if (moved.status !== 200)
      throw new Error("the clock didn't move: start the server with pnpm dev:test");
  }
  if (values["open-land"]) await openLandOver(http);
  if (values["open-plot-market"]) await openPlotMarketOver(http);
  if (values["open-clay"]) await openClayOver(http);
  if (values["open-grades"]) await openGradesOver(http);
  if (values.job) {
    const days = await jobDayOver(http, values.job);
    if (!values.json)
      console.log(`${values.job} is on the board${days ? `, ${days} days on` : " today"}.`);
  }
  const made = await makePersona(http, stage(preset, spec));
  if (values.json) {
    console.log(JSON.stringify({ ...made, signIn: signInScript(made, values.path) }, null, 2));
  } else {
    console.log(`${made.name}  ${made.id}${made.plot ? `  plot ${made.plot.join(",")}` : ""}`);
    if (made.agent) console.log(`their AI: ${made.agent.name}  ${made.agent.id}`);
    console.log(`\nSign a tab on ${base.origin.replace(":8797", ":5183")} in as them:\n`);
    console.log(signInScript(made, values.path));
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
