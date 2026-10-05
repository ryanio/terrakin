import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { Api, type ApiRequest } from "./api";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { ADMIN_PAGE_HEADERS, STAFF_EMAIL_HEADER, toWorld } from "./pages";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { responseChecker } from "./test-support";
import { WorldService } from "./world-service";

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

/** An Api to call directly, so a test can be the Worker that verified an Access sign-in. */
function direct(access: boolean) {
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const maintainers = new Set<string>();
  const moderators = new Set<string>();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id) => service.state.residents[id],
    maintainers,
    moderators,
  });
  const api = new Api({
    service,
    social,
    skill: "",
    openapi: "",
    sessionsPerMinute: 1000,
    onResponse,
    staff: {
      access,
      maintainerEmails: new Set(["ryan@example.com"]),
      moderatorEmails: new Set(["mod@example.com"]),
    },
  });
  async function call(
    method: string,
    pathname: string,
    body?: unknown,
    extra: Partial<ApiRequest> = {},
  ) {
    const res = await api.handle({
      method,
      pathname,
      ip: "127.0.0.1",
      authorization: undefined,
      query: new URLSearchParams(),
      readJson: async () => body,
      readBytes: async () => undefined,
      contentLength: undefined,
      ...extra,
    });
    const text = typeof res?.body === "string" ? res.body : "";
    return { status: res?.status ?? 0, body: text ? JSON.parse(text) : undefined };
  }
  async function join(name: string) {
    const r = service.createSession({ name, kind: "agent" });
    return { id: r.residentId ?? "", token: r.token ?? "" };
  }
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  return { call, join, bearer, maintainers, moderators, social };
}

describe("staff roles", () => {
  it("lets moderators work the queue, suspend up to 7 days, and nothing more", async () => {
    const t = direct(false);
    const mod = await t.join("Mod");
    t.moderators.add(mod.id);
    const bo = await t.join("Bo");
    const as = t.bearer(mod.token);
    expect((await t.call("GET", "/v1/admin/reports", undefined, as)).status).toBe(200);
    const overview = await t.call("GET", "/v1/admin/overview", undefined, as);
    expect(overview.body.me).toMatchObject({ role: "moderator", via: "token" });
    const long = await t.call(
      "POST",
      `/v1/admin/residents/${bo.id}/suspend`,
      { days: 8, reason: "x" },
      as,
    );
    expect(long.status).toBe(403);
    const week = await t.call(
      "POST",
      `/v1/admin/residents/${bo.id}/suspend`,
      { days: 7, reason: "x" },
      as,
    );
    expect(week.status).toBe(200);
    // Maintainer-only tools stay maintainer-only.
    expect((await t.call("DELETE", "/v1/town/proposals/t_1", undefined, as)).status).toBe(403);
    // Staff can't be suspended.
    const mo = await t.join("Mo");
    t.maintainers.add(mo.id);
    const back = await t.call(
      "POST",
      `/v1/admin/residents/${mod.id}/suspend`,
      { days: 1, reason: "x" },
      t.bearer(mo.token),
    );
    expect(back.status).toBe(400);
    // Every action records who did it.
    const log = (await t.call("GET", "/v1/admin/log", undefined, as)).body.entries;
    expect(log[0]).toMatchObject({ action: "suspend", actor: mod.id, actorView: { name: "Mod" } });
  });

  it("refuses browser calls from anywhere but the admin site", async () => {
    const t = direct(false);
    const mo = await t.join("Mo");
    t.maintainers.add(mo.id);
    const from = (origin: string) => ({ ...t.bearer(mo.token), browserOrigin: origin });
    expect(
      (await t.call("GET", "/v1/admin/reports", undefined, from("https://terrakin.org"))).status,
    ).toBe(403);
    expect(
      (await t.call("GET", "/v1/admin/reports", undefined, from("https://evil.example"))).status,
    ).toBe(403);
    expect(
      (await t.call("GET", "/v1/admin/reports", undefined, from("https://admin.terrakin.org")))
        .status,
    ).toBe(200);
    expect(
      (await t.call("GET", "/v1/admin/reports", undefined, from("http://admin.localhost:8790")))
        .status,
    ).toBe(200);
  });
});

