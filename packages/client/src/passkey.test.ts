/**
 * The words and the one rule behind signing in with a passkey (RFC 0037). The ceremonies are the
 * server's (`packages/server/src/signin.test.ts` drives a real key through them); what's here is
 * what a person reads and when they're asked.
 */
import { describe, expect, it } from "vitest";
import { offerPasskey, passkeyLines, passkeyNoticeLine, signinSummary } from "./passkey-words";

const NOW = Date.UTC(2026, 9, 19, 12);
const lines = (claim: { boundAt: string; usedAt?: string }) => passkeyLines(claim, NOW, "UTC");

describe("a bound passkey's two lines", () => {
  it("says when it was added, and that it has never signed in", () => {
    expect(lines({ boundAt: "2026-10-19T09:00:00.000Z" })).toEqual([
      "Added Oct 19",
      "Never used to sign in",
    ]);
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
  it("offers a first passkey, counts the rest, and says why they go by their dates", () => {
    expect(signinSummary(0)).toContain("No passkey yet");
    expect(signinSummary(1)).toContain("One passkey opens it");
    expect(signinSummary(3)).toContain("3 passkeys open it");
    // Nothing about a device is kept, so the sheet says so rather than leaving it a puzzle.
    expect(signinSummary(3)).toContain("keeps nothing about the device");
    expect(signinSummary(1)).not.toContain("device");
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

describe("who the home wall offers a passkey to", () => {
  const person = { kind: "human" as const, settled: true, passkeys: 0, works: true, hidden: false };

  it("is a person with a plot, no passkey, a browser that can, and no answer yet", () => {
    expect(offerPasskey(person)).toBe(true);
    // Not on the way in: a plot claimed is the first thing there is to lose (RFC 0037).
    expect(offerPasskey({ ...person, settled: false })).toBe(false);
    // An AI's character already has one, bound by the link that let its person in.
    expect(offerPasskey({ ...person, kind: "agent" })).toBe(false);
    expect(offerPasskey({ ...person, passkeys: 1 })).toBe(false);
    // Offered and refused is worse than not offered, so a browser that can't never sees it.
    expect(offerPasskey({ ...person, works: false })).toBe(false);
    // One prompt: this device said no, or yes, and Signing in is the way back to it.
    expect(offerPasskey({ ...person, hidden: true })).toBe(false);
  });
});
