import { KARMA, karmaTier } from "@terrakin/protocol";
import { ECONOMY, type Resident, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { type KarmaFacts, type KarmaRules, scoreKarma } from "./karma";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, WorldService } from "./world-service";

const none: KarmaFacts = {
  reactions: [],
  praise: [],
  gifts: [],
  heartedReplies: [],
  votes: [],
  upheld: [],
};
const anyone: KarmaRules = { counts: () => true, paired: () => false };
const score = (facts: Partial<KarmaFacts>, rules = anyone) =>
  scoreKarma({ ...none, ...facts }, rules);
/** `n` residents who each did something for `to` on `day`. */
const many = (n: number, to: string, day = 1) =>
  Array.from({ length: n }, (_, i) => ({ from: `r${i}`, to, day }));

describe("karma tiers", () => {
  it("start at the numbers in KARMA", () => {
    expect(karmaTier(0)).toBe("newcomer");
    expect(karmaTier(KARMA.tiers.neighbor - 1)).toBe("newcomer");
    expect(karmaTier(KARMA.tiers.neighbor)).toBe("neighbor");
    expect(karmaTier(KARMA.tiers.regular)).toBe("regular");
    expect(karmaTier(KARMA.tiers.pillar)).toBe("pillar");
    expect(karmaTier(KARMA.tiers.elder)).toBe("elder");
  });
});

