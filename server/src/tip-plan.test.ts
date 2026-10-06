import { ECONOMY } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { Moderation } from "./moderation";
import {
  ALL_TIP_NOTES,
  DEFAULT_TIP_NOTES,
  type FeedPost,
  type Giver,
  nextState,
  planTips,
  TIP_NOTES,
  TIPS,
  type TipInput,
  tipNotesFor,
  type WelcomeLine,
} from "./tip-plan";

const DAY = 20_400;
const NOW = DAY * 86_400_000 + 15 * 3_600_000;
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const giver = (key: string, balance: number = ECONOMY.townsfolkBudget): Giver => ({
  key,
  name: key[0]?.toUpperCase() + key.slice(1),
  residentId: `t_${key}`,
  balance,
  ledger: [{ day: DAY, amount: balance, reason: "budget" }],
  notes: { welcome: `welcome from ${key}`, post: `post tip from ${key}` },
});

const welcome = (seq: number, id: string, day = DAY): WelcomeLine => ({
  seq,
  day,
  residentId: id,
  name: id,
});

const post = (id: string, authorId: string, reactions: number, hours = 2): FeedPost => ({
  id,
  authorId,
  authorName: authorId,
  authorTownsfolk: false,
  createdAt: hoursAgo(hours),
  reactions,
});

const input = (over: Partial<TipInput> = {}): TipInput => ({
  today: DAY,
  now: NOW,
  givers: [giver("clem"), giver("pip")],
  townsfolk: ["t_clem", "t_pip"],
  welcomes: [],
  posts: [],
  state: { tippedPosts: [] },
  ...over,
});

const gifts = (plan: ReturnType<typeof planTips>) =>
  plan.welcomes.flatMap((s) => ("gift" in s ? [s.gift] : []));

