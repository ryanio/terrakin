/**
 * Browsers kept open between scene photos (RFC 0049, decision 0390). A photo in a browser that's
 * already open, its photo page and compiled drawing programs kept, takes a couple of seconds; one
 * that opens a browser takes several times that. Each is offered again only while it's still open:
 * idle less than `keepMs`, less a margin, since the browser's own clock started a moment before
 * `give` was called. One past that is let go: `close` is called for it (Node closes its page;
 * Browser Run has already closed its browser on its own).
 */
export class WarmBrowsers<T> {
  private idle: { browser: T; since: number }[] = [];

  constructor(
    private readonly o: {
      keepMs: number;
      /** How many to keep at most: as many as take photos at once. */
      most: number;
      now: () => number;
      close?: (browser: T) => void;
    },
  ) {}

  /** The newest idle browser still open, now busy with a photo; undefined when none is. */
  take(): T | undefined {
    this.expire();
    return this.idle.pop()?.browser;
  }

  /** A browser done with its photo and left open, offered to the next. */
  give(browser: T) {
    this.idle.push({ browser, since: this.o.now() });
    while (this.idle.length > this.o.most) {
      const oldest = this.idle.shift();
      if (oldest) this.o.close?.(oldest.browser);
    }
  }

  /** Let go of every browser idle too long to be offered again. */
  expire() {
    const now = this.o.now();
    const open = (b: { since: number }) => now - b.since < this.o.keepMs - WARM_MARGIN_MS;
    for (const b of this.idle) if (!open(b)) this.o.close?.(b.browser);
    this.idle = this.idle.filter(open);
  }
}

/** How much sooner than its idle limit a browser stops being offered. */
const WARM_MARGIN_MS = 15_000;
