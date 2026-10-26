import { describe, expect, it } from "vitest";
import { sectionAt } from "./docs-sections";

describe("sectionAt, the docs section a reader is in", () => {
  // Card tops on screen, and the line a third of the way down (300).
  it("is none while the page's title is still above the first section", () => {
    expect(sectionAt([420, 900, 1600], 300)).toBe(-1);
  });

  it("is the last section whose top has passed the line", () => {
    expect(sectionAt([-800, 120, 900], 300)).toBe(1);
    expect(sectionAt([-1600, -700, 300], 300)).toBe(2);
  });
});
