import { describe, expect, it } from "vitest";
import { canonicalJson, fnv1a } from "./hash";

describe("canonicalJson", () => {
  it("ignores key order and undefined fields", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: undefined } })).toBe(
      canonicalJson({ a: { d: [1, 2] }, b: 1 }),
    );
  });
});

describe("fnv1a", () => {
  it("matches the reference vectors", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("foobar")).toBe("bf9cf968");
  });
});
