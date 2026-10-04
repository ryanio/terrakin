/**
 * One drawer per kind of home. Each draws a building and its yard onto the brand mark's plot of
 * earth (the slab is drawn first, by art.ts), back to front, from the shapes in iso.ts. The plot is
 * one tile: x and y run 0 to 1, z is up, in tiles.
 *
 * To add a home: write a drawer here, add it to BUILDINGS, and point a persona's `home.building`
 * at it. Keep its silhouette its own (a tower, a dome, a sawtooth roof), since the feed shows it
 * small, and use the persona's color somewhere you'd notice it.
 */
import { PALETTE } from "../brand/logo.ts";
import {
  arch,
  box,
  bush,
  CLAY,
  circle,
  cylinder,
  DARK_WOOD,
  type Drawing,
  dome,
  faces,
  front,
  GLASS,
  gableHouse,
  gear,
  hipRoof,
  level,
  mix,
  pane,
  parasol,
  rect,
  roofOf,
  STONE,
  side,
  sparkle,
  type V3,
  WOOD,
} from "./iso.ts";

/** What a drawer gets: the persona's color, and whether the scene is at night. */
export interface Look {
  accent: string;
  night: boolean;
}

export type BuildingDrawer = (d: Drawing, look: Look) => void;

const INK = PALETTE.ink;
const LIT = PALETTE.sun;
const RESIDENT = {
  sun: "#f2b84b",
  sky: "#7cb9dd",
  leaf: "#86b65f",
  rose: "#ea8a9d",
  plum: "#a98bd8",
} as const;

/** A wavy line of leaves climbing a wall. */
function vine(
  d: Drawing,
  on: (u: number, w: number) => V3,
  u: number,
  w0: number,
  w1: number,
  sway = 0.025,
): void {
  const pts: V3[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const w = w0 + ((w1 - w0) * i) / n;
    pts.push(on(u + Math.sin(i * 1.3) * sway, w));
  }
  d.line(d.path(pts), PALETTE.moss, 0.014, false);
  pts.forEach((p, i) => {
    if (i % 2 === 0 || i === 0) return;
    d.paint(d.dot(p, 0.024, 0.017), i % 4 === 1 ? PALETTE.mossLight : PALETTE.moss);
  });
}

/** A flag on a pole, waving toward +x on a plane facing down-left. */
function flag(
  d: Drawing,
  at: V3,
  height: number,
  size: number,
  fill: string,
  pole = DARK_WOOD.side,
): void {
  const [x, y, z] = at;
  const top = z + height;
  d.piece();
  d.line(d.path([at, [x, y, top]]), pole, 0.02);
  const on = front(y);
  d.fill(
    d.poly([
      on(x, top),
      on(x + size * 0.5, top + size * 0.08),
      on(x + size, top - size * 0.04),
      on(x + size, top - size * 0.5),
      on(x + size * 0.5, top - size * 0.42),
      on(x, top - size * 0.5),
    ]),
    fill,
  );
  d.paint(d.dot([x, y, top + 0.02], 0.022), LIT);
}

// ---------------------------------------------------------------------------
// Juniper: a glass greenhouse on a little cottage, planters out front, vines, a watering can.
// ---------------------------------------------------------------------------

const greenhouse: BuildingDrawer = (d, { accent }) => {
  // The cottage, behind.
  d.piece();
  gableHouse(d, {
    x: [0.12, 0.42],
    y: [0.2, 0.5],
    wall: 0.44,
    rise: 0.26,
    ridge: "y",
    walls: WOOD,
    roof: roofOf(accent),
    rows: 2,
    behind: () => {
      box(d, [0.3, 0.38], [0.24, 0.32], [0.4, 0.86], CLAY);
      d.fill(d.poly(rect(front(0.32), [0.29, 0.39], [0.82, 0.87])), PALETTE.clayDeep);
    },
    onWalls: () => {
      pane(d, front(0.5), [0.21, 0.33], [0.24, 0.36], LIT, { frame: PALETTE.moss, bars: [1, 1] });
      vine(d, front(0.5), 0.15, 0.0, 0.44);
      vine(d, front(0.5), 0.39, 0.0, 0.38, 0.02);
    },
  });
  // The greenhouse, in front: glass walls and roof with white frames, plants inside.
  d.piece();
  const frame = "#ffffff";
  const gx: [number, number] = [0.42, 0.86];
  const gy: [number, number] = [0.3, 0.66];
  gableHouse(d, {
    x: gx,
    y: gy,
    wall: 0.28,
    rise: 0.22,
    ridge: "x",
    walls: GLASS,
    roof: { plane: "#c6e5ed", deep: "#93c6d5" },
    eave: 0.02,
    verge: 0.02,
    onWalls: () => {
      const leaves: [number, number, number][] = [
        [0.47, 0.07, 0.07],
        [0.56, 0.12, 0.08],
        [0.65, 0.07, 0.07],
        [0.74, 0.12, 0.08],
        [0.82, 0.07, 0.05],
      ];
      for (const [u, w, r] of leaves) {
        d.paint(
          d.poly(circle(front(0.66), u, w, r, r * 1.1)),
          mix(PALETTE.moss, GLASS.front, 0.25),
        );
        d.paint(
          d.poly(circle(front(0.66), u - 0.01, w + 0.03, r * 0.5)),
          mix(PALETTE.mossLight, GLASS.front, 0.2),
        );
      }
      for (const [u, w] of [
        [0.51, 0.16],
        [0.69, 0.17],
        [0.6, 0.12],
      ] as const) {
        d.paint(d.poly(circle(front(0.66), u, w, 0.018)), RESIDENT.rose);
      }
      for (const u of [0.53, 0.64, 0.75]) {
        d.paint(d.poly(rect(front(0.66), [u - 0.008, u + 0.008], [0, 0.28])), frame);
      }
      d.paint(d.poly(rect(front(0.66), gx, [0.135, 0.15])), frame);
      for (const u of [0.42, 0.54]) {
        d.paint(d.poly(rect(side(0.86), [u - 0.008, u + 0.008], [0, 0.28])), frame);
      }
      d.paint(d.poly(arch(side(0.86), [0.43, 0.53], 0, 0.18)), mix(GLASS.side, INK, 0.12));
      d.paint(d.poly(circle(side(0.86), 0.51, 0.1, 0.008)), LIT);
    },
  });
  // Frames on the glass roof.
  for (const x of [0.53, 0.64, 0.75]) {
    d.line(
      d.path([
        [x, 0.48, 0.5],
        [x, 0.68, 0.27],
      ]),
      frame,
      0.012,
      false,
    );
  }
  // Planters along the front, with flowers.
  for (const [x0, x1] of [
    [0.44, 0.62],
    [0.67, 0.85],
  ] as const) {
    d.piece();
    box(d, [x0, x1], [0.74, 0.84], [0, 0.08], DARK_WOOD);
    for (let i = 0; i < 3; i++) {
      const x = x0 + 0.03 + i * ((x1 - x0 - 0.06) / 2);
      bush(d, [x, 0.79, 0.06], 0.045);
      d.paint(d.dot([x + 0.01, 0.8, 0.14], 0.016), i % 2 ? LIT : RESIDENT.rose);
    }
  }
  // A watering can by the cottage door.
  d.piece();
  cylinder(d, 0.2, 0.78, 0.055, [0, 0.11], faces(RESIDENT.sky));
  d.line(
    d.path([
      [0.24, 0.8, 0.04],
      [0.34, 0.85, 0.15],
    ]),
    mix(RESIDENT.sky, INK, 0.2),
    0.024,
  );
  d.fill(d.dot([0.345, 0.855, 0.155], 0.03, 0.022), RESIDENT.sky);
  d.line(
    d.path([
      [0.15, 0.78, 0.1],
      [0.18, 0.76, 0.18],
      [0.23, 0.79, 0.12],
    ]),
    mix(RESIDENT.sky, INK, 0.2),
    0.016,
  );
};

