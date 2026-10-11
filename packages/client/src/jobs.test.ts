import { type HeldJobView, type JobsResponse, type JobView, jobView } from "@terrakin/protocol";
import { type Good, handInPick, JOB_EDITIONS, JOBS, type WorldState } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import {
  askedLine,
  boardLede,
  cantTakeLine,
  chipLabel,
  doneLine,
  droppedLine,
  heldBar,
  heldJobLine,
  heldMoves,
  type JobStanding,
  jobProblem,
  jobRowAction,
  jobsRow,
  jobTitles,
  jobWear,
  jobWearAt,
  keptLine,
  newestOnly,
  openedOr,
  progressLine,
  sheetShows,
  shownProblem,
  weekLine,
} from "./jobs";
import { earnedState } from "./levels";
import { wearChoices } from "./look-editor";

/** A job from the sim's own table as the API shows it, its giver living here or not. */
function job(id: string, giverId?: string): JobView {
  const found = (JOB_EDITIONS[1] ?? []).find((j) => j.id === id);
  if (!found) throw new Error(`no job ${id}`);
  return jobView(found, giverId);
}

const held = (id: string, count: number, giverId?: string): HeldJobView => {
  const { id: _id, points: _points, ...asked } = job(id, giverId);
  return { job: id, ...asked, count, of: asked.deed?.count ?? 1, lapsesDay: 107 };
};

const standing = (over: Partial<JobStanding> = {}): JobStanding => ({
  held: null,
  doneToday: false,
  week: { done: 0, max: 3 },
  total: 0,
  canTake: true,
  unlocked: [],
  ...over,
});

describe("who a job is for", () => {
  it("is its giver while that townsfolk lives here, and the town when they don't", () => {
    expect(askedLine(job("juniper_herbs", "r_j").from)).toBe("For Juniper");
    expect(askedLine(job("juniper_herbs").from)).toBe("For the town");
  });
});

describe("the week", () => {
  it("says how many are left of the ones that count, and leaves when the next can be taken to the server", () => {
    expect(weekLine({ done: 1, max: 3 })).toBe("2 of 3 left this week.");
    expect(weekLine({ done: 0, max: 3 })).toBe("3 of 3 left this week.");
    expect(weekLine({ done: 3, max: 3 })).toBe("0 of 3 left this week.");
    // A count past the bound never reads as a negative number.
    expect(weekLine({ done: 4, max: 3 })).toBe("0 of 3 left this week.");
  });
});

describe("the words over the board", () => {
  // Numbers no rule has, so the words can only have come from what the server sent.
  const rules: JobsResponse["rules"] = {
    board: 4,
    held: 1,
    perDay: 1,
    perWeek: 3,
    points: 12,
    keepDays: 7,
    unlocks: [],
  };

  it("take how many a day and what one pays from the server's rules", () => {
    expect(boardLede(rules, true)).toBe(
      "Small things the town asks for, 4 a day. A finished job adds 12 points to its skill, never coins. Take one only if you'd enjoy it.",
    );
  });

  it("tell someone with no button to take one with how to get one", () => {
    const lede = boardLede(rules, false);
    expect(lede).toContain("Step into the world to take one.");
    expect(lede).not.toContain("only if you'd enjoy it");
  });
});

describe("a board row's button", () => {
  const chair = job("bram_chair");
  const herbs = job("juniper_herbs");

  it("is Take only when the server says a job can be taken, and never for a visitor", () => {
    expect(jobRowAction(chair, standing())).toBe("take");
    expect(jobRowAction(chair, null)).toBe("none");
    // The server's answer decides: no hearth, a job finished today, or the week used up.
    expect(jobRowAction(chair, standing({ canTake: false, why: "You need a hearth." }))).toBe(
      "none",
    );
  });

  it("marks the job you hold and offers no other while you hold it", () => {
    const you = standing({ held: held("bram_chair", 0), canTake: false, why: "You hold a job." });
    expect(jobRowAction(chair, you)).toBe("held");
    expect(jobRowAction(herbs, you)).toBe("none");
  });

  it("says why nothing can be taken in the server's words, unless the held job already does", () => {
    expect(cantTakeLine(standing())).toBeNull();
    expect(cantTakeLine(null)).toBeNull();
    expect(cantTakeLine(standing({ canTake: false, why: "You finished a job today." }))).toBe(
      "You finished a job today.",
    );
    const holding = standing({ held: held("bram_chair", 0), canTake: false, why: "You hold one." });
    expect(cantTakeLine(holding)).toBeNull();
  });
});

