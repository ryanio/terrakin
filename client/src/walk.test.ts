import { type Direction, groundOf, route, STEP, type Tile, tileKey } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { Motion, WALK_SPEED } from "./motion";
import { CHORD_MS, FLIGHT_MS, IN_FLIGHT, RELEASE_MS, REPEAT_GAP_MS, Walker } from "./walk";

const CONFIG = { width: 24, height: 24, plotSize: 8, maxPlotsPerResident: 1, reach: 3 };
const FRAME = 16;

/**
 * You in a small world: a walker, the motion that draws you, and a server that answers each step
 * `lag` ms after it's sent, the way the mirror and the socket do.
 */
function world(
  opts: { at?: Tile; lag?: number; answer?: boolean; steer?: (d: Direction) => Direction } = {},
) {
  const blocks = new Set<string>();
  const ground = groundOf({
    config: CONFIG,
    hasBlock: (x, y) => blocks.has(tileKey(x, y)),
    solidBuildings: true,
    shopOpen: true,
  });
  const motion = new Motion();
  motion.self = "me";
  let at: Tile = opts.at ?? { x: 5, y: 5 };
  const sent: { id: string; dir: Direction; t: number }[] = [];
  const bumps: Direction[] = [];
  const pending: { id: string; dir: Direction; due: number }[] = [];
  let now = 0;
  let n = 0;
  const walker = new Walker({
    at: () => at,
    ground: () => ground,
    behind: () => motion.behind("me"),
    steer: opts.steer ?? ((d) => d),
    send: (dir) => {
      const id = `a${++n}`;
      sent.push({ id, dir, t: now });
      pending.push({ id, dir, due: now + (opts.lag ?? 40) });
      return id;
    },
    bumped: (dir) => {
      bumps.push(dir);
      motion.bump("me", dir, now);
    },
  });
  /** Run frames until `until`, answering steps as they come due. */
  const run = (until: number) => {
    for (; now <= until; now += FRAME) {
      while (opts.answer !== false && pending[0] && pending[0].due <= now) {
        const p = pending.shift() as (typeof pending)[number];
        const [dx, dy] = STEP[p.dir];
        at = { x: at.x + dx, y: at.y + dy };
        walker.answered(p.id, true);
      }
      walker.tick(now);
      motion.ahead = walker.ahead;
      motion.pose({ id: "me", x: at.x, y: at.y }, now, false);
    }
  };
  const dirs = () => sent.map((s) => s.dir);
  /** The server answers `id` itself, moving you to `to` (a jump home, say). */
  const answer = (id: string, ok: boolean, to?: Tile) => {
    if (to) at = to;
    walker.answered(id, ok);
  };
  const wall = (...tiles: Tile[]) => {
    for (const t of tiles) blocks.add(tileKey(t.x, t.y));
  };
  return {
    walker,
    motion,
    ground,
    run,
    sent,
    dirs,
    bumps,
    pending,
    answer,
    wall,
    at: () => at,
    get now() {
      return now;
    },
  };
}

