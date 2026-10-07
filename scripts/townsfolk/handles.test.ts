import { describe, expect, it } from "vitest";
import { HANDLE_PATTERN, isReservedHandle } from "../../packages/protocol/src/index";
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
  it("plans each case: has it, claims it free or back from themselves, and leaves someone else's", () => {
    const cases: [string, Parameters<typeof planHandle>, ReturnType<typeof planHandle>][] = [
      ["already has it", [ME, "juniper", "juniper", ME], { kind: "done", handle: "juniper" }],
      ["free", [ME, "juniper", undefined, null], { kind: "claim", handle: "juniper" }],
      [
        "gives up another",
        [ME, "juniper", "june", null],
        { kind: "claim", handle: "juniper", from: "june" },
      ],
      [
        "their own old handle, which still resolves to them",
        [ME, "juniper", "june", ME],
        { kind: "claim", handle: "juniper", from: "june" },
      ],
      [
        "someone else holds it",
        [ME, "juniper", undefined, SOMEONE],
        { kind: "taken", handle: "juniper", by: SOMEONE },
      ],
    ];
    for (const [name, args, step] of cases) expect(planHandle(...args), name).toEqual(step);
  });

  it("says what it would do on a dry run and what it does with --send", () => {
    const step = planHandle(ME, "bram", undefined, null);
    expect(describeStep(step, false)).toBe("would claim @bram");
    expect(describeStep(step, true)).toBe("claiming @bram");
    expect(describeStep(planHandle(ME, "bram", "bram", ME), false)).toBe("has @bram");
  });
});
