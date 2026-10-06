import { describe, expect, it } from "vitest";
import { bountyStatus, moveButton } from "./bounties-view";
import { lineLabel } from "./purse-view";
import { grantHandle, kindLabel } from "./town-format";

const ada = {
  id: "r_ada",
  name: "Ada",
  kind: "human" as const,
  color: "sun" as const,
  shape: "round" as const,
  avatar: null,
};
const bob = { ...ada, id: "r_bob", name: "Bob" };

describe("the bounties page", () => {
  it("names each move for who's looking", () => {
    const b = { reward: 20, poster: ada, claimant: bob };
    expect(moveButton(b, "claim_bounty", "r_cy")).toMatchObject({
      text: "Take it on",
      primary: true,
    });
    expect(moveButton(b, "complete_bounty", "r_bob").text).toBe("Mark done");
    // Paying is a second tap.
    expect(moveButton(b, "confirm_bounty", "r_ada")).toMatchObject({
      text: "Pay Bob 20 coins",
      again: "Tap again to pay 20 coins",
    });
    expect(moveButton(b, "drop_bounty", "r_bob").text).toBe("Let it go");
    expect(moveButton(b, "drop_bounty", "r_ada").text).toBe("Not done yet");
    expect(moveButton(b, "cancel_bounty", "r_ada").again).toBe("Tap again to take it back");
  });

  it("says where a bounty stands in plain words", () => {
    const s = (o: Partial<Parameters<typeof bountyStatus>[0]>) =>
      bountyStatus({ status: "open", claimant: null, town: false, grant: false, ...o });
    expect(s({})).toBe("Open");
    expect(s({ status: "claimed", claimant: bob })).toBe("Bob is on it");
    expect(s({ status: "done", claimant: bob, town: true })).toBe(
      "Bob says it's done. A maintainer will check.",
    );
    expect(s({ status: "done", claimant: bob, town: true, grant: true })).toBe(
      "Granted to Bob. A maintainer releases it.",
    );
    expect(s({ status: "paid", claimant: bob })).toBe("Paid Bob");
    expect(s({ status: "expired" })).toBe("Ran out of time");
  });

  it("labels bounty and grant lines in the purse", () => {
    expect(lineLabel({ reason: "bounty_held" })).toBe("Held in a bounty you posted");
    expect(lineLabel({ reason: "bounty", with: ada })).toBe("A bounty for Ada");
    expect(lineLabel({ reason: "bounty" })).toBe("A town bounty");
    expect(lineLabel({ reason: "grant" })).toBe("A Town Hall grant");
  });
});

describe("grants and town bounties in the Town Hall", () => {
  it("names every kind of proposal", () => {
    expect(kindLabel("advisory")).toBe("Advisory");
    expect(kindLabel("commons_build")).toBe("Build");
    expect(kindLabel("grant")).toBe("Grant");
    expect(kindLabel("bounty")).toBe("Bounty");
  });

  it("reads a grant's handle with or without its @", () => {
    expect(grantHandle(" @dee_builds ")).toBe("dee_builds");
    expect(grantHandle("dee")).toBe("dee");
    expect(grantHandle("@1abc")).toBeNull();
    expect(grantHandle("")).toBeNull();
  });
});
