/**
 * Walking your own figure: what you ask for becomes steps at your figure's pace, drawn the moment
 * you take them and checked by the server behind you.
 *
 * - What you ask for: keys held down (two at once walk diagonally), the d-pad held and slid any of
 *   eight ways, taps that each take one step, and a walk to a tapped tile.
 * - The pace: the next step goes as your figure nears the end of the last one (`Motion.behind`),
 *   so a held key walks at one speed whatever the key repeat rate, the frame rate, or the
 *   connection.
 * - Ahead of the server: each step is checked with the sim's own rule (`stepFrom`) against the
 *   mirror before it's sent (decision 0052), and your figure walks it at once. At most `IN_FLIGHT`
 *   steps wait for the server's answer. If it turns one down, the walk stops and your figure goes
 *   back to where the server says you are.
 *
 * Directions from keys and the d-pad are the screen's (up is "n"); `steer` turns them into the
 * world's under the 3D camera. A route's steps are already the world's.
 */
import { type Direction, directionOf, type Ground, STEP, stepFrom, type Tile } from "@terrakin/sim";

/** How near the end of its last step your figure is when the next one goes, in tiles. */
export const LEAD = 0.45;
/** Steps sent that the server hasn't answered yet, at most. */
export const IN_FLIGHT = 2;
/** A key pressed from standing waits this long for a second, so two pressed together go diagonally. */
export const CHORD_MS = 50;
/**
 * A key let go this recently still counts while another is held, so letting go of a diagonal's
 * two keys a moment apart doesn't turn the last step.
 */
export const RELEASE_MS = 60;
/**
 * A key going down again this soon after it came up is the key repeating: some systems send
 * repeat as the key coming up and going down at once, rather than marking it a repeat.
 */
export const REPEAT_GAP_MS = 30;
/** A step the server hasn't answered in this long is given up on (the socket dropped it). */
export const FLIGHT_MS = 4000;
/** Taps waiting to be walked, at most. */
const MAX_TAPS = 16;

/** What the walker needs from the world view. */
export interface Walking {
  /** Where the server last said you are; undefined before you're in. */
  at(): Tile | undefined;
  /** The ground a step is checked against: the mirror's, through the sim's `groundOf`. */
  ground(): Ground | undefined;
  /** How far your figure still has to walk, in tiles (`Motion.behind`). */
  behind(): number;
  /** A direction from the keys or the d-pad as the world direction it walks. */
  steer(dir: Direction): Direction;
  /** Send one step: the id the server will answer, or undefined if it couldn't go. */
  send(dir: Direction): string | undefined;
  /** Nothing is open that way: turn to it and nudge toward it. */
  bumped(dir: Direction): void;
}

/** A walk to somewhere: `plan` finds the steps from where you are, `arrive` runs once there. */
export interface Route {
  plan(from: Tile): Direction[];
  arrive?(): void;
}

type Source = "key" | "pad";

interface Tap {
  dir: Direction;
  at: number;
  source: Source;
}

interface Key {
  down: boolean;
  at: number;
  upAt: number;
}

/** Two directions on different axes as one diagonal, or undefined. */
function combine(a: Direction, b: Direction): Direction | undefined {
  const [ax, ay] = STEP[a];
  const [bx, by] = STEP[b];
  if ((ax && bx) || (ay && by)) return undefined;
  return directionOf(ax + bx, ay + by);
}

export class Walker {
  /** Where your figure is headed: the tile your last step lands on. Undefined before you're in. */
  ahead: Tile | undefined;
  /** Keys held (or just let go), by the way each points on screen. */
  private readonly keys = new Map<Direction, Key>();
  /** The way the d-pad is held, on screen. */
  private pad: Direction | undefined;
  private readonly taps: Tap[] = [];
  /** Where a tap sent you: its steps, planned from `from`, the tile the first one leaves. */
  private route: (Route & { steps: Direction[]; from: Tile | undefined }) | undefined;
  /** Steps and moves sent and not yet answered. `to` is undefined for a move that isn't a step. */
  private readonly flying: { id: string; to: Tile | undefined; at: number }[] = [];
  /** The server turned something down: wait for every answer, then start over from its word. */
  private unsure = false;
  /** No step before this: the moment a key press waits for a second key. */
  private startAt = Number.NEGATIVE_INFINITY;
  /** The way a held walk last bumped into something, so holding it bumps once. */
  private stuck: Direction | undefined;

  constructor(private readonly world: Walking) {}

