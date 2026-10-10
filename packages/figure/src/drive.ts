/** How a body is moving. */
export interface Motion {
  /** Its speed over the ground, in the scene's units a second. */
  speed: number;
  /** False while it is in the air. */
  grounded: boolean;
}

/** What a body has to move with. */
export interface Gait {
  clips: readonly string[];
  /** How fast its walk covers ground at rate 1, in the scene's units a second, when it says. */
  walkSpeed?: number | undefined;
}

/** A clip and how fast to play it. */
export interface Drive {
  clip: string;
  rate: number;
}

/** A walk is never played slower or faster than this; past either end the feet slide. */
export const MIN_WALK_RATE = 0.5;
export const MAX_WALK_RATE = 2.5;

/** The clips for a body in the air, best first. */
const AIRBORNE = ["fly", "flutter", "hop"] as const;

/**
 * The clip for how a body is moving, and its rate. A walk is played at the rate that makes its
 * planted feet stay planted at this speed, within `MIN_WALK_RATE` and `MAX_WALK_RATE`. It names
 * `walk` even for a body without one, which then bobs its idle instead.
 */
export function drive(motion: Motion, gait: Gait): Drive {
  if (!motion.grounded) {
    return { clip: AIRBORNE.find((clip) => gait.clips.includes(clip)) ?? "idle", rate: 1 };
  }
  const walk = gait.walkSpeed;
  const still = walk === undefined ? 1e-4 : walk * 0.05;
  if (!(motion.speed > still)) return { clip: "idle", rate: 1 };
  if (walk === undefined || !(walk > 0)) return { clip: "walk", rate: 1 };
  return {
    clip: "walk",
    rate: Math.min(MAX_WALK_RATE, Math.max(MIN_WALK_RATE, motion.speed / walk)),
  };
}
