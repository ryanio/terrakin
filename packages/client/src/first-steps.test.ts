import { FIRST_VISIT_STEPS, type FirstVisitResponse } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import {
  CHIP_MAX,
  nextStep,
  ROUND,
  STEP_WORDS,
  stepHref,
  stepRound,
  stepRows,
  VERB_MAX,
} from "./first-steps";

/** The server's steps: `make` is one only in a world where levels are open (RFC 0029). */
const steps = (done: string[] = [], levels = false): FirstVisitResponse["steps"] =>
  FIRST_VISIT_STEPS.filter((id) => levels || id !== "make").map((id) => ({
    id,
    done: done.includes(id),
  }));

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
    expect(stepRound(rows).line).toBe("2 of 3 done");
    expect(nextStep(rows)?.name).toBe("Name your plot");
    // Where levels are open, making a first thing comes after gathering what it takes.
    const withLevels = stepRows({
      steps: steps([], true),
      tries: [{ id: "gather", done: false }],
      tryToday: null,
    });
    expect(withLevels.map((r) => r.id).slice(-4)).toEqual(["gather", "make", "post", "follow"]);
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

  it("shows the first steps left, three at most, in rounds of three, for every mix of done steps", () => {
    const ids = stepRows({
      steps: steps(),
      tries: [{ id: "pet", done: false }],
      tryToday: null,
    }).map((r) => r.id);
    for (let mask = 0; mask < 1 << ids.length; mask++) {
      const doneIds = ids.filter((_, i) => mask & (1 << i));
      const rows = stepRows({
        steps: steps(doneIds),
        tries: [{ id: "pet", done: doneIds.includes("pet") }],
        tryToday: null,
      });
      const left = rows.filter((r) => !r.done);
      const round = stepRound(rows);
      const shown = round.left.map((r) => r.id);
      expect(shown.length, doneIds.join()).toBeLessThanOrEqual(ROUND);
      // The ones shown are the first ones left, in order: none skipped.
      expect(shown, doneIds.join()).toEqual(left.slice(0, shown.length).map((r) => r.id));
      expect(shown.length > 0, doneIds.join()).toBe(left.length > 0);
      // The bar and the rows agree: what's done this round and what's left in it fill the round.
      expect(round.done + shown.length, doneIds.join()).toBe(round.size);
    }
  });

  it("brings the next three in once a round is done", () => {
    const at = (done: string[]) =>
      stepRound(stepRows({ steps: steps(done), tries: [], tryToday: null }));
    expect(at([]).line).toBe("0 of 3 done");
    expect(at(["handle"]).left.map((r) => r.id)).toEqual(["plot", "plot_name"]);
    const next = at(["plot", "plot_name", "home"]);
    expect(next.line).toBe("Nice, three more. 0 of 3 done");
    expect(next.left.map((r) => r.id)).toEqual(["handle", "bio", "look"]);
    const last = at(["plot", "plot_name", "home", "handle", "bio", "look"]);
    expect(last.left.map((r) => r.id)).toEqual(["garden", "post", "follow"]);
    expect(at(["plot", "plot_name", "home", "handle", "bio", "look", "garden"]).line).toBe(
      "1 of 3 done",
    );
  });

  it("links each place to where it's done", () => {
    expect(stepHref("profile", "r_ab12")).toBe("/r/r_ab12");
    expect(stepHref("world", "r_ab12")).toBe("/world");
    expect(stepHref("visit", "r_ab12")).toBe("/visit");
    expect(stepHref("wall", "r_ab12")).toBe("/");
  });
});
