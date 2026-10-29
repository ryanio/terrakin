import { cards } from "@terrakin/cards/node";
import { type PhotoScene, SCENE_PHOTO_LIMITS } from "@terrakin/protocol";
import { DAY_MS, type Input, MINUTE_MS, type WorldConfig, type WorldEvent } from "@terrakin/sim";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { eventWords } from "./events";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import type { SceneRenderer } from "./scene-photo-desk";
import { momentsOf, momentWords } from "./scene-photos";
import { type SocialLimits, SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, recordTelemetry, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Scene photos (RFC 0049): a server without the option answers 404, every guard and the town's
 * day refuse before a browser opens, a failed render counts against nobody, and each subject's
 * rules (plots, events, friends, blocks) hold.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const HOUR = 60 * MINUTE_MS;

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

let PNG: Uint8Array = new Uint8Array(0);
beforeAll(async () => {
  PNG = (await cards.render({ kind: "site" })).bytes;
}, 30_000);

// biome-ignore lint/suspicious/noExplicitAny: a JSON body, read as the tests read answers.
type Json = Record<string, any>;

interface Options {
  /** Off: no `scenePhotos` option at all. */
  off?: boolean;
  /** The renderer. Default: a fake that reads its ticket's scene and hands back a PNG. */
  render?: SceneRenderer;
  limits?: Partial<SocialLimits>;
  ipUploadBytesPerDay?: number;
  /** How long the desk waits on a render, ms. */
  timeoutMs?: number;
}

async function start(options: Options = {}) {
  let now = Date.UTC(2026, 9, 6, 9);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    presence: true,
    townEvents: () => [],
  });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    residentAgeDays: (id) => service.residentAgeDays(id),
    credits: (since) => service.credits(since),
    event: (id) => eventWords(service.state, id),
    limits: options.limits ?? {},
  });
  const renders: { url: string; scene: PhotoScene | undefined }[] = [];
  let base = "";
  const fake: SceneRenderer = async (url) => {
    // The page reads its scene with the ticket, as the browser does.
    const ticket = new URL(url).searchParams.get("t") ?? "";
    const read = await fetch(`${base}/v1/photos/scene/${ticket}`);
    renders.push({ url, scene: read.ok ? ((await read.json()) as PhotoScene) : undefined });
    return PNG;
  };
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    now: () => now,
    ...(options.ipUploadBytesPerDay === undefined
      ? {}
      : { ipUploadBytesPerDay: options.ipUploadBytesPerDay }),
    ...(options.off
      ? {}
      : {
          scenePhotos: {
            render: options.render ?? fake,
            origin: "https://photo.test",
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
            // Waiting for a free render moves the test's clock instead of sleeping.
            sleep: async (ms: number) => {
              now += ms;
            },
          },
        }),
  });
  base = await listenOnFreePort(server, cleanups);
  const call = jsonCaller(base);
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  function resident(name: string) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  }
  async function settler(name: string, px: number, py: number) {
    const r = resident(name);
    expect(await act(r.token, { type: "settle", px, py })).toMatchObject({ ok: true });
    expect(await act(r.token, { type: "build_starter_home" })).toMatchObject({ ok: true });
    return r;
  }
  const photo = (who: { token: string }, body: Json) => call("POST", "/v1/photos", body, who.token);
  const later = (ms: number) => {
    now += ms;
    service.tick();
    service.sweepEvents();
  };
  return { call, act, resident, settler, photo, later, service, social, renders, now: () => now };
}

describe("POST /v1/photos on a server without scene photos", () => {
  it("answers not_found", async () => {
    const t = await start({ off: true });
    const ada = await t.settler("Ada", 0, 0);
    const res = await t.photo(ada, { subject: "me" });
    expect([res.status, res.body.error.code]).toEqual([404, "not_found"]);
    const moments = await t.call("GET", "/v1/photos/moments", undefined, ada.token);
    expect(moments.status).toBe(404);
    // The photo page's read is dark on such a server: not matched at all, whatever the ticket.
    expect((await t.call("GET", "/v1/photos/scene/nope")).status).toBe(404);
  });
});

