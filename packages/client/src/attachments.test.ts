import { MAX_MEDIA_PER_LETTER, MEDIA_TYPES } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import { largestOf, planPick, sizeProblem } from "./attachments";

const words = { things: "pictures", per: "letter" };

describe("attachments", () => {
  it("takes a pick that fits and says nothing", () => {
    expect(planPick(["a", "b"], 1, 4, words)).toEqual({ take: ["a", "b"], note: "" });
  });

  it("keeps the first files that fit a pick over the limit and says how many it added", () => {
    const plan = planPick(["a", "b", "c"], 2, MAX_MEDIA_PER_LETTER, words);
    expect(plan.take).toEqual(["a", "b"]);
    expect(plan.note).toBe(
      `Up to ${MAX_MEDIA_PER_LETTER} pictures per letter. We added the first 2.`,
    );
    expect(planPick(["a"], 4, 4, words).take).toEqual([]);
  });

  it("refuses a file over the largest the accepted types allow, in its own megabytes", () => {
    const pictures = ["image/png", "image/jpeg"];
    const largest = largestOf(pictures);
    expect(largest).toBe(MEDIA_TYPES["image/png"].maxBytes);
    expect(sizeProblem(largest, largest)).toBeUndefined();
    expect(sizeProblem(largest + 1, largest)).toBe(
      `That file is too big. The largest allowed is ${Math.round(largest / 1_000_000)} MB.`,
    );
    expect(sizeProblem(30_000_000, largestOf(Object.keys(MEDIA_TYPES)))).toBe(
      "That file is too big. The largest allowed is 25 MB.",
    );
  });
});
