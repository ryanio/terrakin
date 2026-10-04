/** Small pure helpers for the feed pages: times, counts, and the media grid. Tests pin them. */
import { type MediaView, type PostView, xIntentUrl } from "@terrakin/protocol";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Short relative time for a post: "now", "3m", "2h", then a date like "Oct 4" (with the year when
 * it isn't this year). Future times (clock skew) read as "now".
 */
export function relativeTime(iso: string, nowMs: number, timeZone?: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const ago = nowMs - t;
  if (ago < MINUTE) return "now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h`;
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (timeZone) opts.timeZone = timeZone;
  const year = (ms: number) =>
    new Intl.DateTimeFormat("en-US", { year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(
      ms,
    );
  if (year(t) !== year(nowMs)) opts.year = "numeric";
  return new Intl.DateTimeFormat("en-US", opts).format(t);
}

/** Full date and time for a title attribute, for example "Oct 4, 2026, 6:22 PM". */
export function fullDate(iso: string, timeZone?: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(t);
}

/** 7, 1.2K, 34K. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    n,
  );
}

/** "1 reply", "3 replies". */
export function plural(n: number, one: string, many: string): string {
  return `${compactCount(n)} ${n === 1 ? one : many}`;
}

export type MediaLayout = "single" | "pair" | "trio" | "quad";

/** How a post's media sits in its grid. At most four items are shown. */
export function mediaLayout(media: readonly MediaView[]): {
  layout: MediaLayout | null;
  items: MediaView[];
} {
  const items = media.slice(0, 4);
  const layouts: (MediaLayout | null)[] = [null, "single", "pair", "trio", "quad"];
  return { layout: layouts[items.length] ?? null, items };
}

/**
 * How tall a single image should sit, from its natural size: clamped between a gentle portrait
 * (4:5) and a wide banner (1.91:1) so one picture never takes over the screen.
 */
export function clampAspect(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 4 / 3;
  return Math.min(1.91, Math.max(0.8, width / height));
}

/**
 * How many posts in a fresh first page are new to us: not already shown, and newer than the top
 * post we have. Feeds come newest first.
 */
export function countNew(current: readonly PostView[], fresh: readonly PostView[]): PostView[] {
  const top = current[0];
  if (!top) return [...fresh];
  const seen = new Set(current.map((p) => p.id));
  const topTime = Date.parse(top.createdAt);
  return fresh.filter((p) => !seen.has(p.id) && Date.parse(p.createdAt) >= topTime);
}

/** The first letter of a name, for an avatar with no picture. Handles emoji and accents. */
export function initial(name: string): string {
  const first = Array.from(name.trim())[0] ?? "?";
  return first.toLocaleUpperCase();
}

const MEDIA_PATH = /^\/media\/m_[0-9a-f]{16}$/;

/**
 * True for a media URL exactly as our server makes it (`/media/m_` and 16 hex digits). Post media
 * and avatars that don't match are left out, so a bad URL can never reach an img, video, or loader.
 */
export function isMediaUrl(url: unknown): url is string {
  return typeof url === "string" && MEDIA_PATH.test(url);
}

/**
 * What the 3D model loader may fetch: inline data, blobs it made itself, or one of our own media
 * URLs. A model file can name other files to load; anything else is refused.
 */
export function isModelResource(url: string, origin: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  if (isMediaUrl(url)) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.origin === origin && isMediaUrl(parsed.pathname) && !parsed.search && !parsed.hash;
}

/**
 * The "Open X" link for the connect sheet: X's post intent with exactly `text` filled in, or
 * undefined when the server's link is anything else. One line of text, so the post pastes whole.
 */
export function xIntentHref(intentUrl: string, text: string): string | undefined {
  return intentUrl === xIntentUrl(text) && !/[\r\n]/.test(text) ? intentUrl : undefined;
}
