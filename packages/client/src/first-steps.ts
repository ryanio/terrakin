/**
 * A person's first steps in plain words: the server's first-visit steps and the few daily
 * suggestions a first session meets (`GET /v1/first-visit`), each with the words the home wall's
 * Getting started card and the world's next-step chip show and where it's done. Pure and tested;
 * the server says what's done, this only says it.
 */
import type { FirstVisitResponse } from "@terrakin/protocol";
import type { IconName } from "@terrakin/ui/dom";
import { profilePath } from "@terrakin/ui/paths";

/**
 * Where a step is done: in the world (what the chip does there is `world-next-step.ts`'s), on
 * your own profile, on the plots to visit, or on the home wall.
 */
export type StepPlace = "world" | "profile" | "visit" | "wall";

export interface StepWords {
  name: string;
  /** The name short enough for the world's chip, which keeps to the width of the buttons beside it. */
  chip: string;
  /** A line under the name: how, in a few words. */
  hint: string;
  /** The card's link label: one short verb for what you'll do there. */
  verb: string;
  icon: IconName;
  place: StepPlace;
}

/**
 * The words for each step, in the order the card lists them: the server's first-visit steps by
 * their ids, and three of the check-in's suggestions (`pet`, `gather`, `visit`) where they fit a
 * first session. An id not here isn't shown.
 */
export const STEP_WORDS: Readonly<Record<string, StepWords>> = {
  plot: {
    name: "Claim a plot",
    chip: "Claim a plot",
    hint: "Your own patch of land to build on.",
    verb: "Claim",
    icon: "flag",
    place: "world",
  },
  plot_name: {
    name: "Name your plot",
    chip: "Name your plot",
    hint: "Stand on it and tap Name your plot.",
    verb: "Name it",
    icon: "signpost",
    place: "world",
  },
  home: {
    name: "Build a home",
    chip: "Build a home",
    hint: "A starter home with a hearth, free.",
    verb: "Build",
    icon: "home",
    place: "world",
  },
  handle: {
    name: "Pick a handle",
    chip: "Pick a handle",
    hint: "So people can @mention you.",
    verb: "Pick one",
    icon: "at",
    place: "profile",
  },
  bio: {
    name: "Write a short bio",
    chip: "Write a bio",
    hint: "A line or two about you, on your profile.",
    verb: "Write",
    icon: "quote",
    place: "profile",
  },
  look: {
    name: "Dress up",
    chip: "Dress up",
    hint: "Hair, clothes, and colors, on your profile.",
    verb: "Style",
    icon: "smile",
    place: "profile",
  },
  pet: {
    name: "Adopt a pet",
    chip: "Adopt a pet",
    hint: "Free, and yours for good. On your profile.",
    verb: "Adopt",
    icon: "paw",
    place: "profile",
  },
  garden: {
    name: "Plant a first seed",
    chip: "Plant a seed",
    hint: "Place a planter from Build, then tap it.",
    verb: "Plant",
    icon: "sprout",
    place: "world",
  },
  gather: {
    name: "Gather a branch or a stone",
    chip: "Gather",
    hint: "Tap one lying near you in the world.",
    verb: "Gather",
    icon: "gather",
    place: "world",
  },
  visit: {
    name: "Visit a neighbor's plot",
    chip: "Visit a plot",
    hint: "Look around, and admire it if you like it.",
    verb: "Visit",
    icon: "sparkle",
    place: "visit",
  },
  post: {
    name: "Post a photo of your plot",
    chip: "Post a photo",
    hint: "Photo of your home is on your profile. Any first post counts.",
    verb: "Post",
    icon: "camera",
    place: "profile",
  },
  follow: {
    name: "Follow a few neighbors",
    chip: "Follow people",
    hint: "Tap a name on the wall, then Follow.",
    verb: "Follow",
    icon: "follow",
    place: "wall",
  },
};

/** The most characters a chip name has, so the chip stays the width of Gather all and 3D view. */
export const CHIP_MAX = 14;

/** The most characters a verb has, so every step's link is about the same width. */
export const VERB_MAX = 8;

/** The order the card lists steps in: setting up first, then out and about. */
const ORDER = Object.keys(STEP_WORDS);

export interface StepRow extends StepWords {
  id: string;
  done: boolean;
}

/**
 * The steps to show, in the card's order: every first-visit step the server lists, and the
 * suggestions above it lists as open or tried. Townsfolk get none from the server, so none here.
 */
export function stepRows(r: FirstVisitResponse): StepRow[] {
  const done = new Map<string, boolean>();
  for (const s of r.steps) done.set(s.id, s.done);
  for (const t of r.tries) if (t.id in STEP_WORDS && !done.has(t.id)) done.set(t.id, t.done);
  return ORDER.flatMap((id) => {
    const words = STEP_WORDS[id];
    const isDone = done.get(id);
    return words && isDone !== undefined ? [{ id, done: isDone, ...words }] : [];
  });
}

/** The first step not done yet, or undefined once they all are. */
export const nextStep = (rows: readonly StepRow[]): StepRow | undefined =>
  rows.find((r) => !r.done);

/** "3 of 11 done". */
export function doneLine(rows: readonly StepRow[]): string {
  return `${rows.filter((r) => r.done).length} of ${rows.length} done`;
}

/**
 * Where a step's link goes: the world, your own profile, the plots to visit, or the home wall.
 * `me` is your resident id.
 */
export function stepHref(place: StepPlace, me: string): string {
  if (place === "profile") return profilePath(me);
  if (place === "visit") return "/visit";
  if (place === "wall") return "/";
  return "/world";
}
