/**
 * Scene photos on Cloudflare (RFC 0049): Browser Run, through this Worker's `BROWSER` binding,
 * draws the main Worker's photo page and answers the PNG. It lives here rather than in the main
 * Worker, beside the other drawing (decision 0299).
 *
 * It speaks the Chrome DevTools Protocol to Browser Run directly, over the binding's own two
 * calls: `POST /v1/devtools/browser` for a browser, and a WebSocket to
 * `/v1/devtools/browser/{session}` to drive it. No browser library: the one Cloudflare publishes
 * brings dependencies for downloading browsers, which a Worker never does and whose advisories
 * fail the repo's audit (decision 0387).
 *
 * Each photo gets a browser of its own, closed after, since Browser Run bills a kept session for
 * every second it idles. The browser only ever loads `origin`: every other request is failed
 * before it leaves, so a scene can't fetch or navigate anywhere else.
 */

/** The host the binding's calls are addressed to. The binding routes them; the name is ignored. */
const BINDING_HOST = "https://browser.binding";
/** How often the page is asked whether it's ready. */
const POLL_MS = 250;

interface Shot {
  /** The page to load. */
  url: string;
  /** The only origin the browser may load from. */
  origin: string;
  /** A script that reads `ready`, `failed`, or anything else for not yet. */
  ready: string;
  /** How long the page has to load, and then to say it's ready, each. */
  readyMs: number;
}

/** The photo page at `url`, drawn by Browser Run once it says `data-photo="ready"`. */
export function renderScene(
  browserBinding: Fetcher,
  url: string,
  origin: string,
  readyMs: number,
): Promise<Uint8Array> {
  const at = new URL(url);
  if (at.origin !== origin || at.pathname !== "/photo")
    throw new Error("scene photos load only the photo page");
  return shoot(browserBinding, {
    url,
    origin,
    ready: "document.body?.dataset.photo ?? ''",
    readyMs,
  });
}

/** Load a page in a new Browser Run browser, wait for it to say it's ready, and take a PNG. */
async function shoot(binding: Fetcher, shot: Shot): Promise<Uint8Array> {
  // A new browser's socket is now and then refused (a 410) as it starts: one more try.
  const socket = await openBrowser(binding).catch(() => openBrowser(binding));
  const cdp = new Devtools(socket);
  try {
    const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId: page } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    // Every request waits here until it's let through: our own origin only.
    cdp.on("Fetch.requestPaused", page, (params) => {
      const { requestId, request } = params as { requestId: string; request: { url: string } };
      const to = new URL(request.url);
      const ours = to.origin === shot.origin || to.protocol === "data:" || to.protocol === "blob:";
      void cdp
        .send(
          ours ? "Fetch.continueRequest" : "Fetch.failRequest",
          ours ? { requestId } : { requestId, errorReason: "BlockedByClient" },
          page,
        )
        .catch(() => undefined);
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, page);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false },
      page,
    );
    await cdp.send("Page.enable", {}, page);
    await within(cdp.send("Page.navigate", { url: shot.url }, page), shot.readyMs, "load");
    // The page says `ready` once the scene has drawn, or `failed`.
    const until = Date.now() + shot.readyMs;
    for (;;) {
      const { result } = await cdp.send<{ result: { value?: unknown } }>(
        "Runtime.evaluate",
        { expression: shot.ready, returnByValue: true },
        page,
      );
      if (result.value === "ready") break;
      if (result.value === "failed") throw new Error("the page couldn't draw the scene");
      if (Date.now() > until) throw new Error("the page wasn't ready in time");
      await new Promise((done) => setTimeout(done, POLL_MS));
    }
    const { data } = await cdp.send<{ data: string }>(
      "Page.captureScreenshot",
      { format: "png" },
      page,
    );
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } finally {
    await within(cdp.send("Browser.close", {}), 2_000, "close").catch(() => undefined);
    cdp.close();
  }
}

/** A new browser of its own, and the DevTools socket that drives it. */
async function openBrowser(binding: Fetcher): Promise<WebSocket> {
  const acquired = await binding.fetch(`${BINDING_HOST}/v1/devtools/browser`, { method: "POST" });
  if (!acquired.ok) throw new Error(`no browser: ${acquired.status}`);
  const { sessionId } = (await acquired.json()) as { sessionId?: string };
  if (!sessionId) throw new Error("no browser session");
  const upgraded = await binding.fetch(`${BINDING_HOST}/v1/devtools/browser/${sessionId}`, {
    headers: { Upgrade: "websocket" },
  });
  const socket = upgraded.webSocket;
  if (!socket) throw new Error(`no devtools socket: ${upgraded.status}`);
  socket.accept();
  return socket;
}

/** A DevTools connection: numbered commands answered by id, and events by session. */
class Devtools {
  private next = 1;
  private readonly waiting = new Map<
    number,
    { done: (result: unknown) => void; fail: (err: Error) => void }
  >();
  private readonly listeners: {
    method: string;
    session: string;
    fn: (params: unknown) => void;
  }[] = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
        method?: string;
        params?: unknown;
        sessionId?: string;
      };
      if (message.id !== undefined) {
        const waiter = this.waiting.get(message.id);
        this.waiting.delete(message.id);
        if (message.error) waiter?.fail(new Error(message.error.message ?? "devtools error"));
        else waiter?.done(message.result ?? {});
        return;
      }
      for (const l of this.listeners)
        if (l.method === message.method && l.session === message.sessionId) l.fn(message.params);
    });
    socket.addEventListener("close", () => {
      for (const waiter of this.waiting.values()) waiter.fail(new Error("devtools closed"));
      this.waiting.clear();
    });
  }

  send<T = unknown>(method: string, params: object, sessionId?: string): Promise<T> {
    const id = this.next++;
    return new Promise<T>((done, fail) => {
      this.waiting.set(id, { done: done as (result: unknown) => void, fail });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method: string, session: string, fn: (params: unknown) => void) {
    this.listeners.push({ method, session, fn });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
  }
}

function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what} timed out`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
