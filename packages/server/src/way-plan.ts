import {
  type BlockKind,
  HOLDING_BLOCKS,
  type OpeningFacts,
  placeOf,
  placeWalk,
  plotKey,
  plotOf,
  type Side,
  starterHome,
  type Tile,
  tileKey,
  type WorldConfig,
  walkTree,
} from "@terrakin/sim";

/**
 * Downtown's public ways, planned ([RFC 0046](../../../docs/rfcs/0046-streets.md), Option 1, by town
 * rule). A pure function of the world's facts: it works out a network of way tiles that joins every
 * claimed plot and the bridge landing to the Commons, and lists exactly which blocks stand in its
 * path and which homes it cuts through. Nothing here writes; `ways.ts` turns a plan into the logged
 * inputs, and `scripts/ways.ts` prints one from the public `GET /v1/world`.
 *
 * The search is greedy, as the RFC's was: from the ground already joined to the Commons, it finds
 * the cheapest unjoined target (a plot, or the bridge landing), lays the tiles of that path as ways,
 * and repeats. A better search may find a smaller network.
 *
 * Every step is side on (north, south, east or west), never diagonal, so no block at a corner, on
 * anyone's land, can ever close a way, and no step crosses a wall on the line between two tiles
 * (RFC 0050). A plot is joined when a tile its hearth's walk reaches on its place has a side,
 * with no such wall on it, on a tile of the network off the place, which is decision 0351's way
 * out with the step taken square. That walk is the sim's own (`placeWalk`, the one `openingsOf` takes), so a
 * corner step inside it may pass a neighbour's open tile, as walking does.
 */

/** What the planner reads, which both the world and the public snapshot carry. */
export interface WayFacts {
  config: WorldConfig;
  /** The walking ground and which plot slots are claimed, as `openings.ts` reads them. */
  openings: OpeningFacts;
  /** Downtown's rectangle, in tiles: ways are laid only there. */
  downtown: { width: number; height: number };
  commons: { px: number; py: number };
  plots: readonly { px: number; py: number; ownerId: string; floors?: number }[];
  townsfolk: ReadonlySet<string>;
  hearths: readonly Tile[];
  /** The ground floor's blocks, by tile key. */
  blocks: ReadonlyMap<string, BlockKind>;
  /**
   * Tiles whose block the town can't clear: a planter with a crop in it, a kiln with a pot in it,
   * or under a display.
   */
  fixed: ReadonlySet<string>;
  /**
   * Ground-floor tiles something hangs facing (RFC 0050), which take no block: a rebuild leaves
   * them open, as it does a hearth. Absent reads as none.
   */
  facing?: ReadonlySet<string>;
  /**
   * Tiles with anything on a floor above them (RFC 0028): a way never runs under an upstairs,
   * where the walls below may be holding it up.
   */
  upstairs: ReadonlySet<string>;
  /** Plots for sale (RFC 0039), by plot key: frozen, so no way crosses one. */
  listed: ReadonlySet<string>;
  /** Tiles already ways. */
  ways: ReadonlySet<string>;
  /** The tiles on downtown's edge where a bridge to the first island arrives. */
  landing: readonly Tile[];
}

/**
 * Where a bridge to the first island arrives downtown: the east edge of downtown, on the two tile
 * rows through the middle of the Commons' plot, as `planLand` lays the bridge.
 */
export function wayLanding(
  config: WorldConfig,
  downtown: { width: number; height: number },
  commons: { px: number; py: number },
): Tile[] {
  const y = commons.py * config.plotSize + Math.floor((config.plotSize - 1) / 2);
  return [
    { x: downtown.width - 1, y },
    { x: downtown.width - 1, y: y + 1 },
  ];
}

/** Knobs of the search, never a rule. */
const WAY_COST = {
  /** A tile on a townsfolk plot's edge ring: the team runs the townsfolk, so these go first. */
  townsfolkEdge: 1,
  /** A tile on a resident's plot's edge ring. */
  residentEdge: 1.5,
  /** A tile inside a plot, off its edge ring, which takes room from the middle of a home. */
  inside: 6,
  /** A tile on a free slot, when free slots are laid too. Free otherwise. */
  free: 0.1,
  /** More for a block the town must clear first and give back. */
  block: 3,
  /**
   * More again for a tile of a home, which the town would have to rebuild: a quarter of it for a
   * wall elsewhere on a plot, a garden's or a yard's.
   */
  wall: 40,
} as const;

