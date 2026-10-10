import { ROUTES } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import {
  AccessVerifier,
  accessConfig,
  accessToken,
  DEPLOY_READS_LOG_ONLY,
  parseEmails,
  parseStaffResidents,
} from "./access";
import {
  ACCESS_NOT_SET_UP,
  ACCESS_SIGN_IN,
  adminAssetPath,
  adminGate,
  isMissingAdminFile,
  WORLD_LOG_PATH,
} from "./admin-host";
import { ADMIN_PAGE_HEADERS } from "./pages";

const TEAM = "example-team.cloudflareaccess.com";
const AUD = "a".repeat(64);

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const enc = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function keyPair(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as { publicKey: Key; privateKey: Key };
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid };
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = {}) => {
    const head = enc({ alg: "RS256", kid, typ: "JWT", ...header });
    const body = enc(claims);
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
  };
  return { jwk, sign };
}

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

function certs(keys: () => object[]) {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ keys: keys() }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const NOW = 1_800_000_000_000;
/** A service token's client id, and its sign-in as Access signs one: no email, the id as its name. */
const CLIENT = "0123456789abcdef0123456789abcdef.access";
const service = (extra: Record<string, unknown> = {}) =>
  good({ email: undefined, sub: "", type: "app", common_name: CLIENT, ...extra });
const good = (extra: Record<string, unknown> = {}) => ({
  aud: [AUD],
  iss: `https://${TEAM}`,
  email: "Ryan@Example.com",
  exp: NOW / 1000 + 600,
  iat: NOW / 1000,
  ...extra,
});

