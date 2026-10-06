import { describe, expect, it } from "vitest";
import {
  GAME_ABOUT,
  pickWords,
  ratingWords,
  roundWords,
  timeLeftWords,
  winnerWords,
} from "./game-format";

const round = {
  round: 2,
  moves: { ada: 3, bob: 2, cy: 2, dee: null },
  gained: { ada: 3, bob: 0, cy: 0, dee: 0 },
};

const seat = (name: string, place: number | null) => ({
  resident: {
    id: name,
    name,
    kind: "human" as const,
    color: "sun" as const,
    shape: "round" as const,
    avatar: null,
  },
  kind: "human" as const,
  rated: true,
  tally: false,
  away: false,
  decided: false,
  score: 0,
  place,
  rating: null,
});

describe("game words", () => {
  it("say what each seat picked and what it gave them, from the server's own gains", () => {
    expect(pickWords("hearth_race", round, "ada")).toBe("picked 3, moved 3");
    expect(pickWords("hearth_race", round, "bob")).toBe("picked 2, stayed put");
    expect(pickWords("hearth_race", round, "dee")).toBe("didn't choose");
    const lantern = { round: 1, moves: { ada: 1, bob: 4 }, gained: { ada: 0, bob: 1 } };
    expect(pickWords("lowest_lantern", lantern, "bob")).toBe("picked 4, scored a point");
    expect(pickWords("lowest_lantern", lantern, "ada")).toBe("picked 1");
  });

  it("count down in seconds, then minutes, then hours, and never show nothing left", () => {
    expect(timeLeftWords(44_200)).toBe("45 seconds left");
    expect(timeLeftWords(1_500)).toBe("2 seconds left");
    expect(timeLeftWords(400)).toBe("closing now");
    expect(timeLeftWords(-3_000)).toBe("closing now");
    expect(timeLeftWords(10 * 60_000)).toBe("10 minutes left");
    expect(timeLeftWords(4 * 3_600_000)).toBe("about 4 hours left");
  });

  it("number a lantern's rounds out of five, and a race's without an end", () => {
    expect(roundWords({ game: "lowest_lantern", round: 3, roundsMax: 5 })).toBe("Round 3 of 5");
    expect(roundWords({ game: "hearth_race", round: 3, roundsMax: 30 })).toBe("Round 3");
  });

  it("name the winner, or everyone who shares first place", () => {
    expect(winnerWords({ status: "over", seats: [seat("Ada", 1), seat("Bob", 2)] })).toBe(
      "Ada won.",
    );
    expect(
      winnerWords({ status: "over", seats: [seat("Ada", 1), seat("Bob", 1), seat("Cy", 1)] }),
    ).toBe("Ada, Bob and Cy share first place.");
    expect(winnerWords({ status: "playing", seats: [seat("Ada", null)] })).toBe("");
  });

  it("tell how each game goes, from its rules", () => {
    expect(GAME_ABOUT.hearth_race).toContain("picks 1, 2, or 3 steps along a track of 12.");
    expect(GAME_ABOUT.lowest_lantern).toContain("a number from 1 to 10.");
    expect(GAME_ABOUT.lowest_lantern).toContain("5 rounds; most points wins.");
  });

  it("put a ladder on a profile as its pace, rating, and rank", () => {
    expect(ratingWords({ ladder: "agents:slow", rating: 1016, rank: 2 })).toBe(
      "Slow games: 1,016, 2nd",
    );
  });
});