describe("scoreKarma", () => {
  it("counts each reactor once a day, by the reactor's own tier", () => {
    const facts: Partial<KarmaFacts> = {
      reactions: [
        { from: "bee", to: "ash", day: 1 },
        { from: "bee", to: "ash", day: 1 },
        { from: "bee", to: "ash", day: 2 },
        // Wren is a Newcomer; Bee reaches Neighbor from praise.
        { from: "wren", to: "ash", day: 1 },
      ],
      praise: many(10, "bee"),
    };
    const scores = score(facts);
    expect(scores.get("bee")).toEqual({ score: 10, tier: "neighbor" });
    expect(scores.get("ash")?.score).toBe(2 * KARMA.reaction.neighbor + KARMA.reaction.newcomer);
  });

  it("reads the giver's tier from a pass where everything counts as a Newcomer's", () => {
    // First pass: Bee has 8 Newcomers and Ash (9, Newcomer), Ash has 10 praise and Bee (11,
    // Neighbor). Weighted, Ash's reaction lifts Bee to 10, a Neighbor, but Bee's reaction to Ash
    // still weighs what Bee had in the first pass, so nobody's weight depends on their own.
    const facts: Partial<KarmaFacts> = {
      reactions: [
        ...many(8, "bee"),
        { from: "ash", to: "bee", day: 1 },
        { from: "bee", to: "ash", day: 1 },
      ],
      praise: many(10, "ash"),
    };
    const scores = score(facts);
    expect(scores.get("bee")).toEqual({ score: 8 + KARMA.reaction.neighbor, tier: "neighbor" });
    expect(scores.get("ash")?.score).toBe(10 + KARMA.reaction.newcomer);
  });

  it("ignores yourself, residents who don't count, and a person and their own AI", () => {
    const facts: Partial<KarmaFacts> = {
      reactions: [
        { from: "ash", to: "ash", day: 1 },
        { from: "clem", to: "ash", day: 1 },
        { from: "ai", to: "ash", day: 1 },
      ],
      praise: [{ from: "ai", to: "ash", day: 1 }],
      gifts: [{ from: "clem", to: "ash", day: 1 }],
      heartedReplies: [{ from: "ai", to: "ash" }],
    };
    const scores = score(facts, {
      counts: (id) => id !== "clem",
      paired: (a, b) => [a, b].sort().join() === "ai,ash",
    });
    expect(scores.get("ash")).toBeUndefined();
  });

  it("counts gifts once a giver a day, praise, hearted replies, and each proposal voted on once", () => {
    const scores = score({
      gifts: [
        { from: "bee", to: "ash", day: 1 },
        { from: "bee", to: "ash", day: 1 },
        { from: "bee", to: "ash", day: 2 },
      ],
      praise: [{ from: "bee", to: "ash", day: 3 }],
      heartedReplies: [
        { from: "bee", to: "ash" },
        { from: "bee", to: "ash" },
      ],
      votes: [
        { from: "ash", proposal: "p1" },
        { from: "ash", proposal: "p1" },
        { from: "ash", proposal: "p2" },
      ],
    });
    expect(scores.get("ash")?.score).toBe(
      2 * KARMA.gift + KARMA.praise.newcomer + 2 * KARMA.heartedReply + 2 * KARMA.vote,
    );
  });

  it("weighs praise by the giver's tier: a Newcomer's counts 1, a Neighbor's 2, a Pillar's 3", () => {
    const scores = score({
      praise: [
        ...many(10, "bee"),
        ...many(KARMA.tiers.pillar, "cy"),
        { from: "bee", to: "ash", day: 2 },
        { from: "wren", to: "ash", day: 2 },
        { from: "cy", to: "ash", day: 2 },
      ],
    });
    expect(scores.get("bee")?.tier).toBe("neighbor");
    expect(scores.get("cy")?.tier).toBe("pillar");
    expect(scores.get("ash")?.score).toBe(2 + 1 + 3);
  });

  it("counts each admirer of your work once a day, by the admirer's tier", () => {
    const scores = score({
      praise: many(10, "bee"),
      admires: [
        { from: "bee", to: "ash", day: 2 },
        { from: "bee", to: "ash", day: 2 },
        { from: "wren", to: "ash", day: 2 },
        { from: "wren", to: "ash", day: 3 },
        { from: "ash", to: "ash", day: 3 },
      ],
    });
    expect(scores.get("ash")?.score).toBe(KARMA.admire.neighbor + KARMA.admire.newcomer * 2);
  });

  it("keeps a small ring of new accounts praising each other at Newcomer", () => {
    // Six accounts, each praised by the other five. At 2 a praise they'd all be Neighbors (10)
    // and could start earning appreciation coins from each other's reactions.
    const ring = ["a", "b", "c", "d", "e", "f"];
    const praise = ring.flatMap((to) =>
      ring.filter((f) => f !== to).map((f) => ({ from: f, to, day: 1 })),
    );
    const scores = score({ praise });
    for (const id of ring) expect(scores.get(id)).toEqual({ score: 5, tier: "newcomer" });
  });

  it("counts a resident's bounties once per poster and claimant, and each town bounty", () => {
    const scores = score(
      {
        bounties: [
          { from: "bee", to: "ash", bounty: "b_1" },
          { from: "bee", to: "ash", bounty: "b_2" },
          { from: "cy", to: "ash", bounty: "b_3" },
          { from: "town", to: "ash", bounty: "b_4" },
          { from: "town", to: "ash", bounty: "b_5" },
          // Your own AI's bounty, and a townsfolk's, count for nothing.
          { from: "ai", to: "ash", bounty: "b_6" },
          { from: "clem", to: "ash", bounty: "b_7" },
        ],
      },
      {
        counts: (id) => id !== "clem",
        paired: (a, b) => [a, b].sort().join() === "ai,ash",
      },
    );
    expect(scores.get("ash")?.score).toBe(4 * KARMA.bounty);
    expect(KARMA.bounty).toBe(5);
  });

  it("gives a host 1 a counted guest, up to 10 an event, and a guest 1 a day they counted", () => {
    const guests = (n: number) => Array.from({ length: n }, (_, i) => `g${i}`);
    const scores = score(
      {
        hosted: [
          // Twelve guests count as ten; the town earns nothing for its own events.
          { host: "ash", event: "e_1", day: 1, guests: guests(12) },
          { host: "ash", event: "e_2", day: 2, guests: ["g0", "ai", "clem"] },
          { host: "town", event: "e_3", day: 2, guests: guests(5) },
        ],
        attended: [
          { from: "g0", host: "ash", day: 1 },
          { from: "g0", host: "ash", day: 2 },
          // Two hosts in one day still make one day.
          { from: "g1", host: "ash", day: 1 },
          { from: "g1", host: "town", day: 1 },
          // Nothing at a host in your own household, or at a townsfolk's event.
          { from: "ai", host: "ash", day: 2 },
          { from: "g2", host: "clem", day: 2 },
        ],
      },
      {
        counts: (id) => id !== "clem",
        paired: (a, b) => [a, b].sort().join() === "ai,ash",
      },
    );
    // Day 2's event counts only g0: Ash's own AI and the townsfolk don't count for Ash.
    expect(scores.get("ash")?.score).toBe(10 + 1);
    expect(scores.get("g0")?.score).toBe(2);
    expect(scores.get("g1")?.score).toBe(1);
    expect(scores.get("ai")).toBeUndefined();
    expect(scores.get("g2")).toBeUndefined();
    expect(scores.get("town")).toBeUndefined();
  });

  it("takes points off for each upheld report, never below 0", () => {
    const scores = score({ praise: many(12, "ash"), upheld: ["ash", "bee"] });
    expect(scores.get("ash")?.score).toBe(12 - KARMA.upheldReport);
    expect(scores.get("bee")).toEqual({ score: 0, tier: "newcomer" });
  });
});

