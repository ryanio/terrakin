import { oneTimeSwitch, refuse } from "./check";
import { edgeKey, edgeTiles, parseEdgeKey } from "./edges";
import { BASE_PLOT, moveCoord } from "./grid";
import { parseKey, tileKey } from "./keys";
import { potKey } from "./pottery";
import { giveBackShown, parseFaceKey, parseTopKey } from "./surfaces";
import type { FloorLayer, Rejection, Side, Tile, WorldEvent, WorldState } from "./types";

/** The plot size a world grows to (RFC 0052). */
export const REGRID = { from: BASE_PLOT, to: 16 } as const;

/**
 * `regrid`, which only TOWN_ACTOR sends (RFC 0052): every plot slot doubles from 8 tiles to 16,
 * and everything on a slot moves to the middle of it, 4 tiles in from each side, so it stands in
 * the slot's first lot with a ring of wild yard around it. Comes once, and only in a world still
 * on 8-tile plots.
 */
export function checkRegrid(state: WorldState): (() => WorldEvent[]) | Rejection {
  if (!state.regridded && state.config.plotSize !== REGRID.from) {
    return refuse("not_eligible", `Only a world of ${REGRID.from}-tile plots is regridded.`);
  }
  if (state.regridded) {
    return refuse("already_open", `This world's plots are already ${REGRID.to} tiles.`);
  }
  return () => {
    const given = regridWorld(state);
    return [{ type: "world_regridded", plotSize: REGRID.to }, ...given];
  };
}

/** A coordinate moved onto the new grid. */
const move = (v: number) => moveCoord(v, REGRID.to);
/** A tile moved onto the new grid. */
const moveTile = <T extends Tile>(t: T): T => ({ ...t, x: move(t.x), y: move(t.y) });
/** A tile key moved onto the new grid. */
const moveTileKey = (key: string) => {
  const [x, y] = parseKey(key);
  return tileKey(move(x), move(y));
};
/** Which slot a coordinate is in on the old grid. */
const slotOf = (v: number) => Math.floor(v / BASE_PLOT);

/**
 * A line moved onto the new grid. A line inside one slot moves with its tiles. A line on the
 * border between two slots (two touching plots of one household) can't stay between both, since
 * the yards now part them: it stays beside its north or west tile, on that tile's far side.
 */
function moveEdgeKey(key: string): string {
  const { x, y, side } = parseEdgeKey(key);
  const [a, b] = edgeTiles(x, y, side);
  const across = side === "n" ? slotOf(a.y) !== slotOf(b.y) : slotOf(a.x) !== slotOf(b.x);
  if (!across) return edgeKey(move(b.x), move(b.y), side);
  return edgeKey(move(a.x), move(a.y), side === "n" ? "s" : "e");
}

/** A grade key (a tile's or a line's) moved onto the new grid. */
const moveGradeKey = (key: string) =>
  key.split(",").length === 3 ? moveEdgeKey(key) : moveTileKey(key);

/** A record's keys moved by `to`, the values kept. */
function rekey<V>(rec: Record<string, V>, to: (key: string) => string): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(rec)) out[to(key)] = value;
  return out;
}

/** The same, for a record that may be absent. */
const rekeyMaybe = <V>(rec: Record<string, V> | undefined, to: (key: string) => string) =>
  rec === undefined ? undefined : rekey(rec, to);

/** A floor's blocks, ground, lines, grades and turns moved onto the new grid. */
function moveLayer(layer: FloorLayer): FloorLayer {
  const edges = rekeyMaybe(layer.edges, moveEdgeKey);
  const grades = rekeyMaybe(layer.grades, moveGradeKey);
  const turns = rekeyMaybe(layer.turns, moveTileKey);
  return {
    blocks: rekey(layer.blocks, moveTileKey),
    ground: rekey(layer.ground, moveTileKey),
    ...(edges ? { edges } : {}),
    ...(grades ? { grades } : {}),
    ...(turns ? { turns } : {}),
  };
}

/** The four straight steps, as (dx, dy). */
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The tiles between a moved tile and the edge of its new slot, toward its old neighbour across a
 * slot border: the gap the yards opened, on this tile's side of it.
 */
function gapToward(t: Tile, dx: number, dy: number): Tile[] {
  const from = { x: move(t.x), y: move(t.y) };
  const out: Tile[] = [];
  const slotX = Math.floor(from.x / REGRID.to);
  const slotY = Math.floor(from.y / REGRID.to);
  for (let i = 1; i < REGRID.to; i++) {
    const x = from.x + dx * i;
    const y = from.y + dy * i;
    if (Math.floor(x / REGRID.to) !== slotX || Math.floor(y / REGRID.to) !== slotY) break;
    out.push({ x, y });
  }
  return out;
}

/** Whether two old tiles are in different slots. */
const crossesSlots = (a: Tile, b: Tile) =>
  slotOf(a.x) !== slotOf(b.x) || slotOf(a.y) !== slotOf(b.y);

/**
 * Moves the whole world onto plot slots of `REGRID.to` tiles: the config and downtown double, and
 * every tile, line, face and key moves with `moveCoord`. Public ways and bridges that ran across a
 * slot border are carried across the yards between, so every way still reaches town and every
 * bridge still lands. A thing hung on a wall face across a slot border goes back to whoever hung
 * it, since its wall stays with the other tile; those events are returned.
 */