describe("a refused tap", () => {
  // The sim's own messages for these codes, which it writes for agents.
  const forAgents = {
    job_held: `You're holding a job (bram_chair). Finish it, or let it go first with {"type": "drop_job"}.`,
    unknown_job: "That isn't one of today's jobs. Today's are bram_chair, marlo_find, otis_host.",
    no_job:
      "The job you hold (juniper_herbs) has nothing to hand in: it's done when you've done what it asks.",
  };

  it("never shows a job's id or an action to send", () => {
    const shown = Object.entries(forAgents).map(([code, message]) => jobProblem(code, message));
    expect(shown.filter((line) => /[{}"_`]/.test(line))).toEqual([]);
    expect(shown).toEqual([
      "You already hold a job. Finish it, or let it go, before you take another.",
      "That job isn't on today's board anymore. The board changes at midnight UTC.",
      "You aren't holding that job anymore.",
    ]);
  });

  it("keeps the server's words where they say when", () => {
    const monday =
      "You've finished 3 jobs this week, all a week has. The next one can be taken on Monday.";
    expect(jobProblem("job_limit", monday)).toBe(monday);
  });

  it("names the thing a refused hand-in is missing, and whether someone else made the one held", () => {
    // The sim's own refusals, for Ada holding Clem's herb tea job: with none, and with a jar Bo made.
    const refusal = (goods: Good[]) => {
      const state = {
        day: 100,
        jobs: { edition: 1, held: { ada: { job: "clem_herb_tea", day: 100, seq: 1 } } },
        items: { inventories: { ada: { goods } } },
      } as unknown as WorldState;
      const r = handInPick(state, "ada");
      if (!("code" in r)) throw new Error("handed in");
      return jobProblem(r.code, r.message, "herb_tea");
    };
    const bos: Good = { id: "i_1", kind: "herb_tea", maker: "bo", madeDay: 99 };
    expect([refusal([]), refusal([bos])]).toEqual([
      "You hold no herb tea that you made yet.",
      "The herb tea you hold was made by someone else. A job takes only what you made yourself.",
    ]);
    // Any fruit's jam is "jam". Without the job, the server's words stay.
    expect(jobProblem("nothing_to_hand_in", "You hold no jam that you made.", "jam")).toBe(
      "You hold no jam that you made yet.",
    );
    expect(jobProblem("nothing_to_hand_in", "Make one with craft.")).toBe("Make one with craft.");
  });

  it("is said once: the error line clears when the board's own line says the same", () => {
    const why = "You finished a job today, and a day has one.";
    expect(shownProblem(why, standing({ canTake: false, why }))).toBe("");
    // Another reason, or a board that says nothing, leaves it on screen.
    expect(shownProblem(why, standing({ canTake: false, why: "You need a hearth." }))).toBe(why);
    expect(shownProblem(why, standing())).toBe(why);
    expect(shownProblem(why, null)).toBe(why);
    // The held job hides the board's line, so the refusal is the only place the reason shows.
    const holding = standing({ held: held("bram_chair", 0), canTake: false, why });
    expect(shownProblem(why, holding)).toBe(why);
    expect(shownProblem("", standing())).toBe("");
  });
});

describe("the job sheet", () => {
  const board = (you: JobStanding | null) => ({
    jobs: [job("bram_chair", "r_bram"), job("juniper_herbs", "r_juniper"), job("marlo_find")],
    you,
  });

  it("opened from the chip shows only while you hold a job", () => {
    expect(sheetShows(board(standing({ held: held("bram_chair", 0) })), undefined)).toBe(true);
    expect(sheetShows(board(standing()), undefined)).toBe(false);
    expect(sheetShows(board(null), undefined)).toBe(false);
  });

  it("opened on a giver shows while they ask for something today, whoever holds what", () => {
    expect(sheetShows(board(standing()), "r_bram")).toBe(true);
    expect(sheetShows(board(null), "r_juniper")).toBe(true);
    // Someone who asks for nothing today, and a board that moved on at midnight.
    expect(sheetShows(board(standing()), "r_clem")).toBe(false);
    expect(sheetShows({ jobs: [], you: standing() }, "r_bram")).toBe(false);
  });

  it("stays open over nothing while a refusal is on screen", () => {
    expect(sheetShows(board(standing()), undefined, "You aren't holding that job anymore.")).toBe(
      true,
    );
    expect(sheetShows({ jobs: [], you: null }, "r_bram", "That job isn't on today's board.")).toBe(
      true,
    );
  });
});

describe("a tap on a giver", () => {
  /** What the tap did: opened the sheet, or did what it did before jobs. */
  async function tapped(load: Promise<string>, opens: boolean) {
    const did: string[] = [];
    await openedOr(
      load,
      (sheet) => {
        did.push(`opened ${sheet}`);
        return opens;
      },
      () => did.push("what it did before jobs"),
    );
    return did;
  }

  it("opens the job sheet once its code is in, and else does what it did before jobs", async () => {
    expect(await tapped(Promise.resolve("job sheet"), true)).toEqual(["opened job sheet"]);
    // Nothing to show on it.
    expect(await tapped(Promise.resolve("job sheet"), false)).toEqual([
      "opened job sheet",
      "what it did before jobs",
    ]);
    // Its code didn't load: a deploy took the chunk away, or the link dropped.
    const lost = Promise.reject(new Error("Failed to fetch dynamically imported module"));
    expect(await tapped(lost, true)).toEqual(["what it did before jobs"]);
  });
});

describe("reads of the board that overlap", () => {
  /** Asks answered by hand, in any order. */
  function asks() {
    const answers: ((answer: string) => void)[] = [];
    const landed: string[] = [];
    const read = newestOnly(
      () => new Promise<string>((resolve) => answers.push(resolve)),
      (answer) => landed.push(answer),
    );
    return { read, answers, landed };
  }

  it("land only the newest ask's answer, so a refresh sent before a Take never draws over it", async () => {
    const { read, answers, landed } = asks();
    const refresh = read();
    const afterTake = read();
    answers[1]?.("after the take");
    await afterTake;
    answers[0]?.("before the take");
    await refresh;
    expect(landed).toEqual(["after the take"]);
  });

  it("resolve an older read only once the newest answer has landed", async () => {
    const { read, answers, landed } = asks();
    let olderDone = false;
    const older = read().then(() => {
      olderDone = true;
    });
    const newer = read();
    answers[0]?.("old");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(olderDone).toBe(false);
    answers[1]?.("new");
    await Promise.all([older, newer]);
    expect(landed).toEqual(["new"]);
  });

  it("land every answer when asks don't overlap", async () => {
    const { read, answers, landed } = asks();
    const first = read();
    answers[0]?.("one");
    await first;
    const second = read();
    answers[1]?.("two");
    await second;
    expect(landed).toEqual(["one", "two"]);
  });
});

describe("the job you hold", () => {
  it("can be let go, and handed in only when it asks for a made thing", () => {
    expect(heldMoves(held("juniper_herbs", 1))).toEqual(["drop"]);
    expect(heldMoves(held("clem_jam", 0))).toEqual(["hand_in", "drop"]);
  });

  it("shows how far along a deed job is, and that a bring job waits for its hand-in", () => {
    expect(heldBar(held("juniper_herbs", 1))).toEqual({ count: 1, total: 3, label: "1 of 3 done" });
    expect(heldJobLine(held("juniper_herbs", 1))).toBe("1 of 3 done.");
    expect(chipLabel(held("juniper_herbs", 1))).toBe("Job: 1 of 3");
    expect(heldBar(held("clem_jam", 0))).toEqual({
      count: 0,
      total: 1,
      label: "Not handed in yet",
    });
    expect(heldJobLine(held("clem_jam", 0))).toBe(
      "Make it yourself, then hand it in. It goes to the town.",
    );
    expect(chipLabel(held("clem_jam", 0))).toBe("Job: 0 of 1");
  });

  it("says how many days it's kept, from the world's day", () => {
    const h = held("juniper_herbs", 0);
    expect(keptLine(h, 100)).toBe("7 days left to finish it. Nothing is lost if it lapses.");
    expect(keptLine(h, 106)).toBe(
      "Today is the last day to finish it. Nothing is lost if it lapses.",
    );
    expect(keptLine(h, 107)).toBeNull();
    expect(keptLine(h, null)).toBeNull();
  });
});

describe("a deed that moves your job", () => {
  it("names what it counted and who it's for", () => {
    expect(progressLine({ count: 2, of: 3 }, job("juniper_herbs", "r_j"))).toBe(
      "2 of 3 harvests of herbs for Juniper.",
    );
    expect(progressLine({ count: 1, of: 3 }, job("juniper_crops"))).toBe(
      "1 of 3 harvests for the town.",
    );
    expect(progressLine({ count: 2, of: 3 }, job("sable_three_fish", "r_s"))).toBe(
      "2 of 3 fish for Sable.",
    );
    expect(progressLine({ count: 1, of: 2 }, job("pip_two_games", "r_p"))).toBe(
      "1 of 2 games for Pip.",
    );
    // A job the board no longer has, when the read hasn't come yet.
    expect(progressLine({ count: 1, of: 3 }, undefined)).toBe("Your job: 1 of 3 done.");
  });

  it("has a word for what every deed job in the table counts", () => {
    const lines = (JOB_EDITIONS[1] ?? []).flatMap((j) => {
      const view = jobView(j, undefined);
      return view.deed ? [[j.id, progressLine({ count: 1, of: 2 }, view)]] : [];
    });
    // "made" and "done" are what a deed with no word of its own would read.
    expect(lines.filter(([, line]) => / (made|done) for /.test(line ?? ""))).toEqual([]);
    expect(Object.fromEntries(lines)).toMatchObject({
      juniper_pumpkins: "1 of 2 harvests of pumpkins for the town.",
      bram_chair: "1 of 2 chairs for the town.",
      marlo_find: "1 of 2 finds for the town.",
      otis_teach: "1 of 2 lessons for the town.",
      otis_host: "1 of 2 events for the town.",
      pip_win: "1 of 2 wins for the town.",
    });
  });
});

describe("a finished job", () => {
  // The event as the socket sends it: the week's count and the count for good ride along.
  const done = { skill: "growing", points: 10, week: 3, total: JOBS.titleAt } as const;

  it("says the points and who it was for, in one sentence short enough to join a deed's toast", () => {
    expect(doneLine(done, job("juniper_herbs", "r_j").from)).toBe(
      "Job done for Juniper: 10 Growing points.",
    );
    expect(doneLine({ ...done, skill: "making" }, job("bram_chair").from)).toBe(
      "Job done for the town: 10 Making points.",
    );
    // Before the board has been read, only what the event itself says.
    expect(doneLine(done, undefined)).toBe("Job done: 10 Growing points.");
  });

  it("says a job lapsed without making it a loss", () => {
    expect(droppedLine(true)).toBe("Your job lapsed. Nothing is lost, and you can take another.");
    expect(droppedLine(false)).toBe("You let the job go.");
  });
});

describe("the skills sheet's jobs row", () => {
  it("counts jobs finished toward the next thing the count brings", () => {
    const { titleAt, wearAt, masterAt } = JOBS;
    expect(jobsRow(0)).toMatchObject({
      name: "Jobs: 0 finished",
      bar: { count: 0, total: titleAt },
      lines: [`${titleAt} jobs finished bring the title Helping hand.`],
      wear: { item: "town_satchel", reached: false },
    });
    expect(jobsRow(titleAt + 2)).toMatchObject({
      name: `Jobs: ${titleAt + 2} finished`,
      bar: {
        count: 2,
        total: wearAt - titleAt,
        label: `2 of ${wearAt - titleAt} jobs to the town satchel`,
      },
      lines: [`${wearAt} jobs finished bring the town satchel.`],
      wear: { reached: false },
    });
    expect(jobsRow(wearAt - 1)).toMatchObject({ wear: { reached: false } });
    expect(jobsRow(wearAt)).toMatchObject({
      bar: { count: 0, total: masterAt - wearAt },
      lines: [`${masterAt} jobs finished bring the title Pillar of the town.`],
      wear: { reached: true },
    });
    expect(jobsRow(masterAt + 5)).toMatchObject({
      name: `Jobs: ${masterAt + 5} finished`,
      bar: { count: 1, total: 1 },
      lines: ["Nothing left to unlock."],
    });
  });
});

describe("what the count unlocked", () => {
  const unlocked: JobStanding["unlocked"] = [
    { jobs: JOBS.titleAt, title: "helping_hand" },
    { jobs: JOBS.wearAt, wear: "town_satchel" },
  ];

  it("gives the title picker its titles and the look editor its garment", () => {
    expect(jobTitles(unlocked)).toEqual(["helping_hand"]);
    expect(jobWear(unlocked)).toEqual(["town_satchel"]);
    expect(jobTitles([])).toEqual([]);
    expect(jobWearAt("town_satchel")).toBe(`${JOBS.wearAt} jobs`);
  });

  it("lists the satchel in the look editor only once jobs are open, locked until it's reached", () => {
    // Jobs not open here (no answer): the satchel isn't listed, unless it's already on.
    expect(earnedState("town_satchel", [], undefined, undefined)).toBe("hidden");
    expect(wearChoices("accessory", [], [])).not.toContain("town_satchel");
    expect(wearChoices("accessory", [], ["town_satchel"])).toContain("town_satchel");
    // Open, and short of the count: listed, with what it comes with instead of a button.
    expect(earnedState("town_satchel", [], undefined, [])).toBe("locked");
    expect(wearChoices("accessory", [], [], new Set(), new Set(), undefined, [])).toContain(
      "town_satchel",
    );
    // Reached: it's a button like any wear.
    expect(earnedState("town_satchel", [], undefined, jobWear(unlocked))).toBe("open");
    // A skill's garment still reads its own list, never the jobs'.
    expect(earnedState("sun_hat", [], [], ["sun_hat"])).toBe("locked");
    expect(earnedState("sun_hat", [], ["sun_hat"], [])).toBe("open");
  });
});
