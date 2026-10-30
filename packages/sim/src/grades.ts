import {
  ITEM_INFO,
  type ItemKind,
  type MaterialKind,
  STACK_KINDS,
  type StackKind,
} from "./catalog";
import { oneTimeSwitch, refuse } from "./check";
import { isMaterialKind } from "./materials";
import { own } from "./own";
import type { FloorLayer, Rejection, WorldEvent, WorldState } from "./types";

/**
 * Material grades ([RFC 0051](../../../docs/rfcs/0051-material-grades.md)): the five made
 * materials come plain, fine or masterwork. A grade is a property of a stack and of a placed wall,
 * never a kind of its own, so `BLOCK_KINDS`, `STACK_KINDS` and the catalog stay as they are. No
 * rule reads a grade: holding up floors, roofs, walking, coins and points all read the kind.
 *
 * Plain is never stored. Absent means plain in state, commands, events and on the wire, so every
 * material made before grades is plain and nothing about it changes. Nothing here runs until
 * `TOWN_ACTOR` logs `open_grades`: before it any `grade` is refused (`grades_closed`).
 *
 * `FINE_RECIPES` and `GRADING` are frozen once a live world logs `open_grades`; new numbers are a
 * new table behind a new switch, as pottery's are.
 */

/** A made material's grade. Append-only, like every list the sim hashes. */
export const GRADES = ["plain", "fine", "masterwork"] as const;
export type Grade = (typeof GRADES)[number];
/** A grade past plain: the only grades ever written down. */
export type PastPlain = Exclude<Grade, "plain">;
export const PAST_PLAIN: readonly PastPlain[] = ["fine", "masterwork"];

export const isGrade = (g: unknown): g is Grade =>
  typeof g === "string" && (GRADES as readonly string[]).includes(g);

/** The masterwork roll on a fine craft. `grades.test.ts` pins these. */
export const GRADING = {
  /** A roll is a whole number from 0 to one less than this. */
  outOf: 10_000,
  /** A fine craft whose roll is below this comes out masterwork: 8 in 100. */
  masterwork: 800,
  /**
   * A gentle floor: after this many fine crafts in a row with no masterwork among them, a
   * resident's next fine craft comes out masterwork whatever its roll. Counted in the sim
   * (`items.fineRun`), as pottery's `finishFloor` is, so every roll the server logs replays the
   * same.
   */
  floor: 15,
} as const;

/** What a fine craft takes and makes. Its plain inputs, and a fine material it takes, if any. */
export interface FineRecipe {
  /** Plain things it takes, in order, the plain recipe's first. */
  needs: Readonly<Partial<Record<StackKind, number>>>;
  /** Fine materials it takes: fine timber frame is made from fine plaster. */
  fine?: Readonly<Partial<Record<MaterialKind, number>>>;
  makes: number;
}

/**
 * Each material's fine recipe, made at the workbench its plain one is: the plain recipe plus one
 * finishing find (or a fine input), making 2 instead of 4. Frozen once a live world logs
 * `open_grades`.
 */
export const FINE_RECIPES: Readonly<Record<MaterialKind, FineRecipe>> = Object.freeze({
  /** Shells burned for lime. */
  plaster: { needs: { stone: 2, seashell: 1 }, makes: 2 },
  /** A fired clay face. Clay lies only in a world that logged `open_clay`. */
  brickwork: { needs: { stone: 2, wood: 1, clay: 1 }, makes: 2 },
  /** A better input, no find. */
  timber_frame: { needs: { wood: 2 }, fine: { plaster: 1 }, makes: 2 },
  /** Resin to seal it. */
  driftwood_plank: { needs: { driftwood: 3, pinecone: 1 }, makes: 2 },
  /** A clearer pane. */
  sea_glass_pane: { needs: { sea_glass: 2, crystal: 1 }, makes: 2 },
});

/**
 * What a fine craft comes out as for a resident whose last `run` fine crafts held no masterwork:
 * masterwork when the roll is under `GRADING.masterwork`, or when the run has reached the floor.
 */
export const fineCraftGrade = (run: number, roll: number): PastPlain =>
  roll < GRADING.masterwork || run >= GRADING.floor ? "masterwork" : "fine";

/** "brickwork", "fine brickwork", "masterwork plaster blocks": a kind at a grade, lower case. */
export function gradedName(kind: ItemKind, grade: Grade, plural = false): string {
  const info = ITEM_INFO[kind];
  const name = (plural ? info.plural : info.name).toLowerCase();
  return grade === "plain" ? name : `${grade} ${name}`;
}

/**
 * A kind's name at a grade as a label, "Fine brickwork", "Masterwork plaster blocks": its own
 * name for plain, so a plain thing reads as it always did. The one name every surface uses.
 */
