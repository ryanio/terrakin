/**
 * Pure helpers for the home wall: how a page of posts becomes a mix of card formats, what the pulse
 * cards count, and what is worth announcing. No DOM here, so tests can pin every rule.
 *
 * Townsfolk (founding residents the Terrakin team runs) fill in while real activity is thin. Once
 * enough real residents are posting, their posts fold into one small card, they stop being
 * announced, and they only pad the "around now" roster when too few real residents are online.
 */
import type { AuthorView, PostView, WorldSnapshot } from "@terrakin/protocol";
import { isMediaUrl } from "@terrakin/ui/format";

type Resident = WorldSnapshot["residents"][number];

/** Real (not townsfolk) posts a page needs before townsfolk fold away. */
export const REAL_ENOUGH = 8;
/** Real residents online before the roster stops padding with townsfolk. */
export const ROSTER_FILL = 6;
/** Consecutive posts by one author, each within this of the next, roll up into one card. */
export const BURST_GAP_MS = 2 * 60 * 60 * 1000;
export const BURST_MIN = 3;
/** Likes plus twice the replies a post needs to be flagged as the most talked about. */
export const HOT_MIN = 4;
/** Text-only posts up to this long show large, as a quote. */
export const QUOTE_MAX = 140;

export type Format = "plain" | "spotlight" | "quote" | "hot";

export type WallItem =
  | { kind: "post"; post: PostView; format: Format }
  | { kind: "burst"; author: AuthorView; posts: PostView[] }
  | { kind: "townsfolk"; posts: PostView[] };

/** "fold" once a page has enough real posts; "fill" while townsfolk are still needed. */
export type TownsfolkMode = "fill" | "fold";

export function isTownsfolk(author: AuthorView, known?: ReadonlySet<string>): boolean {
  return author.townsfolk === true || (known?.has(author.id) ?? false);
}

export function townsfolkMode(
  posts: readonly PostView[],
  known?: ReadonlySet<string>,
): TownsfolkMode {
  const real = posts.filter((p) => !isTownsfolk(p.author, known)).length;
  return real >= REAL_ENOUGH ? "fold" : "fill";
}

const hasImage = (p: PostView) => p.media.some((m) => m.kind === "image" && isMediaUrl(m.url));
const score = (p: PostView) => p.likeCount + 2 * p.replyCount;

/**
 * Turn posts (newest first) into wall items. Runs of `BURST_MIN` or more posts by one author roll
 * up. The busiest single post (not townsfolk) is flagged. Posts with pictures become wide spotlights
 * and short text-only posts become quotes, each spaced out so the wall keeps changing. In "fold" mode
 * townsfolk posts gather into one card, placed where the newest of them falls but never above the
 * third item, so real residents lead.
 */
export function arrangeWall(
  posts: readonly PostView[],
  mode: TownsfolkMode,
  known?: ReadonlySet<string>,
): WallItem[] {
  const folded: PostView[] = [];
  const shown: PostView[] = [];
  let foldAt = -1;
  for (const p of posts) {
    if (mode === "fold" && isTownsfolk(p.author, known)) {
      if (foldAt < 0) foldAt = shown.length;
      folded.push(p);
    } else shown.push(p);
  }

  // Group consecutive posts by one author.
  const runs: PostView[][] = [];
  for (const p of shown) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (
      run &&
      last &&
      last.author.id === p.author.id &&
      Date.parse(last.createdAt) - Date.parse(p.createdAt) <= BURST_GAP_MS
    )
      run.push(p);
    else runs.push([p]);
  }

  const singles = runs.filter((r) => r.length < BURST_MIN).flat();
  let hot: PostView | undefined;
  for (const p of singles) {
    if (isTownsfolk(p.author, known) || score(p) < HOT_MIN) continue;
    if (!hot || score(p) > score(hot)) hot = p;
  }

  const items: WallItem[] = [];
  // Where in `items` each run starts, to place the townsfolk card.
  const startOf: number[] = [];
  let lastSpot = -99;
  let lastQuote = -99;
  for (const run of runs) {
    startOf.push(items.length);
    const first = run[0];
    if (run.length >= BURST_MIN && first) {
      items.push({ kind: "burst", author: first.author, posts: run });
      continue;
    }
    for (const p of run) {
      const i = items.length;
      let format: Format = "plain";
      if (p === hot) format = "hot";
      else if (hasImage(p) && i - lastSpot >= 3) {
        format = "spotlight";
        lastSpot = i;
      } else if (
        p.media.length === 0 &&
        p.text.length <= QUOTE_MAX &&
        p.text.split("\n").length <= 3 &&
        i - lastQuote >= 3
      ) {
        format = "quote";
        lastQuote = i;
      }
      items.push({ kind: "post", post: p, format });
    }
  }

  if (folded.length > 0) {
    // `foldAt` counts shown posts before the first townsfolk post; map that to an item index.
    let before = 0;
    let at = items.length;
    for (let r = 0; r < runs.length; r++) {
      if (before >= foldAt) {
        at = startOf[r] ?? items.length;
        break;
      }
      before += runs[r]?.length ?? 0;
    }
    at = Math.min(Math.max(at, 3), items.length);
    items.splice(at, 0, { kind: "townsfolk", posts: folded });
  }
  return items;
}

/** Where the pulse cards sit among the posts on a phone, in order. */
export const PULSE_SLOTS = [1, 3, 6, 9, 12, 15] as const;

