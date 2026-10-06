import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashWorld,
  type Input,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldState,
} from "@terrakin/sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { nodeSql } from "./node-sql";
import { SNAPSHOT_TAIL, type SnapshotHeader, splitUtf8 } from "./snapshots";
import { type SqlExec, SqlStore } from "./sql-store";
import { JsonlStore, MemoryStore, type Store } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, WorldService } from "./world-service";

const reports: string[] = [];
const gauges: { name: string; value: number; from?: unknown }[] = [];
vi.mock("./telemetry", async (original) => ({
  ...(await original<typeof import("./telemetry")>()),
  report: (err: unknown) => {
    reports.push(err instanceof Error ? err.message : String(err));
  },
  gauge: (name: string, value: number, attributes: Record<string, unknown> = {}) => {
    gauges.push({ name, value, ...("from" in attributes ? { from: attributes.from } : {}) });
  },
}));

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};
/** A UTC day that isn't a multiple of 7, so its snapshot is verified from the one before. */
const DAY = 20_001;

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  reports.length = 0;
  gauges.length = 0;
  expect(problems.splice(0)).toEqual([]);
});

/** One world's SQLite, a clock, and ways to boot it, move it on, and read its snapshots. */
function harness() {
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  let now = DAY * DAY_MS + 3_600_000;
  const store = () => new SqlStore(sql);
  const h = {
    sql,
    boot: (config = CONFIG) =>
      new WorldService({
        store: store(),
        config,
        now: () => now,
        days: true,
        economy: true,
        verifySlice: 4,
      }),
    /** Move the clock to `day` (an hour in) and let the world see it. */
    toDay(service: WorldService, day: number) {
      now = day * DAY_MS + 3_600_000;
      service.tick();
    },
    later(ms: number) {
      now += ms;
    },
    headers: (): SnapshotHeader[] => store().snapshots.list(),
    /** Run the minute sweep's snapshot work until nothing is left to verify. */
    verifyAll(service: WorldService) {
      for (let i = 0; i < 200 && h.headers().some((x) => x.verified === 0); i++) {
        service.keepSnapshots();
      }
      expect(h.headers().filter((x) => x.verified === 0)).toEqual([]);
    },
  };
  return h;
}

/**
 * Two residents who settle (Ada's first plot brings her welcome gift) and walk. From their second
 * day `busy` gives coins too, so the log holds credits and done kinds.
 */
function people(service: WorldService) {
  const ada = service.createSession({ name: "Ada", kind: "human" }).residentId as string;
  const bob = service.createSession({ name: "Bob", kind: "agent" }).residentId as string;
  expect(service.act(ada, { type: "settle", px: 0, py: 0 }).ok).toBe(true);
  busy(service, ada, bob, false);
  return { ada, bob };
}

function busy(service: WorldService, ada: string, bob: string, gift = true) {
  for (const dir of ["n", "e", "s", "w"] as const) {
    expect(service.act(ada, { type: "move", dir }).ok).toBe(true);
  }
  if (gift) expect(service.act(ada, { type: "give_coins", to: bob, amount: 1 }).ok).toBe(true);
  const dir = (service.state.residents[bob]?.x ?? 0) > 6 ? "w" : "e";
  expect(service.act(bob, { type: "move", dir }).ok).toBe(true);
}

/** Make a full replay impossible: the first logged input now names nobody. */
function breakFirstInput(sql: SqlExec) {
  const nobody: Input = { actor: "nobody", command: { type: "move", dir: "n" } };
  sql.exec("UPDATE world_log SET input = ? WHERE seq = 1", JSON.stringify(nobody));
}

