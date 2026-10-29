import type { MediaView } from "@terrakin/protocol";
import {
  PHOTOS_BUSY_RETRY_SECONDS,
  PHOTOS_OUTAGE_RETRY_SECONDS,
  type PhotoMoment,
  type PhotoScene,
  SCENE_PHOTO_LIMITS,
  type ScenePhotoRequest,
} from "@terrakin/protocol";
import { type Crop, type Input, MINUTE_MS, type WorldEvent, type WorldState } from "@terrakin/sim";
import { type Failure, fail, ipKey, RATE_LIMITED } from "./handlers/shared";
import type { RateLimiters } from "./rate-limit";
import { momentsOf, type SceneDeps, type ScenePhotoBook, sceneFor } from "./scene-photos";
import { report, span } from "./telemetry";

/**
 * Renders a scene photo: loads `url` (the photo page with its ticket) in a headless browser at
 * 1200x900, waits for `data-photo="ready"`, and answers the PNG. The Worker uses Browser Run;
 * Node uses Playwright's Chromium. It throws when the page fails or isn't ready in time.
 */
export type SceneRenderer = (url: string) => Promise<Uint8Array>;

/** The `scenePhotos` server option (RFC 0049). Unset, the routes answer 404. */
export interface ScenePhotoOptions {
  render: SceneRenderer;
  /** Where the photo page is served: `https://terrakin.org`, or the dev client's origin. */
  origin: string;
  /** Waits between looks for a free render. Tests pass one that doesn't sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** How long the desk waits on a render. Default `RENDER_TIMEOUT_MS`; tests shorten it. */
  timeoutMs?: number;
}

/** Bytes a scene photo is assumed to take before it's drawn. A drawn one is 300 to 700 KB. */
const SCENE_RESERVE_BYTES = 2_000_000;
/**
 * The longest the desk waits on a render before it's given up as failed: the page's load and its
 * ready signal each get `readyMs` in the renderers, and a browser launch fits in what's left.
 */
const RENDER_TIMEOUT_MS = SCENE_PHOTO_LIMITS.readyMs * 2 + 10_000;
/** How often a waiting request looks for a free render. */
const WAIT_STEP_MS = 250;
/**
 * How long after a photo is taken the same request from the same resident answers with it again:
 * long enough for a client that gave up waiting to send it again without spending a second.
 */
const SAME_PHOTO_MS = MINUTE_MS;

/** What the desk needs from the Api and the social layer. */
export interface DeskDeps {
  options: ScenePhotoOptions;
  book: ScenePhotoBook;
  state: () => WorldState;
  now: () => number;
  ipLimiter: RateLimiters;
  sceneDeps: (viewer: string) => SceneDeps;
  uploadRoom: (viewer: string, bytes: number) => Failure | undefined;
  ipUploadRefusal: (key: string, bytes: number) => Failure | undefined;
  countIpUpload: (key: string, bytes: number) => void;
  upload: (
    viewer: string,
    png: Uint8Array,
    place: { px: number; py: number } | undefined,
  ) => Promise<MediaView | Failure>;
}

const BUSY_MESSAGE =
  "The town's camera is busy right now. Take a plot photo with POST /v1/plots/photo meanwhile.";

/**
 * The scene photo desk (RFC 0049). Every guard runs before a browser opens: the IP limit, the
 * subject's checks, the resident's day, the upload caps, then one of the town's renders for the
 * day, then a free render of the two at once. A render that fails gives its slot back and counts
 * against nobody.
 */