export function gradedLabel(kind: ItemKind, grade: Grade | undefined, plural = false): string {
  const info = ITEM_INFO[kind];
  if (grade === undefined || grade === "plain") return plural ? info.plural : info.name;
  const name = gradedName(kind, grade, plural);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** "1 lemon", "3 fine brickwork", in plain words. */
export const gradedCountOf = (kind: StackKind, n: number, grade: Grade): string =>
  `${n} ${gradedName(kind, grade, n !== 1)}`;

/** `grade` for an event or a record: present only past plain, so plain reads as it always did. */
export const gradeField = (grade: Grade | undefined): { grade?: PastPlain } =>
  grade === undefined || grade === "plain" ? {} : { grade };

/**
 * Whether `grade` from an input may be used on `kind`, and the grade it names: plain for absent.
 * The value is checked against `GRADES` before anything uses it as a key. Any grade at all is
 * refused before `open_grades`; past plain, only a made material takes one.
 */
export function gradeFor(state: WorldState, kind: unknown, grade: unknown): Grade | Rejection {
  if (grade === undefined) return "plain";
  if (!isGrade(grade)) return refuse("unknown_item", `A grade is one of ${GRADES.join(", ")}.`);
  const closed = gradesClosed(state);
  if (closed) return closed;
  if (grade !== "plain" && !isMaterialKind(kind)) {
    return refuse(
      "ungraded",
      "Only made materials come in grades. Wood, stone, glass and leaf are always free.",
    );
  }
  return grade;
}

/** `grades_closed` until `open_grades`, else null. */
function gradesClosed(state: WorldState): Rejection | null {
  return state.items?.gradesOpen
    ? null
    : refuse("grades_closed", "Material grades haven't opened in this world yet.");
}

/** `open_grades`, which only TOWN_ACTOR sends, once, after items open. */
export function checkOpenGrades(state: WorldState): (() => WorldEvent[]) | Rejection {
  const items = state.items;
  return oneTimeSwitch({
    on: items?.gradesOpen,
    already: "Material grades are already open.",
    notYet: () =>
      items ? null : refuse("items_closed", "Grades open once growing and making have."),
    turnOn: () => {
      if (items) items.gradesOpen = true;
    },
    event: { type: "grades_opened" },
  });
}

// ---------- where a grade lives on a wall ----------

const NO_GRADES: Readonly<Record<string, PastPlain>> = Object.freeze({});

/**
 * The grades of graded walls on one floor, keyed by `tileKey` for a block and `edgeKey` for a wall
 * between tiles: the ground floor's for 0. A tile key and an edge key never collide.
 */
export function gradesOn(state: WorldState, floor: number): Readonly<Record<string, PastPlain>> {
  if (floor === 0) return state.grades ?? NO_GRADES;
  return own<FloorLayer>(state.floors, String(floor))?.grades ?? NO_GRADES;
}

/** The grade of the wall at `key` (a tile key or an edge key) on `floor`: plain when none is set. */
export function gradeAt(state: WorldState, key: string, floor = 0): Grade {
  const grades = gradesOn(state, floor);
  return Object.hasOwn(grades, key) ? (grades[key] as PastPlain) : "plain";
}

/**
 * Write the grade of the wall at `key` on `floor`, in a commit: past plain it's kept, plain drops
 * the key, and a record left empty goes too, so a world with no graded walls hashes as before.
 * Whatever takes a block or an edge down calls this with plain in the same commit.
 */
export function setGrade(state: WorldState, floor: number, key: string, grade: Grade) {
  const layer: { grades?: Record<string, PastPlain> } | undefined =
    floor === 0 ? state : state.floors?.[String(floor)];
  if (grade === "plain") {
    // Nothing to drop on a floor with no layer, and so nothing to refuse.
    if (!layer?.grades || !Object.hasOwn(layer.grades, key)) return;
    delete layer.grades[key];
    if (Object.keys(layer.grades).length === 0) delete layer.grades;
    return;
  }
  if (!layer) throw new Error(`floor ${floor} has no layer`);
  layer.grades ??= {};
  layer.grades[key] = grade;
}

// ---------- what a plot's read counts ----------

/** A plot's graded walls (RFC 0051), for its read: counts only, and no rule reads them. */
export interface GradedWalls {
  fine: number;
  masterwork: number;
}

/**
 * The graded walls of every plot that has one, by `plotKey`: blocks and walls between tiles on
 * every floor, each counted on the plot of the tile its key names (a line by the tile whose north
 * or west side it is), and a graded roof as one. One pass over the world, so `GET /v1/plots` reads
 * it once. A view reads it; no rule does.
 */
export function gradedWalls(state: WorldState): Map<string, GradedWalls> {
  const S = state.config.plotSize;
  const out = new Map<string, GradedWalls>();
  const add = (key: string, grade: PastPlain) => {
    const at = out.get(key) ?? { fine: 0, masterwork: 0 };
    at[grade] += 1;
    out.set(key, at);
  };
  const layers = [state.grades, ...Object.values(state.floors ?? {}).map((f) => f.grades)];
  for (const grades of layers) {
    for (const [key, grade] of Object.entries(grades ?? {})) {
      const [x = 0, y = 0] = key.split(",").map(Number);
      add(`${Math.floor(x / S)},${Math.floor(y / S)}`, grade);
    }
  }
  for (const plot of Object.values(state.plots)) {
    if (plot.roof?.grade) add(`${plot.px},${plot.py}`, plot.roof.grade);
  }
  return out;
}

// ---------- counting things by kind and grade ----------

/** A tally's key for a kind at a grade: the kind alone for plain, `kind:grade` past it. */
export const unitKey = (kind: StackKind, grade: Grade): string =>
  grade === "plain" ? kind : `${kind}:${grade}`;

/**
 * A tally by `unitKey` as a list in a fixed order: each stack kind in catalog order, plain then
 * fine then masterwork, leaving out what comes to 0. A tally of plain things alone lists exactly
 * what a tally by kind did.
 */
export function unitsOf(tally: ReadonlyMap<string, number>): {
  kind: StackKind;
  grade: Grade;
  amount: number;
}[] {
  return STACK_KINDS.flatMap((kind) =>
    GRADES.flatMap((grade) => {
      const amount = tally.get(unitKey(kind, grade)) ?? 0;
      return amount === 0 ? [] : [{ kind, grade, amount }];
    }),
  );
}
