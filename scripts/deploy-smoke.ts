/**
 * A smoke check of the live Worker, run by CI right after a deploy (decision 0250) and by hand.
 * The test suite draws cards in Node, so it can't see what only a Worker refuses. This asks the
 * deployed one for the things that have to work there: the world answers with the switches the
 * Worker sets, a plot, a look, and the map around someone come back as drawn PNGs and not a
 * redirect to the static card, the start files and the feed have their types, and the homepage
 * loads the build's script.
 *
 *   node scripts/deploy-smoke.ts [--base https://terrakin.org] [--wait 120] [--deployed]
 *                                [--script /assets/index-abc.js] [--seed text]
 *
 * Read-only: about ten GETs, no token, no resident, nothing written. `--wait` is how many seconds
 * it keeps asking again for what failed, for a deploy still spreading; a picture is asked for at
 * most `PICTURE_TRIES` times however long that is, since each draw costs the Worker CPU and one
 * address may cause only a few a minute (packages/server/AGENTS.md). `--seed` picks which plot and
 * residents are drawn (CI uses the commit, so each deploy asks for different ones).
 *
 * The Worker serves no commit or version, so two flags stand in for one. `--script` names the
 * script the build's homepage loads, and the live homepage must load it. `--deployed` says this
 * checkout is what was just deployed: the pass line then says whether the live skill file is its
 * `packages/protocol/SKILL.md`. That file comes from the World object, which Cloudflare restarts
 * on a new build seconds to minutes after a deploy, so the line says when it differs and the
 * check still passes.
 *
 * Exit codes: 0 every check passed, 1 one didn't, 2 it couldn't start.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** What one GET gave back, redirects not followed. */
export interface Got {
  status: number;
  /** The `content-type`, `location`, and `cache-control` headers, or "" without one. */
  type: string;
  location: string;
  cacheControl: string;
  body: Uint8Array;
}

/** What a check made of an answer: no problems is a pass. */
export interface Outcome {
  problems: string[];
  /** A few words for the pass line, like a count. Never anything a resident wrote. */
  note?: string;
  /** Steps that could only be chosen from this answer, asked once it passes. */
  next?: Step[];
}

export interface Step {
  name: string;
  path: string;
  /** The most times this step is asked, however long the wait. */
  tries?: number;
  /** What is never asked when this fails, for the failure line. */
  gates?: string;
  check(got: Got): Outcome;
}

/** A picture is asked for at most this many times in one run. */
export const PICTURE_TRIES = 3;

const text = (got: Got) => new TextDecoder().decode(got.body);

/** Problems with an answer's status and type, before anything reads its body. */
function answered(got: Got, type: string): string[] {
  const problems: string[] = [];
  if (got.status !== 200) {
    problems.push(`answered ${got.status}${got.location ? ` to ${got.location}` : ""}, not 200`);
  }
  if (!got.type.toLowerCase().startsWith(type)) {
    problems.push(`its type is ${got.type || "missing"}, not ${type}`);
  }
  return problems;
}

function jsonObject(got: Got): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text(got));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function checkHealth(got: Got): Outcome {
  const problems = answered(got, "application/json");
  if (problems.length) return { problems };
  const body = jsonObject(got);
  if (!body) return { problems: ["its body isn't a JSON object"] };
  if (body.ok !== true) problems.push("`ok` isn't true");
  const seq = body.seq;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) {
    problems.push("it has no `seq`");
  }
  return { problems, note: `seq ${String(seq)}` };
}

/**
 * Where each `WorldService` option the Worker turns on shows in `GET /v1/world`, or null for one
 * the snapshot doesn't carry. A switch added to `packages/server/cloudflare/worker.ts` needs a row
 * here: the test fails until it has one.
 */
export const SNAPSHOT_FIELDS: Record<string, string | null> = {
  days: "day",
  economy: null,
  items: null,
  gifts: null,
  plotPickups: "plotPickupsOwned",
  finds: "findsOpen",
  solidBuildings: "solidBuildings",
  tableSpots: "tableSpotsKept",
  shop: "shop",
  recipes: "recipesOpen",
  holidayPrices: null,
  levels: "levelsOpen",
  retireRepeatJoins: null,
  market: null,
  bounties: null,
  presence: null,
};

