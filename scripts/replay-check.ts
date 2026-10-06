/**
 * Replay the live world's input log under this checkout's sim, before a deploy (RFC 0014, step 3).
 * A boot from a snapshot no longer re-runs old inputs, so a rule change that would replay them
 * differently has to be caught here, or by the World object's weekly replay.
 *
 *   node scripts/replay-check.ts [--base https://admin.terrakin.org]
 *
 * It pages through `GET /v1/admin/world-log` (maintainers only), applies every input, and checks
 * that the world reaches the `hash` the live world had at the first page's `seq`, and the newest
 * verified snapshot's `hash` on the way. Nothing is written to disk and no input is printed: the
 * log holds residents' words and gift notes.
 *
 * It signs in through Cloudflare Access with `TERRAKIN_ACCESS_TOKEN`, else `cloudflared access
 * token` (after `cloudflared access login https://admin.terrakin.org`). Where Access isn't set up,
 * like a local server, `TERRAKIN_STAFF_TOKEN` is a maintainer's bearer token.
 *
 * Exit codes: 0 the replay matched, 1 it didn't, 2 it couldn't run (no sign-in, or no export).
 * `pnpm cf:deploy` runs it and refuses to deploy on 1.
 */
import { execFileSync } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
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

import type { Input, WorldConfig } from "../sim/src/index.ts";

/** One page of `GET /v1/admin/world-log`. */
export interface LogPage {
  seq: number;
  hash: string;
  /** The live sim's `REPLAY_VERSION`. */
  replayVersion?: number;
  snapshot?: { seq: number; hash: string };
  rows: { seq: number; input: Input }[];
  next?: number;
}

/** Read the page of rows after `after`, stopping at `until`. */
export type ReadPage = (after: number, until: number | undefined) => Promise<LogPage>;

export type CheckResult =
  | { status: "passed"; lines: string[] }
  | { status: "failed"; lines: string[] }
  | { status: "skipped"; lines: string[] };

/** Why the check couldn't run, in words with no log text in them. */
export class CheckError extends Error {}

/** A reason the check couldn't run that shouldn't hold a deploy back. */
class Skip extends CheckError {}

/**
 * An error as this script may print it. CI logs are public, and a stray error's message can quote
 * the log (a `JSON.parse` error quotes the text, and a `TypeError` can quote a string value), so
 * anything but this script's own errors is named by its kind alone.
 */
export const describeError = (err: unknown) =>
  err instanceof CheckError
    ? err.message
    : `${err instanceof Error ? err.name : typeof err} (details left out: they can quote the log)`;

/**
 * Replay every page from the first input under this checkout's sim, and compare. `config` is the
 * world's (terrakin.org runs the default). Only codes, `seq`s, and hashes go into the result.
 *
 * A live world on another `REPLAY_VERSION` is expected to hash differently (a deliberate change,
 * decision 0070): then every input must still be accepted, and the result gives the new hash.
 */
export async function replayCheck(read: ReadPage, config?: WorldConfig): Promise<CheckResult> {
  // Extensionless, like the sim's own imports: the hook above finds the file, and so does Vite
  // when a server test imports this.
  const { apply, createWorld, DEFAULT_CONFIG, hashWorld, REPLAY_VERSION } = await import(
    "../sim/src/index"
  );
  let after = 0;
  let page = await read(after, undefined);
  const target = { seq: page.seq, hash: page.hash };
  const live = page.replayVersion ?? REPLAY_VERSION;
  const bumped = live !== REPLAY_VERSION;
  const snapshot = bumped ? undefined : page.snapshot;
  const state = createWorld(config ?? DEFAULT_CONFIG);
  const lines: string[] = [];
  const failed = (line: string): CheckResult => ({ status: "failed", lines: [...lines, line] });
  for (;;) {
    for (const row of page.rows) {
      if (row.seq !== state.seq + 1) {
        return failed(`The log skips from seq ${state.seq} to ${row.seq}.`);
      }
      let result: ReturnType<typeof apply>;
      try {
        result = apply(state, row.input);
      } catch (err) {
        return failed(
          `Replay threw at seq ${row.seq}: ${err instanceof Error ? err.name : "error"}.`,
        );
      }
      if (!result.ok) {
        return failed(`Replay diverged at seq ${row.seq}: ${result.rejection.code}.`);
      }
      if (snapshot?.seq === state.seq) {
        const hash = hashWorld(state);
        if (hash !== snapshot.hash) {
          return failed(
            `At the verified snapshot's seq ${snapshot.seq} the replay hashes ${hash}, not ${snapshot.hash}.`,
          );
        }
        lines.push(`Snapshot at seq ${snapshot.seq}: hash ${hash} matches.`);
      }
    }
    if (page.next === undefined) break;
    if (page.next <= after) return failed(`The export didn't move past seq ${after}.`);
    after = page.next;
    page = await read(after, target.seq);
  }
  if (state.seq !== target.seq) {
    return failed(`The log ends at seq ${state.seq}, not ${target.seq}.`);
  }
  const hash = hashWorld(state);
  if (bumped) {
    lines.push(
      `The live world replays under REPLAY_VERSION ${live} and this sim under ${REPLAY_VERSION}, so the hash is expected to change. Every input was accepted; the new hash at seq ${target.seq} is ${hash} (was ${target.hash}). Give it in the changelog entry.`,
    );
    return { status: "passed", lines };
  }
  if (hash !== target.hash) {
    return failed(`At seq ${target.seq} the replay hashes ${hash}, not ${target.hash}.`);
  }
  if (!snapshot) lines.push("No verified snapshot yet, so only the whole log was checked.");
  lines.push(`Replayed ${target.seq} inputs: hash ${hash} matches the live world.`);
  return { status: "passed", lines };
}

