import { ROUTES } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { DAY_MS } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { Api, type ApiRequest } from "./api";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { keyAllows } from "./staff-keys";
import { MemoryStore } from "./store";
import { responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Staff keys (RFC 0026), set up the way terrakin.org runs: staff sign in through Cloudflare Access,
 * and their AIs call the staff routes on the API with a key they made. A key acts as its maker,
 * never beyond its scope or their role, and the guards here are what keep it that way.
 */

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};

const cleanups: (() => void)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

const RYAN = "ryan@example.com";
const MO = "mo@example.com";

function town() {
  let now = Date.UTC(2026, 9, 7, 12);
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG, now: () => now });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    now: () => now,
  });
  const moderators = new Set([MO]);
  const api = new Api({
    service,
    social,
    skill: "",
    openapi: "",
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    now: () => now,
    onResponse,
    staff: { access: true, maintainerEmails: new Set([RYAN]), moderatorEmails: moderators },
  });

  /** A call as a staff member signed in through Access, or with a key or token as `auth`. */
  async function call(
    method: string,
    pathname: string,
    who: { email?: string; auth?: string },
    body?: unknown,
    extra: Partial<ApiRequest> = {},
  ): Promise<{ status: number; body: Json }> {
    const req: ApiRequest = {
      method,
      pathname,
      ip: "127.0.0.1",
      authorization: who.auth ? `Bearer ${who.auth}` : undefined,
      query: new URLSearchParams(),
      readJson: async () => body,
      readBytes: async () => undefined,
      contentLength: undefined,
      ...(body === undefined ? {} : { contentType: "application/json" }),
      ...(who.email ? { staffEmail: who.email } : {}),
      ...extra,
    };
    const res = await api.handle(req);
    const text = typeof res?.body === "string" ? res.body : "";
    return { status: res?.status ?? 0, body: text ? JSON.parse(text) : undefined };
  }

  async function key(email: string, scope: "read" | "rekey" | "role", name = "My Claude") {
    const made = await call("POST", "/v1/admin/keys", { email }, { name, scope, days: 7 });
    expect(made.status).toBe(201);
    return made.body as { key: Json; secret: string };
  }

  async function agent(name: string) {
    const joined = await call("POST", "/v1/session", {}, { name, kind: "agent" });
    return joined.body as { residentId: string; token: string };
  }

  return { call, key, agent, sql, social, moderators, advance: (ms: number) => (now += ms) };
}

