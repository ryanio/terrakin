import { hashWorld, residentById, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Ids in paths, queries, and bodies are looked up as their records' own keys, so one that names
 * something every object inherits finds nobody and changes nothing, in the world or the social
 * tables.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const DANGEROUS = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"];

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

async function start() {
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    days: true,
    economy: true,
    items: true,
    shop: true,
    market: true,
    bounties: true,
  });
  const sql = nodeSql();
  const maintainers = new Set<string>();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => residentById(service.state, id),
    maintainers,
  });
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  cleanups.push(() => sql.close());
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const join = (name: string) => {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  };
  return { call, join, service, maintainers };
}

describe("ids an object inherits", () => {
  it("find nobody on any route, and change nothing", async () => {
    const t = await start();
    const ada = t.join("Ada");
    const marlo = t.join("Marlo");
    t.maintainers.add(marlo.id);
    await t.call("POST", "/v1/actions", { type: "settle", px: 0, py: 0 }, ada.token);
    const before = hashWorld(t.service.state);
    for (const id of DANGEROUS) {
      const asAda: [string, string, unknown?][] = [
        ["GET", `/v1/residents/${id}`],
        ["GET", `/v1/residents/${id}/posts`],
        ["GET", `/v1/residents/${id}/followers`],
        ["PUT", `/v1/residents/${id}/follow`],
        ["PUT", `/v1/residents/${id}/block`],
        ["POST", `/v1/residents/${id}/praise`],
        ["POST", `/v1/residents/${id}/gesture`, { kind: "wave" }],
        ["GET", `/v1/town/proposals/${id}`],
        ["GET", `/v1/galleries?resident=${id}`],
        ["GET", `/v1/market?seller=${id}`],
        ...["resident", "proposal", "listing", "bounty", "display", "piece", "post"].map(
          (kind): [string, string, unknown] => [
            "POST",
            "/v1/reports",
            { kind, id, reason: "spam" },
          ],
        ),
        ...[
          { type: "give_coins", to: id, amount: 1 },
          { type: "give", item: "lemon_seed", to: id },
          { type: "share_plot", with: id },
          { type: "decline_gift", gift: id },
          { type: "buy_listing", listing: id },
          { type: "claim_bounty", bounty: id },
          { type: "vote", proposal: id, choice: "yes" },
        ].map((action): [string, string, unknown] => ["POST", "/v1/actions", action]),
      ];
      const asStaff: [string, string, unknown][] = [
        "suspend",
        "unsuspend",
        "quarantine",
        "release",
        "remove-pictures",
      ].map((verb) => [
        "POST",
        `/v1/admin/residents/${id}/${verb}`,
        { reason: "x", ...(verb === "suspend" ? { days: 1 } : {}) },
      ]);
      for (const [method, path, body] of asAda) {
        const res = await t.call(method, path, body, ada.token);
        const what = `${method} ${path} ${JSON.stringify(body ?? "")}`;
        expect(res.status, what).toBeLessThan(500);
        // Refused by the schema (400) or by the world (`ok: false`).
        if (path === "/v1/actions")
          expect(res.status >= 400 || res.body.ok === false, what).toBe(true);
        else if (method !== "GET" || path.includes("residents/") || path.includes("proposals/")) {
          expect(res.status, what).toBeGreaterThanOrEqual(400);
        }
      }
      for (const [method, path, body] of asStaff) {
        const res = await t.call(method, path, body, marlo.token);
        expect(res.status, path).toBeGreaterThanOrEqual(400);
        expect(res.status, path).toBeLessThan(500);
      }
    }
    expect(hashWorld(t.service.state)).toBe(before);
    const log = await t.call("GET", "/v1/admin/log", undefined, marlo.token);
    expect(log.body.entries).toEqual([]);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});