/** Rewrite a snapshot's body (and, with `rehash`, its world hash) so its SHA-256 still matches. */
function rewrite(
  sql: SqlExec,
  seq: number,
  change: (body: { world: WorldState; server: Record<string, unknown> }) => void,
  rehash = false,
) {
  const body = new SqlStore(sql).snapshots.body(seq);
  const parsed = JSON.parse(body);
  change(parsed);
  const text = JSON.stringify(parsed);
  sql.exec("DELETE FROM world_snapshot_part WHERE seq = ?", seq);
  sql.exec("INSERT INTO world_snapshot_part (seq, part, body) VALUES (?, 0, ?)", seq, text);
  const sha = createHash("sha256").update(text).digest("hex");
  sql.exec("UPDATE world_snapshot SET sha256 = ?, parts = 1 WHERE seq = ?", sha, seq);
  if (rehash) {
    sql.exec("UPDATE world_snapshot SET hash = ? WHERE seq = ?", hashWorld(parsed.world), seq);
  }
}

/** A world with two verified snapshots, a tail after the newest, and nobody online. */
function grown() {
  const h = harness();
  const first = h.boot();
  const { ada, bob } = people(first);
  h.verifyAll(first);
  h.toDay(first, DAY + 1);
  busy(first, ada, bob);
  h.verifyAll(first);
  busy(first, ada, bob);
  // Everyone goes idle before the restart, so the next boot has nobody to mark offline.
  h.later(3_600_000);
  first.sweepIdle();
  const [newest, older] = h.headers();
  if (!newest || !older) throw new Error("expected two snapshots");
  return { h, first, ada, bob, newest, older };
}

const camel = (column: string) => column.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** What a boot must rebuild, besides the world. */
const facts = (service: WorldService, id: string) => ({
  hash: service.hash(),
  seq: service.state.seq,
  age: service.residentAgeDays(id),
  done: [...service.doneCommands(id)].sort(),
  credits: service.credits(0),
});

describe("splitUtf8", () => {
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");

  it("cuts at the byte limit and never between the halves of a surrogate pair", () => {
    expect(splitUtf8("abc", 2)).toEqual({ parts: ["ab", "c"], bytes: 3 });
    expect(splitUtf8("a😀b", 4)).toEqual({ parts: ["a", "😀", "b"], bytes: 6 });
    expect(splitUtf8("", 4)).toEqual({ parts: [""], bytes: 0 });
  });

  it("keeps every part valid and within the limit, and loses nothing", () => {
    const pieces = ["a", "é", "€", "😀", "{", '"', "ß", "🌱", "z"];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let round = 0; round < 200; round++) {
      const text = Array.from({ length: next() % 60 }, () => pieces[next() % pieces.length]).join(
        "",
      );
      const max = 4 + (next() % 12);
      const { parts, bytes: total } = splitUtf8(text, max);
      expect(parts.join("")).toBe(text);
      expect(total).toBe(bytes(text));
      for (const part of parts) {
        expect(bytes(part)).toBeLessThanOrEqual(max);
        expect(Buffer.from(part, "utf8").toString("utf8")).toBe(part);
      }
    }
  });
});

describe("Store.eachInput", () => {
  const log: Input[] = ["n", "e", "s", "w", "n"].map((dir) => ({
    actor: "ada",
    command: { type: "move", dir } as Input["command"],
  }));

  const stores: [string, () => Store][] = [
    ["MemoryStore", () => new MemoryStore()],
    [
      "JsonlStore",
      () => {
        const dir = mkdtempSync(join(tmpdir(), "terrakin-"));
        cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
        return new JsonlStore(dir);
      },
    ],
    [
      "SqlStore",
      () => {
        const sql = nodeSql();
        cleanups.push(() => sql.close());
        return new SqlStore(sql);
      },
    ],
  ];

  for (const [name, make] of stores) {
    it(`visits the inputs after one seq, up to another, with their seq (${name})`, () => {
      const store = make();
      for (const input of log) store.appendInput(input);
      const seen = (after: number, until?: number) => {
        const out: [number, string][] = [];
        store.eachInput(after, (input, seq) => out.push([seq, JSON.stringify(input)]), until);
        return out;
      };
      expect(seen(0).map(([seq]) => seq)).toEqual([1, 2, 3, 4, 5]);
      expect(seen(0).map(([, text]) => text)).toEqual(log.map((i) => JSON.stringify(i)));
      expect(seen(2).map(([seq]) => seq)).toEqual([3, 4, 5]);
      expect(seen(1, 3).map(([seq]) => seq)).toEqual([2, 3]);
      expect(seen(5)).toEqual([]);
    });
  }

  it("keeps a snapshot body in parts and reads it back whole", () => {
    const sql = nodeSql();
    cleanups.push(() => sql.close());
    const snapshots = new SqlStore(sql).snapshots;
    const header: SnapshotHeader = {
      seq: 9,
      format: 1,
      replayVersion: 1,
      hash: "h",
      sha256: "s",
      parts: 3,
      bytes: 5,
      verified: 0,
    };
    snapshots.save(header, ["ab", "cd", "e"], []);
    expect(snapshots.body(9)).toBe("abcde");
    expect(snapshots.list()).toEqual([header]);
    snapshots.mark(9, 1, []);
    expect(snapshots.list()[0]?.verified).toBe(1);
  });
});

