import { cards } from "@terrakin/cards/node";
import { RATE_LIMITS } from "@terrakin/protocol";
import {
  alphaHex,
  BLOCK_COLORS,
  blockFill,
  CROP_HEX,
  createWorld,
  DAY_LENGTH_MS,
  dayOfDate,
  GROUND_LOOK,
  groundTile,
  type Input,
  isCommons,
  petShapes,
  plotOf,
  THEME_INFO,
  THEME_TINT_ALPHA,
  tileKey,
  tuftStroke,
  type WorldConfig,
} from "@terrakin/sim";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { materializePlot, type PlotPhotoRenderer, plotPhotoSpec } from "./plot-photo";
import { type SocialLimits, SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { listenOnFreePort, loftLog, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Noon on the map's clock and a clear hour, so a photo these tests read is drawn in flat daylight
 * with nothing over it. The light and the weather have tests of their own.
 */
const AT_NOON = { now: Math.round(DAY_LENGTH_MS * 0.25) };

/** Where a tile of the plot lands in the box a photo draws, slivers and all (issue #80). */
function tileOn<T>(
  spec: {
    ground: T[];
    size: number;
    surround?: { cols: number; x: number; y: number } | undefined;
  },
  x: number,
  y: number,
): T | undefined {
  const at = spec.surround;
  return spec.ground[(y + (at?.y ?? 0)) * (at?.cols ?? spec.size) + x + (at?.x ?? 0)];
}

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

/** A real PNG for the fake renderer to hand back, drawn once. */
let PNG: Uint8Array = new Uint8Array(0);
beforeAll(async () => {
  PNG = (await cards.render({ kind: "site" })).bytes;
}, 30_000);

interface Options {
  /** Count days and open growing, for photos of a garden. */
  garden?: boolean;
  limits?: Partial<SocialLimits>;
  ipUploadBytesPerDay?: number;
  /** Default: a counting fake that returns PNG. */
  photos?: PlotPhotoRenderer | "real" | "none";
  /** Inputs the world has logged before it starts. */
  log?: Input[];
}

async function start(options: Options = {}) {
  const store = new MemoryStore();
  for (const input of options.log ?? []) store.appendInput(input);
  const service = new WorldService({
    store,
    config: CONFIG,
    ...(options.garden ? { days: true, items: true } : {}),
  });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    limits: options.limits ?? {},
    resident: (id) => service.state.residents[id],
  });
  const drawn = { count: 0, specs: [] as Parameters<PlotPhotoRenderer>[0][] };
  const fake: PlotPhotoRenderer = async (spec) => {
    drawn.count++;
    drawn.specs.push(spec);
    return PNG;
  };
  const photos =
    options.photos === "real"
      ? undefined
      : options.photos === "none"
        ? null
        : (options.photos ?? fake);
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    ...(photos === undefined ? {} : { photos: photos ?? false }),
    ...(options.ipUploadBytesPerDay === undefined
      ? {}
      : { ipUploadBytesPerDay: options.ipUploadBytesPerDay }),
  });
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());

  async function call(method: string, path: string, token?: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }
  /** A resident with a plot and a starter home, plot (px, 0) for the nth one. */
  let next = 0;
  async function settled(name: string) {
    const { body } = await call("POST", "/v1/session", undefined, { name, kind: "agent" });
    const who = body as { residentId: string; token: string };
    const px = next++;
    expect(
      (await call("POST", "/v1/actions", who.token, { type: "settle", px, py: 0 })).body.ok,
    ).toBe(true);
    expect(
      (await call("POST", "/v1/actions", who.token, { type: "build_starter_home" })).body.ok,
    ).toBe(true);
    return who;
  }
  const photo = (who: { token: string }, body?: unknown) =>
    call("POST", "/v1/plots/photo", who.token, body);
  return { call, settled, photo, social, service, media, drawn };
}

