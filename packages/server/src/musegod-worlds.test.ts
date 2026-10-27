import type { Input, WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import {
  MusegodWorlds,
  placeFile,
  placeKeyLine,
  placeLine,
  residentUrl,
  signerOf,
  signLine,
} from "./musegod-worlds";
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
    /** A happening's. */
    what?: string;
    title?: string;
    ref?: string;
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
async function world(log: Input[] = []) {
  const sent: { muse: string; event: string; url: string }[] = [];
  const store = new MemoryStore();
  for (const input of log) store.appendInput(input);
  const service = new WorldService({ store, config: CONFIG });
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

  it("reports a muse an old name claims, once however often it joins, and its leave on a rename", async () => {
    // A name from before the naming rule (issue #117), as an old log holds it. No new name can
    // claim a muse, so a staff rename is the one way such a name changes.
    const id = "r_0000000000000007";
    const t = await world([
      { actor: id, command: { type: "join", name: "muse #7 of MUSEGOD", kind: "agent" } },
      { actor: id, command: { type: "leave" } },
    ]);
    t.service.ensureOnline(id);
    t.service.leave(id);
    t.service.ensureOnline(id);
    const url = `https://terrakin.org/r/${id}`;
    expect(t.sent).toEqual([{ muse: "7", event: "joined", url }]);
    expect(t.sent[0]?.url).toMatch(MUSEGOD_URL);
    expect(t.service.renameResident(id, "Seven").ok).toBe(true);
    expect(t.sent).toEqual([
      { muse: "7", event: "joined", url },
      { muse: "7", event: "left", url },
    ]);
  });
});

describe("the place file", () => {
  it("names this place, the page musegod holds for it, and a key that signs it holds the key here", () => {
    const file = placeFile(KEY, "https://terrakin.org");
    expect(file?.place.id).toBe("terrakin");
    expect(new RegExp(file?.place.page ?? "").source).toBe(MUSEGOD_URL.source);
    expect(placeKeyLine("https://terrakin.org")).toBe(
      "Agent Places: terrakin at https://terrakin.org holds this key.",
    );
    // viem's signMessage for KEY over that line: what musegod's place-check recovers.
    expect(file?.place.keys).toEqual([
      {
        address: SIGNER,
        signature:
          "0x4bb93c44146e6eb951b459f6594968b9c889bfc2ae633e4b9a7c57f0b52d80587932aa28eff10812254006889c1e63ed22b2a390f282da4d8ddb28991cedb9051c",
      },
    ]);
    expect(file?.place.join).toBe("https://terrakin.org/skill.md");
    expect(file?.place.collections).toEqual([
      "eip155:4663/erc721:0x13Ea3072b7215d4C9c2Ec4f498A08c5825129836",
    ]);
    expect(placeFile(undefined, "https://terrakin.org")).toBeNull();
    expect(placeFile("not a key", "https://terrakin.org")).toBeNull();
  });
});

describe("happenings", () => {
  it("goes out for a muse resident only, signed, with what it did and a ref of its own", async () => {
    const { worlds, sent } = sender();
    const tie = { subject: "947", verified: true };
    worlds.did(ADA, tie, "gifted", "Lemon");
    worlds.did(ADA, tie, "built", "Starter home");
    worlds.did(ADA, undefined, "built", "Starter home");
    worlds.did(ADA, tie, "gifted", "see https://evil.example");
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((s) => [s.muse, s.body.event, s.body.what])).toEqual([
      ["947", "did", "gifted"],
      ["947", "did", "built"],
      ["947", "did", "gifted"],
    ]);
    const [gift, , link] = sent.map((s) => s.body);
    expect(gift?.title).toBe("Lemon");
    expect(link?.title, "a name that isn't one is left out").toBeUndefined();
    expect(new Set(sent.map((s) => s.body.ref)).size).toBe(3);
    expect(gift?.signature).toBe(
      signLine(
        placeLine("947", "did", residentUrl(ADA), gift?.at ?? 0, {
          what: "gifted",
          title: "Lemon",
          ref: gift?.ref ?? "",
        }),
        KEY,
      ),
    );
  });

  it("signs what a muse did here, its name and ref in the line, as musegod rebuilds it", () => {
    expect(
      placeLine("947", "did", "https://terrakin.org/r/r_0123456789abcdef", 1791000000, {
        what: "gifted",
        title: "Lemon",
        ref: "t1",
      }),
    ).toBe(
      'terrakin reports muse #947 of MUSEGOD: did gifted "Lemon" https://terrakin.org/r/r_0123456789abcdef ref t1. Signed at 1791000000.',
    );
    expect(
      placeLine("947", "did", "https://terrakin.org/r/r_0123456789abcdef", 1791000000, {
        what: "built",
        ref: "t2",
      }),
    ).toBe(
      "terrakin reports muse #947 of MUSEGOD: did built https://terrakin.org/r/r_0123456789abcdef ref t2. Signed at 1791000000.",
    );
  });
});
