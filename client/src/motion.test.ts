import { facingFrom, facingToward } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import {
  BUMP_MS,
  bubbleMs,
  CUSHION_MS,
  DOZE_MS,
  DUST_MS,
  Motion,
  POOF_MS,
  WALK_SPEED,
  wrapWords,
} from "./motion";
import { stackBubbles } from "./overhead";

const at = (x: number, y: number) => ({ id: "a", x, y });

describe("walking", () => {
  /** Draw a figure every `frame` ms from `from` to `to`, and where it was each time. */
  const film = (
    m: Motion,
    r: { id: string; x: number; y: number },
    from: number,
    to: number,
    frame = 16,
  ) => {
    const frames: { t: number; x: number; y: number; lift: number }[] = [];
    for (let t = from; t <= to; t += frame) {
      const p = m.pose(r, t, false);
      frames.push({ t, x: p.x, y: p.y, lift: p.lift });
    }
    return frames;
  };

  /** You, walking: a step taken the moment `ahead` moves, as `walk.ts` does. */
  const you = () => {
    const m = new Motion();
    m.self = "a";
    m.pose(at(5, 5), 0, false);
    return m;
  };

  it("walks a step at the walking pace with a hop, and lands on the tile", () => {
    const m = you();
    m.ahead = { x: 6, y: 5 };
    expect(m.pose(at(5, 5), 0, false).x).toBe(5);
    const half = m.pose(at(5, 5), 120, false);
    expect(half.x).toBeGreaterThan(5.3);
    expect(half.x).toBeLessThan(5.8);
    expect(half.lift).toBeGreaterThan(0.05);
    expect(half.squash).toBeLessThan(1);
    expect(half.facing).toBe("e");
    const done = m.pose(at(5, 5), 1000 / WALK_SPEED + 150, false);
    expect([done.x, done.y, done.lift]).toEqual([6, 5, 0]);
  });

  it("keeps one pace through a held walk, never slowing between tiles", () => {
    const m = you();
    m.ahead = { x: 6, y: 5 };
    const xs: number[] = [];
    for (let t = 0; t <= 2000; t += 16) {
      // The next step goes as the figure nears the last one, the way `walk.ts` paces a held key.
      const ahead = m.ahead as { x: number; y: number };
      if (m.behind("a") < 0.45) m.ahead = { x: ahead.x + 1, y: 5 };
      xs.push(m.pose(at(5, 5), t, false).x);
    }
    const speeds = xs.slice(1).map((x, i) => (x - (xs[i] ?? x)) / 0.016);
    // Past the first few frames, every frame moves at the walking pace.
    for (const v of speeds.slice(10)) expect(v).toBeCloseTo(WALK_SPEED, 0);
    expect(Math.min(...speeds.slice(10))).toBeGreaterThan(WALK_SPEED * 0.97);
  });

  it("takes longer over a diagonal step, at the same speed", () => {
    const along = you();
    along.ahead = { x: 6, y: 5 };
    const across = you();
    across.ahead = { x: 6, y: 6 };
    const landed = (m: Motion) =>
      film(m, at(5, 5), 0, 1000).find((f) => f.lift === 0 && f.t > 0)?.t ?? 0;
    expect(landed(across) / landed(along)).toBeGreaterThan(1.25);
    expect(across.pose(at(5, 5), 1000, false).facing).toBe("se");
  });

  it("walks each step of a burst instead of jumping, in order and on the tiles", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, false);
    // A putter: six steps from the server at once, east then north.
    const path = [
      [6, 5],
      [7, 5],
      [8, 5],
      [8, 4],
      [8, 3],
      [8, 2],
    ] as const;
    for (const [x, y] of path) m.moved("a", x, y, 0);
    const frames = film(m, at(8, 2), 0, 3000);
    expect(frames.some((f) => f.lift > 0)).toBe(true);
    expect(m.pose(at(8, 2), 0, false).poof).toBeUndefined();
    // Along the walk, never cutting the corner: east first, then north.
    for (const f of frames) expect(f.x <= 8 && f.y <= 5 && (f.x >= 8 || f.y === 5)).toBe(true);
    const there = frames.find((f) => f.x === 8 && f.y === 2);
    expect(there?.t).toBeGreaterThan(600);
    expect(there?.t).toBeLessThan(1400);
  });

  it("waits a moment before someone else's walk starts, so the next step has time to arrive", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, false);
    m.moved("a", 6, 5, 1000);
    expect(m.pose(at(6, 5), 1000 + CUSHION_MS - 10, false).x).toBe(5);
    expect(m.pose(at(6, 5), 1000 + CUSHION_MS + 100, false).x).toBeGreaterThan(5.2);
  });

  it("keeps walking when someone's steps arrive late, slow, or uneven", () => {
    for (const gaps of [
      [200, 240, 170, 230, 190, 210],
      [320, 320, 320, 320, 320, 320],
    ]) {
      const m = new Motion();
      m.pose(at(0, 5), 0, false);
      let t = 1000;
      let x = 0;
      const xs: number[] = [];
      m.moved("a", ++x, 5, t);
      for (const gap of gaps) {
        for (const end = t + gap; t < end; t += 16) xs.push(m.pose(at(x, 5), t, false).x);
        m.moved("a", ++x, 5, t);
      }
      // From the first stride on, the figure is moving every frame until the steps stop coming.
      const moving = xs.slice(12);
      for (let i = 1; i < moving.length; i++) {
        expect(moving[i], `${gaps} frame ${i}`).toBeGreaterThan(moving[i - 1] ?? 0);
      }
    }
  });

  it("is where it should be at any frame rate", () => {
    const at60 = you();
    const at144 = you();
    at60.ahead = { x: 6, y: 5 };
    at144.ahead = { x: 6, y: 5 };
    film(at60, at(5, 5), 0, 96, 16);
    film(at144, at(5, 5), 0, 96, 7);
    expect(at60.pose(at(5, 5), 100, false).x).toBeCloseTo(at144.pose(at(5, 5), 100, false).x, 2);
  });

  it("kicks up a little dust where each step pushes off", () => {
    const m = you();
    m.ahead = { x: 6, y: 5 };
    expect(m.pose(at(5, 5), 1000, false).dust).toEqual({ x: 5, y: 5, t: 0 });
    expect(m.pose(at(5, 5), 1000 + DUST_MS, false).dust).toBeUndefined();
    m.ahead = { x: 7, y: 5 };
    expect(m.pose(at(5, 5), 3000, true).dust).toBeUndefined();
  });

  it("jumps home without walking, landing in a puff", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, false);
    const landed = m.pose(at(20, 30), 1000, false);
    expect([landed.x, landed.y, landed.lift]).toEqual([20, 30, 0]);
    expect(landed.poof).toBe(0);
    expect(m.pose(at(20, 30), 1000 + POOF_MS, false).poof).toBeUndefined();
  });

  it("skips ahead, without a puff, when too far behind to walk it all", () => {
    const m = new Motion();
    m.pose(at(0, 5), 0, false);
    for (let x = 1; x <= 20; x++) m.moved("a", x, 5, 0);
    const p = m.pose(at(20, 5), 1, false);
    expect(p.x).toBeGreaterThan(5);
    expect(p.poof).toBeUndefined();
  });

  it("nudges toward what's in the way and turns to it, then stands", () => {
    const m = you();
    m.bump("a", "nw", 1000);
    const mid = m.pose(at(5, 5), 1000 + BUMP_MS / 2, false);
    expect(mid.x).toBeLessThan(5);
    expect(mid.y).toBeLessThan(5);
    expect(mid.facing).toBe("nw");
    expect(m.pose(at(5, 5), 1000 + BUMP_MS, false)).toMatchObject({ x: 5, y: 5, facing: "nw" });
  });

  it("nudges toward a wall it walked into once the step it was on lands", () => {
    const m = you();
    m.ahead = { x: 6, y: 5 };
    m.pose(at(5, 5), 0, false);
    m.bump("a", "e", 100);
    // Still walking: no nudge yet, just the step.
    expect(m.pose(at(5, 5), 150, false).x).toBeLessThanOrEqual(6);
    let furthest = 0;
    let facing: string | undefined;
    for (let t = 166; t <= 1000; t += 16) {
      const p = m.pose(at(5, 5), t, false);
      furthest = Math.max(furthest, p.x);
      facing = p.facing;
    }
    expect(furthest).toBeGreaterThan(6.05);
    expect(facing).toBe("e");
    expect(m.pose(at(5, 5), 1000, false).x).toBe(6);
  });

  it("walks your figure back, without a puff, when the server turns its steps down", () => {
    const m = you();
    m.ahead = { x: 6, y: 5 };
    m.pose(at(5, 5), 0, false);
    m.ahead = { x: 7, y: 5 };
    m.pose(at(5, 5), 200, false);
    // Turned down: back to where the server says, two tiles behind.
    m.ahead = { x: 5, y: 5 };
    const frames: { x: number; poof: number | undefined }[] = [];
    for (let t = 216; t <= 1500; t += 16) {
      const p = m.pose(at(5, 5), t, false);
      frames.push({ x: p.x, poof: p.poof });
    }
    expect(frames.every((f) => f.poof === undefined)).toBe(true);
    expect(frames[0]?.x).toBeGreaterThan(5.5);
    expect(frames.at(-1)?.x).toBe(5);
  });

  it("stands on its tile with reduced motion, and keeps the walk's pace", () => {
    const m = you();
    m.ahead = { x: 6, y: 5 };
    const p = m.pose(at(5, 5), 1000, true);
    expect(p).toMatchObject({ x: 6, y: 5, lift: 0, squash: 1, sway: 0, poof: undefined });
    expect(m.behind("a")).toBeGreaterThan(0.9);
    m.pose(at(5, 5), 1000 + 1000 / WALK_SPEED + 150, true);
    expect(m.behind("a")).toBe(0);
  });
});

