import type { ServerMessage, WorldEvent } from "@terrakin/protocol";
import { displayAt, heldAsideOf, ITEMS, inventorySize, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, WorldService } from "./world-service";

/**
 * Reports on a thing on display and on a piece of art, and the staff routes that take one down
 * (decision 0059), end to end over HTTP.
 */

// 3x3 plots of 8 tiles. Settling plot (0, 0) and building the starter home leaves you on the
// hearth at (3, 3), inside a hut from (1, 1) to (5, 5).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

/** A PNG header padded out, the smallest picture the server takes. */
const png = () => {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  return bytes;
};

async function start() {
  let now = Date.UTC(2026, 9, 5, 9);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
  });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const maintainers = new Set<string>();
  const social = new SocialService({
    sql,
    media,
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    maintainers,
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  cleanups.push(() => sql.close());
  const base = await listenOnFreePort(server, cleanups);
  const call = jsonCaller(base);
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body as Json;
  async function upload(token: string) {
    const res = await fetch(`${base}/v1/media`, {
      method: "POST",
      headers: { "content-type": "image/png", authorization: `Bearer ${token}` },
      body: new Blob([png()]),
    });
    return ((await res.json()) as Json).media as Json;
  }
  function join(name: string) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  }
  /** Join, settle a plot, build a home, and put a pedestal at (x0 + 2, y0 + 2). */
  async function settler(name: string, px: number, py: number) {
    const r = join(name);
    await act(r.token, { type: "settle", px, py });
    await act(r.token, { type: "build_starter_home" });
    const x0 = px * CONFIG.plotSize;
    const y0 = py * CONFIG.plotSize;
    const placed = await act(r.token, { type: "place", x: x0 + 2, y: y0 + 2, block: "pedestal" });
    expect(placed.ok).toBe(true);
    return { ...r, x: x0 + 2, y: y0 + 2 };
  }
  /** A maintainer, who works the staff routes with their token (no Access on this server). */
  function staff() {
    const r = join("Marlo");
    maintainers.add(r.id);
    return r;
  }
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WorldEvent[];
  };
  const nextDay = () => {
    now += DAY_MS;
    service.tick();
  };
  return {
    call,
    act,
    upload,
    settler,
    staff,
    listen,
    nextDay,
    service,
    social,
    media,
    maintainers,
  };
}

/** Ash's piece of art on his pedestal, and Wren next door. */
async function shown() {
  const t = await start();
  const ash = await t.settler("Ash", 0, 0);
  const wren = await t.settler("Wren", 2, 0);
  const art = await t.upload(ash.token);
  await t.act(ash.token, { type: "make_piece", media: art.id, title: "Morning" });
  await t.act(ash.token, { type: "make_piece", media: art.id, title: "Evening" });
  const [piece, twin] = (await t.call("GET", "/v1/inventory", undefined, ash.token)).body.inventory
    .goods;
  const up = await t.act(ash.token, { type: "display", item: piece.id, x: ash.x, y: ash.y });
  expect(up.ok).toBe(true);
  return { t, ash, wren, art, piece, twin, marlo: t.staff() };
}

