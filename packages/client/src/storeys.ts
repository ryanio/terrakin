/**
 * Homes with storeys on the map (RFC 0028): which storey each tile shows. You see the storey you
 * stand on, and the rest of the world from above. The plot you stand on is cut away at your
 * storey: storeys above you aren't drawn but for a faint outline where their floors are, and
 * storeys below you show through, dimmed, where yours has no floor. Every other plot shows each
 * tile's highest storey with something on it. Figures are never hidden: someone under what a tile
 * shows is drawn faded. Pure, so tests pin it.
 */

/** What stands and lies on each storey above the ground floor, as the mirror has it. */
export interface StoreyLayers {
  /** The highest storey any plot may have. */
  readonly top: number;
  /** Whether a block or a floor is on (x, y) on `storey` (1 and up). */
  has(storey: number, x: number, y: number): boolean;
  /** Whether a floor is on (x, y) on `storey` (1 and up). */
  floor(storey: number, x: number, y: number): boolean;
}

/** The plot the map is cut away on, and the storey it's cut at: where the viewer stands. */
export interface Cutaway {
  px: number;
  py: number;
  storey: number;
}

/** How the map draws one tile. */
export interface TileShows {
  /** The highest storey drawn on the tile: it and every storey under it, from the ground up. */
  top: number;
  /** The storeys under `top` show through dimmed: you're upstairs here, and this tile has no floor. */
  dim: boolean;
  /** A floor above `top` is cut away here, so its outline is drawn. */
  overhead: boolean;
}

const FROM_GROUND: TileShows = { top: 0, dim: false, overhead: false };

/** How the map draws (x, y), for a viewer standing at `cut` (none: everything from above). */
export function tileShows(
  layers: StoreyLayers,
  plotSize: number,
  cut: Cutaway | undefined,
  x: number,
  y: number,
): TileShows {
  let highest = 0;
  for (let storey = layers.top; storey >= 1; storey--) {
    if (layers.has(storey, x, y)) {
      highest = storey;
      break;
    }
  }
  const onCut =
    cut !== undefined && Math.floor(x / plotSize) === cut.px && Math.floor(y / plotSize) === cut.py;
  if (!onCut) return highest === 0 ? FROM_GROUND : { top: highest, dim: false, overhead: false };
  let overhead = false;
  for (let storey = cut.storey + 1; storey <= layers.top; storey++) {
    if (layers.floor(storey, x, y)) overhead = true;
  }
  return {
    top: Math.min(highest, cut.storey),
    dim: cut.storey > 0 && !layers.floor(cut.storey, x, y),
    overhead,
  };
}

/**
 * Whether someone on `storey` at (x, y) is under what the map shows there, so their figure is
 * drawn faded, with their name.
 */
export function underFloor(
  layers: StoreyLayers,
  plotSize: number,
  cut: Cutaway | undefined,
  x: number,
  y: number,
  storey: number,
): boolean {
  return tileShows(layers, plotSize, cut, x, y).top > storey;
}