describe("dozing and waking", () => {
  it("dozes after standing still a while, as the sleepy feeling, and a step wakes them", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, true);
    expect(m.pose(at(5, 5), DOZE_MS - 1, true).doze).toBeUndefined();
    const asleep = m.pose(at(5, 5), DOZE_MS + 1, true).doze;
    expect(asleep).toMatchObject({ feeling: "sleepy", at: DOZE_MS });
    // The same feeling while it lasts, so its sign drifts on rather than starting over.
    expect(m.pose(at(5, 5), DOZE_MS + 500, true).doze).toBe(asleep);
    expect(m.pose(at(5, 6), DOZE_MS + 600, true).doze).toBeUndefined();
  });

  it("never dozes you off", () => {
    const m = new Motion();
    m.self = "a";
    m.pose(at(5, 5), 0, true);
    expect(m.pose(at(5, 5), 3 * DOZE_MS, true).doze).toBeUndefined();
  });

  it("wakes when they talk", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, true);
    m.say("a", "morning", DOZE_MS + 1);
    expect(m.pose(at(5, 5), DOZE_MS + 2, true).doze).toBeUndefined();
  });
});

describe("speech bubbles", () => {
  it("show what was said, fade at the end, and go", () => {
    const m = new Motion();
    m.say("a", "hello there", 0);
    expect(m.bubble("a", 100)).toEqual({ lines: ["hello there"], alpha: 1 });
    const end = bubbleMs("hello there");
    expect(m.bubble("a", end - 200)?.alpha).toBeCloseTo(0.5);
    expect(m.bubble("a", end)).toBeUndefined();
  });

  it("stay longer for longer lines, up to a limit", () => {
    expect(bubbleMs("a long line that keeps going")).toBeGreaterThan(bubbleMs("hi"));
    expect(bubbleMs("x".repeat(280))).toBe(9000);
  });

  it("wrap at spaces into three lines at most, with an ellipsis when it runs over", () => {
    expect(wrapWords("hello neighbours, anyone want to plant tomatoes with me today?")).toEqual([
      "hello neighbours,",
      "anyone want to plant",
      "tomatoes with me…",
    ]);
    expect(wrapWords("short")).toEqual(["short"]);
    expect(wrapWords("a".repeat(30))).toEqual(["a".repeat(22), "a".repeat(8)]);
  });

  it("stack clear of name tags and of each other, the nearest kept lowest", () => {
    const box = (left: number, top: number, w = 40, h = 20) => ({
      left,
      right: left + w,
      top,
      bottom: top + h,
    });
    // Two speakers side by side, and a building's tag above them.
    const raises = stackBubbles([box(100, 100), box(120, 100)], [box(90, 60, 80, 18)]);
    expect(raises[0]).toBe(0);
    const second = raises[1] ?? 0;
    expect(second).toBeGreaterThan(20);
    // Raised past the first bubble, it would have hit the tag, so it goes over that too.
    expect(100 - second + 20).toBeLessThanOrEqual(60 - 3);
    // Bubbles apart don't move.
    expect(stackBubbles([box(0, 100), box(200, 100)], [])).toEqual([0, 0]);
  });

  it("forget residents who are gone", () => {
    const m = new Motion();
    m.say("a", "bye", 0);
    m.keep(new Set());
    expect(m.bubble("a", 1)).toBeUndefined();
  });
});

describe("facing", () => {
  it("turns only on a one-tile step, diagonals too", () => {
    expect(facingFrom(1, 0)).toBe("e");
    expect(facingFrom(0, -1)).toBe("n");
    expect(facingFrom(-1, 1)).toBe("sw");
    expect(facingFrom(5, 2)).toBeUndefined();
    expect(facingFrom(0, 0)).toBeUndefined();
  });

  it("looks toward something the nearest of eight ways", () => {
    expect(facingToward(3, 1)).toBe("e");
    expect(facingToward(-1, -4)).toBe("n");
    expect(facingToward(0, 2)).toBe("s");
    expect(facingToward(2, -2)).toBe("ne");
    expect(facingToward(-3, 2)).toBe("sw");
    expect(facingToward(0, 0)).toBeUndefined();
  });
});
