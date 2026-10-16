/**
 * Deploy terrakin.org, but only from the tip of `origin/main` (`pnpm cf:deploy` runs this after
 * the build, so the check happens right before the upload).
 *
 * Two Workers go out, the cards Worker first (`wrangler.cards.jsonc`, decision 0299): the main
 * Worker's CARDS binding fails to deploy while that service doesn't exist, so a first deploy from
 * nothing has to go in this order. Extra arguments reach both.
 *
 * The world rebuilds itself by replaying its log, so a Worker older than the one live can't boot
 * once the newer one has logged a command the old sim doesn't know: every `/v1` route answers 500
 * until something newer goes out. On a laptop an older or dirty HEAD is refused. In CI a run whose
 * commit is no longer the tip of main skips, because the newer commit's own run deploys it, unless
 * every newer commit says `[skip ci]`: those get no run, so this one deploys.
 *
 * Before uploading, it replays the live world's log under the sim being deployed
 * (`replay-check.ts`, RFC 0014) and refuses when the hashes differ, or when an input is refused or
 * throws. That needs a staff sign-in: yours on a laptop, an Access service token in CI (decision
 * 0257). When it can't run it says so and deploys, and the World object's weekly replay from the
 * first input still catches a rule that replays old inputs differently.
 * `TERRAKIN_SKIP_REPLAY_CHECK=1` skips it on purpose.
 *
 * It prints the version id wrangler uploaded, read from wrangler's output file
 * (`WRANGLER_OUTPUT_FILE_PATH`). In GitHub Actions it leaves four outputs for the smoke job that
 * follows (`deploy-smoke.ts`, decision 0250): `deployed`, whether this run uploaded, `script`, the
 * script the page it built loads, `replay`, how the replay check went, which turns the smoke job
 * red on `skipped`, and `version`, that id, which the smoke job waits for the World object to run.
 *
 *   node scripts/deploy.ts [wrangler deploy args]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type DeployCheck = { go: true } | { go: false; skip: boolean; why: string };

/** The markers that stop GitHub Actions from running on a push. */
const SKIP_CI = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]|^skip-checks: ?true$/im;

