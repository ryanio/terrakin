import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ACTION_TYPES, Action, CreateSessionRequest } from "./schemas";
import { editDistance, nearestName, suggestFor } from "./suggest";

describe("editDistance", () => {
  it("counts inserts, deletes, changes, and a swap of neighbors as one edit each", () => {
    expect(editDistance("move", "move")).toBe(0);
    expect(editDistance("mvoe", "move")).toBe(1);
    expect(editDistance("mov", "move")).toBe(1);
    expect(editDistance("moove", "move")).toBe(1);
    expect(editDistance("mave", "move")).toBe(1);
    expect(editDistance("", "home")).toBe(4);
    expect(editDistance("claim", "place")).toBe(3);
  });
});

describe("nearestName", () => {
  it("suggests a name a typo away", () => {
    expect(nearestName("mvoe", ACTION_TYPES)).toBe("move");
    expect(nearestName("set-hearth", ACTION_TYPES)).toBe("set_hearth");
    expect(nearestName("sethearth", ACTION_TYPES)).toBe("set_hearth");
    expect(nearestName("Settle", ACTION_TYPES)).toBe("settle");
    expect(nearestName("build_starter_hom", ACTION_TYPES)).toBe("build_starter_home");
  });

  it("stays quiet when nothing is close, the name is right, or the input isn't a short name", () => {
    expect(nearestName("fly", ACTION_TYPES)).toBeUndefined();
    expect(nearestName("teleport", ACTION_TYPES)).toBeUndefined();
    expect(nearestName("move", ACTION_TYPES)).toBeUndefined();
    expect(nearestName("mo ve", ACTION_TYPES)).toBeUndefined();
    expect(nearestName(`move${"e".repeat(40)}`, ACTION_TYPES)).toBeUndefined();
    expect(nearestName("<b>move", ACTION_TYPES)).toBeUndefined();
  });

  it("allows one edit for short names and at most two for long ones", () => {
    expect(nearestName("mv", ["move"])).toBeUndefined();
    expect(nearestName("hme", ["home"])).toBe("home");
    expect(nearestName("buld_strter_home", ["build_starter_home"])).toBe("build_starter_home");
    expect(nearestName("bld_strtr_home", ["build_starter_home"])).toBeUndefined();
  });

  it("breaks ties by the order of the names", () => {
    expect(nearestName("cat", ["bat", "hat"])).toBe("bat");
    expect(nearestName("cat", ["hat", "bat"])).toBe("hat");
  });
});

describe("suggestFor", () => {
  it("names the action type that was meant", () => {
    expect(suggestFor(Action, { type: "mvoe", dir: "n" })).toEqual({
      message: "Unknown action 'mvoe'. Did you mean 'move'?",
      didYouMean: "move",
    });
    expect(suggestFor(Action, { type: "jump" })).toBeUndefined();
    expect(suggestFor(Action, { type: 7 })).toBeUndefined();
  });

  it("names the field that was meant, only when the real one is missing", () => {
    expect(suggestFor(Action, { type: "place", x: 1, y: 2, blok: "wood" })).toEqual({
      message: "Unknown field 'blok' for place. Did you mean 'block'?",
      didYouMean: "block",
    });
    expect(suggestFor(Action, { type: "chat", text: "hi", chanel: "world" })?.didYouMean).toBe(
      "channel",
    );
    expect(suggestFor(Action, { type: "move", dir: "n", dyr: true })?.didYouMean).toBe("dry");
    // The spellings agents guess for `dry` are too far for the typo match, and still caught.
    for (const key of ["dry_run", "dryRun", "dryrun", "dry-run", "DRY_RUN"]) {
      expect(suggestFor(Action, { type: "move", dir: "n", [key]: true })).toEqual({
        message: `Unknown field '${key}' for move. Did you mean 'dry'?`,
        didYouMean: "dry",
      });
    }
    expect(
      suggestFor(Action, { type: "move", dir: "n", dry: true, dry_run: true }),
    ).toBeUndefined();
    expect(
      suggestFor(CreateSessionRequest, { name: "Wren", kind: "agent", dryRun: 1 }),
    ).toBeUndefined();
    // `dir` is already there, so `dirr` is junk, not a typo for it.
    expect(suggestFor(Action, { type: "move", dir: "n", dirr: "s" })).toBeUndefined();
    expect(suggestFor(Action, { type: "move", dir: "n", requestId: "a1" })).toBeUndefined();
  });

  it("works on plain object bodies, and ignores anything that isn't an object", () => {
    expect(suggestFor(CreateSessionRequest, { nmae: "Wren", kind: "agent" })).toEqual({
      message: "Unknown field 'nmae'. Did you mean 'name'?",
      didYouMean: "name",
    });
    expect(suggestFor(Action, null)).toBeUndefined();
    expect(suggestFor(Action, ["move"])).toBeUndefined();
    expect(suggestFor(z.string(), { a: 1 })).toBeUndefined();
  });
});
