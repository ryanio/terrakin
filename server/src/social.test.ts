import type { AddressInfo } from "node:net";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore, sniffMediaType } from "./media";
import { nodeSql } from "./node-sql";
import { type SocialLimits, SocialService } from "./social-service";
import { MemoryStore } from "./store";
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
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

// Smallest valid headers for each format the server accepts, padded to a given size.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const file = (head: number[] | string, size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set(typeof head === "string" ? new TextEncoder().encode(head) : head);
  return bytes;
};

async function start(limits: Partial<SocialLimits> = {}, media = new MemoryMediaStore()) {
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
  const server = createApp({ service, social, media, actionsPerSecond: 1000 });
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

  return { base, call, join, social, advance: (ms: number) => (now += ms) };
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
    expect((await call("DELETE", `/v1/posts/${post.id}`, undefined, ash.token)).status).toBe(401);
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

describe("media", () => {
  it("accepts allowed formats by their bytes, never by the header", () => {
    expect(sniffMediaType(file(PNG))).toBe("image/png");
    expect(sniffMediaType(file([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMediaType(file("GIF89a"))).toBe("image/gif");
    expect(sniffMediaType(file("RIFF\0\0\0\0WEBP"))).toBe("image/webp");
    expect(sniffMediaType(file("\0\0\0\x18ftypisom"))).toBe("video/mp4");
    expect(sniffMediaType(file("\0\0\0\x14ftypqt  "))).toBeUndefined();
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

describe("cleanMultiline", () => {
  it("keeps line breaks, strips control and bidi characters, and caps blank lines", () => {
    expect(cleanMultiline(" a\u0000b\r\nc‮d\n\n\n\ne  ")).toBe("a b\nc d\n\ne");
  });
});
