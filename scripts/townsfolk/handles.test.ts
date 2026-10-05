import { describe, expect, it } from "vitest";
import { HANDLE_PATTERN, isReservedHandle } from "../../protocol/src/index";
import { describeStep, planHandle } from "./handle-plan.ts";
import { checkPersonas, PERSONAS } from "./personas.ts";

const ME = "r_00000000000000aa";
const SOMEONE = "r_00000000000000bb";

describe("townsfolk handles", () => {
  it("are valid, free of reserved words, and one each", () => {
    for (const p of PERSONAS) {
      expect(HANDLE_PATTERN.test(p.handle), p.name).toBe(true);
      expect(isReservedHandle(p.handle), p.name).toBe(false);
    }
    expect(new Set(PERSONAS.map((p) => p.handle)).size).toBe(PERSONAS.length);
    expect(PERSONAS.find((p) => p.key === "juniper")?.handle).toBe("juniper");
    expect(PERSONAS.find((p) => p.key === "bram")?.handle).toBe("bram");
  });

  it("catch a bad or shared handle in the cast", () => {
    const [first, second] = PERSONAS;
    if (!first || !second) throw new Error("no personas");
    expect(checkPersonas([{ ...first, handle: "Juniper!" }]).join("\n")).toMatch(/valid handle/);
    expect(checkPersonas([first, { ...second, handle: first.handle }]).join("\n")).toMatch(
      /share a handle/,
    );
  });
});

describe("planHandle", () => {
  it("does nothing when they already have it", () => {
    expect(planHandle(ME, "juniper", "juniper", ME)).toEqual({ kind: "done", handle: "juniper" });
  });

  it("claims a free handle", () => {
    expect(planHandle(ME, "juniper", undefined, null)).toEqual({
      kind: "claim",
      handle: "juniper",
    });
  });

  it("names the handle they give up when they have another", () => {
    expect(planHandle(ME, "juniper", "june", null)).toEqual({
      kind: "claim",
      handle: "juniper",
      from: "june",
    });
  });

  it("claims back their own old handle, which still resolves to them", () => {
    expect(planHandle(ME, "juniper", "june", ME)).toEqual({
      kind: "claim",
      handle: "juniper",
      from: "june",
    });
  });

  it("leaves a handle someone else holds", () => {
    expect(planHandle(ME, "juniper", undefined, SOMEONE)).toEqual({
      kind: "taken",
      handle: "juniper",
      by: SOMEONE,
    });
  });

  it("says what it would do on a dry run and what it does with --send", () => {
    const step = planHandle(ME, "bram", undefined, null);
    expect(describeStep(step, false)).toBe("would claim @bram");
    expect(describeStep(step, true)).toBe("claiming @bram");
    expect(describeStep(planHandle(ME, "bram", "bram", ME), false)).toBe("has @bram");
  });
});