  /** A walk key went down. Key repeat isn't a press: the pace comes from the figure. */
  press(key: Direction, now: number) {
    const held = this.keys.get(key);
    if (held?.down) return;
    if (held && now - held.upAt < REPEAT_GAP_MS) {
      held.down = true;
      return;
    }
    this.keys.set(key, { down: true, at: now, upAt: Number.NEGATIVE_INFINITY });
    this.route = undefined;
    this.stuck = undefined;
    // Two keys pressed together are one diagonal step.
    const last = this.taps.at(-1);
    const both = last?.source === "key" && now - last.at <= CHORD_MS && combine(last.dir, key);
    if (last && both) last.dir = both;
    else this.queue({ dir: key, at: now, source: "key" });
    if (this.idle()) this.startAt = Math.max(this.startAt, now + CHORD_MS);
  }

  /** A walk key came up. */
  release(key: Direction, now: number) {
    const k = this.keys.get(key);
    if (k?.down) Object.assign(k, { down: false, upAt: now });
  }

  /** The d-pad went down pointing `dir`: one step, and more while it's held. */
  padDown(dir: Direction, now: number) {
    this.pad = dir;
    this.route = undefined;
    this.stuck = undefined;
    this.queue({ dir, at: now, source: "pad" });
  }

  /** The thumb on the d-pad slid to point another way, or onto the hub (undefined). */
  padMove(dir: Direction | undefined) {
    if (dir !== this.pad) this.stuck = undefined;
    this.pad = dir;
  }

  padUp() {
    this.pad = undefined;
  }

  /** One step that way, from a d-pad button pressed with a key or a screen reader. */
  tap(dir: Direction, now: number) {
    this.route = undefined;
    this.queue({ dir, at: now, source: "pad" });
  }

  /**
   * Walk somewhere, instead of whatever was queued or held. It's planned when the first step is
   * due, from wherever you are by then (after a jump home that's still on its way, say), and
   * planned again whenever you aren't where its next step starts.
   */
  walkTo(route: Route) {
    this.letGo();
    this.taps.length = 0;
    this.route = { ...route, steps: [], from: undefined };
  }

  /**
   * Something that may move you is on its way to the server (going home): walk no further until
   * it's answered, then from wherever the server says you are.
   */
  awaiting(id: string, now: number) {
    this.flying.push({ id, to: undefined, at: now });
  }

  /** The server answered `id`. False when it was turned down. Says whether it was one of ours. */
  answered(id: string, ok: boolean): boolean {
    const i = this.flying.findIndex((f) => f.id === id);
    if (i < 0) return false;
    this.flying.splice(i, 1);
    if (!ok) {
      this.unsure = true;
      this.stop();
    }
    return true;
  }

  /** Stop walking: let go of every key and the d-pad, and forget taps and routes. */
  stop() {
    this.letGo();
    this.taps.length = 0;
    this.route = undefined;
    this.stuck = undefined;
  }

  /**
   * Count every walk key as let go, whatever the keyboard says next: macOS sends no keyup for a key
   * let go while Command is down, so Command lets go of them all.
   */
  releaseKeys() {
    for (const k of this.keys.values())
      Object.assign(k, { down: false, upAt: Number.NEGATIVE_INFINITY });
  }

  /** Let go of the keys and the d-pad. */
  private letGo() {
    this.releaseKeys();
    this.pad = undefined;
  }

  /** A new connection or a new world: nothing in flight, nothing ahead. */
  reset() {
    this.stop();
    this.flying.length = 0;
    this.unsure = false;
    this.ahead = undefined;
  }

  /** Take the next step if it's time. Call once a frame. */
  tick(now: number) {
    const at = this.world.at();
    if (!at) {
      this.ahead = undefined;
      return;
    }
    // Give up on answers that never came; the socket's reconnect starts over anyway.
    while (this.flying[0] && now - this.flying[0].at > FLIGHT_MS) {
      this.flying.shift();
      this.unsure = true;
    }
    if (this.flying.length === 0) {
      // Nothing waiting on the server: where it says you are is where you are.
      this.unsure = false;
      if (this.ahead?.x !== at.x || this.ahead?.y !== at.y) this.ahead = { x: at.x, y: at.y };
    }
    const ahead = this.ahead;
    const ground = this.world.ground();
    if (!ahead || !ground || this.unsure || now < this.startAt) return;
    if (this.flying.length >= IN_FLIGHT || this.flying.some((f) => !f.to)) return;
    if (this.world.behind() > LEAD) return;
    const ask = this.next(now);
    if (!ask) {
      this.arrive();
      return;
    }
    const { tries, routed } = ask;
    for (const dir of tries) {
      const step = stepFrom(ground, ahead, dir);
      if (!step.ok) continue;
      const id = this.world.send(dir);
      if (id === undefined) {
        this.stop();
        return;
      }
      this.flying.push({ id, to: step.to, at: now });
      this.ahead = step.to;
      this.stuck = undefined;
      if (routed && this.route) {
        this.route.steps.shift();
        this.route.from = step.to;
      }
      return;
    }
    // Nothing open that way. A route looks for another way; a key or the d-pad bumps, once.
    const way = tries[0] as Direction;
    if (routed) {
      if (!this.replan()) this.arrive();
    } else if (this.stuck !== way) {
      this.world.bumped(way);
      this.stuck = this.holding(now) ? way : undefined;
    }
  }

