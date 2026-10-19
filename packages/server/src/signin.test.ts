import type { PasskeyCreationOptions, PasskeyRequestOptions } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { fromBase64Url, sha256Bytes, toBase64Url } from "./bytes";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Signing in with a passkey over HTTP (RFC 0037). The thing these prove is the decision the RFC
 * leads with: a person who plays through their AI gets a session on the agent's own resident, with
 * no character of their own, and the agent keeps playing with the token it already had.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker holds every body to its schema.
type Json = Record<string, any>;

async function start() {
  let at = Date.UTC(2026, 9, 19, 9);
  const now = () => at;
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now,
    days: true,
    economy: true,
    items: true,
    presence: true,
  });
  const sql = nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    now,
    maintainers: new Set<string>(),
    moderators: new Set<string>(),
    residentAgeDays: (id) => service.residentAgeDays(id),
    credits: (since) => service.credits(since),
  });
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    now,
  });
  cleanups.push(() => sql.close());
  const base = await listenOnFreePort(server, cleanups);
  const call = jsonCaller(base);
  const join = async (name: string, kind: "human" | "agent") => {
    const made = (await call("POST", "/v1/session", { name, kind })).body as Json;
    return { id: made.residentId as string, token: made.token as string };
  };
  // Rate-limit buckets refill from the clock, so a test that needs more calls than a burst allows
  // moves time rather than working around the limit.
  return {
    call,
    base,
    join,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
/** What a real ceremony carries: the person was there and the device checked who they were. */
const CONFIRMED = FLAG_UP | FLAG_UV;

/**
 * A test authenticator: one real P-256 key that answers the server's own ceremonies, so these
 * tests exercise the signature path rather than a stub.
 */
async function authenticator(origin: string, credentialId = "dGVzdC1rZXk") {
  const rpId = new URL(origin).hostname;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));

  const authData = async (flags: number, signCount: number) => {
    const bytes = new Uint8Array(37);
    bytes.set(await sha256Bytes(new TextEncoder().encode(rpId)), 0);
    bytes[32] = flags;
    new DataView(bytes.buffer).setUint32(33, signCount, false);
    return bytes;
  };
  const clientData = (type: string, challenge: string, from = origin) =>
    toBase64Url(new TextEncoder().encode(JSON.stringify({ type, challenge, origin: from })));

  return {
    credentialId,
    /** The answer to a `begin` that asked for a new passkey. */
    async create(options: PasskeyCreationOptions) {
      return {
        challenge: options.challenge,
        credentialId,
        publicKey: toBase64Url(spki),
        algorithm: -7,
        clientData: clientData("webauthn.create", options.challenge),
        authenticatorData: toBase64Url(await authData(CONFIRMED | FLAG_AT, 0)),
      };
    },
    /** The answer to a `begin` that asked this passkey to prove itself. */
    async assert(options: PasskeyRequestOptions, signCount = 1, from = origin) {
      const data = await authData(CONFIRMED, signCount);
      const client = clientData("webauthn.get", options.challenge, from);
      const signed = new Uint8Array(data.length + 32);
      signed.set(data, 0);
      signed.set(await sha256Bytes(fromBase64Url(client) as Uint8Array<ArrayBuffer>), data.length);
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signed),
      );
      // Web Crypto signs raw; an authenticator sends DER.
      const half = (bytes: Uint8Array) => {
        let at = 0;
        while (at < bytes.length - 1 && bytes[at] === 0) at++;
        const trimmed = bytes.subarray(at);
        const body = (trimmed[0] as number) & 0x80 ? [0, ...trimmed] : [...trimmed];
        return [0x02, body.length, ...body];
      };
      const body = [...half(raw.subarray(0, 32)), ...half(raw.subarray(32))];
      return {
        challenge: options.challenge,
        credentialId,
        clientData: client,
        authenticatorData: toBase64Url(data),
        signature: toBase64Url(new Uint8Array([0x30, body.length, ...body])),
      };
    },
  };
}

