/**
 * How residents move between the server's answers, for drawing only. Every figure walks a path of
 * tiles at one pace: your own as you take each step (`walk.ts`), everyone else's as the server
 * reports their steps, each step of a burst (a putter) walked rather than jumped. A walk eases in
 * where it starts and out where it ends and never slows between, so a held key glides. A figure
 * that falls behind walks a little faster until it catches up.
 *
 * Each step hops, kicks a little dust where it pushes off, and leans into the walk. A figure
 * squashes as it lands, sways while it stands, puffs in after a jump, nudges toward what stopped
 * it, and dozes after standing still a while (the `sleepy` feeling, so faces have one source,
 * `feelings.ts`). Chat bubbles live here too, so the map and the 3D view read one place. Nothing
 * here feeds back into the world; the mirror stays the truth.
 *
 * Times are in milliseconds from the page's own clock. With `still` (prefers-reduced-motion) a
 * figure stands on its tile; walks keep their pace, and bubbles and dozing still show.
 */
import { type Direction, directionOf, STEP, type Tile } from "@terrakin/sim";
import type { Shown } from "./feelings";

/** The walking pace, in tiles a second. A diagonal step is longer, so it takes longer. */
export const WALK_SPEED = 5;
/** How fast a walk gets up to pace, and how hard it stops at its last tile, in tiles a second². */
const ACCEL = 55;
const DECEL = 80;
/** Tiles behind before a figure hurries, and how much faster each tile past that makes it. */
const SLACK = 1.5;
const CATCH_UP = 0.3;
/** The slowest someone else's walk is drawn, however far apart their steps arrive. */
const MIN_PACE = 2;
/** Further behind than this, a figure skips to where it's going rather than walk it all. */
const MAX_BEHIND = 12;
/**
 * Someone else's walk starts this long after their first step arrives, so the next steps have
 * time to arrive too and an uneven connection doesn't make them stutter.
 */
export const CUSHION_MS = 90;
/** Stopped no longer than this, a figure walks on at once when another step comes. */
const REST_MS = 250;
/** Standing still this long, a resident dozes until they move or talk. */
export const DOZE_MS = 2 * 60_000;
/** The puff where someone lands after a jump (going home). */
export const POOF_MS = 450;
/** The little kick of dust where a step pushes off. */
export const DUST_MS = 260;
/** The nudge toward something in the way. */
export const BUMP_MS = 200;
const LAND_MS = 140;
const HOP = 0.14;
const BUMP = 0.14;
/** The longest stretch of time one integration step covers, in seconds. */
const TICK = 1 / 120;

export interface Pose {
  /** Where to draw them, in tiles; between tiles while they step. */
  x: number;
  y: number;
  /** Tiles off the ground. */
  lift: number;
  /** 1 is their shape; above 1 wider and shorter, below 1 taller and thinner. */
  squash: number;
  /** Radians, forward the way they face. */
  lean: number;
  /** Radians, side to side. */
  sway: number;
  /** The way they're walking, or last walked or looked. Undefined until then. */
  facing: Direction | undefined;
  /** While they doze: the `sleepy` feeling, held until they wake. */
  doze: Shown | undefined;
  /** 0 to 1 through the puff after a jump, or undefined. */
  poof: number | undefined;
  /** Where a step pushed off, in tiles, and 0 to 1 through its kick of dust; or undefined. */
  dust: { x: number; y: number; t: number } | undefined;
}