describe("townsfolk tips", () => {
  it("use the sim's numbers and notes that pass the server's rules", () => {
    expect(TIPS.perResident).toBe(ECONOMY.townsfolkPerResident);
    expect(TIPS.post).toBeLessThanOrEqual(ECONOMY.townsfolkPerResident);
    expect(TIPS.welcome).toBeLessThanOrEqual(ECONOMY.townsfolkBudget);
    // Every note is different, so a ledger line says which kind of gift it was.
    const notes = [...Object.values(TIP_NOTES), DEFAULT_TIP_NOTES].flatMap((n) => [
      n.welcome,
      n.post,
    ]);
    expect(new Set(notes).size).toBe(notes.length);
    const filters = new Moderation();
    for (const note of notes) {
      expect(note.length).toBeLessThanOrEqual(ECONOMY.noteMax);
      expect(filters.review("gift_note", note).ok, note).toBe(true);
    }
    expect(tipNotesFor("clem")).toBe(TIP_NOTES.clem);
    expect(tipNotesFor("toString")).toBe(DEFAULT_TIP_NOTES);
    expect(tipNotesFor(undefined)).toBe(DEFAULT_TIP_NOTES);
  });

  it("welcome each newcomer since the last run with 10, taking turns between townsfolk", () => {
    const plan = planTips(
      input({
        welcomes: [welcome(5, "r_old", DAY - 1), welcome(9, "r_ada"), welcome(12, "r_bob")],
        state: { welcomedThrough: 5, tippedPosts: [] },
      }),
    );
    const given = gifts(plan);
    expect(given.map((g) => [g.to, g.amount, g.why])).toEqual([
      ["r_ada", 10, "welcome"],
      ["r_bob", 10, "welcome"],
    ]);
    // Turns start at today % 2 and alternate.
    expect(new Set(given.map((g) => g.from.key)).size).toBe(2);
    expect(given[0]?.note).toBe(`welcome from ${given[0]?.from.key}`);
    expect(plan.unfunded).toBe(0);
  });

  it("on a first run, welcome only today's and yesterday's newcomers", () => {
    const plan = planTips(
      input({
        welcomes: [
          welcome(3, "r_old", DAY - 5),
          welcome(7, "r_yday", DAY - 1),
          welcome(8, "r_new"),
        ],
      }),
    );
    expect(gifts(plan).map((g) => g.to)).toEqual(["r_yday", "r_new"]);
    expect(plan.baseline).toBe(3);
    expect(nextState({ tippedPosts: [] }, plan, { postTried: false, today: DAY })).toEqual({
      welcomedThrough: 3,
      tippedPosts: [],
    });
  });

  it("skip townsfolk, anyone already welcomed, and anyone who had 25 from townsfolk today", () => {
    const clem = giver("clem");
    clem.ledger.push(
      { day: DAY - 3, amount: -10, reason: "gift_out", with: "r_ada", note: "welcome from clem" },
      { day: DAY, amount: -25, reason: "gift_out", with: "r_bob", note: "post tip from clem" },
    );
    const plan = planTips(
      input({
        givers: [clem, giver("pip")],
        welcomes: [
          welcome(1, "r_ada"),
          welcome(2, "r_bob"),
          welcome(3, "t_pip"),
          welcome(4, "r_cy"),
        ],
        state: { welcomedThrough: 0, tippedPosts: [] },
      }),
    );
    expect(plan.welcomes.map((s) => ("gift" in s ? s.gift.to : `skip ${s.skip}`))).toEqual([
      "skip already welcomed",
      "skip had their townsfolk coins for today",
      "skip townsfolk",
      "r_cy",
    ]);
  });

  it("notice when the treasury's history no longer reaches the last run", () => {
    const state = { welcomedThrough: 40, tippedPosts: [] };
    expect(planTips(input({ state, oldestTreasurySeq: 41 })).gap).toBeUndefined();
    expect(planTips(input({ state, oldestTreasurySeq: 60 })).gap).toBe(true);
  });

  it("count only the newcomers still to welcome as waiting", () => {
    const plan = planTips(
      input({
        givers: [giver("clem", 0), giver("pip", 0)],
        welcomes: [welcome(1, "r_a"), welcome(2, "t_pip"), welcome(3, "r_b")],
        state: { welcomedThrough: 0, tippedPosts: [] },
      }),
    );
    expect(plan.unfunded).toBe(2);
  });

  it("give less than 10 when the newcomer is near the day's townsfolk limit", () => {
    const pip = giver("pip");
    pip.ledger.push({ day: DAY, amount: -20, reason: "gift_out", with: "r_ada", note: "hi" });
    const plan = planTips(
      input({
        givers: [giver("clem"), pip],
        welcomes: [welcome(1, "r_ada")],
        state: { welcomedThrough: 0, tippedPosts: [] },
      }),
    );
    expect(gifts(plan).map((g) => g.amount)).toEqual([5]);
  });

  it("stop at the first newcomer the budgets can't cover, and leave the rest waiting", () => {
    const plan = planTips(
      input({
        givers: [giver("clem", 15), giver("pip", 4)],
        welcomes: [welcome(1, "r_a"), welcome(2, "r_b"), welcome(3, "r_c")],
        state: { welcomedThrough: 0, tippedPosts: [] },
      }),
    );
    expect(gifts(plan).map((g) => g.to)).toEqual(["r_a"]);
    expect(plan.unfunded).toBe(2);
  });

  it("tip the most-reacted post of the last day, never townsfolk or older posts", () => {
    const plan = planTips(
      input({
        posts: [
          post("p_old", "r_old", 40, 30),
          { ...post("p_town", "t_clem", 30), authorTownsfolk: true },
          post("p_flagged", "r_x", 20),
          { ...post("p_badge", "r_npc", 25), authorTownsfolk: true },
          post("p_best", "r_ada", 9),
          post("p_ada2", "r_ada", 8),
          post("p_bob", "r_bob", 3),
          post("p_none", "r_cy", 0),
        ],
        townsfolk: ["t_clem", "t_pip", "r_x"],
      }),
    );
    expect(plan.posts.map((g) => [g.postId, g.to, g.amount])).toEqual([
      ["p_best", "r_ada", 25],
      ["p_bob", "r_bob", 25],
    ]);
    expect(plan.posts[0]?.note).toMatch(/^post tip from /);
  });

  it("tip a newcomer's post only up to what's left of their 25", () => {
    const plan = planTips(
      input({
        welcomes: [welcome(1, "r_ada")],
        posts: [post("p_best", "r_ada", 9)],
        state: { welcomedThrough: 0, tippedPosts: [] },
      }),
    );
    expect(plan.posts.map((g) => g.amount)).toEqual([15]);
    // From whoever has the most left after the welcomes.
    expect(plan.posts[0]?.from.key).not.toBe(gifts(plan)[0]?.from.key);
  });

  it("tip one post a day, and never the same post twice", () => {
    const posts = [post("p_best", "r_ada", 9), post("p_next", "r_bob", 2)];
    expect(planTips(input({ posts, state: { postTipDay: DAY, tippedPosts: [] } }))).toMatchObject({
      posts: [],
      noPostTip: "already tipped a post today",
    });
    const clem = giver("clem");
    clem.ledger.push({
      day: DAY,
      amount: -5,
      reason: "gift_out",
      with: "r_z",
      note: "post tip from pip",
    });
    expect(planTips(input({ posts, givers: [clem, giver("pip")] })).posts).toEqual([]);
    const again = planTips(
      input({ posts, state: { postTipDay: DAY - 1, tippedPosts: ["p_best"] } }),
    );
    expect(again.posts.map((g) => g.postId)).toEqual(["p_next"]);
  });

  it("give nothing when the budgets are spent", () => {
    const plan = planTips(
      input({
        givers: [giver("clem", 0), giver("pip", 0)],
        welcomes: [welcome(1, "r_a")],
        posts: [post("p_best", "r_ada", 9)],
        state: { welcomedThrough: 0, tippedPosts: [] },
      }),
    );
    expect(gifts(plan)).toEqual([]);
    expect(plan.unfunded).toBe(1);
    expect(plan.noPostTip).toBe("no budget left");
  });

  it("count every townsfolk purse and every known note, whoever gives today", () => {
    // Bram, suspended today, welcomed Ash yesterday with his own note, and Clem's handle changed,
    // so Clem gives with the shared notes now. Neither hides Bram's welcome.
    const bram = { ...giver("bram"), ledger: [] as Giver["ledger"] };
    bram.ledger.push({
      day: DAY,
      amount: -10,
      reason: "gift_out",
      with: "ash",
      note: TIP_NOTES.bram.welcome,
    });
    const clem = { ...giver("clem"), notes: DEFAULT_TIP_NOTES };
    const plan = planTips(
      input({
        givers: [clem],
        welcomes: [welcome(5, "ash")],
        otherLedgers: [bram.ledger],
        knownNotes: ALL_TIP_NOTES,
      }),
    );
    expect(plan.welcomes).toEqual([{ seq: 5, skip: "already welcomed", name: "ash" }]);
    // Without them, Ash would be welcomed again.
    expect(gifts(planTips(input({ givers: [clem], welcomes: [welcome(5, "ash")] })))).toHaveLength(
      1,
    );
  });

  it("remember the newcomers handled and the posts tipped", () => {
    const plan = planTips(input());
    const state = nextState({ welcomedThrough: 4, tippedPosts: ["p_1"] }, plan, {
      welcomedThrough: 9,
      postTried: true,
      postTipped: "p_2",
      today: DAY,
    });
    expect(state).toEqual({ welcomedThrough: 9, postTipDay: DAY, tippedPosts: ["p_1", "p_2"] });
    const many = { tippedPosts: Array.from({ length: TIPS.rememberPosts }, (_, i) => `p_${i}`) };
    const trimmed = nextState(many, plan, { postTried: true, postTipped: "p_new", today: DAY });
    expect(trimmed.tippedPosts).toHaveLength(TIPS.rememberPosts);
    expect(trimmed.tippedPosts.at(-1)).toBe("p_new");
  });
});
