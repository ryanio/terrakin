import { describe, expect, it } from "vitest";
import { nodeSql } from "./node-sql";

/**
 * A Durable Object's SQLite refuses queries stock SQLite takes (`SQL_LIMITS`, measured on
 * workerd). Node and every test refuse them too, so a query that would fail on terrakin.org fails
 * here first, as a 22-term UNION in the repeat-join reader did (TERRAKIN-API-2).
 */
describe("nodeSql holds Node to a Durable Object's limits", () => {
  const sql = nodeSql();
  sql.exec("CREATE TABLE t (a TEXT)");
  const union = (n: number) => Array.from({ length: n }, () => "SELECT a FROM t").join(" UNION ");

  it("takes a compound SELECT of 5 terms and refuses 6", () => {
    expect(() => sql.exec(union(5))).not.toThrow();
    expect(() => sql.exec(union(6))).toThrow("too many terms in compound SELECT");
    expect(() =>
      sql.exec(
        union(3)
          .replaceAll("UNION", "UNION ALL")
          .concat(" EXCEPT SELECT a FROM t INTERSECT SELECT a FROM t INTERSECT SELECT a FROM t"),
      ),
    ).toThrow("too many terms in compound SELECT");
  });

  it("counts a subquery's terms apart from the query around it, and never quoted text", () => {
    expect(() => sql.exec(`SELECT a FROM (${union(5)}) UNION ${union(4)}`)).not.toThrow();
    expect(() => sql.exec(`SELECT a FROM (${union(6)})`)).toThrow("compound SELECT");
    expect(() =>
      sql.exec(`${union(5)} UNION SELECT 'UNION UNION' -- UNION\nFROM t /* UNION */`),
    ).toThrow("compound SELECT");
    expect(() => sql.exec(`${union(4)} UNION SELECT 'UNION UNION' -- UNION\nFROM t`)).not.toThrow();
  });

  it("takes 100 bound values and refuses 101", () => {
    const within = (n: number) =>
      sql.exec(
        `SELECT a FROM t WHERE a IN (${Array(n).fill("?").join(", ")})`,
        ...Array(n).fill("x"),
      );
    expect(() => within(100)).not.toThrow();
    expect(() => within(101)).toThrow("too many SQL variables");
  });

  it("refuses a statement over 100,000 bytes", () => {
    expect(() => sql.exec(`SELECT 1${" ".repeat(99_000)}`)).not.toThrow();
    expect(() => sql.exec(`SELECT 1${" ".repeat(100_000)}`)).toThrow("statement too long");
  });
});
