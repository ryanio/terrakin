import type { PlotPhotoSpec } from "./plot-photo";
import type { SqlExec } from "./sql-store";

/**
 * The story line on a plot photo (issue #80): one line of what is new on the plot since the same
 * resident's last photo of it, so photos of one home read as a progression rather than as the same
 * square over and over.
 *
 * It is written from counts alone, in our own words, never from anything a resident wrote. What a
 * photo showed is kept as a mark per resident and plot: the next photo compares the two and says
 * the difference. A photo whose drawing or upload failed leaves the mark alone, so nothing is
 * silently skipped.
 */

/** What a photo showed, as the next one compares against it. */
export interface PhotoMark {
  blocks: number;
  /**
   * Walls between tiles on the ground floor (RFC 0050). Null for a mark kept before they were
   * counted, so the first photo after says nothing about walls rather than calling all of them new.
   */
  walls: number | null;
  crops: number;
  floors: number;
  pet: boolean;
  named: boolean;
}

export interface PhotoStoryOptions {
  sql: SqlExec;
  now: () => number;
}

/** The tallies a photo's own spec shows, the plot's own only, so a neighbor's work never counts. */
function markOf(spec: PlotPhotoSpec): PhotoMark {
  const S = Math.max(1, Math.floor(spec.size));
  const at = spec.surround ?? { x: 0, y: 0 };
  const on = (p: { x: number; y: number }) =>
    p.x >= at.x && p.x < at.x + S && p.y >= at.y && p.y < at.y + S;
  const upstairs = spec.floors ?? [];
  return {
    blocks:
      spec.blocks.filter(on).length +
      upstairs.reduce((sum, f) => sum + f.blocks.filter(on).length, 0),
    walls: (spec.edges ?? []).filter(on).length,
    crops: (spec.crops ?? []).filter(on).length,
    floors: upstairs.length,
    pet: spec.pet !== undefined,
    named: spec.title !== undefined,
  };
}

/** "a block" / "4 blocks", for the few things a story counts. */
function some(count: number, one: string, many: string): string {
  return count === 1 ? `a ${one}` : `${count} ${many}`;
}

/**
 * What is new between two marks, biggest change first, at most `MOST` parts so the line stays one
 * line in the frame. Nothing new is no line at all: a photo of an unchanged plot says the moment it
 * was taken (its stamp) and leaves it at that.
 */
const MOST = 2;

export function storyBetween(was: PhotoMark | undefined, now: PhotoMark): string | undefined {
  if (!was) return "First photo of this home";
  const floors = now.floors - was.floors;
  const blocks = now.blocks - was.blocks;
  const walls = was.walls === null || now.walls === null ? 0 : now.walls - was.walls;
  const crops = now.crops - was.crops;
  // In the order a home changes most visibly, so the two that make the line are the two worth
  // reading: someone new living here, then height, then what was built, planted, and called.
  const parts = [
    now.pet && !was.pet ? "a pet" : undefined,
    floors > 0 ? some(floors, "floor upstairs", "floors upstairs") : undefined,
    blocks > 0 ? some(blocks, "new block", "new blocks") : undefined,
    walls > 0 ? some(walls, "new wall", "new walls") : undefined,
    crops > 0 ? some(crops, "bed planted", "beds planted") : undefined,
    now.named && !was.named ? "a name" : undefined,
  ].filter((p): p is string => p !== undefined);
  if (parts.length === 0) return undefined;
  return `New since your last photo: ${parts.slice(0, MOST).join(", ")}`;
}

/** The marks of what each resident's last photo of a plot showed. One row per resident and plot. */
export class PhotoStories {
  constructor(private readonly o: PhotoStoryOptions) {
    o.sql.exec(`CREATE TABLE IF NOT EXISTS photo_marks (
      resident TEXT NOT NULL,
      px INTEGER NOT NULL,
      py INTEGER NOT NULL,
      blocks INTEGER NOT NULL,
      crops INTEGER NOT NULL,
      floors INTEGER NOT NULL,
      pet INTEGER NOT NULL,
      named INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (resident, px, py)
    )`);
    // Added with walls between tiles (RFC 0050). Rows kept before it read as null: not counted.
    try {
      o.sql.exec("ALTER TABLE photo_marks ADD COLUMN walls INTEGER");
    } catch {
      // Already there.
    }
  }

  /** What `resident`'s last photo of that plot showed, or undefined for their first. */
  mark(resident: string, place: { px: number; py: number }): PhotoMark | undefined {
    const row = [
      ...this.o.sql.exec(
        "SELECT blocks, walls, crops, floors, pet, named FROM photo_marks WHERE resident = ? AND px = ? AND py = ?",
        resident,
        place.px,
        place.py,
      ),
    ][0];
    if (!row) return undefined;
    return {
      blocks: Number(row.blocks),
      walls: row.walls === null || row.walls === undefined ? null : Number(row.walls),
      crops: Number(row.crops),
      floors: Number(row.floors),
      pet: Number(row.pet) === 1,
      named: Number(row.named) === 1,
    };
  }

  /** The line for the photo about to be drawn, from the mark its last one left. */
  story(resident: string, place: { px: number; py: number }, spec: PlotPhotoSpec) {
    return storyBetween(this.mark(resident, place), markOf(spec));
  }

  /** Keep what this photo showed, once it's drawn and stored. */
  keep(resident: string, place: { px: number; py: number }, spec: PlotPhotoSpec): void {
    const m = markOf(spec);
    this.o.sql.exec(
      `INSERT INTO photo_marks (resident, px, py, blocks, walls, crops, floors, pet, named, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (resident, px, py) DO UPDATE SET
         blocks = excluded.blocks, walls = excluded.walls, crops = excluded.crops, floors = excluded.floors,
         pet = excluded.pet, named = excluded.named, created_at = excluded.created_at`,
      resident,
      place.px,
      place.py,
      m.blocks,
      m.walls ?? 0,
      m.crops,
      m.floors,
      m.pet ? 1 : 0,
      m.named ? 1 : 0,
      this.o.now(),
    );
  }
}
