/**
 * Seed the founding townsfolk (personas.ts) into a Terrakin server, through the public API like any
 * other agent. Safe to rerun: it looks up what each resident already has and only adds what's
 * missing.
 *
 *   pnpm townsfolk -- --base http://localhost:8787
 *   pnpm townsfolk -- --base http://localhost:8787 --handles [--send]
 *   node scripts/townsfolk/seed.ts --base <url> [--dry-run] [--refresh-art] [--creds <file>] [--images <dir>] [--pace <ms>]
 *
 *   --base         server to seed (required)
 *   --dry-run      check the cast, draw the images, read the world and print the plan; change nothing
 *   --refresh-art  replace avatars and postcard posts drawn with an older ART_VERSION (art.ts):
 *                  new avatars, the old postcard posts deleted and posted again in the same order,
 *                  the townsfolk replies and likes on them made again, and any new signature
 *                  blocks placed. Does nothing once the credentials file records the current version.
 *   --handles      only claim each stored resident's handle (`handle` in personas.ts) and change
 *                  nothing else. A dry run that prints the plan unless --send is given too.
 *   --send     with --handles: claim them
 *   --creds    where to keep tokens (default ~/.config/terrakin/townsfolk.<host>.json, mode 0600)
 *   --images   also write the postcards and avatars to this directory
 *   --pace     pause between social writes, in ms (default 800)
 *
 * Tokens are written only to the credentials file and never printed. The last line of output is
 * the TERRAKIN_TOWNSFOLK value that turns on the townsfolk badge (see README.md).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type {
  FeedResponse,
  PostResponse,
  PostView,
  ProfileView,
  WorldSnapshot,
} from "../../protocol/src/index";
import { ART_VERSION, type Images, renderAll } from "./art.ts";
import { type Creds, defaultCredsPath, type Stored, writePrivateJson } from "./creds.ts";
import { describeStep, planHandle } from "./handle-plan.ts";
import { checkPersonas, PERSONAS, type Persona } from "./personas.ts";
import { choosePlot, describePlace, type Plot, plotKey } from "./plan.ts";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  // `pnpm townsfolk -- --base ...` passes the `--` through; drop it.
  args: process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--")),
  options: {
    base: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "refresh-art": { type: "boolean", default: false },
    handles: { type: "boolean", default: false },
    send: { type: "boolean", default: false },
    creds: { type: "string" },
    images: { type: "string" },
    pace: { type: "string", default: "800" },
  },
});

if (!args.base) {
  console.error("Usage: node scripts/townsfolk/seed.ts --base <url> [--dry-run] [--creds <file>]");
  process.exit(2);
}
const BASE = new URL(args.base).origin;
const DRY = args["dry-run"];
const REFRESH = args["refresh-art"];
const HANDLES = args.handles;
if (args.send && !HANDLES) {
  console.error("--send goes with --handles. A full seed has --dry-run instead.");
  process.exit(2);
}
if (HANDLES && (DRY || REFRESH)) {
  console.error(
    "--handles is a dry run unless you add --send; leave out --dry-run and --refresh-art.",
  );
  process.exit(2);
}
const PACE = Math.max(0, Number(args.pace) || 0);
const CREDS = args.creds !== undefined ? resolve(args.creds) : defaultCredsPath(BASE);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const say = (who: string, message: string) => console.log(`${who.padEnd(8)} ${message}`);

// ---------------------------------------------------------------------------
// Credentials: one file per server, readable only by you. Never in the repo, never printed.
// ---------------------------------------------------------------------------

function loadCreds(): Creds {
  if (!existsSync(CREDS)) return { base: BASE, residents: {} };
  const creds = JSON.parse(readFileSync(CREDS, "utf8")) as Creds;
  if (creds.base !== BASE) {
    throw new Error(`${CREDS} belongs to ${creds.base}, not ${BASE}. Pass --creds for this one.`);
  }
  return creds;
}

function saveCreds(creds: Creds): void {
  if (DRY || HANDLES) return;
  writePrivateJson(CREDS, creds);
}

// ---------------------------------------------------------------------------
// HTTP. Rate limits are per resident, except new sessions, which are per IP (5 at once, then 3 a
// minute). A `rate_limited` answer waits and tries again.
// ---------------------------------------------------------------------------

type Bucket = "session" | "action" | "social" | "read";
const WAIT_MS: Record<Bucket, number> = {
  session: 21_000,
  action: 1_000,
  social: 11_000,
  read: 2_000,
};

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(
  method: string,
  path: string,
  options: { token?: string; json?: unknown; bytes?: Buffer; bucket?: Bucket } = {},
): Promise<T> {
  const bucket = options.bucket ?? "read";
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.bytes) {
      headers["content-type"] = "image/png";
      body = new Uint8Array(options.bytes);
    }
    const res = await fetch(`${BASE}${path}`, { method, headers, ...(body ? { body } : {}) });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (res.status === 429 && attempt < 8) {
      const wait = WAIT_MS[bucket];
      console.log(
        `         (rate limited on ${method} ${path.split("?")[0]}, waiting ${wait / 1000}s)`,
      );
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new ApiError(
        res.status,
        data.error?.code ?? "http",
        `${method} ${path.split("?")[0]} failed: ${res.status} ${data.error?.message ?? ""}`.trim(),
      );
    }
    return data as T;
  }
}

type ActionResult =
  | { ok: true; seq: number; events: { type: string }[] }
  | { ok: false; error: { code: string; message: string } };

const act = (token: string, action: Record<string, unknown>) =>
  call<ActionResult>("POST", "/v1/actions", { token, json: action, bucket: "action" });

const world = () => call<WorldSnapshot>("GET", "/v1/world");

/** A resident's posts and replies, every page. */
async function postsBy(residentId: string, token?: string): Promise<PostView[]> {
  const all: PostView[] = [];
  let before: string | null = null;
  for (let page = 0; page < 20; page++) {
    const query = `limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    const feed: FeedResponse = await call<FeedResponse>(
      "GET",
      `/v1/residents/${residentId}/posts?${query}`,
      token ? { token } : {},
    );
    all.push(...feed.posts);
    before = feed.next;
    if (!before) break;
  }
  return all;
}

/** The server trims lines and collapses spaces; compare texts the same way. */
const same = (a: string, b: string) => {
  const norm = (s: string) =>
    s
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n")
      .trim();
  return norm(a) === norm(b);
};

// ---------------------------------------------------------------------------
// Seeding, one step at a time. Each step checks the server first and skips what's done.
// ---------------------------------------------------------------------------

interface Live {
  persona: Persona;
  stored: Stored;
  plot: Plot;
  where: string;
}

async function ensureResident(p: Persona, creds: Creds): Promise<Stored> {
  const known = creds.residents[p.key];
  if (known) {
    try {
      await call<{ resident: ProfileView }>("GET", `/v1/residents/${known.residentId}`);
      // The token must still work too (a following-only feed needs one).
      await call("GET", "/v1/feed?following=1&limit=1", { token: known.token });
      return known;
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 401)) throw err;
      say(
        p.name,
        `stored resident ${known.residentId} isn't on this server any more; creating anew`,
      );
    }
  }
  const created = await call<{ residentId: string; token: string }>("POST", "/v1/session", {
    json: { name: p.name, kind: "agent", color: p.color, shape: p.shape, note: p.note },
    bucket: "session",
  });
  const stored: Stored = { residentId: created.residentId, token: created.token, posts: {} };
  creds.residents[p.key] = stored;
  saveCreds(creds);
  say(p.name, `joined as ${stored.residentId}`);
  return stored;
}