// ---------------------------------------------------------------------------
// Bram: a workshop with a sawtooth roof, big double doors, a gear sign, lumber, a sparking stovepipe.
// ---------------------------------------------------------------------------

const workshop: BuildingDrawer = (d, { accent }) => {
  const x: [number, number] = [0.12, 0.82];
  const y: [number, number] = [0.28, 0.66];
  const h = 0.32;
  const r = 0.17;
  const teeth = 3;
  const tooth = (x[1] - x[0]) / teeth;
  // The stovepipe and its sparks, behind the roof.
  d.piece();
  cylinder(d, 0.26, 0.36, 0.035, [0.3, 0.92], faces("#5b554e", "#45403a"));
  box(d, [0.22, 0.3], [0.32, 0.4], [0.92, 0.96], faces("#5b554e", "#45403a"));
  for (const [dx, dy, dz, s] of [
    [0.04, -0.02, 1.06, 0.035],
    [0.1, -0.08, 1.14, 0.028],
    [-0.02, -0.05, 1.18, 0.022],
    [0.12, -0.02, 1.0, 0.02],
  ] as const) {
    sparkle(d, [0.26 + dx, 0.36 + dy, dz], s, LIT);
  }
  // Walls: the front's top edge is the sawtooth. Each tooth is high at its west end.
  d.piece();
  const fy = front(y[1]);
  const top: V3[] = [];
  for (let i = 0; i < teeth; i++) {
    const xa = x[0] + i * tooth;
    top.push(fy(xa, h + r), fy(xa + tooth, h));
  }
  d.fill(d.poly([fy(x[0], 0), fy(x[1], 0), ...top.reverse()]), STONE.front);
  d.fill(d.poly(rect(side(x[1]), y, [0, h])), STONE.side);
  // Stone courses on the front.
  for (const w of [0.1, 0.2])
    d.paint(d.poly(rect(fy, x, [w, w + 0.008])), mix(STONE.front, INK, 0.08));
  // Big double doors.
  const doors: [number, number] = [0.36, 0.62];
  d.paint(d.poly(rect(fy, [doors[0] - 0.02, doors[1] + 0.02], [0, 0.29])), mix(accent, INK, 0.45));
  d.paint(d.poly(rect(fy, doors, [0, 0.27])), DARK_WOOD.front);
  const mid = (doors[0] + doors[1]) / 2;
  d.paint(d.poly(rect(fy, [mid - 0.006, mid + 0.006], [0, 0.27])), DARK_WOOD.side);
  for (const [a, b] of [
    [doors[0], mid],
    [mid, doors[1]],
  ] as const) {
    d.line(d.path([fy(a + 0.02, 0.03), fy(b - 0.02, 0.24)]), DARK_WOOD.side, 0.014, false);
    d.paint(d.poly(rect(fy, [a + 0.01, b - 0.01], [0.13, 0.145])), DARK_WOOD.side);
  }
  pane(d, fy, [0.17, 0.29], [0.12, 0.23], LIT, { frame: DARK_WOOD.side, bars: [1, 0] });
  pane(d, fy, [0.67, 0.78], [0.12, 0.23], LIT, { frame: DARK_WOOD.side, bars: [1, 0] });
  pane(d, side(x[1]), [0.36, 0.58], [0.12, 0.23], LIT, { frame: DARK_WOOD.side, bars: [2, 0] });
  // The sawtooth: roof planes in the persona's color, each with a band of lit skylights.
  const roof = faces(accent);
  for (let i = 0; i < teeth; i++) {
    const xa = x[0] + i * tooth;
    const at = (t: number, yy: number): V3 => [xa + tooth * t, yy, h + r * (1 - t)];
    d.fill(d.poly([at(0, y[0]), at(1, y[0]), at(1, y[1]), at(0, y[1])]), roof.front);
    d.paint(
      d.poly([
        at(0.08, y[0] + 0.04),
        at(0.42, y[0] + 0.04),
        at(0.42, y[1] - 0.04),
        at(0.08, y[1] - 0.04),
      ]),
      DARK_WOOD.side,
    );
    d.paint(
      d.poly([
        at(0.11, y[0] + 0.06),
        at(0.39, y[0] + 0.06),
        at(0.39, y[1] - 0.06),
        at(0.11, y[1] - 0.06),
      ]),
      "#f7d27a",
    );
    for (const t of [0.25, 0.5, 0.75]) {
      const yy = y[0] + (y[1] - y[0]) * t;
      d.paint(
        d.poly([
          at(0.11, yy - 0.006),
          at(0.39, yy - 0.006),
          at(0.39, yy + 0.006),
          at(0.11, yy + 0.006),
        ]),
        DARK_WOOD.side,
      );
    }
  }
  // The gear sign, hanging from a bracket at the front corner.
  d.piece();
  d.line(
    d.path([
      [x[1], y[1] - 0.02, h - 0.02],
      [x[1] + 0.13, y[1] - 0.02, h - 0.02],
    ]),
    INK,
    0.016,
  );
  d.line(
    d.path([
      [x[1] + 0.1, y[1] - 0.02, h - 0.02],
      [x[1] + 0.1, y[1] - 0.02, h - 0.06],
    ]),
    INK,
    0.01,
  );
  gear(d, front(y[1] - 0.02), x[1] + 0.1, h - 0.15, 0.095, LIT, mix(LIT, INK, 0.45));
  // A stack of lumber at the front.
  for (const [layer, z, dx] of [
    [0, 0, 0],
    [1, 0.035, 0.02],
    [2, 0.07, 0.04],
  ] as const) {
    d.piece();
    for (const yy of [0.75, 0.8, 0.85].slice(0, 3 - layer)) {
      box(d, [0.1 + dx, 0.42 + dx], [yy, yy + 0.045], [z, z + 0.035], WOOD);
    }
  }
  // A crate by the doors.
  d.piece();
  box(d, [0.66, 0.78], [0.72, 0.82], [0, 0.1], faces("#d9b07a", "#b98e58"));
  d.line(
    d.path([
      [0.66, 0.82, 0.0],
      [0.78, 0.82, 0.1],
    ]),
    "#b98e58",
    0.01,
    false,
  );
};

