import { describe, expect, it } from "vitest";
import { canSuggestInto, NAME_IDEAS, nameIdeas } from "./names";

// The founding townsfolk always hold their names (scripts/townsfolk/personas.ts).
const TOWNSFOLK = ["Juniper", "Bram", "Clem", "Pip", "Otis", "Marlo", "Sable", "Ansel"];

describe("name ideas", () => {
  it("is a wide pool of plain names, none of them a townsfolk's", () => {
    expect(NAME_IDEAS.length).toBeGreaterThanOrEqual(200);
    const keys = NAME_IDEAS.map((n) => n.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    for (const name of NAME_IDEAS) expect(name).toMatch(/^[A-Z][a-z]{1,23}$/);
    for (const name of TOWNSFOLK) expect(keys).not.toContain(name.toLowerCase());
    // Short and long, and starting on many sounds.
    expect(NAME_IDEAS.filter((n) => n.length <= 3).length).toBeGreaterThanOrEqual(15);
    expect(NAME_IDEAS.filter((n) => n.length >= 8).length).toBeGreaterThanOrEqual(15);
    expect(new Set(NAME_IDEAS.map((n) => n[0])).size).toBeGreaterThanOrEqual(20);
  });

  it("walks the same ideas for the same seed and shows none twice until all were shown", () => {
    const walk = (seed: number) => {
      const ideas = nameIdeas(seed);
      return Array.from({ length: NAME_IDEAS.length }, () => ideas.next());
    };
    const first = walk(7);
    expect(walk(7)).toEqual(first);
    expect(walk(8)).not.toEqual(first);
    expect(new Set(first).size).toBe(NAME_IDEAS.length);
  });

  it("never offers a name the server said is taken, and runs out instead of looping", () => {
    const pool = ["Ayo", "Mei", "Nils"];
    const ideas = nameIdeas(3, pool);
    ideas.taken("mei");
    const seen = Array.from({ length: 12 }, () => ideas.next());
    expect(seen).not.toContain("Mei");
    // Starting over once every name was shown never repeats the last one straight away.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    ideas.taken("Ayo");
    ideas.taken("Nils");
    expect(ideas.next()).toBeUndefined();
  });

  it("fills only an empty field or one still holding its own idea, never a typed name", () => {
    expect(canSuggestInto("", undefined)).toBe(true);
    expect(canSuggestInto("   ", "Ayo")).toBe(true);
    expect(canSuggestInto("Ayo", "Ayo")).toBe(true);
    expect(canSuggestInto("Heyday", undefined)).toBe(false);
    expect(canSuggestInto("Ayo2", "Ayo")).toBe(false);
  });
});