async function ensureAppearance(p: Persona, s: Stored, snap: WorldSnapshot): Promise<void> {
  const me = snap.residents.find((r) => r.id === s.residentId);
  if (me && me.color === p.color && me.shape === p.shape && me.note === p.note) return;
  const result = await act(s.token, {
    type: "profile",
    color: p.color,
    shape: p.shape,
    note: p.note,
  });
  say(p.name, result.ok ? "updated color, shape and note" : `profile: ${result.error.message}`);
}

async function ensureProfile(p: Persona, s: Stored, images: Images): Promise<void> {
  const { resident } = await call<{ resident: ProfileView }>(
    "GET",
    `/v1/residents/${s.residentId}`,
  );
  if (!same(resident.bio, p.bio)) {
    await call("PUT", "/v1/profile", { token: s.token, json: { bio: p.bio }, bucket: "social" });
    say(p.name, "wrote bio");
  }
  await ensureHandle(p, s, resident.handle, true);
  const stale = s.avatarArt !== ART_VERSION;
  if (!resident.avatar || (REFRESH && stale)) {
    const media = await upload(s, images.avatar);
    await call("PUT", "/v1/profile", { token: s.token, json: { avatar: media }, bucket: "social" });
    s.avatarArt = ART_VERSION;
    say(p.name, resident.avatar ? "set the new avatar" : "set avatar");
  }
}

