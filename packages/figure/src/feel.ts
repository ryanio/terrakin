import type { Feeling } from "./feelings.js";
import type { ClipName } from "./spec.js";

/** What a feeling asks of a body. */
export interface FeelingLook {
  /**
   * Face keys and their weights, first choice first. A body holds the first set it has every key
   * of, and none when it has no set whole.
   */
  faces: readonly Readonly<Record<string, number>>[];
  /** A clip to play through once, when the body has it. */
  once?: ClipName;
  /** A clip to hold in place of the resting one for as long as the feeling shows. */
  hold?: ClipName;
  /** How fast the resting clip plays while the feeling shows. */
  rate: number;
}

/** Each feeling on a body: its face, and the clip that goes with it. */
export const FEELING_LOOKS: Readonly<Record<Feeling, FeelingLook>> = {
  neutral: { faces: [], rate: 1 },
  happy: { faces: [{ happy: 1, smile: 1 }, { smile: 1 }, { happy: 1 }], rate: 1 },
  laugh: { faces: [{ happy: 1, smile: 1 }, { smile: 1 }, { happy: 1 }], once: "hop", rate: 1 },
  love: { faces: [{ happy: 1 }], rate: 1 },
  shy: { faces: [{ shy: 1 }], rate: 1 },
  surprised: { faces: [{ surprise: 1 }], once: "hop", rate: 1 },
  sad: { faces: [{ sad: 1 }, { blink: 0.5 }], rate: 0.7 },
  sleepy: { faces: [{ sleepy: 1 }, { blink: 1 }], hold: "sleep", rate: 0.7 },
  thinking: { faces: [], rate: 1 },
};

const NO_FACE: Readonly<Record<string, number>> = {};

/** The face keys a body holds for a feeling, given which keys it has. */
export function faceFor(
  feeling: Feeling,
  has: (key: string) => boolean,
): Readonly<Record<string, number>> {
  return FEELING_LOOKS[feeling].faces.find((face) => Object.keys(face).every(has)) ?? NO_FACE;
}

/** What plays when a clip is asked for. */
export interface ClipChoice {
  /** The clip to play: the one asked for, or the clip that stands in for it. */
  clip: string;
  /** Motion made in code over the stand-in: a bob for a walk, a squash and stretch for a hop. */
  made?: "bob" | "squash";
}

/** The clip a body plays when asked for `clip`, given which clips it has. Every body has `idle`. */
export function clipFor(clip: string, has: (clip: string) => boolean): ClipChoice {
  if (has(clip)) return { clip };
  if (clip === "walk") return { clip: "idle", made: "bob" };
  if (clip === "hop") return { clip: "idle", made: "squash" };
  return { clip: "idle" };
}