export function regridWorld(state: WorldState): WorldEvent[] {
  const scale = REGRID.to / REGRID.from;
  const given: WorldEvent[] = [];
  const oldWays = state.ways ? Object.keys(state.ways).map((k) => parseKey(k)) : [];
  const oldBridges = (state.lands?.list ?? []).map((land) =>
    land.bridge.map(([x, y]) => ({ x, y })),
  );

  state.config = {
    ...state.config,
    plotSize: REGRID.to,
    width: state.config.width * scale,
    height: state.config.height * scale,
  };
  if (state.lands) {
    state.lands.home = {
      width: state.lands.home.width * scale,
      height: state.lands.home.height * scale,
    };
  }

  for (const r of Object.values(state.residents)) {
    r.x = move(r.x);
    r.y = move(r.y);
    if (r.hearth) r.hearth = moveTile(r.hearth);
  }

  state.blocks = rekey(state.blocks, moveTileKey);
  if (state.edges) state.edges = rekey(state.edges, moveEdgeKey);
  if (state.grades) state.grades = rekey(state.grades, moveGradeKey);
  if (state.turns) state.turns = rekey(state.turns, moveTileKey);
  if (state.ground) state.ground = rekey(state.ground, moveTileKey);
  if (state.floors) {
    for (const [floor, layer] of Object.entries(state.floors))
      state.floors[floor] = moveLayer(layer);
  }

  // Public ways, carried across the yards toward any way, bridge, or public slot beside them.
  if (state.ways) {
    const ways = new Set(Object.keys(state.ways));
    const bridges = new Set(oldBridges.flat().map((t) => tileKey(t.x, t.y)));
    const moved: Record<string, true> = {};
    for (const [x, y] of oldWays) {
      moved[tileKey(move(x), move(y))] = true;
      for (const [dx, dy] of STEPS) {
        const n = { x: x + dx, y: y + dy };
        if (!crossesSlots({ x, y }, n)) continue;
        const key = tileKey(n.x, n.y);
        if (!ways.has(key) && !bridges.has(key)) continue;
        for (const t of gapToward({ x, y }, dx, dy)) moved[tileKey(t.x, t.y)] = true;
      }
    }
    state.ways = moved;
  }

  // Bridges, carried across the yards along their run and on to the land at each end.
  if (state.lands) {
    state.lands.list.forEach((land, i) => {
      const old = oldBridges[i] ?? [];
      const on = new Set(old.map((t) => tileKey(t.x, t.y)));
      const out = new Map<string, [number, number]>();
      const add = (t: Tile) => out.set(tileKey(t.x, t.y), [t.x, t.y]);
      for (const t of old) {
        add(moveTile(t));
        for (const [dx, dy] of STEPS) {
          const n = { x: t.x + dx, y: t.y + dy };
          if (!crossesSlots(t, n)) continue;
          // Toward more bridge, or off either end of the run onto land, never sideways into the
          // sea: a bridge runs east and west (`planLand`).
          if (!on.has(tileKey(n.x, n.y)) && dy !== 0) continue;
          for (const g of gapToward(t, dx, dy)) add(g);
        }
      }
      land.bridge = [...out.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    });
  }

  const items = state.items;
  if (items) {
    items.crops = rekey(items.crops, moveTileKey);
    if (items.displays) items.displays = rekey(items.displays, moveTileKey);
    if (items.gathered) items.gathered = rekey(items.gathered, moveTileKey);
    if (items.firings) items.firings = rekey(items.firings, moveTileKey);
    const moveSpotKey = (key: string) => {
      const t = parseTopKey(key);
      return potKey(move(t.x), move(t.y), t.floor);
    };
    if (items.pots) items.pots = rekey(items.pots, moveSpotKey);
    if (items.tops) items.tops = rekey(items.tops, moveSpotKey);
    if (items.hung) {
      const hung: typeof items.hung = {};
      const away: (typeof items.hung)[string][] = [];
      for (const [key, shown] of Object.entries(items.hung)) {
        const f = parseFaceKey(key);
        const [dx, dy] = SIDE_STEP[f.side];
        if (crossesSlots(f, { x: f.x + dx, y: f.y + dy })) {
          away.push(shown);
          continue;
        }
        const floorPart = f.floor === 0 ? "" : `${f.floor}:`;
        hung[`${floorPart}${tileKey(move(f.x), move(f.y))},${f.side}`] = shown;
      }
      items.hung = hung;
      if (Object.keys(hung).length === 0) delete items.hung;
      for (const shown of away) given.push(...giveBackShown(state, shown));
    }
  }

  if (state.town) {
    state.town.built = rekey(state.town.built, moveTileKey);
    for (const p of state.town.proposals) {
      if (p.blocks) p.blocks = p.blocks.map(moveTile);
      if (p.remove) p.remove = p.remove.map(moveTile);
      if (p.ground) p.ground = p.ground.map(moveTile);
      if (p.lift) p.lift = p.lift.map(moveTile);
    }
  }

  if (state.games) {
    for (const table of Object.values(state.games.tables)) table.place = moveTile(table.place);
    for (const done of state.games.finished) done.place = moveTile(done.place);
  }

  state.regridded = true;
  return given;
}

/** One step toward each side, as (dx, dy). */
const SIDE_STEP: Readonly<Record<Side, readonly [number, number]>> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};