// ---------- the service, on a real social database ----------

const TODAY = 20_400;
const NOON = TODAY * DAY_MS + DAY_MS / 2;
const closers: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  expect(problems.splice(0)).toEqual([]);
});

/**
 * A social layer whose residents all exist with a hearth and are 30 days old unless a test says
 * otherwise. Rows go straight into its tables.
 */
function social(options: { townsfolk?: string[] } = {}) {
  const proposals = new Map<string, string>();
  const sql = nodeSql();
  closers.push(() => sql.close());
  const hearthless = new Set<string>();
  const age = new Map<string, number>();
  const s = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    now: () => NOON,
    resident: (id) =>
      id.startsWith("ghost")
        ? undefined
        : ({ id, hearth: hearthless.has(id) ? null : { x: 0, y: 0 } } as unknown as Resident),
    townsfolk: new Set(options.townsfolk ?? []),
    residentAgeDays: (id) => age.get(id) ?? 30,
    proposal: (id) => {
      const author = proposals.get(id);
      return author ? { author, title: "t", text: "t" } : undefined;
    },
  });
  let n = 0;
  const post = (author: string, replyTo?: string) => {
    const id = `p${++n}`;
    sql.exec(
      "INSERT INTO posts (id, author, text, created_at) VALUES (?, ?, 'hi', ?)",
      id,
      author,
      NOON - 10 * DAY_MS,
    );
    if (replyTo) sql.exec("UPDATE posts SET reply_to = ? WHERE id = ?", replyTo, id);
    return id;
  };
  const react = (who: string, postId: string, day: number, key = "heart") =>
    sql.exec(
      "INSERT INTO reactions (post_id, resident_id, key, created_at) VALUES (?, ?, ?, ?)",
      postId,
      who,
      key,
      day * DAY_MS + 1000,
    );
  /** `count` praises for `to`, from distinct Newcomers, on past days: 1 point each. */
  const praised = (to: string, count: number) => {
    for (let i = 0; i < count; i++) {
      sql.exec(
        "INSERT INTO praise (giver, receiver, day, created_at) VALUES (?, ?, ?, 0)",
        `fan${i}`,
        to,
        TODAY - 5,
      );
    }
  };
  /** Make residents Neighbors. */
  const neighbors = (...ids: string[]) => {
    for (const id of ids) praised(id, KARMA.tiers.neighbor);
  };
  /** Link an AI to its person. */
  const own = (agent: string, owner: string) =>
    sql.exec(
      "INSERT INTO owner_links (agent_id, owner_id, created_at) VALUES (?, ?, 0)",
      agent,
      owner,
    );
  let reports = 0;
  /** A report on something, closed by staff at `closedAt` with `status`. */
  const report = (kind: string, target: string, status: string, closedAt = NOON - DAY_MS) =>
    sql.exec(
      `INSERT INTO reports (id, kind, target, reporter, reason, note, created_at, status, closed_at)
        VALUES (?, ?, ?, ?, 'spam', '', 0, ?, ?)`,
      `rep${++reports}`,
      kind,
      target,
      `reporter${reports}`,
      status,
      closedAt,
    );
  return { s, sql, post, react, praised, neighbors, hearthless, age, own, report, proposals };
}