describe("staff keys", () => {
  it("act as their maker on the staff routes, shown once and kept only as a hash", async () => {
    const t = town();
    const { key, secret } = await t.key(RYAN, "read", "Ryan's Claude");
    expect(secret).toMatch(/^tks_[\w-]{40,}$/);
    expect(key).toMatchObject({
      name: "Ryan's Claude",
      scope: "read",
      mine: true,
      revokedAt: null,
    });
    expect(JSON.stringify([...t.sql.exec("SELECT * FROM staff_keys")])).not.toContain(secret);

    const overview = await t.call("GET", "/v1/admin/overview", { auth: secret });
    expect(overview.status).toBe(200);
    expect(overview.body.me).toMatchObject({
      actor: `access:${RYAN}`,
      role: "maintainer",
      via: "key",
    });
    expect((await t.call("GET", "/v1/admin/reports", { auth: secret })).status).toBe(200);
    const listed = await t.call("GET", "/v1/admin/keys", { email: RYAN });
    expect(listed.body.keys[0].lastUsedAt).not.toBeNull();
  });

  it("never go beyond their scope, and log what they do as their maker, by name", async () => {
    const t = town();
    const wren = await t.agent("Wren");
    const read = (await t.key(RYAN, "read")).secret;
    const rekey = (await t.key(RYAN, "rekey", "Ryan's Claude")).secret;
    const body = { agent: wren.residentId, reason: "Its person wrote in" };

    const refused = await t.call("POST", "/v1/admin/rekey-codes", { auth: read }, body);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toContain("scope (read)");
    expect((await t.call("POST", "/v1/admin/rekey-codes", { auth: rekey }, body)).status).toBe(201);
    // Re-keying is all `rekey` adds.
    const hide = { reason: "test" };
    expect((await t.call("POST", "/v1/admin/posts/p_1/hide", { auth: rekey }, hide)).status).toBe(
      403,
    );

    const log = await t.call("GET", "/v1/admin/log", { email: RYAN });
    expect(log.body.entries[0]).toMatchObject({
      action: "rekey_agent",
      actor: `access:${RYAN}`,
      via: "Ryan's Claude",
    });
  });

  it("can never make keys or export the world log, even with everything their maker can do", async () => {
    const t = town();
    const role = (await t.key(RYAN, "role")).secret;
    const again = { name: "Copy", scope: "role", days: 90 };
    expect((await t.call("POST", "/v1/admin/keys", { auth: role }, again)).status).toBe(403);
    expect((await t.call("GET", "/v1/admin/keys", { auth: role })).status).toBe(403);
    expect((await t.call("GET", "/v1/admin/world-log", { auth: role })).status).toBe(403);
  });

  it("stop working when revoked, when they expire, and when their maker leaves the staff", async () => {
    const t = town();
    const revoked = await t.key(RYAN, "read");
    const r = await t.call("POST", `/v1/admin/keys/${revoked.key.id}/revoke`, { email: RYAN }, {});
    expect(r.body.key.revokedAt).not.toBeNull();
    const gone = await t.call("GET", "/v1/admin/reports", { auth: revoked.secret });
    expect(gone.status).toBe(401);
    expect(gone.body.error.message).toContain("unknown, expired, or revoked");

    const expiring = (await t.key(RYAN, "read")).secret;
    t.advance(7 * DAY_MS);
    expect((await t.call("GET", "/v1/admin/reports", { auth: expiring })).status).toBe(401);

    const mo = (await t.key(MO, "role")).secret;
    expect((await t.call("GET", "/v1/admin/reports", { auth: mo })).status).toBe(200);
    t.moderators.delete(MO);
    const left = await t.call("GET", "/v1/admin/reports", { auth: mo });
    expect(left.status).toBe(403);
    expect(left.body.error.message).toContain("isn't Terrakin staff anymore");
  });

  it("stay within their maker's role, and only their maker or a maintainer lists or revokes them", async () => {
    const t = town();
    const wren = await t.agent("Wren");
    const mine = await t.key(MO, "role", "Mo's AI");
    const theirs = await t.key(RYAN, "read", "Ryan's Claude");
    // A moderator's key can't do what only maintainers can.
    const body = { agent: wren.residentId, reason: "test" };
    expect(
      (await t.call("POST", "/v1/admin/rekey-codes", { auth: mine.secret }, body)).status,
    ).toBe(403);

    const moList = await t.call("GET", "/v1/admin/keys", { email: MO });
    expect(moList.body.keys.map((k: Json) => k.name)).toEqual(["Mo's AI"]);
    const all = await t.call("GET", "/v1/admin/keys", { email: RYAN });
    expect(all.body.keys.map((k: Json) => k.name).sort()).toEqual(["Mo's AI", "Ryan's Claude"]);

    const path = (id: string) => `/v1/admin/keys/${id}/revoke`;
    expect((await t.call("POST", path(theirs.key.id), { email: MO }, {})).status).toBe(403);
    expect((await t.call("POST", path(mine.key.id), { email: RYAN }, {})).status).toBe(200);
    expect((await t.call("POST", path("sk_missing"), { email: RYAN }, {})).status).toBe(404);
  });

  it("reach only the staff routes each scope names, so a new route is never open by default", () => {
    const staff = ROUTES.filter((r) => r.auth === "staff");
    const reach = (scope: "read" | "rekey" | "role") =>
      staff
        .filter((r) => keyAllows(scope, r))
        .map((r) => r.id)
        .sort();
    expect(reach("read")).toEqual([
      "getAdminOverview",
      "getModerationLog",
      "getNewcomers",
      "getReports",
      "getStaffBounties",
      "getTownsfolkActivity",
    ]);
    expect(reach("rekey")).toEqual([...reach("read"), "createStaffRekeyCode"].sort());
    // Everything but the keys themselves and the world log. A new staff route lands here, and this
    // list has to change with it, so adding one is a choice.
    const never = staff
      .map((r) => r.id)
      .filter((id) => !reach("role").includes(id))
      .sort();
    expect(never).toEqual(["createStaffKey", "getStaffKeys", "getWorldLog", "revokeStaffKey"]);
    expect(staff).toHaveLength(30);
  });

  it("are refused from another site, and need JSON to write, like a signed-in call", async () => {
    const t = town();
    const { secret } = await t.key(RYAN, "role");
    const reports = (extra: Partial<ApiRequest>) =>
      t.call("GET", "/v1/admin/reports", { auth: secret }, undefined, extra);
    expect((await reports({ fetchSite: "cross-site" })).status).toBe(403);
    expect((await reports({ browserOrigin: "https://evil.example" })).status).toBe(403);
    const plain = await t.call("POST", "/v1/admin/rekey-codes", { auth: secret }, undefined, {
      contentType: "text/plain",
      readJson: async () => ({ agent: "@x", reason: "y" }),
    });
    expect(plain.status).toBe(400);
  });

  it("made with a resident token don't count once Access is on", async () => {
    const t = town();
    const { secret } = t.social.staffKeys.mint("r_0123456789abcdef", "Old key", "role", 90);
    const res = await t.call("GET", "/v1/admin/reports", { auth: secret });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("without a Cloudflare Access sign-in");
  });

  it("can't suspend for longer than a moderator could, and have their names cleaned", async () => {
    const t = town();
    const wren = await t.agent("Wren");
    const mo = await t.key(MO, "role", "Mo\u202e's AI\u0007");
    expect(mo.key.name).toBe("Mo 's AI");
    const long = { days: 30, reason: "test" };
    const path = `/v1/admin/residents/${wren.residentId}/suspend`;
    expect((await t.call("POST", path, { auth: mo.secret }, long)).status).toBe(403);
    expect(
      (await t.call("POST", path, { auth: mo.secret }, { days: 3, reason: "test" })).status,
    ).toBe(200);
  });

  it("say what they are when sent as a resident's token", async () => {
    const t = town();
    const { secret } = await t.key(RYAN, "read");
    const me = await t.call("GET", "/v1/me", { auth: secret });
    expect(me.status).toBe(401);
    expect(me.body.error.message).toContain("That's a staff key");
  });
});
