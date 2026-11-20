import { ROUTES } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import { createAccessVerifier } from "workers-start/access";
import { createTestAccessTeam } from "workers-start/access/testing";
import {
  DEPLOY_READS_LOG_ONLY,
  parseEmails,
  parseStaffResidents,
  staffAccessConfig,
} from "./access";
import {
  ACCESS_KEYS_DOWN,
  ACCESS_NOT_SET_UP,
  ACCESS_SIGN_IN,
  adminAssetPath,
  adminGate,
  isMissingAdminFile,
  WORLD_LOG_PATH,
} from "./admin-host";
import { STAFF_ONLY } from "./handlers/shared";
import { ADMIN_PAGE_HEADERS } from "./pages";

/** A service token's client id, as the deploy check's would be. */
const CLIENT = "0123456789abcdef0123456789abcdef.access";

describe("staff emails", () => {
  it("lowercases the lists and drops what isn't an email", () => {
    expect([...parseEmails(" A@b.com,c@d.org  nope ")]).toEqual(["a@b.com", "c@d.org"]);
  });
});

describe("staff residents", () => {
  it("maps lowercased emails to resident ids, and ignores what's malformed without naming it", () => {
    const warned: string[] = [];
    const warn = (message: string) => warned.push(message);
    const map = parseStaffResidents(
      " Ryan@Example.com=r_0123456789abcdef ,\nmod@example.com=r_fedcba9876543210,, ",
      { warn },
    );
    expect([...map]).toEqual([
      ["ryan@example.com", "r_0123456789abcdef"],
      ["mod@example.com", "r_fedcba9876543210"],
    ]);
    expect(warned).toEqual([]);

    const bad = parseStaffResidents(
      [
        "nope=r_0123456789abcdef", // no @
        "a@example.com", // no id
        "=r_0123456789abcdef", // no email
        "b@example.com=ryan", // not a resident id
        "c@example.com=R_0123456789ABCDEF", // not how ids are written
        "d@example.com=r_0123", // too short
        "e@example.com = r_0123456789abcdef", // spaces split it into three bad pairs
        "f@example.com=r_0123456789abcdef",
        "F@example.com=r_1111111111111111", // the same email again
        "g@example.com=r_2222222222222222",
      ].join(","),
      { warn, isResident: (id) => id !== "r_2222222222222222" },
    );
    expect([...bad]).toEqual([
      ["f@example.com", "r_0123456789abcdef"],
      ["g@example.com", "r_2222222222222222"],
    ]);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("ignored 9 malformed");
    expect(warned[0]).toContain("ignored 1 repeating");
    expect(warned[0]).toContain("1 map to an id that isn't a resident");
    expect(warned[0]).not.toMatch(/@|example|r_[0-9a-f]/);
    expect(parseStaffResidents(undefined, { warn }).size).toBe(0);
    expect(parseStaffResidents("", { warn }).size).toBe(0);
    expect(warned).toHaveLength(1);
  });
});