describe("karma on the social layer", () => {
  it("covers the 90 days up to yesterday, and shows on profiles", () => {
    const t = social();
    const post = t.post("ash");
    t.react("bee", post, TODAY - 1);
    t.react("cy", post, TODAY - KARMA.windowDays);
    // Too old, and today's (counted tomorrow).
    t.react("dee", post, TODAY - KARMA.windowDays - 1);
    t.react("eve", post, TODAY);
    expect(t.s.karma.of("ash")).toEqual({ score: 2, tier: "newcomer" });
    expect(t.s.karma.of("nobody")).toEqual({ score: 0, tier: "newcomer" });
    expect(t.s.profile("ash")?.karma).toEqual({ score: 2, tier: "newcomer" });
  });

  it("leaves out reactions on hidden posts and from suspended residents", () => {
    const t = social();
    const shown = t.post("ash");
    const hidden = t.post("ash");
    t.sql.exec("UPDATE posts SET hidden = 1 WHERE id = ?", hidden);
    t.react("bee", hidden, TODAY - 1);
    t.react("cy", shown, TODAY - 1);
    t.sql.exec(
      "INSERT INTO suspensions (resident_id, until, reason, by, at) VALUES ('cy', ?, 'x', 'm', 0)",
      NOON + DAY_MS,
    );
    expect(t.s.karma.of("ash").score).toBe(0);
  });

  it("counts a reply the post's author hearted", () => {
    const t = social();
    const parent = t.post("bee");
    const reply = t.post("ash", parent);
    t.react("bee", reply, TODAY - 1);
    // A heart from Bee on Ash's reply: a reaction (1) and a hearted reply (2).
    expect(t.s.karma.of("ash").score).toBe(KARMA.reaction.newcomer + KARMA.heartedReply);
  });

  it("takes 10 for each thing staff acted on after reports, once however many reported it", () => {
    const t = social();
    t.praised("ash", 60);
    const post = t.post("ash");
    t.report("post", post, "actioned");
    t.report("post", post, "actioned");
    t.report("resident", "ash", "actioned");
    t.sql.exec("INSERT INTO notices (id, author, text, created_at) VALUES ('n1', 'ash', 'hi', 0)");
    t.report("notice", "n1", "actioned");
    t.sql.exec(
      "INSERT INTO letters (id, sender, recipient, text, created_at) VALUES ('l1', 'ash', 'bee', 'hi', 0)",
    );
    t.report("letter", "l1", "actioned");
    t.proposals.set("pr1", "ash");
    t.report("proposal", "pr1", "actioned");
    // Dismissed, too old, or from today: none of these count.
    t.report("resident", "ash", "dismissed");
    t.report("post", t.post("ash"), "actioned", NOON - (KARMA.windowDays + 1) * DAY_MS);
    t.report("post", t.post("ash"), "actioned", NOON);
    expect(t.s.karma.of("ash").score).toBe(60 - 5 * KARMA.upheldReport);
  });

  it("reads gifts and votes from the world's credits", () => {
    const sql = nodeSql();
    closers.push(() => sql.close());
    const s = new SocialService({
      sql,
      media: new MemoryMediaStore(),
      now: () => NOON,
      resident: (id) => ({ id }) as unknown as Resident,
      credits: (since) =>
        [
          { kind: "gift" as const, from: "bee", to: "ash", day: TODAY - 1 },
          { kind: "vote" as const, from: "ash", proposal: "p1", day: TODAY - 2 },
          { kind: "gift" as const, from: "bee", to: "ash", day: TODAY },
        ].filter((c) => c.day >= since),
    });
    expect(s.karma.of("ash").score).toBe(KARMA.gift + KARMA.vote);
  });
});

