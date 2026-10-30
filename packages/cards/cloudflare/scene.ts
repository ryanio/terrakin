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
 * A browser is left open after a photo for the next one, and Browser Run closes it once it has sat
 * idle the time the caller gives, which it bills like any other browser time (decision 0390). The
 * browser only ever loads `origin`: every other request is failed before it leaves, so a scene
 * can't fetch or navigate anywhere else.
 */

import type { SceneOptions, SceneShot } from "../src/render";

/** The host the binding's calls are addressed to. The binding routes them; the name is ignored. */
const BINDING_HOST = "https://browser.binding";
/** The longest one wait on the page runs before it's asked again. */
const WAIT_STEP_MS = 5_000;
/** A photo page's ticket, the only thing put into a script the page runs. */
const TICKET = /^pt_[0-9a-f]{32}$/;

/**
 * What the photo page says on its body once a photo is drawn, or couldn't be: `ready`, `failed`,
 * or `''` when it said nothing within `ms`. It answers the moment the page says it, rather than at
 * the next of a fixed round of questions.
 */
const said = (ms: number) => `new Promise((done) => {
  const now = () => document.body?.dataset.photo ?? "";
  if (now()) return done(now());
  if (!document.body) return setTimeout(() => done(""), 50);
  const seen = new MutationObserver(() => {
    if (!now()) return;
    seen.disconnect();
    done(now());
  });
  seen.observe(document.body, { attributes: true, attributeFilter: ["data-photo"] });
  setTimeout(() => {
    seen.disconnect();
    done(now());
  }, ${Math.max(0, Math.round(ms))});
})`;

interface Shot {
  url: string;
  origin: string;
  ticket: string;
  /** How long the photo has, from loading the page or asking it, to saying it's ready. */
  readyMs: number;
}

/** The photo page drew nothing and said so: a new browser would fail the same way. */
class PageFailed extends Error {}

/**
 * The photo page at `url`, drawn by Browser Run once it says `data-photo="ready"`, and the browser
 * it was drawn in, left open. The browser in `o.warm` is asked first, for `o.warmTryMs`: its photo
 * page takes the next ticket in place, its scene's drawing programs already compiled, which is most
 * of a photo's time. When it's gone, too slow, or its page too old, a new browser is opened, which
 * Browser Run closes once it has sat idle `o.keepMs`.
 */
export async function renderScene(
  binding: Fetcher,
  url: string,
  origin: string,
  o: SceneOptions,
): Promise<SceneShot> {
  const at = new URL(url);
  if (at.origin !== origin || at.pathname !== "/photo")
    throw new Error("scene photos load only the photo page");
  const ticket = at.searchParams.get("t") ?? "";
  if (!TICKET.test(ticket)) throw new Error("scene photos need a ticket");
  if (o.warm) {
    const browser = o.warm;
    const socket = await connect(binding, browser).catch(() => undefined);
    if (socket) {
      try {
        const png = await shoot(new Devtools(socket), "next", {
          url,
          origin,
          ticket,
          readyMs: o.warmTryMs,
        });
        return { png, browser };
      } catch (err) {
        if (err instanceof PageFailed) throw err;
      }
    }
  }
  const { browser, socket } = await openBrowser(binding, o.keepMs).catch(() =>
    openBrowser(binding, o.keepMs),
  );
  const png = await shoot(new Devtools(socket), "load", {
    url,
    origin,
    ticket,
    readyMs: o.readyMs,
  });
  return { png, browser };
}

/**
 * Take the photo in the browser behind `cdp`: by its photo page's own `photoNext` (`next`), or in
 * a new tab (`load`). The browser stays open when the photo is taken and is closed when it fails,
 * so a broken one is never asked again.
 */
async function shoot(cdp: Devtools, how: "next" | "load", shot: Shot): Promise<Uint8Array> {
  let ok = false;
  let until = Date.now() + shot.readyMs;
  try {
    let targetId: string | undefined;
    if (how === "next") {
      const { targetInfos } = await cdp.send<{
        targetInfos: { targetId: string; type: string; url: string }[];
      }>("Target.getTargets", {});
      targetId = targetInfos.find((t) => {
        if (t.type !== "page" || !t.url.startsWith(`${shot.origin}/photo`)) return false;
        const where = new URL(t.url);
        return where.origin === shot.origin && where.pathname === "/photo";
      })?.targetId;
      if (!targetId) throw new Error("no photo page open");
    } else {
      ({ targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", {
        url: "about:blank",
      }));
    }
    const { sessionId: page } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    // Every request waits here until it's let through: our own origin only. A connection's
    // interception ends with it, and an open photo page between photos asks for nothing.
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
    if (how === "next") {
      const { result } = await cdp.send<{ result: { value?: unknown } }>(
        "Runtime.evaluate",
        {
          // The ticket was checked against TICKET, so it's a plain string here.
          expression: `window.photoNext?.(${JSON.stringify(shot.ticket)}) === true`,
          returnByValue: true,
        },
        page,
      );
      // A page past its life, or from before a deploy, says no: a new browser loads it fresh.
      if (result.value !== true) throw new Error("the photo page is too old");
    } else {
      await within(cdp.send("Page.navigate", { url: shot.url }, page), shot.readyMs, "load");
      // Loaded, the page has as long again to draw.
      until = Date.now() + shot.readyMs;
    }
    // The page says `ready` once the scene has drawn, or `failed`.
    for (;;) {
      const left = until - Date.now();
      if (left <= 0) throw new Error("the page wasn't ready in time");
      const { result } = await cdp
        .send<{ result: { value?: unknown } }>(
          "Runtime.evaluate",
          {
            expression: said(Math.min(left, WAIT_STEP_MS)),
            awaitPromise: true,
            returnByValue: true,
          },
          page,
        )
        // A wait begun on the blank page a new tab opens with ends as the photo page replaces it.
        .catch((err: Error) => {
          if (/context|navigat/i.test(err.message)) return { result: { value: "" } };
          throw err;
        });
      if (result.value === "ready") break;
      if (result.value === "failed") throw new PageFailed("the page couldn't draw the scene");
    }
    const { data } = await cdp.send<{ data: string }>(
      "Page.captureScreenshot",
      { format: "png", optimizeForSpeed: true },
      page,
    );
    ok = true;
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } finally {
    if (!ok) await within(cdp.send("Browser.close", {}), 2_000, "close").catch(() => undefined);
    cdp.close();
  }
}

/** A new browser of its own, kept `keepMs` after its last connection, and a socket to it. */
async function openBrowser(
  binding: Fetcher,
  keepMs: number,
): Promise<{ browser: string; socket: WebSocket }> {
  const acquired = await binding.fetch(
    `${BINDING_HOST}/v1/devtools/browser?keep_alive=${Math.round(keepMs)}`,
    { method: "POST" },
  );
  if (!acquired.ok) throw new Error(`no browser: ${acquired.status}`);
  const { sessionId } = (await acquired.json()) as { sessionId?: string };
  if (!sessionId) throw new Error("no browser session");
  try {
    return { browser: sessionId, socket: await connect(binding, sessionId) };
  } catch (err) {
    // A browser we can't reach is closed now rather than left to sit out its idle time.
    await binding
      .fetch(`${BINDING_HOST}/v1/devtools/browser/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      })
      .catch(() => undefined);
    throw err;
  }
}

/** A DevTools socket to a browser that's open. */
async function connect(binding: Fetcher, browser: string): Promise<WebSocket> {
  const upgraded = await binding.fetch(
    `${BINDING_HOST}/v1/devtools/browser/${encodeURIComponent(browser)}`,
    { headers: { Upgrade: "websocket" } },
  );
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
