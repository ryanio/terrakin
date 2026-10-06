/** Keeping what a page shows fresh without asking the server more than it needs. */

const visible = () => document.visibilityState === "visible";

/** Run `fn` every `ms` while the page is visible. Returns `stop`. */
export function everyVisible(ms: number, fn: () => void): () => void {
  const timer = setInterval(() => {
    if (visible()) fn();
  }, ms);
  return () => clearInterval(timer);
}

export interface VisiblePollOptions {
  /** Ask on a timer this often while the page is visible. */
  everyMs: number;
  /** An unforced ask waits at least this long after the last one. */
  minGapMs: number;
  /** False skips the ask entirely, for example with nobody signed in. */
  ready?: () => boolean;
  /** False skips only the timed asks, for example while another screen is up. */
  when?: () => boolean;
}

/**
 * A refresher for a number the server can change, like the bell's unread count. `refresh` asks at
 * most once every `minGapMs` unless forced, and never twice at once: a forced ask during one runs
 * right after it. `start` (once per page) asks on a timer and when the tab comes back.
 */
export function visiblePoll(ask: () => Promise<void>, o: VisiblePollOptions) {
  let last = 0;
  let asking = false;
  let again = false;
  const refresh = (force = false) => {
    if (o.ready && !o.ready()) return;
    if (asking) {
      if (force) again = true;
      return;
    }
    if (!force && Date.now() - last < o.minGapMs) return;
    last = Date.now();
    asking = true;
    void ask().finally(() => {
      asking = false;
      if (!again) return;
      again = false;
      refresh(true);
    });
  };
  const start = () => {
    everyVisible(o.everyMs, () => {
      if (o.when?.() ?? true) refresh(true);
    });
    document.addEventListener("visibilitychange", () => {
      if (visible()) refresh();
    });
  };
  return { refresh, start };
}