describe("appreciation awards", () => {
  it("pay 1 for each Neighbor who reacted to your posts that day, once each", () => {
    const t = social();
    t.neighbors("bee", "cy");
    const a = t.post("ash");
    const b = t.post("ash");
    const day = TODAY - 1;
    t.react("bee", a, day);
    t.react("bee", b, day);
    t.react("bee", a, day, "wow");
    t.react("cy", a, day);
    // A Newcomer's reaction counts for karma but not for coins.
    t.react("wren", a, day);
    // Another day's reactions belong to that day.
    t.react("cy", b, day - 1);
    expect(t.s.karma.awards(day)).toEqual([{ to: "ash", amount: 2, reason: "appreciation" }]);
  });

  it("stop at the cap", () => {
    const t = social();
    const fans = Array.from({ length: ECONOMY.appreciationCap + 5 }, (_, i) => `fan${i}`);
    const post = t.post("ash");
    for (const fan of fans) t.react(fan, post, TODAY - 1);
    // Every fan praised every other fan once on a past day: plenty to be a Neighbor.
    for (const fan of fans) {
      for (const other of fans) {
        if (other === fan) continue;
        t.sql.exec(
          "INSERT INTO praise (giver, receiver, day, created_at) VALUES (?, ?, ?, 0)",
          other,
          fan,
          TODAY - 3,
        );
      }
    }
    expect(t.s.karma.awards(TODAY - 1)).toEqual([
      { to: "ash", amount: ECONOMY.appreciationCap, reason: "appreciation" },
    ]);
  });

  it("need a reactor with a hearth, old enough that day, and never yourself or your own AI", () => {
    const t = social();
    t.neighbors("ash", "homeless", "young", "older", "ai");
    t.sql.exec("INSERT INTO owner_links (agent_id, owner_id, created_at) VALUES ('ai', 'ash', 0)");
    t.hearthless.add("homeless");
    const day = TODAY - 2;
    // Ages are as of today. Young was 2 days old on the day they reacted, Older was 3.
    t.age.set("young", 4);
    t.age.set("older", 5);
    const post = t.post("ash");
    for (const who of ["ash", "homeless", "young", "older", "ai"]) t.react(who, post, day);
    expect(t.s.karma.awards(day)).toEqual([{ to: "ash", amount: 1, reason: "appreciation" }]);
  });

  it("never come from your household: your person, your AI, or another AI of your person", () => {
    const t = social();
    t.neighbors("ai1", "ai2", "kim");
    t.own("ai1", "kim");
    t.own("ai2", "kim");
    const day = TODAY - 1;
    t.react("ai2", t.post("ai1"), day);
    t.react("kim", t.post("ai2"), day);
    t.react("ai1", t.post("kim"), day);
    expect(t.s.karma.awards(day)).toEqual([]);
    expect(t.s.karma.of("ai1").score).toBe(10);
  });

  it("read the reactor's tier from before the day, so that day's praise can't lift it", () => {
    const t = social();
    const day = TODAY - 1;
    for (let i = 0; i < 10; i++) {
      t.sql.exec(
        "INSERT INTO praise (giver, receiver, day, created_at) VALUES (?, 'bee', ?, 0)",
        `fan${i}`,
        day,
      );
    }
    t.react("bee", t.post("ash"), day);
    expect(t.s.karma.of("bee").tier).toBe("neighbor");
    expect(t.s.karma.awards(day)).toEqual([]);
    expect(t.s.karma.awards(TODAY)).toEqual([]);
  });

  it("never go to or come from townsfolk or suspended residents, or to someone gone", () => {
    const t = social({ townsfolk: ["clem"] });
    t.neighbors("bee", "clem", "cy");
    t.sql.exec(
      "INSERT INTO suspensions (resident_id, until, reason, by, at) VALUES ('sus', ?, 'x', 'm', 0)",
      NOON + DAY_MS,
    );
    const day = TODAY - 1;
    for (const author of ["clem", "sus", "ghost"]) t.react("bee", t.post(author), day);
    t.react("clem", t.post("ash"), day);
    t.react("cy", t.post("dot"), day);
    expect(t.s.karma.awards(day)).toEqual([{ to: "dot", amount: 1, reason: "appreciation" }]);
  });

  it("list residents in id order", () => {
    const t = social();
    t.neighbors("bee");
    const day = TODAY - 1;
    for (const author of ["zed", "ash", "moe"]) t.react("bee", t.post(author), day);
    expect(t.s.karma.awards(day).map((a) => a.to)).toEqual(["ash", "moe", "zed"]);
  });
});

