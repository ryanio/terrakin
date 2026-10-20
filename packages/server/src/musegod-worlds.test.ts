import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { MusegodWorlds, placeLine, residentUrl, signerOf, signLine } from "./musegod-worlds";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

/**
 * A made-up key, never anyone's: the test vectors below were taken from viem's `signMessage`
 * for it, the library musegod checks a report's signature with.
 */
const KEY = `0x${"11".repeat(32)}`;
const SIGNER = "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a";
/** `WORLD_URL.terrakin` in musegod's `packages/chain/src/chain.ts`: the only url it takes here. */
const MUSEGOD_URL = /^https:\/\/terrakin\.org\/r\/r_[0-9a-f]{16}$/;

interface Sent {
  muse: string;
  body: {
    place: string;
    event: string;
    url: string;
    at: number;
    signer: string;
    signature: string;
  };
}

/** A sender whose reports are collected instead of sent, with the muse each was about. */
function sender(options: { key?: string | undefined } = {}) {
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const sent: Sent[] = [];
  let now = Date.UTC(2026, 9, 19, 12);
  const worlds = new MusegodWorlds(sql, {
    key: "key" in options ? options.key : KEY,
    base: "https://musegod.test",
    now: () => now,
    fetch: async (input, init) => {
      const muse = String(input).replace(/^.*\/muses\/([^/]*)\/worlds$/, "$1");
      sent.push({ muse, body: JSON.parse(String(init?.body)) });
      return new Response('{"value":{}}', { headers: { "content-type": "application/json" } });
    },
  });
  return { worlds, sent, advance: (ms: number) => (now += ms), now: () => now };
}

const ADA = "r_0123456789abcdef";

describe("the line a place signs", () => {
  it("is the string musegod's placeLine builds", () => {
    expect(
      placeLine("947", "linked", "https://terrakin.org/r/r_0123456789abcdef", 1791000000),
    ).toBe(
      "terrakin reports muse #947 of MUSEGOD: linked https://terrakin.org/r/r_0123456789abcdef. Signed at 1791000000.",
    );
  });

  it("is signed EIP-191, as viem signs it", () => {
    const line = placeLine("947", "linked", residentUrl(ADA), 1791000000);
    expect(signLine(line, KEY)).toBe(
      "0x6af4b490b0e515ca0258f6a86862bc8f703fbcb20fddca3fd08451a63b1039b345138da44f6ec7b68f87b147a9bd3d907d37e1bee59712be502b136494cc603a1b",
    );
    expect(signerOf(KEY)).toBe(SIGNER);
  });

  it("says where the resident is, in the only url shape musegod takes", () => {
    expect(residentUrl(ADA)).toMatch(MUSEGOD_URL);
  });
});