// ---------------------------------------------------------------------------
// Clem: a corner cafe with striped awnings, parasol tables, a chalkboard and string lights.
// ---------------------------------------------------------------------------

const cafe: BuildingDrawer = (d, { accent }) => {
  const x: [number, number] = [0.14, 0.58];
  const y: [number, number] = [0.14, 0.54];
  const h = 0.58;
  const plaster = faces("#f6e6d2", "#dcc3a6");
  const deep = mix(accent, INK, 0.3);
  d.piece();
  box(d, x, y, [0, h], plaster);
  // Cornice and roof.
  box(d, [x[0] - 0.02, x[1] + 0.02], [y[0] - 0.02, y[1] + 0.02], [h, h + 0.05], DARK_WOOD);
  d.paint(
    d.poly(rect(level(h + 0.05), [x[0] + 0.02, x[1] - 0.02], [y[0] + 0.02, y[1] - 0.02])),
    "#d9b994",
  );
  // Upstairs windows with flower boxes.
  const fy = front(y[1]);
  for (const u of [0.2, 0.4]) {
    pane(d, fy, [u, u + 0.12], [0.38, 0.5], LIT, {
      frame: "#ffffff",
      bars: [1, 1],
      bar: "#ffffff",
    });
    d.paint(d.poly(rect(fy, [u - 0.01, u + 0.13], [0.355, 0.38])), deep);
  }
  for (const u of [0.2, 0.38]) {
    pane(d, side(x[1]), [u, u + 0.12], [0.38, 0.5], LIT, {
      frame: "#ffffff",
      bars: [1, 1],
      bar: "#ffffff",
    });
  }
  // Shop windows and the door.
  pane(d, fy, [0.18, 0.36], [0.06, 0.26], LIT, { frame: DARK_WOOD.side, bars: [1, 0] });
  d.paint(d.poly(rect(fy, [0.41, 0.53], [0, 0.28])), DARK_WOOD.front);
  pane(d, fy, [0.43, 0.51], [0.12, 0.25], LIT, { frame: DARK_WOOD.side });
  pane(d, side(x[1]), [0.18, 0.5], [0.06, 0.26], LIT, { frame: DARK_WOOD.side, bars: [2, 0] });
  // The sign on the roof: a big cup of coffee, steaming.
  d.piece();
  const sg = front(0.36);
  const base = h + 0.05;
  d.line(d.path([sg(0.3, base), sg(0.3, base + 0.06)]), INK, 0.014);
  d.line(d.path([sg(0.44, base), sg(0.44, base + 0.06)]), INK, 0.014);
  d.fill(d.poly(circle(sg, 0.37, base + 0.07, 0.13, 0.025)), PALETTE.paper);
  d.fill(d.poly(circle(sg, 0.5, base + 0.17, 0.05, 0.055)), accent);
  d.paint(d.poly(circle(sg, 0.5, base + 0.17, 0.025, 0.03)), PALETTE.paper);
  d.fill(
    d.poly(
      [sg(0.27, base + 0.27), sg(0.47, base + 0.27), sg(0.44, base + 0.08), sg(0.3, base + 0.08)],
      1,
    ),
    accent,
  );
  d.paint(
    d.poly([
      sg(0.35, base + 0.2),
      sg(0.37, base + 0.16),
      sg(0.39, base + 0.2),
      sg(0.37, base + 0.22),
    ]),
    PALETTE.paper,
  );
  d.paint(d.poly(circle(sg, 0.37, base + 0.27, 0.1, 0.018)), "#6b4a35");
  for (const u of [0.33, 0.41]) {
    d.line(
      d.path([
        sg(u, base + 0.31),
        sg(u + 0.02, base + 0.35),
        sg(u - 0.01, base + 0.39),
        sg(u + 0.01, base + 0.43),
      ]),
      "#ffffff",
      0.016,
      false,
    );
  }
  // Striped awnings over both street fronts.
  const stripes = 6;
  const drop = 0.1;
  const z0 = 0.34;
  const z1 = 0.25;
  d.piece();
  for (let i = 0; i < stripes; i++) {
    const a = y[0] + ((y[1] - y[0]) * i) / stripes;
    const b = y[0] + ((y[1] - y[0]) * (i + 1)) / stripes;
    const color = i % 2 ? PALETTE.paperEdge : deep;
    d.fill(
      d.poly([
        [x[1], a, z0],
        [x[1], b, z0],
        [x[1] + drop, b, z1],
        [x[1] + drop, a, z1],
      ]),
      color,
    );
    d.fill(
      d.poly(circle(side(x[1] + drop), (a + b) / 2, z1, (b - a) / 2, 0.03, 0, -Math.PI, 8)),
      color,
    );
  }
  d.piece();
  for (let i = 0; i < stripes; i++) {
    const a = x[0] + ((x[1] - x[0]) * i) / stripes;
    const b = x[0] + ((x[1] - x[0]) * (i + 1)) / stripes;
    const color = i % 2 ? PALETTE.paper : accent;
    d.fill(
      d.poly([
        [a, y[1], z0],
        [b, y[1], z0],
        [b, y[1] + drop, z1],
        [a, y[1] + drop, z1],
      ]),
      color,
    );
    d.fill(
      d.poly(circle(front(y[1] + drop), (a + b) / 2, z1, (b - a) / 2, 0.03, 0, -Math.PI, 8)),
      color,
    );
  }
  // String lights along both fronts, above the awnings.
  d.piece(false);
  const strand = (from: V3, to: V3) => {
    const pts: V3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t - Math.sin(Math.PI * t) * 0.07,
      ]);
    }
    d.line(d.path(pts), INK, 0.006, false);
    for (let i = 1; i < 12; i += 2) {
      const p = pts[i];
      if (p) d.paint(d.dot([p[0], p[1], p[2] - 0.015], 0.02), i % 4 === 1 ? LIT : "#fff1c2");
    }
  };
  strand([x[0], y[1] + 0.01, 0.56], [x[1] + 0.01, y[1] + 0.01, 0.56]);
  strand([x[1] + 0.01, y[1] + 0.01, 0.56], [x[1] + 0.01, y[0], 0.56]);
  // A chalkboard sign out front.
  d.piece();
  const cb = front(0.7);
  d.line(d.path([cb(0.06, 0), cb(0.09, 0.2)]), DARK_WOOD.side, 0.016);
  d.line(d.path([cb(0.22, 0), cb(0.19, 0.2)]), DARK_WOOD.side, 0.016);
  d.fill(d.poly(rect(cb, [0.07, 0.21], [0.05, 0.21])), DARK_WOOD.front);
  d.paint(d.poly(rect(cb, [0.085, 0.195], [0.065, 0.195])), "#3c4a42");
  for (const [w, len] of [
    [0.17, 0.08],
    [0.135, 0.06],
    [0.1, 0.07],
  ] as const) {
    d.line(d.path([cb(0.1, w), cb(0.1 + len, w)]), "#fff4dd", 0.008, false);
  }
  // Tables under parasols.
  const table = (cx: number, cy: number) => {
    d.piece();
    for (const [dx, dy] of [
      [-0.07, 0.03],
      [0.05, 0.06],
    ] as const) {
      cylinder(d, cx + dx, cy + dy, 0.024, [0, 0.06], faces(DARK_WOOD.front));
    }
    d.line(
      d.path([
        [cx, cy, 0],
        [cx, cy, 0.1],
      ]),
      INK,
      0.014,
    );
    cylinder(d, cx, cy, 0.05, [0.095, 0.11], DARK_WOOD);
    d.piece();
    d.line(
      d.path([
        [cx, cy, 0.1],
        [cx, cy, 0.3],
      ]),
      INK,
      0.012,
    );
    parasol(d, cx, cy, 0.15, 0.27, 0.07, [accent, PALETTE.paper]);
  };
  table(0.84, 0.48);
  table(0.44, 0.82);
};

