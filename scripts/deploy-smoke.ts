/**
 * A smoke check of the live Worker, run by CI right after a deploy (decision 0250) and by hand.
 * The test suite draws cards in Node, so it can't see what only a Worker refuses. This asks the
 * deployed one for the things that have to work there: the world answers with the switches the
 * Worker sets, a plot, a look, and the map around someone come back as drawn PNGs and not a
 * redirect to the static card, the start files and the feed have their types, and the homepage
 * loads the build's script.
 *
 *   node scripts/deploy-smoke.ts [--base https://terrakin.org] [--wait 120] [--deployed]
 *                                [--version <id>] [--version-wait 600]
 *                                [--script /assets/index-abc.js] [--seed text]
 *
 * Read-only: about ten GETs, no token, no resident, nothing written. `--wait` is how many seconds
 * it keeps asking again for what failed, for a deploy still spreading; a picture is asked for at
 * most `PICTURE_TRIES` times however long that is, since each draw costs the Worker CPU and one
 * address may cause only a few a minute (packages/server/AGENTS.md). `--seed` picks which plot and
 * residents are drawn (CI uses the commit, so each deploy asks for different ones).
 *
 * `--version` is the deploy id wrangler uploaded (CI's deploy job hands it over). Cloudflare
 * restarts the World object on a new build seconds to minutes after the Worker, so the check first
 * asks `GET /v1/health` until the world's `build` and the Worker's `terrakin-worker-build` header
 * both name it, for up to `--version-wait` seconds, and only then asks for what the world answers:
 * the world, the skill file (which must then be this checkout's `SKILL.md`), and the pictures.
 * When the world never gets there, it says so and those aren't asked. Without `--version` nothing
 * waits for a build, and `--deployed` only notes whether the live skill file is this checkout's.
 * `--script` names the script the build's homepage loads, and the live homepage must load it.
 *
 * A picture's `Cache-Status` says whether the Worker drew it for this request. When none of the
 * three was drawn, up to `EXTRA_PICTURES` more maps around other residents are asked for, one at a
 * time, until one is. A run with no fresh draw passes with a line saying it couldn't prove one:
 * nothing may force a draw past the caps, and a quiet town can leave every picture unchanged.
 *
 * Exit codes: 0 every check passed, 1 one didn't, 2 it couldn't start.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { WORLD_SWITCHES } from "../packages/server/src/world-switches.ts";

/** What one GET gave back, redirects not followed. */
export interface Got {
  status: number;
  /**
   * The `content-type`, `location`, `cache-control`, `terrakin-worker-build`, and `cache-status`
   * headers, or "" without one.
   */
  type: string;
  location: string;
  cacheControl: string;
  workerBuild: string;
  cacheStatus: string;
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
  /**
   * How long this step is asked again, from the start of the run (or from when the step that
   * brought it passed), instead of the run's wait. The steps it brings get the run's wait afresh
   * once it passes.
   */
  waitMs?: number;
  /** Asked only when this says so at its turn; skipped quietly otherwise. */
  when?(): boolean;
  check(got: Got): Outcome;
}

/** A picture is asked for at most this many times in one run. */
export const PICTURE_TRIES = 3;
/**
 * More maps around someone, asked once each, while no picture has been drawn by this run. With
 * three pictures at `PICTURE_TRIES` each, a run causes at most 12 draws, the most one address may
 * cause in a minute (`RENDERS_PER_MINUTE` in packages/server/src/og.ts).
 */
export const EXTRA_PICTURES = 3;
/** How long `--version` waits for the World object to run the deployed build, by default. */
export const VERSION_WAIT_SECONDS = 600;

/** How this run's pictures came back: drawn for it, found drawn, or with no word on which. */
export interface Draws {
  drawn: number;
  cached: number;
  unsaid: number;
}

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
 * Health, from the deployed build: the world's `build` and the Worker's `terrakin-worker-build`
 * both name `version`. Until Cloudflare restarts the World object on the new build, the world
 * names the build before, or none if that build is older than `build`.
 */