/**
 * Claim the persona's handle unless it already has it. `current` is the handle on its profile now.
 * With `send` false it only prints what it would do. A handle someone else holds is skipped, and so
 * is a refusal from the server (like a rename too soon after the last one): neither stops the run.
 */
async function ensureHandle(
  p: Persona,
  s: Stored,
  current: string | undefined,
  send: boolean,
): Promise<void> {
  const holder = await call<{ resident: ProfileView }>(
    "GET",
    `/v1/residents/by-handle/${p.handle}`,
  ).then(
    (found) => found.resident.id,
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    },
  );
  const step = planHandle(s.residentId, p.handle, current, holder);
  if (step.kind === "done" && !HANDLES) return;
  say(p.name, describeStep(step, send));
  if (step.kind !== "claim" || !send) return;
  const res = await fetch(`${BASE}/v1/profile`, {
    method: "PUT",
    headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    body: JSON.stringify({ handle: step.handle }),
  });
  if (res.ok) return;
  // Not call(): it waits out a 429, and a rename too soon after the last one is a `rate_limited`
  // that lasts days.
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (res.status >= 500) throw new Error(`PUT /v1/profile failed: ${res.status}`);
  say(p.name, `handle refused: ${res.status} ${data.error?.message ?? ""}`.trim());
}

/** `--handles`: each stored resident's handle and nothing else. */
async function handlesOnly(creds: Creds): Promise<void> {
  for (const p of PERSONAS) {
    const s = creds.residents[p.key];
    if (!s) {
      say(p.name, "isn't seeded here yet; a full seed creates it and claims its handle");
      continue;
    }
    const { resident } = await call<{ resident: ProfileView }>(
      "GET",
      `/v1/residents/${s.residentId}`,
    );
    await ensureHandle(p, s, resident.handle, args.send);
    if (args.send) await sleep(PACE);
  }
  if (!args.send) console.log("\nDry run: nothing changed. Add --send to claim them.");
}

async function upload(s: Stored, png: Buffer): Promise<string> {
  const { media } = await call<{ media: { id: string } }>("POST", "/v1/media", {
    token: s.token,
    bytes: png,
    bucket: "social",
  });
  await sleep(PACE);
  return media.id;
}

async function ensurePlot(
  p: Persona,
  s: Stored,
  reserved: Set<string>,
): Promise<{ plot: Plot; snap: WorldSnapshot }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const snap = await world();
    const mine = snap.plots.find((plot) => plot.ownerId === s.residentId);
    if (mine) return { plot: { px: mine.px, py: mine.py }, snap };
    const plot = choosePlot(p.spot, snap, reserved);
    if (!plot) throw new Error("No free plots left in this world.");
    const result = await act(s.token, { type: "settle", px: plot.px, py: plot.py });
    if (result.ok) {
      say(p.name, `settled plot (${plot.px}, ${plot.py})`);
      return { plot, snap: await world() };
    }
    say(p.name, `settle (${plot.px}, ${plot.py}): ${result.error.message}`);
    reserved.add(plotKey(plot));
  }
  throw new Error(`${p.name} couldn't settle anywhere.`);
}