describe("a person who plays through their AI", () => {
  it("binds a passkey from the agent's link and gets a session on the agent's own resident", async () => {
    const { call, base, join } = await start();
    const cocoa = await join("Cocoa", "agent");
    const key = await authenticator(base);

    // The agent makes a one-time link and hands it over.
    const made = await call("POST", "/v1/signin-links", undefined, cocoa.token);
    expect(made.status).toBe(201);
    const code = String((made.body as Json).path).replace("/signin/", "");

    // The page the person opens says which resident it is for, without a token.
    const preview = await call("GET", `/v1/signin-links/${code}`);
    expect(preview.body).toMatchObject({ resident: { id: cocoa.id, name: "Cocoa" } });

    const options = (await call("POST", "/v1/signin/link/begin", { link: code }))
      .body as PasskeyCreationOptions;
    expect(options).toMatchObject({ rpId: new URL(base).hostname, user: { name: "Cocoa" } });

    const bound = await call("POST", "/v1/signin/link/finish", {
      ...(await key.create(options)),
      link: code,
    });
    expect(bound.status).toBe(201);
    // The session is on the agent's resident: no second character was made.
    expect(bound.body).toMatchObject({ residentId: cocoa.id, resident: { name: "Cocoa" } });
    const human = String((bound.body as Json).token);
    expect(human).not.toBe(cocoa.token);

    // Both tokens work: a person and their AI may both act as one resident.
    expect((await call("GET", "/v1/me", undefined, human)).body).toMatchObject({
      resident: { id: cocoa.id },
    });
    expect((await call("GET", "/v1/me", undefined, cocoa.token)).body).toMatchObject({
      resident: { id: cocoa.id },
    });

    // The link is spent.
    expect((await call("GET", `/v1/signin-links/${code}`)).status).toBe(404);
    expect((await call("POST", "/v1/signin/link/begin", { link: code })).status).toBe(404);
  });

  it("signs in again from a browser that holds nothing", async () => {
    const { call, base, join } = await start();
    const cocoa = await join("Cocoa", "agent");
    const key = await authenticator(base);
    const code = String(
      ((await call("POST", "/v1/signin-links", undefined, cocoa.token)).body as Json).path,
    ).replace("/signin/", "");
    const options = (await call("POST", "/v1/signin/link/begin", { link: code }))
      .body as PasskeyCreationOptions;
    await call("POST", "/v1/signin/link/finish", { ...(await key.create(options)), link: code });

    // No token anywhere: the passkey names its own resident.
    const ask = (await call("POST", "/v1/signin/begin")).body as PasskeyRequestOptions;
    const signed = await call("POST", "/v1/signin/finish", await key.assert(ask, 1));
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({ residentId: cocoa.id });

    // A challenge is good once, so the same ceremony replayed is refused.
    expect((await call("POST", "/v1/signin/finish", await key.assert(ask, 2))).status).toBe(401);
    // And a counter that went backwards reads as a copy.
    const next = (await call("POST", "/v1/signin/begin")).body as PasskeyRequestOptions;
    expect((await call("POST", "/v1/signin/finish", await key.assert(next, 1))).status).toBe(401);
  });

  it("refuses a ceremony from another site, an unknown passkey, and an unknown link", async () => {
    const { call, base, join } = await start();
    const cocoa = await join("Cocoa", "agent");
    const key = await authenticator(base);
    const code = String(
      ((await call("POST", "/v1/signin-links", undefined, cocoa.token)).body as Json).path,
    ).replace("/signin/", "");
    const options = (await call("POST", "/v1/signin/link/begin", { link: code }))
      .body as PasskeyCreationOptions;
    await call("POST", "/v1/signin/link/finish", { ...(await key.create(options)), link: code });

    // A lookalike site's origin in the client data, signed by the real key.
    const ask = (await call("POST", "/v1/signin/begin")).body as PasskeyRequestOptions;
    expect(
      (await call("POST", "/v1/signin/finish", await key.assert(ask, 3, "https://terrak1n.org")))
        .status,
    ).toBe(401);

    // A passkey we never bound.
    const stranger = await authenticator(base, "c3RyYW5nZXI");
    const next = (await call("POST", "/v1/signin/begin")).body as PasskeyRequestOptions;
    expect((await call("POST", "/v1/signin/finish", await stranger.assert(next, 1))).status).toBe(
      401,
    );

    expect((await call("GET", "/v1/signin-links/nope")).status).toBe(404);
    expect((await call("POST", "/v1/signin/link/begin", { link: "nope" })).status).toBe(404);
  });
});