describe("reporting a thing on display", () => {
  it("reaches the queue with its picture and who put it up, and staff take it off display", async () => {
    const { t, ash, wren, art, piece, marlo } = await shown();
    const report = { kind: "display", id: piece.id, reason: "sexual" };
    expect((await t.call("POST", "/v1/reports", report, wren.token)).status).toBe(201);
    expect((await t.call("POST", "/v1/reports", report, ash.token)).status).toBe(400);
    expect(
      (await t.call("POST", "/v1/reports", { ...report, id: "i_99" }, wren.token)).status,
    ).toBe(404);
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect((await t.call("POST", "/v1/reports", { ...report, id }, wren.token)).status).toBe(404);
    }
    // Reported as a piece too: one takedown settles both, and counts once against Ash.
    const asPiece = { kind: "piece", id: piece.id, reason: "other" };
    expect((await t.call("POST", "/v1/reports", asPiece, wren.token)).status).toBe(201);
    const queue = (await t.call("GET", "/v1/admin/reports", undefined, marlo.token)).body;
    expect(queue.items).toContainEqual(
      expect.objectContaining({
        kind: "piece",
        id: piece.id,
        target: expect.objectContaining({ onDisplay: true }),
      }),
    );
    expect(queue.items.filter((i: Json) => i.kind === "display")).toEqual([
      expect.objectContaining({
        kind: "display",
        id: piece.id,
        target: expect.objectContaining({
          exists: true,
          trust: "untrusted",
          text: "Piece of art\nMorning",
          author: expect.objectContaining({ id: ash.id }),
          media: [expect.objectContaining({ id: art.id, kind: "image" })],
        }),
      }),
    ]);

    // Only staff may take it down.
    const why = { reason: "Not for a public pedestal" };
    const path = `/v1/admin/displays/${piece.id}/remove`;
    expect((await t.call("POST", path, why)).status).toBe(401);
    expect((await t.call("POST", path, why, wren.token)).status).toBe(403);
    expect((await t.call("POST", path, why, ash.token)).status).toBe(403);
    expect(
      (await t.call("POST", "/v1/admin/displays/__proto__/remove", why, marlo.token)).status,
    ).toBe(400);
    expect(displayAt(t.service.state, ash.x, ash.y)).toBeDefined();

    const ashHeard = t.listen(ash.id);
    const wrenHeard = t.listen(wren.id);
    const done = await t.call("POST", path, why, marlo.token);
    expect(done.status).toBe(200);
    expect(done.body.logged).toMatchObject({
      action: "remove_display",
      kind: "display",
      id: piece.id,
    });
    // It's back with Ash, picture and all, and he hears both; Wren only that it went.
    const removed = { type: "display_removed", x: ash.x, y: ash.y, item: piece.id, by: ash.id };
    expect(ashHeard()).toEqual([
      removed,
      expect.objectContaining({ type: "inventory", residentId: ash.id, reason: "taken_down" }),
    ]);
    expect(wrenHeard()).toEqual([removed]);
    const things = (await t.call("GET", "/v1/inventory", undefined, ash.token)).body.inventory;
    expect(things.goods).toContainEqual(expect.objectContaining({ id: piece.id, media: art.id }));
    expect((await t.call("GET", "/v1/world")).body.displays).toBeUndefined();

    // The report closed, the log and the transparency page count it, and so does Ash's karma.
    expect((await t.call("GET", "/v1/admin/reports", undefined, marlo.token)).body.items).toEqual(
      [],
    );
    const log = (await t.call("GET", "/v1/admin/log", undefined, marlo.token)).body.entries;
    expect(log[0]).toMatchObject({ action: "remove_display", id: piece.id, actor: marlo.id });
    expect((await t.call("GET", "/v1/transparency")).body.actions.remove_display).toBe(1);
    expect(t.social.safety.upheldAgainst(0, Date.UTC(2030, 0, 1))).toEqual([ash.id]);
    // Twice is not found.
    expect((await t.call("POST", path, why, marlo.token)).status).toBe(404);
  });

  it("holds it aside when the owner's things are full, and the check-in says so", async () => {
    const { t, ash, piece, marlo } = await shown();
    const items = t.service.state.items;
    const inv = items?.inventories[ash.id];
    if (!items || !inv) throw new Error("no things");
    inv.stacks.herb = (inv.stacks.herb ?? 0) + ITEMS.inventoryMax - inventorySize(inv);
    const done = await t.call(
      "POST",
      `/v1/admin/displays/${piece.id}/remove`,
      { reason: "Spam" },
      marlo.token,
    );
    expect(done.status).toBe(200);
    expect(inventorySize(inv)).toBe(ITEMS.inventoryMax);
    expect(heldAsideOf(t.service.state, ash.id).map((d) => d.good.id)).toEqual([piece.id]);
    const things = (await t.call("GET", "/v1/inventory", undefined, ash.token)).body.inventory;
    expect(things.heldAside).toEqual([expect.objectContaining({ id: piece.id })]);
    const checkin = (await t.call("GET", "/v1/checkin", undefined, ash.token)).body;
    expect(checkin.todo.join(" ")).toContain(
      `taken down while your things were full (${piece.id})`,
    );
    // Making room brings it back with that same action, and the check-in lets it go.
    inv.stacks.herb = 1;
    const moved = await t.act(ash.token, { type: "move", dir: "s" });
    expect(moved.events).toContainEqual(
      expect.objectContaining({ type: "inventory", reason: "held" }),
    );
    const after = (await t.call("GET", "/v1/inventory", undefined, ash.token)).body.inventory;
    expect(after.heldAside).toBeUndefined();
    expect(after.goods).toContainEqual(expect.objectContaining({ id: piece.id }));
    const later = (await t.call("GET", "/v1/checkin", undefined, ash.token)).body;
    expect(later.todo.join(" ")).not.toContain("taken down while your things were full");
  });
});