export function checkBuild(got: Got, version: string): Outcome {
  const health = checkHealth(got);
  if (health.problems.length) return health;
  const world = jsonObject(got)?.build;
  const problems: string[] = [];
  if (world !== version) {
    problems.push(
      typeof world === "string" && world
        ? `the World object runs build ${world}, not the deployed ${version}: Cloudflare hasn't restarted it on the new build yet`
        : `the World object names no build, so it runs one from before health named builds, not the deployed ${version}`,
    );
  }
  if (got.workerBuild !== version) {
    problems.push(
      got.workerBuild
        ? `the Worker that answered is build ${got.workerBuild}, not the deployed ${version}`
        : `the Worker that answered sends no terrakin-worker-build, so it isn't the deployed ${version}`,
    );
  }
  return { problems, note: `${health.note ?? ""}, the Worker and the world on ${version}` };
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
  starterDoors: "starterDoors",
  starterEdges: "starterEdges",
  slimHomes: "homesSlimmed",
  shop: "shop",
  recipes: "recipesOpen",
  holidayPrices: null,
  raisedInventory: null,
  shopInPerson: "shopInPerson",
  proposeInPerson: "proposeInPerson",
  scheduleInPerson: "scheduleInPerson",
  attendAtTen: "attendAtTen",
  levels: "levelsOpen",
  jobs: "jobsOpen",
  circles: "circlesOpen",
  clay: "clayOpen",
  grades: "gradesOpen",
  // The snapshot carries `lands` only once one is open (`landsField`), and the option only
  // watches the count, so there is nothing to look for until the first island opens (RFC 0038).
  lands: null,
  retireRepeatJoins: null,
  market: null,
  bounties: null,
  presence: null,
};

/**
 * The options the Worker's source sets to `true` on its `WorldService`, read from the text of
 * `worker.ts` so the list is the Worker's own: the shared ones (`WORLD_SWITCHES`, where it
 * spreads them) and its own. A line may end in a comment. Throws when the call isn't where it
 * looks.
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
    if (depth === 0 && /^\s*\.\.\.WORLD_SWITCHES,?\s*$/.test(line)) {
      for (const [name, on] of Object.entries(WORLD_SWITCHES)) if (on === true) options.push(name);
    }
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
 * look, and the map around a resident, each a draw at most. Then up to `EXTRA_PICTURES` maps
 * around other residents, asked once each and only while `draws` has no picture drawn: the map
 * moves with the light and whoever is online, so one of them is likely not drawn yet.
 */
export function pictureSteps(
  world: Record<string, unknown>,
  seed: string,
  draws: Draws = { drawn: 0, cached: 0, unsaid: 0 },
): Step[] {
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
    check: (answer) => checkPicture(answer, draws),
  });
  const others = people.filter((id) => id !== near);
  const extras: Step[] = [];
  for (let i = 0; i < EXTRA_PICTURES && others.length; i++) {
    const id = pick(others, `${seed}:extra:${i}`);
    if (id === undefined) break;
    others.splice(others.indexOf(id), 1);
    extras.push({
      ...step("another near", `/og/near/${id}.png`),
      tries: 1,
      when: () => draws.drawn === 0,
    });
  }
  return [
    ...(plot ? [step("plot picture", `/og/plot/${plot}.png`)] : []),
    ...(look ? [step("look picture", `/og/look/${look}.png`)] : []),
    ...(near ? [step("near picture", `/og/near/${near}.png`)] : []),
    ...extras,
  ];
}

