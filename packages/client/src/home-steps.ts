/**
 * What building a design from the home sheet takes (RFC 0032), worked out before anything is sent,
 * so the sheet's own choices are tested apart from the page: a walk while the plot's center is out
 * of reach, the hearth set there unless it already is, then `home` and `build`.
 */
import type { Tile } from "@terrakin/sim";
import { chebyshev } from "@terrakin/sim";

export interface HomeSteps {
  /** Walk within reach of the center first. */
  walk: boolean;
  /** Send `set_hearth` on the center. */
  setHearth: boolean;
}

/** The steps before `build`, from where you stand, the plot's center, the reach, and your hearth. */
export function homeSteps(o: {
  standing: Tile | undefined;
  center: Tile;
  reach: number;
  hearth: Tile | null | undefined;
}): HomeSteps {
  const setHearth = !o.hearth || o.hearth.x !== o.center.x || o.hearth.y !== o.center.y;
  const walk = setHearth && (!o.standing || chebyshev(o.standing, o.center) > o.reach);
  return { walk, setHearth };
}

/**
 * Whether a refusal of `set_hearth` or `home` still leaves the way to `build` clear: the hearth is
 * already there, or you're already on it with today's pantry in. Then a retry carries on.
 */
export const doneAlready = (code: string) => code === "already_home";
