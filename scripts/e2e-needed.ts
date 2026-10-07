/**
 * Whether CI runs the e2e jobs for this run (decision 0200). They run unless every file changed
 * since the last green run is one e2e can't see: the sim, scripts, docs, and Markdown. Anything
 * the browser loads or the e2e servers run (the client, ui, server, protocol, cards, the site pages
 * in docs/site and the devlog posts in docs/devlog), the specs and their config, the dependencies,
 * and the workflows always run them, and so does anything not named here.
 *
 * On a push, the files compared are everything since the newest green CI run on main whose commit
 * this one contains, so a run cancelled by a newer push (or a `[skip ci]` commit) never lets its
 * changes reach terrakin.org without e2e. On a pull request, everything since it left its base.
 * When either can't be worked out, e2e runs.
 *
 *   node scripts/e2e-needed.ts   prints `e2e=true` or `e2e=false` for $GITHUB_OUTPUT
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Paths e2e can see even though they sit under a folder it otherwise can't. */
const SEEN = [/^docs\/site\//, /^docs\/devlog\//];

/** Paths e2e can't see: no spec loads them, and no server or page is built from them. */
const UNSEEN = [/^packages\/sim\//, /^scripts\//, /^docs\//, /\.md$/];

/** Whether a change to these paths needs e2e. An empty list (nothing changed) doesn't. */
export function needsE2e(paths: readonly string[]): boolean {
  return paths.some((p) => SEEN.some((re) => re.test(p)) || !UNSEEN.some((re) => re.test(p)));
}

/**
 * The commit to compare against on a push: the newest green run's commit that HEAD contains, or
 * null when there's none, so e2e runs.
 */
export function baseOf(greenShas: readonly string[], contains: (sha: string) => boolean) {
  return greenShas.find(contains) ?? null;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function base(): string | null {
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    const target = process.env.GITHUB_BASE_REF;
    if (!target) return null;
    git("fetch", "--quiet", "origin", target);
    return git("merge-base", "FETCH_HEAD", "HEAD");
  }
  const runs = execFileSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      "ci.yml",
      "--branch",
      "main",
      "--event",
      "push",
      "--status",
      "success",
      "--limit",
      "30",
      "--json",
      "headSha",
      "--jq",
      ".[].headSha",
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  return baseOf(runs, (sha) => {
    try {
      git("merge-base", "--is-ancestor", sha, "HEAD");
      return true;
    } catch {
      return false;
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let run = true;
  let why = "";
  try {
    const from = base();
    if (from) {
      const paths = git("diff", "--name-only", from, "HEAD").split("\n").filter(Boolean);
      run = needsE2e(paths);
      why = `${paths.length} files changed since ${from.slice(0, 7)}`;
    } else {
      why = "no green run to compare with";
    }
  } catch (err) {
    why = `couldn't compare (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`;
  }
  console.error(`e2e ${run ? "runs" : "skips"}: ${why}`);
  console.log(`e2e=${run}`);
}