/** The townsfolk ids a snapshot names, plus any learned from post authors. */
export function townsfolkIds(
  snapshot: Pick<WorldSnapshot, "townsfolk"> | undefined,
  posts: readonly PostView[] = [],
): Set<string> {
  const ids = new Set(snapshot?.townsfolk ?? []);
  for (const p of posts) if (p.author.townsfolk) ids.add(p.author.id);
  return ids;
}

export interface PulseStats {
  /** Real residents, not counting townsfolk. */
  residents: number;
  online: number;
  homes: number;
  plots: number;
  blocks: number;
  townsfolk: number;
}

export function pulseStats(snapshot: WorldSnapshot, townsfolk: ReadonlySet<string>): PulseStats {
  const real = snapshot.residents.filter((r) => !townsfolk.has(r.id));
  return {
    residents: real.length,
    online: real.filter((r) => r.online).length,
    homes: real.filter((r) => r.hearth !== null).length,
    plots: snapshot.plots.filter((p) => !townsfolk.has(p.ownerId)).length,
    blocks: snapshot.blocks.length,
    townsfolk: snapshot.residents.length - real.length,
  };
}

/**
 * Who to show as around now: real residents online, newest-joined last in the snapshot so we show
 * them first, then townsfolk only to bring the roster up to `ROSTER_FILL`.
 */
export function aroundNow(
  snapshot: WorldSnapshot,
  townsfolk: ReadonlySet<string>,
  max = 10,
): { shown: Resident[]; more: number } {
  const online = snapshot.residents.filter((r) => r.online);
  const real = online.filter((r) => !townsfolk.has(r.id)).reverse();
  const fill = online.filter((r) => townsfolk.has(r.id));
  const list = [...real, ...fill.slice(0, Math.max(0, ROSTER_FILL - real.length))];
  const shown = list.slice(0, max);
  return { shown, more: real.length - shown.filter((r) => !townsfolk.has(r.id)).length };
}

/**
 * Posts per hour for the last `hours` hours, oldest first, for the sparkline. Hours that ended
 * before `coveredFromMs` (the oldest post we've loaded, when there are more pages) are null:
 * unknown, not quiet. The hour it falls in counts what we have, so it may be low.
 */
export function hourlyCounts(
  posts: readonly PostView[],
  nowMs: number,
  hours: number,
  coveredFromMs: number | null,
): (number | null)[] {
  const HOUR = 3_600_000;
  const counts: (number | null)[] = Array.from({ length: hours }, (_, i) => {
    const end = nowMs - (hours - 1 - i) * HOUR;
    return coveredFromMs !== null && end <= coveredFromMs ? null : 0;
  });
  for (const p of posts) {
    const ago = nowMs - Date.parse(p.createdAt);
    if (!(ago >= 0)) continue;
    const i = hours - 1 - Math.floor(ago / HOUR);
    const c = counts[i];
    if (i >= 0 && c !== null && c !== undefined) counts[i] = c + 1;
  }
  return counts;
}

/** Which new posts to announce: none of the townsfolk's once real residents carry the page. */
export function announceable(
  fresh: readonly PostView[],
  mode: TownsfolkMode,
  known?: ReadonlySet<string>,
): PostView[] {
  return mode === "fold" ? fresh.filter((p) => !isTownsfolk(p.author, known)) : [...fresh];
}

export type WorldNews =
  | { kind: "joined"; resident: Resident }
  | { kind: "claimed"; resident: Resident }
  | { kind: "home"; resident: Resident };

/**
 * What changed between two snapshots that's worth a toast, one line per resident at most: moving
 * in beats claiming a plot beats building a home. Townsfolk are left out.
 */
export function worldNews(
  before: WorldSnapshot,
  after: WorldSnapshot,
  townsfolk: ReadonlySet<string>,
): WorldNews[] {
  const was = new Map(before.residents.map((r) => [r.id, r]));
  const owned = new Set(before.plots.map((p) => p.ownerId));
  const claimedNow = new Set(after.plots.map((p) => p.ownerId).filter((id) => !owned.has(id)));
  const news: WorldNews[] = [];
  for (const r of after.residents) {
    if (townsfolk.has(r.id)) continue;
    const old = was.get(r.id);
    if (!old) news.push({ kind: "joined", resident: r });
    else if (claimedNow.has(r.id)) news.push({ kind: "claimed", resident: r });
    else if (old.hearth === null && r.hearth !== null) news.push({ kind: "home", resident: r });
  }
  return news;
}

/** A name for the time of day in the world, from `dayPhase` (0 dawn, 0.25 noon, 0.5 dusk). */
export function phaseName(phase: number): string {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.06) return "Dawn";
  if (p < 0.2) return "Morning";
  if (p < 0.3) return "Noon";
  if (p < 0.44) return "Afternoon";
  if (p < 0.56) return "Dusk";
  if (p < 0.7) return "Evening";
  if (p < 0.8) return "Midnight";
  if (p < 0.94) return "Small hours";
  return "Dawn";
}

/** "Juniper", "Juniper and Bram", "Juniper, Bram, and 3 others". */
export function namesLine(names: readonly string[]): string {
  const unique = [...new Set(names)];
  const [a, b] = unique;
  if (!a) return "";
  if (!b) return a;
  if (unique.length === 2) return `${a} and ${b}`;
  const rest = unique.length - 2;
  return `${a}, ${b}, and ${rest === 1 ? "1 other" : `${rest} others`}`;
}