/**
 * The options the Worker's source sets to `true` on its `WorldService`, read from the text of
 * `worker.ts` so the list is the Worker's own. A line may end in a comment. Throws when the call
 * isn't where it looks.
 */
export function workerSwitches(source: string): string[] {
  const start = source.indexOf("new WorldService({");
  if (start < 0) throw new Error("worker.ts has no `new WorldService({`");
  const options: string[] = [];
  let depth = 0;
  for (const line of source.slice(start).split("\n").slice(1)) {
    if (depth === 0 && /^\s*\}\)/.test(line)) return options;
    const option = depth === 0 ? /^\s*(\w+): true,?\s*(?:\/\/.*)?$/.exec(line)?.[1] : undefined;
    if (option) options.push(option);
    for (const c of line.replace(/\/\/.*$/, "")) {
      if (c === "{" || c === "(" || c === "[") depth++;
      if (c === "}" || c === ")" || c === "]") depth--;
    }
  }
  throw new Error("worker.ts's `new WorldService({` never closes");
}

/** A switch the world's snapshot shows: the Worker's option and the snapshot's field. */
export interface Switch {
  option: string;
  field: string;
}

export function shownSwitches(options: readonly string[]): Switch[] {
  return options.flatMap((option) => {
    const field = SNAPSHOT_FIELDS[option];
    return field ? [{ option, field }] : [];
  });
}

/** One of `from`, the same for the same seed. */
function pick<T>(from: readonly T[], seed: string): T | undefined {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  return from[(hash >>> 0) % Math.max(1, from.length)];
}

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => v !== null && typeof v === "object")
    : [];

const isTile = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 9999;

/**
 * The pictures to ask for, from the world's own snapshot: a plot someone owns, a resident's
 * look, and the map around a resident. Three requests, each a draw at most.
 */
export function pictureSteps(world: Record<string, unknown>, seed: string): Step[] {
  const plots = records(world.plots)
    .filter((p) => typeof p.ownerId === "string" && isTile(p.px) && isTile(p.py))
    .map((p) => `${String(p.px)}-${String(p.py)}`)
    .sort();
  const people = [...records(world.residents), ...records(world.townsfolkResidents)]
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id))
    .sort();
  const plot = pick(plots, `${seed}:plot`);
  const look = pick(people, `${seed}:look`);
  const near = pick(people, `${seed}:near`);
  const step = (name: string, path: string): Step => ({
    name,
    path,
    tries: PICTURE_TRIES,
    check: checkPicture,
  });
  return [
    ...(plot ? [step("plot picture", `/og/plot/${plot}.png`)] : []),
    ...(look ? [step("look picture", `/og/look/${look}.png`)] : []),
    ...(near ? [step("near picture", `/og/near/${near}.png`)] : []),
  ];
}

export function checkWorld(got: Got, switches: readonly Switch[], seed: string): Outcome {
  const problems = answered(got, "application/json");
  if (problems.length) return { problems };
  const world = jsonObject(got);
  if (!world) return { problems: ["its body isn't a JSON object"] };
  if (!Array.isArray(world.residents)) problems.push("it has no `residents`");
  if (!Array.isArray(world.plots)) problems.push("it has no `plots`");
  for (const { option, field } of switches) {
    const value = world[field];
    if (value === undefined || value === null || value === false) {
      problems.push(
        `it has no \`${field}\`, which the Worker's \`${option}\` switch turns on (one new in this deploy shows once the World object has restarted, minutes later: run the check again)`,
      );
    }
  }
  const pictures = pictureSteps(world, seed);
  if (pictures.length < 3) {
    problems.push("it has no owned plot or no resident, so no picture can be asked for");
  }
  return {
    problems,
    note: `${records(world.residents).length} residents, ${records(world.plots).length} plots, ${switches.length} switches on`,
    next: pictures,
  };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A picture the Worker drew: a PNG, never a redirect. When a draw fails, the route sends the
 * client to the static `/og.png` (`packages/server/src/og.ts`), which is what a Worker that can't
 * draw does for every picture.
 */
export function checkPicture(got: Got): Outcome {
  if (got.status >= 300 && got.status < 400) {
    const why = got.cacheControl.includes("no-store")
      ? "the draw failed, a cap refused it, or the world didn't answer"
      : "the Worker found no such plot or resident";
    return {
      problems: [`redirected to ${got.location || "nowhere"} instead of a drawn picture (${why})`],
    };
  }
  const problems = answered(got, "image/png");
  if (!PNG_MAGIC.every((byte, i) => got.body[i] === byte)) {
    problems.push("its body doesn't start with a PNG's bytes");
  }
  return { problems, note: `PNG, ${got.body.length} bytes` };
}

/**
 * A text file: its type and a line it always has. With `build`, the text this checkout would
 * serve, the note says whether the live one is it, and a different one still passes: the World
 * object keeps running the build before for minutes after a deploy.
 */
export function checkFile(
  got: Got,
  o: { type: string; has: string; build?: { text: string; from: string } },
): Outcome {
  const problems = answered(got, o.type);
  if (problems.length) return { problems };
  const body = text(got);
  if (!body.includes(o.has)) problems.push(`it doesn't contain "${o.has}"`);
  const build = !o.build
    ? ""
    : body === o.build.text
      ? `, this checkout's ${o.build.from}`
      : `, not this checkout's ${o.build.from}: the World object still runs an earlier build`;
  return { problems, note: `${got.body.length} bytes${build}` };
}

/** The script a built page loads: the `src` of its module script under `/assets/`. */
export function moduleScript(html: string): string | undefined {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
    const src = /\bsrc="(\/assets\/[^"]+\.js)"/.exec(tag)?.[1];
    if (src && /\btype="module"/.test(tag)) return src;
  }
  return undefined;
}

