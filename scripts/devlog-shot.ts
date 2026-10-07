/**
 * A screenshot of the game for a devlog post, taken on a phone from the `pnpm dev:test` world.
 * Start that world, then:
 *
 *   pnpm devlog:shot pets --persona pet
 *   pnpm devlog:shot plot-3d --persona settled --path "/world?at={me}&view=3d"
 *   pnpm devlog:shot shop --path /shop --click "#shop-autumn" --wait 1500
 *   pnpm devlog:shot rain --persona settled --bare     (the world without its buttons)
 *
 * It makes a resident at a stage (the presets in `e2e/personas.ts`, as `pnpm persona` does), signs
 * a phone-sized tab in as them, opens `--path` (`{me}` is their id), presses each `--click` in turn,
 * and saves a JPEG to packages/client/public/devlog/images/<day>-<name>.jpg. It prints the line to
 * put in the post. `pnpm gen` checks every screenshot a post shows is there and small enough.
 * Only for servers on this machine.
 */
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, devices } from "@playwright/test";
import {
  fetchHttp,
  isPreset,
  makePersona,
  type PersonaSpec,
  PRESETS,
  stage,
} from "../e2e/personas.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    persona: { type: "string", default: "settled" },
    name: { type: "string" },
    coins: { type: "string" },
    stacks: { type: "string" },
    days: { type: "string" },
    path: { type: "string", default: "/world" },
    click: { type: "string", multiple: true },
    bare: { type: "boolean" },
    wait: { type: "string", default: "2500" },
    date: { type: "string" },
    server: { type: "string", default: "http://localhost:8797" },
    client: { type: "string", default: "http://localhost:5183" },
    help: { type: "boolean", short: "h" },
  },
});

const name = positionals[0] ?? "";
const preset = values.persona;
if (values.help || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || !isPreset(preset)) {
  console.log(`Usage: pnpm devlog:shot <name> [--persona ${Object.keys(PRESETS).join("|")}]
  [--path /world] [--click <selector>]... [--bare] [--wait ms] [--name N] [--coins N]
  [--stacks kind=n,...] [--days N] [--date YYYY-MM-DD]
<name> is lowercase words joined by dashes, like pets or plot-3d.`);
  process.exit(values.help ? 0 : 2);
}

for (const url of [values.server, values.client]) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    console.error("devlog:shot only talks to a world on this machine (pnpm dev:test).");
    process.exit(2);
  }
}

const day = values.date ?? new Date().toISOString().slice(0, 10);
const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "packages/client/public/devlog/images");
const file = `${day}-${name}.jpg`;

const stacks = values.stacks
  ? Object.fromEntries(
      values.stacks.split(",").map((pair) => {
        const [kind, n] = pair.split("=");
        return [kind?.trim() ?? "", Number(n ?? 1)];
      }),
    )
  : undefined;
const spec: PersonaSpec = {
  name: values.name ?? "Ivy",
  ...(values.coins ? { coins: Number(values.coins) } : {}),
  ...(stacks ? { stacks } : {}),
};

const http = fetchHttp(values.server);
if (values.days) {
  const moved = await http.call("POST", `/v1/test/advance-day?days=${Number(values.days)}`);
  if (moved.status !== 200) {
    console.error("The clock didn't move: start the world with pnpm dev:test.");
    process.exit(1);
  }
}
const me = await makePersona(http, stage(preset, spec));

// A phone, as the e2e suite uses, at twice its pixels so text stays sharp and the file stays small.
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(values.client);
  await page.evaluate(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token);
      localStorage.setItem("terrakin.resident", id);
    },
    [me.token, me.id] as const,
  );
  await page.goto(new URL(values.path.replaceAll("{me}", me.id), values.client).href);
  await page.waitForTimeout(Number(values.wait));
  for (const selector of values.click ?? []) {
    await page.click(selector);
    await page.waitForTimeout(800);
  }
  if (values.bare) await page.addStyleTag({ content: "#hud { visibility: hidden !important; }" });
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, file), type: "jpeg", quality: 80 });
} finally {
  await browser.close();
}

const kb = Math.ceil(statSync(join(dir, file)).size / 1024);
console.log(`Saved packages/client/public/devlog/images/${file} (${kb} KB) as ${me.name}.`);
console.log(`\nPut it in docs/devlog/${day}.md on a line of its own, saying what it shows:\n`);
console.log(`![What this shows](/devlog/images/${file})`);