describe("plot photo data", () => {
  it("lifts this plot's own roof and leaves the neighbors' on (RFC 0041)", async () => {
    const { settled, service, call } = await start();
    const wren = await settled("Wren");
    const ash = await settled("Ash");
    const roof = async (who: { residentId: string; token: string }) => {
      const plot = Object.values(service.state.plots).find((p) => p.ownerId === who.residentId);
      if (!plot) throw new Error("no plot");
      const put = await call("POST", "/v1/actions", who.token, {
        type: "set_roof",
        px: plot.px,
        py: plot.py,
        style: "gable",
        material: "wood",
      });
      expect(put.body.ok, JSON.stringify(put.body)).toBe(true);
    };

    // A photo is of your own home, and a roof drawn from above is opaque, so the subject's lifts
    // away as it does on the map when you stand there. Without this the hearth, the walls, the
    // planters and the doorway are all covered and the photo is a coloured slab.
    await roof(wren);
    const alone = plotPhotoSpec(service.state, wren.residentId, AT_NOON);
    expect(alone?.roofs ?? [], "the subject's own roof should lift away").toEqual([]);

    // The neighbor's roof stays on, in the sliver where their hearth and blocks are drawn too
    // (decision 0306), which is how the map reads: every home's but the one you stand on.
    await roof(ash);
    const beside = plotPhotoSpec(service.state, wren.residentId, AT_NOON);
    expect((beside?.roofs ?? []).length, "a neighbor's roof should stay on").toBeGreaterThan(0);
  });

  it("wears winter's snow on the roofs it draws (RFC 0041)", async () => {
    const { settled, service, call } = await start();
    const wren = await settled("Wren");
    const ash = await settled("Ash");
    const plot = Object.values(service.state.plots).find((p) => p.ownerId === ash.residentId);
    if (!plot) throw new Error("no plot");
    expect(
      (
        await call("POST", "/v1/actions", ash.token, {
          type: "set_roof",
          px: plot.px,
          py: plot.py,
          style: "gable",
          material: "wood",
        })
      ).body.ok,
    ).toBe(true);

    // The same neighbor's roof on a winter day and on an autumn one: snow lies on it all winter,
    // as it lies on the ground under it, so a photo of a snowy town isn't brown boxes on white.
    const fillOn = (day: number) => {
      const state = { ...structuredClone(service.state), day };
      const roofs = plotPhotoSpec(state, wren.residentId, AT_NOON)?.roofs ?? [];
      expect(roofs).toHaveLength(1);
      return roofs[0]?.fill ?? "";
    };
    const lightness = (hex: string) =>
      [1, 3, 5].reduce((sum, at) => sum + Number.parseInt(hex.slice(at, at + 2), 16), 0);
    const winter = fillOn(dayOfDate(2027, 1, 15));
    const autumn = fillOn(dayOfDate(2026, 10, 20));
    expect(winter).not.toBe(autumn);
    expect(lightness(winter)).toBeGreaterThan(lightness(autumn));
  });

  it("shows the plot's own ground, blocks, hearth, and theme", async () => {
    const { settled, service, call } = await start();
    const wren = await settled("Wren");
    await call("POST", "/v1/actions", wren.token, { type: "profile", theme: "lemon" });
    const spec = plotPhotoSpec(service.state, wren.residentId, AT_NOON);
    if (!spec) throw new Error("no spec");
    // Drawn to post: a post's card frames it, so the photo brings no card border of its own.
    expect(spec).toMatchObject({
      kind: "plot",
      name: "Wren",
      place: "Plot 0, 0",
      size: 8,
      posted: true,
    });
    // The box is the plot with a sliver of the world on each side, the plot at the world's corner
    // sitting in its own corner of the box (issue #80).
    expect(spec.surround).toEqual({ cols: 10, rows: 10, x: 0, y: 0 });
    expect(spec.ground).toHaveLength(100);
    // The starter home: a ring of walls with windows, and the hearth in the middle.
    expect(spec.blocks.length).toBeGreaterThan(10);
    expect(spec.blocks.every((b) => b.x >= 0 && b.x < 8 && b.y >= 0 && b.y < 8)).toBe(true);
    expect(spec.hearth).toEqual({ x: 3, y: 3 });
    expect(spec.tints).toEqual([
      { x: 0, y: 0, w: 8, h: 8, fill: alphaHex(THEME_INFO.lemon.palette.ground, THEME_TINT_ALPHA) },
    ]);
    const wall = spec.blocks.find((b) => !b.glass);
    expect(wall?.fill).toBe(blockFill("wood", THEME_INFO.lemon.palette));
    expect(spec.facts[1]).toBe(`${spec.blocks.length} blocks`);
    expect(spec.blocks.some((b) => b.decor !== undefined)).toBe(false);
    // One floor: nothing about floors in its data or its words.
    expect(spec.facts).toHaveLength(2);
    expect(spec).not.toHaveProperty("floors");
  });

  it("shows a sliver of the plots next door, and counts only the plot's own blocks", async () => {
    const { call, service } = await start();
    // A plot with a plot either side of it, so a sliver of each falls in the frame.
    const { body } = await call("POST", "/v1/session", undefined, { name: "Wren", kind: "agent" });
    const wren = body as { residentId: string; token: string };
    for (const action of [{ type: "settle", px: 1, py: 0 }, { type: "build_starter_home" }]) {
      expect((await call("POST", "/v1/actions", wren.token, action)).body.ok).toBe(true);
    }
    const spec = plotPhotoSpec(service.state, wren.residentId, AT_NOON);
    if (!spec) throw new Error("no spec");
    // Plot 1, 0 sits against the world's top edge, so the box reaches down instead of up.
    expect(spec.surround).toEqual({ cols: 10, rows: 10, x: 1, y: 0 });
    expect(spec.ground).toHaveLength(100);
    // The plot's own tiles still name its ground and count its blocks.
    expect(spec.size).toBe(8);
    const own = spec.facts[1];
    const blocks = spec.blocks.length;
    // A neighbor's wall right across the line is drawn in the sliver and never counted as theirs.
    const next = structuredClone(service.state);
    next.blocks[tileKey(7, 2)] = "wood";
    const beside = plotPhotoSpec(next, wren.residentId, AT_NOON);
    expect(beside?.blocks.some((b) => b.x === 0 && b.y === 2)).toBe(true);
    expect(beside?.blocks).toHaveLength(blocks + 1);
    expect(beside?.facts[1]).toBe(own);
  });

  it("leaves a neighbor's upstairs out of the plot's floors and its story", async () => {
    const { settled, photo, drawn, service } = await start();
    const wren = await settled("Wren");
    expect((await photo(wren)).status).toBe(201);
    expect(drawn.specs[0]?.story).toBe("First photo of this home");
    expect(drawn.specs[0]).not.toHaveProperty("floors");
    // Ivy lays a tile of upstairs flooring on her own edge, inside Wren's sliver. It is hers: no
    // floor of Wren's, no shadow over Wren's edge, and nothing new to say about Wren's home.
    service.state.floors = { "1": { ground: { "8,3": "moss" }, blocks: {} } };
    const spec = plotPhotoSpec(service.state, wren.residentId, AT_NOON);
    expect(spec).not.toHaveProperty("floors");
    expect((await photo(wren)).status).toBe(201);
    expect(drawn.specs[1]).not.toHaveProperty("story");
  });

  it("draws a neighbor's home in the sliver, and only the owner's pet and picture", async () => {
    const { call, service, settled } = await start();
    const wren = await settled("Wren");
    const { body } = await call("POST", "/v1/session", undefined, { name: "Ivy", kind: "agent" });
    const ivy = body as { residentId: string; token: string };
    expect(
      (await call("POST", "/v1/actions", ivy.token, { type: "settle", px: 1, py: 0 })).body.ok,
    ).toBe(true);
    // Ivy's hearth sits one tile past Wren's line, so Wren's photo shows Ivy's home in the sliver.
    const next = structuredClone(service.state);
    const ivyAt = next.residents[ivy.residentId];
    if (ivyAt) ivyAt.hearth = { x: 8, y: 4 };
    const spec = plotPhotoSpec(next, wren.residentId, AT_NOON);
    expect(spec?.hearth).toEqual({ x: 3, y: 3 });
    expect(spec?.hearths).toEqual([{ x: 8, y: 4 }]);
    // A neighbor's hearth is never the owner's: no pet of theirs, no picture of their home.
    expect(spec).not.toHaveProperty("pet");
    expect(spec).not.toHaveProperty("homeArt");
  });

  it("tells what is new since the resident's last photo, and says nothing when nothing is", async () => {
    const { settled, photo, call, drawn } = await start();
    const wren = await settled("Wren");
    expect((await photo(wren)).status).toBe(201);
    expect(drawn.specs[0]?.story).toBe("First photo of this home");
    // Nothing has changed, so the second photo has no story and says only when it was taken.
    expect((await photo(wren)).status).toBe(201);
    expect(drawn.specs[1]).not.toHaveProperty("story");
    expect(drawn.specs[1]?.stamp?.length).toBeGreaterThan(0);
    // Name the plot, and the next photo says so.
    expect(
      (
        await call("POST", "/v1/actions", wren.token, {
          type: "name_plot",
          px: 0,
          py: 0,
          name: "Lemon Grove",
        })
      ).body.ok,
    ).toBe(true);
    expect((await photo(wren)).status).toBe(201);
    expect(drawn.specs[2]?.story).toBe("New since your last photo: a name");
  });

  it("tells no story for a floor plan, and never lets one stand in for the home's photo", async () => {
    const { settled, photo, call, drawn } = await start();
    const wren = await settled("Wren");
    expect((await photo(wren)).status).toBe(201);
    expect(drawn.specs[0]?.story).toBe("First photo of this home");
    expect(
      (
        await call("POST", "/v1/actions", wren.token, {
          type: "name_plot",
          px: 0,
          py: 0,
          name: "Lemon Grove",
        })
      ).body.ok,
    ).toBe(true);
    // A floor plan is a different picture: it tells no story and keeps no mark of its own, so the
    // next photo of the home still measures against the last photo of the home.
    expect((await photo(wren, { floor: 0 })).status).toBe(201);
    expect(drawn.specs[1]).not.toHaveProperty("story");
    expect((await photo(wren)).status).toBe(201);
    expect(drawn.specs[2]?.story).toBe("New since your last photo: a name");
  });

  it("draws every floor from above, or one floor's plan with what's above it left out (RFC 0028)", async () => {
    const { service } = await start({ log: loftLog("r_ada", "Ada") });
    expect(service.state.plots["0,0"]?.floors).toBe(1);
    const moss = {
      ...(GROUND_LOOK.moss.fill ? { fill: GROUND_LOOK.moss.fill } : {}),
      marks: GROUND_LOOK.moss.marks,
    };
    const loft = {
      flooring: [
        { x: 2, y: 2, paving: moss },
        { x: 3, y: 2, paving: moss },
        { x: 2, y: 3, paving: moss },
        { x: 3, y: 3, paving: moss },
      ],
      blocks: [{ x: 1, y: 1, glass: true, fill: blockFill("glass") }],
    };
    const above = plotPhotoSpec(service.state, "r_ada", AT_NOON);
    if (!above) throw new Error("no spec");
    expect(above.floors).toEqual([loft]);
    expect(above).not.toHaveProperty("floorPlan");
    // The window upstairs counts with the hut's blocks, and the line says how tall the home is.
    expect(above.facts.slice(1)).toEqual([`${above.blocks.length + 1} blocks`, "2 floors"]);

    // The ground floor's plan leaves the loft out, and shows the hearth under it.
    const ground = plotPhotoSpec(service.state, "r_ada", { ...AT_NOON, floor: 0 });
    expect(ground).not.toHaveProperty("floors");
    expect(ground).not.toHaveProperty("floorPlan");
    expect(ground?.blocks).toEqual(above.blocks);
    expect(ground?.hearth).toEqual({ x: 3, y: 3 });
    expect(ground?.facts.at(-1)).toBe("Ground floor");
    // Upstairs is the loft over the ground floor, dimmed where the loft has no flooring.
    const upstairs = plotPhotoSpec(service.state, "r_ada", { ...AT_NOON, floor: 1 });
    expect(upstairs).toMatchObject({ floors: [loft], floorPlan: true });
    expect(upstairs?.facts.at(-1)).toBe("Upstairs");
  });

  it("carries the moment it was taken: the map's light, the weather, and a stamp", async () => {
    const { settled, service } = await start();
    const wren = await settled("Wren");
    // 2026-10-06 is Day 3 of Terrakin and autumn. The map's clock turns every 3.5 hours, so a
    // quarter of the way through is noon and three quarters is midnight; the weather of that UTC
    // hour is the sim's, pinned in its own tests.
    const day = dayOfDate(2026, 10, 6);
    const at = (fraction: number) =>
      plotPhotoSpec({ ...service.state, day }, wren.residentId, {
        now: Math.round(DAY_LENGTH_MS * fraction),
      });
    const noon = at(0.25);
    expect(noon?.sky).toEqual({ night: 0, weather: "fog" });
    // Plain daylight needs no word for itself: the day, the season, and the sky.
    expect(noon?.stamp).toEqual(["Day 3 of Terrakin", "Autumn", "Fog"]);
    const midnight = at(0.75);
    expect(midnight?.sky).toEqual({ night: 1, weather: "fog" });
    expect(midnight?.stamp).toEqual(["Day 3 of Terrakin", "Autumn", "Night", "Fog"]);
    // The night is rounded to a twentieth, so a plot's picture by link changes with the light
    // rather than with every second: this moment's own 0.206 is drawn as 0.2.
    expect(at(0.4)?.sky?.night).toBe(0.2);
    // A world that has never counted a day has no day and no season to stamp.
    const { day: _counted, ...dayless } = service.state;
    expect(plotPhotoSpec(dayless, wren.residentId, AT_NOON)?.stamp).toEqual(["Fog"]);
  });

  it("shows whoever is standing on the plot, so a home with someone in it reads as one", async () => {
    const { settled, service, call } = await start();
    const wren = await settled("Wren");
    const ivy = await settled("Ivy");
    const mine = () => plotPhotoSpec(service.state, wren.residentId, AT_NOON);
    // Wren is home on their own plot; Ivy settled another, so only Wren is in the picture.
    const alone = mine();
    const them = service.state.residents[wren.residentId];
    expect(alone?.figures).toHaveLength(1);
    // Feet on their own tile, in their own look, as the map stands them.
    expect(alone?.figures?.[0]).toMatchObject({
      x: (them?.x ?? 0) + 0.5,
      y: (them?.y ?? 0) + 0.88,
    });
    expect(alone?.figures?.[0]?.look.color).toBe(them?.color);
    await call("POST", "/v1/actions", ivy.token, { type: "visit", px: 0, py: 0 });
    expect(mine()?.figures).toHaveLength(2);
    // Someone who goes offline is drawn asleep by the map, never standing in a photo.
    const away = structuredClone(service.state);
    for (const r of Object.values(away.residents)) r.online = false;
    expect(plotPhotoSpec(away, wren.residentId, AT_NOON)).not.toHaveProperty("figures");
  });

  it("dresses the ground for the world's season, as the map does", async () => {
    const { settled, service } = await start();
    const wren = await settled("Wren");
    const photo = (day: number) =>
      plotPhotoSpec({ ...service.state, day }, wren.residentId, AT_NOON);
    // The box is the plot and a sliver of the world on each side, so its tiles run past the plot
    // and reach the Commons plaza in the corner.
    const tiles = (season: "autumn" | "winter") =>
      Array.from({ length: 100 }, (_, i) => {
        const x = i % 10;
        const y = Math.floor(i / 10);
        const { px, py } = plotOf(CONFIG, x, y);
        return groundTile(CONFIG, x, y, isCommons(createWorld(CONFIG), px, py), season);
      });
    // 2026-10-06 is autumn, 2026-12-25 winter.
    const autumn = photo(dayOfDate(2026, 10, 6));
    const winter = photo(dayOfDate(2026, 12, 25));
    expect(autumn?.ground.map((g) => g.fill)).toEqual(tiles("autumn").map((t) => t.fill));
    expect(autumn?.ground.some((g) => g.leaf)).toBe(true);
    expect(autumn?.ink.tuft).toBe(tuftStroke("autumn"));
    expect(winter?.ground.map((g) => g.fill)).toEqual(tiles("winter").map((t) => t.fill));
    expect(winter?.ground.some((g) => g.flower || g.leaf)).toBe(false);
  });

  it("names decor so the photo draws a lantern, not a square", async () => {
    const { settled, service } = await start();
    const wren = await settled("Wren");
    // Set straight into the world for this read-model test: buying and placing are tested in the sim.
    service.state.blocks["6,6"] = "lantern";
    const spec = plotPhotoSpec(service.state, wren.residentId, AT_NOON);
    expect(spec?.blocks.find((b) => b.x === 6 && b.y === 6)).toMatchObject({
      decor: "lantern",
      fill: BLOCK_COLORS.lantern,
    });
  });

  it("names furniture and lays paths and flooring in the world's own look", async () => {
    const { settled, service } = await start();
    const wren = await settled("Wren");
    // Set straight into the world for this read-model test: making, laying, and building are
    // tested in the sim.
    service.state.blocks["6,6"] = "well";
    service.state.ground = { "3,6": "cobble", "3,7": "stepping_stones" };
    const spec = plotPhotoSpec(service.state, wren.residentId, AT_NOON);
    if (!spec) throw new Error("no spec");
    expect(spec.blocks.find((b) => b.x === 6 && b.y === 6)).toMatchObject({
      furniture: "well",
      fill: BLOCK_COLORS.well,
    });
    expect(tileOn(spec, 3, 6)?.paving).toEqual({
      fill: GROUND_LOOK.cobble.fill,
      marks: GROUND_LOOK.cobble.marks,
    });
    // Stepping stones let the grass under them show: no fill of their own.
    expect(tileOn(spec, 3, 7)?.paving).toEqual({ marks: GROUND_LOOK.stepping_stones.marks });
  });

  it("draws what grows in its planters, as far along as the world's day has it", async () => {
    const { settled, service } = await start({ garden: true });
    const wren = await settled("Wren");
    const items = service.state.items;
    if (!items) throw new Error("growing isn't open");
    // Set straight into the world for this read-model test: planting and growing are tested in
    // the sim. A lemon ready today, a pumpkin two days into five, and nothing in the third planter.
    const day = 20_000;
    for (const key of ["2,6", "6,6", "4,7"]) service.state.blocks[key] = "planter";
    items.crops["6,6"] = {
      crop: "pumpkin",
      by: wren.residentId,
      plantedDay: day - 2,
      readyDay: day + 3,
    };
    items.crops["2,6"] = { crop: "lemon", by: wren.residentId, plantedDay: day - 4, readyDay: day };
    const spec = plotPhotoSpec({ ...service.state, day }, wren.residentId, AT_NOON);
    expect(spec?.crops).toEqual([
      { x: 2, y: 6, crop: "lemon", done: 1, fill: CROP_HEX.lemon },
      { x: 6, y: 6, crop: "pumpkin", done: 0.4, fill: CROP_HEX.pumpkin, vine: true },
    ]);
  });

  it("draws the owner's pet asleep beside the hearth, facing it", async () => {
    const { settled, service, call } = await start();
    const wren = await settled("Wren");
    expect(plotPhotoSpec(service.state, wren.residentId, AT_NOON)?.pet).toBeUndefined();
    await call("POST", "/v1/actions", wren.token, {
      type: "adopt_pet",
      kind: "fox",
      coat: "red",
      name: "Ember",
    });
    const pet = plotPhotoSpec(service.state, wren.residentId, AT_NOON)?.pet;
    // The hearth is at (3, 3); the first open tile beside it is east, so the fox faces west.
    expect(pet).toMatchObject({ size: 1, flip: true });
    expect(pet?.x).toBeGreaterThan(3.5);
    expect(pet?.x).toBeLessThan(4);
    expect(pet?.shapes).toEqual(petShapes("fox", "red", "asleep"));
  });

  it("draws a home picture only when it's one the renderer can read", async () => {
    const spec = { ...plotPhotoSpecFixture(), homeArt: "m_00000000000000aa" };
    const withArt = await materializePlot(spec, async () => PNG);
    expect(withArt.homeArt?.src).toMatch(/^data:image\/png;base64,/);
    expect(withArt.homeArt?.width).toBe(1200);
    const junk = await materializePlot(spec, async () => new Uint8Array([1, 2, 3]));
    expect(junk.homeArt).toBeUndefined();
    const gone = await materializePlot(spec, async () => undefined);
    expect(gone.homeArt).toBeUndefined();
  });
});

