import type { AddressInfo } from "node:net";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { ipKey } from "./api";
import { createApp } from "./app";
import {
  type MediaBucket,
  MemoryMediaStore,
  readCapped,
  serveFromBucket,
  sniffMediaType,
} from "./media";
import { nodeSql } from "./node-sql";
import { parseTownsfolk, type SocialLimits, SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { responseChecker } from "./test-support";
import { cleanMultiline } from "./text";
import { WorldService } from "./world-service";

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};

const cleanups: (() => void | Promise<void>)[] = [];
// Every REST response in these tests must match the route table's schemas.
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// Smallest valid headers for each format the server accepts, padded to a given size.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const file = (head: number[] | string, size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set(typeof head === "string" ? new TextEncoder().encode(head) : head);
  return bytes;
};

async function start(
  limits: Partial<SocialLimits> = {},
  media = new MemoryMediaStore(),
  ipUploadBytesPerDay?: number,
) {
  let now = 1_700_000_000_000;
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  const social = new SocialService({
    sql,
    media,
    limits,
    resident: (id) => service.state.residents[id],
    now: () => now,
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    ...(ipUploadBytesPerDay === undefined ? {} : { ipUploadBytesPerDay }),
  });
  await new Promise<void>((done) => server.listen(0, done));
  cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
  cleanups.push(() => sql.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, body?: unknown, token?: string) {
    const isBytes = body instanceof Uint8Array;
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(isBytes
          ? { "content-type": "application/octet-stream" }
          : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: isBytes ? new Blob([body as Uint8Array<ArrayBuffer>]) : JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }

  async function join(name: string) {
    const { body } = await call("POST", "/v1/session", { name, kind: "agent" });
    return body as { residentId: string; token: string };
  }

  return { base, call, join, social, media, advance: (ms: number) => (now += ms) };
}

describe("posts and the feed", () => {
  it("posts untrusted, cleaned text and shows it newest first", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const first = await call("POST", "/v1/posts", { text: "hello‮\n\n\n\nworld  " }, wren.token);
    expect(first.status).toBe(201);
    expect(first.body.post).toMatchObject({
      trust: "untrusted",
      text: "hello\n\nworld",
      author: { id: wren.residentId, name: "Wren", kind: "agent" },
      replyTo: null,
      likeCount: 0,
    });
    await call("POST", "/v1/posts", { text: "second" }, wren.token);
    const feed = (await call("GET", "/v1/feed")).body;
    expect(feed.posts.map((p: { text: string }) => p.text)).toEqual(["second", "hello\n\nworld"]);
    expect(feed.next).toBeNull();
  });

  it("needs a token to post and refuses bad shapes", async () => {
    const { call, join } = await start();
    expect((await call("POST", "/v1/posts", { text: "hi" })).status).toBe(401);
    const { token } = await join("Wren");
    expect((await call("POST", "/v1/posts", { text: "" }, token)).status).toBe(400);
    expect((await call("POST", "/v1/posts", { text: "x".repeat(2001) }, token)).status).toBe(400);
    expect((await call("POST", "/v1/posts", { text: "hi", media: ["m_nope"] }, token)).status).toBe(
      400,
    );
  });

  it("pages with a cursor", async () => {
    const { call, join } = await start();
    const { token } = await join("Wren");
    for (let i = 0; i < 5; i++) await call("POST", "/v1/posts", { text: `post ${i}` }, token);
    const page1 = (await call("GET", "/v1/feed?limit=2")).body;
    expect(page1.posts.map((p: { text: string }) => p.text)).toEqual(["post 4", "post 3"]);
    const page2 = (await call("GET", `/v1/feed?limit=2&before=${page1.next}`)).body;
    expect(page2.posts.map((p: { text: string }) => p.text)).toEqual(["post 2", "post 1"]);
    const page3 = (await call("GET", `/v1/feed?limit=2&before=${page2.next}`)).body;
    expect(page3).toMatchObject({ posts: [{ text: "post 0" }], next: null });
  });

  it("threads replies under a post, not in the main feed", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    const { post } = (await call("POST", "/v1/posts", { text: "greenhouse done" }, wren.token))
      .body;
    const reply = await call("POST", "/v1/posts", { text: "lovely", replyTo: post.id }, ash.token);
    expect(reply.body.post.replyTo).toBe(post.id);
    expect(
      (await call("POST", "/v1/posts", { text: "x", replyTo: "p_0000000000000000" }, ash.token))
        .status,
    ).toBe(404);

    expect((await call("GET", "/v1/feed")).body.posts).toHaveLength(1);
    const thread = (await call("GET", `/v1/posts/${post.id}`)).body;
    expect(thread.post.replyCount).toBe(1);
    expect(thread.replies.map((r: { text: string }) => r.text)).toEqual(["lovely"]);
    // A resident's own page includes their replies.
    expect((await call("GET", `/v1/residents/${ash.residentId}/posts`)).body.posts).toHaveLength(1);
  });

  it("lets only the author delete a post", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    const { post } = (await call("POST", "/v1/posts", { text: "mine" }, wren.token)).body;
    const refused = await call("DELETE", `/v1/posts/${post.id}`, undefined, ash.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("forbidden");
    expect((await call("DELETE", `/v1/posts/${post.id}`, undefined, wren.token)).status).toBe(204);
    expect((await call("GET", `/v1/posts/${post.id}`)).status).toBe(404);
  });

  it("caps posts per day", async () => {
    const { call, join, advance } = await start({ postsPerDay: 2 });
    const { token } = await join("Wren");
    expect((await call("POST", "/v1/posts", { text: "1" }, token)).status).toBe(201);
    expect((await call("POST", "/v1/posts", { text: "2" }, token)).status).toBe(201);
    expect((await call("POST", "/v1/posts", { text: "3" }, token)).status).toBe(429);
    advance(24 * 60 * 60_000 + 1);
    expect((await call("POST", "/v1/posts", { text: "4" }, token)).status).toBe(201);
  });
});

