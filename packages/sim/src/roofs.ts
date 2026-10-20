import type { StackKind } from "./catalog";
import { refuse } from "./check";
import { blocksOn, HOLDING_BLOCKS } from "./floors";
import {
  addStack,
  blockNeeds,
  closed,
  countOf,
  held,
  ITEMS,
  inventory,
  inventoryEvent,
  inventorySize,
} from "./items";
import { plotKey, tileKey } from "./keys";
import {
  type BlockKind,
  BUILDING_BLOCKS,
  type Command,
  MATERIAL_BLOCKS,
  type PlotRoof,
  type Rejection,
  type ResidentId,
  ROOF_STYLES,
  ROOF_TOPS,
  type RoofStyle,
  type RoofTop,
  type WorldEvent,
  type WorldState,
} from "./types";
import { canBuildOn, isCommons, plotInBounds } from "./world";

/**
 * Roofs ([RFC 0041](../../../docs/rfcs/0041-materials-and-roofs.md)). A home's top floor gets a
 * roof, and a roof is chosen rather than built: one field on the plot, set by `set_roof`. So it is
 * reversible, it takes no second build on a plot whose owner already paid for an upstairs, and it
 * can hide nothing, which is what RFC 0028 worried about when it parked the idea.
 *
 * When it draws is the rule RFC 0028 already shipped: you see the floor you are on, and the rest
 * of the world from above. A roof is part of "from above", so it lifts away while you stand on the
 * plot, exactly as flooring does, and from the street the home has a roof.
 *
 * What it covers is read from the walls each time it's drawn, never stored (`roofShape`). So taking
 * a wall down never has to be checked against a roof, and a home whose walls have all gone draws
 * no roof while keeping the style its owner chose.
 */

/** Every number about roofs in one place. `roofs.test.ts` pins them, so a change is deliberate. */
export const ROOFS = {
  /**
   * Blocks of its material a roof's covering takes, whatever the home's size. Taken when the roof
   * goes up and given back when it comes down, the way a pond's stone is. A free block roofs for
   * free (`blockNeeds` asks nothing for wood, stone, glass or leaf), so thatch and plain shingles
   * cost nothing, and a made material costs what it took to make.
   */
  blocks: 8,
  /**
   * Tiles a group of walls spans each way before it's a home worth roofing. Under it a garden wall
   * or a pair of blocks would wear a roof of its own.
   */
  minSpan: 3,
} as const;

/**
 * What a roof can be covered in: the walls and windows a home is built of, free and made alike.
 * So a leaf roof is thatch, a glass one is a conservatory, and a brickwork one costs brickwork.
 */
export const ROOF_MATERIALS: readonly BlockKind[] = [...BUILDING_BLOCKS, ...MATERIAL_BLOCKS];

export const isRoofStyle = (s: unknown): s is RoofStyle =>
  typeof s === "string" && (ROOF_STYLES as readonly string[]).includes(s);

export const isRoofMaterial = (m: unknown): m is BlockKind =>
  typeof m === "string" && (ROOF_MATERIALS as readonly string[]).includes(m);

/** What a roof's covering takes of its material, and gives back when it comes down. */
export function roofNeeds(material: BlockKind): [StackKind, number][] {
  return blockNeeds(material).map(([kind, n]) => [kind, n * ROOFS.blocks]);
}

/**
 * Where a plot's roof sits: the highest floor whose walls are worth roofing, with the boxes it
 * runs over, or none. So a home that is all ground floor is capped at the ground floor, a loft
 * with walls is capped over the loft, and paying for an upstairs and building nothing up there
 * leaves the roof where it was rather than taking it away.
 */
export function roofSeat(
  wall: (x: number, y: number, floor: number) => boolean,
  px: number,
  py: number,
  plotSize: number,
  floors: number,
): { floor: number; boxes: RoofBox[] } | undefined {
  for (let floor = floors; floor >= 0; floor--) {
    const boxes = roofBoxes((x, y) => wall(x, y, floor), px, py, plotSize);
    if (boxes.length > 0) return { floor, boxes };
  }
  return undefined;
}

/** Whether a block is a wall or window a roof sits on. A hedge holds nothing up. */
export const holdsRoof = (block: BlockKind | undefined): boolean =>
  block !== undefined && HOLDING_BLOCKS.includes(block);