/**
 * The homepage is the built page: HTML that loads a hashed script, the build's own when `script`
 * names it, and that script is there. A missing file under `/assets/` answers 200 with the page's
 * HTML (the single-page fallback), so the script's type is what tells.
 */
export function checkHome(got: Got, script: string | undefined): Outcome {
  const problems = answered(got, "text/html");
  if (problems.length) return { problems };
  const src = moduleScript(text(got));
  if (!src) return { problems: ["it loads no module script from /assets/"] };
  if (script && src !== script) {
    problems.push(`it loads ${src}, not the build's ${script}, so another build is live`);
  }
  return {
    problems,
    note: src,
    next: [
      {
        name: "script",
        path: src,
        check: (file) => ({
          problems: [
            ...(file.status === 200 ? [] : [`answered ${file.status}, not 200`]),
            ...(/javascript/i.test(file.type)
              ? []
              : [`its type is ${file.type || "missing"}, not JavaScript`]),
          ],
          note: `${file.body.length} bytes`,
        }),
      },
    ],
  };
}

/** Every step that needs no other answer first. The world's and the homepage's bring the rest. */
export function firstSteps(o: {
  switches: readonly Switch[];
  seed: string;
  /** The script the build's homepage loads, when known. */
  script?: string;
  /** This checkout's `packages/protocol/SKILL.md`, when it is what was deployed. */
  skill?: string;
}): Step[] {
  const build = o.skill === undefined ? {} : { build: { text: o.skill, from: "SKILL.md" } };
  return [
    { name: "health", path: "/v1/health", check: checkHealth },
    {
      name: "world",
      path: "/v1/world",
      gates: "the plot, look, and near pictures",
      check: (got) => checkWorld(got, o.switches, o.seed),
    },
    {
      name: "skill file",
      path: "/skill.md",
      check: (got) => checkFile(got, { type: "text/markdown", has: "name: terrakin", ...build }),
    },
    {
      name: "llms.txt",
      path: "/llms.txt",
      check: (got) => checkFile(got, { type: "text/plain", has: "# Terrakin" }),
    },
    {
      name: "changelog feed",
      path: "/changelog.xml",
      check: (got) => checkFile(got, { type: "application/atom+xml", has: "<feed" }),
    },
    {
      name: "homepage",
      path: "/",
      gates: "the homepage's script",
      check: (got) => checkHome(got, o.script),
    },
  ];
}

export interface Failure {
  name: string;
  path: string;
  problems: string[];
}

/** The network, the clock, and the output, so a test can stand in for each. */
export interface Io {
  ask(path: string): Promise<Got>;
  sleep(ms: number): Promise<void>;
  now(): number;
  say(line: string): void;
}

/**
 * Ask every step, then the steps their answers bring. What failed is asked again `everyMs` later,
 * as long as it failed before `waitMs` was up and the step has tries left, so a deploy that is
 * still spreading gets time and nothing is asked without end.
 */