describe("the passkeys a resident has bound", () => {
  it("are listed and unbound with that resident's own token, and nobody else's", async () => {
    const { call, base, join } = await start();
    const fern = await join("Fern", "human");
    const birch = await join("Birch", "human");
    const key = await authenticator(base);

    const options = (await call("POST", "/v1/claims/passkey/begin", undefined, fern.token))
      .body as PasskeyCreationOptions;
    const bound = await call(
      "POST",
      "/v1/claims/passkey/finish",
      await key.create(options),
      fern.token,
    );
    expect(bound.status).toBe(201);
    const id = String((bound.body as Json).id);

    const listed = (await call("GET", "/v1/claims", undefined, fern.token)).body as Json;
    expect(listed.claims).toHaveLength(1);
    expect(listed.claims[0]).toMatchObject({ id, kind: "passkey" });
    // Never the key itself.
    expect(JSON.stringify(listed)).not.toContain(options.challenge);

    // Binding and listing need a token, and one resident can't touch another's.
    expect((await call("POST", "/v1/claims/passkey/begin")).status).toBe(401);
    expect((await call("GET", "/v1/claims")).status).toBe(401);
    expect((await call("GET", "/v1/claims", undefined, birch.token)).body).toMatchObject({
      claims: [],
    });
    expect((await call("DELETE", `/v1/claims/${id}`, undefined, birch.token)).status).toBe(404);

    // Unbound with its own token, after which it can't sign in.
    expect((await call("DELETE", `/v1/claims/${id}`, undefined, fern.token)).status).toBe(204);
    expect((await call("GET", "/v1/claims", undefined, fern.token)).body).toMatchObject({
      claims: [],
    });
    const ask = (await call("POST", "/v1/signin/begin")).body as PasskeyRequestOptions;
    expect((await call("POST", "/v1/signin/finish", await key.assert(ask, 1))).status).toBe(401);
  });

  it("can't be bound to a resident someone else already bound it to", async () => {
    const { call, base, join } = await start();
    const fern = await join("Fern", "human");
    const birch = await join("Birch", "human");
    const key = await authenticator(base);

    const mine = (await call("POST", "/v1/claims/passkey/begin", undefined, fern.token))
      .body as PasskeyCreationOptions;
    await call("POST", "/v1/claims/passkey/finish", await key.create(mine), fern.token);

    const theirs = (await call("POST", "/v1/claims/passkey/begin", undefined, birch.token))
      .body as PasskeyCreationOptions;
    const taken = await call(
      "POST",
      "/v1/claims/passkey/finish",
      await key.create(theirs),
      birch.token,
    );
    expect(taken.status).toBe(403);
    // Fern keeps it, and Birch has none.
    expect((await call("GET", "/v1/claims", undefined, fern.token)).body).toMatchObject({
      claims: [{ kind: "passkey" }],
    });
    expect((await call("GET", "/v1/claims", undefined, birch.token)).body).toMatchObject({
      claims: [],
    });
  });

  it("refuses a challenge issued for another resident", async () => {
    const { call, base, join } = await start();
    const fern = await join("Fern", "human");
    const birch = await join("Birch", "human");
    const key = await authenticator(base);
    // Birch's own ceremony, finished with Fern's token.
    const birches = (await call("POST", "/v1/claims/passkey/begin", undefined, birch.token))
      .body as PasskeyCreationOptions;
    expect(
      (await call("POST", "/v1/claims/passkey/finish", await key.create(birches), fern.token))
        .status,
    ).toBe(400);
  });
});