/** A box of tiles, corner to corner, both ends in it. */
export interface RoofBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The boxes a plot's roof runs over: one around each group of touching walls (diagonals count)
 * that spans `ROOFS.minSpan` tiles each way. A home is a ring of walls, so its box is the home,
 * doorway and all, however wide the doorway is and whatever shape the walls make. A line of garden
 * wall spans one tile the other way and gets none.
 */
export function roofBoxes(
  wall: (x: number, y: number) => boolean,
  px: number,
  py: number,
  plotSize: number,
): RoofBox[] {
  const ox = px * plotSize;
  const oy = py * plotSize;
  const seen = new Set<number>();
  const boxes: RoofBox[] = [];
  const at = (i: number) => wall(ox + (i % plotSize), oy + Math.floor(i / plotSize));
  for (let start = 0; start < plotSize * plotSize; start++) {
    if (seen.has(start) || !at(start)) continue;
    // Walk the whole group of touching walls, keeping the box around it as we go.
    seen.add(start);
    const group = [start];
    let x0 = start % plotSize;
    let x1 = x0;
    let y0 = Math.floor(start / plotSize);
    let y1 = y0;
    for (let i = 0; i < group.length; i++) {
      const here = group[i] as number;
      const hx = here % plotSize;
      const hy = Math.floor(here / plotSize);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = hx + dx;
          const ny = hy + dy;
          if (nx < 0 || ny < 0 || nx >= plotSize || ny >= plotSize) continue;
          const next = ny * plotSize + nx;
          if (seen.has(next) || !at(next)) continue;
          seen.add(next);
          group.push(next);
          x0 = Math.min(x0, nx);
          x1 = Math.max(x1, nx);
          y0 = Math.min(y0, ny);
          y1 = Math.max(y1, ny);
        }
      }
    }
    if (x1 - x0 + 1 < ROOFS.minSpan || y1 - y0 + 1 < ROOFS.minSpan) continue;
    boxes.push({ x0: ox + x0, y0: oy + y0, x1: ox + x1, y1: oy + y1 });
  }
  return boxes;
}

/**
 * How high a roof of `style` stands over the corner (cx, cy) of `box`, from 0 at the eave to 1
 * along the ridge. Corners rather than tiles, so neighboring tiles' slopes meet.
 *
 * `gable` runs one ridge down the box's longer way and slopes to two sides. `hip` slopes to all
 * four, so its ridge is short and its ends are cut back. `pitched` is one slope, highest along the
 * north edge, so it leans away from the street.
 */
function cornerHeight(box: RoofBox, style: RoofStyle, cx: number, cy: number): number {
  const width = box.x1 + 1 - box.x0;
  const depth = box.y1 + 1 - box.y0;
  const inX = Math.min(cx - box.x0, box.x1 + 1 - cx);
  const inY = Math.min(cy - box.y0, box.y1 + 1 - cy);
  const high =
    style === "pitched"
      ? (box.y1 + 1 - cy) / depth
      : style === "hip"
        ? (2 * Math.min(inX, inY)) / Math.min(width, depth)
        : width >= depth
          ? (2 * inY) / depth
          : (2 * inX) / width;
  return Math.max(0, Math.min(1, high));
}

/** One tile of a roof: where it is, and how high its four corners stand. */
export interface RoofTile {
  x: number;
  y: number;
  /** 0 at the eave, 1 along the ridge: north-west, north-east, south-east, south-west. */
  h: [number, number, number, number];
}

/** A plot's roof as everything that draws it reads it. */
export interface RoofShape {
  /** Never `flat`: a flat roof is no roof at all, so a plot with one has no `roof` field. */
  style: Exclude<RoofStyle, "flat">;
  material: BlockKind;
  /** The floor it sits over: the highest the home's walls reach (`roofSeat`). */
  floor: number;
  /** North row first, west to east, as a plot's tiles are read everywhere else. */
  tiles: RoofTile[];
  /**
   * What stands on the ridge and the tile it stands on (RFC 0041), absent while the ridge is
   * bare. Every view draws it from here, so they agree on where it is as they do on the slopes.
   */
  top?: { kind: RoofTop; x: number; y: number };
}

/**
 * The roof over a plot, from the walls as they stand now: none when the plot has no roof set, or
 * no group of walls big enough to roof. The map, both 3D views, plot photos and the thumbnails all
 * read this one function, so they agree tile for tile.
 */