describe("POST /v1/photos", () => {
  it("takes you where you stand, stored as your upload, with a ticket good only while it draws", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const res = await t.photo(ada, { subject: "me", framing: "portrait" });
    expect(res.status).toBe(201);
    expect(res.body.media).toMatchObject({
      kind: "image",
      type: "image/png",
      place: { px: 0, py: 0 },
    });
    const [render] = t.renders;
    expect(render?.url).toMatch(/^https:\/\/photo\.test\/photo\?t=pt_[0-9a-f]{32}$/);
    expect(render?.scene).toMatchObject({
      framing: "portrait",
      names: false,
      focus: { id: ada.id },
      plot: { px: 0, py: 0 },
    });
    expect(render?.scene?.first[0]).toBe(ada.id);
    expect(render?.scene?.stamp).toMatch(/Plot 0, 0/);
    // The ticket goes with the render: a second read finds nothing.
    const ticket = new URL(render?.url ?? "").searchParams.get("t");
    expect((await t.call("GET", `/v1/photos/scene/${ticket}`)).status).toBe(404);
  });

  it("refuses render 101 of the day before any browser opens, and gives the day back at midnight", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    // 99 of today's renders taken by others; Ada's is the 100th.
    for (let i = 1; i < SCENE_PHOTO_LIMITS.perDay; i++)
      expect(t.social.scenePhotos.reserve().ok).toBe(true);
    expect((await t.photo(ada, { subject: "me" })).status).toBe(201);
    expect(t.renders).toHaveLength(1);
    const refused = await t.photo(ada, { subject: "me" });
    expect([refused.status, refused.body.error.code]).toEqual([503, "photos_busy"]);
    expect(refused.body.error.message).toMatch(/POST \/v1\/plots\/photo/);
    const toMidnight = Math.ceil((Math.ceil(t.now() / DAY_MS) * DAY_MS - t.now()) / 1000);
    expect(refused.body.error.retryAfter).toBe(toMidnight);
    expect(refused.headers.get("retry-after")).toBe(String(toMidnight));
    expect(t.renders).toHaveLength(1);
    expect(t.social.scenePhotos.townToday()).toBe(SCENE_PHOTO_LIMITS.perDay);
    t.later(toMidnight * 1000);
    expect((await t.photo(ada, { subject: "me" })).status).toBe(201);
    expect(t.renders).toHaveLength(2);
  });

  it("gives a failed render's slot back, counts it against nobody, and reports only the step", async () => {
    const telemetry = recordTelemetry();
    telemetry.start();
    const failures = [
      new Error("the page wasn't ready in time"),
      new Error("net::ERR_FAILED at https://terrakin.org/photo?t=pt_0123456789abcdef"),
    ];
    let fails = true;
    const t = await start({
      render: async () => {
        const failure = failures.shift();
        if (fails && failure) throw failure;
        return PNG;
      },
    });
    const ada = await t.settler("Ada", 0, 0);
    const res = await t.photo(ada, { subject: "me" });
    expect([res.status, res.body.error.code, res.body.error.retryAfter]).toEqual([
      503,
      "photos_busy",
      60,
    ]);
    expect(t.social.scenePhotos.townToday()).toBe(0);
    expect(t.social.scenePhotos.residentToday(ada.id)).toBe(0);
    // A browser's own message carries the ticket, so only its kind is reported.
    expect((await t.photo(ada, { subject: "me" })).status).toBe(503);
    expect(telemetry.reports).toEqual([
      "scene render failed: not ready",
      "scene render failed: Error",
    ]);
    telemetry.stop();
    fails = false;
    expect((await t.photo(ada, { subject: "me" })).status).toBe(201);
    expect(t.social.scenePhotos.townToday()).toBe(1);
  });

  it("stops trying for the day once the day's failures are spent, without opening a browser", async () => {
    let opened = 0;
    const t = await start({
      render: async () => {
        opened++;
        throw new Error("the page never said ready");
      },
    });
    // Three residents taking turns, a quarter minute apart, inside every rate limit.
    const residents = [
      await t.settler("Ada", 0, 0),
      await t.settler("Bob", 2, 0),
      await t.settler("Cy", 0, 2),
    ];
    let refused = 0;
    for (let i = 0; i < SCENE_PHOTO_LIMITS.failuresPerDay; i++) {
      const res = await t.photo(residents[i % residents.length] as { token: string }, {
        subject: "me",
      });
      expect(res.body.error.code).toBe("photos_busy");
      refused++;
      t.later(15_000);
    }
    expect(opened).toBe(SCENE_PHOTO_LIMITS.failuresPerDay);
    // Each failure gave its slot back, and the next request opens nothing.
    expect(t.social.scenePhotos.townToday()).toBe(0);
    const next = await t.photo(residents[0] as { token: string }, { subject: "me" });
    expect(next.body.error.code).toBe("photos_busy");
    expect(next.body.error.retryAfter).toBeGreaterThan(60);
    expect(opened).toBe(refused);
  });

  it("refuses over the IP's limit and the upload caps before a browser opens", async () => {
    // Six a minute from one IP, across residents.
    const t = await start();
    const who = [
      await t.settler("Ada", 0, 0),
      await t.settler("Bob", 2, 0),
      await t.settler("Cy", 0, 2),
      await t.settler("Di", 2, 2),
    ];
    for (let i = 0; i < 6; i++)
      expect((await t.photo(who[i % 3] as { token: string }, { subject: "me" })).status).toBe(201);
    const ip = await t.photo(who[3] as { token: string }, { subject: "me" });
    expect([ip.status, ip.body.error.code]).toEqual([429, "rate_limited"]);
    expect(t.renders).toHaveLength(6);
    // No uploads left for the resident today.
    const full = await start({ limits: { uploadsPerDay: 0 } });
    const eve = await full.settler("Eve", 0, 0);
    const room = await full.photo(eve, { subject: "me" });
    expect([room.status, room.body.error.code]).toEqual([429, "rate_limited"]);
    expect(full.renders).toHaveLength(0);
    // No upload bytes left for the IP today, under what a photo is assumed to take.
    const thin = await start({ ipUploadBytesPerDay: 1_000_000 });
    const fay = await thin.settler("Fay", 0, 0);
    const bytes = await thin.photo(fay, { subject: "me" });
    expect([bytes.status, bytes.body.error.code]).toEqual([429, "rate_limited"]);
    expect(thin.renders).toHaveLength(0);
    // None of them took one of the town's renders.
    expect(full.social.scenePhotos.townToday()).toBe(0);
    expect(thin.social.scenePhotos.townToday()).toBe(0);
  });

  it("holds a slow render's place until its browser is done, after it's given up on", async () => {
    const hold: (() => void)[] = [];
    let opened = 0;
    const t = await start({
      timeoutMs: 50,
      render: () => {
        opened++;
        return new Promise((done) => hold.push(() => done(PNG)));
      },
    });
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const cy = await t.settler("Cy", 0, 2);
    // The desk gives up on both, but their browsers are still open.
    expect((await t.photo(ada, { subject: "me" })).body.error.code).toBe("photos_busy");
    expect((await t.photo(bob, { subject: "me" })).body.error.code).toBe("photos_busy");
    expect(opened).toBe(2);
    const third = await t.photo(cy, { subject: "me" });
    expect([third.body.error.code, third.body.error.retryAfter]).toEqual(["photos_busy", 10]);
    expect(opened).toBe(2);
    // Once they close, there's room again.
    for (const done of hold.splice(0)) done();
    await expect
      .poll(async () => (await t.photo(cy, { subject: "me" })).body.error?.code)
      .toBe("photos_busy");
    expect(opened).toBe(3);
  });

  it("takes two at once, and a third waits a little and then answers photos_busy", async () => {
    const hold: (() => void)[] = [];
    let opened = 0;
    const t = await start({
      render: () => {
        opened++;
        return new Promise((done) => hold.push(() => done(PNG)));
      },
    });
    const [ada, bob, cy] = [
      await t.settler("Ada", 0, 0),
      await t.settler("Bob", 2, 0),
      await t.settler("Cy", 0, 2),
    ];
    const first = t.photo(ada, { subject: "me" });
    const second = t.photo(bob, { subject: "me" });
    await expect.poll(() => opened).toBe(2);
    const third = await t.photo(cy, { subject: "me" });
    expect([third.status, third.body.error.code, third.body.error.retryAfter]).toEqual([
      503,
      "photos_busy",
      10,
    ]);
    expect(opened).toBe(2);
    for (const done of hold) done();
    expect((await first).status).toBe(201);
    expect((await second).status).toBe(201);
    // The third gave its slot back: two of the day's renders are used.
    expect(t.social.scenePhotos.townToday()).toBe(2);
  });

  it("counts a resident's photos as they start, so three at once can't pass the day", async () => {
    const hold: (() => void)[] = [];
    const t = await start({
      render: () => new Promise((done) => hold.push(() => done(PNG))),
    });
    const ada = await t.settler("Ada", 0, 0);
    // Four already today; two start together and both take a place, so a third is refused.
    for (let i = 0; i < SCENE_PHOTO_LIMITS.perResidentPerDay - 2; i++)
      t.social.scenePhotos.taken(ada.id, Math.floor(t.now() / DAY_MS));
    const first = t.photo(ada, { subject: "me" });
    const second = t.photo(ada, { subject: "me" });
    await expect.poll(() => hold.length).toBe(2);
    const third = await t.photo(ada, { subject: "me" });
    expect([third.status, third.body.error.code]).toEqual([429, "rate_limited"]);
    for (const done of hold) done();
    expect((await first).status).toBe(201);
    expect((await second).status).toBe(201);
    expect(t.social.scenePhotos.residentToday(ada.id)).toBe(SCENE_PHOTO_LIMITS.perResidentPerDay);
  });

  it("refuses a resident's seventh of the day before drawing", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    for (let i = 0; i < SCENE_PHOTO_LIMITS.perResidentPerDay; i++) {
      expect((await t.photo(ada, { subject: "me" })).status).toBe(201);
      t.later(MINUTE_MS);
    }
    const res = await t.photo(ada, { subject: "me" });
    expect([res.status, res.body.error.code]).toEqual([429, "rate_limited"]);
    expect(t.renders).toHaveLength(SCENE_PHOTO_LIMITS.perResidentPerDay);
  });

  it("photographs a claimed plot from its south side, never the Commons or an empty plot", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const res = await t.photo(bob, { subject: "plot", px: 0, py: 0, framing: "wide" });
    expect(res.status).toBe(201);
    expect(res.body.media.place).toEqual({ px: 0, py: 0 });
    expect(t.renders[0]?.scene).toMatchObject({
      framing: "wide",
      plot: { px: 0, py: 0 },
      focus: { x: 3.5, y: 3.5 },
    });
    // The middle plot of this 3 by 3 world is the Commons.
    const square = await t.photo(ada, { subject: "plot", px: 1, py: 1 });
    expect(square.body.error.code).toBe("plot_is_commons");
    expect((await t.photo(ada, { subject: "plot", px: 2, py: 2 })).body.error.code).toBe(
      "plot_unclaimed",
    );
    // A portrait is of one resident.
    const portrait = await t.photo(ada, { subject: "plot", px: 0, py: 0, framing: "portrait" });
    expect([portrait.status, portrait.body.error.code]).toEqual([400, "bad_request"]);
    expect(t.renders).toHaveLength(1);
  });
});

