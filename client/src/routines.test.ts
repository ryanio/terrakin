import type { AwayLine } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import { awayWords } from "./routines-view";

const line = (fields: Partial<AwayLine>): AwayLine => ({
  id: "a_1",
  at: "2026-10-06T18:00:00.000Z",
  result: "done",
  ...fields,
});

describe("the away list", () => {
  it("says what each routine did from its routine and result, and a refusal's fix as the server wrote it", () => {
    const words = (l: Partial<AwayLine>) => {
      const w = awayWords(line(l));
      return [w.name, w.line];
    };
    expect(words({ routine: "walk_home", seq: 4 })).toEqual(["Walked home", null]);
    expect(words({ routine: "stroll", seq: 5 })).toEqual(["Strolled around your plot", null]);
    const ivy = {
      id: "r_ivy",
      name: "Ivy",
      kind: "human" as const,
      color: "sun" as const,
      shape: "round" as const,
      avatar: null,
    };
    expect(words({ routine: "greet", to: ivy })).toEqual(["Waved at Ivy", null]);
    const fix = "Your stroll path is built over. Leave a path on your plot, or change the stroll.";
    expect(words({ routine: "stroll", result: "refused", code: "blocked", reason: fix })).toEqual([
      "Your stroll couldn't run",
      fix,
    ]);
    expect(
      words({ routine: "walk_home", result: "refused", code: "no_hearth", reason: fix, days: 3 }),
    ).toEqual(["Your walk home couldn't run (3 days in a row)", fix]);
    expect(words({ result: "paused", reason: "Paused." })).toEqual([
      "Your routines paused",
      "Paused.",
    ]);
  });
});