export function roofShape(facts: {
  plotSize: number;
  px: number;
  py: number;
  /**
   * The plot's own roof, or one read off the wire, where an absent ridge may come as `undefined`
   * rather than not at all. State itself never holds an undefined (`PlotRoof`).
   */
  roof: (Omit<PlotRoof, "top"> & { top?: RoofTop | undefined }) | undefined;
  /** Floors the plot added above its ground floor (`Plot.floors`). */
  floors: number;
  /** Whether a wall or window stands on the tile of that floor. */
  wall: (x: number, y: number, floor: number) => boolean;
}): RoofShape | undefined {
  const { plotSize, px, py, roof, floors, wall } = facts;
  if (!roof) return undefined;
  const seat = roofSeat(wall, px, py, plotSize, floors);
  if (!seat) return undefined;
  const { style } = roof;
  const tiles: RoofTile[] = [];
  for (let y = py * plotSize; y < (py + 1) * plotSize; y++) {
    for (let x = px * plotSize; x < (px + 1) * plotSize; x++) {
      const h: [number, number, number, number] = [0, 0, 0, 0];
      let covered = false;
      for (const box of seat.boxes) {
        if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) continue;
        covered = true;
        // Where boxes overlap the higher roof wins, so a home reads as one roof.
        h[0] = Math.max(h[0], cornerHeight(box, style, x, y));
        h[1] = Math.max(h[1], cornerHeight(box, style, x + 1, y));
        h[2] = Math.max(h[2], cornerHeight(box, style, x + 1, y + 1));
        h[3] = Math.max(h[3], cornerHeight(box, style, x, y + 1));
      }
      if (covered) tiles.push({ x, y, h });
    }
  }
  const top = roof.top ? roofPeak(tiles) : undefined;
  return {
    style,
    material: roof.material,
    floor: seat.floor,
    tiles,
    ...(roof.top && top ? { top: { kind: roof.top, ...top } } : {}),
  };
}

/**
 * Where something on the ridge stands: the first of the roof's highest tiles, in the order tiles
 * are read, so it sits at the north-west end of a gable's ridge rather than in the middle of the
 * home, where the hearth and whoever is home usually are. Pure, like the rest of the shape, so
 * every view puts it on the same tile.
 */
function roofPeak(tiles: RoofTile[]): { x: number; y: number } | undefined {
  if (tiles.length === 0) return undefined;
  const high = (t: RoofTile) => Math.max(...t.h);
  const top = Math.max(...tiles.map(high));
  const at = tiles.find((t) => high(t) === top);
  return at ? { x: at.x, y: at.y } : undefined;
}

/** The roof over a plot of the world, read from the walls the home's floors hold. */
export function plotRoof(state: WorldState, px: number, py: number): RoofShape | undefined {
  const plot = state.plots[plotKey(px, py)];
  if (!plot?.roof) return undefined;
  return roofShape({
    plotSize: state.config.plotSize,
    px,
    py,
    roof: plot.roof,
    floors: plot.floors ?? 0,
    wall: (x, y, floor) => holdsRoof(blocksOn(state, floor)[tileKey(x, y)]),
  });
}

/** Whether a value from an input is one of the ridge's own (`ROOF_TOPS`). */
const isRoofTop = (v: unknown): v is RoofTop => ROOF_TOPS.includes(v as RoofTop);

type Mutation = () => WorldEvent[];

/**
 * `set_roof {px, py, style, material}`: the roof on a plot you own or share, from anywhere. `flat`
 * is no roof and takes down the one that's up, giving its material back. Any other style takes
 * `ROOFS.blocks` of the material, so a free block roofs for free and a made material costs what it
 * took to make; changing the covering costs the difference.
 */