describe("POST /v1/photos of friends", () => {
  it("takes a friend who follows you back and is out and about, and refuses everyone else", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const follow = (who: { token: string }, id: string) =>
      t.call("PUT", `/v1/residents/${id}/follow`, undefined, who.token);
    // Ada follows Bob, Bob doesn't follow back: not friends.
    await follow(ada, bob.id);
    const oneWay = await t.photo(ada, { subject: "friend", id: bob.id });
    expect([oneWay.status, oneWay.body.error.code]).toEqual([403, "not_friends"]);
    await follow(bob, ada.id);
    const res = await t.photo(ada, { subject: "friend", id: bob.id, framing: "portrait" });
    expect(res.status).toBe(201);
    expect(t.renders[0]?.scene).toMatchObject({ focus: { id: bob.id } });
    expect(t.renders[0]?.scene?.first[0]).toBe(bob.id);
    // Asleep at home: away, and never photographed.
    t.service.leave(bob.id);
    const away = await t.photo(ada, { subject: "friend", id: bob.id });
    expect([away.status, away.body.error.code]).toEqual([409, "away"]);
    // Yourself is `me`, not a friend. (A minute on, past the route's burst.)
    t.later(MINUTE_MS);
    expect((await t.photo(ada, { subject: "friend", id: ada.id })).body.error.code).toBe(
      "not_friends",
    );
    expect(t.renders).toHaveLength(1);
  });

  it("leaves out anyone blocked either way, and a friend who blocked you is out of reach", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const cy = await t.settler("Cy", 0, 2);
    for (const [who, id] of [
      [ada, bob.id],
      [bob, ada.id],
    ] as const)
      await t.call("PUT", `/v1/residents/${id}/follow`, undefined, who.token);
    expect((await t.photo(ada, { subject: "me" })).status).toBe(201);
    expect(t.renders[0]?.scene?.shown).toEqual(expect.arrayContaining([ada.id, bob.id, cy.id]));
    // Cy blocked Ada: Cy is left out of Ada's photos.
    await t.call("PUT", `/v1/residents/${ada.id}/block`, undefined, cy.token);
    // Ada blocked Bob: her friend is out of reach, and out of her other photos too.
    await t.call("PUT", `/v1/residents/${bob.id}/block`, undefined, ada.token);
    expect((await t.photo(ada, { subject: "friend", id: bob.id })).body.error.code).toBe(
      "not_friends",
    );
    expect((await t.photo(ada, { subject: "me" })).status).toBe(201);
    const shown = t.renders[1]?.scene?.shown ?? [];
    expect(shown).toContain(ada.id);
    expect(shown).not.toContain(bob.id);
    expect(shown).not.toContain(cy.id);
  });
});