// ---------------------------------------------------------------------------
// Pip: a little post office with an envelope sign, a flag, a pillar box, a bike and parcels.
// ---------------------------------------------------------------------------

const postOffice: BuildingDrawer = (d, { accent }) => {
  const x: [number, number] = [0.16, 0.62];
  const y: [number, number] = [0.2, 0.58];
  const wall = 0.38;
  const rise = 0.28;
  const xm = (x[0] + x[1]) / 2;
  const walls = faces("#f4e9d6", "#d8c6a8");
  d.piece();
  gableHouse(d, {
    x,
    y,
    wall,
    rise,
    ridge: "y",
    walls,
    roof: roofOf(accent),
    rows: 2,
    onWalls: () => {
      const fy = front(y[1]);
      // The envelope sign in the gable.
      const ew = 0.075;
      const ez = 0.47;
      d.paint(
        d.poly(rect(fy, [xm - ew - 0.015, xm + ew + 0.015], [ez - 0.065, ez + 0.065]), 1),
        mix(accent, INK, 0.3),
      );
      d.paint(d.poly(rect(fy, [xm - ew, xm + ew], [ez - 0.05, ez + 0.05])), "#ffffff");
      d.line(
        d.path([fy(xm - ew, ez + 0.05), fy(xm, ez - 0.005), fy(xm + ew, ez + 0.05)]),
        INK,
        0.01,
        false,
      );
      d.paint(d.poly(circle(fy, xm, ez - 0.005, 0.018)), PALETTE.clay);
      d.paint(d.poly(arch(fy, [xm - 0.06, xm + 0.06], 0, 0.2)), mix(accent, INK, 0.25));
      d.paint(d.poly(circle(fy, xm + 0.035, 0.12, 0.009)), LIT);
      pane(d, fy, [0.2, 0.29], [0.12, 0.26], LIT, {
        frame: "#ffffff",
        bars: [1, 1],
        bar: "#ffffff",
      });
      pane(d, fy, [0.49, 0.58], [0.12, 0.26], LIT, {
        frame: "#ffffff",
        bars: [1, 1],
        bar: "#ffffff",
      });
      pane(d, side(x[1]), [0.28, 0.5], [0.12, 0.26], LIT, {
        frame: "#ffffff",
        bars: [2, 1],
        bar: "#ffffff",
      });
    },
  });
  flag(d, [xm, y[1] + 0.02, wall + rise - 0.03], 0.3, 0.2, accent);
  // Parcels stacked by the side wall.
  d.piece();
  const kraft = faces("#d9b07a", "#b98e58");
  box(d, [0.64, 0.78], [0.3, 0.42], [0, 0.11], kraft);
  box(d, [0.66, 0.76], [0.31, 0.4], [0.11, 0.19], kraft);
  box(d, [0.64, 0.74], [0.45, 0.53], [0, 0.07], kraft);
  for (const [xx, yy, z0, z1] of [
    [0.71, 0.42, 0, 0.11],
    [0.71, 0.4, 0.11, 0.19],
  ] as const) {
    d.line(
      d.path([
        [xx, yy, z0],
        [xx, yy, z1],
      ]),
      "#8f6a3e",
      0.008,
      false,
    );
  }
  // The pillar box.
  d.piece();
  const mb = { cx: 0.8, cy: 0.66, r: 0.07 };
  const boxBlue = mix(accent, INK, 0.3);
  cylinder(d, mb.cx, mb.cy, mb.r, [0, 0.24], faces(boxBlue));
  cylinder(d, mb.cx, mb.cy, mb.r * 1.15, [0.22, 0.25], faces(mix(boxBlue, INK, 0.25)));
  dome(d, mb.cx, mb.cy, mb.r * 1.05, 0.25, boxBlue, mix(boxBlue, INK, 0.2), mb.r * 0.8);
  const face = front(mb.cy + mb.r * 0.72);
  d.paint(d.poly(rect(face, [mb.cx - 0.02, mb.cx + 0.07], [0.18, 0.195])), INK);
  d.paint(d.poly(rect(face, [mb.cx - 0.02, mb.cx + 0.06], [0.07, 0.13])), "#ffffff");
  d.line(
    d.path([face(mb.cx - 0.02, 0.13), face(mb.cx + 0.02, 0.1), face(mb.cx + 0.06, 0.13)]),
    INK,
    0.008,
    false,
  );
  cylinder(d, mb.cx, mb.cy, mb.r * 1.12, [0, 0.025], faces(mix(boxBlue, INK, 0.3)));
  // The bike, leaning out front.
  d.piece();
  const bk = front(0.8);
  const wheel = 0.075;
  const back = 0.14;
  const fwd = 0.38;
  for (const u of [back, fwd]) {
    d.line(d.poly(circle(bk, u, wheel, wheel, wheel, 0, Math.PI * 2, 20)), INK, 0.02);
  }
  const frameColor = PALETTE.clay;
  const seat = bk(0.22, 0.2);
  const bar = bk(0.33, 0.21);
  const crank = bk(0.25, wheel);
  d.line(d.path([bk(back, wheel), seat, crank, bk(back, wheel)]), frameColor, 0.018);
  d.line(d.path([seat, bar, crank]), frameColor, 0.018);
  d.line(d.path([bar, bk(fwd, wheel)]), frameColor, 0.018);
  d.line(d.path([bk(0.2, 0.22), bk(0.25, 0.22)]), INK, 0.022);
  d.line(d.path([bar, bk(0.34, 0.25), bk(0.38, 0.26)]), INK, 0.014);
  // A basket with a letter.
  d.fill(d.poly(rect(bk, [0.37, 0.46], [0.17, 0.23])), DARK_WOOD.front);
  d.paint(d.poly(rect(bk, [0.39, 0.45], [0.215, 0.26])), "#ffffff");
};

