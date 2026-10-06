import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PRESENCE_CONFIG, PRESENCE_LOG } from "../packages/sim/src/fixtures/presence-log";
import { hashWorld } from "../packages/sim/src/hash";
import { replay } from "../packages/sim/src/replay";
import type { Input, WorldConfig } from "../packages/sim/src/types";
import { DEFAULT_CONFIG } from "../packages/sim/src/world";
import {
  CheckError,
  checkLive,
  describeError,
  type LogPage,
  type ReadPage,
  replayCheck,
  signIn,
} from "./replay-check";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A world log served a few rows a page, as `GET /v1/admin/world-log` would. */
function export_(
  log: readonly Input[],
  over: { hash?: string; snapshot?: { seq: number; hash: string } } = {},
  config: WorldConfig = PRESENCE_CONFIG,
): ReadPage {
  const seq = log.length;
  const hash = over.hash ?? hashWorld(replay(config, log));
  const snapshotAt = Math.min(40, seq);
  const snapshot = over.snapshot ?? {
    seq: snapshotAt,
    hash: hashWorld(replay(config, log.slice(0, snapshotAt))),
  };
  return async (after, until) => {
    const last = Math.min(until ?? seq, seq);
    const end = Math.min(last, after + 7);
    const rows = log.slice(after, end).map((input, i) => ({ seq: after + i + 1, input }));
    return { seq, hash, snapshot, rows, ...(end < last ? { next: end } : {}) } satisfies LogPage;
  };
}

