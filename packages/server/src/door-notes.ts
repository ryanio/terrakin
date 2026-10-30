import {
  DESIGN_TURNS,
  DESIGNS,
  type DesignId,
  type DesignTurn,
  designOnTiles,
} from "@terrakin/protocol";
import {
  type BlockKind,
  blocksWalkers,
  type DesignNote,
  doorFacing,
  doorOutward,
  MAP_BLOCKS,
  NOTE_CODES,
  openingFacts,
  type WorldState,
} from "@terrakin/sim";

/** `notes` with `note` among them, in the order an answer lists notes (`NOTE_CODES`). */
export function withNote<N extends { code: string }>(
  notes: readonly N[] | undefined,
  note: N,
): N[] {
  const order = (n: N) => (NOTE_CODES as readonly string[]).indexOf(n.code);
  return [...(notes ?? []), note].sort((a, b) => order(a) - order(b));
}

/**
 * Whether a design's door, or the starter hut's, reaches an open edge (decision 0351): straight
 * out from it, the tile past the plot's edge is ground nobody has claimed with nothing in the way.
 * When it isn't and a turn of the design would make it so, a `door_no_edge` note names the turn.
 * Nothing when the design has no door, the door already faces open ground, or no turn helps, since
 * then the plot's own notes and the landlocked check say what there is to say.
 *
 * The starter hut is the `hut` design at turn 0 (`starterHome` in the sim), so its note suggests
 * rebuilding it as that design with a turn.
 */
export function doorNote(
  state: WorldState,
  px: number,
  py: number,
  how: { design: DesignId; turn?: DesignTurn | undefined } | "starter_home",
): DesignNote | undefined {
  const id = how === "starter_home" ? "hut" : how.design;
  const turn = how === "starter_home" ? 0 : (how.turn ?? 0);
  const design = DESIGNS.find((d) => d.id === id);
  if (!design || state.config.plotSize !== design.blocks.length) return undefined;
  const rows = designOnTiles(design, turn);
  const y = rows.findIndex((r) => r.includes("+"));
  if (y < 0) return undefined;
  const door = { x: (rows[y] as string).indexOf("+"), y };
  const blocks: Readonly<Record<string, BlockKind>> = MAP_BLOCKS;
  const wall = (x: number, y: number) => blocksWalkers(blocks[rows[y]?.[x] ?? "."]);
  const out = doorOutward(design.blocks.length, door, wall);
  if (!out) return undefined;
  const facing = doorFacing(openingFacts(state), px, py, door, out);
  if (facing.faces || facing.quarters === undefined) return undefined;
  const to = DESIGN_TURNS[(DESIGN_TURNS.indexOf(turn) + facing.quarters) % DESIGN_TURNS.length];
  const fix =
    how === "starter_home"
      ? `Build it as the hut design with "turn": ${to} and "replace": true, and it will.`
      : `Send "turn": ${to} and it will.`;
  return {
    code: "door_no_edge",
    text: `The door at (${door.x}, ${door.y}) doesn't reach an open edge: straight out from it, past the plot's edge, is someone else's plot, water, or something in the way. ${fix}`,
    tiles: [door],
  };
}
