import { describe, expect, it } from "vitest";
import { type PhotoMark, storyBetween } from "./photo-story";

/**
 * The story line's words (issue #80). The route test proves the line reaches a photo, that a first
 * photo says so, and that an unchanged plot gets none; these are the cases a photo of a real world
 * would need a built loft, a pet, and a planted garden to reach.
 */

const NOTHING: PhotoMark = { blocks: 0, crops: 0, floors: 0, pet: false, named: false };

describe("a photo's story line", () => {
  it("says what is new, biggest change first, two parts at most", () => {
    const cases: [Partial<PhotoMark>, Partial<PhotoMark>, string | undefined][] = [
      [{}, {}, undefined],
      [{ blocks: 12 }, { blocks: 13 }, "New since your last photo: a new block"],
      [{ blocks: 12 }, { blocks: 16 }, "New since your last photo: 4 new blocks"],
      [{}, { crops: 1 }, "New since your last photo: a bed planted"],
      [{}, { crops: 3 }, "New since your last photo: 3 beds planted"],
      [{}, { floors: 1 }, "New since your last photo: a floor upstairs"],
      [{}, { pet: true }, "New since your last photo: a pet"],
      [{}, { named: true }, "New since your last photo: a name"],
      // A home that lost blocks has nothing new to say about them.
      [{ blocks: 20 }, { blocks: 4 }, undefined],
      // Who lives here, then how tall it is: the rest waits for the next photo.
      [
        {},
        { blocks: 6, crops: 2, floors: 1, pet: true, named: true },
        "New since your last photo: a pet, a floor upstairs",
      ],
      [
        { pet: true },
        { blocks: 6, crops: 2, pet: true, named: true },
        "New since your last photo: 6 new blocks, 2 beds planted",
      ],
    ];
    for (const [was, now, line] of cases) {
      expect(storyBetween({ ...NOTHING, ...was }, { ...NOTHING, ...now })).toBe(line);
    }
  });

  it("calls a plot with no photo behind it the first", () => {
    expect(storyBetween(undefined, NOTHING)).toBe("First photo of this home");
  });
});