function plotPhotoSpecFixture() {
  return {
    kind: "plot" as const,
    name: "Wren",
    place: "Plot 0, 0",
    facts: [],
    size: 2,
    ground: [{ fill: "#a5c682" }, { fill: "#a5c682" }, { fill: "#a5c682" }, { fill: "#a5c682" }],
    blocks: [],
    ink: { roof: "#d9653a", door: "#f2b84b", walls: "#fffaf0", tuft: "#000000" },
  };
}

describe("POST /v1/plots/photo", () => {
  it("stores the photo as the resident's own upload, ready to post", async () => {
    const { settled, photo, call, drawn } = await start();
    const wren = await settled("Wren");
    const res = await photo(wren);
    expect(res.status).toBe(201);
    // Wren settled plot (0, 0): the photo says where it was taken, so a post can link there.
    expect(res.body.media).toMatchObject({
      kind: "image",
      type: "image/png",
      place: { px: 0, py: 0 },
    });
    expect(drawn.count).toBe(1);
    const post = await call("POST", "/v1/posts", wren.token, {
      text: "My home",
      media: [res.body.media.id],
    });
    expect(post.status).toBe(201);
    expect(post.body.post.media[0]).toMatchObject({
      id: res.body.media.id,
      place: { px: 0, py: 0 },
    });
    const read = await call("GET", `/v1/posts/${post.body.post.id}`);
    expect(read.body.post.media[0].place).toEqual({ px: 0, py: 0 });
    // A photo sent in a letter keeps its place too.
    const ash = await settled("Ash");
    const second = await photo(wren);
    const sent = await call("POST", "/v1/letters", wren.token, {
      to: ash.residentId,
      text: "Come see",
      media: [second.body.media.id],
    });
    expect(sent.status).toBe(201);
    const inbox = await call("GET", "/v1/letters", ash.token);
    expect(inbox.body.letters[0].media[0].place).toEqual({ px: 0, py: 0 });
  });

  it("draws a real PNG with the default renderer", async () => {
    const { settled, photo, media } = await start({ photos: "real" });
    const wren = await settled("Wren");
    const res = await photo(wren);
    expect(res.status).toBe(201);
    const bytes = media.files.get(res.body.media.id);
    expect([...(bytes ?? new Uint8Array(0)).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);

  it("needs a token, and refuses a resident without a plot before drawing", async () => {
    const { call, drawn } = await start();
    expect((await call("POST", "/v1/plots/photo")).status).toBe(401);
    const { body } = await call("POST", "/v1/session", undefined, { name: "Ash", kind: "agent" });
    const res = await call("POST", "/v1/plots/photo", body.token);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/settle/);
    expect(drawn.count).toBe(0);
  });

  it("takes one floor's plan, and refuses a floor the plot hasn't added before drawing (RFC 0028)", async () => {
    const { service, call, photo, drawn } = await start({ log: loftLog("r_ada", "Ada") });
    const ada = { token: service.issueToken("r_ada") };
    expect((await photo(ada, { floor: 1 })).status).toBe(201);
    expect(drawn.specs[0]).toMatchObject({ floorPlan: true, floors: [expect.anything()] });
    expect((await photo(ada, { floor: 0 })).status).toBe(201);
    expect(drawn.specs[1]).not.toHaveProperty("floors");
    // No body: the whole home from above.
    expect((await photo(ada)).status).toBe(201);
    expect(drawn.specs[2]?.floors).toHaveLength(1);
    expect(drawn.specs[2]).not.toHaveProperty("floorPlan");

    // Wren's plot has no upstairs, so there's no plan of one to draw.
    const { body } = await call("POST", "/v1/session", undefined, { name: "Wren", kind: "agent" });
    const wren = body as { token: string };
    const settle = { type: "settle", px: 2, py: 0 };
    expect((await call("POST", "/v1/actions", wren.token, settle)).body.ok).toBe(true);
    const refused = await photo(wren, { floor: 1 });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("no_floor");
    // Past the highest floor any plot may have is no floor at all.
    const beyond = await photo(wren, { floor: 2 });
    expect(beyond.status).toBe(400);
    expect(beyond.body.error.code).toBe("bad_request");
    expect(drawn.count).toBe(3);
    expect((await photo(wren, { floor: 0 })).status).toBe(201);
  });

  it("refuses the name `floor` had before, whatever it carries, before drawing", async () => {
    // `floor` was `storey` once. Dropped, it would draw the whole home and keep it as an upload,
    // and 0 asked for the ground floor's plan, so no value of it is passed over on this body.
    const { service, photo, drawn } = await start({ log: loftLog("r_ada", "Ada") });
    const ada = { token: service.issueToken("r_ada") };
    for (const storey of [0, 1]) {
      const old = await photo(ada, { storey });
      expect([old.status, old.body.error]).toEqual([
        400,
        {
          code: "bad_request",
          message: "Unknown field 'storey'. Did you mean 'floor'?",
          did_you_mean: "floor",
        },
      ]);
    }
    expect(drawn.count).toBe(0);
    // With the name it has now, the same body is the ground floor's plan.
    expect((await photo(ada, { floor: 0 })).status).toBe(201);
    expect(drawn.count).toBe(1);
  });

  it("answers unavailable when the server has no renderer", async () => {
    const { settled, photo } = await start({ photos: "none" });
    const wren = await settled("Wren");
    const res = await photo(wren);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("unavailable");
  });

  it("answers unavailable, storing nothing, when drawing fails", async () => {
    let boom = true;
    const drawn: { story?: string | undefined }[] = [];
    const { settled, photo, media } = await start({
      photos: async (spec) => {
        drawn.push(spec);
        if (boom) throw new Error("boom");
        return new Uint8Array(await PNG);
      },
    });
    const wren = await settled("Wren");
    expect((await photo(wren)).status).toBe(503);
    expect(media.files.size).toBe(0);
    // Nothing was stored, so the photo that works is still this plot's first (issue #80).
    boom = false;
    expect((await photo(wren)).status).toBe(201);
    expect(drawn[1]?.story).toBe("First photo of this home");
  });

  it(`refuses past ${RATE_LIMITS.photos.burst} photos at once from one resident`, async () => {
    const { settled, photo, drawn } = await start();
    const wren = await settled("Wren");
    for (let i = 0; i < RATE_LIMITS.photos.burst; i++) expect((await photo(wren)).status).toBe(201);
    const refused = await photo(wren);
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("rate_limited");
    expect(drawn.count).toBe(RATE_LIMITS.photos.burst);
  });

  it(`refuses past ${RATE_LIMITS.photosIp.burst} photos at once from one IP`, async () => {
    const { settled, photo, drawn } = await start();
    const per = RATE_LIMITS.photos.burst;
    const people = [];
    for (let i = 0; i < Math.ceil(RATE_LIMITS.photosIp.burst / per) + 1; i++) {
      people.push(await settled(`Friend ${i}`));
    }
    let taken = 0;
    let refused: { status: number; body: { error: { message: string } } } | undefined;
    for (const who of people) {
      for (let i = 0; i < per && !refused; i++) {
        const res = await photo(who);
        if (res.status === 201) taken++;
        else refused = res;
      }
    }
    expect(taken).toBe(RATE_LIMITS.photosIp.burst);
    expect(refused?.status).toBe(429);
    expect(refused?.body.error.message).toMatch(/from here/);
    expect(drawn.count).toBe(RATE_LIMITS.photosIp.burst);
  });

  it("refuses at the daily upload count, before drawing", async () => {
    const { settled, photo, drawn } = await start({ limits: { uploadsPerDay: 1 } });
    const wren = await settled("Wren");
    expect((await photo(wren)).status).toBe(201);
    const refused = await photo(wren);
    expect(refused.status).toBe(429);
    expect(refused.body.error.message).toMatch(/upload limit/);
    expect(drawn.count).toBe(1);
  });

  it("refuses when a photo wouldn't fit in the resident's daily bytes, before drawing", async () => {
    const { settled, photo, drawn } = await start({ limits: { uploadBytesPerDay: 500_000 } });
    const wren = await settled("Wren");
    expect((await photo(wren)).status).toBe(429);
    expect(drawn.count).toBe(0);
  });

  it("refuses at the global daily bytes and the storage ceiling, before drawing", async () => {
    for (const limits of [{ globalUploadBytesPerDay: 500_000 }, { totalStoredBytes: 500_000 }]) {
      const { settled, photo, drawn } = await start({ limits });
      const wren = await settled("Wren");
      expect((await photo(wren)).status).toBe(429);
      expect(drawn.count).toBe(0);
    }
  });

  it("refuses past the IP's daily upload bytes, before drawing", async () => {
    const { settled, photo, drawn } = await start({ ipUploadBytesPerDay: 500_000 });
    const wren = await settled("Wren");
    const refused = await photo(wren);
    expect(refused.status).toBe(429);
    expect(refused.body.error.message).toMatch(/from here/);
    expect(drawn.count).toBe(0);
  });

  it("draws only two photos at once", async () => {
    let release = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let started = 0;
    const { settled, photo } = await start({
      photos: async () => {
        started++;
        await gate;
        return PNG;
      },
    });
    const a = await settled("A");
    const b = await settled("B");
    const c = await settled("C");
    const first = photo(a);
    const second = photo(b);
    while (started < 2) await new Promise((done) => setTimeout(done, 5));
    const third = await photo(c);
    expect(third.status).toBe(429);
    expect(third.body.error.message).toMatch(/right now/);
    release();
    expect((await first).status).toBe(201);
    expect((await second).status).toBe(201);
    expect(started).toBe(2);
  });

  it("refuses a suspended resident", async () => {
    const { settled, photo, social, drawn } = await start();
    const wren = await settled("Wren");
    const staff = await settled("Staff");
    expect(social.safety.suspend(staff.residentId, wren.residentId, 1, "test").ok).toBe(true);
    const res = await photo(wren);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("suspended");
    expect(drawn.count).toBe(0);
  });
});