export function checkSetRoof(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "set_roof" }>,
): Mutation | Rejection {
  const { config } = state;
  const { px, py, style } = command;
  if (!plotInBounds(config, px, py)) {
    return refuse("out_of_bounds", "That plot is outside the world.");
  }
  if (isCommons(state, px, py)) {
    return refuse("plot_is_commons", "The Commons has no home to roof. Roof your own plot.");
  }
  const plot = state.plots[plotKey(px, py)];
  if (!plot || !canBuildOn(plot, actor)) {
    return refuse("not_your_plot", "You can roof only a plot you own or share.");
  }
  if (!isRoofStyle(style)) {
    return refuse("unknown_item", `A roof's style is one of ${ROOF_STYLES.join(", ")}.`);
  }
  const was = plot.roof;
  if (style === "flat") {
    if (!was) return refuse("already_set", "That home has no roof to take down.");
  } else if (!isRoofMaterial(command.material)) {
    return refuse(
      "unknown_item",
      "A roof is covered in a wall or window: a free block, or a material you made.",
    );
  } else if (command.top !== undefined && !isRoofTop(command.top)) {
    return refuse("unknown_item", `A roof wears one of ${ROOF_TOPS.join(", ")} on its ridge.`);
  } else if (was?.style === style && was.material === command.material && was.top === command.top) {
    return refuse("already_set", "That's the roof it has already.");
  }
  const next: PlotRoof | undefined =
    style === "flat"
      ? undefined
      : {
          style,
          material: command.material as BlockKind,
          // Absent leaves the ridge bare, so a `set_roof` from before ridges reads as it did.
          ...(command.top ? { top: command.top } : {}),
        };
  // What a roof covers is read from the walls, so one with nothing under it would draw nothing.
  const wall = (x: number, y: number, floor: number) =>
    holdsRoof(blocksOn(state, floor)[tileKey(x, y)]);
  if (next && !roofSeat(wall, px, py, config.plotSize, plot.floors ?? 0)) {
    return refuse(
      "nothing_under",
      `A roof sits on a home's walls, and this plot has none ${ROOFS.minSpan} tiles across. Build them first.`,
    );
  }
  const change = roofChange(was, next);
  const cost = roofCostProblem(state, actor, change);
  if (cost) return cost;
  return () => {
    if (next) plot.roof = next;
    else delete plot.roof;
    return [
      {
        type: "roof_set",
        px,
        py,
        style,
        ...(next ? { material: next.material } : {}),
        ...(next?.top ? { top: next.top } : {}),
        by: actor,
      },
      ...moveRoofCost(state, actor, change),
    ];
  };
}

/**
 * What changing a roof's covering moves, by kind: a plus comes back to whoever changed it, a minus
 * leaves their things. Changing the style alone, in the same material, moves nothing.
 */
function roofChange(was: PlotRoof | undefined, next: PlotRoof | undefined): [StackKind, number][] {
  const change = new Map<StackKind, number>();
  const add = (roof: PlotRoof, sign: 1 | -1) => {
    for (const [kind, n] of roofNeeds(roof.material)) {
      change.set(kind, (change.get(kind) ?? 0) + sign * n);
    }
  };
  if (was) add(was, 1);
  if (next) add(next, -1);
  return [...change].filter(([, n]) => n !== 0);
}

/** Why `actor` can't pay for a roof's covering, or null: items shut, too few, or no room back. */
function roofCostProblem(
  state: WorldState,
  actor: ResidentId,
  change: [StackKind, number][],
): Rejection | null {
  if (change.length === 0) return null;
  const shut = closed(state);
  if (shut) return shut;
  const inv = state.items?.inventories[actor];
  const short = change.find(([kind, n]) => n < 0 && held(inv, kind) < -n);
  if (short) {
    const [kind, n] = short;
    return refuse(
      "not_enough_items",
      `Covering a roof takes ${countOf(kind, -n)}, and you have ${held(inv, kind)}. Make more at a workbench.`,
    );
  }
  const back = change.reduce((sum, [, n]) => sum + Math.max(0, n), 0);
  const gone = change.reduce((sum, [, n]) => sum + Math.max(0, -n), 0);
  if (back > gone && inventorySize(inv) + back - gone > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things, and a roof coming down gives back ${back}. Make, place, or give something first.`,
    );
  }
  return null;
}

/** The commit side: what a roof's covering took or gave back, with its private event. */
function moveRoofCost(
  state: WorldState,
  actor: ResidentId,
  change: [StackKind, number][],
): WorldEvent[] {
  const items = state.items;
  if (!items || change.length === 0) return [];
  const mine = inventory(items, actor);
  const changes = change.map(([kind, n]) => addStack(mine, kind, n));
  return [inventoryEvent(actor, change.some(([, n]) => n < 0) ? "placed" : "picked_up", changes)];
}