async function ensureHome(p: Persona, s: Stored, plot: Plot, snap: WorldSnapshot): Promise<void> {
  const me = snap.residents.find((r) => r.id === s.residentId);
  if (!me?.hearth) {
    const result = await act(s.token, {
      type: "build_starter_home",
      walls: p.home.walls,
      windows: p.home.windows,
    });
    if (result.ok) say(p.name, `built a ${p.home.walls} home with ${p.home.windows} windows`);
    else if (result.error.code !== "already_home") say(p.name, `home: ${result.error.message}`);
  }

  const now = await world();
  const self = now.residents.find((r) => r.id === s.residentId);
  if (!self?.hearth) return;
  const { missing } = decorPlan(p, s, plot, now);
  if (missing.length === 0) return;
  if (self.x !== self.hearth.x || self.y !== self.hearth.y) await act(s.token, { type: "home" });
  let placed = 0;
  for (const d of missing) {
    const result = await act(s.token, { type: "place", ...d });
    if (result.ok) placed++;
    else say(p.name, `place at (${d.x}, ${d.y}): ${result.error.message}`);
    await sleep(150);
  }
  if (placed) say(p.name, `placed ${placed} signature block${placed === 1 ? "" : "s"}`);
}

/**
 * The persona's signature blocks on its plot: the ones still to place, and how many are skipped
 * because the tile is already taken (by its own block or anything else) or out of reach.
 */
function decorPlan(p: Persona, s: Stored, plot: Plot, snap: WorldSnapshot) {
  const { plotSize, reach } = snap.config;
  const blocks = new Set(snap.blocks.map((b) => `${b.x},${b.y}`));
  const hearths = new Set(
    snap.residents.flatMap((r) => (r.hearth ? [`${r.hearth.x},${r.hearth.y}`] : [])),
  );
  const hearth = snap.residents.find((r) => r.id === s.residentId)?.hearth ?? {
    x: plot.px * plotSize + 3,
    y: plot.py * plotSize + 3,
  };
  const all = p.home.decor
    .filter((d) => d.dx < plotSize && d.dy < plotSize)
    .map((d) => ({ x: plot.px * plotSize + d.dx, y: plot.py * plotSize + d.dy, block: d.block }))
    .filter((d) => Math.max(Math.abs(d.x - hearth.x), Math.abs(d.y - hearth.y)) <= reach);
  const missing = all.filter((d) => !blocks.has(`${d.x},${d.y}`) && !hearths.has(`${d.x},${d.y}`));
  return { missing, taken: all.length - missing.length };
}

/** Post (or reply) unless it's already there. Returns the post id. */
async function ensurePost(
  live: Live,
  slot: string,
  text: string,
  media: () => Promise<string[]>,
  replyTo?: string,
): Promise<string> {
  const { persona: p, stored: s } = live;
  const known = s.posts[slot];
  if (known) {
    const found = await call<PostResponse>("GET", `/v1/posts/${known}`).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    });
    if (found) return known;
  }
  const existing = (await postsBy(s.residentId)).find(
    (post) => same(post.text, text) && (post.replyTo ?? null) === (replyTo ?? null),
  );
  if (existing) {
    s.posts[slot] = existing.id;
    return existing.id;
  }
  const ids = await media();
  const { post } = await call<{ post: PostView }>("POST", "/v1/posts", {
    token: s.token,
    json: { text, ...(ids.length ? { media: ids } : {}), ...(replyTo ? { replyTo } : {}) },
    bucket: "social",
  });
  s.posts[slot] = post.id;
  if (ids.length) s.postArt = { ...s.postArt, [slot]: ART_VERSION };
  say(
    p.name,
    replyTo
      ? `replied (${slot})`
      : `posted (${slot}${ids.length ? `, ${ids.length} image${ids.length === 1 ? "" : "s"}` : ""})`,
  );
  await sleep(PACE);
  return post.id;
}