export class ScenePhotoDesk {
  private inFlight = 0;
  private readonly tickets = new Map<string, { scene: PhotoScene; until: number }>();
  /** Photos being taken or just taken, by resident and request: a resend gets the same one. */
  private readonly recent = new Map<
    string,
    { result: Promise<MediaView | Failure>; until: number }
  >();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: DeskDeps) {
    this.sleep = d.options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  }

  /** The scene a ticket names, while it lasts. */
  scene(ticket: string): PhotoScene | undefined {
    const now = this.d.now();
    for (const [key, t] of this.tickets) if (t.until <= now) this.tickets.delete(key);
    return this.tickets.get(ticket)?.scene;
  }

  moments(viewer: string): PhotoMoment[] {
    return this.d.book.moments(viewer);
  }

  /** The newest moment `viewer` hasn't photographed, for the check-in's `photoMoment`. */
  newestMoment(viewer: string): PhotoMoment | undefined {
    return this.d.book.moments(viewer)[0];
  }

  /** Keep the moments a committed input made, for an hour (`momentsOf`). */
  noteCommitted(
    state: WorldState,
    input: Input,
    events: readonly WorldEvent[],
    firstHarvest: (resident: string, crop: Crop) => boolean,
  ) {
    for (const m of momentsOf(state, input, events, firstHarvest)) this.d.book.keepMoment(m);
  }

  /**
   * Take a photo, or answer with the one this resident is taking or just took for the same request
   * (`SAME_PHOTO_MS`), so a client that gave up waiting and sent it again spends nothing more. A
   * request that came to nothing is never kept, so trying again runs it again.
   */
  async take(viewer: string, ip: string, request: ScenePhotoRequest): Promise<MediaView | Failure> {
    const now = this.d.now();
    for (const [key, r] of this.recent) if (r.until <= now) this.recent.delete(key);
    const key = `${viewer} ${JSON.stringify(request)}`;
    const same = this.recent.get(key);
    if (same) return same.result;
    const entry = { result: this.takeNew(viewer, ip, request), until: Infinity };
    this.recent.set(key, entry);
    const result = await entry.result;
    if ("error" in result) this.recent.delete(key);
    else entry.until = this.d.now() + SAME_PHOTO_MS;
    return result;
  }

  private async takeNew(
    viewer: string,
    ip: string,
    request: ScenePhotoRequest,
  ): Promise<MediaView | Failure> {
    const { d } = this;
    const key = ipKey(ip);
    const ipTake = d.ipLimiter.takeInfo(key);
    if (!ipTake.allowed) return fail("rate_limited", RATE_LIMITED.scenePhotosIp, ipTake.retryAfter);
    const checked = sceneFor(d.state(), viewer, request, d.sceneDeps(viewer));
    if (!checked.ok) return fail(checked.code, checked.message);
    if (d.book.residentToday(viewer) >= SCENE_PHOTO_LIMITS.perResidentPerDay)
      return fail(
        "rate_limited",
        `That's your ${SCENE_PHOTO_LIMITS.perResidentPerDay} scene photos for today. POST /v1/plots/photo still works.`,
        d.book.secondsToTomorrow(),
      );
    const overIp = d.ipUploadRefusal(key, SCENE_RESERVE_BYTES);
    if (overIp) return overIp;
    const room = d.uploadRoom(viewer, SCENE_RESERVE_BYTES);
    if (room) return room;
    // Failed renders are given back, so a page that never draws could hold browsers all day: past
    // the day's failures, nothing opens one until midnight UTC.
    if (d.book.failedToday() >= SCENE_PHOTO_LIMITS.failuresPerDay)
      return fail("photos_busy", BUSY_MESSAGE, d.book.secondsToTomorrow());
    // The town's day, counted before any browser opens (root rule 5).
    const slot = d.book.reserve();
    if (!slot.ok)
      return fail(
        "photos_busy",
        "The town's scene photos for today are all taken. They come back at midnight UTC; POST /v1/plots/photo works meanwhile.",
        d.book.secondsToTomorrow(),
      );
    // The resident's day and the moment are taken with the town's slot, with no await between, so
    // requests at once can't each pass them. Each comes back if no photo comes of it.
    d.book.taken(viewer, slot.day);
    if (checked.moment) d.book.useMoment(checked.moment, true);
    const noPhoto = () => {
      d.book.untaken(viewer, slot.day);
      if (checked.moment) d.book.useMoment(checked.moment, false);
    };
    // Two at once; a third waits a little for one to finish.
    const waitUntil = d.now() + SCENE_PHOTO_LIMITS.waitMs;
    while (this.inFlight >= SCENE_PHOTO_LIMITS.atOnce) {
      if (d.now() >= waitUntil) {
        d.book.release(slot.day);
        noPhoto();
        return fail("photos_busy", BUSY_MESSAGE, PHOTOS_BUSY_RETRY_SECONDS);
      }
      await this.sleep(WAIT_STEP_MS);
    }
    this.inFlight++;
    const ticket = newTicket();
    this.tickets.set(ticket, {
      scene: checked.scene,
      until: d.now() + SCENE_PHOTO_LIMITS.ticketMs,
    });
    const rendering = d.options.render(`${d.options.origin}/photo?t=${ticket}`);
    // The render's place among the two at once is held until its browser is done, even after the
    // desk stops waiting for it, so a slow page never lets a third browser open beside it.
    void rendering
      .catch(() => undefined)
      .finally(() => {
        this.inFlight--;
        this.tickets.delete(ticket);
      });
    let png: Uint8Array;
    try {
      png = await span("photo", "photo.scene", () =>
        withTimeout(rendering, d.options.timeoutMs ?? RENDER_TIMEOUT_MS),
      );
    } catch (err) {
      // The ticket would ride in a browser's error message, so only the error's kind is reported.
      report(new Error(`scene render failed: ${errorKind(err)}`), "photo.scene");
      d.book.release(slot.day);
      d.book.failed(slot.day);
      noPhoto();
      return fail("photos_busy", BUSY_MESSAGE, PHOTOS_OUTAGE_RETRY_SECONDS);
    }
    // The browser time was spent, so the town's slot stays taken; the resident's comes back.
    const overIpNow = d.ipUploadRefusal(key, png.length);
    if (overIpNow) {
      noPhoto();
      return overIpNow;
    }
    const stored = await d.upload(viewer, png, checked.place);
    if ("error" in stored) {
      noPhoto();
      return stored;
    }
    d.countIpUpload(key, png.length);
    return stored;
  }
}

/**
 * Which step of a render failed, by the renderers' own fixed messages (`packages/cards/
 * cloudflare/scene.ts`, Playwright's timeouts), the first that matches. Never the message itself,
 * which can carry the page's address and its ticket.
 */
const RENDER_FAILURES: readonly [RegExp, string][] = [
  [/^no browser|^no devtools socket/, "no browser"],
  [/^load timed out/, "slow load"],
  [/wasn't ready in time/, "not ready"],
  [/couldn't draw/, "page failed"],
  [/^devtools closed/, "browser closed"],
  [/timed? ?out|timeout/i, "timeout"],
];

function errorKind(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  return RENDER_FAILURES.find(([test]) => test.test(err.message))?.[1] ?? (err.name || "error");
}

/** A ticket: `pt_` and 128 random bits. Unguessable, and only good for a minute. */
function newTicket(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `pt_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("scene photo timed out")), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
