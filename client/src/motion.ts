/**
 * How residents move between the server's answers, for drawing only: a slide and a little hop for
 * each step, a squash when they land, a gentle sway while they stand, a puff where they land from
 * a jump, and dozing off after standing still a while (shown as the `sleepy` feeling, so faces have
 * one source, `feelings.ts`). Chat bubbles live here too, so the map and the 3D view read one place.
 * Nothing here feeds back into the world; the mirror stays the truth.
 *
 * Times are in milliseconds from the page's own clock. With `still` (prefers-reduced-motion) a
 * figure stands on its tile; bubbles and dozing still show.
 */
import type { Shown } from "./feelings";

/** One step's slide. A little over the walk's step, so a held key reads as one smooth walk. */
export const STEP_MS = 160;
/** Standing still this long, a resident dozes until they move or talk. */
export const DOZE_MS = 2 * 60_000;
/** The puff where someone lands after a jump (going home). */
export const POOF_MS = 450;
const LAND_MS = 140;
const HOP = 0.1;

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
  /** While they doze: the `sleepy` feeling, held until they wake. */
  doze: Shown | undefined;
  /** 0 to 1 through the puff after a jump, or undefined. */
  poof: number | undefined;
}

interface Track {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  stepAt: number;
  activeAt: number;
  jumpAt: number;
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
const ease = (p: number) => p * p * (3 - 2 * p);

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

export class Motion {
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

  /** How to draw this resident now. Call it once per frame for each one drawn. */
  pose(r: { id: string; x: number; y: number }, now: number, still: boolean): Pose {
    let t = this.tracks.get(r.id);
    if (!t) {
      t = {
        fromX: r.x,
        fromY: r.y,
        toX: r.x,
        toY: r.y,
        stepAt: Number.NEGATIVE_INFINITY,
        activeAt: this.woke.get(r.id) ?? now,
        jumpAt: Number.NEGATIVE_INFINITY,
        phase: phaseOf(r.id),
      };
      this.woke.delete(r.id);
      this.tracks.set(r.id, t);
    }
    if (r.x !== t.toX || r.y !== t.toY) {
      const step = Math.abs(r.x - t.toX) + Math.abs(r.y - t.toY) === 1;
      if (step && !still) {
        // Start from wherever the last slide had got to, so quick steps chain smoothly.
        const p = ease(clamp01((now - t.stepAt) / STEP_MS));
        t.fromX += (t.toX - t.fromX) * p;
        t.fromY += (t.toY - t.fromY) * p;
        t.stepAt = now;
      } else {
        t.fromX = r.x;
        t.fromY = r.y;
        t.stepAt = Number.NEGATIVE_INFINITY;
        if (!step) t.jumpAt = now;
      }
      t.toX = r.x;
      t.toY = r.y;
      t.activeAt = now;
    }

    const asleep = now - t.activeAt > DOZE_MS;
    if (!asleep) delete t.doze;
    else
      t.doze ??= {
        feeling: "sleepy",
        cue: undefined,
        at: t.activeAt + DOZE_MS,
        until: Number.POSITIVE_INFINITY,
      };
    const pose: Pose = {
      x: r.x,
      y: r.y,
      lift: 0,
      squash: 1,
      lean: 0,
      sway: 0,
      doze: t.doze,
      poof: undefined,
    };
    if (still) return pose;

    const p = clamp01((now - t.stepAt) / STEP_MS);
    const e = ease(p);
    pose.x = t.fromX + (t.toX - t.fromX) * e;
    pose.y = t.fromY + (t.toY - t.fromY) * e;
    const secs = now / 1000;
    const phase = t.phase * Math.PI * 2;
    if (p < 1) {
      const arc = Math.sin(Math.PI * p);
      pose.lift = arc * HOP;
      pose.squash = 1 - arc * 0.07;
      pose.lean = arc * 0.14;
    } else {
      const landed = now - (t.stepAt + STEP_MS);
      if (landed >= 0 && landed < LAND_MS)
        pose.squash = 1 + Math.sin((Math.PI * landed) / LAND_MS) * 0.09;
      // Breathing: slow and deep asleep, a gentle shift of weight awake.
      pose.sway = asleep
        ? Math.sin(secs * 0.9 + phase) * 0.05
        : Math.sin(secs * 1.7 + phase) * 0.03;
    }
    if (now - t.jumpAt < POOF_MS) pose.poof = (now - t.jumpAt) / POOF_MS;
    return pose;
  }

  /** Forget residents no longer drawn, so the maps stay the size of the crowd. */
  keep(ids: ReadonlySet<string>) {
    for (const map of [this.tracks, this.said, this.woke])
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
  }
}