describe("a held key", () => {
  it("walks at the figure's pace, however fast the key repeats", () => {
    const w = world();
    w.walker.press("e", 0);
    for (let t = 0; t <= 2000; t += 8) {
      // A fast key repeat: a keydown every 8ms, all of them ignored.
      w.walker.press("e", t);
      w.run(t);
    }
    const gaps = w.sent.slice(1).map((s, i) => s.t - (w.sent[i]?.t ?? 0));
    expect(w.sent.length).toBeGreaterThanOrEqual(9);
    expect(w.sent.length).toBeLessThanOrEqual(11);
    // One even stride: every step about a tile's walk after the last.
    for (const gap of gaps.slice(1))
      expect(Math.abs(gap - 1000 / WALK_SPEED)).toBeLessThanOrEqual(FRAME);
    expect(new Set(w.dirs())).toEqual(new Set(["e"]));
  });

  it("walks the same when the system sends key repeat as the key coming up and down", () => {
    const w = world();
    w.walker.press("e", 0);
    for (let t = 33; t < 1000; t += 33) {
      w.run(t);
      w.walker.release("e", t);
      w.walker.press("e", t + REPEAT_GAP_MS / 3);
    }
    w.walker.release("e", 1000);
    w.run(1000);
    const taken = w.sent.length;
    w.run(2500);
    // About a second's walk, and nothing queued to walk on after the key came up.
    expect(taken).toBeGreaterThanOrEqual(4);
    expect(taken).toBeLessThanOrEqual(6);
    expect(w.sent.length).toBe(taken);
  });

  it("stops when it comes up, after the step it's on", () => {
    const w = world();
    w.walker.press("e", 0);
    w.run(500);
    w.walker.release("e", 500);
    const taken = w.sent.length;
    w.run(1500);
    expect(w.sent.length).toBe(taken);
    expect(w.motion.behind("me")).toBe(0);
    expect(w.at()).toEqual(w.walker.ahead);
  });

  it("with a second key pressed together walks diagonally, and letting go of both doesn't turn", () => {
    const w = world({ at: { x: 2, y: 20 } });
    w.walker.press("n", 0);
    w.walker.press("e", CHORD_MS - 20);
    w.run(1000);
    w.walker.release("n", 1000);
    w.walker.release("e", 1000 + RELEASE_MS - 20);
    w.run(2000);
    expect(w.dirs().length).toBeGreaterThan(2);
    expect(new Set(w.dirs())).toEqual(new Set(["ne"]));
  });

  it("walks on with the other key once one of a diagonal's comes up", () => {
    const w = world({ at: { x: 2, y: 20 } });
    w.walker.press("n", 0);
    w.walker.press("e", 10);
    w.run(800);
    w.walker.release("n", 800);
    w.run(1600);
    const dirs = w.dirs();
    expect(dirs[0]).toBe("ne");
    expect(dirs.at(-1)).toBe("e");
    expect(dirs.slice(dirs.indexOf("e"))).not.toContain("ne");
  });

  it("slides along a wall when its diagonal is blocked, and turns the corner where the wall ends", () => {
    const w = world({ at: { x: 2, y: 10 } });
    // A wall along the north side from x 2 to 6.
    w.wall(...[2, 3, 4, 5, 6].map((x) => ({ x, y: 9 })));
    w.walker.press("n", 0);
    w.walker.press("e", 5);
    w.run(1400);
    const dirs = w.dirs();
    expect(dirs.slice(0, 4)).toEqual(["e", "e", "e", "e"]);
    expect(dirs).toContain("ne");
    expect(dirs).not.toContain("n");
  });

  it("bumps once, without sending anything, when nothing is open that way", () => {
    const w = world();
    w.wall({ x: 6, y: 5 });
    w.walker.press("e", 0);
    w.run(1000);
    expect(w.sent).toEqual([]);
    expect(w.bumps).toEqual(["e"]);
    // Pressed again, it bumps again.
    w.walker.release("e", 1000);
    w.walker.press("e", 1100);
    w.run(1500);
    expect(w.bumps).toEqual(["e", "e"]);
  });

  it("into a wall nudges the figure once it stops on the tile in front", () => {
    const w = world();
    w.wall({ x: 8, y: 5 });
    w.walker.press("e", 0);
    const xs: number[] = [];
    for (let t = 0; t <= 1500; t += FRAME) {
      w.run(t);
      xs.push(w.motion.pose({ id: "me", x: w.at().x, y: w.at().y }, t, false).x);
    }
    expect(w.dirs()).toEqual(["e", "e"]);
    expect(w.bumps).toEqual(["e"]);
    // Past the tile in front of the wall for a moment, then back on it.
    expect(Math.max(...xs)).toBeGreaterThan(7.05);
    expect(xs.at(-1)).toBe(7);
  });

  it("stops at the Town Hall like at a block", () => {
    // The hall stands on x 11 to 13, y 8 and 9.
    const w = world({ at: { x: 12, y: 12 } });
    w.walker.press("n", 0);
    w.run(1500);
    expect(w.dirs()).toEqual(["n", "n"]);
    expect(w.at()).toEqual({ x: 12, y: 10 });
    expect(w.bumps).toEqual(["n"]);
  });

  it("walks the way the camera looks", () => {
    const w = world({
      steer: (d) => (({ n: "e", e: "s", s: "w", w: "n" }) as Record<string, Direction>)[d] ?? d,
    });
    w.walker.press("n", 0);
    w.run(300);
    expect(w.dirs()[0]).toBe("e");
  });
});

describe("taps", () => {
  it("each take one step, even quick ones, at the walking pace", () => {
    const w = world();
    for (const t of [0, 15, 30]) {
      w.walker.padDown("e", t);
      w.walker.padUp();
    }
    w.run(2000);
    expect(w.dirs()).toEqual(["e", "e", "e"]);
    expect(w.at()).toEqual({ x: 8, y: 5 });
  });

  it("keep their order, and never merge into diagonals", () => {
    const w = world();
    for (const [i, dir] of (["w", "n", "w", "n"] as const).entries()) w.walker.tap(dir, i * 10);
    w.run(2000);
    expect(w.dirs()).toEqual(["w", "n", "w", "n"]);
  });

  it("of one key while holding another jog diagonally", () => {
    const w = world({ at: { x: 2, y: 20 } });
    w.walker.press("n", 0);
    w.run(600);
    w.walker.press("e", 600);
    w.walker.release("e", 610);
    w.run(1200);
    expect(w.dirs().filter((d) => d === "ne")).toHaveLength(1);
    expect(w.dirs().filter((d) => d !== "ne" && d !== "n")).toEqual([]);
  });

  it("from the d-pad held walk on, and follow the thumb as it slides", () => {
    const w = world({ at: { x: 5, y: 15 } });
    w.walker.padDown("e", 0);
    w.run(700);
    w.walker.padMove("ne");
    w.run(1400);
    w.walker.padUp();
    w.run(2000);
    const dirs = w.dirs();
    expect(dirs[0]).toBe("e");
    expect(dirs).toContain("ne");
    expect(dirs.slice(dirs.indexOf("ne"))).toEqual(dirs.slice(dirs.indexOf("ne")).map(() => "ne"));
  });
});

