/**
 * Links into the world (decision 0162): `/world?at=<residentId>` looks at a resident where the map
 * draws them, `/world?at=<px>,<py>` looks at a plot, and `&view=3d` opens the 3D view looking at the
 * same place. Opening a link only looks: going there is a tap, so a link preview or a prefetcher
 * that opens one never moves anybody. Pure, with no imports, so the first load can read a link.
 */

/** What a link asks to look at. */
export type LookTarget =
  | { kind: "resident"; id: string }
  | { kind: "plot"; px: number; py: number };

export interface WorldLink {
  /** The place to look at, when `at` named one in a shape we know. */
  at?: LookTarget;
  /** `at` was there but isn't a resident id or a plot: say so, and open as usual. */
  badAt?: true;
  /** `view=3d`: open the 3D view, where the device offers it. */
  view3d?: true;
}

/** A resident id, as the router reads one in `/r/:id`. */
const RESIDENT = /^[A-Za-z0-9_-]{1,64}$/;
/** Plot coordinates, not tiles: two whole numbers. */
const PLOT = /^(\d{1,4}),(\d{1,4})$/;

/**
 * Read `at` and `view` from a `/world` query string. Undefined when it has neither, so there is
 * nothing to act on or to take out of the address bar.
 */
export function readWorldLink(search: string): WorldLink | undefined {
  const q = new URLSearchParams(search);
  const at = q.get("at");
  const view = q.get("view");
  if (at === null && view === null) return undefined;
  const link: WorldLink = {};
  if (view === "3d") link.view3d = true;
  if (at !== null) {
    const target = lookTarget(at.trim());
    if (target) link.at = target;
    else link.badAt = true;
  }
  return link;
}

function lookTarget(at: string): LookTarget | undefined {
  const plot = PLOT.exec(at);
  if (plot) return { kind: "plot", px: Number(plot[1]), py: Number(plot[2]) };
  if (RESIDENT.test(at)) return { kind: "resident", id: at };
  return undefined;
}

/** The link to a place: `/world?at=3,2`, or `/world?at=r_...&view=3d`. */
export function worldLinkPath(target: LookTarget, view3d = false): string {
  const at = target.kind === "plot" ? `${target.px},${target.py}` : encodeURIComponent(target.id);
  return `/world?at=${at}${view3d ? "&view=3d" : ""}`;
}
