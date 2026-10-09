import { drawingSvg } from "@terrakin/cards";
import { cards } from "@terrakin/cards/node";
import type { Input, WorldConfig } from "@terrakin/sim";
import { figureDrawing } from "@terrakin/ui/figure-svg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Api, type ApiRequest } from "./api";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import {
  type CardDeps,
  type CardRequest,
  MISSING_TTL,
  matchCardPath,
  PICTURE_TTL,
  pictureAtKey,
  serveCard,
  windowLimiter,
} from "./og";
import {
  edgeLook,
  type LookSpec,
  materializePicture,
  type NearSpec,
  type PictureSpec,
  pictureSpec,
} from "./pictures";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { listenOnFreePort, loftLog, responseChecker } from "./test-support";
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

/** A real PNG, for uploads and for the fake renderer to hand back. */
let PNG: Uint8Array = new Uint8Array(0);
beforeAll(async () => {
  PNG = (await cards.render({ kind: "site" })).bytes;
}, 30_000);

/** A world with the social layer, driven through `Api.handle` like any client. */
function world() {
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id) => service.state.residents[id],
  });
  const api = new Api({
    service,
    social,
    skill: "",
    openapi: "",
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  async function call(method: string, pathname: string, body?: unknown, token?: string) {
    const bytes = body instanceof Uint8Array ? body : undefined;
    const req: ApiRequest = {
      method,
      pathname,
      ip: "127.0.0.1",
      authorization: token ? `Bearer ${token}` : undefined,
      query: new URLSearchParams(),
      readJson: async () => (bytes ? undefined : body),
      readBytes: async () => bytes,
      contentLength: bytes?.length,
      ...(body === undefined || bytes ? {} : { contentType: "application/json" }),
    };
    const res = await api.handle(req);
    const text = typeof res?.body === "string" ? res.body : "";
    return { status: res?.status ?? 0, body: text ? JSON.parse(text) : undefined };
  }
  async function join(name: string) {
    const { body } = await call("POST", "/v1/session", { name, kind: "human" });
    return body as { residentId: string; token: string };
  }
  const act = async (token: string, action: object) =>
    (await call("POST", "/v1/actions", action, token)).body;
  return { service, social, api, call, join, act };
}

describe("picture paths", () => {
  it("knows the three pictures and nothing near them", () => {
    expect(matchCardPath("/og/plot/3-12.png")).toEqual({ kind: "plot", px: 3, py: 12 });
    expect(matchCardPath("/og/look/r_0123456789abcdef.png")).toEqual({
      kind: "look",
      id: "r_0123456789abcdef",
    });
    expect(matchCardPath("/og/near/r_1.png")).toEqual({ kind: "near", id: "r_1" });
    for (const path of [
      "/og/plot/3.png",
      "/og/plot/-1-2.png",
      "/og/plot/3-.png",
      "/og/plot/12345-1.png",
      "/og/plot/1-2.jpg",
      "/og/look/../x.png",
      "/og/near/.png",
      "/og/near/a b.png",
      "/og/look/r_1.png/x",
    ]) {
      expect(matchCardPath(path), path).toBeUndefined();
    }
  });
});

describe("picture data", () => {
  it("answers nothing for a resident or plot that isn't there", async () => {
    const w = world();
    const o = { nowMs: 0, held: () => false, artShown: () => true };
    expect(pictureSpec(w.service.state, { kind: "look", id: "r_nope" }, o)).toBeUndefined();
    expect(pictureSpec(w.service.state, { kind: "near", id: "__proto__" }, o)).toBeUndefined();
    expect(pictureSpec(w.service.state, { kind: "plot", px: 0, py: 0 }, o)).toBeUndefined();
    expect(pictureSpec(w.service.state, { kind: "plot", px: 99, py: 99 }, o)).toBeUndefined();
  });

  it("never shows a home picture for a suspended owner, a purged upload, or one whose pictures staff removed", async () => {
    const w = world();
    const ivy = await w.join("Ivy");
    expect((await w.act(ivy.token, { type: "settle", px: 0, py: 0 })).ok).toBe(true);
    const upload = async () =>
      (await w.call("POST", "/v1/media", PNG, ivy.token)).body.media.id as string;
    const home = await upload();
    expect((await w.act(ivy.token, { type: "profile", homeArt: home })).ok).toBe(true);
    const plot = () => w.api.pictureSpec({ kind: "plot", px: 0, py: 0 });
    expect(plot()).toMatchObject({ kind: "plot", homeArt: home });

    expect(w.social.safety.suspend("staff", ivy.residentId, 1, "test").ok).toBe(true);
    expect(plot()).not.toHaveProperty("homeArt");
    expect(w.social.safety.unsuspend("staff", ivy.residentId, "test").ok).toBe(true);
    expect(plot()).toMatchObject({ homeArt: home });

    // A purged upload leaves its id on her look, but the picture's data drops it, so its key
    // changes and a PNG drawn with it is never served again.
    const gone = await upload();
    expect((await w.act(ivy.token, { type: "profile", homeArt: gone })).ok).toBe(true);
    const before = plot();
    expect(before).toMatchObject({ homeArt: gone });
    expect(await w.social.purgeMedia(gone)).toBe(true);
    expect(w.service.state.residents[ivy.residentId]?.homeArt).toBe(gone);
    expect(plot()).not.toHaveProperty("homeArt");
    expect(JSON.stringify(plot())).not.toBe(JSON.stringify(before));
    expect((await w.act(ivy.token, { type: "profile", homeArt: home })).ok).toBe(true);
    expect(plot()).toMatchObject({ homeArt: home });

    // Staff take her avatar down: from then on no upload of hers shows, the home picture included.
    const avatar = await upload();
    expect((await w.call("PUT", "/v1/profile", { avatar }, ivy.token)).status).toBe(200);
    expect((await w.social.safety.removePictures("staff", ivy.residentId, "test")).ok).toBe(true);
    expect(plot()).not.toHaveProperty("homeArt");
    const card = await materializePicture(plot() as PictureSpec, async () => PNG);
    expect(JSON.stringify(card)).not.toContain(home);
  });

  it("draws a look without its uploaded pattern tile, and the plot's people as figures", async () => {
    const w = world();
    const capri = await w.join("Capri");
    const tile = (await w.call("POST", "/v1/media", PNG, capri.token)).body.media.id as string;
    expect(
      (
        await w.act(capri.token, {
          type: "profile",
          theme: "lemon",
          pattern: "citrus",
          wear: ["straw_hat"],
          wearStyle: { straw_hat: { pattern: "own" } },
          patternMedia: tile,
          hair: "bob",
          hairColor: "auburn",
        })
      ).ok,
    ).toBe(true);
    const r = w.service.state.residents[capri.residentId];
    if (!r) throw new Error("no resident");
    expect(r.patternMedia).toBe(tile);
    expect(edgeLook(r)).not.toHaveProperty("patternMedia");
    const spec = w.api.pictureSpec({ kind: "look", id: capri.residentId }) as LookSpec;
    expect(spec).toMatchObject({ kind: "look", name: "Capri", ground: expect.any(String) });
    expect(spec.facts).toEqual(["Lemon outfit", "Auburn bob", "Straw hat"]);
    const card = await materializePicture(spec, async () => PNG);
    const json = JSON.stringify(card);
    expect(json).not.toContain(tile);
    expect(json).not.toContain("data:");
    if (card.kind !== "look") throw new Error("not a look");
    expect(card.figure.shapes.length).toBeGreaterThan(10);
  });

  it("frames the map around someone, with their online neighbors, the light, and the sky", async () => {
    const w = world();
    const ivy = await w.join("Ivy");
    const bram = await w.join("Bram");
    const spec = w.api.pictureSpec({ kind: "near", id: ivy.residentId }) as NearSpec;
    expect(spec.kind).toBe("near");
    expect(spec.area.cols).toBe(24);
    expect(spec.area.rows).toBe(10);
    expect(spec.area.ground).toHaveLength(240);
    expect(spec.place).toBe("In the Commons");
    // Both stand at the spawn: Ivy is ringed, and Bram counts as nearby.
    expect(spec.area.figures).toHaveLength(2);
    expect(spec.at).toBeDefined();
    expect(spec.facts).toContain("1 nearby");
    expect(Number.isInteger(spec.night * 20)).toBe(true);

    // Bram leaves: away residents aren't on the map, as in the world.
    const state = structuredClone(w.service.state);
    const gone = state.residents[bram.residentId];
    if (gone) gone.online = false;
    const o = { nowMs: Date.now(), held: () => false, artShown: () => true };
    const later = pictureSpec(state, { kind: "near", id: ivy.residentId }, o) as NearSpec;
    expect(later.area.figures).toHaveLength(1);
    // An away resident's own picture is centered where they live and says they're away.
    const away = pictureSpec(state, { kind: "near", id: bram.residentId }, o) as NearSpec;
    expect(away.facts).toContain("Away");
    expect(away.at).toBeUndefined();
  });
});

describe("figures for pictures", () => {
  it("records the map's figure as shapes the cards draw: palette colors, clips, and pattern tiles", () => {
    const d = figureDrawing({
      color: "rose",
      shape: "round",
      theme: "lemon",
      pattern: "dots",
      wear: ["top_hat"],
      hair: "long",
      hairColor: "pink",
    });
    expect(d.shapes.length).toBeGreaterThan(20);
    // The hat clips the hair under its band, and the clothes wear their pattern.
    expect(d.clips.length).toBeGreaterThan(0);
    expect(d.tiles.length).toBeGreaterThan(0);
    const COLOR = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d{1,4})\))$/;
    for (const s of [...d.shapes, ...d.tiles.flatMap((t) => t.shapes)]) {
      if (s.fill) expect(s.fill).toMatch(COLOR);
      if (s.stroke) expect(s.stroke).toMatch(COLOR);
      expect(s.d).toMatch(/^[MLQCAZ0-9.\s-]+$/);
    }
    const svg = drawingSvg(d, "f0");
    expect(svg).toContain('<clipPath id="f0c0">');
    expect(svg).toContain('fill="url(#f0t0)"');
    expect(svg).not.toMatch(/href|<script|<image/);
  });

  it("is plain data the same every time", () => {
    const look = { color: "sky", shape: "square", hair: "afro", wear: ["beret"] } as const;
    expect(JSON.stringify(figureDrawing(look))).toBe(JSON.stringify(figureDrawing(look)));
  });
});

