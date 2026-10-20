import { upstairsProblem } from "./floors";
import type { Rejection, Resident, Tile, WorldState } from "./types";
import { walkWords } from "./walk";
import { outOfReach } from "./world";

/**
 * Standing at a building's door ([RFC 0042](../../../docs/rfcs/0042-actions-that-need-you-there.md)).
 * Everything that trades, governs or arranges in Terrakin could be done from anywhere, which left
 * the world drawn, walkable, and with very little reason to be walked. Each action that moves onto
 * the map asks this, behind a logged switch of its own, so logs from before it replay as they were
 * made.
 */

/** What a refusal says: the lead, the thing they came to do, and what to call the place. */
export interface DoorWords {
  /** Why they have to be here, as its own sentence: "Clem serves at the counter." */
  lead: string;
  /** What they came to do, for the floor refusal: "shop" becomes "Go down ... to shop." */
  doing: string;
  /** The place, for the case where no walk reaches it: "the shop", "the Town Hall". */
  there: string;
}

/**
 * Why `me` isn't at `door`, or null when they are: on the ground floor and within `config.reach`
 * of it. The refusal carries the walk that fixes it, around whatever is in the way, because a
 * straight line across a town points through walls, their own included. Someone upstairs and far
 * off gets both in one answer, so it takes one round trip rather than two. Clients call this to
 * hold a button back and show the reason, rather than working out where anything is.
 */
export function notAtDoor(
  state: WorldState,
  me: Pick<Resident, "x" | "y" | "floor">,
  door: Tile,
  words: DoorWords,
): Rejection | null {
  const walk = walkWords(state, me, door, state.config.reach);
  const far = outOfReach(
    me,
    door,
    state.config.reach,
    words.lead,
    walk === ""
      ? ` There's no walk from where you stand to ${words.there}: something has you closed in. Take a wall away to open the way out.`
      : ` Walk there: ${walk}.`,
  );
  const upstairs = upstairsProblem(me, words.doing);
  if (upstairs) {
    return far ? { ...upstairs, message: `${upstairs.message} ${far.message}` } : upstairs;
  }
  return far;
}