// ---------------------------------------------------------------------------
// Otis: a tall narrow book house, a chimney of stacked books, a round reading window, a lantern.
// ---------------------------------------------------------------------------

const library: BuildingDrawer = (d, { accent }) => {
  const x: [number, number] = [0.34, 0.66];
  const y: [number, number] = [0.3, 0.6];
  const wall = 0.88;
  const books = [PALETTE.clay, RESIDENT.sky, LIT, RESIDENT.leaf, accent];
  d.piece();
  gableHouse(d, {
    x,
    y,
    wall,
    rise: 0.34,
    ridge: "x",
    walls: faces("#efe2cc", "#d3bf9e"),
    roof: roofOf(accent),
    rows: 3,
    behind: () => {
      // The chimney: a stack of books, each a little askew.
      books.forEach((color, i) => {
        const z = 1.04 + i * 0.075;
        const off = [0, 0.015, -0.01, 0.012, -0.004][i] ?? 0;
        const f = faces(color);
        box(d, [0.41 + off, 0.53 + off], [0.34 - off, 0.44 - off], [z, z + 0.07], {
          ...f,
          top: PALETTE.paper,
        });
        d.paint(
          d.poly(rect(front(0.44 - off), [0.41 + off, 0.53 + off], [z + 0.03, z + 0.04])),
          mix(color, "#ffffff", 0.5),
        );
      });
      for (const [dx, dz, r] of [
        [0.04, 1.48, 0.04],
        [0.1, 1.58, 0.03],
      ] as const) {
        d.paint(d.dot([0.47 + dx, 0.39 - dx, dz], r), PALETTE.dusk);
      }
    },
    onWalls: () => {
      const fy = front(y[1]);
      // Timber bands between floors.
      for (const w of [0.32, 0.58])
        d.paint(d.poly(rect(fy, x, [w, w + 0.02])), mix(accent, INK, 0.35));
      // The round reading window.
      d.paint(d.poly(circle(fy, 0.5, 0.7, 0.092)), mix(accent, INK, 0.35));
      d.paint(d.poly(circle(fy, 0.5, 0.7, 0.074)), LIT);
      d.paint(d.poly(rect(fy, [0.494, 0.506], [0.626, 0.774])), mix(accent, INK, 0.35));
      d.paint(d.poly(rect(fy, [0.426, 0.574], [0.694, 0.706])), mix(accent, INK, 0.35));
      // A window of book spines.
      d.paint(d.poly(rect(fy, [0.39, 0.61], [0.4, 0.54])), mix(accent, INK, 0.35));
      d.paint(d.poly(rect(fy, [0.405, 0.595], [0.415, 0.525])), "#fbe3a8");
      let u = 0.41;
      let i = 0;
      while (u < 0.585) {
        const wide = 0.016 + ((i * 7) % 3) * 0.004;
        const tall = 0.07 + ((i * 5) % 3) * 0.012;
        d.paint(
          d.poly(rect(fy, [u, Math.min(u + wide, 0.59)], [0.42, 0.42 + tall])),
          books[i % books.length] ?? LIT,
        );
        u += wide + 0.004;
        i++;
      }
      // Lower window and the door on the gable end.
      pane(d, fy, [0.42, 0.58], [0.1, 0.24], LIT, { frame: mix(accent, INK, 0.35), bars: [1, 1] });
      d.paint(d.poly(arch(side(x[1]), [0.39, 0.51], 0, 0.2)), mix(accent, INK, 0.2));
      d.paint(d.poly(circle(side(x[1]), 0.49, 0.12, 0.008)), LIT);
      pane(d, side(x[1]), [0.4, 0.5], [0.42, 0.54], LIT, {
        frame: mix(accent, INK, 0.35),
        bars: [1, 0],
      });
    },
  });
  // The lantern on a bracket by the door.
  d.piece();
  const lx = x[1] + 0.06;
  d.line(
    d.path([
      [x[1], 0.36, 0.34],
      [lx, 0.36, 0.34],
      [lx, 0.36, 0.31],
    ]),
    INK,
    0.012,
  );
  d.paint(d.dot([lx, 0.36, 0.25], 0.09), LIT, 0.28);
  d.fill(d.poly(rect(front(0.36), [lx - 0.025, lx + 0.025], [0.2, 0.3])), LIT);
  d.fill(
    d.poly([
      [lx - 0.035, 0.36, 0.3],
      [lx + 0.035, 0.36, 0.3],
      [lx, 0.36, 0.34],
    ]),
    INK,
  );
  d.paint(d.poly(rect(front(0.36), [lx - 0.03, lx + 0.03], [0.19, 0.205])), INK);
  // A pile of books on the step, and a bush.
  d.piece();
  books.slice(0, 3).forEach((color, i) => {
    const off = [0, 0.02, -0.01][i] ?? 0;
    box(d, [0.16 + off, 0.3 + off], [0.72 - off, 0.82 - off], [i * 0.045, i * 0.045 + 0.042], {
      ...faces(color),
      top: PALETTE.paper,
    });
  });
  d.piece();
  bush(d, [0.78, 0.82, 0], 0.07);
};

