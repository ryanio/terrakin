/**
 * How a page gets what it shows from the server: one loader the pages share, so each only says
 * what to ask for, how to draw it, and where a problem goes.
 */
import type { Result } from "@terrakin/ui/http";

/** Why a page's data didn't come. */
export interface Problem {
  message: string;
  /** The server says the thing isn't there (a 404), so asking again won't bring it. */
  missing: boolean;
}

export interface PageData {
  /** Resolves once the first answer is on the page: its content, or why there's none. */
  ready: Promise<void>;
  /**
   * Ask again and draw the answer, after an action or on a timer. A failed ask leaves what's
   * drawn alone, unless the thing is gone. Never two asks at once: one made while another is out
   * goes right after it, and resolves once its own answer is drawn. Does nothing on a page that
   * was left. Don't call it from `paint` or `fail`: it would ask forever.
   */
  refresh(): Promise<void>;
  /** True once the page was left. */
  gone(): boolean;
  /** The page was left: nothing is drawn after this. Call it from the view's `destroy`. */
  leave(): void;
}

/**
 * Ask for a page's data now and draw it with `paint`. Until something is drawn, a failed ask goes
 * to `fail` with a way to try again; `failInto` in `view.ts` makes one that puts the card in a
 * region. An answer for a page that was left is dropped.
 */
export function pageData<T>(page: {
  ask: () => Promise<Result<T>>;
  paint: (data: T) => void;
  fail: (problem: Problem, retry: () => Promise<void>) => void;
}): PageData {
  let left = false;
  let drawn = false;
  /** The ask that's out, and the one waiting to go after it. */
  let asking: Promise<void> | undefined;
  let next: Promise<void> | undefined;

  async function once(): Promise<void> {
    try {
      const r = await page.ask();
      if (left) return;
      if (r.ok) {
        drawn = true;
        page.paint(r.data);
        return;
      }
      const missing = r.status === 404;
      // A refresh that failed: what's drawn is still the best there is.
      if (drawn && !missing) return;
      drawn = false;
      page.fail({ message: r.message, missing }, ask);
    } finally {
      asking = undefined;
    }
  }

  function ask(): Promise<void> {
    if (left) return Promise.resolve();
    if (!asking) {
      asking = once();
      return asking;
    }
    // Everyone who asks while one is out shares the next, which starts once that one is drawn.
    next ??= asking.then(() => {
      next = undefined;
      return ask();
    });
    return next;
  }

  return {
    ready: ask(),
    refresh: ask,
    gone: () => left,
    leave: () => {
      left = true;
    },
  };
}

/** Two answers a page needs together: both, or the first that failed. */
export async function both<A, B>(
  a: Promise<Result<A>>,
  b: Promise<Result<B>>,
): Promise<Result<[A, B]>> {
  const [x, y] = await Promise.all([a, b]);
  if (!x.ok) return x;
  if (!y.ok) return y;
  return { ok: true, data: [x.data, y.data] };
}

/**
 * An answer with another beside it that the page can do without: null when it wasn't asked for
 * (nobody signed in, say) or didn't come.
 */
export async function withOptional<A, B>(
  main: Promise<Result<A>>,
  extra: Promise<Result<B>> | null,
): Promise<Result<[A, B | null]>> {
  const [x, y] = await Promise.all([main, extra]);
  if (!x.ok) return x;
  return { ok: true, data: [x.data, y?.ok ? y.data : null] };
}

/** A failure of the page's own making, in its own words: no request said so. */
export function failed(message: string): Result<never> {
  return { ok: false, status: 0, code: "page", message };
}