describe("with Cloudflare Access set up", () => {
  it("needs a verified Access sign-in, maps its email to a role, and ignores tokens", async () => {
    const t = direct(true);
    const mo = await t.join("Mo");
    t.maintainers.add(mo.id);
    // A maintainer's token no longer opens staff routes.
    expect((await t.call("GET", "/v1/admin/reports", undefined, t.bearer(mo.token))).status).toBe(
      401,
    );
    expect((await t.call("GET", "/v1/admin/reports")).status).toBe(401);
    expect(
      (await t.call("GET", "/v1/admin/reports", undefined, { staffEmail: "nobody@example.com" }))
        .status,
    ).toBe(403);
    const ryan = { staffEmail: "Ryan@Example.com" };
    const overview = await t.call("GET", "/v1/admin/overview", undefined, ryan);
    expect(overview.body.me).toEqual({
      actor: "access:ryan@example.com",
      role: "maintainer",
      via: "access",
      resident: null,
    });
    const bo = await t.join("Bo");
    const mod = { staffEmail: "mod@example.com" };
    expect(
      (await t.call("POST", `/v1/admin/residents/${bo.id}/suspend`, { days: 30, reason: "x" }, mod))
        .status,
    ).toBe(403);
    expect(
      (
        await t.call(
          "POST",
          `/v1/admin/residents/${bo.id}/suspend`,
          { days: 30, reason: "x" },
          ryan,
        )
      ).status,
    ).toBe(200);
    const log = (await t.call("GET", "/v1/admin/log", undefined, ryan)).body.entries;
    expect(log[0]).toMatchObject({ actor: "access:ryan@example.com", actorView: null });
  });
});

describe("the admin host on the Node server", () => {
  function get(port: number, host: string, path: string) {
    return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
      (resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        });
        req.on("error", reject);
        req.end();
      },
    );
  }

  it("serves the admin app only on admin.*, with strict headers, and moves /admin there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "terrakin-admin-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>site</title>");
    mkdirSync(join(dir, "_admin", "assets"), { recursive: true });
    writeFileSync(join(dir, "_admin", "index.html"), "<!doctype html><title>admin</title>");
    writeFileSync(join(dir, "_admin", "assets", "app.js"), "console.log(1)");
    const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
    const sql = nodeSql();
    cleanups.push(() => sql.close());
    const social = new SocialService({
      sql,
      media: new MemoryMediaStore(),
      resident: (id) => service.state.residents[id],
    });
    const server = createApp({ service, social, staticDir: dir, onResponse });
    await new Promise<void>((done) => server.listen(0, done));
    cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
    const port = (server.address() as AddressInfo).port;

    const page = await get(port, `admin.localhost:${port}`, "/queue");
    expect(page.body).toContain("<title>admin</title>");
    for (const [name, value] of Object.entries(ADMIN_PAGE_HEADERS)) {
      expect(page.headers[name], name).toBe(value);
    }
    expect((await get(port, `admin.localhost:${port}`, "/_admin/assets/app.js")).body).toContain(
      "console.log",
    );
    expect((await get(port, `admin.localhost:${port}`, "/_admin/assets/missing.js")).status).toBe(
      404,
    );
    expect((await get(port, `admin.localhost:${port}`, "/v1/health")).status).toBe(200);

    const moved = await get(port, `localhost:${port}`, "/admin");
    expect(moved.status).toBe(302);
    expect(moved.headers.location).toBe(`http://admin.localhost:${port}/`);
    expect((await get(port, `localhost:${port}`, "/_admin/index.html")).status).toBe(404);
    expect((await get(port, `localhost:${port}`, "/")).body).not.toContain("<title>admin</title>");
  });
});

describe("the Worker's hand-off to the world object", () => {
  it("drops a staff header anyone sent, and sets it only from a verified sign-in", () => {
    const url = new URL("https://admin.terrakin.org/v1/admin/reports");
    const forged = new Request(url, { headers: { [STAFF_EMAIL_HEADER]: "ryan@example.com" } });
    expect(toWorld(forged, url).headers.get(STAFF_EMAIL_HEADER)).toBeNull();
    expect(toWorld(forged, url, "mod@example.com").headers.get(STAFF_EMAIL_HEADER)).toBe(
      "mod@example.com",
    );
  });
});