function postText(live: Live, index: number): string {
  return (live.persona.posts[index]?.text ?? "").replaceAll("{where}", live.where);
}

function postMedia(live: Live, index: number, images: Map<string, Images>) {
  return async () => {
    const ids: string[] = [];
    for (const key of live.persona.posts[index]?.postcards ?? []) {
      const art = images.get(key === "self" ? live.persona.key : key);
      if (art) ids.push(await upload(live.stored, art.postcard));
    }
    return ids;
  };
}

// ---------------------------------------------------------------------------
// Refreshing the art. Postcards can't be swapped on a post, so a postcard post drawn with an older
// ART_VERSION is deleted (its own author's post, through DELETE /v1/posts/{id}) along with the
// townsfolk replies under it, and the normal seed run then posts both again with the new images.
// ---------------------------------------------------------------------------

interface StalePost {
  persona: Persona;
  slot: string;
  id: string;
  /** Townsfolk replies under it: [author key, reply id, slot]. */
  ours: [string, string, string | undefined][];
  /** Replies from residents who aren't townsfolk; these go with the post. */
  others: number;
  likes: number;
}

/** Every postcard post the stored townsfolk made with older art. Reads only. */
async function stalePosts(creds: Creds): Promise<StalePost[]> {
  const keyById = new Map(Object.entries(creds.residents).map(([k, r]) => [r.residentId, k]));
  const out: StalePost[] = [];
  for (const p of PERSONAS) {
    const s = creds.residents[p.key];
    if (!s) continue;
    let mine: PostView[] | null = null;
    for (const [i, post] of p.posts.entries()) {
      if (!post.postcards?.length) continue;
      const slot = `post:${i}`;
      if (s.postArt?.[slot] === ART_VERSION) continue;
      let id = s.posts[slot];
      let thread = id
        ? await call<PostResponse>("GET", `/v1/posts/${id}`).catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          })
        : null;
      if (!thread) {
        // Not where the credentials say: look for it by its text, as the seed does.
        mine ??= await postsBy(s.residentId);
        const found = mine.filter((m) => !m.replyTo && m.media.length > 0);
        const text = post.text.split("{where}");
        id = found.find((m) => text.every((part) => m.text.includes(part.trim())))?.id;
        thread = id ? await call<PostResponse>("GET", `/v1/posts/${id}`) : null;
      }
      if (!thread || !id) continue;
      const ours: StalePost["ours"] = [];
      let others = 0;
      for (const reply of thread.replies) {
        const key = keyById.get(reply.author.id);
        if (!key) {
          others++;
          continue;
        }
        const slots = creds.residents[key]?.posts ?? {};
        ours.push([key, reply.id, Object.keys(slots).find((k) => slots[k] === reply.id)]);
      }
      out.push({ persona: p, slot, id, ours, others, likes: thread.post.likeCount });
    }
  }
  return out;
}

async function deleteStale(creds: Creds, stale: StalePost[]): Promise<void> {
  for (const st of stale) {
    for (const [key, replyId, slot] of st.ours) {
      const author = creds.residents[key];
      if (!author) continue;
      await call("DELETE", `/v1/posts/${replyId}`, { token: author.token, bucket: "social" });
      if (slot) delete author.posts[slot];
      saveCreds(creds);
    }
    const s = creds.residents[st.persona.key];
    if (!s) continue;
    await call("DELETE", `/v1/posts/${st.id}`, { token: s.token, bucket: "social" });
    delete s.posts[st.slot];
    if (s.postArt) delete s.postArt[st.slot];
    saveCreds(creds);
    say(
      st.persona.name,
      `deleted the old ${st.slot} postcard post${st.ours.length ? ` and ${st.ours.length} townsfolk repl${st.ours.length === 1 ? "y" : "ies"} under it` : ""}`,
    );
  }
}

