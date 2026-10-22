import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Api } from "./api";
import { ChatterService, chatterConfig } from "./chatter";
import { FIRST_TABLES } from "./first-tables";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { SqlStore } from "./sql-store";
import { TownsfolkTips } from "./townsfolk-tips";
import { TownsfolkWelcome } from "./townsfolk-welcome";
import { TriageClient, triageConfig } from "./triage";
import { WorldService } from "./world-service";

type Db = ReturnType<typeof nodeSql>;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Everything the World object builds on its SQLite, in the Worker's order: the world store, the
 * social layer with triage, chatter, tips, welcomes, and the services `Api` makes for itself. The
 * Node server builds the same social layer on its own database and keeps the world in files.
 */
function boot(sql: Db) {
  const townsfolk = new Set<string>();
  const service = new WorldService({ store: new SqlStore(sql) });
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id) => service.state.residents[id],
    townsfolk,
    triage: new TriageClient(triageConfig({}), sql),
  });
  const chatter = new ChatterService({
    config: chatterConfig({}),
    social,
    townsfolk,
    world: service,
    residentAgeDays: () => 0,
  });
  const tips = new TownsfolkTips({ mode: "off", world: service, social, townsfolk });
  const welcome = new TownsfolkWelcome({ mode: "off", world: service, social, townsfolk, tips });
  new Api({ service, social, chatter, tips, welcome, skill: "", openapi: "" });
}

function made(boots: (sql: Db) => void): Db {
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  boots(sql);
  return sql;
}

const rows = (sql: Db, query: string) => [...sql.exec(query)];

function tablesOf(sql: Db): string[] {
  return rows(
    sql,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).map((r) => String(r.name));
}

const columnsOf = (sql: Db, table: string) =>
  rows(sql, `SELECT name, type, pk FROM pragma_table_info('${table}')`);

/**
 * A table's keys and indexes, each as its columns, so two tables built by different statements
 * compare equal when every `ON CONFLICT` and every lookup finds the same index on both.
 */
function keysOf(sql: Db, table: string): string[] {
  const pk = columnsOf(sql, table)
    .filter((c) => Number(c.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((c) => c.name);
  const indexes = rows(sql, `SELECT name, "unique", origin FROM pragma_index_list('${table}')`)
    .filter((i) => i.origin !== "pk")
    .map((i) => {
      const on = rows(sql, `SELECT name FROM pragma_index_info('${i.name}') ORDER BY seqno`);
      const named = i.origin === "c" ? `${i.name} ` : "";
      return `${named}${Number(i.unique) ? "unique " : ""}(${on.map((c) => c.name).join(", ")})`;
    });
  return [`primary key (${pk.join(", ")})`, ...indexes.sort()];
}

/** What a write naming every column the code knows, and the read of it back, come to. */
function writeAndRead(sql: Db, table: string, columns: Record<string, unknown>[]): unknown {
  const names = columns.map((c) => String(c.name));
  const values = columns.map((c) => (/INT/i.test(String(c.type)) ? 1 : "x"));
  try {
    sql.exec(
      `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
      ...values,
    );
    return rows(sql, `SELECT ${names.join(", ")} FROM ${table}`);
  } catch (err) {
    return String(err);
  }
}

describe("a database from before today's code", () => {
  it("boots up to the tables a fresh world has, and every column reads and writes", () => {
    const fresh = made(boot);
    const old = made((sql) => {
      for (const statement of FIRST_TABLES) sql.exec(statement);
      boot(sql);
    });
    const first = new Set(FIRST_TABLES.map((s) => s.match(/^CREATE TABLE (\w+)/)?.[1]));
    const problems: string[] = [];
    for (const table of tablesOf(fresh)) {
      if (!first.has(table)) {
        problems.push(`${table}: not in FIRST_TABLES; add the CREATE TABLE it ships with there`);
        continue;
      }
      const columns = columnsOf(fresh, table);
      const had = new Set(columnsOf(old, table).map((c) => c.name));
      const missing = columns.filter((c) => !had.has(c.name)).map((c) => c.name);
      if (missing.length > 0) {
        problems.push(`${table}: boot never adds ${missing.join(", ")} (ALTER TABLE ADD COLUMN)`);
        continue;
      }
      const keys = keysOf(fresh, table);
      if (keysOf(old, table).join("; ") !== keys.join("; ")) {
        problems.push(`${table}: keys differ: ${keysOf(old, table)} against ${keys}`);
      }
      const wrote = writeAndRead(fresh, table, columns);
      expect(wrote, `the fresh ${table} takes a row`).toBeInstanceOf(Array);
      const after = writeAndRead(old, table, columns);
      if (JSON.stringify(after) !== JSON.stringify(wrote)) {
        problems.push(`${table}: a write and read give ${JSON.stringify(after)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("boots every table the server's code creates", () => {
    // The test above checks only what `boot` makes, so a table whose service it never builds
    // would pass unseen. Every `CREATE TABLE` in the source has to come out of `boot`.
    const tables = new Set(tablesOf(made(boot)));
    const unbooted: string[] = [];
    for (const dir of [new URL(".", import.meta.url), new URL("../cloudflare/", import.meta.url)]) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file === "first-tables.ts") {
          continue;
        }
        const src = readFileSync(new URL(file, dir), "utf8");
        for (const [, name] of src.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(/g)) {
          if (name && !tables.has(name)) unbooted.push(`${file}: ${name}`);
        }
      }
    }
    expect(unbooted).toEqual([]);
  });
});
