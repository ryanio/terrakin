/**
 * How the home wall hears about new posts: a light `watch` socket while someone is looking at the
 * page, and polling as the fallback (decision 0046). The socket closes when the tab hides, when
 * you leave the page, and after a while with no input, so a forgotten tab doesn't hold one of the
 * world's sockets.
 */
import type { PostMessage, PostView } from "@terrakin/protocol";
import { PostWatch } from "./net";

/** With no taps, keys, or scrolling for this long, the socket closes until the next one. */
export const LIVE_IDLE_MS = 10 * 60_000;
/** While the socket is up, the feed still polls this often, to catch anything it missed. */
export const LIVE_POLL_MS = 2 * 60_000;
/** A push waits a random moment up to this before the feed refreshes, so open pages spread out. */
export const PUSH_JITTER_MS = 2_000;
/** A refresh a push asks for waits until at least this long after the last poll, on Everyone. */
export const EVERYONE_GAP_MS = 5_000;
/** On Following, which can only refresh the whole feed, the gap is longer. */
export const FOLLOWING_GAP_MS = 20_000;
/** After the server turns the socket away (or it keeps dropping), try again after this long. */
export const LIVE_RETRY_MS = 2 * 60_000;

/** Whether a `post` message calls for a refresh: not for a post the wall shows, or your own. */
export function wantsRefresh(
  message: Pick<PostMessage, "id" | "authorId">,
  known: ReadonlySet<string>,
  me: string | null,
): boolean {
  return !known.has(message.id) && message.authorId !== me;
}

const when = (p: PostView) => Date.parse(p.repostedAt ?? p.createdAt);

/**
 * The posts in a fresh first page that the wall doesn't show yet, by id. Only those above the
 * oldest post both share, so posts that slide into the page from below (after a delete) don't
 * count as new, while a post that arrived late among ones already shown still does.
 */
export function newPosts(current: readonly PostView[], page: readonly PostView[]): PostView[] {
  const seen = new Set(current.map((p) => p.id));
  const shared = page.filter((p) => seen.has(p.id));
  const floor = shared.length > 0 ? Math.min(...shared.map(when)) : -Infinity;
  return page.filter((p) => !seen.has(p.id) && when(p) >= floor);
}

/** How long a refresh a push asked for waits: the jitter, and never sooner than `gap` after the last poll. */
export function refreshDelay(lastPoll: number, now: number, jitter: number, gap: number): number {
  return Math.max(jitter, lastPoll + gap - now);
}

/** Whether the regular poll should run: always without the socket, only now and then with it. */
export function pollDue(live: boolean, lastPoll: number, now: number): boolean {
  return !live || now - lastPoll >= LIVE_POLL_MS;
}

/**
 * Whether the page wants a socket: visible, someone touched it recently, and the last one didn't
 * end (refused, or dropped too often) within LIVE_RETRY_MS.
 */
export function wantsSocket(
  visible: boolean,
  lastInput: number,
  now: number,
  endedAt = -Infinity,
): boolean {
  return visible && now - lastInput < LIVE_IDLE_MS && now - endedAt >= LIVE_RETRY_MS;
}

const INPUTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

/**
 * Open and close the watch socket as the page is seen and used. `live()` says whether it's up;
 * `follow()` switches between every post and the posts of people you follow.
 */
export function liveFeed(onPost: (message: PostMessage) => void): {
  live(): boolean;
  follow(following: boolean): void;
  destroy(): void;
} {
  let watch: PostWatch | undefined;
  let live = false;
  let following = false;
  let lastInput = Date.now();
  let endedAt = -Infinity;

  function stop() {
    watch?.close();
    watch = undefined;
    live = false;
  }
  function sync() {
    const now = Date.now();
    if (wantsSocket(document.visibilityState === "visible", lastInput, now, endedAt)) {
      watch ??= new PostWatch({
        following,
        onPost,
        onLive: (on) => {
          live = on;
        },
        onEnd: (why) => {
          watch = undefined;
          live = false;
          // Its time was up: open another on the next tap, key, or scroll.
          if (why === "expired") lastInput = -Infinity;
          // Turned away or dropped too often: poll, and try again after LIVE_RETRY_MS.
          else endedAt = Date.now();
        },
      });
    } else if (watch) stop();
  }
  const onInput = () => {
    lastInput = Date.now();
    if (!watch) sync();
  };

  document.addEventListener("visibilitychange", sync);
  for (const type of INPUTS) window.addEventListener(type, onInput, { passive: true });
  const timer = setInterval(sync, 30_000);
  sync();

  return {
    live: () => live,
    follow(on) {
      if (on === following) return;
      following = on;
      stop();
      sync();
    },
    destroy() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      for (const type of INPUTS) window.removeEventListener(type, onInput);
      stop();
    },
  };
}
