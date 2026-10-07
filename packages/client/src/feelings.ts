/**
 * Feelings on figures (RFC 0013, phase 1): what a figure shows, worked out in the client from
 * events the server already sends. Nothing here reaches the server or the sim. One feeling at a
 * time per figure, the newest wins, and each is held a few seconds. `pose` turns what's shown
 * into the moment's blink, bounce, tilt, wave and floating sign for the 2D map and the 3D peg.
 * Pure: the caller passes the time.
 */
import type { GestureKind } from "@terrakin/protocol";
import type { Feeling } from "@terrakin/ui/feelings";

/** Body language that plays once at the start of a reaction. */
type Cue = "wave" | "hop";

export interface Reaction {
  feeling: Feeling;
  cue?: Cue | undefined;
}

export interface Shown extends Reaction {
  /** When it started and when it ends, in the caller's milliseconds. */
  at: number;
  until: number;
}

/** How long a reaction stays on the face. */
export const HOLD_MS = 4000;
/** How long a speaker draws the eyes of the figures around them. */
export const LISTEN_MS = 3500;

/** How a figure answers a gesture sent to them: comfort warms like a hug. */
export function gestureReaction(kind: GestureKind): Reaction {
  switch (kind) {
    case "hug":
    case "kiss":
    case "comfort":
      return { feeling: "love" };
    case "wave":
      return { feeling: "happy", cue: "wave" };
    case "high_five":
      return { feeling: "laugh", cue: "hop" };
    default:
      return { feeling: "happy" };
  }
}

/** Who shows what right now, and who just spoke. */
export class Feelings {
  readonly #shown = new Map<string, Shown>();
  #speaker: { id: string; until: number } | undefined;

  /** Show a reaction on `id`'s figure from `now`, replacing whatever it showed. */
  show(id: string, reaction: Reaction, now: number, hold = HOLD_MS): Shown {
    const shown: Shown = {
      feeling: reaction.feeling,
      cue: reaction.cue,
      at: now,
      until: now + hold,
    };
    this.#shown.set(id, shown);
    return shown;
  }

  /** What `id` shows at `now`, or undefined once it has run out. The same object while it lasts. */
  get(id: string, now: number): Shown | undefined {
    const shown = this.#shown.get(id);
    if (shown && now >= shown.until) {
      this.#shown.delete(id);
      return undefined;
    }
    return shown;
  }

  /** The feeling `id` shows at `now`. */
  feeling(id: string, now: number): Feeling {
    return this.get(id, now)?.feeling ?? "neutral";
  }

  /** `id` said something: figures near them look their way for a moment. */
  heard(id: string, now: number) {
    this.#speaker = { id, until: now + LISTEN_MS };
  }

  /** Who figures look at, if anyone. */
  speaker(now: number): string | undefined {
    if (this.#speaker && now >= this.#speaker.until) this.#speaker = undefined;
    return this.#speaker?.id;
  }
}

/** A figure's motion this moment. Lengths in tiles, angles in radians. */
export interface Pose {
  /** The feeling on the face. */
  feeling: Feeling;
  /** Eyes shut for a blink. */
  blink: boolean;
  /** Up off the ground: a bounce or a hop. */
  lift: number;
  /** Lean of the head (and in 2D the whole figure), positive to the figure's right. */
  tilt: number;
  /** A raised hand at one end of the wave or the other, or 0. */
  wave: 0 | 1 | 2;
  /** How far the floating sign has drifted up, and how strongly it shows. */
  rise: number;
  fade: number;
}

export const restingPose = (): Pose => ({
  feeling: "neutral",
  blink: false,
  lift: 0,
  tilt: 0,
  wave: 0,
  rise: 0,
  fade: 1,
});

/** How long the eyes stay shut in a blink. */
const BLINK_MS = 130;
const HOP_MS = 480;
const WAVE_MS = 1800;
const DRIFT_MS = 1700;

/** A figure's own offset for blinking, 0 to 1, from its id, so a crowd doesn't blink together. */
export function idPhase(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** One up-and-down arc of `height`, `k` from 0 to 1 through it. */
const arc = (k: number, height: number) => (k > 0 && k < 1 ? 4 * height * k * (1 - k) : 0);

/**
 * The pose for `shown` (or nothing: neutral) at `now`, written into `out` so a frame allocates
 * nothing. `phase` is the figure's own offset (`idPhase`). With `still` (reduced motion) the face
 * and its sign stay, and the bounce, hop, sway, blink, wave swing and drift go.
 */
export function pose(
  shown: Shown | undefined,
  now: number,
  phase: number,
  still: boolean,
  out: Pose,
): Pose {
  const feeling = shown?.feeling ?? "neutral";
  const t = shown ? now - shown.at : 0;
  out.feeling = feeling;
  // Every few seconds, a little sooner or later for each figure.
  const every = 3200 + phase * 2400;
  out.blink = !still && (now + phase * every) % every < BLINK_MS;
  out.lift = 0;
  out.tilt = 0;
  out.wave = 0;
  out.rise = 0;
  out.fade = 1;
  switch (feeling) {
    case "sleepy":
      out.tilt = 0.14;
      break;
    case "thinking":
      out.tilt = -0.08;
      break;
    case "shy":
      out.tilt = 0.1;
      break;
    case "sad":
      out.tilt = 0.05;
      break;
    default:
  }
  if (!shown) return out;
  if (shown.cue === "wave" && t < WAVE_MS) out.wave = still || Math.floor(t / 220) % 2 ? 1 : 2;
  if (still) return out;
  if (shown.cue === "hop" && t < HOP_MS) out.lift = arc(t / HOP_MS, 0.3);
  else if (feeling === "laugh") out.lift = arc((t % 1300) / 260, 0.07);
  else if (feeling === "happy") out.lift = arc((t % 1100) / 360, 0.05);
  else if (feeling === "surprised" && t < HOP_MS * 0.7) out.lift = arc(t / (HOP_MS * 0.7), 0.16);
  if (feeling === "love") out.tilt = Math.sin((t / 1600) * Math.PI * 2) * 0.09;
  const k = (t % DRIFT_MS) / DRIFT_MS;
  out.rise = k * 0.3;
  out.fade = Math.min(1, Math.sin(k * Math.PI) * 1.6);
  return out;
}
