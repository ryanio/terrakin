import { type HeldJobView, type JobView, jobView } from "@terrakin/protocol";
import { JOB_EDITIONS, JOBS } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import {
  askedLine,
  cantTakeLine,
  chipLabel,
  deedNoun,
  doneLine,
  droppedLine,
  forWhom,
  heldBar,
  heldLine,
  heldMoves,
  type JobStanding,
  jobRowAction,
  jobsRow,
  jobTitles,
  jobWear,
  jobWearAt,
  keptLine,
  progressLine,
  weekLeft,
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
    expect(forWhom(job("bram_chair", "r_bram").from)).toBe("Bram");
    expect(forWhom(job("bram_chair").from)).toBe("the town");
    expect(askedLine(job("juniper_herbs", "r_j").from)).toBe("For Juniper");
    expect(askedLine(job("juniper_herbs").from)).toBe("For the town");
  });
});

describe("the week", () => {
  it("says how many are left of the three that count, and when more do once none are", () => {
    expect(weekLine({ done: 1, max: 3 })).toBe("2 of 3 left this week.");
    expect(weekLine({ done: 0, max: 3 })).toBe("3 of 3 left this week.");
    expect(weekLine({ done: 3, max: 3 })).toBe(
      "0 of 3 left this week. Jobs count again from Monday.",
    );
    // A count past the bound never reads as a negative number.
    expect(weekLeft({ done: 4, max: 3 })).toBe(0);
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

describe("the job you hold", () => {
  it("can be let go, and handed in only when it asks for a made thing", () => {
    expect(heldMoves(held("juniper_herbs", 1))).toEqual(["drop"]);
    expect(heldMoves(held("clem_jam", 0))).toEqual(["hand_in", "drop"]);
  });

  it("shows how far along a deed job is, and that a bring job waits for its hand-in", () => {
    expect(heldBar(held("juniper_herbs", 1))).toEqual({ count: 1, total: 3, label: "1 of 3 done" });
    expect(heldLine(held("juniper_herbs", 1))).toBe("1 of 3 done.");
    expect(chipLabel(held("juniper_herbs", 1))).toBe("Job: 1 of 3");
    expect(heldBar(held("clem_jam", 0))).toEqual({
      count: 0,
      total: 1,
      label: "Not handed in yet",
    });
    expect(heldLine(held("clem_jam", 0))).toBe(
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
    const nouns = (JOB_EDITIONS[1] ?? []).flatMap((j) => {
      const view = jobView(j, undefined);
      return view.deed ? [[j.id, deedNoun(view.deed)]] : [];
    });
    expect(nouns.filter(([, noun]) => !noun || noun === "made")).toEqual([]);
    expect(Object.fromEntries(nouns)).toMatchObject({
      juniper_pumpkins: "harvests of pumpkins",
      bram_chair: "chairs",
      marlo_find: "finds",
      otis_teach: "lessons",
      otis_host: "events",
      pip_win: "wins",
    });
  });
});

describe("a finished job", () => {
  const done = { skill: "growing", points: 10, week: 1, total: 4 } as const;

  it("says the points, who it was for, and how many are left this week", () => {
    expect(doneLine(done, job("juniper_herbs", "r_j").from, 3)).toBe(
      "Job done for Juniper: 10 Growing points. 2 left this week.",
    );
    expect(doneLine({ ...done, skill: "making" }, job("bram_chair").from, 3)).toBe(
      "Job done for the town: 10 Making points. 2 left this week.",
    );
    expect(doneLine({ ...done, week: 3 }, job("juniper_herbs", "r_j").from, 3)).toBe(
      "Job done for Juniper: 10 Growing points. That's every job that counts this week.",
    );
    // Before the board has been read, only what the event itself says.
    expect(doneLine(done, undefined, undefined)).toBe("Job done: 10 Growing points.");
  });

  it("adds what the count unlocked, at the count and never one short", () => {
    const at = (total: number) => doneLine({ ...done, total }, undefined, undefined);
    expect(at(JOBS.titleAt - 1)).toBe("Job done: 10 Growing points.");
    expect(at(JOBS.titleAt)).toBe(
      "Job done: 10 Growing points. You can show the title Helping hand now.",
    );
    expect(at(JOBS.wearAt)).toBe("Job done: 10 Growing points. You can wear the town satchel now.");
  });

  it("says a job lapsed without making it a loss", () => {
    expect(droppedLine(true)).toBe("Your job lapsed. Nothing is lost, and you can take another.");
    expect(droppedLine(false)).toBe("You let the job go.");
  });
});

describe("the skills sheet's jobs row", () => {
  it("counts jobs finished toward the next thing the count brings", () => {
    expect(jobsRow(0)).toMatchObject({
      name: "Jobs: 0 finished",
      bar: { count: 0, total: 10 },
      lines: ["10 jobs finished bring the title Helping hand."],
      wear: { item: "town_satchel", reached: false },
    });
    expect(jobsRow(12)).toMatchObject({
      name: "Jobs: 12 finished",
      bar: { count: 2, total: 15, label: "2 of 15 jobs to the town satchel" },
      lines: ["25 jobs finished bring the town satchel."],
      wear: { reached: false },
    });
    expect(jobsRow(25)).toMatchObject({
      bar: { count: 0, total: 50 },
      lines: ["75 jobs finished bring the title Pillar of the town."],
      wear: { reached: true },
    });
    expect(jobsRow(80)).toMatchObject({
      name: "Jobs: 80 finished",
      bar: { count: 1, total: 1 },
      lines: ["Nothing left to unlock."],
    });
  });
});

describe("what the count unlocked", () => {
  const unlocked: JobStanding["unlocked"] = [
    { jobs: 10, title: "helping_hand" },
    { jobs: 25, wear: "town_satchel" },
  ];

  it("gives the title picker its titles and the look editor its garment", () => {
    expect(jobTitles(unlocked)).toEqual(["helping_hand"]);
    expect(jobWear(unlocked)).toEqual(["town_satchel"]);
    expect(jobTitles([])).toEqual([]);
    expect(jobWearAt("town_satchel")).toBe("25 jobs");
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