export function checkWorld(
  got: Got,
  switches: readonly Switch[],
  seed: string,
  o: {
    draws?: Draws;
    /** The World object reported the deployed build, so a missing switch is no restart away. */
    onBuild?: boolean;
  } = {},
): Outcome {
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
        o.onBuild
          ? `it has no \`${field}\`, which the Worker's \`${option}\` switch turns on, though the World object runs the deployed build`
          : `it has no \`${field}\`, which the Worker's \`${option}\` switch turns on (one new in this deploy shows once the World object has restarted, minutes later: run the check again)`,
      );
    }
  }
  const pictures = pictureSteps(world, seed, o.draws);
  if (pictures.filter((p) => !p.when).length < 3) {
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
 * Whether the Worker drew a picture for this request, from its `Cache-Status` (RFC 9211): the
 * `terrakin` entry says `fwd` when it drew and `hit` when it found the PNG drawn. A cache along
 * the way that replayed the answer adds a `hit` of its own after it, and that counts as cached.
 */
export function pictureDraw(cacheStatus: string): keyof Draws {
  const entries = cacheStatus
    .split(",")
    .map((entry) => entry.split(";").map((part) => part.trim().split("=")[0]?.toLowerCase() ?? ""));
  const at = entries.findIndex(([name]) => name === "terrakin");
  const ours = entries[at];
  if (!ours) return "unsaid";
  if (ours.includes("hit") || entries.slice(at + 1).some((entry) => entry.includes("hit"))) {
    return "cached";
  }
  return ours.includes("fwd") ? "drawn" : "unsaid";
}

const DRAW_WORDS: Record<keyof Draws, string> = {
  drawn: "drawn now",
  cached: "from the cache",
  unsaid: "the Worker didn't say whether it drew it",
};

/**
 * A picture the Worker drew: a PNG, never a redirect. When a draw fails, the route sends the
 * client to the static `/og.png` (`packages/server/src/og.ts`), which is what a Worker that can't
 * draw does for every picture. A PNG that passes is counted in `draws` by how it came back.
 */
export function checkPicture(got: Got, draws?: Draws): Outcome {
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
  const how = pictureDraw(got.cacheStatus);
  if (draws && problems.length === 0) draws[how]++;
  return { problems, note: `PNG, ${got.body.length} bytes, ${DRAW_WORDS[how]}` };
}

/**
 * The line on what this run's pictures prove about drawing, or undefined when none came back.
 * Without a fresh draw it says the run couldn't prove one; that is a note and never a failure.
 */
export function drawLine(draws: Draws): { proved: boolean; line: string } | undefined {
  const total = draws.drawn + draws.cached + draws.unsaid;
  if (total === 0) return undefined;
  if (draws.drawn > 0) {
    return {
      proved: true,
      line: `The Worker drew ${draws.drawn} of the ${total} pictures for this run, so it can draw.`,
    };
  }
  const why =
    draws.unsaid === 0
      ? "every one came from the cache"
      : draws.cached === 0
        ? "the Worker said for none whether it drew it"
        : `${draws.cached} came from the cache and the Worker didn't say for ${draws.unsaid}`;
  return {
    proved: false,
    line: `Couldn't prove the Worker can draw: of the ${total} pictures, ${why}. Nothing forces a draw past the caps, so this is a note, not a failure.`,
  };
}

/**
 * A text file: its type and a line it always has. With `build`, the text this checkout would
 * serve, the note says whether the live one is it, and a different one still passes: the World
 * object keeps running the build before for minutes after a deploy.
 */
export function checkFile(
  got: Got,
  o: {
    type: string;
    has: string;
    /** With `onBuild`, the World object runs the deployed build, so another text fails. */
    build?: { text: string; from: string; onBuild?: boolean };
  },
): Outcome {
  const problems = answered(got, o.type);
  if (problems.length) return { problems };
  const body = text(got);
  if (!body.includes(o.has)) problems.push(`it doesn't contain "${o.has}"`);
  let build = "";
  if (o.build && body === o.build.text) build = `, this checkout's ${o.build.from}`;
  else if (o.build?.onBuild) {
    problems.push(
      `it isn't this checkout's ${o.build.from}, though the World object runs the deployed build`,
    );
  } else if (o.build) {
    build = `, not this checkout's ${o.build.from}: the World object still runs an earlier build`;
  }
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

/**
 * Every step that needs no other answer first. The world's and the homepage's bring the rest, and
 * with `version` the health step brings the world and the skill file once it reports that build.
 */
export function firstSteps(o: {
  switches: readonly Switch[];
  seed: string;
  /** The script the build's homepage loads, when known. */
  script?: string;
  /** This checkout's `packages/protocol/SKILL.md`, when it is what was deployed. */
  skill?: string;
  /** The deploy id just uploaded, and how long to wait for the World object to run it. */
  version?: { id: string; waitMs: number };
  /** Where the pictures' answers are counted. */
  draws?: Draws;
}): Step[] {
  const onBuild = o.version !== undefined;
  const build =
    o.skill === undefined ? {} : { build: { text: o.skill, from: "SKILL.md", onBuild } };
  const world: Step = {
    name: "world",
    path: "/v1/world",
    gates: "the plot, look, and near pictures",
    check: (got) =>
      checkWorld(got, o.switches, o.seed, { onBuild, ...(o.draws ? { draws: o.draws } : {}) }),
  };
  const skill: Step = {
    name: "skill file",
    path: "/skill.md",
    check: (got) => checkFile(got, { type: "text/markdown", has: "name: terrakin", ...build }),
  };
  const version = o.version;
  const health: Step[] = version
    ? [
        {
          name: "build",
          path: "/v1/health",
          waitMs: version.waitMs,
          gates: `the world, the skill file, and the pictures, after ${version.waitMs / 1000} seconds of waiting for the World object to run the deployed build`,
          check: (got) => {
            const outcome = checkBuild(got, version.id);
            return outcome.problems.length ? outcome : { ...outcome, next: [world, skill] };
          },
        },
      ]
    : [{ name: "health", path: "/v1/health", check: checkHealth }, world, skill];
  return [
    ...health,
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
  const start = io.now();
  const failed: Failure[] = [];
  let passed = 0;
  /** A step with its own wait counts from `from`; any other keeps the deadline it was given. */
  const due = (step: Step, from: number, deadline: number) =>
    step.waitMs === undefined ? deadline : from + step.waitMs;
  let todo = first.map((step) => ({
    step,
    tried: 0,
    deadline: due(step, start, start + o.waitMs),
  }));
  while (todo.length) {
    const again: typeof todo = [];
    for (let item = todo.shift(); item; item = todo.shift()) {
      const { step } = item;
      if (item.tried === 0 && step.when && !step.when()) continue;
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
        // What a waiting step brings gets the run's wait from now; anything else keeps its own.
        const now = io.now();
        const after = step.waitMs === undefined ? item.deadline : now + o.waitMs;
        todo.push(
          ...(outcome.next ?? []).map((next) => ({
            step: next,
            tried: 0,
            deadline: due(next, now, after),
          })),
        );
      } else if (
        item.tried < (step.tries ?? Number.POSITIVE_INFINITY) &&
        io.now() < item.deadline
      ) {
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
    workerBuild: res.headers.get("terrakin-worker-build") ?? "",
    cacheStatus: res.headers.get("cache-status") ?? "",
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
      version: { type: "string" },
      "version-wait": { type: "string", default: String(VERSION_WAIT_SECONDS) },
      script: { type: "string" },
      seed: { type: "string" },
    },
  });
  const waitSeconds = Number(values.wait);
  const versionWaitSeconds = Number(values["version-wait"]);
  if (!/^https?:\/\//.test(values.base)) throw new Error("--base takes an http or https URL");
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0) throw new Error("--wait takes seconds");
  if (!Number.isFinite(versionWaitSeconds) || versionWaitSeconds < 0) {
    throw new Error("--version-wait takes seconds");
  }
  // CI passes the deploy job's output, which is empty when the deploy couldn't read the id.
  if (values.version !== undefined && !/^[A-Za-z0-9-]{1,64}$/.test(values.version)) {
    throw new Error(
      values.version
        ? "--version takes a deploy id: letters, digits, and dashes"
        : "--version is empty: the deploy didn't say which version it uploaded (its 'Deployed' line)",
    );
  }
  const repoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const seed = values.seed || process.env.GITHUB_SHA || String(Date.now());
  const draws: Draws = { drawn: 0, cached: 0, unsaid: 0 };
  const deployed = values.deployed || values.version !== undefined;
  const steps = firstSteps({
    switches: shownSwitches(workerSwitches(repoFile("packages/server/cloudflare/worker.ts"))),
    seed,
    draws,
    ...(values.script ? { script: values.script } : {}),
    ...(deployed ? { skill: repoFile("packages/protocol/SKILL.md") } : {}),
    ...(values.version === undefined
      ? {}
      : { version: { id: values.version, waitMs: versionWaitSeconds * 1000 } }),
  });
  return { base: values.base, waitMs: waitSeconds * 1000, seed, steps, draws };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let job: ReturnType<typeof setup>;
  try {
    job = setup();
  } catch (err) {
    console.error(`Couldn't start: ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      "Usage: node scripts/deploy-smoke.ts [--base https://terrakin.org] [--wait 120] [--deployed] [--version <id>] [--version-wait 600] [--script /assets/index-abc.js] [--seed text]",
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
  const drew = drawLine(job.draws);
  if (drew) console.log(drew.line);
  // A run that couldn't prove a draw passes; in GitHub Actions it leaves a warning on the run.
  if (drew && !drew.proved && process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning::${drew.line}`);
  }
  if (failed.length) {
    console.error(
      `${failed.length} of ${passed + failed.length} checks failed: ${failed.map((f) => f.name).join(", ")}. docs/deploy.md says what each one means.`,
    );
    process.exit(1);
  }
  console.log(`All ${passed} checks passed.`);
}
