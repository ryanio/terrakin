/**
 * Deploy terrakin.org, but only from the tip of `origin/main` (`pnpm cf:deploy` runs this after
 * the build, so the check happens right before the upload).
 *
 * The world rebuilds itself by replaying its log, so a Worker older than the one live can't boot
 * once the newer one has logged a command the old sim doesn't know: every `/v1` route answers 500
 * until something newer goes out. On a laptop an older or dirty HEAD is refused. In CI a run whose
 * commit is no longer the tip of main skips, because the newer commit's own run deploys it, unless
 * every newer commit says `[skip ci]`: those get no run, so this one deploys.
 *
 * Before uploading, it replays the live world's log under the sim being deployed
 * (`replay-check.ts`, RFC 0014) and refuses when the hashes differ, or when an input is refused or
 * throws. That needs a staff sign-in; without one (CI has none yet) it says so and deploys, and the
 * World object's weekly replay from the first input still catches a rule that replays old inputs
 * differently. `TERRAKIN_SKIP_REPLAY_CHECK=1` skips it on purpose.
 *
 * In GitHub Actions it leaves two outputs for the smoke job that follows (`deploy-smoke.ts`,
 * decision 0250): `deployed`, whether this run uploaded, and `script`, the script the page it
 * built loads.
 *
 *   node scripts/deploy.ts [wrangler deploy args]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
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
 * The lines for `$GITHUB_OUTPUT`: whether this run uploaded, and after an upload the script the
 * built page loads. CI's `smoke` job runs only on `deployed=true` and checks the live homepage
 * against `script`.
 */
export function workflowOutputs(deployed: boolean, script: string | undefined): string {
  return deployed ? `deployed=true\nscript=${script ?? ""}\n` : "deployed=false\n";
}

/**
 * Leave the outputs for the workflow. The upload has already happened or been skipped, so nothing
 * here can fail the run: the smoke script is loaded only now, and a failure is said and passed over.
 */
async function tellWorkflow(deployed: boolean) {
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
    appendFileSync(file, workflowOutputs(deployed, deployed ? script : undefined));
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
    if (check.skip) await tellWorkflow(false);
    process.exit(check.skip ? 0 : 1);
  }
  if (process.env.TERRAKIN_SKIP_REPLAY_CHECK === "1") {
    console.log("Replay check: skipped (TERRAKIN_SKIP_REPLAY_CHECK=1).");
  } else {
    const { checkLive, describeError } = await import("./replay-check.ts");
    try {
      const replay = await checkLive("https://admin.terrakin.org");
      for (const line of replay.lines) console.log(`Replay check: ${line}`);
      if (replay.status === "failed") {
        console.error(
          "Refusing to deploy: this sim replays the live world's log differently. To deploy anyway, set TERRAKIN_SKIP_REPLAY_CHECK=1.",
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(`Replay check couldn't run: ${describeError(err)}`);
    }
  }
  execFileSync("wrangler", ["deploy", ...process.argv.slice(2)], { stdio: "inherit" });
  await tellWorkflow(true);
}
