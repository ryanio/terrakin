import { FIRST_VISIT_STEPS, type FirstVisitResponse } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import {
  CHIP_MAX,
  doneLine,
  nextStep,
  STEP_WORDS,
  stepHref,
  stepRows,
  VERB_MAX,
} from "./first-steps";

const steps = (done: string[] = []): FirstVisitResponse["steps"] =>
  FIRST_VISIT_STEPS.map((id) => ({ id, done: done.includes(id) }));

describe("first steps in plain words", () => {
  it("has words for every first-visit step the server knows", () => {
    for (const id of FIRST_VISIT_STEPS) expect(STEP_WORDS[id], id).toBeDefined();
  });

  it("keeps each verb short enough that the card's links line up, and each chip for the world's chip", () => {
    for (const [id, words] of Object.entries(STEP_WORDS)) {
      expect(words.verb.length, id).toBeLessThanOrEqual(VERB_MAX);
      expect(words.chip.length, id).toBeLessThanOrEqual(CHIP_MAX);
    }
  });

  it("lists the server's steps and the first-session suggestions it has words for, in one order", () => {
    const rows = stepRows({
      steps: steps(["plot"]),
      tries: [
        { id: "gather", done: true },
        { id: "market", done: false },
        { id: "pet", done: false },
      ],
      tryToday: null,
    });
    expect(rows.map((r) => r.id)).toEqual([
      "plot",
      "plot_name",
      "home",
      "handle",
      "bio",
      "look",
      "pet",
      "garden",
      "gather",
      "post",
      "follow",
    ]);
    expect(rows.filter((r) => r.done).map((r) => r.id)).toEqual(["plot", "gather"]);
    expect(doneLine(rows)).toBe("2 of 11 done");
    expect(nextStep(rows)?.name).toBe("Name your plot");
  });

  it("has no next step once everything is done, and nothing for townsfolk", () => {
    const all = stepRows({
      steps: steps([...FIRST_VISIT_STEPS]),
      tries: [{ id: "visit", done: true }],
      tryToday: "games",
    });
    expect(nextStep(all)).toBeUndefined();
    expect(stepRows({ steps: [], tries: [], tryToday: null })).toEqual([]);
  });

  it("links each place to where it's done", () => {
    expect(stepHref("profile", "r_ab12")).toBe("/r/r_ab12");
    expect(stepHref("world", "r_ab12")).toBe("/world");
    expect(stepHref("visit", "r_ab12")).toBe("/visit");
    expect(stepHref("wall", "r_ab12")).toBe("/");
  });
});
