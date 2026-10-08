import type { AuthorView, GestureKind, LetterView } from "@terrakin/protocol";
import { badgeText } from "@terrakin/ui/format";
import { describe, expect, it } from "vitest";
import { isLetterMediaUrl } from "./letter-media";
import { PROMPT_INTERESTS, PROMPT_NAMES, PROMPT_PATTERN, promptAt, promptLine } from "./prompts";
import { matchRoute, routeTemplate } from "./router";
import { templateIds } from "./telemetry";
import {
  arrivalLine,
  conversations,
  foldWaves,
  gestureChoices,
  gestureLine,
  reusableInvite,
  sentLine,
  streakLine,
  WAVE_FOLD_MS,
  wavesLine,
} from "./together";

const person = (id: string, name: string): AuthorView => ({
  id,
  name,
  kind: "human",
  color: "sun",
  shape: "round",
  avatar: null,
});
const ME = person("r_me", "Me");
const ADA = person("r_ada", "Ada");
const BO = person("r_bo", "Bo");

let n = 0;
const letter = (from: AuthorView, to: AuthorView, at: string, read = true): LetterView => ({
  id: `l_${String(n++).padStart(16, "0")}`,
  trust: "untrusted",
  from,
  to,
  text: `${from.name} to ${to.name}`,
  media: [],
  createdAt: at,
  readAt: read ? at : null,
});

describe("letters", () => {
  it("accepts only letter image URLs exactly as the server makes them", () => {
    expect(isLetterMediaUrl("/v1/letters/l_0123456789abcdef/media/m_0123456789abcdef")).toBe(true);
    for (const bad of [
      "/media/m_0123456789abcdef",
      "https://evil.example/v1/letters/l_0123456789abcdef/media/m_0123456789abcdef",
      "/v1/letters/l_0123456789abcdef/media/m_0123456789abcdef?x=1",
      "/v1/letters/../media/m_0123456789abcdef",
      "/v1/letters/l_0123456789ABCDEF/media/m_0123456789abcdef",
      42,
      null,
    ]) {
      expect(isLetterMediaUrl(bad)).toBe(false);
    }
  });

  it("groups letters by the other person, newest conversation first, counting unread", () => {
    const letters = [
      letter(ADA, ME, "2026-10-04T12:00:00Z", false),
      letter(ME, BO, "2026-10-04T11:00:00Z"),
      letter(ADA, ME, "2026-10-04T10:00:00Z", false),
      letter(ME, ADA, "2026-10-04T09:00:00Z"),
      letter(BO, ME, "2026-10-04T08:00:00Z", false),
    ];
    const list = conversations(letters, ME.id);
    expect(list.map((c) => [c.with.id, c.unread])).toEqual([
      [ADA.id, 2],
      [BO.id, 1],
    ]);
    expect(list[1]?.last.from.id).toBe(ME.id);
    // A letter you sent never counts as unread, even before they open it.
    expect(conversations([letter(ME, ADA, "2026-10-04T12:00:00Z", false)], ME.id)[0]?.unread).toBe(
      0,
    );
  });

  it("caps a badge count at 99+", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(3)).toBe("3");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(120)).toBe("99+");
  });
});

describe("gestures and streaks", () => {
  it("says who sent what, with a gift's note", () => {
    expect(gestureLine("hug", "Ada", "")).toBe("Ada sent you a hug");
    expect(gestureLine("high_five", "Bo", "")).toBe("Bo sent you a high five");
    expect(gestureLine("wave", "Wren", "", true)).toBe("Wren waved as they puttered past");
    // Routine waves from neighbors at home fold into one line while they come close together.
    const one = foldWaves(undefined, "Bram", 0);
    expect(wavesLine(one)).toBe("Bram waved from home");
    const three = foldWaves(foldWaves(one, "Ivy", WAVE_FOLD_MS - 1), "Dee", WAVE_FOLD_MS);
    expect(wavesLine(three)).toBe("3 neighbors waved from home");
    expect(wavesLine(foldWaves(three, "Cy", 3 * WAVE_FOLD_MS))).toBe("Cy waved from home");
    expect(gestureLine("gift", "Ada", "a jar of honey")).toBe(
      "Ada sent you a gift: a jar of honey",
    );
    const lemons = { kind: "lemon" as const, count: 3 };
    expect(gestureLine("gift", "Ada", "", false, lemons)).toBe("Ada sent you a gift: 3 lemons");
    expect(gestureLine("gift", "Ada", "Picked today", false, lemons)).toBe(
      "Ada sent you a gift: 3 lemons. “Picked today”",
    );
  });

  it("offers a kiss only to people you are close to, and comfort to everyone", () => {
    const from = (kind: GestureKind, id: string) => ({ kind, from: { id } });
    const kinds = (
      between: { kind: GestureKind; from: { id: string } }[],
      streak: number,
      sharesPlot = false,
    ) => gestureChoices(between, streak, "me", sharesPlot).map((g) => g.kind);
    expect(kinds([], 0)).toEqual(["hug", "wave", "high_five", "comfort", "gift"]);
    expect(kinds([from("hug", "me")], 6)).not.toContain("kiss");
    expect(kinds([], 7)).toEqual(["hug", "kiss", "wave", "high_five", "comfort", "gift"]);
    expect(kinds([], 0, true)).toContain("kiss");
    expect(kinds([from("wave", "them"), from("kiss", "me")], 0)).toContain("kiss");
    expect(gestureLine("comfort", "Ada", "")).toBe("Ada sent you some comfort");
  });

  it("says a kiss stays secret until it's answered, and when it was", () => {
    expect(sentLine("hug", "Bo", {})).toBe("You sent a hug to Bo");
    expect(sentLine("kiss", "Bo", { secret: true })).toBe(
      "You sent Bo a kiss. They'll only know if they send you one too.",
    );
    expect(sentLine("kiss", "Bo", { answered: true })).toBe("Bo sent you a kiss too");
  });

  it("words the streak plainly", () => {
    expect(streakLine(0)).toMatch(/^No streak yet/);
    expect(streakLine(1)).toMatch(/^1 day in a row/);
    expect(streakLine(4)).toBe("4 days in a row");
  });
});