describe("picture route", () => {
  const look = (fact: string): LookSpec => ({
    kind: "look",
    name: "Wren",
    look: { color: "sun", shape: "round" },
    ground: "#a5c682",
    facts: [fact],
  });
  function deps(over: Partial<CardDeps> = {}) {
    let now = 0;
    let asks = 0;
    let renders = 0;
    let current: PictureSpec = look("first");
    const stored = new Map<string, { bytes: Uint8Array; until: number }>();
    const d: CardDeps = {
      get: async () => ({ status: 404, body: undefined }),
      loadMedia: async () => undefined,
      render: async () => {
        renders++;
        return { bytes: PNG, type: "image/png", width: 1200, height: 630 };
      },
      cache: {
        get: async (k) => {
          const e = stored.get(k);
          return e && e.until > now ? e.bytes : undefined;
        },
        put: (k, bytes, ttl) =>
          void stored.set(k, { bytes, until: ttl === undefined ? Infinity : now + ttl * 1000 }),
      },
      allowRender: () => true,
      picture: async (route) => {
        asks++;
        if ("id" in route && route.id === "r_broken") throw new Error("world is down");
        return "id" in route && route.id === "r_nope" ? undefined : current;
      },
      allowPicture: () => true,
      allowDraw: () => true,
      ...over,
    };
    return {
      d,
      stored,
      asks: () => asks,
      renders: () => renders,
      tick: (seconds: number) => {
        now += seconds * 1000;
      },
      show: (spec: PictureSpec) => {
        current = spec;
      },
    };
  }
  const req = (path: string, extra: Partial<CardRequest> = {}): CardRequest => {
    const route = matchCardPath(path);
    if (!route) throw new Error(`not a picture path: ${path}`);
    return { route, version: null, ifNoneMatch: null, ip: "1.2.3.4", ...extra };
  };

  it("draws once per change, asks the world at most once per window, and answers with the og headers", async () => {
    const t = deps();
    const first = await serveCard(req("/og/near/r_known.png"), t.d);
    expect(first.status).toBe(200);
    expect(first.headers).toMatchObject({
      "content-type": "image/png",
      "cache-control": "public, max-age=120",
      "x-content-type-options": "nosniff",
    });
    const etag = first.headers.etag ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect([t.asks(), t.renders()]).toEqual([1, 1]);
    // The pointer says which picture the path shows, for PICTURE_TTL.near.ask seconds.
    expect(
      new TextDecoder().decode(t.stored.get(pictureAtKey({ kind: "near", id: "r_known" }))?.bytes),
    ).toBe(etag.slice(1, -1));

    // What it shows changes, but inside the window the same picture is served without asking.
    t.show(look("second"));
    t.tick(PICTURE_TTL.near.ask - 1);
    const same = await serveCard(req("/og/near/r_known.png"), t.d);
    expect(same.headers.etag).toBe(etag);
    expect([t.asks(), t.renders()]).toEqual([1, 1]);
    expect((await serveCard(req("/og/near/r_known.png", { ifNoneMatch: etag }), t.d)).status).toBe(
      304,
    );

    // After the window the world is asked again, and the change is a new picture.
    t.tick(2);
    const fresh = await serveCard(req("/og/near/r_known.png"), t.d);
    expect(fresh.headers.etag).not.toBe(etag);
    expect([t.asks(), t.renders()]).toEqual([2, 2]);

    // Unchanged after the next window: asked again, but drawn from the cache.
    t.tick(PICTURE_TTL.near.ask + 1);
    await serveCard(req("/og/near/r_known.png"), t.d);
    expect([t.asks(), t.renders()]).toEqual([3, 2]);

    // A plot and a look keep longer downstream, and the exact version for a year.
    const plot = await serveCard(req("/og/plot/1-2.png"), t.d);
    expect(plot.headers["cache-control"]).toBe("public, max-age=300");
    const key = (plot.headers.etag ?? "").slice(1, -1);
    const pinned = await serveCard(req("/og/look/r_known.png", { version: key }), t.d);
    expect(pinned.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("sends unknown ids, a world that can't answer, and a server without pictures to the static card", async () => {
    const missing = await serveCard(req("/og/look/r_nope.png"), deps().d);
    expect(missing).toMatchObject({
      status: 302,
      headers: { location: "/og.png", "cache-control": "public, max-age=300" },
    });
    const broken = await serveCard(req("/og/near/r_broken.png"), deps().d);
    expect(broken).toMatchObject({ status: 302, headers: { "cache-control": "no-store" } });
    const { picture: _none, ...rest } = deps().d;
    const off = await serveCard(req("/og/plot/0-0.png"), rest);
    expect(off).toMatchObject({ status: 302, headers: { location: "/og.png" } });
    const failing = deps({
      render: async () => {
        throw new Error("boom");
      },
    });
    const failed = await serveCard(req("/og/look/r_known.png"), failing.d);
    expect(failed).toMatchObject({ status: 302, headers: { "cache-control": "no-store" } });
  });

  it("refuses a client over its picture limit before the world is asked", async () => {
    const allow = windowLimiter(2, 60_000, () => 0);
    const t = deps({ allowPicture: (ip) => allow(ip) });
    expect((await serveCard(req("/og/near/r_known.png"), t.d)).status).toBe(200);
    expect((await serveCard(req("/og/near/r_known.png"), t.d)).status).toBe(200);
    const over = await serveCard(req("/og/near/r_known.png"), t.d);
    expect(over).toMatchObject({
      status: 302,
      headers: { location: "/og.png", "cache-control": "no-store" },
    });
    expect(t.asks()).toBe(1);
    // Another client still gets through.
    expect((await serveCard(req("/og/near/r_known.png", { ip: "5.6.7.8" }), t.d)).status).toBe(200);
  });

  it("caps draws across every client, and a client's own renders, while cached pictures still go out", async () => {
    const all = windowLimiter(1, 60_000, () => 0);
    const t = deps({ allowDraw: () => all("all") });
    expect((await serveCard(req("/og/look/r_a.png"), t.d)).status).toBe(200);
    t.show(look("another"));
    const capped = await serveCard(req("/og/look/r_b.png", { ip: "9.9.9.9" }), t.d);
    expect(capped).toMatchObject({ status: 302, headers: { "cache-control": "no-store" } });
    expect(t.renders()).toBe(1);
    // r_a's picture is cached, so it still goes out.
    expect((await serveCard(req("/og/look/r_a.png"), t.d)).status).toBe(200);

    const own = deps({ allowRender: () => false });
    const refused = await serveCard(req("/og/look/r_a.png"), own.d);
    expect(refused).toMatchObject({ status: 302, headers: { "cache-control": "no-store" } });
    expect(own.renders()).toBe(0);
  });

  it("spends a client's render allowance only on a draw, and the server's only for a client with room", async () => {
    const perIp = windowLimiter(1, 60_000, () => 0);
    const server = windowLimiter(2, 60_000, () => 0);
    const t = deps({
      allowRender: (ip, take) => perIp(ip, take),
      allowDraw: () => server("all"),
    });
    expect((await serveCard(req("/og/look/r_a.png", { ip: "A" }), t.d)).status).toBe(200);
    // A is over its own allowance: refused, and the server's draws are untouched.
    t.show(look("c"));
    expect((await serveCard(req("/og/look/r_c.png", { ip: "A" }), t.d)).status).toBe(302);
    expect(server("all", false)).toBe(true);
    t.show(look("b"));
    expect((await serveCard(req("/og/look/r_b.png", { ip: "B" }), t.d)).status).toBe(200);
    // The server is full: C is refused, and keeps its own allowance.
    t.show(look("d"));
    expect((await serveCard(req("/og/look/r_d.png", { ip: "C" }), t.d)).status).toBe(302);
    expect(perIp("C", false)).toBe(true);
    expect(t.renders()).toBe(2);
  });

  it("moves a stale pointer to the new picture once it reads the world again", async () => {
    let drawing = false;
    const t = deps({ allowDraw: () => drawing });
    // The draw is refused, so the pointer names a picture that was never drawn.
    expect((await serveCard(req("/og/look/r_known.png"), t.d)).status).toBe(302);
    expect([t.asks(), t.renders()]).toEqual([1, 0]);
    t.show(look("changed"));
    drawing = true;
    // One read and one draw, under the new key, and then the pointer leads straight to it.
    const drawn = await serveCard(req("/og/look/r_known.png"), t.d);
    expect(drawn.status).toBe(200);
    const again = await serveCard(req("/og/look/r_known.png"), t.d);
    expect(again.headers.etag).toBe(drawn.headers.etag);
    expect([t.asks(), t.renders()]).toEqual([2, 1]);
  });

  it("draws a plot's every storey from above, and a new block upstairs is a new picture (RFC 0028)", async () => {
    const boot = (log: Input[]) => {
      const store = new MemoryStore();
      for (const input of log) store.appendInput(input);
      return new WorldService({ store, config: CONFIG });
    };
    const o = { nowMs: 0, held: () => false, artShown: () => true };
    const keyOf = async (service: WorldService) => {
      const t = deps({ picture: async (route) => pictureSpec(service.state, route, o) });
      const res = await serveCard(req("/og/plot/0-0.png"), t.d);
      expect(res.status).toBe(200);
      return res.headers.etag;
    };
    const log = loftLog("r_ada", "Ada");
    const loft = boot(log);
    const spec = pictureSpec(loft.state, { kind: "plot", px: 0, py: 0 }, o);
    expect(spec).toMatchObject({
      storeys: [{ blocks: [{ x: 1, y: 1, glass: true }] }],
      facts: expect.arrayContaining(["2 storeys"]),
    });
    // The same world is the same picture, and a window more upstairs is a new one.
    const key = await keyOf(loft);
    expect(await keyOf(boot(log))).toBe(key);
    const higher = boot([
      ...log,
      { actor: "r_ada", command: { type: "place", x: 5, y: 1, storey: 1, block: "glass" } },
    ]);
    expect(higher.state.storeys?.["1"]?.blocks["5,1"]).toBe("glass");
    expect(await keyOf(higher)).not.toBe(key);
    // Back in the world, Ada stands on her hearth under the loft's floor: drawn, but faded, as the
    // map draws her.
    expect(loft.ensureOnline("r_ada").ok).toBe(true);
    const home = pictureSpec(loft.state, { kind: "plot", px: 0, py: 0 }, o);
    expect(home?.kind === "plot" && home.figures).toEqual([
      expect.objectContaining({ x: 3.5, faded: true }),
    ]);
  });

  it("remembers an unknown id for a minute, so made-up ids don't each wake the world", async () => {
    const t = deps();
    for (let i = 0; i < 3; i++) {
      expect(await serveCard(req("/og/near/r_nope.png"), t.d)).toMatchObject({
        status: 302,
        headers: { location: "/og.png", "cache-control": "public, max-age=300" },
      });
    }
    expect(t.asks()).toBe(1);
    t.tick(MISSING_TTL + 1);
    await serveCard(req("/og/near/r_nope.png"), t.d);
    expect(t.asks()).toBe(2);
  });
});

describe("pictures on the Node server", () => {
  it("serves each picture as a PNG, and the static card for an unknown one", async () => {
    const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
    const sql = nodeSql();
    cleanups.push(() => sql.close());
    const media = new MemoryMediaStore();
    const social = new SocialService({ sql, media, resident: (id) => service.state.residents[id] });
    const server = createApp({ service, social, media, onResponse, actionsPerSecond: 1000 });
    const base = await listenOnFreePort(server, cleanups);
    const post = async (path: string, body: unknown, token?: string) =>
      (
        await fetch(base + path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        })
      ).json() as Promise<Record<string, unknown>>;
    const wren = (await post("/v1/session", { name: "Wren", kind: "agent", hair: "bun" })) as {
      residentId: string;
      token: string;
    };
    expect((await post("/v1/actions", { type: "settle", px: 0, py: 0 }, wren.token)).ok).toBe(true);
    for (const path of [
      "/og/plot/0-0.png",
      `/og/look/${wren.residentId}.png`,
      `/og/near/${wren.residentId}.png`,
    ]) {
      const res = await fetch(base + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toBe("image/png");
      expect(res.headers.get("etag"), path).toMatch(/^"[0-9a-f]{16}"$/);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(new DataView(bytes.buffer).getUint32(16), path).toBe(1200);
    }
    for (const path of ["/og/plot/2-2.png", "/og/look/r_0000000000000000.png", "/og/near/x.png"]) {
      const res = await fetch(base + path, { redirect: "manual" });
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe("/og.png");
    }
  }, 30_000);
});