describe("Cloudflare Access sign-ins", () => {
  it("accepts a token Access signed for this app, and nothing else", async () => {
    const a = await keyPair("kid-a");
    const stranger = await keyPair("kid-a");
    const { calls, fetcher } = certs(() => [a.jwk]);
    let t = NOW;
    const verifier = new AccessVerifier({ team: TEAM, aud: AUD }, fetcher, () => t);

    expect(await verifier.verify(await a.sign(good()))).toEqual({ email: "ryan@example.com" });
    expect(calls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
    // The keys are cached.
    await verifier.verify(await a.sign(good()));
    expect(calls).toHaveLength(1);

    for (const [what, token] of [
      ["wrong audience", await a.sign(good({ aud: ["someone-else"] }))],
      ["wrong issuer", await a.sign(good({ iss: "https://evil.cloudflareaccess.com" }))],
      ["expired", await a.sign(good({ exp: NOW / 1000 - 3600 }))],
      ["not yet valid", await a.sign(good({ nbf: NOW / 1000 + 3600 }))],
      ["no email", await a.sign(good({ email: undefined }))],
      ["signed by another key", await stranger.sign(good())],
      ["wrong algorithm", await a.sign(good(), { alg: "HS256" })],
      ["garbage", "not.a.token"],
      ["empty", ""],
    ] as const) {
      expect(await verifier.verify(token), what).toBeUndefined();
    }
    t += 2 * 60 * 60_000;
    await verifier.verify(await a.sign(good({ exp: t / 1000 + 600 })));
    expect(calls).toHaveLength(2);
  });

  it("takes the deploy check's service token by its client id, and no other service token", async () => {
    const a = await keyPair("kid-a");
    const stranger = await keyPair("kid-a");
    const { fetcher } = certs(() => [a.jwk]);
    const config = { team: TEAM, aud: AUD, deployClient: CLIENT };
    const verifier = new AccessVerifier(config, fetcher, () => NOW);
    expect(await verifier.verify(await a.sign(service()))).toEqual({ service: "deploy" });
    // A person stays a person, whatever name their sign-in carries.
    expect(await verifier.verify(await a.sign(good({ common_name: CLIENT })))).toEqual({
      email: "ryan@example.com",
    });
    for (const [what, token] of [
      ["another service token", await a.sign(service({ common_name: "other.access" }))],
      ["no name", await a.sign(service({ common_name: undefined }))],
      ["somebody's, as a client certificate's is", await a.sign(service({ sub: "u_1" }))],
      ["no subject", await a.sign(service({ sub: undefined }))],
      ["a session token", await a.sign(service({ type: "org" }))],
      ["a malformed email", await a.sign(service({ email: "nope" }))],
      ["another app's", await a.sign(service({ aud: ["someone-else"] }))],
      ["expired", await a.sign(service({ exp: NOW / 1000 - 3600 }))],
      ["signed by another key", await stranger.sign(service())],
    ] as const) {
      expect(await verifier.verify(token), what).toBeUndefined();
    }
    // With no client id set, no service token is anyone.
    const plain = new AccessVerifier({ team: TEAM, aud: AUD }, fetcher, () => NOW);
    expect(await plain.verify(await a.sign(service()))).toBeUndefined();
    expect(await plain.verify(await a.sign(service({ common_name: "" })))).toBeUndefined();
  });

  it("picks up a rotated key, but doesn't refetch for every unknown key id", async () => {
    const a = await keyPair("kid-a");
    const b = await keyPair("kid-b");
    let served = [a.jwk];
    const { calls, fetcher } = certs(() => served);
    let t = NOW;
    const verifier = new AccessVerifier({ team: TEAM, aud: AUD }, fetcher, () => t);
    expect(await verifier.verify(await a.sign(good()))).toBeDefined();

    // Cloudflare rotates: tokens now carry kid-b. Within a minute of the last fetch, no refetch.
    served = [a.jwk, b.jwk];
    expect(await verifier.verify(await b.sign(good()))).toBeUndefined();
    expect(calls).toHaveLength(1);
    t += 61_000;
    expect(await verifier.verify(await b.sign(good({ exp: t / 1000 + 600 })))).toEqual({
      email: "ryan@example.com",
    });
    expect(calls).toHaveLength(2);
  });

  it("reads the token from the header or the cookie, and config only when both parts are set", () => {
    expect(accessToken("h.e.ader", "CF_Authorization=c.oo.kie")).toBe("h.e.ader");
    expect(accessToken(null, "a=b; CF_Authorization=c.oo.kie; d=e")).toBe("c.oo.kie");
    expect(accessToken(undefined, undefined)).toBeUndefined();
    expect(accessConfig("https://team.cloudflareaccess.com/", "aud")).toEqual({
      team: "team.cloudflareaccess.com",
      aud: "aud",
    });
    expect(accessConfig("team.cloudflareaccess.com", "")).toBeUndefined();
    expect(accessConfig("team.cloudflareaccess.com", "aud", ` ${CLIENT} `)).toEqual({
      team: "team.cloudflareaccess.com",
      aud: "aud",
      deployClient: CLIENT,
    });
    expect(accessConfig("team.cloudflareaccess.com", "aud", " ")).toEqual({
      team: "team.cloudflareaccess.com",
      aud: "aud",
    });
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
    const a = await keyPair("kid-a");
    const { fetcher } = certs(() => [a.jwk]);
    const verifier = new AccessVerifier({ team: TEAM, aud: AUD }, fetcher, () => NOW);
    return { a, verifier };
  }

  it("refuses without a valid Access sign-in: 401, JSON for the API, text for pages", async () => {
    const { a, verifier } = await setup();
    const options = { verifier, requireAccess: true };
    for (const request of [
      get(api),
      get(api, { "cf-access-jwt-assertion": await a.sign(good({ aud: ["other-app"] })) }),
      get(api, { cookie: `CF_Authorization=${await a.sign(good({ exp: NOW / 1000 - 3600 }))}` }),
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

  it("lets a valid sign-in through with its email, from the header or the cookie", async () => {
    const { a, verifier } = await setup();
    const options = { verifier, requireAccess: true };
    const token = await a.sign(good());
    const header = get(api, { "cf-access-jwt-assertion": token });
    expect(await adminGate(header, api, options)).toEqual({ email: "ryan@example.com" });
    const cookie = get(page, { cookie: `CF_Authorization=${token}` });
    expect(await adminGate(cookie, page, options)).toEqual({ email: "ryan@example.com" });
  });

  it("lets the deploy check's token through for a GET of the world log, and nothing else", async () => {
    const a = await keyPair("kid-a");
    const { fetcher } = certs(() => [a.jwk]);
    const config = { team: TEAM, aud: AUD, deployClient: CLIENT };
    const options = {
      verifier: new AccessVerifier(config, fetcher, () => NOW),
      requireAccess: true,
    };
    const headers = { "cf-access-jwt-assertion": await a.sign(service()) };
    expect(ROUTES.find((r) => r.id === "getWorldLog")).toMatchObject({
      method: "GET",
      path: WORLD_LOG_PATH,
    });
    const log = new URL(`https://admin.terrakin.org${WORLD_LOG_PATH}?after=5`);
    expect(await adminGate(new Request(log, { headers }), log, options)).toEqual({
      email: undefined,
      service: "deploy",
    });
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
    const real = await adminGate(get(api), api, { verifier: undefined, requireAccess: true });
    if (!("refuse" in real)) throw new Error("let through");
    expect(real.refuse.status).toBe(503);
    const body = (await real.refuse.json()) as { error: { message: string } };
    expect(body.error.message).toBe(ACCESS_NOT_SET_UP);
    const local = new URL("http://admin.localhost:8787/v1/admin/reports");
    const options = { verifier: undefined, requireAccess: false };
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