export interface WayPlanOptions {
  /**
   * Lay ways across the free slots the network runs over too, so a later claim there can't cut
   * it. On unless set to false (Ryan's answer, 2026-10-22); off, a free slot counts as open
   * ground, as the RFC measured.
   */
  layFree?: boolean;
  /** Other weights for the search, to compare networks. */
  cost?: Partial<Record<keyof typeof WAY_COST, number>>;
}

export interface WayPlan {
  /** Every tile the plan makes a way, north to south, then west to east. */
  tiles: Tile[];
  /** The tiles on each claimed plot, by plot. */
  plots: { px: number; py: number; ownerId: string; townsfolk: boolean; tiles: Tile[] }[];
  /** Tiles laid on free slots (only with `layFree`). */
  free: Tile[];
  /** Blocks standing on way tiles, which the town clears and gives back to the plot's owner. */
  blocks: { x: number; y: number; block: BlockKind; ownerId: string; px: number; py: number }[];
  /**
   * Homes the network cuts through: a wall of the room its hearth stands in is on a way tile. The
   * town rebuilds each so it still closes, with a door onto the way.
   */
  homes: {
    px: number;
    py: number;
    ownerId: string;
    /** The walls on way tiles, which come down. */
    walls: Tile[];
    /**
     * What the town puts up in their place, one tile in toward the hearth, in world tiles: the
     * same blocks, but a door onto the way in one of them.
     */
    rebuild: { x: number; y: number; block: BlockKind }[];
    /** Walls whose tile in toward the hearth couldn't take one, for staff to look at by hand. */
    left: Tile[];
  }[];
  /** Targets the search couldn't join, and why. */
  unjoined: { target: string; why: string }[];
}

/** The four side-on steps, each with the side of the tile it leaves by. */
const STEPS = [
  [0, -1, "n"],
  [1, 0, "e"],
  [0, 1, "s"],
  [-1, 0, "w"],
] as const;

type Target = { name: string; goals: Set<string>; plot?: { px: number; py: number } };

