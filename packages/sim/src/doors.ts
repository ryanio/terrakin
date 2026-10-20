import { upstairsProblem } from "./floors";
import { landOfPlot, landOfSquare } from "./lands";
import type { Rejection, Resident, Tile, WorldState } from "./types";
import { walkWords } from "./walk";
import {
  chebyshev,
  counterDoor,
  hallDoor,
  outOfReach,
  plotOf,
  type Square,
  squares,
} from "./world";

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

/**
 * Which door a resident is sent to, now that every land has a hall and a counter of its own
 * ([RFC 0038](../../../docs/rfcs/0038-new-lands.md), decision 0332): the one on the land they
 * stand on, the nearest of those when a land ever has more than one, and the nearest of all when
 * they stand on no land at all, which is a bridge tile. Downtown's with no resident to ask about.
 *
 * The land comes before the distance because the lands are a plot-width of water apart: reaching
 * another land's counter means walking to the bridge and over it, which is far longer than the
 * crow flies. On the east edge of downtown an island's counter is the nearer of the two as the
 * crow flies and much the farther to walk, and people live on that edge. Nearest is then reach's
 * own distance (Chebyshev) to the door being asked for, so the nearest hall is measured by halls
 * and the nearest counter by counters, with ties going north to south, then west to east, so
 * replay never has to guess.
 *
 * A resident never has to know which door they got: `notAtDoor` names the walk to it.
 */
function squareFor(state: WorldState, me: Tile | undefined, door: Door): Square {
  const all = squares(state);
  const first = all[0] as Square;
  if (!me || all.length === 1) return first;
  const here = plotOf(state.config, me.x, me.y);
  const land = landOf(state, here.px, here.py);
  const mine = all.filter((s) => landOf(state, s.px, s.py) === land);
  const choose = land !== undefined && mine.length > 0 ? mine : all;
  const nearer = (s: Square, best: Square) => {
    const away = (q: Square) => chebyshev(me, door(state.config, q));
    if (away(s) !== away(best)) return away(s) < away(best);
    return s.py < best.py || (s.py === best.py && s.px < best.px);
  };
  return choose.reduce((best, s) => (nearer(s, best) ? s : best), choose[0] as Square);
}

/**
 * Which land a plot slot belongs to: `"home"` for downtown, a land's id for its plots and its
 * square, and undefined for the water between them. The one place the sim asks it of a slot
 * rather than of a tile, so `squareFor` and nothing else reads it.
 */
function landOf(state: WorldState, px: number, py: number): string | undefined {
  const home = state.lands?.home;
  if (!home) return "home";
  const size = state.config.plotSize;
  if (px >= 0 && py >= 0 && px * size < home.width && py * size < home.height) return "home";
  return (landOfPlot(state, px, py) ?? landOfSquare(state, px, py))?.id;
}

/** A door on a square: the hall's or the shop's, which is what the choice is measured to. */
type Door = (config: WorldState["config"], square: Square) => Tile;

/** The Town Hall door `me` is sent to, and the only one any rule or view asks for. */
export function nearestHall(state: WorldState, me?: Tile): Tile {
  return hallDoor(state.config, squareFor(state, me, hallDoor));
}

/** The shop counter `me` is sent to. Clem stands at downtown's; an island's has no keeper. */
export function nearestCounter(state: WorldState, me?: Tile): Tile {
  return counterDoor(state.config, squareFor(state, me, counterDoor));
}