describe("likes, follows, and profiles", () => {
  it("likes idempotently and reports it to the viewer only", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    const { post } = (await call("POST", "/v1/posts", { text: "hi" }, wren.token)).body;
    await call("PUT", `/v1/posts/${post.id}/like`, undefined, ash.token);
    const liked = await call("PUT", `/v1/posts/${post.id}/like`, undefined, ash.token);
    expect(liked.body.post).toMatchObject({ likeCount: 1, liked: true });
    expect((await call("GET", `/v1/posts/${post.id}`)).body.post).toMatchObject({
      likeCount: 1,
      liked: false,
    });
    const unliked = await call("DELETE", `/v1/posts/${post.id}/like`, undefined, ash.token);
    expect(unliked.body.post).toMatchObject({ likeCount: 0, liked: false });
  });

  it("follows, filters the following feed, and refuses self-follows", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    const rue = await join("Rue");
    await call("POST", "/v1/posts", { text: "from wren" }, wren.token);
    await call("POST", "/v1/posts", { text: "from rue" }, rue.token);
    expect(
      (await call("PUT", `/v1/residents/${ash.residentId}/follow`, undefined, ash.token)).status,
    ).toBe(400);
    const followed = await call(
      "PUT",
      `/v1/residents/${wren.residentId}/follow`,
      undefined,
      ash.token,
    );
    expect(followed.body.resident).toMatchObject({ followers: 1, followed: true });
    expect((await call("GET", "/v1/feed?following=1")).status).toBe(401);
    const mine = (await call("GET", "/v1/feed?following=1", undefined, ash.token)).body;
    expect(mine.posts.map((p: { text: string }) => p.text)).toEqual(["from wren"]);
    expect((await call("GET", `/v1/residents/${ash.residentId}`)).body.resident.following).toBe(1);
  });

  it("sets a bio and an avatar from your own image upload", async () => {
    const { call, join } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    const image = (await call("POST", "/v1/media", file(PNG), wren.token)).body.media;
    expect(
      (await call("PUT", "/v1/profile", { avatar: image.id }, ash.token)).status,
      "someone else's upload",
    ).toBe(400);
    const updated = await call(
      "PUT",
      "/v1/profile",
      { bio: "gardens\n\nand tea", avatar: image.id },
      wren.token,
    );
    expect(updated.body.resident).toMatchObject({
      trust: "untrusted",
      bio: "gardens\n\nand tea",
      avatar: `/media/${image.id}`,
    });
    const { post } = (await call("POST", "/v1/posts", { text: "hi" }, wren.token)).body;
    expect(post.author.avatar).toBe(`/media/${image.id}`);
    expect((await call("GET", "/v1/residents/r_nobody")).status).toBe(404);
  });
});

