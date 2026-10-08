import { cards } from "@terrakin/cards/node";
import { RATE_LIMITS } from "@terrakin/protocol";
import {
  alphaHex,
  BLOCK_COLORS,
  blockFill,
  CROP_HEX,
  dayOfDate,
  GROUND_LOOK,
  groundTile,
  petShapes,
  THEME_INFO,
  THEME_TINT_ALPHA,
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
import { listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

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
}

async function start(options: Options = {}) {
  const service = new WorldService({
    store: new MemoryStore(),
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
  const drawn = { count: 0 };
  const fake: PlotPhotoRenderer = async () => {
    drawn.count++;
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
  const photo = (who: { token: string }) => call("POST", "/v1/plots/photo", who.token);
  return { call, settled, photo, social, service, media, drawn };
}

describe("plot photo data", () => {
  it("shows the plot's own ground, blocks, hearth, and theme", async () => {
    const { settled, service, call } = await start();
    const wren = await settled("Wren");
    await call("POST", "/v1/actions", wren.token, { type: "profile", theme: "lemon" });
    const spec = plotPhotoSpec(service.state, wren.residentId);
    if (!spec) throw new Error("no spec");
    expect(spec).toMatchObject({ kind: "plot", name: "Wren", place: "Plot 0, 0", size: 8 });
    expect(spec.ground).toHaveLength(64);
    // The starter home: a ring of walls with windows, and the hearth in the middle.
    expect(spec.blocks.length).toBeGreaterThan(10);
    expect(spec.blocks.every((b) => b.x >= 0 && b.x < 8 && b.y >= 0 && b.y < 8)).toBe(true);
    expect(spec.hearth).toEqual({ x: 3, y: 3 });
    expect(spec.tint).toBe(alphaHex(THEME_INFO.lemon.palette.ground, THEME_TINT_ALPHA));
    const wall = spec.blocks.find((b) => !b.glass);
    expect(wall?.fill).toBe(blockFill("wood", THEME_INFO.lemon.palette));
    expect(spec.facts[1]).toBe(`${spec.blocks.length} blocks`);
    expect(spec.blocks.some((b) => b.decor !== undefined)).toBe(false);
  });

  it("dresses the ground for the world's season, as the map does", async () => {
    const { settled, service } = await start();
    const wren = await settled("Wren");
    const photo = (day: number) => plotPhotoSpec({ ...service.state, day }, wren.residentId);
    const tiles = (season: "autumn" | "winter") =>
      Array.from({ length: 64 }, (_, i) =>
        groundTile(CONFIG, i % 8, Math.floor(i / 8), false, season),
      );
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
    const spec = plotPhotoSpec(service.state, wren.residentId);
    expect(spec?.blocks.find((b) => b.x === 6 && b.y === 6)).toMatchObject({
      decor: "lantern",
      fill: BLOCK_COLORS.lantern,
    });
  });

  it("names furniture and lays paths and floors in the world's own look", async () => {
    const { settled, service } = await start();
    const wren = await settled("Wren");
    // Set straight into the world for this read-model test: making, laying, and building are
    // tested in the sim.
    service.state.blocks["6,6"] = "well";
    service.state.ground = { "3,6": "cobble", "3,7": "stepping_stones" };
    const spec = plotPhotoSpec(service.state, wren.residentId);
    if (!spec) throw new Error("no spec");
    expect(spec.blocks.find((b) => b.x === 6 && b.y === 6)).toMatchObject({
      furniture: "well",
      fill: BLOCK_COLORS.well,
    });
    expect(spec.ground[6 * 8 + 3]?.paving).toEqual({
      fill: GROUND_LOOK.cobble.fill,
      marks: GROUND_LOOK.cobble.marks,
    });
    // Stepping stones let the grass under them show: no fill of their own.
    expect(spec.ground[7 * 8 + 3]?.paving).toEqual({ marks: GROUND_LOOK.stepping_stones.marks });
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
    const spec = plotPhotoSpec({ ...service.state, day }, wren.residentId);
    expect(spec?.crops).toEqual([
      { x: 2, y: 6, crop: "lemon", done: 1, fill: CROP_HEX.lemon },
      { x: 6, y: 6, crop: "pumpkin", done: 0.4, fill: CROP_HEX.pumpkin, vine: true },
    ]);
  });

  it("draws the owner's pet asleep beside the hearth, facing it", async () => {
    const { settled, service, call } = await start();
    const wren = await settled("Wren");
    expect(plotPhotoSpec(service.state, wren.residentId)?.pet).toBeUndefined();
    await call("POST", "/v1/actions", wren.token, {
      type: "adopt_pet",
      kind: "fox",
      coat: "red",
      name: "Ember",
    });
    const pet = plotPhotoSpec(service.state, wren.residentId)?.pet;
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

  it("answers unavailable when the server has no renderer", async () => {
    const { settled, photo } = await start({ photos: "none" });
    const wren = await settled("Wren");
    const res = await photo(wren);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("unavailable");
  });

  it("answers unavailable, storing nothing, when drawing fails", async () => {
    const { settled, photo, media } = await start({
      photos: async () => {
        throw new Error("boom");
      },
    });
    const wren = await settled("Wren");
    expect((await photo(wren)).status).toBe(503);
    expect(media.files.size).toBe(0);
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