describe("reporting a piece", () => {
  it("deletes its picture everywhere: the file, every piece made from it, and the display", async () => {
    const { t, ash, wren, art, piece, twin, marlo } = await shown();
    // The same picture is Ash's avatar too: a picture unfit for a pedestal goes everywhere.
    const avatar = await t.call("PUT", "/v1/profile", { avatar: art.id }, ash.token);
    expect(avatar.body.resident.avatar).toBe(`/media/${art.id}`);
    const report = { kind: "piece", id: twin.id, reason: "sexual" };
    expect((await t.call("POST", "/v1/reports", report, wren.token)).status).toBe(201);
    const shownReport = { kind: "display", id: piece.id, reason: "sexual" };
    expect((await t.call("POST", "/v1/reports", shownReport, wren.token)).status).toBe(201);
    const pieceReport = { ...report, id: piece.id };
    expect((await t.call("POST", "/v1/reports", pieceReport, wren.token)).status).toBe(201);
    const queue = (await t.call("GET", "/v1/admin/reports", undefined, marlo.token)).body.items;
    expect(queue).toContainEqual(
      expect.objectContaining({
        kind: "piece",
        id: twin.id,
        target: expect.objectContaining({
          text: "Piece of art\nEvening",
          author: expect.objectContaining({ id: ash.id }),
          media: [expect.objectContaining({ id: art.id })],
        }),
      }),
    );

    const why = { reason: "Explicit picture" };
    const path = `/v1/admin/pieces/${piece.id}/remove`;
    expect((await t.call("POST", path, why)).status).toBe(401);
    expect((await t.call("POST", path, why, wren.token)).status).toBe(403);
    expect(await t.media.get(art.id)).toBeDefined();

    const wrenHeard = t.listen(wren.id);
    const done = await t.call("POST", path, why, marlo.token);
    expect(done.status).toBe(200);
    expect(done.body.logged).toMatchObject({ action: "remove_piece", kind: "piece", id: piece.id });
    // The file is gone from storage and from the avatar.
    expect(await t.media.get(art.id)).toBeUndefined();
    expect((await t.call("GET", `/v1/residents/${ash.id}`)).body.resident.avatar).toBeNull();
    // Both pieces keep their titles and lose the picture; the one on display came down.
    const goods = (await t.call("GET", "/v1/inventory", undefined, ash.token)).body.inventory.goods;
    expect(goods).toEqual([
      expect.not.objectContaining({ media: expect.anything() }),
      expect.not.objectContaining({ media: expect.anything() }),
    ]);
    expect(goods.map((g: Json) => g.label).sort()).toEqual(["Evening", "Morning"]);
    expect(wrenHeard()).toEqual([
      { type: "picture_removed", items: expect.arrayContaining([piece.id, twin.id]) },
      { type: "display_removed", x: ash.x, y: ash.y, item: piece.id, by: ash.id },
    ]);
    // Every report on every piece that showed it closed, and each piece counts once against its
    // maker's karma, however it was reported.
    expect((await t.call("GET", "/v1/admin/reports", undefined, marlo.token)).body.items).toEqual(
      [],
    );
    expect(t.social.safety.upheldAgainst(0, Date.UTC(2030, 0, 1))).toEqual([ash.id, ash.id]);
    expect((await t.call("GET", "/v1/transparency")).body.actions.remove_piece).toBe(1);
    // No picture left: nothing to remove, and a restart pins nothing for it.
    expect((await t.call("POST", path, why, marlo.token)).status).toBe(404);
    expect(t.service.allPieceMedia()).toEqual([]);
  });

  it("won't delete a staff member's picture", async () => {
    const { t, ash, piece, marlo } = await shown();
    t.maintainers.add(ash.id);
    const path = `/v1/admin/pieces/${piece.id}/remove`;
    expect((await t.call("POST", path, { reason: "Explicit" }, marlo.token)).status).toBe(400);
    expect(t.service.allPieceMedia()).toHaveLength(2);
  });

  it("changes nothing in the world when storage refuses, so staff can try again", async () => {
    const { t, art, piece, marlo } = await shown();
    const remove = t.media.delete.bind(t.media);
    t.media.delete = async () => {
      throw new Error("storage down");
    };
    const path = `/v1/admin/pieces/${piece.id}/remove`;
    const failed = await t.call("POST", path, { reason: "Explicit" }, marlo.token);
    expect(failed.status).toBe(500);
    expect(t.service.allPieceMedia().map(([, m]) => m)).toEqual([art.id, art.id]);
    t.media.delete = remove;
    expect((await t.call("POST", path, { reason: "Explicit" }, marlo.token)).status).toBe(200);
    t.nextDay();
    expect(t.service.allPieceMedia()).toEqual([]);
  });
});