describe("replayCheck", () => {
  it("passes when the log replays to the live hash and the snapshot's", async () => {
    const result = await replayCheck(export_(PRESENCE_LOG), PRESENCE_CONFIG);
    expect(result).toEqual({
      status: "passed",
      lines: [
        expect.stringMatching(/^Snapshot at seq 40: hash \w+ matches\.$/),
        expect.stringMatching(new RegExp(`^Replayed ${PRESENCE_LOG.length} inputs`)),
      ],
    });
  });

  it("fails when the live hash differs", async () => {
    const result = await replayCheck(export_(PRESENCE_LOG, { hash: "00000000" }), PRESENCE_CONFIG);
    expect(result.status).toBe("failed");
    expect(result.lines.at(-1)).toMatch(/hashes \w+, not 00000000\.$/);
  });

  it("fails when the snapshot's hash differs", async () => {
    const read = export_(PRESENCE_LOG, { snapshot: { seq: 12, hash: "00000000" } });
    const result = await replayCheck(read, PRESENCE_CONFIG);
    expect(result).toEqual({
      status: "failed",
      lines: [expect.stringMatching(/^At the verified snapshot's seq 12 the replay hashes/)],
    });
  });

  it("fails on an input this sim refuses, naming its seq and code but never its words", async () => {
    const log: Input[] = [
      ...PRESENCE_LOG.slice(0, 5),
      { actor: "nobody", command: { type: "profile", note: "my secret words" } },
    ];
    const snapshot = { seq: 3, hash: hashWorld(replay(PRESENCE_CONFIG, log.slice(0, 3))) };
    const result = await replayCheck(export_(log, { hash: "00000000", snapshot }), PRESENCE_CONFIG);
    expect(result.status).toBe("failed");
    expect(result.lines.at(-1)).toBe("Replay diverged at seq 6: not_joined.");
    expect(result.lines.join(" ")).not.toContain("secret");
  });

  it("fails, naming only the error's kind, when this sim throws on an input", async () => {
    const log = [...PRESENCE_LOG.slice(0, 4), { actor: "ada", command: null } as unknown as Input];
    const snapshot = { seq: 3, hash: hashWorld(replay(PRESENCE_CONFIG, log.slice(0, 3))) };
    const result = await replayCheck(export_(log, { hash: "00000000", snapshot }), PRESENCE_CONFIG);
    expect(result.status).toBe("failed");
    expect(result.lines.at(-1)).toBe("Replay threw at seq 5: TypeError.");
  });

  it("passes a deliberate REPLAY_VERSION change and gives the new hash", async () => {
    const read = export_(PRESENCE_LOG, { hash: "00000000" });
    const bumped: ReadPage = async (after, until) => ({
      ...(await read(after, until)),
      replayVersion: 0,
    });
    const result = await replayCheck(bumped, PRESENCE_CONFIG);
    const hash = hashWorld(replay(PRESENCE_CONFIG, PRESENCE_LOG));
    expect(result.status).toBe("passed");
    expect(result.lines.at(-1)).toContain(`the new hash at seq ${PRESENCE_LOG.length} is ${hash}`);
  });

  it("fails when the export doesn't move forward", async () => {
    const read = export_(PRESENCE_LOG);
    const stuck: ReadPage = async (after, until) => ({ ...(await read(after, until)), next: 0 });
    const result = await replayCheck(stuck, PRESENCE_CONFIG);
    expect(result).toEqual({ status: "failed", lines: ["The export didn't move past seq 0."] });
  });

  it("fails when the log skips a seq", async () => {
    const read = export_(PRESENCE_LOG);
    const gap: ReadPage = async (after, until) => {
      const page = await read(after, until);
      return { ...page, rows: page.rows.filter((r) => r.seq !== 9) };
    };
    const result = await replayCheck(gap, PRESENCE_CONFIG);
    expect(result).toEqual({ status: "failed", lines: ["The log skips from seq 8 to 10."] });
  });
});

describe("describeError", () => {
  it("prints its own errors, and only the kind of any other, which could quote the log", () => {
    expect(describeError(new CheckError("The log export wasn't JSON."))).toBe(
      "The log export wasn't JSON.",
    );
    const quoting = new TypeError("Cannot create property 'seen' on string 'my secret words'");
    expect(describeError(quoting)).not.toContain("secret");
    expect(describeError(quoting)).toMatch(/^TypeError/);
  });
});

describe("checkLive", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  // A real sign-in on this machine must never reach the test servers below.
  delete process.env.TERRAKIN_ACCESS_TOKEN;

  it("uses a staff token only on this machine, and an Access sign-in first", () => {
    delete process.env.TERRAKIN_ACCESS_TOKEN;
    process.env.TERRAKIN_STAFF_TOKEN = "staff-token";
    process.env.PATH = "";
    expect(signIn("http://127.0.0.1:8787")).toEqual({ authorization: "Bearer staff-token" });
    expect(signIn("https://admin.terrakin.org")).toBeUndefined();
    process.env.TERRAKIN_ACCESS_TOKEN = "eyAccess";
    expect(signIn("http://127.0.0.1:8787")).toEqual({ "cf-access-token": "eyAccess" });
  });

  it("never sends a sign-in over plain http to another machine", async () => {
    process.env.TERRAKIN_ACCESS_TOKEN = "eyAccess";
    expect(await checkLive("http://admin.example.com")).toEqual({
      status: "skipped",
      lines: ["Not sending a sign-in over plain http to http://admin.example.com."],
    });
  });

  /**
   * A server answering the export route with `answer`, and the base URL to reach it. An answer
   * with a `read` serves that page instead of its body.
   */
  async function serve(
    answer: (
      url: URL,
      auth: string | undefined,
    ) => [number, unknown] | [number, unknown, ReadPage, number, string | null],
  ) {
    const server = createServer(async (req, res) => {
      const [status, body, read, after, until] = answer(
        new URL(req.url ?? "/", "http://x"),
        req.headers.authorization,
      );
      const page = read ? await read(after ?? 0, until ? Number(until) : undefined) : body;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(page));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("pages through the export with the staff token and replays it", async () => {
    delete process.env.TERRAKIN_ACCESS_TOKEN;
    process.env.TERRAKIN_STAFF_TOKEN = "staff-token";
    // terrakin.org runs the default world: two residents walking about in it.
    const walk = (actor: string, dirs: string): Input[] =>
      [...dirs].map((dir) => ({ actor, command: { type: "move", dir } }) as Input);
    const log: Input[] = [
      { actor: "ada", command: { type: "join", name: "Ada", kind: "human" } },
      { actor: "bob", command: { type: "join", name: "Bob", kind: "agent" } },
      ...walk("ada", "nnnneeee"),
      ...walk("bob", "sssswwww"),
    ];
    const read = export_(log, {}, DEFAULT_CONFIG);
    const asked: string[] = [];
    const base = await serve((url, auth) => {
      if (auth !== "Bearer staff-token") return [401, { error: { code: "unauthorized" } }];
      asked.push(url.search);
      const until = url.searchParams.get("until");
      return [200, null, read, Number(url.searchParams.get("after")), until];
    });
    const result = await checkLive(base);
    expect(result.status).toBe("passed");
    expect(asked).toEqual(["?after=0", "?after=7&until=18", "?after=14&until=18"]);
  });

  it("skips without a sign-in, when the live world has no export, or refuses the sign-in", async () => {
    delete process.env.TERRAKIN_ACCESS_TOKEN;
    delete process.env.TERRAKIN_STAFF_TOKEN;
    process.env.PATH = "";
    expect((await checkLive("http://127.0.0.1:9")).status).toBe("skipped");

    process.env.TERRAKIN_STAFF_TOKEN = "staff-token";
    const missing = await serve(() => [404, { error: { code: "not_found" } }]);
    expect(await checkLive(missing)).toEqual({
      status: "skipped",
      lines: ["The live world has no log export yet."],
    });
    const refused = await serve(() => [403, { error: { code: "forbidden" } }]);
    expect((await checkLive(refused)).lines).toEqual([
      "The live world refused the sign-in (HTTP 403).",
    ]);
  });
});
