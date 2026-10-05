import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
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
import { listenOnFreePort, responseChecker } from "./test-support";
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
      ...(body === undefined ? {} : { contentType: "application/json" }),
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
    // Moderators can remove pictures too, but never staff's.
    const pictures = (id: string) =>
      t.call("POST", `/v1/admin/residents/${id}/remove-pictures`, { reason: "x" }, as);
    expect((await pictures(bo.id)).body.error.message).toBe("They have no avatar or banner.");
    expect((await pictures(mo.id)).body.error.message).toMatch(/^Staff's pictures/);
    // Moderators can take a listing down; a resident can't even ask whether one exists.
    const takeDown = (headers: Partial<ApiRequest>) =>
      t.call("POST", "/v1/admin/listings/l_1/remove", { reason: "x" }, headers);
    expect((await takeDown(as)).status).toBe(404);
    const odd = await t.call("POST", "/v1/admin/listings/__proto__/remove", { reason: "x" }, as);
    expect(odd.status).toBe(400);
    expect((await takeDown(t.bearer(bo.token))).status).toBe(403);
    expect((await takeDown({})).status).toBe(401);
    // Every action records who did it.
    const log = (await t.call("GET", "/v1/admin/log", undefined, as)).body.entries;
    expect(log[0]).toMatchObject({ action: "suspend", actor: mod.id, actorView: { name: "Mod" } });
  });

  it("never lets a moderator undo or change what a maintainer decided", async () => {
    const t = direct(false);
    const mo = await t.join("Mo");
    const mod = await t.join("Mod");
    const other = await t.join("Other mod");
    t.maintainers.add(mo.id);
    t.moderators.add(mod.id);
    t.moderators.add(other.id);
    const [bo, cy, dee] = [await t.join("Bo"), await t.join("Cy"), await t.join("Dee")];
    const act = (who: { token: string }, path: string, body: object) =>
      t.call("POST", path, { reason: "x", ...body }, t.bearer(who.token));
    const suspend = (who: { token: string }, id: string, days: number) =>
      act(who, `/v1/admin/residents/${id}/suspend`, { days });
    const unsuspend = (who: { token: string }, id: string) =>
      act(who, `/v1/admin/residents/${id}/unsuspend`, {});

    // A maintainer's suspension: a moderator can't end it or replace it with a shorter one.
    expect((await suspend(mo, bo.id, 3)).status).toBe(200);
    expect((await unsuspend(mod, bo.id)).status).toBe(403);
    expect((await suspend(mod, bo.id, 1)).status).toBe(403);
    // One with more than a week to run is a maintainer's call too, whoever set it.
    expect((await suspend(mo, cy.id, 30)).status).toBe(200);
    t.maintainers.delete(mo.id);
    expect((await unsuspend(mod, cy.id)).status).toBe(403);
    t.maintainers.add(mo.id);
    // A moderator's own short suspension, another moderator can change.
    expect((await suspend(mod, dee.id, 3)).status).toBe(200);
    expect((await suspend(other, dee.id, 5)).status).toBe(200);
    expect((await unsuspend(other, dee.id)).status).toBe(200);
    // And a maintainer can change anything.
    expect((await unsuspend(mo, bo.id)).status).toBe(200);

    // The same for a bio and note held back.
    expect((await act(mo, `/v1/admin/residents/${cy.id}/quarantine`, {})).status).toBe(200);
    expect((await act(mod, `/v1/admin/residents/${cy.id}/release`, {})).status).toBe(403);
    expect((await act(mod, `/v1/admin/residents/${dee.id}/quarantine`, {})).status).toBe(200);
    expect((await act(other, `/v1/admin/residents/${dee.id}/release`, {})).status).toBe(200);
    expect((await act(mo, `/v1/admin/residents/${cy.id}/release`, {})).status).toBe(200);

    // The queue says which of these only a maintainer may change, so the app can leave them out.
    expect((await suspend(mo, bo.id, 3)).status).toBe(200);
    expect((await suspend(mod, dee.id, 2)).status).toBe(200);
    expect((await act(mo, `/v1/admin/residents/${cy.id}/quarantine`, {})).status).toBe(200);
    const reporter = await t.join("Reporter");
    for (const id of [bo.id, cy.id, dee.id]) {
      const filed = await t.call(
        "POST",
        "/v1/reports",
        { kind: "resident", id, reason: "spam" },
        t.bearer(reporter.token),
      );
      expect(filed.status).toBe(201);
    }
    const queue = (await t.call("GET", "/v1/admin/reports", undefined, t.bearer(mod.token))).body;
    const target = (id: string) =>
      queue.items.find((i: { id: string }) => i.id === id)?.target as Record<string, unknown>;
    expect(target(bo.id)).toMatchObject({ suspended: true, suspensionLocked: true });
    expect(target(cy.id)).toMatchObject({ quarantined: true, holdBackLocked: true });
    expect(target(dee.id)).toMatchObject({ suspended: true });
    expect(target(dee.id)).not.toHaveProperty("suspensionLocked");
  });

  it("refuses browser calls from anywhere but the admin site's own origin", async () => {
    const t = direct(false);
    const mo = await t.join("Mo");
    t.maintainers.add(mo.id);
    const bo = await t.join("Bo");
    const at = (origin: string, browser: string, more: Partial<ApiRequest> = {}) => ({
      ...t.bearer(mo.token),
      origin,
      browserOrigin: browser,
      ...more,
    });
    const reports = (extra: Partial<ApiRequest>) =>
      t.call("GET", "/v1/admin/reports", undefined, extra);
    const admin = "https://admin.terrakin.org";
    for (const page of [
      "https://terrakin.org",
      "https://evil.example",
      "https://admin.evil.example",
      "https://admin.terrakin.org.evil.example",
      "http://admin.terrakin.org",
    ]) {
      expect((await reports(at(admin, page))).status, page).toBe(403);
    }
    // The main site's API refuses even its own pages.
    expect((await reports(at("https://terrakin.org", "https://terrakin.org"))).status).toBe(403);
    expect((await reports(at(admin, admin))).status).toBe(200);
    const local = "http://admin.localhost:8790";
    expect((await reports(at(local, local))).status).toBe(200);
    // Anything a browser marks cross-site is refused, Origin or not.
    expect((await reports({ ...t.bearer(mo.token), fetchSite: "cross-site" })).status).toBe(403);
    expect((await reports({ ...t.bearer(mo.token), fetchSite: "same-origin" })).status).toBe(200);

    // Writes must be JSON, so a plain form or a text/plain fetch from elsewhere can't make one.
    const suspend = (contentType: string | undefined) =>
      t.call(
        "POST",
        `/v1/admin/residents/${bo.id}/suspend`,
        { days: 1, reason: "x" },
        { ...at(admin, admin), contentType },
      );
    for (const type of ["text/plain", "application/x-www-form-urlencoded", undefined]) {
      expect((await suspend(type)).status, String(type)).toBe(400);
    }
    expect((await suspend("application/json; charset=utf-8")).status).toBe(200);
  });
});

describe("with Cloudflare Access set up", () => {
  it("needs a verified Access sign-in, maps its email to a role, and ignores tokens", async () => {
    const t = direct(true);
    const mo = await t.join("Mo");
    t.maintainers.add(mo.id);
    // A maintainer's token no longer opens staff routes, on terrakin.org or anywhere else.
    expect((await t.call("GET", "/v1/admin/reports", undefined, t.bearer(mo.token))).status).toBe(
      401,
    );
    for (const origin of ["https://terrakin.org", "https://admin.terrakin.org"]) {
      const call = await t.call("GET", "/v1/admin/reports", undefined, {
        ...t.bearer(mo.token),
        origin,
      });
      expect(call.status, origin).toBe(401);
    }
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
    // A resident's token is no staff sign-in, even for a listing.
    const takeDown = { reason: "x" };
    expect(
      (await t.call("POST", "/v1/admin/listings/l_1/remove", takeDown, t.bearer(bo.token))).status,
    ).toBe(401);
    expect((await t.call("POST", "/v1/admin/listings/l_1/remove", takeDown, mod)).status).toBe(404);
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
    const port = Number(new URL(await listenOnFreePort(server, cleanups)).port);

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