describe("snapshots", () => {
  it("are taken when a day starts, verified off the request path, and shown on GET /v1/health", async () => {
    const h = harness();
    const service = h.boot();
    // The boot's own tick started the first day.
    const [first] = h.headers();
    expect(first).toMatchObject({ seq: 1, format: 1, replayVersion: 1, verified: 0, parts: 1 });
    expect(service.snapshotInfo()).toBeUndefined();
    const { ada, bob } = people(service);
    h.verifyAll(service);
    expect(service.snapshotInfo()).toEqual({ seq: 1, hash: first?.hash });

    h.toDay(service, DAY + 1);
    const [second] = h.headers();
    expect(second).toMatchObject({ seq: service.state.seq, verified: 0 });
    // Its hash is what the world served at that seq.
    expect(second?.hash).toBe(service.hash());
    busy(service, ada, bob);
    h.verifyAll(service);
    expect(service.snapshotInfo()).toEqual({ seq: second?.seq, hash: second?.hash });

    const call = jsonCaller(await listenOnFreePort(createApp({ service, onResponse }), cleanups));
    const health = await call("GET", "/v1/health");
    expect(health.body).toMatchObject({ seq: service.state.seq, snapshot: { seq: second?.seq } });
    expect(reports).toEqual([]);
  });

  it("boot from the newest verified one and the inputs after it", () => {
    const { h, first, ada, newest } = grown();
    const want = facts(first, ada);
    breakFirstInput(h.sql);
    gauges.length = 0;
    const reborn = h.boot();
    expect(facts(reborn, ada)).toEqual(want);
    expect(gauges).toContainEqual({
      name: "world.boot_inputs",
      value: want.seq - newest.seq,
      from: "snapshot",
    });
    expect(reports).toEqual([]);
  });

  it("boot from the first input when there are none, and agree with a snapshot boot", () => {
    const { h, first, ada } = grown();
    const want = facts(first, ada);
    gauges.length = 0;
    h.sql.exec("DELETE FROM world_snapshot");
    h.sql.exec("DELETE FROM world_snapshot_part");
    expect(facts(h.boot(), ada)).toEqual(want);
    expect(gauges).toContainEqual({ name: "world.boot_inputs", value: want.seq, from: "log" });
  });

  const tampers: [string, (sql: SqlExec, seq: number, ada: string) => void][] = [
    [
      "seq",
      (sql, seq) =>
        rewrite(sql, seq, (body) => {
          body.world.seq += 1;
        }),
    ],
    [
      "sha256",
      (sql, seq) =>
        sql.exec("UPDATE world_snapshot_part SET body = body || ' ' WHERE seq = ?", seq),
    ],
    [
      "hash",
      (sql, seq) =>
        rewrite(sql, seq, (body) => {
          body.world.blocks["0,0"] = "stone";
        }),
    ],
    [
      "supply",
      (sql, seq, ada) =>
        rewrite(
          sql,
          seq,
          (body) => {
            const coins = body.world.economy?.coins;
            if (coins) coins[ada] = (coins[ada] ?? 0) + 5;
          },
          true,
        ),
    ],
  ];

  for (const [check, tamper] of tampers) {
    it(`that fail the ${check} check are reported, dropped, and skipped for an older one`, () => {
      const { h, first, ada, newest, older } = grown();
      const want = facts(first, ada);
      tamper(h.sql, newest.seq, ada);
      gauges.length = 0;
      const reborn = h.boot();
      expect(facts(reborn, ada)).toEqual(want);
      expect(reports).toEqual([`Snapshot unusable: ${check}`]);
      expect(h.headers().map((x) => x.seq)).not.toContain(newest.seq);
      expect(gauges).toContainEqual({
        name: "world.boot_inputs",
        value: want.seq - older.seq,
        from: "snapshot",
      });
    });
  }

  for (const column of ["replay_version", "format"]) {
    it(`with another ${column} are left alone, and the boot uses an older one`, () => {
      const { h, first, ada, newest, older } = grown();
      const want = facts(first, ada);
      h.sql.exec(`UPDATE world_snapshot SET ${column} = 2 WHERE seq = ?`, newest.seq);
      gauges.length = 0;
      expect(facts(h.boot(), ada)).toEqual(want);
      expect(reports).toEqual([]);
      expect(h.headers()[0]).toMatchObject({ seq: newest.seq, verified: 1, [camel(column)]: 2 });
      expect(gauges).toContainEqual({
        name: "world.boot_inputs",
        value: want.seq - older.seq,
        from: "snapshot",
      });
    });
  }

  it("made for another world config are left alone, and the boot replays the log", () => {
    const { h, ada } = grown();
    const config = { ...CONFIG, maxPlotsPerResident: 2 };
    gauges.length = 0;
    const reborn = h.boot(config);
    expect(reborn.state.config).toEqual(config);
    expect(reborn.residentAgeDays(ada)).toBe(1);
    expect(reports).toEqual([]);
    expect(h.headers().map((x) => x.verified)).toEqual([1, 1]);
    expect(gauges).toContainEqual({
      name: "world.boot_inputs",
      value: reborn.state.seq,
      from: "log",
    });
  });

  it("are skipped when the log after them has a gap, and none are taken after", () => {
    const { h, first, newest, older } = grown();
    h.sql.exec("DELETE FROM world_log WHERE seq = ?", newest.seq + 1);
    gauges.length = 0;
    const reborn = h.boot();
    expect(reports).toEqual([
      `Log skips from seq ${newest.seq} to ${newest.seq + 2}`,
      `Log skips from seq ${newest.seq} to ${newest.seq + 2}`,
      "world_log seq doesn't match the world's; snapshots are off",
    ]);
    expect(older.seq).toBeLessThan(newest.seq);
    expect(reborn.state.seq).toBe(first.state.seq - 1);
    expect(gauges).toContainEqual({
      name: "world.boot_inputs",
      value: reborn.state.seq,
      from: "log",
    });
    const before = h.headers();
    h.toDay(reborn, DAY + 2);
    reborn.keepSnapshots();
    expect(h.headers()).toEqual(before);
  });

  it("are never taken when the log's rows don't start at 1", () => {
    const h = harness();
    new SqlStore(h.sql);
    const row = (seq: number, input: Input) =>
      h.sql.exec("INSERT INTO world_log (seq, input) VALUES (?, ?)", seq, JSON.stringify(input));
    row(5, { actor: TOWN_ACTOR, command: { type: "new_day", day: DAY - 1 } });
    row(6, { actor: "ada", command: { type: "join", name: "Ada", kind: "human" } });
    const service = h.boot();
    expect(reports).toEqual(["world_log seq doesn't match the world's; snapshots are off"]);
    // The boot's own tick started a new day, which would otherwise take one.
    expect(service.state.day).toBe(DAY);
    expect(h.headers()).toEqual([]);
  });

  it("are never taken while the coin supply doesn't add up", () => {
    const h = harness();
    const service = h.boot();
    const { ada } = people(service);
    h.verifyAll(service);
    const coins = service.state.economy?.coins;
    if (!coins) throw new Error("expected coins");
    coins[ada] = (coins[ada] ?? 0) + 1;
    const before = h.headers();
    h.toDay(service, DAY + 1);
    expect(h.headers()).toEqual(before);
    expect(reports).toEqual(["Coin supply doesn't add up; no snapshot taken"]);
    expect(gauges).toContainEqual({ name: "world.supply_holds", value: 1 });
  });

  it("report a log row that won't parse by its kind alone, never its text", () => {
    const { h, newest } = grown();
    h.sql.exec(
      "UPDATE world_log SET input = ? WHERE seq = ?",
      '{"actor":"ada","command":{"type":"profile","note":"my secret note"',
      newest.seq + 1,
    );
    expect(() => h.boot()).toThrow();
    expect(reports.length).toBeGreaterThan(0);
    for (const message of reports) {
      expect(message).toBe("Log or snapshot storage failed: SyntaxError");
    }
  });

  it("that don't match their replay are never verified", () => {
    const h = harness();
    const service = h.boot();
    const { ada } = people(service);
    h.verifyAll(service);
    h.toDay(service, DAY + 1);
    const [pending] = h.headers();
    if (!pending) throw new Error("expected a snapshot");
    rewrite(h.sql, pending.seq, (body) => {
      (body.server.done as Record<string, string[]>)[ada] = ["join"];
    });
    h.verifyAll(service);
    expect(reports).toEqual(["Snapshot doesn't match its replay"]);
    expect(h.headers().map((x) => x.seq)).toEqual([1]);
    expect(service.snapshotInfo()?.seq).toBe(1);
  });

  it("verify from the one before, and from the first input on every seventh day", () => {
    const h = harness();
    const service = h.boot();
    people(service);
    h.verifyAll(service);
    // A replay from the first input now fails; one from the snapshot before doesn't read it.
    breakFirstInput(h.sql);
    h.toDay(service, DAY + 1);
    h.verifyAll(service);
    const chained = h.headers()[0];
    expect(chained).toMatchObject({ verified: 1 });
    expect(reports).toEqual([]);

    const weekly = 20_006;
    expect(weekly % 7).toBe(0);
    h.toDay(service, weekly);
    h.verifyAll(service);
    expect(reports).toEqual(["Replay diverged at entry 0: not_joined"]);
    expect(h.headers()[0]?.seq).toBe(chained?.seq);
    expect(service.snapshotInfo()?.seq).toBe(chained?.seq);
  });

  it("keep the newest three verified", () => {
    const h = harness();
    const service = h.boot();
    const { ada, bob } = people(service);
    for (let day = DAY + 1; day <= DAY + 5; day++) {
      h.toDay(service, day);
      busy(service, ada, bob);
      h.verifyAll(service);
    }
    const headers = h.headers();
    expect(headers).toHaveLength(3);
    expect(headers.every((x) => x.verified === 1)).toBe(true);
    expect(headers[0]?.seq).toBe(service.snapshotInfo()?.seq);
  });

  it(`are taken when the log grows ${SNAPSHOT_TAIL} inputs past the newest`, () => {
    const h = harness();
    // A log from before snapshots: today's day, and a long walk back and forth.
    const store = new SqlStore(h.sql);
    store.appendInput({ actor: TOWN_ACTOR, command: { type: "new_day", day: DAY } });
    store.appendInput({ actor: "ada", command: { type: "join", name: "Ada", kind: "human" } });
    h.sql.exec("BEGIN");
    for (let i = 0; i < SNAPSHOT_TAIL; i++) {
      const dir = i % 2 === 0 ? "n" : "s";
      store.appendInput({ actor: "ada", command: { type: "move", dir } });
    }
    h.sql.exec("COMMIT");
    const service = h.boot();
    expect(h.headers()).toEqual([]);
    service.keepSnapshots();
    expect(h.headers()).toMatchObject([{ seq: service.state.seq, verified: 0 }]);
  });
});
