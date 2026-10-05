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
 *   node scripts/deploy.ts [wrangler deploy args]
 */
import { execFileSync } from "node:child_process";
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
    process.exit(check.skip ? 0 : 1);
  }
  execFileSync("wrangler", ["deploy", ...process.argv.slice(2)], { stdio: "inherit" });
}