/** Downtown's public way network, worked out from the world's facts. */
export function planWays(facts: WayFacts, options: WayPlanOptions = {}): WayPlan {
  const { config, openings, downtown } = facts;
  const S = config.plotSize;
  const W = { ...WAY_COST, ...options.cost };
  const layFree = options.layFree !== false;
  const owners = new Map(facts.plots.map((p) => [plotKey(p.px, p.py), p]));
  const hearths = new Set(facts.hearths.map((h) => tileKey(h.x, h.y)));
  const inDowntown = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < downtown.width && y < downtown.height;
  const isCommons = (px: number, py: number) => px === facts.commons.px && py === facts.commons.py;
  const onEdge = (x: number, y: number) => {
    const ix = x % S;
    const iy = y % S;
    return ix === 0 || iy === 0 || ix === S - 1 || iy === S - 1;
  };
  // The ground with every block that stops a walker, but with the blocks the town could clear
  // left out, so a path may run through them at a price. What stays an obstacle: the buildings,
  // the sea, and a block the town can't clear.
  const blocked = (x: number, y: number) => {
    const why = openings.ground.obstacle(x, y);
    if (!why) return false;
    if (why !== "block") return true;
    return facts.fixed.has(tileKey(x, y));
  };
  // Every home's tiles: the town rebuilds what a way takes of one, so a way avoids them.
  const homeTiles = new Set<string>();
  for (const h of facts.hearths) {
    const { px, py } = plotOf(config, h.x, h.y);
    if (!owners.has(plotKey(px, py))) continue;
    for (const key of homeOf(facts, h)) homeTiles.add(key);
  }
  const laid = new Set(facts.ways);
  const ways = new Set<string>();
  // A way never crosses a wall on a line between tiles (RFC 0050): two tiles with one between them
  // are never joined, side on.
  const walled = (x: number, y: number, side: Side) => openings.ground.edge?.(x, y, side) ?? false;

  /** Open public ground: the Commons, a free slot (unless laid), or a way, with nothing in the way. */
  const isPublic = (x: number, y: number) => {
    const key = tileKey(x, y);
    if (laid.has(key) || ways.has(key)) return true;
    if (openings.ground.obstacle(x, y)) return false;
    const { px, py } = plotOf(config, x, y);
    if (isCommons(px, py)) return true;
    return !layFree && !openings.claimed(px, py);
  };

  const huts = new Map<string, Set<string>>();
  const onHut = (px: number, py: number, key: string) => {
    let hut = huts.get(plotKey(px, py));
    if (!hut) {
      hut = hutRing(config, px, py);
      huts.set(plotKey(px, py), hut);
    }
    return hut.has(key);
  };

  /** What laying a way on this tile costs, or undefined where none can go. */
  const cost = (x: number, y: number): number | undefined => {
    if (!inDowntown(x, y) || blocked(x, y)) return undefined;
    const key = tileKey(x, y);
    if (laid.has(key) || ways.has(key)) return 0;
    const { px, py } = plotOf(config, x, y);
    if (isCommons(px, py)) return openings.ground.obstacle(x, y) ? undefined : 0;
    const plot = owners.get(plotKey(px, py));
    // A free slot's starter hut stands where `build_starter_home` puts it, door and all, and a
    // way there would leave whoever settles a hut with a gap in its walls (RFC 0046).
    if (!plot) return layFree ? (onHut(px, py, key) ? undefined : W.free) : 0;
    // A plot for sale is frozen, so the network goes round it.
    if (facts.listed.has(plotKey(px, py))) return undefined;
    // A hearth is where a home is, and stays a hearth; stairs, and anything under an upstairs,
    // stay too, since what stands there may be what holds a floor up.
    if (hearths.has(key) || facts.upstairs.has(key)) return undefined;
    if (facts.blocks.get(key) === "stairs") return undefined;
    // A wall holding up an upstairs stays up.
    const block = facts.blocks.get(key);
    if (block && (plot.floors ?? 0) > 0 && HOLDING_BLOCKS.includes(block)) return undefined;
    let c = onEdge(x, y)
      ? facts.townsfolk.has(plot.ownerId)
        ? W.townsfolkEdge
        : W.residentEdge
      : W.inside;
    if (block) c += W.block;
    // Through a home, or along its walls, the town has to rebuild it.
    if (homeTiles.has(key)) c += W.wall;
    else if (block && isWall(block)) c += W.wall / 4;
    return c;
  };

  /** The ground joined to the Commons now: a side-on flood over public ground. */
  const joined = new Set<string>();
  const flood = () => {
    joined.clear();
    const start: Tile[] = [];
    for (let y = facts.commons.py * S; y < (facts.commons.py + 1) * S; y++) {
      for (let x = facts.commons.px * S; x < (facts.commons.px + 1) * S; x++) {
        if (isPublic(x, y)) start.push({ x, y });
      }
    }
    for (const t of start) joined.add(tileKey(t.x, t.y));
    for (let i = 0; i < start.length; i++) {
      const at = start[i] as Tile;
      for (const [dx, dy, side] of STEPS) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (!inDowntown(x, y) || joined.has(tileKey(x, y)) || !isPublic(x, y)) continue;
        if (walled(at.x, at.y, side)) continue;
        joined.add(tileKey(x, y));
        start.push({ x, y });
      }
    }
  };

  // Each place's goals: the tiles off it, side on to a tile its hearths' walk reaches on it. A
  // place is a plot, or one household's touching plots together (decision 0364), named by its
  // first plot north to south, then west to east.
  const targets: Target[] = [];
  for (const place of placesOf(facts)) {
    const plot = place.first;
    if (!inDowntown(plot.px * S, plot.py * S)) continue;
    // The tiles its hearths' walk reaches on its own tiles, where an exit starts (decision 0351).
    const room = new Set(
      placeWalk(facts.openings, place.keys, facts.hearths).map((t) => tileKey(t.x, t.y)),
    );
    const goals = new Set<string>();
    for (const key of room) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      for (const [dx, dy, side] of STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inDowntown(nx, ny) || room.has(tileKey(nx, ny)) || walled(x, y, side)) continue;
        // Off the place, or a tile of its own that its walk doesn't reach (a wall, a garden's
        // block), and no wall on the line between: a way that ends there joins the home through it.
        goals.add(tileKey(nx, ny));
      }
    }
    targets.push({ name: `plot ${plot.px},${plot.py}`, goals, plot });
  }
  if (facts.landing.length > 0) {
    targets.push({
      name: "the bridge landing",
      goals: new Set(facts.landing.map((t) => tileKey(t.x, t.y))),
    });
  }

  const unjoined: WayPlan["unjoined"] = [];
  const done = (t: Target) => [...t.goals].some((g) => joined.has(g));
  flood();
  let open = targets.filter((t) => !done(t));
  while (open.length > 0) {
    const { dist, prev } = search(joined, cost, inDowntown, walled);
    let best: { target: Target; goal: string; d: number } | undefined;
    for (const target of open) {
      for (const goal of target.goals) {
        const d = dist.get(goal);
        if (d === undefined) continue;
        if (!best || d < best.d || (d === best.d && goal < best.goal)) best = { target, goal, d };
      }
    }
    if (!best) {
      for (const t of open) {
        unjoined.push({ target: t.name, why: "nothing the town may clear opens a way to it" });
      }
      break;
    }
    for (let at: string | undefined = best.goal; at && !joined.has(at); at = prev.get(at)) {
      const [x, y] = at.split(",").map(Number) as [number, number];
      const { px, py } = plotOf(config, x, y);
      const onPlot = owners.has(plotKey(px, py));
      if ((onPlot || layFree) && !isCommons(px, py) && !laid.has(at)) ways.add(at);
    }
    flood();
    open = open.filter((t) => !done(t));
  }

  return describe(facts, ways, laid, owners, unjoined);
}