describe("POST /v1/photos of events", () => {
  it("is for its host and guests, while it runs and in the hour after", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const cy = await t.settler("Cy", 0, 2);
    // Settled three days ago and here today, so Ada may host.
    t.later(3 * DAY_MS);
    for (const r of [ada, bob, cy])
      expect(await t.act(r.token, { type: "move", dir: "n" })).toMatchObject({ ok: true });
    const noon = Math.floor(t.now() / DAY_MS) * DAY_MS + 12 * HOUR;
    const scheduled = await t.act(ada.token, {
      type: "schedule_event",
      kind: "listening",
      title: "Records",
      text: "",
      px: 0,
      py: 0,
      startsAt: new Date(noon).toISOString(),
      minutes: 60,
    });
    expect(scheduled).toMatchObject({ ok: true });
    const id = t.service.state.events?.list[0]?.id ?? "";
    // Before it starts there's nothing to photograph.
    expect((await t.photo(ada, { subject: "event", event: id })).body.error.code).toBe(
      "not_at_event",
    );
    t.later(noon + MINUTE_MS - t.now());
    expect(await t.act(bob.token, { type: "join_event", event: id })).toMatchObject({ ok: true });
    // Bob joined; Cy didn't.
    expect((await t.photo(cy, { subject: "event", event: id })).body.error.code).toBe(
      "not_at_event",
    );
    const res = await t.photo(bob, { subject: "event", event: id, names: true });
    expect(res.status).toBe(201);
    expect(res.body.media.place).toEqual({ px: 0, py: 0 });
    // Wide unless asked: the guests stand all round the host's plot.
    expect(t.renders[0]?.scene).toMatchObject({
      names: true,
      framing: "wide",
      focus: { x: 3.5, y: 3.5 },
    });
    expect(t.renders[0]?.scene?.first.slice(0, 1)).toEqual([ada.id]);
    expect((await t.photo(ada, { subject: "event", event: id })).status).toBe(201);
    // An hour and more after it ends, it's over for photos.
    t.later(2 * HOUR + 5 * MINUTE_MS);
    expect((await t.photo(ada, { subject: "event", event: id })).body.error.code).toBe(
      "not_at_event",
    );
    expect((await t.photo(ada, { subject: "event", event: "e_404" })).body.error.code).toBe(
      "not_at_event",
    );
  });
});