describe("appreciation coins in a running world", () => {
  const CONFIG: WorldConfig = {
    width: 40,
    height: 40,
    plotSize: 4,
    maxPlotsPerResident: 1,
    reach: 2,
  };

  /** A world and its social layer over one store and database, as an adapter builds them. */
  function boot(store: MemoryStore, sql: ReturnType<typeof nodeSql>, now: () => number) {
    const service = new WorldService({ store, config: CONFIG, now, days: true, economy: true });
    const media = new MemoryMediaStore();
    const social = new SocialService({
      sql,
      media,
      resident: (id) => service.state.residents[id],
      now,
      residentAgeDays: (id) => service.residentAgeDays(id),
      credits: (since) => service.credits(since),
    });
    const server = createApp({
      service,
      social,
      media,
      actionsPerSecond: 1000,
      sessionsPerMinute: 1000,
      onResponse,
    });
    return { service, server };
  }

  /**
   * Ash posts on day 3 and two residents react: Bee, a Neighbor with a hearth, and Wren, a
   * Newcomer. Nothing is paid yet.
   */
  async function scene() {
    let now = Date.UTC(2026, 9, 5, 9);
    const clock = () => now;
    const store = new MemoryStore();
    const sql = nodeSql();
    closers.push(() => sql.close());
    const { service, server } = boot(store, sql, clock);
    const call = jsonCaller(await listenOnFreePort(server, closers));
    const join = (name: string) => {
      const made = service.createSession({ name, kind: "agent" });
      if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
      return { id: made.residentId, token: made.token };
    };
    const ash = join("Ash");
    const bee = join("Bee");
    const wren = join("Wren");
    for (const [who, px] of [
      [bee, 1],
      [wren, 3],
    ] as const) {
      await call("POST", "/v1/actions", { type: "settle", px, py: 1 }, who.token);
      await call("POST", "/v1/actions", { type: "build_starter_home" }, who.token);
    }
    const today = Math.floor(now / DAY_MS);
    for (let i = 0; i < 10; i++) {
      sql.exec(
        "INSERT INTO praise (giver, receiver, day, created_at) VALUES (?, ?, ?, 0)",
        `fan${i}`,
        bee.id,
        today,
      );
    }
    for (let i = 0; i < 3; i++) {
      now += DAY_MS;
      service.tick();
    }
    const posted = await call("POST", "/v1/posts", { text: "First jam of the season" }, ash.token);
    for (const who of [bee, wren]) {
      const res = await call(
        "PUT",
        `/v1/posts/${posted.body.post.id}/reactions/heart`,
        undefined,
        who.token,
      );
      expect(res.status).toBe(200);
    }
    const awardsLogged = () =>
      store
        .loadLog()
        .filter((i) => i.command.type === "daily_awards")
        .map((i) => i.command);
    return {
      call,
      service,
      ash,
      bee,
      wren,
      paidDay: today + 3,
      awardsLogged,
      /** Move the clock without a request, as a quiet world does. */
      wait: (days: number) => {
        now += days * DAY_MS;
      },
      restart: () => boot(store, sql, clock).service,
    };
  }

  it("are logged once at the turn of the day, and only the earner hears of them", async () => {
    const t = await scene();
    const heard = new Map<string, unknown[]>();
    for (const r of [t.ash, t.bee, t.wren]) {
      const got: unknown[] = [];
      heard.set(r.id, got);
      closers.push(t.service.subscribe(r.id, (m) => got.push(m)));
    }
    expect(t.awardsLogged()).toEqual([]);
    t.wait(1);
    t.service.tick();
    t.service.tick();
    expect(t.awardsLogged()).toEqual([
      {
        type: "daily_awards",
        day: t.paidDay,
        awards: [{ to: t.ash.id, amount: 1, reason: "appreciation" }],
      },
    ]);
    const appreciation = (m: unknown) =>
      (m as { event?: { reason?: string } }).event?.reason === "appreciation";
    expect(heard.get(t.ash.id)?.filter(appreciation)).toHaveLength(1);
    expect(heard.get(t.bee.id)?.filter(appreciation)).toEqual([]);
    expect(heard.get(t.wren.id)?.filter(appreciation)).toEqual([]);
    const purse = (await t.call("GET", "/v1/purse", undefined, t.ash.token)).body.purse;
    expect(purse.ledger[0]).toMatchObject({ amount: 1, reason: "appreciation" });
    // Karma counts both reactions from yesterday, Bee's at a Neighbor's weight.
    const profile = (await t.call("GET", `/v1/residents/${t.ash.id}`)).body.resident;
    expect(profile.karma).toEqual({
      score: KARMA.reaction.neighbor + KARMA.reaction.newcomer,
      tier: "newcomer",
    });
  });

  it("catch up on days with no request, and aren't logged again after a restart", async () => {
    const t = await scene();
    t.wait(1);
    t.service.tick();
    // The next day Bee hearts another post, then the world goes quiet for three days.
    const posted = await t.call("POST", "/v1/posts", { text: "Second batch" }, t.ash.token);
    await t.call("PUT", `/v1/posts/${posted.body.post.id}/reactions/heart`, undefined, t.bee.token);
    t.wait(3);
    t.service.tick();
    expect(t.awardsLogged().map((c) => (c.type === "daily_awards" ? c.day : 0))).toEqual([
      t.paidDay,
      t.paidDay + 1,
    ]);
    t.restart().tick();
    expect(t.awardsLogged()).toHaveLength(2);
  });
});

