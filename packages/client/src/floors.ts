/**
 * Homes with an upstairs on the map (RFC 0028): which floor each tile shows. You see the floor you
 * stand on, and the rest of the world from above. The plot you stand on is cut away at your
 * floor: floors above you aren't drawn but for a faint outline where their flooring is, and
 * floors below you show through, dimmed, where yours has no flooring. Every other plot shows each
 * tile's highest floor with something on it. Figures are never hidden: someone under what a tile
 * shows is drawn faded. Pure, so tests pin it.
 */

/** What stands and lies on each floor above the ground floor, as the mirror has it. */
export interface FloorLayers {
  /** The highest floor any plot may have. */
  readonly top: number;
  /** Whether a block or flooring is on (x, y) on `floor` (1 and up). */
  has(floor: number, x: number, y: number): boolean;
  /** Whether flooring is on (x, y) on `floor` (1 and up). */
  flooring(floor: number, x: number, y: number): boolean;
}

/** The plot the map is cut away on, and the floor it's cut at: where the viewer stands. */
export interface Cutaway {
  px: number;
  py: number;
  floor: number;
}

/**
 * Where the map and the world in 3D cut away: the plot under `viewer`, at `picked` (the build
 * bar's floor while building) or else the floor they stand on. Nobody to view from cuts nothing.
 */
export function cutaway(
  viewer: { x: number; y: number; floor?: number } | undefined,
  plotSize: number,
  picked?: number,
): Cutaway | undefined {
  if (!viewer) return undefined;
  return {
    px: Math.floor(viewer.x / plotSize),
    py: Math.floor(viewer.y / plotSize),
    floor: picked ?? viewer.floor ?? 0,
  };
}

/**
 * The floor the build bar builds on and cuts the map at: the one picked while the plot you can
 * build on has it, else its top floor. Off any plot you may build on (`floors` undefined) it's
 * the floor you stand on (`mine`), so a neighbor's loft you visit is cut where you are.
 */
export const pickedFloor = (picked: number, floors: number | undefined, mine: number): number =>
  floors === undefined ? mine : Math.min(Math.max(0, picked), floors);

/** How the map draws one tile. */
export interface TileShows {
  /** The highest floor drawn on the tile: it and every floor under it, from the ground up. */
  top: number;
  /** The floors under `top` show through dimmed: you're upstairs here, and this tile has no flooring. */
  dim: boolean;
  /** Flooring above `top` is cut away here, so its outline is drawn. */
  overhead: boolean;
}

const FROM_GROUND: TileShows = { top: 0, dim: false, overhead: false };

/** How the map draws (x, y), for a viewer standing at `cut` (none: everything from above). */
export function tileShows(
  layers: FloorLayers,
  plotSize: number,
  cut: Cutaway | undefined,
  x: number,
  y: number,
): TileShows {
  let highest = 0;
  for (let floor = layers.top; floor >= 1; floor--) {
    if (layers.has(floor, x, y)) {
      highest = floor;
      break;
    }
  }
  const onCut =
    cut !== undefined && Math.floor(x / plotSize) === cut.px && Math.floor(y / plotSize) === cut.py;
  if (!onCut) return highest === 0 ? FROM_GROUND : { top: highest, dim: false, overhead: false };
  let overhead = false;
  for (let floor = cut.floor + 1; floor <= layers.top; floor++) {
    if (layers.flooring(floor, x, y)) overhead = true;
  }
  return {
    top: Math.min(highest, cut.floor),
    dim: cut.floor > 0 && !layers.flooring(cut.floor, x, y),
    overhead,
  };
}

/**
 * Whether someone on `floor` at (x, y) is under what the map shows there, so their figure is
 * drawn faded, with their name.
 */
export function underFlooring(
  layers: FloorLayers,
  plotSize: number,
  cut: Cutaway | undefined,
  x: number,
  y: number,
  floor: number,
): boolean {
  return tileShows(layers, plotSize, cut, x, y).top > floor;
}

/**
 * The floor a tap on (x, y) means for a viewer cut away at `cut`: the floor the map draws there,
 * so what you tap is what you see. Upstairs on the cut plot, an open tile shows the floor below
 * through it and means that one, except the top of the stairs (`stairsUnder`), which is the cut's.
 * A walk keeps to one floor, so a tap that means another walks to the stairs instead.
 */
export function tapFloor(
  layers: FloorLayers,
  plotSize: number,
  cut: Cutaway | undefined,
  x: number,
  y: number,
  stairsUnder: (floor: number, x: number, y: number) => boolean,
): number {
  const onCut =
    cut !== undefined && Math.floor(x / plotSize) === cut.px && Math.floor(y / plotSize) === cut.py;
  if (onCut && cut.floor > 0 && stairsUnder(cut.floor, x, y)) return cut.floor;
  return tileShows(layers, plotSize, cut, x, y).top;
}