describe("the admin host's gate", () => {
  const api = new URL("https://admin.terrakin.org/v1/admin/reports");
  const page = new URL("https://admin.terrakin.org/");
  const get = (url: URL, headers: Record<string, string> = {}) => new Request(url, { headers });

  async function setup() {
    const team = await createTestAccessTeam({ emails: ["ryan@example.com"] });
    const access = staffAccessConfig({
      team: team.config.teamDomain,
      aud: team.config.aud,
      deployClient: CLIENT,
      staffEmails: parseEmails("Ryan@Example.com"),
    });
    const options = {
      access,
      requireAccess: true,
      verify: createAccessVerifier({ fetch: team.fetch }),
    };
    return { team, options };
  }

  it("refuses without a valid Access sign-in: 401, JSON for the API, text for pages", async () => {
    const { team, options } = await setup();
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    for (const request of [
      get(api),
      get(api, {
        "cf-access-jwt-assertion": await team.token("ryan@example.com", { aud: ["other-app"] }),
      }),
      get(api, {
        cookie: `CF_Authorization=${await team.token("ryan@example.com", { exp: hourAgo - 600 })}`,
      }),
    ]) {
      const gate = await adminGate(request, api, options);
      if (!("refuse" in gate)) throw new Error("let through");
      expect(gate.refuse.status).toBe(401);
      expect(await gate.refuse.json()).toEqual({
        error: { code: "unauthorized", message: ACCESS_SIGN_IN },
      });
      expect(gate.refuse.headers.get("content-security-policy")).toBe(
        ADMIN_PAGE_HEADERS["content-security-policy"],
      );
    }
    const gate = await adminGate(get(page), page, options);
    if (!("refuse" in gate)) throw new Error("let through");
    expect(gate.refuse.status).toBe(401);
    expect(gate.refuse.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(gate.refuse.headers.get("x-frame-options")).toBe("DENY");
  });

  it("lets a staff sign-in through with its email, and refuses anyone else's", async () => {
    const { team, options } = await setup();
    const token = await team.token("Ryan@Example.com");
    const header = get(api, { "cf-access-jwt-assertion": token });
    expect(await adminGate(header, api, options)).toEqual({ email: "ryan@example.com" });
    const cookie = get(page, { cookie: `CF_Authorization=${token}` });
    expect(await adminGate(cookie, page, options)).toEqual({ email: "ryan@example.com" });

    const stranger = get(api, {
      "cf-access-jwt-assertion": await team.token("someone@example.com"),
    });
    const gate = await adminGate(stranger, api, options);
    if (!("refuse" in gate)) throw new Error("let through");
    expect(gate.refuse.status).toBe(403);
    expect(await gate.refuse.json()).toEqual({ error: { code: "forbidden", message: STAFF_ONLY } });
  });

  it("answers 503 when the team's keys can't be fetched", async () => {
    const { team, options } = await setup();
    const verify = createAccessVerifier({ fetch: async () => new Response("", { status: 500 }) });
    const request = get(api, { "cf-access-jwt-assertion": await team.token("ryan@example.com") });
    const gate = await adminGate(request, api, { ...options, verify });
    if (!("refuse" in gate)) throw new Error("let through");
    expect(gate.refuse.status).toBe(503);
    expect(await gate.refuse.json()).toEqual({
      error: { code: "unavailable", message: ACCESS_KEYS_DOWN },
    });
  });

  it("lets the deploy check's token through for a GET of the world log, and nothing else", async () => {
    const { team, options } = await setup();
    const headers = { "cf-access-jwt-assertion": await team.serviceToken(CLIENT) };
    expect(ROUTES.find((r) => r.id === "getWorldLog")).toMatchObject({
      method: "GET",
      path: WORLD_LOG_PATH,
    });
    const log = new URL(`https://admin.terrakin.org${WORLD_LOG_PATH}?after=5`);
    expect(await adminGate(new Request(log, { headers }), log, options)).toEqual({
      email: undefined,
      service: "deploy",
    });
    const other = { "cf-access-jwt-assertion": await team.serviceToken("other.access") };
    const refused = await adminGate(new Request(log, { headers: other }), log, options);
    expect("refuse" in refused && refused.refuse.status).toBe(403);
    for (const [method, path] of [
      ["POST", WORLD_LOG_PATH],
      ["GET", `${WORLD_LOG_PATH}/`],
      ["GET", "/v1/admin/snapshots"],
      ["GET", "/v1/admin/reports"],
      ["GET", "/v1/world"],
      ["GET", "/"],
      ["GET", "/_admin/index.html"],
      ["GET", "/media/m_1"],
    ] as const) {
      const url = new URL(`https://admin.terrakin.org${path}`);
      const gate = await adminGate(new Request(url, { method, headers }), url, options);
      if (!("refuse" in gate)) throw new Error(`let through: ${method} ${path}`);
      expect(gate.refuse.status, `${method} ${path}`).toBe(403);
      if (path.startsWith("/v1/")) {
        expect(await gate.refuse.json()).toEqual({
          error: { code: "forbidden", message: DEPLOY_READS_LOG_ONLY },
        });
      }
    }
  });

  it("never runs the real admin host without Access; other hosts fall back to tokens", async () => {
    // A team and audience with nobody on either list is no Access at all.
    const nobody = staffAccessConfig({
      team: "t.cloudflareaccess.com",
      aud: "aud",
      staffEmails: [],
    });
    expect(nobody).toBeNull();
    const real = await adminGate(get(api), api, { access: nobody, requireAccess: true });
    if (!("refuse" in real)) throw new Error("let through");
    expect(real.refuse.status).toBe(503);
    const body = (await real.refuse.json()) as { error: { message: string } };
    expect(body.error.message).toBe(ACCESS_NOT_SET_UP);
    const local = new URL("http://admin.localhost:8787/v1/admin/reports");
    const options = { access: null, requireAccess: false };
    expect(await adminGate(get(local), local, options)).toEqual({ email: undefined });
  });

  it("serves the app's files under the prefix and its page everywhere else", () => {
    expect(adminAssetPath("/")).toBe("/_admin/index.html");
    expect(adminAssetPath("/log")).toBe("/_admin/index.html");
    expect(adminAssetPath("/_admin/")).toBe("/_admin/index.html");
    expect(adminAssetPath("/_admin/assets/index-abc.js")).toBe("/_admin/assets/index-abc.js");
    // The Worker's assets answer a missing file with the main site's page.
    expect(isMissingAdminFile("/_admin/assets/gone.js", "text/html; charset=utf-8")).toBe(true);
    expect(isMissingAdminFile("/_admin/assets/app.js", "text/javascript")).toBe(false);
    expect(isMissingAdminFile("/_admin/", "text/html")).toBe(false);
  });

  it("allows nothing inline and nothing from another site on admin pages", () => {
    const csp = ADMIN_PAGE_HEADERS["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-|https?:|\*/);
    expect(ADMIN_PAGE_HEADERS["x-robots-tag"]).toBe("noindex, nofollow");
    expect(ADMIN_PAGE_HEADERS["cache-control"]).toBe("no-store");
  });
});
