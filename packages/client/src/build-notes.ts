/**
 * Notes about a home in the build bar (RFC 0032): the sim's own `plotNotes`, asked of the mirror
 * with no request, as the server asks them of the world on a build's answer (decision 0052). Facts
 * and suggestions, never a reason to hold a tap back.
 */
import { type DesignNote, type PlotTiles, plotKey, plotNotes, tileKey } from "@terrakin/sim";
import { plural } from "@terrakin/ui/format";
import type { Mirror } from "./mirror";

/** Plot (`px`, `py`) as the mirror has it, in tiles from its north-west corner. */
function mirrorTiles(m: Mirror, px: number, py: number): PlotTiles {
  const S = m.config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const added = m.floors.get(plotKey(px, py)) ?? 0;
  const hearths = [...m.residents.values()]
    .flatMap((r) => (r.hearth ? [r.hearth] : []))
    .filter((t) => t.x >= x0 && t.x < x0 + S && t.y >= y0 && t.y < y0 + S)
    .map((t) => ({ x: t.x - x0, y: t.y - y0 }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    px,
    py,
    size: S,
    floors: Array.from({ length: added + 1 }, (_, i) => i),
    block: (floor, x, y) => m.blocksOn(floor).get(tileKey(x0 + x, y0 + y)),
    ground: (floor, x, y) => m.pavingOn(floor).get(tileKey(x0 + x, y0 + y)),
    edge: (floor, x, y, side) => m.edgeAt(x0 + x, y0 + y, side, floor),
    hearths,
    standing: [],
  };
}

/** The notes about plot (`px`, `py`) as the mirror has it. */
export function mirrorNotes(m: Mirror, px: number, py: number): DesignNote[] {
  return plotNotes(mirrorTiles(m, px, py), {
    config: m.config,
    solidBuildings: m.solidBuildings,
    townHall: m.townHall,
    shop: m.shop,
  });
}

/**
 * The words on the chip that opens the notes, short enough to sit beside the floor chips, and its
 * name for a screen reader. Empty for a clean home.
 */
export function notesLabel(notes: readonly DesignNote[]): { text: string; name: string } {
  if (notes.length === 0) return { text: "", name: "" };
  const text = plural(notes.length, "note", "notes");
  return { text, name: `${text} about this home` };
}

/** Where the free paths are, for a person building: the build bar's Paths tab. */
const FREE_PATHS = "Dirt, sand, moss, and fallen leaves are free on the Paths tab.";

/**
 * A note in a person's words. The sim's own text names tiles by their place on the plot, which the
 * map never labels, so the bar says what to do without them.
 */
export function noteWords(note: DesignNote): string {
  switch (note.code) {
    case "hearth_walled_in":
      return "Nobody can walk to the hearth here: the walls around it have no door or gap. Swap one for a door.";
    case "walled_in":
      return "Some open tiles here can't be walked to: walls close them in. Put in a door or leave a gap, or fill them.";
    // The next three come only on a build's answer, which reads the plots around this one.
    case "no_opening":
      return "This would leave the plot with no way out onto open ground. Leave a gap or a door on the open side.";
    case "seals_neighbor":
      return "This would close the last way out of the plot next door. Leave its corner open.";
    case "way_tiles":
      // A settle's or a claim's note, which the bar never reads; here for the type alone.
      return "A public way crosses this plot. It holds no block, so leave it open or lay a path on it.";
    case "door_no_edge":
      return "The door faces a neighbor's plot rather than open ground. Turn the design so it faces out.";
    case "out_of_reach":
      return "Nobody can get near enough to use something here, like a planter or a pond. Leave a tile beside it to stand on.";
    case "no_path":
      // The sim's two cases: no path or flooring at all, or none from the hearth to the edge.
      return note.text.startsWith("This plot has no path")
        ? `This plot has no path or flooring yet. ${FREE_PATHS}`
        : `No path leads from the hearth out to the edge of the plot. ${FREE_PATHS}`;
    case "crowded":
      return "Blocks cover more than half the plot. A home reads better with room to walk and to grow.";
    case "many_materials":
      return "The walls here are in three materials. Two, with glass for windows, reads as one home.";
  }
}