/** The tiles a starter hut takes on plot (`px`, `py`): its walls, its windows, and its door. */
function hutRing(config: WorldConfig, px: number, py: number): Set<string> {
  return new Set(
    starterHome(config, px, py, "wood", "glass", true).blocks.map((b) => tileKey(b.x, b.y)),
  );
}

/** How far from a hearth its home reaches at least: a starter hut's walls stand 2 tiles out. */
const HOME_REACH = 2;

/**
 * A home's tiles, from its hearth: the box `HOME_REACH` tiles around it on its plot, where a
 * starter hut or a design stands; and, when the room the hearth stands in is closed with its doors
 * shut (its walk never reaches the plot's edge), that room and the walls around it, however big.
 */
function homeOf(facts: WayFacts, hearth: Tile): Set<string> {
  const { config, openings } = facts;
  const S = config.plotSize;
  const { px, py } = plotOf(config, hearth.x, hearth.y);
  const onPlot = (x: number, y: number) =>
    x >= px * S && x < (px + 1) * S && y >= py * S && y < (py + 1) * S;
  const out = new Set<string>();
  for (let y = hearth.y - HOME_REACH; y <= hearth.y + HOME_REACH; y++) {
    for (let x = hearth.x - HOME_REACH; x <= hearth.x + HOME_REACH; x++) {
      if (onPlot(x, y)) out.add(tileKey(x, y));
    }
  }
  const shut = {
    config,
    obstacle: (x: number, y: number) =>
      !onPlot(x, y) || facts.blocks.get(tileKey(x, y)) === "door"
        ? ("block" as const)
        : openings.ground.obstacle(x, y),
    ...(openings.ground.edge ? { edge: openings.ground.edge } : {}),
  };
  const room = walkTree(shut, hearth, S);
  const edge = (x: number, y: number) =>
    x === px * S || y === py * S || x === (px + 1) * S - 1 || y === (py + 1) * S - 1;
  if (room.some((t) => edge(t.x, t.y))) return out;
  for (const t of room) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (onPlot(t.x + dx, t.y + dy)) out.add(tileKey(t.x + dx, t.y + dy));
      }
    }
  }
  return out;
}

/**
 * How the town rebuilds a home a way cuts through. Each tile of the home on its hearth's side of
 * the way, beside it, with nothing standing there and no hearth, gets a wall, so the home closes again along the way;
 * and the middle one is a door, so it opens onto the way. The walls are the home's own kind: the
 * most common of the free walls the way took down (wood, stone, or a hedge), or wood.
 */