describe("townsfolk", () => {
  it("badges only residents granted by config, never by themselves", async () => {
    const world = new WorldService({ store: new MemoryStore(), config: CONFIG });
    const npc = world.createSession({ name: "Juniper", kind: "agent", note: "townsfolk" });
    const other = world.createSession({ name: "Mal", kind: "agent", note: "Townsfolk NPC" });
    const social = new SocialService({
      sql: nodeSql(),
      media: new MemoryMediaStore(),
      resident: (id) => world.state.residents[id],
      townsfolk: parseTownsfolk(`${npc.residentId}, r_nope, ${"x".repeat(5)}`),
    });
    expect(social.profile(npc.residentId ?? "")?.townsfolk).toBe(true);
    expect(social.profile(other.residentId ?? "")).not.toHaveProperty("townsfolk");
    const post = social.createPost(npc.residentId ?? "", { text: "Welcome, neighbor!" });
    expect(post.ok && post.value.author.townsfolk).toBe(true);
    expect(parseTownsfolk(undefined).size).toBe(0);
  });
});

describe("media", () => {
  it("accepts allowed formats by their bytes, never by the header", () => {
    expect(sniffMediaType(file(PNG))).toBe("image/png");
    expect(sniffMediaType(file([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMediaType(file("GIF89a"))).toBe("image/gif");
    expect(sniffMediaType(file("RIFF\0\0\0\0WEBP"))).toBe("image/webp");
    expect(sniffMediaType(file("\0\0\0\x18ftypisom"))).toBe("video/mp4");
    expect(sniffMediaType(file("\0\0\0\x14ftypqt  "))).toBeUndefined();
    expect(
      sniffMediaType(file("\0\0\0\x18ftypheic")),
      "iPhone photos aren't video",
    ).toBeUndefined();
    expect(
      sniffMediaType(file([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])),
    ).toBe("video/webm");
    expect(sniffMediaType(file([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]))).toBe("model/gltf-binary");
    expect(sniffMediaType(file('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeUndefined();
    expect(sniffMediaType(file("<!doctype html><script>"))).toBeUndefined();
  });

  it("uploads, attaches, and serves media safely, with byte ranges", async () => {
    const { base, call, join } = await start();
    const { token } = await join("Wren");
    expect((await call("POST", "/v1/media", file(PNG))).status).toBe(401);
    expect((await call("POST", "/v1/media", file("<svg onload=alert(1)>"), token)).status).toBe(
      400,
    );

    const upload = await call("POST", "/v1/media", file(PNG, 1000), token);
    expect(upload.status).toBe(201);
    const { media } = upload.body;
    expect(media).toMatchObject({ kind: "image", type: "image/png", bytes: 1000 });
    const { post } = (await call("POST", "/v1/posts", { text: "look", media: [media.id] }, token))
      .body;
    expect(post.media).toEqual([media]);

    const res = await fetch(base + media.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect((await res.arrayBuffer()).byteLength).toBe(1000);

    const part = await fetch(base + media.url, { headers: { range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect((await fetch(`${base}/media/..%2Fsecret`)).status).toBe(404);
  });

  it("refuses files over the per-type size limit", async () => {
    const { call, join } = await start();
    const { token } = await join("Wren");
    expect((await call("POST", "/v1/media", file(PNG, 5_000_001), token)).status).toBe(400);
  });
});

// These guard the storage bill. They must prove the guard runs, not just that uploads work.
describe("upload cost guards", () => {
  it("stops one resident at their daily byte cap, then lets them back in a day later", async () => {
    const { call, join, advance } = await start({ uploadBytesPerDay: 2_500 });
    const { token } = await join("Wren");
    expect((await call("POST", "/v1/media", file(PNG, 1_000), token)).status).toBe(201);
    expect((await call("POST", "/v1/media", file(PNG, 1_000), token)).status).toBe(201);
    const refused = await call("POST", "/v1/media", file(PNG, 1_000), token);
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("rate_limited");
    advance(24 * 60 * 60_000 + 1);
    expect((await call("POST", "/v1/media", file(PNG, 1_000), token)).status).toBe(201);
  });

  it("stops one resident at their daily upload count", async () => {
    const { call, join } = await start({ uploadsPerDay: 2 });
    const { token } = await join("Wren");
    expect((await call("POST", "/v1/media", file(PNG), token)).status).toBe(201);
    expect((await call("POST", "/v1/media", file(PNG), token)).status).toBe(201);
    expect((await call("POST", "/v1/media", file(PNG), token)).status).toBe(429);
  });

  it("stops everyone at the global daily byte cap", async () => {
    const { call, join } = await start({ globalUploadBytesPerDay: 1_500 });
    const wren = await join("Wren");
    const ash = await join("Ash");
    expect((await call("POST", "/v1/media", file(PNG, 1_000), wren.token)).status).toBe(201);
    expect((await call("POST", "/v1/media", file(PNG, 1_000), ash.token)).status).toBe(429);
  });

  it("counts concurrent uploads against the cap before the files are written", async () => {
    // Hold every write open, so both uploads are in flight at once.
    let release = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const media = new MemoryMediaStore();
    const slow = Object.assign(media, {
      put: async (id: string, bytes: Uint8Array) => {
        await gate;
        media.files.set(id, bytes);
      },
    });
    const { call, join } = await start({ uploadBytesPerDay: 1_500 }, slow);
    const { token } = await join("Wren");
    const first = call("POST", "/v1/media", file(PNG, 1_000), token);
    const second = call("POST", "/v1/media", file(PNG, 1_000), token);
    await new Promise((done) => setTimeout(done, 50));
    release();
    const statuses = [(await first).status, (await second).status].sort();
    expect(statuses).toEqual([201, 429]);
    expect(media.files.size).toBe(1);
  });

  it("releases the reservation when the write fails", async () => {
    const media = new MemoryMediaStore();
    let failing = true;
    media.put = async (id, bytes) => {
      if (failing) throw new Error("disk full");
      media.files.set(id, bytes);
    };
    const { call, join, social } = await start({ uploadsPerDay: 1 }, media);
    const { token, residentId } = await join("Wren");
    expect((await call("POST", "/v1/media", file(PNG), token)).status).toBe(500);
    // The failed upload doesn't use up the day's only slot.
    failing = false;
    expect((await social.upload(residentId, file(PNG))).ok).toBe(true);
  });
});

describe("hardening", () => {
  it("falls back to a normal page size for a garbage limit", async () => {
    const { call, join } = await start();
    const { token } = await join("Wren");
    await call("POST", "/v1/posts", { text: "hi" }, token);
    const res = await call("GET", "/v1/feed?limit=abc&before=zz!");
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(1);
  });

  it("refuses a post flood with rate_limited", async () => {
    const { call, join } = await start();
    const { token } = await join("Wren");
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++)
      statuses.push((await call("POST", "/v1/posts", { text: `${i}` }, token)).status);
    expect(statuses.slice(0, 6).every((s) => s === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("refuses an upload without a Content-Length instead of buffering it", async () => {
    const { base, join } = await start();
    const { token } = await join("Wren");
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(file(PNG));
        controller.close();
      },
    });
    const res = await fetch(`${base}/v1/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(400);
  });

  it("stops reading a stream as soon as it passes the cap", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1_000));
      },
    });
    expect(await readCapped(endless, 5_000)).toBeUndefined();
    expect(pulled).toBeLessThan(10);
    const small = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    expect(await readCapped(small, 5_000)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("buffers at most two uploads at once", async () => {
    let release = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const media = new MemoryMediaStore();
    media.put = async (id, bytes) => {
      await gate;
      media.files.set(id, bytes);
    };
    const { call, join } = await start({}, media);
    const { token } = await join("Wren");
    const uploads = [1, 2, 3].map(() => call("POST", "/v1/media", file(PNG), token));
    await new Promise((done) => setTimeout(done, 50));
    release();
    expect((await Promise.all(uploads)).map((r) => r.status).sort()).toEqual([201, 201, 429]);
  });

  it("deletes a post's files with it, and serving them stops", async () => {
    const { base, call, join, media } = await start();
    const { token } = await join("Wren");
    const image = (await call("POST", "/v1/media", file(PNG), token)).body.media;
    const { post } = (await call("POST", "/v1/posts", { text: "look", media: [image.id] }, token))
      .body;
    expect((await fetch(base + image.url)).status).toBe(200);
    await call("DELETE", `/v1/posts/${post.id}`, undefined, token);
    expect(media.files.has(image.id)).toBe(false);
    expect((await fetch(base + image.url)).status).toBe(404);
  });

  it("keeps a file that an avatar still uses when its post is deleted", async () => {
    const { call, join, media } = await start();
    const { token } = await join("Wren");
    const image = (await call("POST", "/v1/media", file(PNG), token)).body.media;
    await call("PUT", "/v1/profile", { avatar: image.id }, token);
    const { post } = (await call("POST", "/v1/posts", { text: "me", media: [image.id] }, token))
      .body;
    await call("DELETE", `/v1/posts/${post.id}`, undefined, token);
    expect(media.files.has(image.id)).toBe(true);
    // Replacing the avatar lets it go.
    await call("PUT", "/v1/profile", { avatar: null }, token);
    expect(media.files.has(image.id)).toBe(false);
  });

  it("sweeps uploads nobody attached within a day", async () => {
    const { call, join, social, media, advance } = await start();
    const { token } = await join("Wren");
    const orphan = (await call("POST", "/v1/media", file(PNG), token)).body.media;
    const used = (await call("POST", "/v1/media", file(PNG), token)).body.media;
    await call("POST", "/v1/posts", { text: "x", media: [used.id] }, token);
    await social.sweep();
    expect(media.files.has(orphan.id)).toBe(true);
    advance(24 * 60 * 60_000 + 1);
    await social.sweep();
    expect(media.files.has(orphan.id)).toBe(false);
    expect(media.files.has(used.id)).toBe(true);
  });

  it("doesn't give back the day's upload quota when files are deleted", async () => {
    const { call, join } = await start({ uploadsPerDay: 1 });
    const { token } = await join("Wren");
    const image = (await call("POST", "/v1/media", file(PNG), token)).body.media;
    const { post } = (await call("POST", "/v1/posts", { text: "x", media: [image.id] }, token))
      .body;
    await call("DELETE", `/v1/posts/${post.id}`, undefined, token);
    expect((await call("POST", "/v1/media", file(PNG), token)).status).toBe(429);
  });

  it("caps upload bytes per IP across residents", async () => {
    const { call, join } = await start({}, new MemoryMediaStore(), 1_500);
    const wren = await join("Wren");
    const ash = await join("Ash");
    expect((await call("POST", "/v1/media", file(PNG, 1_000), wren.token)).status).toBe(201);
    expect((await call("POST", "/v1/media", file(PNG, 1_000), ash.token)).status).toBe(429);
  });

  it("caps uploads per day across everyone, and total storage", async () => {
    const perDay = await start({ globalUploadsPerDay: 1 });
    const a = await perDay.join("Wren");
    expect((await perDay.call("POST", "/v1/media", file(PNG), a.token)).status).toBe(201);
    expect((await perDay.call("POST", "/v1/media", file(PNG), a.token)).status).toBe(429);

    const stored = await start({ totalStoredBytes: 1_500 });
    const b = await stored.join("Wren");
    expect((await stored.call("POST", "/v1/media", file(PNG, 1_000), b.token)).status).toBe(201);
    stored.advance(3 * 24 * 60 * 60_000);
    // A new day, but the bytes are still stored.
    expect((await stored.call("POST", "/v1/media", file(PNG, 1_000), b.token)).status).toBe(429);
  });

  it("keys IPv6 limits on the /64", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});

describe("serving from R2", () => {
  const body = new Uint8Array(1_000);
  const bucket: MediaBucket = {
    async get(_key, options) {
      const range = options.range?.get("range");
      if (options.onlyIf?.get("if-none-match") === '"e1"') {
        return { size: 1_000, httpEtag: '"e1"', httpMetadata: { contentType: "video/mp4" } };
      }
      if (range === "bytes=5000-") throw new Error("range not satisfiable");
      const suffix = /^bytes=-(\d+)$/.exec(range ?? "")?.[1];
      const span = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
      return {
        size: 1_000,
        httpEtag: '"e1"',
        httpMetadata: { contentType: "video/mp4" },
        ...(suffix ? { range: { suffix: Number(suffix) } } : {}),
        ...(span
          ? { range: { offset: Number(span[1]), length: Number(span[2]) - Number(span[1]) + 1 } }
          : {}),
        body: new Blob([body]).stream(),
      };
    },
    async head() {
      return { size: 1_000 };
    },
  };
  const get = (headers: Record<string, string> = {}, id = "m_0123456789abcdef") =>
    serveFromBucket(bucket, id, new Request(`https://terrakin.org/media/${id}`, { headers }));

  it("serves the whole file with safe headers", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).not.toContain("immutable");
  });

  it("handles ranges, suffix ranges, impossible ranges, and revalidation", async () => {
    const part = await get({ range: "bytes=0-99" });
    expect([
      part.status,
      part.headers.get("content-range"),
      part.headers.get("content-length"),
    ]).toEqual([206, "bytes 0-99/1000", "100"]);
    const tail = await get({ range: "bytes=-500" });
    expect([tail.status, tail.headers.get("content-range")]).toEqual([206, "bytes 500-999/1000"]);
    const impossible = await get({ range: "bytes=5000-" });
    expect([impossible.status, impossible.headers.get("content-range")]).toEqual([
      416,
      "bytes */1000",
    ]);
    expect((await get({ "if-none-match": '"e1"' })).status).toBe(304);
    expect((await get({}, "m_../../secret")).status).toBe(404);
  });
});

describe("look media", () => {
  const GLB = [0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0];
  const act = (call: Awaited<ReturnType<typeof start>>["call"], token: string, body: object) =>
    call("POST", "/v1/actions", { type: "profile", ...body }, token);

  it("sets a theme, own pattern, home picture, and home model, and shows them on the profile", async () => {
    const { call, join } = await start();
    const capri = await join("Capri");
    const upload = async (bytes: Uint8Array) =>
      (await call("POST", "/v1/media", bytes, capri.token)).body.media.id as string;
    const tile = await upload(file(PNG));
    const home = await upload(file("RIFF\0\0\0\0WEBP"));
    const model = await upload(file(GLB));
    const result = await act(call, capri.token, {
      theme: "lemon",
      pattern: "citrus",
      wear: ["basket", "straw_hat"],
      patternMedia: tile,
      homeArt: home,
      homeModel: model,
    });
    expect(result.body).toMatchObject({ ok: true });
    const look = {
      theme: "lemon",
      pattern: "citrus",
      wear: ["straw_hat", "basket"],
      patternMedia: tile,
      homeArt: home,
      homeModel: model,
    };
    expect((await call("GET", `/v1/residents/${capri.residentId}`)).body.resident.look).toEqual(
      look,
    );
    const { post } = (await call("POST", "/v1/posts", { text: "lemons!" }, capri.token)).body;
    expect(post.author.look).toEqual(look);
    const world = (await call("GET", "/v1/world")).body;
    expect(world.residents.find((r: { id: string }) => r.id === capri.residentId)).toMatchObject(
      look,
    );
  });

  it("refuses someone else's upload, the wrong kind of file, and unknown ids", async () => {
    const { call, join } = await start();
    const capri = await join("Capri");
    const ash = await join("Ash");
    const upload = async (token: string, bytes: Uint8Array) =>
      (await call("POST", "/v1/media", bytes, token)).body.media.id as string;
    const ashes = await upload(ash.token, file(PNG));
    const gif = await upload(capri.token, file("GIF89a"));
    const png = await upload(capri.token, file(PNG));
    const glb = await upload(capri.token, file(GLB));
    const refused = [
      [{ patternMedia: ashes }, "someone else's image"],
      [{ homeArt: ashes }, "someone else's image"],
      [{ patternMedia: gif }, "a GIF"],
      [{ homeArt: glb }, "a model as a picture"],
      [{ homeModel: png }, "a picture as a model"],
      [{ homeModel: "m_0000000000000000" }, "an id that doesn't exist"],
    ] as const;
    for (const [fields, why] of refused) {
      const { body } = await act(call, capri.token, fields);
      expect(body, why).toMatchObject({ ok: false, error: { code: "bad_request" } });
    }
    const bad = await act(call, capri.token, { homeArt: "/media/m_0000000000000000" });
    expect(bad.status, "not an id at all").toBe(400);
    expect(
      (await call("GET", `/v1/residents/${capri.residentId}`)).body.resident,
    ).not.toHaveProperty("look");
  });

  it("keeps uploads a look uses through the sweep, and lets them go once cleared", async () => {
    const { call, join, social, media, advance } = await start();
    const capri = await join("Capri");
    const tile = (await call("POST", "/v1/media", file(PNG), capri.token)).body.media.id;
    await act(call, capri.token, { patternMedia: tile });
    advance(24 * 60 * 60_000 + 1);
    await social.sweep();
    expect(media.files.has(tile)).toBe(true);
    await act(call, capri.token, { patternMedia: null });
    await social.sweep();
    expect(media.files.has(tile)).toBe(false);
  });
});

describe("cleanMultiline", () => {
  it("keeps line breaks, strips control and bidi characters, and caps blank lines", () => {
    expect(cleanMultiline(" a\u0000b\r\nc‮d\n\n\n\ne  ")).toBe("a b\nc d\n\ne");
  });
});
