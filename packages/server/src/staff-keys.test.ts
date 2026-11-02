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

  async function agent(name: string, kind: "agent" | "human" = "agent") {
    const joined = await call("POST", "/v1/session", {}, { name, kind });
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
      "getShutHomes",
      "getStaffBounties",
      "getTownsfolkActivity",
    ]);
    expect(reach("rekey")).toEqual(
      [...reach("read"), "createStaffRekeyCode", "createStaffSigninLink"].sort(),
    );
    // Everything but the keys themselves and the world log. A new staff route lands here, and this
    // list has to change with it, so adding one is a choice.
    const never = staff
      .map((r) => r.id)
      .filter((id) => !reach("role").includes(id))
      .sort();
    expect(never).toEqual([
      "awardGrant",
      "createStaffKey",
      "getStaffKeys",
      "getWorldLog",
      "revokeStaffKey",
    ]);
    expect(staff).toHaveLength(41);
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

describe("a sign-in link for a person who lost their way in", () => {
  const ADMIN = { origin: "https://admin.terrakin.org" };

  it("is a maintainer's to make, found by name, and opens the person's own character once", async () => {
    const t = town();
    // A person with no handle, known to staff only by the name they joined with.
    const ann = await t.agent("Aloneknights", "human");
    const body = { resident: "@aloneknights", reason: "Asked on Discord, matched their plot" };
    const made = await t.call("POST", "/v1/admin/signin-links", { email: RYAN }, body, ADMIN);
    expect(made.status).toBe(201);
    expect(made.body.resident).toMatchObject({ id: ann.residentId, name: "Aloneknights" });
    // A link for the public site, never the staff app's host.
    expect(made.body.url).toBe(`https://terrakin.org${made.body.path}`);
    const code = String(made.body.path).replace("/signin/", "");
    const opened = await t.call("GET", `/v1/signin-links/${code}`, {});
    expect(opened.body.resident.id).toBe(ann.residentId);

    // Logged with who and why, never the link.
    const log = await t.call("GET", "/v1/admin/log", { email: RYAN });
    expect(log.body.entries[0]).toMatchObject({
      action: "signin_link",
      id: ann.residentId,
      reason: body.reason,
    });
    expect(JSON.stringify([...t.sql.exec("SELECT * FROM moderation_log")])).not.toContain(code);
  });

  it("is refused to a moderator and to a read key, and made with a rekey key", async () => {
    const t = town();
    const ann = await t.agent("Annika", "human");
    const body = { resident: ann.residentId, reason: "They wrote in" };
    const mo = await t.call("POST", "/v1/admin/signin-links", { email: MO }, body);
    expect(mo.status).toBe(403);
    const moKey = (await t.key(MO, "role")).secret;
    expect((await t.call("POST", "/v1/admin/signin-links", { auth: moKey }, body)).status).toBe(
      403,
    );
    const read = (await t.key(RYAN, "read")).secret;
    const refused = await t.call("POST", "/v1/admin/signin-links", { auth: read }, body);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toContain("scope (read)");
    const rekey = (await t.key(RYAN, "rekey")).secret;
    expect((await t.call("POST", "/v1/admin/signin-links", { auth: rekey }, body)).status).toBe(
      201,
    );
    // Nothing was logged for the refusals.
    const log = await t.call("GET", "/v1/admin/log", { email: RYAN });
    expect(log.body.entries.filter((e: Json) => e.action === "signin_link")).toHaveLength(1);
  });

  it("sends an AI to its re-key code and a person to their link, and says when nobody matches", async () => {
    const t = town();
    await t.agent("Wren");
    await t.agent("Juno", "human");
    const reason = { reason: "test" };
    const ai = await t.call(
      "POST",
      "/v1/admin/signin-links",
      { email: RYAN },
      { resident: "wren", ...reason },
    );
    expect(ai.status).toBe(400);
    expect(ai.body.error.message).toContain("/v1/admin/rekey-codes");
    const person = await t.call(
      "POST",
      "/v1/admin/rekey-codes",
      { email: RYAN },
      { agent: "JUNO", ...reason },
    );
    expect(person.status).toBe(404);
    expect(person.body.error.message).toContain("/v1/admin/signin-links");
    const nobody = await t.call(
      "POST",
      "/v1/admin/signin-links",
      { email: RYAN },
      { resident: "Nobody Here", ...reason },
    );
    expect(nobody.status).toBe(404);
    // A handle and someone else's name both fit "ann": neither wins quietly, since a link for
    // the wrong one is a way into their character. With its @ it is the handle.
    const holder = await t.agent("Holly", "human");
    await t.call(
      "PUT",
      "/v1/profile",
      {},
      { handle: "ann" },
      {
        authorization: `Bearer ${holder.token}`,
      },
    );
    const named = await t.agent("Ann", "human");
    const both = await t.call(
      "POST",
      "/v1/admin/signin-links",
      { email: RYAN },
      { resident: "ann", ...reason },
    );
    expect(both.status).toBe(400);
    expect(both.body.error.message).toContain(holder.residentId);
    expect(both.body.error.message).toContain(named.residentId);
    const tagged = await t.call(
      "POST",
      "/v1/admin/signin-links",
      { email: RYAN },
      { resident: "@ann", ...reason },
    );
    expect(tagged.body.resident.id).toBe(holder.residentId);
    // An agent found by its exact name, the way a person is.
    expect(
      (await t.call("POST", "/v1/admin/rekey-codes", { email: RYAN }, { agent: "Wren", ...reason }))
        .status,
    ).toBe(201);
  });
});