describe("the reaction times migration", () => {
  it("dates reactions saved before it by their post, and leaves newer ones alone", () => {
    const sql = nodeSql();
    closers.push(() => sql.close());
    const options = {
      sql,
      media: new MemoryMediaStore(),
      now: () => NOON,
      resident: (id: string) => ({ id }) as unknown as Resident,
    };
    new SocialService(options);
    sql.exec("INSERT INTO posts (id, author, text, created_at) VALUES ('p1', 'ash', 'hi', 1234)");
    // A database from before the column.
    sql.exec("DROP TABLE reactions");
    sql.exec(
      `CREATE TABLE reactions (
        post_id TEXT NOT NULL, resident_id TEXT NOT NULL, key TEXT NOT NULL,
        PRIMARY KEY (post_id, resident_id, key)
      )`,
    );
    sql.exec("INSERT INTO reactions (post_id, resident_id, key) VALUES ('p1', 'bee', 'heart')");
    new SocialService(options);
    sql.exec("INSERT INTO reactions VALUES ('p1', 'cy', 'heart', 5678)");
    new SocialService(options);
    const times = [...sql.exec("SELECT resident_id, created_at FROM reactions ORDER BY 1")];
    expect(times).toEqual([
      { resident_id: "bee", created_at: 1234 },
      { resident_id: "cy", created_at: 5678 },
    ]);
  });
});