describe("the guards on signing in", () => {
  /** An agent with a passkey bound, which is where most of these start. */
  async function bound() {
    const started = await start();
    const cocoa = await started.join("Cocoa", "agent");
    const key = await authenticator(started.base);
    const code = String(
      ((await started.call("POST", "/v1/signin-links", undefined, cocoa.token)).body as Json).path,
    ).replace("/signin/", "");
    const options = (await started.call("POST", "/v1/signin/link/begin", { link: code }))
      .body as PasskeyCreationOptions;
    await started.call("POST", "/v1/signin/link/finish", {
      ...(await key.create(options)),
      link: code,
    });
    return { ...started, cocoa, key };
  }

  it("keeps the counter as a high-water mark, so a zero can't erase it", async () => {
    const { call, key } = await bound();
    const signIn = async (count: number) => {
      const ask = (await call("POST", "/v1/signin/begin")).body as PasskeyRequestOptions;
      return (await call("POST", "/v1/signin/finish", await key.assert(ask, count))).status;
    };
    expect(await signIn(50)).toBe(200);
    // An authenticator that sends 0 means "I keep no counter", so it is accepted and must not
    // write 0 over the 50. Before it did, and then 1 passed, which 50 had already refused.
    expect(await signIn(0)).toBe(200);
    expect(await signIn(1)).toBe(401);
    expect(await signIn(51)).toBe(200);
  });

  it("won't spend a sign-in challenge on a binding, or a binding's on a sign-in", async () => {
    const { call, base, join, key } = await bound();
    const fern = await join("Fern", "human");

    // A sign-in challenge, offered to the bind route.
    const toSignin = (await call("POST", "/v1/signin/begin")).body as PasskeyRequestOptions;
    const other = await authenticator(base, "b3RoZXI");
    expect(
      (
        await call(
          "POST",
          "/v1/claims/passkey/finish",
          await other.create({
            challenge: toSignin.challenge,
            rpId: toSignin.rpId,
            rpName: "Terrakin",
            user: { id: "x", name: "Fern", displayName: "Fern" },
            algorithms: [-7],
            exclude: [],
            timeoutMs: 1000,
          }),
          fern.token,
        )
      ).status,
    ).toBe(400);

    // And a binding challenge, offered to the sign-in route.
    const toBind = (await call("POST", "/v1/claims/passkey/begin", undefined, fern.token))
      .body as PasskeyCreationOptions;
    expect(
      (
        await call(
          "POST",
          "/v1/signin/finish",
          await key.assert({
            challenge: toBind.challenge,
            rpId: toBind.rpId,
            timeoutMs: 1000,
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("refuses the eleventh passkey, however many challenges are held at once", async () => {
    const { call, base, join, advance } = await start();
    const fern = await join("Fern", "human");
    // Every challenge first, then every finish: the cap has to hold at the write, not only when
    // a ceremony was offered.
    const asked: PasskeyCreationOptions[] = [];
    for (let n = 0; n < 11; n++) {
      asked.push(
        (await call("POST", "/v1/claims/passkey/begin", undefined, fern.token))
          .body as PasskeyCreationOptions,
      );
    }
    // 22 calls is two past the `owner` burst, so the clock moves enough to refill those two and
    // far less than the 5 minutes a challenge lives: this must fail on the cap, not the limit.
    advance(30_000);
    const results: number[] = [];
    for (const [n, options] of asked.entries()) {
      const key = await authenticator(base, `a2V5LW${n}`);
      results.push(
        (await call("POST", "/v1/claims/passkey/finish", await key.create(options), fern.token))
          .status,
      );
    }
    expect(results.filter((status) => status === 201)).toHaveLength(10);
    expect(results.filter((status) => status === 403)).toHaveLength(1);
    expect(
      ((await call("GET", "/v1/claims", undefined, fern.token)).body as Json).claims,
    ).toHaveLength(10);
  });

  it("rate limits sign-in tries from one place", async () => {
    const { call } = await start();
    // The limit is the only thing bounding guessing here, since nothing names the resident first.
    const statuses: number[] = [];
    for (let n = 0; n < 12; n++) {
      statuses.push((await call("POST", "/v1/signin/begin")).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 200).length).toBeLessThanOrEqual(11);
  });
});

describe("ending sessions", () => {
  it("unbinding a passkey ends what it minted, and leaves the agent's own token alone", async () => {
    const { call, base, join } = await start();
    const cocoa = await join("Cocoa", "agent");
    const key = await authenticator(base);
    const code = String(
      ((await call("POST", "/v1/signin-links", undefined, cocoa.token)).body as Json).path,
    ).replace("/signin/", "");
    const options = (await call("POST", "/v1/signin/link/begin", { link: code }))
      .body as PasskeyCreationOptions;
    const session = (
      await call("POST", "/v1/signin/link/finish", { ...(await key.create(options)), link: code })
    ).body as Json;
    const human = String(session.token);

    // A second session from the same passkey, so unbinding has to end more than the newest.
    const ask = (await call("POST", "/v1/signin/begin")).body as PasskeyRequestOptions;
    const again = String(
      ((await call("POST", "/v1/signin/finish", await key.assert(ask, 1))).body as Json).token,
    );
    expect((await call("GET", "/v1/me", undefined, again)).status).toBe(200);

    const id = String(
      ((await call("GET", "/v1/claims", undefined, human)).body as Json).claims[0].id,
    );
    expect((await call("DELETE", `/v1/claims/${id}`, undefined, human)).status).toBe(204);

    // Both tokens that passkey minted are dead, and the agent's own is untouched.
    expect((await call("GET", "/v1/me", undefined, human)).status).toBe(401);
    expect((await call("GET", "/v1/me", undefined, again)).status).toBe(401);
    expect((await call("GET", "/v1/me", undefined, cocoa.token)).status).toBe(200);
  });

  it("signs every other session out, keeping the token that asked", async () => {
    const { call, base, join } = await start();
    const cocoa = await join("Cocoa", "agent");
    const key = await authenticator(base);
    const code = String(
      ((await call("POST", "/v1/signin-links", undefined, cocoa.token)).body as Json).path,
    ).replace("/signin/", "");
    const options = (await call("POST", "/v1/signin/link/begin", { link: code }))
      .body as PasskeyCreationOptions;
    const human = String(
      (
        (
          await call("POST", "/v1/signin/link/finish", {
            ...(await key.create(options)),
            link: code,
          })
        ).body as Json
      ).token,
    );

    const out = await call("POST", "/v1/signin/others-out", undefined, human);
    expect(out.status).toBe(200);
    expect((out.body as Json).ended).toBeGreaterThanOrEqual(1);
    // The caller keeps playing; the agent's own token is one of the ones that stopped, which is
    // the point of the call and why its description says the AI needs a new key.
    expect((await call("GET", "/v1/me", undefined, human)).status).toBe(200);
    expect((await call("GET", "/v1/me", undefined, cocoa.token)).status).toBe(401);
  });
});