// ---------------------------------------------------------------------------
// Marlo: a lookout tower on stilts, a ladder, a flag, a spyglass, a map table below.
// ---------------------------------------------------------------------------

const lookout: BuildingDrawer = (d, { accent }) => {
  const deck = 0.52;
  const leg = 0.035;
  const legs: [number, number][] = [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.3, 0.7],
    [0.7, 0.7],
  ];
  // Stilts and braces.
  for (const [lx, ly] of legs.slice(0, 3)) {
    d.piece();
    box(d, [lx - leg, lx + leg], [ly - leg, ly + leg], [0, deck], DARK_WOOD);
  }
  d.piece();
  d.line(
    d.path([
      [0.3, 0.7, 0.05],
      [0.7, 0.7, deck - 0.04],
    ]),
    DARK_WOOD.side,
    0.018,
  );
  d.line(
    d.path([
      [0.7, 0.3, 0.05],
      [0.7, 0.7, deck - 0.04],
    ]),
    DARK_WOOD.side,
    0.018,
  );
  d.line(
    d.path([
      [0.3, 0.7, deck - 0.04],
      [0.7, 0.7, 0.05],
    ]),
    DARK_WOOD.side,
    0.018,
  );
  d.line(
    d.path([
      [0.7, 0.3, deck - 0.04],
      [0.7, 0.7, 0.05],
    ]),
    DARK_WOOD.side,
    0.018,
  );
  d.piece();
  box(d, [0.7 - leg, 0.7 + leg], [0.7 - leg, 0.7 + leg], [0, deck], DARK_WOOD);
  // The deck and the cabin.
  d.piece();
  box(d, [0.24, 0.76], [0.24, 0.76], [deck, deck + 0.05], WOOD);
  d.piece();
  const c: [number, number] = [0.34, 0.66];
  box(d, c, c, [deck + 0.05, deck + 0.38], WOOD);
  pane(d, front(c[1]), [0.39, 0.61], [deck + 0.16, deck + 0.31], "#cfeaf2", {
    frame: DARK_WOOD.side,
    bars: [1, 0],
  });
  pane(d, side(c[1]), [0.39, 0.61], [deck + 0.16, deck + 0.31], "#cfeaf2", {
    frame: DARK_WOOD.side,
    bars: [1, 0],
  });
  d.piece();
  hipRoof(d, c, c, deck + 0.38, 0.22, roofOf(accent), 0.06);
  flag(d, [0.5, 0.5, deck + 0.58], 0.24, 0.2, PALETTE.clay);
  // The railing along the front edges.
  d.piece();
  const rail = deck + 0.13;
  for (const t of [0.26, 0.42, 0.58, 0.74]) {
    d.line(
      d.path([
        [t, 0.75, deck + 0.05],
        [t, 0.75, rail],
      ]),
      DARK_WOOD.side,
      0.012,
    );
    d.line(
      d.path([
        [0.75, t, deck + 0.05],
        [0.75, t, rail],
      ]),
      DARK_WOOD.side,
      0.012,
    );
  }
  d.line(
    d.path([
      [0.25, 0.75, rail],
      [0.75, 0.75, rail],
      [0.75, 0.25, rail],
    ]),
    DARK_WOOD.front,
    0.016,
  );
  // The spyglass, on a little tripod at the corner, pointing out over the map.
  d.piece();
  d.line(
    d.path([
      [0.68, 0.66, deck + 0.05],
      [0.7, 0.66, deck + 0.18],
    ]),
    INK,
    0.012,
  );
  d.line(
    d.path([
      [0.62, 0.7, deck + 0.15],
      [0.92, 0.6, deck + 0.3],
    ]),
    mix(LIT, INK, 0.3),
    0.06,
  );
  d.line(
    d.path([
      [0.76, 0.65, deck + 0.22],
      [0.92, 0.6, deck + 0.3],
    ]),
    LIT,
    0.05,
  );
  d.fill(d.dot([0.93, 0.6, deck + 0.305], 0.035), "#cfeaf2");
  // The ladder.
  d.piece();
  const foot = 0.94;
  for (const lx of [0.42, 0.56]) {
    d.line(
      d.path([
        [lx, foot, 0],
        [lx, 0.76, deck + 0.12],
      ]),
      DARK_WOOD.front,
      0.018,
    );
  }
  for (let i = 1; i <= 5; i++) {
    const t = i / 6;
    const yy = foot + (0.76 - foot) * t;
    const z = (deck + 0.12) * t;
    d.line(
      d.path([
        [0.42, yy, z],
        [0.56, yy, z],
      ]),
      DARK_WOOD.front,
      0.012,
    );
  }
  // The map table.
  d.piece();
  for (const [tx, ty] of [
    [0.1, 0.62],
    [0.1, 0.84],
    [0.28, 0.84],
  ] as const) {
    d.line(
      d.path([
        [tx, ty, 0],
        [tx, ty, 0.11],
      ]),
      DARK_WOOD.side,
      0.014,
    );
  }
  box(d, [0.08, 0.3], [0.6, 0.86], [0.1, 0.125], WOOD);
  const map = level(0.126);
  d.paint(d.poly(rect(map, [0.11, 0.27], [0.63, 0.83])), PALETTE.paper);
  d.line(
    d.path([map(0.13, 0.66), map(0.18, 0.72), map(0.15, 0.78), map(0.24, 0.8)]),
    RESIDENT.sky,
    0.012,
    false,
  );
  d.line(d.path([map(0.2, 0.66), map(0.25, 0.7)]), PALETTE.clay, 0.012, false);
  d.line(d.path([map(0.25, 0.66), map(0.2, 0.7)]), PALETTE.clay, 0.012, false);
};

