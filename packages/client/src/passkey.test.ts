/**
 * The words and the one rule behind signing in with a passkey (RFC 0037). The ceremonies are the
 * server's (`packages/server/src/signin.test.ts` drives a real key through them); what's here is
 * what a person reads and when they're asked.
 */
import { describe, expect, it } from "vitest";
import {
  ASK_AGAIN_MS,
  offerPasskey,
  passkeyAskLine,
  passkeyLines,
  passkeyMoment,
  passkeyNoticeLine,
  signinSummary,
} from "./passkey-words";

const NOW = Date.UTC(2026, 9, 19, 12);
const lines = (claim: { boundAt: string; usedAt?: string; thisSession?: true }) =>
  passkeyLines(claim, NOW, "UTC");

describe("a bound passkey's lines", () => {
  it("says when it was added, that it has never signed in, and what removing it ends", () => {
    expect(lines({ boundAt: "2026-10-19T09:00:00.000Z" })).toEqual([
      "Added Oct 19",
      "Never used to sign in",
      "Removing it ends the sessions it made.",
    ]);
  });

  it("warns on the one signing you in here, since removing it signs you out", () => {
    const here = lines({ boundAt: "2026-10-19T09:00:00.000Z", thisSession: true });
    expect(here[2]).toBe("This is the one signing you in here. Removing it signs you out.");
    // It is the only thing that tells one bound passkey from another: no device is kept.
    expect(lines({ boundAt: "2026-10-19T09:00:00.000Z" })[2]).not.toBe(here[2]);
  });

  it("says today, an earlier day by its date, and another year with the year", () => {
    const boundAt = "2026-10-12T09:00:00.000Z";
    expect(lines({ boundAt, usedAt: "2026-10-19T06:00:00.000Z" })[1]).toBe("Signed in today");
    expect(lines({ boundAt, usedAt: "2026-10-14T06:00:00.000Z" })[1]).toBe("Last signed in Oct 14");
    // A year apart carries the year, so "Oct 19" never stands for last October.
    expect(lines({ boundAt: "2025-10-19T09:00:00.000Z" })[0]).toBe("Added Oct 19, 2025");
    expect(lines({ boundAt, usedAt: "2025-10-19T06:00:00.000Z" })[1]).toBe(
      "Last signed in Oct 19, 2025",
    );
  });
});

describe("what the sheet says above the list", () => {
  it("counts what is bound, and says why several go by their dates", () => {
    expect(signinSummary(3)).toContain("3 passkeys");
    // Nothing about a device is kept, so the sheet says so rather than leaving it a puzzle. With
    // one there is nothing to tell apart, so it doesn't raise the subject.
    expect(signinSummary(3)).toContain("keeps nothing about the device");
    expect(signinSummary(1)).not.toContain("device");
    expect(new Set([signinSummary(0), signinSummary(1), signinSummary(3)]).size).toBe(3);
  });
});

describe("both notices from Terrakin", () => {
  it("say what happened and where to undo it, and name no device", () => {
    const bound = passkeyNoticeLine("passkey_bound");
    expect(bound.line).toBe("A passkey was added to this character.");
    expect(bound.next).toContain("remove it under Signing in");
    const signin = passkeyNoticeLine("passkey_signin");
    expect(signin.line).toBe("Someone signed in as this character with a passkey.");
    // The one call that ends a session this notice is about.
    expect(signin.next).toContain("sign the others out");
    for (const said of [bound, signin]) {
      expect(`${said.line} ${said.next}`.toLowerCase()).not.toContain("device");
    }
  });
});

describe("when a person is offered a passkey", () => {
  const NOW = Date.UTC(2026, 9, 26, 12);
  const person = {
    kind: "human" as const,
    passkeys: 0,
    works: true,
    askedAt: undefined,
    nowMs: NOW,
  };

  it("is a person with no passkey, a browser that can, and no ask within the day", () => {
    // On the way in, before anything is lost (decision 0378).
    expect(offerPasskey(person)).toBe(true);
    // An AI's character already has one, bound by the link that let its person in.
    expect(offerPasskey({ ...person, kind: "agent" })).toBe(false);
    expect(offerPasskey({ ...person, passkeys: 1 })).toBe(false);
    // Offered and refused is worse than not offered, so a browser that can't never sees it.
    expect(offerPasskey({ ...person, works: false })).toBe(false);
  });

  it("comes back a day after this device last asked, and never sooner", () => {
    expect(offerPasskey({ ...person, askedAt: NOW - ASK_AGAIN_MS + 60_000 })).toBe(false);
    expect(offerPasskey({ ...person, askedAt: NOW - ASK_AGAIN_MS })).toBe(true);
    // An answer from when one "Not now" was for good reads as long ago, so it comes back.
    expect(offerPasskey({ ...person, askedAt: 0 })).toBe(true);
  });
});

describe("the moments the world asks again", () => {
  const me = "r_me";
  it("are your plot, your hearth, and your first level, never anyone else's", () => {
    expect(passkeyMoment({ type: "plot_claimed", px: 1, py: 2, ownerId: me }, me)).toBe("plot");
    expect(passkeyMoment({ type: "hearth_set", residentId: me, x: 1, y: 2 }, me)).toBe("hearth");
    expect(passkeyMoment({ type: "level_reached", residentId: me, level: 2 }, me)).toBe("level");
    // A skill's level, a later level, and someone else's moments pass by.
    expect(
      passkeyMoment({ type: "level_reached", residentId: me, skill: "growing", level: 2 }, me),
    ).toBeUndefined();
    expect(passkeyMoment({ type: "level_reached", residentId: me, level: 3 }, me)).toBeUndefined();
    expect(
      passkeyMoment({ type: "plot_claimed", px: 1, py: 2, ownerId: "r_other" }, me),
    ).toBeUndefined();
  });

  it("each say why now", () => {
    const lines = (["joined", "plot", "hearth", "level"] as const).map(passkeyAskLine);
    expect(new Set(lines).size).toBe(4);
    for (const line of lines) expect(line).toContain("Face ID");
  });
});