/** Whether `base` is this machine, where a plain http server and a resident token are fine. */
const isLocal = (base: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(base);

/**
 * The headers that sign a request in, or undefined when there's no sign-in to use. An Access
 * sign-in comes first. A maintainer's bearer token (`TERRAKIN_STAFF_TOKEN`) is only for a server on
 * this machine, where Access isn't set up, so a token left set from testing never goes to the
 * live world.
 */
export function signIn(base: string): Record<string, string> | undefined {
  const access = process.env.TERRAKIN_ACCESS_TOKEN?.trim();
  if (access) return { "cf-access-token": access };
  if (isLocal(base)) {
    const staff = process.env.TERRAKIN_STAFF_TOKEN?.trim();
    return staff ? { authorization: `Bearer ${staff}` } : undefined;
  }
  try {
    const token = execFileSync("cloudflared", ["access", "token", `-app=${base}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    }).trim();
    return token.startsWith("ey") ? { "cf-access-token": token } : undefined;
  } catch {
    return undefined;
  }
}

/** How long one page may take before the check gives up and lets the deploy go ahead. */
const PAGE_TIMEOUT_MS = 30_000;

/** Page through the live world's export at `base` and replay it. */
export async function checkLive(base: string): Promise<CheckResult> {
  if (!base.startsWith("https://") && !isLocal(base)) {
    return { status: "skipped", lines: [`Not sending a sign-in over plain http to ${base}.`] };
  }
  const headers = signIn(base);
  if (!headers) {
    return {
      status: "skipped",
      lines: [
        "No staff sign-in, so the live log wasn't replayed. Set TERRAKIN_ACCESS_TOKEN, or run `cloudflared access login https://admin.terrakin.org` first. The World object replays its log from the first input every seventh day either way.",
      ],
    };
  }
  const read: ReadPage = async (after, until) => {
    const query = new URLSearchParams({ after: String(after) });
    if (until !== undefined) query.set("until", String(until));
    let res: Response;
    try {
      res = await fetch(`${base}/v1/admin/world-log?${query}`, {
        headers: { ...headers, accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Skip(`The live world didn't answer within ${PAGE_TIMEOUT_MS / 1000} seconds.`);
      }
      throw new Skip(`The live world couldn't be reached (${describeError(err)}).`);
    }
    if (res.status === 404) throw new Skip("The live world has no log export yet.");
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      throw new Skip(`The live world refused the sign-in (HTTP ${res.status}).`);
    }
    if (!res.ok) throw new Skip(`The log export answered HTTP ${res.status}.`);
    try {
      return (await res.json()) as LogPage;
    } catch {
      // A parse error quotes the text it choked on, which is the log: never print it.
      throw new CheckError("The log export wasn't JSON.");
    }
  };
  try {
    return await replayCheck(read);
  } catch (err) {
    if (err instanceof Skip) return { status: "skipped", lines: [err.message] };
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { base: { type: "string", default: "https://admin.terrakin.org" } },
  });
  try {
    const result = await checkLive(values.base.replace(/\/$/, ""));
    for (const line of result.lines) console.log(line);
    process.exit(result.status === "passed" ? 0 : result.status === "failed" ? 1 : 2);
  } catch (err) {
    console.error(`The replay check couldn't run: ${describeError(err)}`);
    process.exit(2);
  }
}