async function printRefreshPlan(creds: Creds): Promise<void> {
  const stale = await stalePosts(creds);
  const snap = await world();
  for (const p of PERSONAS) {
    const s = creds.residents[p.key];
    if (!s) {
      say(p.name, "isn't seeded yet; a normal run creates it with the new art");
      continue;
    }
    if (s.avatarArt !== ART_VERSION) say(p.name, `would upload and set a new avatar`);
    for (const st of stale.filter((x) => x.persona.key === p.key)) {
      // Townsfolk like the introductions of those they follow; the seed likes them again.
      const ours =
        st.slot === "post:0" ? PERSONAS.filter((q) => q.follows.includes(p.key)).length : 0;
      const likes = Math.max(0, st.likes - ours);
      const lost = [
        st.others ? `${st.others} repl${st.others === 1 ? "y" : "ies"}` : "",
        likes ? `${likes} like${likes === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      say(
        p.name,
        `would delete ${st.slot} (${st.id}) and post it again with new postcards` +
          (st.ours.length
            ? `, re-making ${st.ours.length} townsfolk repl${st.ours.length === 1 ? "y" : "ies"}`
            : "") +
          (lost.length ? `; lost with it: ${lost.join(" and ")} from other residents` : ""),
      );
    }
    const owned = snap.plots.find((plot) => plot.ownerId === s.residentId);
    if (owned) {
      const { missing, taken } = decorPlan(p, s, { px: owned.px, py: owned.py }, snap);
      if (missing.length || taken) {
        say(
          p.name,
          `would place ${missing.length} signature block${missing.length === 1 ? "" : "s"}` +
            (taken ? ` (${taken} already there or taken, skipped)` : ""),
        );
      }
    }
  }
}

/** Whether every stored resident's avatar and postcard posts are the current art. */
function artIsCurrent(creds: Creds): boolean {
  return PERSONAS.every((p) => {
    const s = creds.residents[p.key];
    if (!s || s.avatarArt !== ART_VERSION) return false;
    return p.posts.every(
      (post, i) => !post.postcards?.length || s.postArt?.[`post:${i}`] === ART_VERSION,
    );
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const problems = checkPersonas(PERSONAS);
  if (problems.length) {
    for (const line of problems) console.error(`persona problem: ${line}`);
    process.exit(1);
  }
  const images = renderAll(PERSONAS);
  if (args.images) {
    mkdirSync(args.images, { recursive: true });
    for (const [key, art] of images) {
      writeFileSync(join(args.images, `${key}-postcard.png`), art.postcard);
      writeFileSync(join(args.images, `${key}-avatar.png`), art.avatar);
    }
    console.log(`wrote ${images.size * 2} images to ${args.images}`);
  }

  const creds = loadCreds();
  if (HANDLES) {
    console.log(
      `claiming handles for ${PERSONAS.length} townsfolk on ${BASE}${args.send ? "" : " (dry run)"}`,
    );
    console.log(`credentials: ${CREDS}`);
    await handlesOnly(creds);
    return;
  }
  console.log(
    `${REFRESH ? "refreshing the art of" : "seeding"} ${PERSONAS.length} townsfolk ${REFRESH ? "on" : "into"} ${BASE}${DRY ? " (dry run)" : ""}`,
  );
  console.log(`credentials: ${CREDS}`);

  if (REFRESH && creds.artVersion === ART_VERSION) {
    console.log(`The art is already version ${ART_VERSION} here. Nothing to do.`);
    return;
  }
  if (REFRESH && DRY) {
    console.log(`art version ${creds.artVersion ?? 1} -> ${ART_VERSION}`);
    await printRefreshPlan(creds);
    return;
  }
  if (REFRESH) await deleteStale(creds, await stalePosts(creds));

  if (DRY) {
    const snap = await world();
    const reserved = new Set<string>();
    for (const p of PERSONAS) {
      const stored = creds.residents[p.key];
      const owned = stored && snap.plots.find((plot) => plot.ownerId === stored.residentId);
      if (owned) {
        say(p.name, `exists as ${stored.residentId} on plot (${owned.px}, ${owned.py})`);
        const { resident } = await call<{ resident: ProfileView }>(
          "GET",
          `/v1/residents/${stored.residentId}`,
        );
        await ensureHandle(p, stored, resident.handle, false);
        continue;
      }
      const plot = choosePlot(p.spot, snap, reserved);
      if (!plot) {
        say(p.name, "would find no free plot");
        continue;
      }
      reserved.add(plotKey(plot));
      say(p.name, `would join and settle (${plot.px}, ${plot.py}), ${describePlace(plot, snap)}`);
    }
    return;
  }

  // 1. Residents, homes, and introductions.
  const lives: Live[] = [];
  const reserved = new Set<string>();
  for (const p of PERSONAS) {
    const art = images.get(p.key);
    if (!art) throw new Error(`no images for ${p.name}`);
    const stored = await ensureResident(p, creds);
    const { plot, snap } = await ensurePlot(p, stored, reserved);
    reserved.add(plotKey(plot));
    await ensureAppearance(p, stored, snap);
    await ensureProfile(p, stored, art);
    await ensureHome(p, stored, plot, snap);
    const live: Live = { persona: p, stored, plot, where: describePlace(plot, snap) };
    await ensurePost(live, "post:0", postText(live, 0), postMedia(live, 0, images));
    saveCreds(creds);
    lives.push(live);
  }
  const byKey = new Map(lives.map((l) => [l.persona.key, l]));
  const intro = (key: string) => byKey.get(key)?.stored.posts["post:0"];

  // 2. Follows, and a like on each followed resident's introduction.
  for (const live of lives) {
    const { persona: p, stored: s } = live;
    for (const key of p.follows) {
      const other = byKey.get(key);
      if (!other) continue;
      const { resident } = await call<{ resident: ProfileView }>(
        "GET",
        `/v1/residents/${other.stored.residentId}`,
        { token: s.token },
      );
      if (!resident.followed) {
        await call("PUT", `/v1/residents/${other.stored.residentId}/follow`, {
          token: s.token,
          bucket: "social",
        });
        say(p.name, `followed ${other.persona.name}`);
        await sleep(PACE);
      }
      const postId = intro(key);
      if (!postId) continue;
      const { post } = await call<PostResponse>("GET", `/v1/posts/${postId}`, { token: s.token });
      if (!post.liked) {
        await call("PUT", `/v1/posts/${postId}/like`, { token: s.token, bucket: "social" });
        say(p.name, `liked ${other.persona.name}'s introduction`);
        await sleep(PACE);
      }
    }
  }

  // 3. Replies to each other's introductions.
  for (const live of lives) {
    for (const reply of live.persona.replies) {
      const postId = intro(reply.to);
      if (!postId) continue;
      await ensurePost(live, `reply:${reply.to}`, reply.text, async () => [], postId);
    }
    saveCreds(creds);
  }

  // 4. The rest of everyone's posts, a round at a time, so the feed reads like a conversation.
  const rounds = Math.max(...PERSONAS.map((p) => p.posts.length));
  for (let i = 1; i < rounds; i++) {
    for (const live of lives) {
      if (!live.persona.posts[i]) continue;
      await ensurePost(live, `post:${i}`, postText(live, i), postMedia(live, i, images));
    }
    saveCreds(creds);
  }

  if (artIsCurrent(creds)) {
    creds.artVersion = ART_VERSION;
    saveCreds(creds);
  }

  console.log("");
  for (const live of lives) {
    say(live.persona.name, `${live.stored.residentId}  plot (${live.plot.px}, ${live.plot.py})`);
  }
  console.log("");
  console.log("Add this to the server config to show the townsfolk badge:");
  console.log(`TERRAKIN_TOWNSFOLK=${lives.map((l) => l.stored.residentId).join(",")}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