function rebuildOf(
  facts: WayFacts,
  hearth: Tile,
  home: ReadonlySet<string>,
  onWay: ReadonlySet<string>,
  cut: readonly { x: number; y: number; block: BlockKind }[],
): Pick<WayPlan["homes"][number], "walls" | "rebuild" | "left"> {
  const { config, openings } = facts;
  const hearths = new Set(facts.hearths.map((h) => tileKey(h.x, h.y)));
  // The hearth's side of the way: its walk on its own plot with every way tile in the way. Only
  // that side gets walls and the door, so the door always opens from the hearth onto the way; a
  // part of the home the way cuts off is left as open ground beside it.
  const S = config.plotSize;
  const { px, py } = plotOf(config, hearth.x, hearth.y);
  const side = new Set(
    walkTree(
      {
        config,
        obstacle: (x, y) =>
          x < px * S ||
          y < py * S ||
          x >= (px + 1) * S ||
          y >= (py + 1) * S ||
          onWay.has(tileKey(x, y))
            ? "block"
            : openings.ground.obstacle(x, y),
        ...(openings.ground.edge ? { edge: openings.ground.edge } : {}),
      },
      hearth,
      S,
    ).map((n) => tileKey(n.x, n.y)),
  );
  const counts = new Map<BlockKind, number>();
  for (const b of cut) {
    if (b.block === "wood" || b.block === "stone" || b.block === "leaf") {
      counts.set(b.block, (counts.get(b.block) ?? 0) + 1);
    }
  }
  const kind = ([...counts.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? "wood") as BlockKind;
  const line: Tile[] = [];
  const left: Tile[] = [];
  const tiles = [...home]
    .map((key) => {
      const [x, y] = key.split(",").map(Number) as [number, number];
      return { x, y };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of tiles) {
    const key = tileKey(t.x, t.y);
    if (onWay.has(key) || !side.has(key)) continue;
    const beside = STEPS.some(
      ([dx, dy, s]) =>
        onWay.has(tileKey(t.x + dx, t.y + dy)) && !openings.ground.edge?.(t.x, t.y, s),
    );
    if (!beside) continue;
    // Something standing there closes it already.
    if (facts.blocks.has(key)) continue;
    // A hearth stays a hearth, and the home stays open there for staff to look at. So does a tile
    // something hangs facing, which the sim would refuse a wall on.
    if (hearths.has(key) || facts.facing?.has(key)) {
      left.push(t);
      continue;
    }
    line.push(t);
  }
  const door = line[Math.floor((line.length - 1) / 2)];
  const rebuild = line.map((t) => ({
    ...t,
    block: door && t.x === door.x && t.y === door.y ? ("door" as BlockKind) : kind,
  }));
  return { walls: cut.map(({ x, y }) => ({ x, y })), rebuild, left };
}

/** Whether a block is part of a home's walls: a wall, a window, a hedge, or a door. */
function isWall(block: BlockKind): boolean {
  return HOLDING_BLOCKS.includes(block) || block === "leaf" || block === "door";
}

/**
 * The claimed plots as places, north to south, then west to east: each plot alone, or one
 * household's touching plots, side or corner, together (the sim's `placeOf`, decision 0364). Each
 * place is its plot keys, its first plot north to south, then west to east, naming it.
 */
function placesOf(facts: WayFacts): { keys: Set<string>; first: { px: number; py: number } }[] {
  const sorted = [...facts.plots].sort((a, b) => a.py - b.py || a.px - b.px);
  const placed = new Set<string>();
  const places: { keys: Set<string>; first: { px: number; py: number } }[] = [];
  for (const { px, py } of sorted) {
    if (placed.has(plotKey(px, py))) continue;
    const keys = placeOf(facts.openings, px, py);
    for (const key of keys) placed.add(key);
    places.push({ keys, first: { px, py } });
  }
  return places;
}

/** The cheapest side-on path from the joined ground to every tile, by `cost`. */
function search(
  joined: ReadonlySet<string>,
  cost: (x: number, y: number) => number | undefined,
  inside: (x: number, y: number) => boolean,
  walled: (x: number, y: number, side: Side) => boolean,
): { dist: Map<string, number>; prev: Map<string, string> } {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const heap: [number, string][] = [];
  const push = (d: number, key: string) => {
    heap.push([d, key]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (better(heap[i] as [number, string], heap[p] as [number, string])) {
        [heap[i], heap[p]] = [heap[p] as [number, string], heap[i] as [number, string]];
        i = p;
      } else break;
    }
  };
  const pop = (): [number, string] | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && better(heap[l] as [number, string], heap[m] as [number, string]))
          m = l;
        if (r < heap.length && better(heap[r] as [number, string], heap[m] as [number, string]))
          m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m] as [number, string], heap[i] as [number, string]];
        i = m;
      }
    }
    return top;
  };
  for (const key of joined) {
    dist.set(key, 0);
    push(0, key);
  }
  for (let next = pop(); next; next = pop()) {
    const [d, key] = next;
    if (d > (dist.get(key) ?? Number.POSITIVE_INFINITY)) continue;
    const [x, y] = key.split(",").map(Number) as [number, number];
    for (const [dx, dy, side] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || walled(x, y, side)) continue;
      const step = cost(nx, ny);
      if (step === undefined) continue;
      const nk = tileKey(nx, ny);
      const nd = d + step + 0.001;
      if (nd < (dist.get(nk) ?? Number.POSITIVE_INFINITY)) {
        dist.set(nk, nd);
        prev.set(nk, key);
        push(nd, nk);
      }
    }
  }
  return { dist, prev };
}