describe("ahead of the server", () => {
  it("draws a step the moment it's taken, before the server answers", () => {
    const w = world({ lag: 400 });
    w.walker.tap("e", 0);
    w.run(16);
    expect(w.walker.ahead).toEqual({ x: 6, y: 5 });
    expect(w.at()).toEqual({ x: 5, y: 5 });
    expect(w.motion.pose({ id: "me", x: 5, y: 5 }, 120, false).x).toBeGreaterThan(5.2);
  });

  it(`never has more than ${IN_FLIGHT} steps waiting on the server`, () => {
    const w = world({ answer: false });
    w.walker.press("e", 0);
    w.run(3000);
    expect(w.sent).toHaveLength(IN_FLIGHT);
  });

  it("walks evenly on a slow connection, so long as two steps cover the wait", () => {
    const w = world({ lag: 330 });
    w.walker.press("e", 0);
    w.run(2000);
    const gaps = w.sent.slice(1).map((s, i) => s.t - (w.sent[i]?.t ?? 0));
    for (const gap of gaps.slice(1))
      expect(Math.abs(gap - 1000 / WALK_SPEED)).toBeLessThanOrEqual(FRAME);
  });

  it("stops and goes back to where the server says when it turns a step down", () => {
    const w = world({ answer: false });
    w.walker.press("e", 0);
    w.run(500);
    const [first, second] = w.sent;
    w.walker.answered(first?.id ?? "", false);
    w.walker.answered(second?.id ?? "", true);
    w.run(1500);
    expect(w.walker.ahead).toEqual({ x: 5, y: 5 });
    // The key has to come up and go down again to walk on.
    expect(w.sent).toHaveLength(2);
  });

  it("gives up on a step the server never answers, and walks again from its word", () => {
    const w = world({ answer: false });
    w.walker.tap("e", 0);
    w.run(FLIGHT_MS + 100);
    expect(w.walker.ahead).toEqual({ x: 5, y: 5 });
    w.walker.tap("e", w.now);
    w.run(w.now + 300);
    expect(w.sent).toHaveLength(2);
  });

  it("taken while going home walks from the hearth", () => {
    const w = world({ answer: false });
    w.walker.awaiting("home", 0);
    let arrived = 0;
    w.walker.walkTo({
      plan: (from) => route(w.ground, from, { x: 18, y: 18 }),
      arrive: () => arrived++,
    });
    w.run(300);
    expect(w.sent).toEqual([]);
    // The jump lands at the hearth, (20, 20), and only then does the walk plan its way.
    w.answer("home", true, { x: 20, y: 20 });
    for (let t = 316; t <= 2500; t += FRAME) {
      for (const p of w.pending.splice(0)) {
        const [dx, dy] = STEP[p.dir];
        w.answer(p.id, true, { x: w.at().x + dx, y: w.at().y + dy });
      }
      w.run(t);
    }
    expect(w.at()).toEqual({ x: 18, y: 18 });
    expect(w.dirs()).toEqual(["nw", "nw"]);
    expect(arrived).toBe(1);
  });

  it("waits for anything else that may move you before stepping on", () => {
    const w = world();
    w.walker.awaiting("home", 0);
    w.walker.tap("e", 0);
    w.run(500);
    expect(w.sent).toEqual([]);
    w.walker.answered("home", true);
    w.run(800);
    expect(w.dirs()).toEqual(["e"]);
  });
});

describe("a route", () => {
  it("walks the way round the Town Hall and arrives once", () => {
    const w = world({ at: { x: 12, y: 11 } });
    let arrived = 0;
    w.walker.walkTo({
      plan: (from) => route(w.ground, from, { x: 12, y: 6 }),
      arrive: () => arrived++,
    });
    w.run(4000);
    expect(w.at()).toEqual({ x: 12, y: 6 });
    expect(arrived).toBe(1);
  });

  it("finds another way when something new is in it", () => {
    const w = world({ at: { x: 2, y: 2 } });
    w.walker.walkTo({ plan: (from) => route(w.ground, from, { x: 8, y: 2 }) });
    w.run(250);
    // A wall goes up across the way.
    for (let y = 0; y <= 4; y++) w.wall({ x: 5, y });
    w.run(5000);
    expect(w.at()).toEqual({ x: 8, y: 2 });
  });

  it("tapped while a key is held takes over from the key", () => {
    const w = world();
    w.walker.press("e", 0);
    w.run(400);
    w.walker.walkTo({ plan: (from) => route(w.ground, from, { x: 6, y: 1 }) });
    w.run(3000);
    expect(w.at()).toEqual({ x: 6, y: 1 });
    // Letting go of the key afterwards changes nothing.
    w.walker.release("e", 3000);
    w.run(3500);
    expect(w.at()).toEqual({ x: 6, y: 1 });
  });

  it("gives way to a key", () => {
    const w = world();
    w.walker.walkTo({ plan: (from) => route(w.ground, from, { x: 15, y: 5 }) });
    w.run(300);
    w.walker.press("s", 300);
    w.walker.release("s", 320);
    w.run(1500);
    expect(w.dirs().at(-1)).toBe("s");
  });
});