/** A color the resident isn't wearing, so a change of look is a change. */
const otherColor = (t: { service: WorldService }, id: string) =>
  t.service.state.residents[id]?.color === "rose" ? "sky" : "rose";

describe("moments (RFC 0049)", () => {
  it("keeps a new look as a moment for an hour, photographed once and always as a portrait", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    expect(await t.act(ada.token, { type: "profile", color: otherColor(t, ada.id) })).toMatchObject(
      {
        ok: true,
      },
    );
    const listed = await t.call("GET", "/v1/photos/moments", undefined, ada.token);
    expect(listed.status).toBe(200);
    const [moment] = listed.body.moments;
    expect(moment).toMatchObject({
      kind: "new_look",
      id: expect.stringMatching(/^mo_[0-9a-f]{16}$/),
    });
    // The check-in carries the newest.
    const checkin = await t.call("GET", "/v1/checkin", undefined, ada.token);
    expect(checkin.body.photoMoment).toEqual(moment);
    // Asked for near, a new look is shown whole anyway.
    const res = await t.photo(ada, { subject: "moment", moment: moment.id, framing: "near" });
    expect(res.status).toBe(201);
    expect(t.renders[0]?.scene).toMatchObject({ framing: "portrait", focus: { id: ada.id } });
    expect(t.renders[0]?.scene?.stamp).toMatch(/^A new look · Plot 0, 0/);
    // Used once: a second photo of it is refused before drawing, and it leaves the list.
    t.later(MINUTE_MS);
    const again = await t.photo(ada, { subject: "moment", moment: moment.id });
    expect([again.status, again.body.error.code]).toEqual([409, "already_taken"]);
    expect((await t.call("GET", "/v1/photos/moments", undefined, ada.token)).body.moments).toEqual(
      [],
    );
    expect(
      (await t.call("GET", "/v1/checkin", undefined, ada.token)).body.photoMoment,
    ).toBeUndefined();
    expect(t.renders).toHaveLength(1);
  });

  it("is taken by the first of two photos asked for at once", async () => {
    const hold: (() => void)[] = [];
    const t = await start({ render: () => new Promise((done) => hold.push(() => done(PNG))) });
    const ada = await t.settler("Ada", 0, 0);
    expect(await t.act(ada.token, { type: "profile", color: otherColor(t, ada.id) })).toMatchObject(
      {
        ok: true,
      },
    );
    const [moment] = (await t.call("GET", "/v1/photos/moments", undefined, ada.token)).body.moments;
    const first = t.photo(ada, { subject: "moment", moment: moment.id });
    await expect.poll(() => hold.length).toBe(1);
    const second = await t.photo(ada, { subject: "moment", moment: moment.id });
    expect([second.status, second.body.error.code]).toEqual([409, "already_taken"]);
    for (const done of hold) done();
    expect((await first).status).toBe(201);
  });

  it("is only ever your own, and gone after an hour", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    expect(await t.act(ada.token, { type: "profile", color: otherColor(t, ada.id) })).toMatchObject(
      {
        ok: true,
      },
    );
    const [moment] = (await t.call("GET", "/v1/photos/moments", undefined, ada.token)).body.moments;
    const theirs = await t.photo(bob, { subject: "moment", moment: moment.id });
    expect([theirs.status, theirs.body.error.code]).toEqual([404, "not_found"]);
    t.later(SCENE_PHOTO_LIMITS.momentMs + MINUTE_MS);
    const late = await t.photo(ada, { subject: "moment", moment: moment.id });
    expect([late.status, late.body.error.code]).toEqual([404, "not_found"]);
    expect(t.renders).toHaveLength(0);
  });

  it("keeps none while scene photos are off", async () => {
    const t = await start({ off: true });
    const ada = await t.settler("Ada", 0, 0);
    expect(await t.act(ada.token, { type: "profile", color: otherColor(t, ada.id) })).toMatchObject(
      {
        ok: true,
      },
    );
    expect(t.social.scenePhotos.moments(ada.id)).toEqual([]);
    expect(
      (await t.call("GET", "/v1/checkin", undefined, ada.token)).body.photoMoment,
    ).toBeUndefined();
  });

  it("reads every kind of moment from an input's events, in catalog words, one of each", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const state = t.service.state;
    const input = { actor: ada.id, command: { type: "move", dir: "n" } } as unknown as Input;
    const never = () => false;
    const events: WorldEvent[] = [
      {
        type: "inventory",
        residentId: ada.id,
        reason: "craft",
        gained: [{ id: "g_1", kind: "table", maker: ada.id, madeDay: 1 } as never],
      },
      {
        type: "kiln_emptied",
        x: 2,
        y: 2,
        by: ada.id,
        pot: { kind: "bowl", glaze: "bare", finish: "smooth", maker: ada.id } as never,
      },
      {
        type: "listing_sold",
        listing: "l_1",
        seller: ada.id,
        kind: "jam" as never,
        count: 1,
        price: 9,
      },
      { type: "level_reached", residentId: ada.id, skill: "growing", level: 3 },
      { type: "level_reached", residentId: ada.id, level: 2 },
      { type: "harvested", x: 1, y: 1, crop: "tomato" as never, by: ada.id },
    ];
    const drafts = momentsOf(state, input, events, () => true);
    expect(drafts.map((m) => [m.kind, m.thing])).toEqual([
      ["made", "table"],
      ["fired", "smooth clay bowl"],
      ["sold", "jam"],
      ["level", "Growing 3"],
      ["harvest", "tomato"],
    ]);
    // Where it happened: the kiln and the planter, else where Ada stands.
    const me = t.service.state.residents[ada.id];
    expect(drafts.find((m) => m.kind === "fired")).toMatchObject({ x: 2, y: 2 });
    expect(drafts.find((m) => m.kind === "made")).toMatchObject({
      x: me?.x,
      y: me?.y,
      item: "table",
    });
    // A crop the book already has is no first.
    expect(momentsOf(state, input, events, never).some((m) => m.kind === "harvest")).toBe(false);
    // Our own words around catalog names.
    expect(momentWords("made", "oak table")).toBe("Made an oak table");
    expect(momentWords("sold", "jam")).toBe("Sold a jam at the market");
    expect(momentWords("hosted", undefined)).toBe("Hosted an event");
  });
});