/** Ties go north to south, then west to east, so the same world plans the same network. */
function better(a: [number, string], b: [number, string]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  return order(a[1]) < order(b[1]);
}

function order(key: string): number {
  const [x, y] = key.split(",").map(Number) as [number, number];
  return y * 100_000 + x;
}

function describe(
  facts: WayFacts,
  ways: Set<string>,
  laid: ReadonlySet<string>,
  owners: Map<string, { px: number; py: number; ownerId: string }>,
  unjoined: WayPlan["unjoined"],
): WayPlan {
  const { config } = facts;
  const tiles = [...ways]
    .map((key) => {
      const [x, y] = key.split(",").map(Number) as [number, number];
      return { x, y };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const byPlot = new Map<string, WayPlan["plots"][number]>();
  const free: Tile[] = [];
  const blocks: WayPlan["blocks"] = [];
  for (const t of tiles) {
    const { px, py } = plotOf(config, t.x, t.y);
    const plot = owners.get(plotKey(px, py));
    if (!plot) {
      free.push(t);
      continue;
    }
    const key = plotKey(px, py);
    let row = byPlot.get(key);
    if (!row) {
      row = {
        px,
        py,
        ownerId: plot.ownerId,
        townsfolk: facts.townsfolk.has(plot.ownerId),
        tiles: [],
      };
      byPlot.set(key, row);
    }
    row.tiles.push(t);
    const block = facts.blocks.get(tileKey(t.x, t.y));
    if (block) blocks.push({ x: t.x, y: t.y, block, ownerId: plot.ownerId, px, py });
  }
  // A home is cut through when a way, new or laid before, crosses one of its tiles (`homeOf`) and
  // leaves its hearth's side open onto it. Reading the ways laid before too is what lets a plan
  // that stopped partway be run again to finish: a home already rebuilt is closed, so nothing is
  // done to it twice.
  const homes: WayPlan["homes"] = [];
  const onWay = new Set([...laid, ...tiles.map((t) => tileKey(t.x, t.y))]);
  const done = new Set<string>();
  for (const h of facts.hearths) {
    const { px, py } = plotOf(config, h.x, h.y);
    const plot = owners.get(plotKey(px, py));
    if (!plot || done.has(plotKey(px, py))) continue;
    done.add(plotKey(px, py));
    const home = homeOf(facts, h);
    if (![...home].some((key) => onWay.has(key))) continue;
    const cut = blocks.filter((b) => home.has(tileKey(b.x, b.y)) && isWall(b.block));
    const rebuilt = rebuildOf(facts, h, home, onWay, cut);
    if (rebuilt.rebuild.length === 0 && rebuilt.left.length === 0 && cut.length === 0) continue;
    homes.push({ px, py, ownerId: plot.ownerId, ...rebuilt });
  }
  homes.sort((a, b) => a.py - b.py || a.px - b.px);
  const plots = [...byPlot.values()].sort((a, b) => a.py - b.py || a.px - b.px);
  return { tiles, plots, free, blocks, homes, unjoined };
}