// ---------------------------------------------------------------------------
// Sable: a hill house with an observatory dome and a telescope.
// ---------------------------------------------------------------------------

/** A grassy mound, painted on the plot without an outline. */
function hill(d: Drawing, cx: number, cy: number, r: number, height: number): void {
  const [x, y] = d.at([cx, cy, 0]);
  const rx = r * 40 * Math.SQRT2;
  const up = height * 40 * 1.25;
  const arc = (t0: number, t1: number, ry: number, n = 24): [number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / n;
      return [x + rx * Math.cos(t), y + ry * Math.sin(t)];
    });
  d.paint(
    d.flat([...arc(Math.PI, 2 * Math.PI, up), ...arc(0, Math.PI, rx / 2)]),
    mix(PALETTE.mossLight, PALETTE.moss, 0.35),
  );
  d.paint(
    d.flat([...arc(Math.PI, 2 * Math.PI, up * 0.92), ...arc(0, Math.PI, rx * 0.36)]),
    mix(PALETTE.mossLight, "#ffffff", 0.1),
  );
}

const observatory: BuildingDrawer = (d, { accent }) => {
  // The hill.
  d.piece(false);
  hill(d, 0.48, 0.48, 0.42, 0.2);
  // The tower and its dome.
  d.piece();
  const t = { cx: 0.4, cy: 0.4, r: 0.17 };
  cylinder(d, t.cx, t.cy, t.r, [0.06, 0.6], STONE);
  for (const z of [0.2, 0.34, 0.48]) {
    d.paint(
      d.poly([
        ...circle(level(z), t.cx, t.cy, t.r, t.r, (3 * Math.PI) / 4, -Math.PI / 4, 24),
        ...circle(level(z + 0.012), t.cx, t.cy, t.r, t.r, -Math.PI / 4, (3 * Math.PI) / 4, 24),
      ]),
      mix(STONE.side, INK, 0.08),
    );
  }
  pane(d, front(t.cy + t.r * 0.98), [t.cx - 0.03, t.cx + 0.03], [0.36, 0.46], LIT, {
    frame: mix(accent, "#ffffff", 0.2),
  });
  d.piece();
  const silver = "#d7dbe6";
  dome(d, t.cx, t.cy, t.r * 1.12, 0.58, silver, "#a9afc2", t.r * 1.3);
  // The slit, open toward the sky, and the telescope poking out.
  const [sx, sy] = d.at([t.cx, t.cy, 0.6]);
  const up = t.r * 1.3 * 40 * 1.25;
  d.paint(
    d.flat([
      [sx + 2, sy + 4],
      [sx + 9, sy + 3],
      [sx + 6, sy - up + 1],
      [sx - 1, sy - up + 2],
    ]),
    "#2d3350",
  );
  d.piece();
  d.line(
    d.path([
      [t.cx + 0.02, t.cy + 0.02, 0.7],
      [t.cx + 0.2, t.cy - 0.14, 1.02],
    ]),
    mix(LIT, INK, 0.3),
    0.06,
  );
  d.line(
    d.path([
      [t.cx + 0.1, t.cy - 0.06, 0.84],
      [t.cx + 0.2, t.cy - 0.14, 1.02],
    ]),
    LIT,
    0.05,
  );
  // The little house in front, on the slope.
  d.piece();
  gableHouse(d, {
    x: [0.5, 0.8],
    y: [0.5, 0.78],
    base: 0.04,
    wall: 0.26,
    rise: 0.17,
    ridge: "x",
    walls: STONE,
    roof: { plane: accent, deep: mix(accent, "#000000", 0.35) },
    rows: 1,
    behind: () => {
      box(d, [0.56, 0.62], [0.55, 0.6], [0.3, 0.55], CLAY);
    },
    onWalls: () => {
      pane(d, front(0.78), [0.56, 0.72], [0.12, 0.22], LIT, {
        frame: mix(accent, "#ffffff", 0.2),
        bars: [1, 1],
      });
      d.paint(d.poly(arch(side(0.8), [0.58, 0.68], 0.04, 0.2)), mix(accent, "#ffffff", 0.2));
    },
  });
  // A glow from the windows, and stars caught on the dome.
  sparkle(d, [t.cx - 0.04, t.cy - 0.12, 1.02], 0.03, "#ffffff");
};

// ---------------------------------------------------------------------------
// Ansel: an atelier with a huge north window, an easel out front, and paint everywhere.
// ---------------------------------------------------------------------------