describe("invites", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const saved = {
    code: "abcdefghjkmn",
    path: "/i/abcdefghjkmn",
    share: false,
    createdAt: "2026-10-01T12:00:00Z",
    expiresAt: "2026-10-08T12:00:00Z",
  };

  it("reuses a saved invite of the same kind that has time left", () => {
    expect(reusableInvite(saved, false, now)).toBe(true);
    expect(reusableInvite(saved, true, now)).toBe(false);
    expect(reusableInvite(undefined, false, now)).toBe(false);
    expect(reusableInvite(saved, false, Date.parse("2026-10-08T11:30:00Z"))).toBe(false);
  });

  it("welcomes you with what accepting did, and never claims a plot you didn't get", () => {
    const plot = { id: "p_1" };
    expect(arrivalLine("Ada", { shared: true, plot })).toBe(
      "Welcome home. You share Ada's plot now.",
    );
    expect(arrivalLine("Ada", { shared: false, plot })).toBe("Welcome! You live next to Ada now.");
    expect(arrivalLine("Ada", { shared: false, plot: null })).not.toContain("live next to");
  });

  it("never reuses a link that was already copied or shared: it works only once", () => {
    expect(reusableInvite(saved, false, now, false)).toBe(true);
    expect(reusableInvite(saved, false, now, true)).toBe(false);
  });

  it("routes invite and letter pages, and never reports their ids", () => {
    expect(matchRoute("/i/abcdefghjkmn")).toEqual({ name: "invite", code: "abcdefghjkmn" });
    expect(matchRoute("/letters")).toEqual({ name: "letters" });
    expect(matchRoute("/letters/r_0123456789abcdef")).toEqual({
      name: "letters-with",
      id: "r_0123456789abcdef",
    });
    expect(routeTemplate(matchRoute("/i/abcdefghjkmn"))).toBe("/i/:code");
    expect(routeTemplate(matchRoute("/letters/r_x"))).toBe("/letters/:id");
    expect(templateIds("https://terrakin.org/i/abcdefghjkmn")).toBe("https://terrakin.org/i/:id");
    expect(templateIds("/v1/invites/abcdefghjkmn/accept")).toBe("/v1/invites/:id/accept");
    expect(templateIds("/v1/letters/l_0123456789abcdef/media/m_0123456789abcdef")).toBe(
      "/v1/letters/:id/media/:id",
    );
    expect(templateIds("/v1/letters?limit=50&with=r_0123456789abcdef")).toBe(
      "/v1/letters?limit=50&with=:id",
    );
  });
});

describe("example prompts", () => {
  it("has about thirty names and interests, every line in the same shape", () => {
    expect(PROMPT_NAMES.length).toBeGreaterThanOrEqual(30);
    expect(PROMPT_INTERESTS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(PROMPT_NAMES).size).toBe(PROMPT_NAMES.length);
    for (const name of PROMPT_NAMES) {
      for (const interest of PROMPT_INTERESTS) {
        expect(promptLine(name, interest)).toMatch(PROMPT_PATTERN);
      }
    }
  });

  it("is the same for one page view and moves on each step without repeating", () => {
    for (const seed of [1, 42, 123_456_789]) {
      let last = "";
      for (let step = 0; step < 20; step++) {
        const line = promptAt(seed, step);
        expect(promptAt(seed, step)).toBe(line);
        expect(line).toMatch(PROMPT_PATTERN);
        const [name, interest] = /called (\w+) who ([a-z ]+),/.exec(line)?.slice(1) ?? [];
        const [lastName, lastInterest] = /called (\w+) who ([a-z ]+),/.exec(last)?.slice(1) ?? [];
        expect(name).not.toBe(lastName);
        expect(interest).not.toBe(lastInterest);
        last = line;
      }
    }
    const firsts = new Set(Array.from({ length: 40 }, (_, seed) => promptAt(seed, 0)));
    expect(firsts.size).toBeGreaterThan(20);
  });
});