interface Track {
  /** Where they're drawn, in tiles. */
  x: number;
  y: number;
  /** The tiles still to walk to, in order. Empty while they stand. */
  path: Tile[];
  /** The tile the walk ends on: the last of `path`, or where they stand. */
  toX: number;
  toY: number;
  /** The tile the step being walked pushed off from, and when. */
  fromX: number;
  fromY: number;
  stepAt: number;
  /** The tile the step being walked is headed for (the first of `path`), to see a new one start. */
  leg: Tile | undefined;
  /** Tiles a second, now. */
  speed: number;
  /** The pace this walk keeps, in tiles a second: yours, or how fast someone's steps arrive. */
  pace: number;
  /** When the last step joined the walk, and whether `pace` has been timed from their steps. */
  lastStepAt: number;
  timed: boolean;
  /** The time the track was last moved on to. */
  at: number;
  /** A walk starts no sooner than this: `CUSHION_MS` after someone else's first step. */
  startAt: number;
  facing: Direction | undefined;
  kick: { x: number; y: number; t: number };
  /** When they last came to a stop, for the landing squash. */
  stopAt: number;
  activeAt: number;
  jumpAt: number;
  bump: { dx: number; dy: number; at: number } | undefined;
  phase: number;
  doze?: Shown;
}

interface Said {
  text: string;
  until: number;
}

/** A number from 0 to 1 that stays the same for one resident, so a crowd doesn't move in step. */
export function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How long a chat line stays over someone's head: longer lines stay longer. */
export function bubbleMs(text: string): number {
  return Math.min(9000, 3500 + text.length * 55);
}

/**
 * Break a chat line into at most `lines` lines of about `width` characters, at spaces where it
 * can, with an ellipsis when it runs over.
 */