export function checkDeploy(o: {
  head: string;
  main: string;
  dirty: boolean;
  ci: boolean;
  /** Messages of the commits on main after HEAD, or null when HEAD isn't behind main. */
  newer: string[] | null;
}): DeployCheck {
  if (o.dirty) {
    return {
      go: false,
      skip: false,
      why: "the working tree has changes. Commit and push them first.",
    };
  }
  if (o.head === o.main) return { go: true };
  if (o.ci && o.newer?.length && o.newer.every((m) => SKIP_CI.test(m))) return { go: true };
  if (o.ci) {
    return {
      go: false,
      skip: true,
      why: `main has moved on to ${o.main.slice(0, 7)}, whose own run deploys it.`,
    };
  }
  return {
    go: false,
    skip: false,
    why: `HEAD ${o.head.slice(0, 7)} isn't origin/main ${o.main.slice(0, 7)}. Pull or push so they match, then deploy again.`,
  };
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function newerThan(head: string, main: string): string[] | null {
  try {
    git("merge-base", "--is-ancestor", head, main);
  } catch {
    return null;
  }
  return git("log", "--format=%B%x00", `${head}..${main}`)
    .split("\0")
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * How the replay check went, for the workflow: `passed`, `off` (skipped on purpose, or no service
 * token to sign in with), or `skipped`: a service token is set and the check still couldn't run,
 * so the token expired, its Access policy changed, or the live world didn't answer. A failed check
 * never gets here: the deploy is refused.
 */
export type ReplayOutcome = "passed" | "off" | "skipped";

/**
 * Run the replay check before an upload and say how it went: an outcome for the workflow, or
 * `refused` when this sim replays the live log differently and the deploy must stop. A check that
 * throws or can't sign in never stops a deploy; `say` gets each line to print.
 */
export async function replayBeforeDeploy(o: {
  /** `TERRAKIN_SKIP_REPLAY_CHECK=1`. */
  skip: boolean;
  /** Whether CI's service token is set, which makes a check that couldn't run worth an alert. */
  hasServiceToken: boolean;
  check: () => Promise<{ status: "passed" | "failed" | "skipped"; lines: string[] }>;
  describeError: (err: unknown) => string;
  say: (line: string) => void;
}): Promise<ReplayOutcome | "refused"> {
  if (o.skip) {
    o.say("Replay check: skipped (TERRAKIN_SKIP_REPLAY_CHECK=1).");
    return "off";
  }
  try {
    const replay = await o.check();
    for (const line of replay.lines) o.say(`Replay check: ${line}`);
    if (replay.status === "failed") return "refused";
    if (replay.status === "passed") return "passed";
  } catch (err) {
    o.say(`Replay check couldn't run: ${o.describeError(err)}`);
  }
  return o.hasServiceToken ? "skipped" : "off";
}

/**
 * The version id a `wrangler deploy` uploaded, from the lines it appended to its output file (one
 * JSON object a line, the upload's with `"type": "deploy"`), or undefined when there is none. Only
 * an id made of letters, digits, and dashes counts, since it goes into the workflow's outputs.
 */
export function deployedVersion(output: string): string | undefined {
  let version: string | undefined;
  for (const line of output.split("\n")) {
    try {
      const entry: unknown = JSON.parse(line);
      if (entry === null || typeof entry !== "object") continue;
      const { type, version_id: id } = entry as Record<string, unknown>;
      if (type === "deploy" && typeof id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(id)) {
        version = id;
      }
    } catch {
      // Not a JSON line.
    }
  }
  return version;
}

/**
 * The lines for `$GITHUB_OUTPUT`: whether this run uploaded, and after an upload the script the
 * built page loads, how the replay check went, and the version id it uploaded. CI's `smoke` job
 * runs only on `deployed=true`, checks the live homepage against `script`, waits for the world to
 * run `version`, and goes red on `replay=skipped`.
 */
export function workflowOutputs(
  deployed: boolean,
  script: string | undefined,
  replay: ReplayOutcome,
  version?: string,
): string {
  return deployed
    ? `deployed=true\nscript=${script ?? ""}\nreplay=${replay}\nversion=${version ?? ""}\n`
    : "deployed=false\n";
}

/**
 * Leave the outputs for the workflow. The upload has already happened or been skipped, so nothing
 * here can fail the run: the smoke script is loaded only now, and a failure is said and passed over.
 */
async function tellWorkflow(deployed: boolean, replay: ReplayOutcome, version?: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  let script: string | undefined;
  try {
    const { moduleScript } = await import("./deploy-smoke.ts");
    const page = new URL("../packages/client/dist/index.html", import.meta.url);
    script = moduleScript(readFileSync(page, "utf8"));
  } catch {
    // No built page to read: the smoke job checks the homepage without a script to match.
  }
  try {
    appendFileSync(file, workflowOutputs(deployed, deployed ? script : undefined, replay, version));
  } catch (err) {
    console.error(
      `Couldn't write the workflow's outputs: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  git("fetch", "--quiet", "origin", "main");
  const head = git("rev-parse", "HEAD");
  const main = git("rev-parse", "FETCH_HEAD");
  const check = checkDeploy({
    head,
    main,
    dirty: git("status", "--porcelain") !== "",
    ci: process.env.CI === "true",
    newer: head === main ? [] : newerThan(head, main),
  });
  if (!check.go) {
    console.error(`${check.skip ? "Not deploying" : "Refusing to deploy"}: ${check.why}`);
    if (check.skip) await tellWorkflow(false, "off");
    process.exit(check.skip ? 0 : 1);
  }
  const { checkLive, describeError, LIVE_ADMIN, serviceToken } = await import("./replay-check.ts");
  const replayed = await replayBeforeDeploy({
    skip: process.env.TERRAKIN_SKIP_REPLAY_CHECK === "1",
    hasServiceToken: serviceToken() !== undefined,
    check: () => checkLive(LIVE_ADMIN),
    describeError,
    say: (line) => console.log(line),
  });
  if (replayed === "refused") {
    console.error(
      "Refusing to deploy: this sim replays the live world's log differently. To deploy anyway, set TERRAKIN_SKIP_REPLAY_CHECK=1.",
    );
    process.exit(1);
  }
  const args = process.argv.slice(2);
  // The cards Worker first: the main Worker's CARDS binding needs the service to exist. It writes
  // no output file, since only the main Worker's version id is worth printing.
  const plain = { ...process.env };
  delete plain.WRANGLER_OUTPUT_FILE_PATH;
  execFileSync("wrangler", ["deploy", "-c", "wrangler.cards.jsonc", ...args], {
    stdio: "inherit",
    env: plain,
  });
  // wrangler appends what it uploaded to this file, the version id among it.
  const outputFile = join(
    process.env.RUNNER_TEMP || tmpdir(),
    `wrangler-deploy-${process.pid}.jsonl`,
  );
  rmSync(outputFile, { force: true });
  execFileSync("wrangler", ["deploy", ...args], {
    stdio: "inherit",
    env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: outputFile },
  });
  let version: string | undefined;
  try {
    version = deployedVersion(readFileSync(outputFile, "utf8"));
    rmSync(outputFile, { force: true });
  } catch {
    // No output file: wrangler wrote none, and the smoke job says it has no version to wait for.
  }
  console.log(
    version
      ? `Deployed version ${version}.`
      : "Deployed, but wrangler's output file named no version id.",
  );
  await tellWorkflow(true, replayed, version);
}
