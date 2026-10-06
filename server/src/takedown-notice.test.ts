import { TERRAKIN_ACTOR } from "@terrakin/protocol";
import { ITEMS, inventorySize, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, WorldService } from "./world-service";

/**
 * Takedown notices (decisions 0064, 0065): when staff take down something a resident owns, that
 * resident gets exactly one notice from Terrakin naming what came down, the rule, and where it is
 * now. A piece's picture is the exception: everyone holding or displaying a piece made from it is
 * told too, once per piece. No notice names who acted, who reported, or what staff wrote.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
/** What staff write in the log and reporters write in notes: never shown to the owner. */
const STAFF_REASON = "Staff-only words about this";
const REPORT_NOTE = "Reporter-only words about this";

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;
type Who = { id: string; token: string; name: string };

async function start() {
  let now = Date.UTC(2026, 9, 5, 9);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    shop: true,
    market: true,
  });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const maintainers = new Set<string>();
  const social = new SocialService({
    sql,
    media,
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    residentAgeDays: (id) => service.residentAgeDays(id),
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
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body as Json;
  const everyone: Who[] = [];
  function join(name: string): Who {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    const who = { id: made.residentId, token: made.token, name };
    everyone.push(who);
    return who;
  }
  /** Join, settle, build a home, and put a pedestal at (x0 + 2, y0 + 2). */
  async function settler(name: string, px: number, py: number) {
    const r = join(name);
    await act(r.token, { type: "settle", px, py });
    await act(r.token, { type: "build_starter_home" });
    const x = px * CONFIG.plotSize + 2;
    const y = py * CONFIG.plotSize + 2;
    expect((await act(r.token, { type: "place", x, y, block: "pedestal" })).ok).toBe(true);
    return { ...r, x, y };
  }
  function staff() {
    const r = join("Marlo");
    maintainers.add(r.id);
    return r;
  }
  async function upload(token: string) {
    const bytes = new Uint8Array(64);
    bytes.set(PNG);
    return (await call("POST", "/v1/media", bytes, token)).body.media as Json;
  }
  const report = (who: Who, kind: string, id: string, reason: string) =>
    call("POST", "/v1/reports", { kind, id, reason, note: REPORT_NOTE }, who.token);
  /** Every takedown notice a resident has. */
  const notices = async (who: Who) =>
    (
      (await call("GET", "/v1/notifications", undefined, who.token)).body.notifications as Json[]
    ).filter((n) => n.type === "takedown");
  /**
   * The owner has exactly one notice, everyone else none, and no notice carries staff's or a
   * reporter's identity or words.
   */
  async function onlyOwnerTold(owner: Who, staffer: Who, reporters: Who[]) {
    const mine = await notices(owner);
    expect(mine).toHaveLength(1);
    const notice = mine[0] as Json;
    expect(notice).toMatchObject({ system: true, actor: TERRAKIN_ACTOR, count: 1, postId: null });
    const text = JSON.stringify(notice);
    for (const other of [staffer, ...reporters]) {
      expect(text).not.toContain(other.id);
      expect(text).not.toContain(other.name);
    }
    expect(text).not.toContain(STAFF_REASON);
    expect(text).not.toContain(REPORT_NOTE);
    for (const other of everyone.filter((w) => w.id !== owner.id)) {
      expect(await notices(other)).toEqual([]);
    }
    return notice;
  }
  return {
    call,
    act,
    join,
    settler,
    staff,
    upload,
    report,
    notices,
    onlyOwnerTold,
    service,
    social,
    sql,
    days: (n: number) => {
      now += n * DAY_MS;
      service.tick();
    },
  };
}

describe("takedown notices", () => {
  it("tell a seller their listing came down, the rule the reports named, and that the lot is back", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const cy = t.join("Cy");
    const marlo = t.staff();
    t.days(3);
    await t.act(ada.token, { type: "list_item", item: "jar", price: 3 });
    // Two say hate, one says spam: the notice cites hate.
    expect((await t.report(bob, "listing", "l_1", "hate")).status).toBe(201);
    expect((await t.report(cy, "listing", "l_1", "hate")).status).toBe(201);
    const dee = t.join("Dee");
    expect((await t.report(dee, "listing", "l_1", "spam")).status).toBe(201);

    const done = await t.call(
      "POST",
      "/v1/admin/listings/l_1/remove",
      { reason: STAFF_REASON },
      marlo.token,
    );
    expect(done.status).toBe(200);
    expect(done.body.logged).toMatchObject({ action: "remove_listing", rule: "hate" });
    const notice = await t.onlyOwnerTold(ada, marlo, [bob, cy, dee]);
    expect(notice.takedown).toEqual({
      what: "listing",
      rule: "hate",
      outcome: "returned",
      id: "l_1",
      kind: "jar",
      count: 1,
    });
    expect(notice.read).toBe(false);
    // The staff log keeps the rule with the action.
    const log = (await t.call("GET", "/v1/admin/log", undefined, marlo.token)).body.entries;
    expect(log[0]).toMatchObject({ action: "remove_listing", rule: "hate", reason: STAFF_REASON });

    // The check-in brings it up, by kind and id only, with where to appeal.
    const checkin = (await t.call("GET", "/v1/checkin", undefined, ada.token)).body;
    expect(checkin.notifications.items).toContainEqual(
      expect.objectContaining({ id: notice.id, type: "takedown" }),
    );
    const todo = checkin.todo.join(" ");
    expect(todo).toContain("Staff took down something of yours");
    expect(todo).toContain("(listing l_1)");
    expect(todo).toContain("https://terrakin.org/contact");
    expect(todo).not.toContain(STAFF_REASON);

    // It reads like any notification.
    const read = await t.call("POST", "/v1/notifications/read", { upTo: notice.id }, ada.token);
    expect(read.body.unread).toBe(0);
  });

  it("use the rule staff picked, and say when the lot is held for room", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const marlo = t.staff();
    t.days(3);
    await t.act(ada.token, { type: "list_item", item: "jar", price: 3 });
    await t.report(bob, "listing", "l_1", "hate");
    const inv = t.service.state.items?.inventories[ada.id];
    if (!inv) throw new Error("no things");
    inv.stacks.herb = (inv.stacks.herb ?? 0) + 200;
    const done = await t.call(
      "POST",
      "/v1/admin/listings/l_1/remove",
      { reason: STAFF_REASON, rule: "spam" },
      marlo.token,
    );
    expect(done.status).toBe(200);
    const notice = await t.onlyOwnerTold(ada, marlo, [bob]);
    expect(notice.takedown).toMatchObject({ what: "listing", rule: "spam", outcome: "held" });
  });

  it("tell whoever put a thing up that it came off display, back in their things or held", async () => {
    const t = await start();
    const ash = await t.settler("Ash", 0, 0);
    const wren = await t.settler("Wren", 2, 0);
    const marlo = t.staff();
    const art = await t.upload(ash.token);
    await t.act(ash.token, { type: "make_piece", media: art.id, title: "Morning" });
    const [piece] = (await t.call("GET", "/v1/inventory", undefined, ash.token)).body.inventory
      .goods;
    expect(
      (await t.act(ash.token, { type: "display", item: piece.id, x: ash.x, y: ash.y })).ok,
    ).toBe(true);
    await t.report(wren, "display", piece.id, "harassment");

    const path = `/v1/admin/displays/${piece.id}/remove`;
    expect((await t.call("POST", path, { reason: STAFF_REASON }, marlo.token)).status).toBe(200);
    const notice = await t.onlyOwnerTold(ash, marlo, [wren]);
    expect(notice.takedown).toEqual({
      what: "display",
      rule: "harassment",
      outcome: "returned",
      id: piece.id,
      kind: "piece",
    });

    // Up again with full things: held for Ash, and a second notice says so.
    expect(
      (await t.act(ash.token, { type: "display", item: piece.id, x: ash.x, y: ash.y })).ok,
    ).toBe(true);
    const inv = t.service.state.items?.inventories[ash.id];
    if (!inv) throw new Error("no things");
    inv.stacks.herb = (inv.stacks.herb ?? 0) + ITEMS.inventoryMax - inventorySize(inv);
    const again = { reason: STAFF_REASON, rule: "sexual" };
    expect((await t.call("POST", path, again, marlo.token)).status).toBe(200);
    const [newest] = await t.notices(ash);
    expect(newest?.takedown).toMatchObject({ what: "display", rule: "sexual", outcome: "held" });
  });

  it("tell a piece's maker its picture was deleted, once, however many pieces showed it", async () => {
    const t = await start();
    const ash = await t.settler("Ash", 0, 0);
    const wren = await t.settler("Wren", 2, 0);
    const marlo = t.staff();
    const art = await t.upload(ash.token);
    await t.act(ash.token, { type: "make_piece", media: art.id, title: "Morning" });
    await t.act(ash.token, { type: "make_piece", media: art.id, title: "Evening" });
    const [piece, twin] = (await t.call("GET", "/v1/inventory", undefined, ash.token)).body
      .inventory.goods;
    await t.act(ash.token, { type: "display", item: piece.id, x: ash.x, y: ash.y });
    await t.report(wren, "piece", twin.id, "sexual");
    await t.report(wren, "piece", piece.id, "sexual");
    await t.report(wren, "display", piece.id, "sexual");

    const path = `/v1/admin/pieces/${piece.id}/remove`;
    expect((await t.call("POST", path, { reason: STAFF_REASON }, marlo.token)).status).toBe(200);
    const notice = await t.onlyOwnerTold(ash, marlo, [wren]);
    expect(notice.takedown).toEqual({
      what: "piece",
      rule: "sexual",
      outcome: "removed",
      id: piece.id,
      kind: "piece",
    });
  });

  it("tell a post's author it was hidden, once, even when staff hide it again to retry", async () => {
    const t = await start();
    const bo = t.join("Bo");
    const ada = t.join("Ada");
    const marlo = t.staff();
    const p = (await t.call("POST", "/v1/posts", { text: "Buy my stuff now" }, bo.token)).body.post;
    await t.report(ada, "post", p.id, "spam");
    const path = `/v1/admin/posts/${p.id}/hide`;
    expect((await t.call("POST", path, { reason: STAFF_REASON }, marlo.token)).status).toBe(200);
    expect((await t.call("POST", path, { reason: STAFF_REASON }, marlo.token)).status).toBe(200);
    const notice = await t.onlyOwnerTold(bo, marlo, [ada]);
    expect(notice.takedown).toEqual({ what: "post", rule: "spam", outcome: "removed", id: p.id });
    // Its start, so the author knows which: their own words, marked untrusted like any excerpt.
    expect(notice).toMatchObject({ excerpt: "Buy my stuff now", trust: "untrusted" });
    // The retry's log row cites the same rule, though the reports had closed.
    const rules = [...t.sql.exec("SELECT rule FROM moderation_log WHERE action = 'hide_post'")];
    expect(rules).toEqual([{ rule: "spam" }, { rule: "spam" }]);
    // Deleting the post takes the notice, and its quote, with it.
    expect((await t.call("DELETE", `/v1/posts/${p.id}`, undefined, bo.token)).status).toBe(204);
    expect(await t.notices(bo)).toEqual([]);
  });

  it("never tell someone who may be at risk that they broke a rule", async () => {
    const t = await start();
    const bo = t.join("Bo");
    const ada = t.join("Ada");
    const marlo = t.staff();
    const first = (await t.call("POST", "/v1/posts", { text: "A hard day" }, bo.token)).body.post;
    await t.report(ada, "post", first.id, "self_harm");
    const hide = (id: string, body: object) =>
      t.call("POST", `/v1/admin/posts/${id}/hide`, { reason: STAFF_REASON, ...body }, marlo.token);
    expect((await hide(first.id, {})).status).toBe(200);
    const second = (await t.call("POST", "/v1/posts", { text: "Another" }, bo.token)).body.post;
    expect((await hide(second.id, { rule: "self_harm" })).status).toBe(200);
    const rules = (await t.notices(bo)).map((n) => n.takedown.rule);
    expect(rules).toEqual(["other", "other"]);
  });

  it("reach a reader that can only open links, in the link check-in", async () => {
    const t = await start();
    const joined = await t.call("GET", "/v1/join?name=Bo");
    const key = /k_[A-Za-z0-9_-]{43}/.exec(joined.text)?.[0];
    const id = /`(r_[0-9a-f]{16})`/.exec(joined.text)?.[1];
    if (!key || !id) throw new Error(`No key in:\n${joined.text}`);
    const marlo = t.staff();
    const ada = t.join("Ada");
    const made = t.social.createPost(id, { text: "Buy my stuff now" });
    if (!made.ok) throw new Error("no post");
    const post = made.value;
    await t.report(ada, "post", post.id, "spam");
    const path = `/v1/admin/posts/${post.id}/hide`;
    expect((await t.call("POST", path, { reason: STAFF_REASON }, marlo.token)).status).toBe(200);
    const page = (await t.call("GET", `/v1/act/${key}/checkin`)).text;
    expect(page).toContain(`Takedown from Terrakin at`);
    expect(page).toContain(
      `staff took down your post \`${post.id}\` for breaking the rule \`spam\`, and it's gone.`,
    );
    expect(page).toContain("/contact");
    expect(page).not.toContain(STAFF_REASON);
    expect(page).not.toContain("Marlo");
    expect(page).not.toContain("Buy my stuff now");
  });

  it("tell a resident their pictures were deleted, once the files are gone", async () => {
    const t = await start();
    const bo = t.join("Bo");
    const ada = t.join("Ada");
    const marlo = t.staff();
    const avatar = await t.upload(bo.token);
    await t.call("PUT", "/v1/profile", { avatar: avatar.id }, bo.token);
    await t.report(ada, "resident", bo.id, "impersonation");
    const path = `/v1/admin/residents/${bo.id}/remove-pictures`;
    expect((await t.call("POST", path, { reason: STAFF_REASON }, marlo.token)).status).toBe(200);
    const notice = await t.onlyOwnerTold(bo, marlo, [ada]);
    expect(notice.takedown).toEqual({
      what: "pictures",
      rule: "impersonation",
      outcome: "removed",
    });
    const rows = [...t.sql.exec("SELECT action, rule FROM moderation_log")];
    expect(rows).toEqual([{ action: "remove_pictures", rule: "impersonation" }]);
  });

  it("cite our community rules in general when nobody named one", async () => {
    const t = await start();
    const bo = t.join("Bo");
    const marlo = t.staff();
    const p = (await t.call("POST", "/v1/posts", { text: "Hello" }, bo.token)).body.post;
    const path = `/v1/admin/posts/${p.id}/hide`;
    expect((await t.call("POST", path, { reason: STAFF_REASON }, marlo.token)).status).toBe(200);
    const [notice] = await t.notices(bo);
    expect(notice?.takedown).toMatchObject({ what: "post", rule: "other" });
  });
});