  private queue(tap: Tap) {
    if (this.taps.length < MAX_TAPS) this.taps.push(tap);
  }

  /** Nothing queued, nothing in flight, and your figure standing. */
  private idle(): boolean {
    return this.taps.length <= 1 && this.flying.length === 0 && this.world.behind() === 0;
  }

  /** Whether a key or the d-pad is still asking to walk. */
  private holding(now: number): boolean {
    return this.pad !== undefined || this.held(now) !== undefined;
  }

  /**
   * The way the held keys point on screen: the newest key on each axis, and a key let go a moment
   * ago while another is still down.
   */
  private held(now: number): Direction | undefined {
    const live = [...this.keys].filter(([, k]) => k.down);
    if (live.length === 0) return undefined;
    const recent = [...this.keys].filter(([, k]) => !k.down && now - k.upAt < RELEASE_MS);
    let x: [Direction, number] | undefined;
    let y: [Direction, number] | undefined;
    for (const [dir, k] of [...live, ...recent]) {
      const [dx] = STEP[dir];
      if (dx) {
        if (!x || k.at > x[1]) x = [dir, k.at];
      } else if (!y || k.at > y[1]) y = [dir, k.at];
    }
    if (x && y) return combine(y[0], x[0]);
    return (x ?? y)?.[0];
  }

  /** The newest key's axis, to try first when a diagonal is blocked. */
  private newestAxis(): "x" | "y" {
    let newest: [Direction, number] | undefined;
    for (const [dir, k] of this.keys)
      if (k.down && (!newest || k.at > newest[1])) newest = [dir, k.at];
    return newest && STEP[newest[0]][0] === 0 ? "y" : "x";
  }

  /**
   * The next step to try, in the world's directions, and what to slide along instead when it's a
   * blocked diagonal; `routed` when it's a route's. Takes a tap off the queue. Undefined when
   * nothing asks to walk.
   */
  private next(now: number): { tries: Direction[]; routed: boolean } | undefined {
    const steer = (d: Direction) => this.world.steer(d);
    const tap = this.taps.shift();
    let want: Direction | undefined;
    if (tap) {
      // A key tap walks with the other keys held: east tapped while holding north is northeast.
      // The tap keeps its own axis; the held keys fill in the other.
      const [tx, ty] = STEP[tap.dir];
      const [hx, hy] = tap.source === "key" ? STEP[this.held(now) ?? tap.dir] : [0, 0];
      want = directionOf(tx || hx, ty || hy) ?? tap.dir;
    } else {
      want = this.pad ?? this.held(now);
    }
    if (want) {
      const [dx, dy] = STEP[want];
      if (!dx || !dy) return { tries: [steer(want)], routed: false };
      const across = directionOf(dx, 0) as Direction;
      const along = directionOf(0, dy) as Direction;
      const first = tap?.source === "pad" || this.pad ? "x" : this.newestAxis();
      const slide = first === "x" ? [across, along] : [along, across];
      return { tries: [want, ...slide].map(steer), routed: false };
    }
    // A route walks from where it was planned; anywhere else, it's planned again from here.
    const route = this.route;
    const from = this.ahead;
    if (!route || !from) return undefined;
    if (route.from?.x !== from.x || route.from?.y !== from.y) this.replan();
    const step = route.steps[0];
    return step ? { tries: [step], routed: true } : undefined;
  }

  /** Plan the route again from where you're headed. False when there's no way on from here. */
  private replan(): boolean {
    const route = this.route;
    const from = this.ahead ?? this.world.at();
    if (!route || !from) return false;
    route.steps = route.plan(from);
    route.from = { x: from.x, y: from.y };
    return route.steps.length > 0;
  }

  /** A route with no steps left is done once your figure gets there. */
  private arrive() {
    const route = this.route;
    if (!route || route.steps.length > 0 || this.world.behind() > 0.1) return;
    this.route = undefined;
    route.arrive?.();
  }
}