export async function run(
  first: readonly Step[],
  io: Io,
  o: { waitMs: number; everyMs: number },
): Promise<{ passed: number; failed: Failure[] }> {
  const deadline = io.now() + o.waitMs;
  const failed: Failure[] = [];
  let passed = 0;
  let todo = first.map((step) => ({ step, tried: 0 }));
  while (todo.length) {
    const again: typeof todo = [];
    for (let item = todo.shift(); item; item = todo.shift()) {
      const { step } = item;
      item.tried++;
      let outcome: Outcome;
      try {
        outcome = step.check(await io.ask(step.path));
      } catch (err) {
        outcome = { problems: [`no answer (${err instanceof Error ? err.message : String(err)})`] };
      }
      const line = `${step.name.padEnd(15)} GET ${step.path}`;
      if (outcome.problems.length === 0) {
        passed++;
        io.say(`ok     ${line}${outcome.note ? `  (${outcome.note})` : ""}`);
        todo.push(...(outcome.next ?? []).map((next) => ({ step: next, tried: 0 })));
      } else if (item.tried < (step.tries ?? Number.POSITIVE_INFINITY) && io.now() < deadline) {
        io.say(`again  ${line}: ${outcome.problems.join("; ")}`);
        again.push(item);
      } else {
        failed.push({ name: step.name, path: step.path, problems: outcome.problems });
        io.say(`FAIL   ${line}`);
        for (const problem of outcome.problems) io.say(`       ${problem}`);
        if (step.gates) io.say(`       Not asked, since this failed: ${step.gates}.`);
      }
    }
    if (again.length) await io.sleep(o.everyMs);
    todo = again;
  }
  return { passed, failed };
}

/**
 * One GET. A redirect is handed back as it is and never followed: the static card a failed draw
 * redirects to is itself a 200 PNG.
 */
export async function ask(base: string, path: string): Promise<Got> {
  const res = await fetch(new URL(path, base), {
    redirect: "manual",
    headers: { "user-agent": "terrakin-deploy-smoke (scripts/deploy-smoke.ts)" },
    signal: AbortSignal.timeout(20_000),
  });
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    location: res.headers.get("location") ?? "",
    cacheControl: res.headers.get("cache-control") ?? "",
    body: new Uint8Array(await res.arrayBuffer()),
  };
}

/** What a run is asked to do, from the command line and this checkout. Throws when it can't tell. */
function setup() {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "https://terrakin.org" },
      wait: { type: "string", default: "0" },
      deployed: { type: "boolean", default: false },
      script: { type: "string" },
      seed: { type: "string" },
    },
  });
  const waitSeconds = Number(values.wait);
  if (!/^https?:\/\//.test(values.base)) throw new Error("--base takes an http or https URL");
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0) throw new Error("--wait takes seconds");
  const repoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const seed = values.seed || process.env.GITHUB_SHA || String(Date.now());
  const steps = firstSteps({
    switches: shownSwitches(workerSwitches(repoFile("packages/server/cloudflare/worker.ts"))),
    seed,
    ...(values.script ? { script: values.script } : {}),
    ...(values.deployed ? { skill: repoFile("packages/protocol/SKILL.md") } : {}),
  });
  return { base: values.base, waitMs: waitSeconds * 1000, seed, steps };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let job: ReturnType<typeof setup>;
  try {
    job = setup();
  } catch (err) {
    console.error(`Couldn't start: ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      "Usage: node scripts/deploy-smoke.ts [--base https://terrakin.org] [--wait 120] [--deployed] [--script /assets/index-abc.js] [--seed text]",
    );
    process.exit(2);
  }
  const { base } = job;
  console.log(`Smoke check of ${base} (seed ${job.seed.slice(0, 12)})`);
  const { passed, failed } = await run(
    job.steps,
    {
      ask: (path) => ask(base, path),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      say: (line) => console.log(line),
    },
    { waitMs: job.waitMs, everyMs: 30_000 },
  );
  if (failed.length) {
    console.error(
      `${failed.length} of ${passed + failed.length} checks failed: ${failed.map((f) => f.name).join(", ")}. docs/deploy.md says what each one means.`,
    );
    process.exit(1);
  }
  console.log(`All ${passed} checks passed.`);
}
