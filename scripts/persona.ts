/**
 * Make a resident at a stage on a local server, for checking a change by hand or with a browser
 * tool (decision 0147). Start the server with `pnpm dev:test`, which turns on the test routes, then:
 *
 *   pnpm persona settled --name Ivy
 *   pnpm persona stocked --coins 2000 --stacks tomato=10,sugar=6
 *   pnpm persona owner --agent Pip
 *   pnpm persona settled --days 24     (moves the world's clock on first: Halloween, a season)
 *   pnpm persona stocked --open-recipes  (opens recipes first, once per world: a newcomer with picks)
 *
 * It prints who it made and a line of JavaScript that signs a browser tab in as them. Presets and
 * the steps are in `e2e/personas.ts`, which the Playwright specs build residents with too. Only
 * for servers on this machine: the test routes answer nothing else.
 */
import { parseArgs } from "node:util";
import {
  fetchHttp,
  isPreset,
  makePersona,
  openRecipesOver,
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
    "open-recipes": { type: "boolean" },
    path: { type: "string", default: "/world" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const preset = positionals[0] ?? "settled";
if (values.help || !isPreset(preset)) {
  console.log(`Usage: pnpm persona [${Object.keys(PRESETS).join("|")}] [--name N] [--coins N]
  [--stacks kind=n,kind=n] [--staff] [--agent Name] [--kind human|agent] [--days N]
  [--open-recipes] [--path /world] [--base http://localhost:8797] [--json]`);
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
const name = values.name ?? `${preset[0]?.toUpperCase()}${preset.slice(1)} ${suffix}`;
const presetAgent = (PRESETS[preset] as { agent?: string }).agent;
const agent = values.agent ?? (presetAgent ? `${presetAgent} ${suffix}` : undefined);
const spec: PersonaSpec = {
  name,
  ...(values.coins ? { coins: Number(values.coins) } : {}),
  ...(stacks ? { stacks } : {}),
  ...(values.staff ? { staff: true } : {}),
  ...(agent ? { agent } : {}),
  ...(values.kind === "agent" || values.kind === "human" ? { kind: values.kind } : {}),
};

const http = fetchHttp(base.href);
try {
  if (values.days) {
    const days = Number(values.days);
    const moved = await http.call("POST", `/v1/test/advance-day?days=${days}`);
    if (moved.status !== 200)
      throw new Error("the clock didn't move: start the server with pnpm dev:test");
  }
  if (values["open-recipes"]) await openRecipesOver(http);
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