const atelier: BuildingDrawer = (d, { accent }) => {
  const x: [number, number] = [0.14, 0.64];
  const y: [number, number] = [0.18, 0.6];
  const low = 0.4;
  const high = 0.8;
  const walls = faces(accent, mix(accent, INK, 0.13));
  const splash = [RESIDENT.rose, RESIDENT.sky, LIT, RESIDENT.leaf, RESIDENT.plum];
  // A stovepipe at the back.
  d.piece();
  cylinder(d, 0.24, 0.26, 0.03, [0.4, 0.66], faces("#5b554e", "#45403a"));
  d.paint(d.dot([0.27, 0.22, 0.74], 0.035), PALETTE.dusk);
  d.piece();
  const fy = front(y[1]);
  d.fill(d.poly([fy(x[0], 0), fy(x[1], 0), fy(x[1], high), fy(x[0], low)]), walls.front);
  d.fill(d.poly(rect(side(x[1]), y, [0, high])), walls.side);
  // The big north window: the whole tall wall, in panes.
  pane(d, side(x[1]), [y[0] + 0.04, y[1] - 0.04], [0.06, high - 0.06], "#cfe8ef", {
    frame: INK,
    bars: [2, 3],
    bar: INK,
  });
  d.paint(d.poly(rect(side(x[1]), [y[0] + 0.07, y[0] + 0.1], [0.1, high - 0.1])), "#ffffff", 0.7);
  // Door, a round window, and paint on the walls.
  d.paint(d.poly(arch(fy, [0.2, 0.32], 0, 0.21)), PALETTE.clay);
  d.paint(d.poly(circle(fy, 0.3, 0.1, 0.009)), LIT);
  d.paint(d.poly(circle(fy, 0.48, 0.42, 0.07)), INK);
  d.paint(d.poly(circle(fy, 0.48, 0.42, 0.055)), LIT);
  for (const [u, w, r, i] of [
    [0.4, 0.1, 0.035, 0],
    [0.56, 0.2, 0.03, 1],
    [0.2, 0.32, 0.026, 2],
    [0.6, 0.58, 0.024, 3],
    [0.36, 0.26, 0.02, 4],
  ] as const) {
    d.paint(d.poly(circle(fy, u, w, r, r * 0.8)), splash[i] ?? LIT);
    d.paint(d.poly(circle(fy, u + r * 1.4, w - r, r * 0.35)), splash[i] ?? LIT);
  }
  // The roof slopes up to the window, with a skylight, and a deep fascia.
  const e = 0.04;
  const roofZ = (xx: number) => low + ((high - low) * (xx - x[0])) / (x[1] - x[0]) + 0.02;
  const slope = (xx: number, yy: number): V3 => [xx, yy, roofZ(xx)];
  const fascia = 0.06;
  d.fill(
    d.poly([
      slope(x[0] - e, y[1] + e),
      slope(x[1] + e, y[1] + e),
      [x[1] + e, y[1] + e, roofZ(x[1] + e) - fascia],
      [x[0] - e, y[1] + e, roofZ(x[0] - e) - fascia],
    ]),
    PALETTE.clayDeep,
  );
  d.fill(
    d.poly([
      slope(x[1] + e, y[0] - e),
      slope(x[1] + e, y[1] + e),
      [x[1] + e, y[1] + e, roofZ(x[1] + e) - fascia],
      [x[1] + e, y[0] - e, roofZ(x[1] + e) - fascia],
    ]),
    mix(PALETTE.clayDeep, INK, 0.2),
  );
  d.fill(
    d.poly(
      [
        slope(x[0] - e, y[0] - e),
        slope(x[1] + e, y[0] - e),
        slope(x[1] + e, y[1] + e),
        slope(x[0] - e, y[1] + e),
      ],
      1.2,
    ),
    PALETTE.clay,
  );
  d.paint(
    d.poly([slope(0.3, 0.26), slope(0.52, 0.26), slope(0.52, 0.5), slope(0.3, 0.5)]),
    "#cfe8ef",
  );
  d.paint(
    d.poly([slope(0.405, 0.26), slope(0.415, 0.26), slope(0.415, 0.5), slope(0.405, 0.5)]),
    INK,
  );
  // Paint on the grass.
  for (const [px, py, r, i] of [
    [0.8, 0.92, 0.055, 0],
    [0.9, 0.5, 0.045, 1],
    [0.12, 0.8, 0.05, 2],
    [0.62, 0.95, 0.035, 3],
    [0.36, 0.9, 0.04, 4],
  ] as const) {
    d.paint(d.poly(circle(level(0), px, py, r, r * 0.8)), splash[i] ?? LIT);
    d.paint(d.poly(circle(level(0), px + r * 1.5, py - r * 0.4, r * 0.3)), splash[i] ?? LIT);
  }
  // A paint pot with a brush in it.
  d.piece();
  cylinder(d, 0.86, 0.66, 0.045, [0, 0.09], faces("#cfd6de", "#a9b2bd"));
  d.paint(d.poly(circle(level(0.09), 0.86, 0.66, 0.034)), RESIDENT.sky);
  d.line(
    d.path([
      [0.86, 0.66, 0.09],
      [0.92, 0.6, 0.26],
    ]),
    DARK_WOOD.front,
    0.016,
  );
  // The easel and its canvas, out front to the right of the door.
  d.piece();
  const ez = front(0.84);
  d.line(
    d.path([
      [0.66, 0.76, 0],
      [0.66, 0.82, 0.38],
    ]),
    DARK_WOOD.side,
    0.02,
  );
  d.line(d.path([ez(0.55, 0), ez(0.65, 0.44)]), DARK_WOOD.front, 0.022);
  d.line(d.path([ez(0.76, 0), ez(0.66, 0.44)]), DARK_WOOD.front, 0.022);
  d.fill(d.poly(rect(ez, [0.53, 0.79], [0.16, 0.4]), 0.8), "#ffffff");
  d.paint(d.poly(rect(ez, [0.55, 0.77], [0.18, 0.28])), mix(RESIDENT.leaf, "#ffffff", 0.15));
  d.paint(d.poly(rect(ez, [0.55, 0.77], [0.28, 0.38])), mix(RESIDENT.sky, "#ffffff", 0.3));
  d.paint(d.poly(circle(ez, 0.72, 0.33, 0.025)), LIT);
  d.paint(
    d.poly([ez(0.59, 0.22), ez(0.66, 0.22), ez(0.66, 0.28), ez(0.625, 0.31), ez(0.59, 0.28)]),
    RESIDENT.rose,
  );
  d.line(d.path([ez(0.51, 0.16), ez(0.81, 0.16)]), DARK_WOOD.side, 0.022);
};

export const BUILDINGS = {
  greenhouse,
  workshop,
  cafe,
  postOffice,
  library,
  lookout,
  observatory,
  atelier,
} satisfies Record<string, BuildingDrawer>;

export type BuildingKind = keyof typeof BUILDINGS;