export function wrapWords(text: string, width = 22, lines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (let word of words) {
    while (word.length > width) {
      if (line) out.push(line);
      out.push(word.slice(0, width));
      word = word.slice(width);
      line = "";
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  const last = kept[lines - 1] ?? "";
  kept[lines - 1] = `${last.slice(0, width - 1).trimEnd()}…`;
  return kept;
}

/** How far a track still has to walk, in tiles. */
function remaining(t: Track): number {
  let total = 0;
  let x = t.x;
  let y = t.y;
  for (const p of t.path) {
    total += Math.hypot(p.x - x, p.y - y);
    x = p.x;
    y = p.y;
  }
  return total;
}

export class Motion {
  /** You: your own figure never dozes while you're here to see it. */
  self: string | undefined;
  /**
   * Where your own figure is headed: the tile your last step lands on, ahead of the server's
   * answer (`walk.ts`). Your figure walks there instead of to the mirror's tile.
   */
  ahead: Tile | undefined;
  private readonly tracks = new Map<string, Track>();
  private readonly said = new Map<string, Said>();
  /** Wake-ups for residents not drawn yet, picked up when they first are. */
  private readonly woke = new Map<string, number>();

  /** Someone said something nearby: show it over their head, and wake them. */
  say(id: string, text: string, now: number) {
    this.said.set(id, { text, until: now + bubbleMs(text) });
    const t = this.tracks.get(id);
    if (t) t.activeAt = now;
    else this.woke.set(id, now);
  }

  /** What they're saying now, as lines, and how visible (it fades out at the end). */
  bubble(id: string, now: number): { lines: string[]; alpha: number } | undefined {
    const s = this.said.get(id);
    if (!s) return undefined;
    if (now >= s.until) {
      this.said.delete(id);
      return undefined;
    }
    return { lines: wrapWords(s.text), alpha: clamp01((s.until - now) / 400) };
  }

  /**
   * The server says someone moved. Each step of a burst joins their walk, so a putter is walked
   * tile by tile. Your own steps come from `ahead` instead.
   */
  moved(id: string, x: number, y: number, now: number) {
    const t = this.tracks.get(id);
    if (t && id !== this.self) this.head(t, x, y, now, true);
  }

  /** Something stopped a step that way: turn to it and nudge toward it, if standing. */
  bump(id: string, dir: Direction, now: number) {
    const t = this.tracks.get(id);
    if (!t || t.path.length > 0) return;
    const [dx, dy] = STEP[dir];
    const len = Math.hypot(dx, dy);
    t.bump = { dx: dx / len, dy: dy / len, at: now };
    t.facing = dir;
    t.activeAt = now;
  }

  /** Turn someone to face a way (looking at what they tapped), until they next move. */
  face(id: string, dir: Direction) {
    const t = this.tracks.get(id);
    if (t) t.facing = dir;
  }

  /** How far someone still has to walk to reach where they're headed, in tiles. */
  behind(id: string): number {
    const t = this.tracks.get(id);
    return t ? remaining(t) : 0;
  }

  /** How to draw this resident now. Call it each frame for each one drawn; again is free. */
  pose(r: { id: string; x: number; y: number }, now: number, still: boolean): Pose {
    let t = this.tracks.get(r.id);
    const mine = r.id === this.self;
    const goal = mine && this.ahead ? this.ahead : r;
    if (!t) {
      t = {
        x: goal.x,
        y: goal.y,
        path: [],
        toX: goal.x,
        toY: goal.y,
        fromX: goal.x,
        fromY: goal.y,
        stepAt: Number.NEGATIVE_INFINITY,
        leg: undefined,
        speed: 0,
        pace: WALK_SPEED,
        lastStepAt: Number.NEGATIVE_INFINITY,
        timed: false,
        at: now,
        startAt: now,
        facing: undefined,
        kick: { x: goal.x, y: goal.y, t: 0 },
        stopAt: Number.NEGATIVE_INFINITY,
        activeAt: this.woke.get(r.id) ?? now,
        jumpAt: Number.NEGATIVE_INFINITY,
        bump: undefined,
        phase: phaseOf(r.id),
      };
      this.woke.delete(r.id);
      this.tracks.set(r.id, t);
    }
    this.head(t, goal.x, goal.y, now, !mine);
    this.advance(t, now);

    const asleep = !mine && now - t.activeAt > DOZE_MS;
    if (!asleep) delete t.doze;
    else
      t.doze ??= {
        feeling: "sleepy",
        cue: undefined,
        at: t.activeAt + DOZE_MS,
        until: Number.POSITIVE_INFINITY,
      };
    const pose: Pose = {
      x: t.toX,
      y: t.toY,
      lift: 0,
      squash: 1,
      lean: 0,
      sway: 0,
      facing: t.facing,
      doze: t.doze,
      poof: undefined,
      dust: undefined,
    };
    if (still) return pose;

    pose.x = t.x;
    pose.y = t.y;
    const secs = now / 1000;
    const phase = t.phase * Math.PI * 2;
    const leg = t.path[0];
    if (leg) {
      // A hop for each step, from the tile it pushed off to the next.
      const span = Math.hypot(leg.x - t.fromX, leg.y - t.fromY) || 1;
      const p = clamp01(1 - Math.hypot(leg.x - t.x, leg.y - t.y) / span);
      const arc = Math.sin(Math.PI * p);
      const pace = Math.min(1, t.speed / WALK_SPEED);
      pose.lift = arc * HOP * pace;
      pose.squash = 1 - arc * 0.07 * pace;
      pose.lean = (0.06 + arc * 0.08) * pace;
    } else {
      const landed = now - t.stopAt;
      if (landed >= 0 && landed < LAND_MS)
        pose.squash = 1 + Math.sin((Math.PI * landed) / LAND_MS) * 0.09;
      // Breathing: slow and deep asleep, a gentle shift of weight awake.
      pose.sway = asleep
        ? Math.sin(secs * 0.9 + phase) * 0.05
        : Math.sin(secs * 1.7 + phase) * 0.03;
      const b = t.bump;
      if (b && now - b.at < BUMP_MS) {
        const k = Math.sin((Math.PI * (now - b.at)) / BUMP_MS) * BUMP;
        pose.x += b.dx * k;
        pose.y += b.dy * k;
        pose.lean = k;
      }
    }
    if (now - t.jumpAt < POOF_MS) pose.poof = (now - t.jumpAt) / POOF_MS;
    if (now - t.stepAt < DUST_MS) {
      t.kick.t = (now - t.stepAt) / DUST_MS;
      pose.dust = t.kick;
    }
    return pose;
  }

  /** Forget residents no longer drawn, so the maps stay the size of the crowd. */
  keep(ids: ReadonlySet<string>) {
    for (const map of [this.tracks, this.said, this.woke])
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
  }

  /**
   * Send a track on to (x, y): one more step of its walk, or a jump when it's farther. `theirs`
   * is someone else's step, which arrives when the network brings it rather than when it's taken.
   */
  private head(t: Track, x: number, y: number, now: number, theirs: boolean) {
    if (x === t.toX && y === t.toY) return;
    t.activeAt = now;
    const step = Math.max(Math.abs(x - t.toX), Math.abs(y - t.toY)) === 1;
    if (step && remaining(t) + 1 <= MAX_BEHIND) {
      const resting = t.path.length === 0 && now - t.stopAt > REST_MS;
      if (!theirs || resting) {
        t.pace = WALK_SPEED;
        t.timed = false;
        if (t.path.length === 0) t.startAt = now + (theirs ? CUSHION_MS : 0);
      } else {
        // Walking on: keep to the pace their steps arrive at, so a walk from a slow connection
        // flows instead of stopping at every tile to wait for the next. The first gap sets it,
        // and later ones nudge it, so one late step doesn't stall the walk.
        const perTile = (now - t.lastStepAt) / Math.hypot(x - t.toX, y - t.toY);
        const arriving = Math.min(WALK_SPEED, 1000 / Math.max(perTile, 1));
        t.pace = t.timed ? t.pace + (arriving - t.pace) * 0.5 : arriving;
        t.timed = true;
        if (t.path.length === 0) t.startAt = now;
      }
      t.lastStepAt = now;
      t.path.push({ x, y });
    } else {
      // A jump, or a walk too far behind to be worth walking: there at once.
      if (!step) t.jumpAt = now;
      t.path = [];
      t.leg = undefined;
      t.speed = 0;
      t.x = x;
      t.y = y;
      t.fromX = x;
      t.fromY = y;
    }
    t.toX = x;
    t.toY = y;
  }

  /** Walk a track on to `now`, in small steps so the pace is the same at any frame rate. */
  private advance(t: Track, now: number) {
    let clock = Math.max(t.at, t.startAt);
    t.at = Math.max(t.at, now);
    if (clock <= now) setOff(t, clock);
    while (clock < now && t.path.length > 0) {
      const h = Math.min(TICK, (now - clock) / 1000);
      clock += h * 1000;
      const total = remaining(t);
      const cruise = Math.max(MIN_PACE, t.pace) * (1 + CATCH_UP * Math.max(0, total - SLACK));
      // The fastest they can go and still stop on the last tile.
      const want = Math.min(cruise, Math.sqrt(2 * DECEL * total));
      t.speed = t.speed < want ? Math.min(want, t.speed + ACCEL * h) : want;
      let d = t.speed * h;
      while (t.path.length > 0) {
        const leg = t.path[0] as Tile;
        const gx = leg.x - t.x;
        const gy = leg.y - t.y;
        const seg = Math.hypot(gx, gy);
        if (seg > d) {
          t.x += (gx / seg) * d;
          t.y += (gy / seg) * d;
          break;
        }
        d -= seg;
        t.x = leg.x;
        t.y = leg.y;
        t.path.shift();
        if (t.path.length > 0) setOff(t, clock);
        else {
          t.leg = undefined;
          t.speed = 0;
          t.stopAt = clock;
        }
      }
    }
  }
}

/** A new step pushes off from where they stand: turn that way, and kick up dust. */
function setOff(t: Track, clock: number) {
  const leg = t.path[0];
  if (!leg || t.leg === leg) return;
  t.leg = leg;
  t.fromX = Math.round(t.x);
  t.fromY = Math.round(t.y);
  t.stepAt = clock;
  t.kick = { x: t.fromX, y: t.fromY, t: 0 };
  t.facing = directionOf(leg.x - t.fromX, leg.y - t.fromY) ?? t.facing;
  t.bump = undefined;
}