describe("what a report says", () => {
  it("names the place, the event, the url, the signer, and a line signed within the window", () => {
    const t = sender();
    t.worlds.tell(ADA, { subject: "947", verified: true });
    const at = Math.floor(t.now() / 1000);
    expect(t.sent).toEqual([
      {
        muse: "947",
        body: {
          place: "terrakin",
          event: "linked",
          url: residentUrl(ADA),
          at,
          signer: SIGNER,
          signature: signLine(placeLine("947", "linked", residentUrl(ADA), at), KEY),
        },
      },
    ]);
  });

  it("is a joined for a resident that only names a muse, and a left when it stops", () => {
    const t = sender();
    t.worlds.tell(ADA, { subject: "12", verified: false });
    t.worlds.tell(ADA, undefined);
    expect(t.sent.map((s) => [s.muse, s.body.event])).toEqual([
      ["12", "joined"],
      ["12", "left"],
    ]);
  });

  it("leaves the old muse before it reports the new one", () => {
    const t = sender();
    t.worlds.tell(ADA, { subject: "12", verified: false });
    t.worlds.tell(ADA, { subject: "13", verified: true });
    expect(t.sent.map((s) => [s.muse, s.body.event])).toEqual([
      ["12", "joined"],
      ["12", "left"],
      ["13", "linked"],
    ]);
  });

  it("says nothing twice: a recheck or a save that changes nothing sends nothing", () => {
    const t = sender();
    for (let i = 0; i < 5; i++) t.worlds.tell(ADA, { subject: "947", verified: true });
    t.worlds.tell("r_fedcba9876543210", undefined);
    expect(t.sent).toHaveLength(1);
  });

  it("sends nothing without a key, and nothing for a resident musegod would turn away", () => {
    const off = sender({ key: undefined });
    off.worlds.tell(ADA, { subject: "947", verified: true });
    expect(off.worlds.on).toBe(false);
    expect(off.sent).toEqual([]);

    const t = sender();
    t.worlds.tell("persona-wren", { subject: "947", verified: true });
    t.worlds.tell(ADA, { subject: "1000", verified: true });
    expect(t.sent).toEqual([]);
  });

  it("goes out through the global fetch as the global, the only way the Worker takes it", () => {
    const sql = nodeSql();
    cleanups.push(() => sql.close());
    // workerd refuses its own `fetch` called as a method of anything else ("Illegal
    // invocation"), so a sender that stored the bare global sends nothing from the Worker.
    // Node's fetch takes any `this`, so a test that passes its own can never see it.
    const asked: string[] = [];
    const strict = function (this: unknown, input: Parameters<typeof fetch>[0]) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      asked.push(String(input));
      return Promise.resolve(new Response("{}"));
    } as unknown as typeof fetch;
    const was = globalThis.fetch;
    globalThis.fetch = strict;
    try {
      const worlds = new MusegodWorlds(sql, { key: KEY, base: "https://musegod.test" });
      worlds.tell(ADA, { subject: "947", verified: true });
    } finally {
      globalThis.fetch = was;
    }
    expect(asked).toEqual(["https://musegod.test/api/v1/muses/947/worlds"]);
  });

  it("drops a send that throws, and goes on with the reports and the row behind it", () => {
    const sql = nodeSql();
    cleanups.push(() => sql.close());
    const tried: string[] = [];
    const worlds = new MusegodWorlds(sql, {
      key: KEY,
      base: "https://musegod.test",
      fetch: (input) => {
        tried.push(String(input).replace(/^.*\/muses\/([^/]*)\/worlds$/, "$1"));
        throw new TypeError("no fetch for you");
      },
    });
    worlds.tell(ADA, { subject: "12", verified: false });
    // The row was written even though the send failed, so the muse it left is known.
    worlds.tell(ADA, { subject: "13", verified: true });
    expect(tried).toEqual(["12", "12", "13"]);
  });

  it("keeps to ten a minute, musegod's limit for one sender", () => {
    const t = sender();
    for (let i = 0; i < 12; i++) {
      t.worlds.tell(`r_${i.toString(16).padStart(16, "0")}`, { subject: "12", verified: false });
    }
    expect(t.sent).toHaveLength(10);
    t.advance(60_001);
    t.worlds.tell("r_00000000000000ff", { subject: "12", verified: false });
    expect(t.sent).toHaveLength(11);
  });
});

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};

/** A world with the real routes in front of it, reporting to a fake musegod. */
async function world() {
  const sent: { muse: string; event: string; url: string }[] = [];
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id) => service.state.residents[id],
    musegodWorlds: {
      key: KEY,
      base: "https://musegod.test",
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as { event: string; url: string };
        const muse = String(input).replace(/^.*\/muses\/([^/]*)\/worlds$/, "$1");
        sent.push({ muse, event: body.event, url: body.url });
        return new Response("{}", { headers: { "content-type": "application/json" } });
      },
    },
  });
  const app = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  const call = jsonCaller(await listenOnFreePort(app, cleanups));
  return { service, call, sent };
}

describe("what Terrakin tells musegod as it happens", () => {
  it("reports a muse named in a resident's bio, and its leave when the bio changes", async () => {
    const t = await world();
    const { residentId, token } = t.service.createSession({ name: "Ada", kind: "agent" });
    expect(token).toBeTruthy();
    await t.call("PUT", "/v1/profile", { bio: "muse #12 of MUSEGOD, here for the tea" }, token);
    await t.call("PUT", "/v1/profile", { bio: "just here for the tea" }, token);
    expect(t.sent).toEqual([
      { muse: "12", event: "joined", url: `https://terrakin.org/r/${residentId}` },
      { muse: "12", event: "left", url: `https://terrakin.org/r/${residentId}` },
    ]);
  });

  it("reports a muse named in a resident's name, once, however often it joins", async () => {
    const t = await world();
    t.service.createSession({ name: "Moss", kind: "agent" });
    const { residentId } = t.service.createSession({ name: "muse #7 of MUSEGOD", kind: "agent" });
    const id = residentId as string;
    t.service.leave(id);
    t.service.ensureOnline(id);
    expect(t.sent).toEqual([{ muse: "7", event: "joined", url: `https://terrakin.org/r/${id}` }]);
    expect(t.sent[0]?.url).toMatch(MUSEGOD_URL);
  });
});
