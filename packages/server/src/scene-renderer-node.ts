import { SCENE_PHOTO_LIMITS } from "@terrakin/protocol";
import type { Browser, BrowserContext } from "playwright-core";
import type { SceneRenderer } from "./scene-photo-desk";
import { WarmBrowsers } from "./warm-browsers";

/**
 * Scene photos on Node (RFC 0049): Playwright's Chromium, the one the e2e suite installs, drives
 * the photo page. One browser is kept open. A photo page is kept open `warmMs` after its photo
 * and asked for the next with its own `photoNext`, as Browser Run's are (decision 0390), so its
 * compiled drawing programs carry over; with none open, a photo gets a fresh context. The browser
 * only ever loads `origin`: every request elsewhere is aborted, so a scene can't fetch or navigate
 * away. Without Chromium installed every render throws, and the route answers `photos_busy`.
 */
export function playwrightRenderer(origin: string): SceneRenderer {
  const allowed = new URL(origin).origin;
  let browser: Promise<Browser> | undefined;
  const open = () => {
    browser ??= import("playwright-core").then(async ({ chromium }) => {
      const launched = await chromium.launch({
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
      });
      // A browser that crashed is launched again next time rather than asked forever.
      launched.on("disconnected", () => {
        browser = undefined;
      });
      return launched;
    });
    // A launch that failed is tried again next time rather than remembered.
    browser.catch(() => {
      browser = undefined;
    });
    return browser;
  };
  const warm = new WarmBrowsers<BrowserContext>({
    keepMs: SCENE_PHOTO_LIMITS.warmMs,
    most: SCENE_PHOTO_LIMITS.atOnce,
    now: () => Date.now(),
    close: (context) => void context.close().catch(() => undefined),
  });
  /** A fresh context, kept to our own origin, with nothing open in it yet. */
  const fresh = async () => {
    const context = await (await open()).newContext({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 1,
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === allowed ? route.continue() : route.abort(),
    );
    return context;
  };
  /**
   * Take the photo in `context`: by its open photo page's own `photoNext` (`next`), or in a new
   * page (`load`). It throws `PageFailed` when the page says it couldn't draw.
   */
  const shoot = async (context: BrowserContext, how: "next" | "load", url: string) => {
    const ticket = new URL(url).searchParams.get("t") ?? "";
    let page = context.pages()[0];
    if (how === "next") {
      // A page past its life, or from before a deploy, says no: a fresh context loads it again.
      const took =
        page !== undefined &&
        (await page.evaluate(
          (t) =>
            // Runs in the page, where the photo page puts `photoNext` on the window.
            (globalThis as { photoNext?: (ticket: string) => boolean }).photoNext?.(t) === true,
          ticket,
        ));
      if (!page || !took) throw new Error("the photo page is too old");
    } else {
      page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: SCENE_PHOTO_LIMITS.readyMs });
    }
    // The page says `ready` once the scene has drawn, or `failed`.
    const said = page.locator('[data-photo="ready"], [data-photo="failed"]').first();
    await said.waitFor({
      timeout: how === "next" ? SCENE_PHOTO_LIMITS.warmTryMs : SCENE_PHOTO_LIMITS.readyMs,
    });
    if ((await said.getAttribute("data-photo")) !== "ready")
      throw new PageFailed("the photo page couldn't draw the scene");
    return new Uint8Array(await page.screenshot({ type: "png" }));
  };
  const close = (context: BrowserContext) => context.close().catch(() => undefined);

  return async (url) => {
    const at = new URL(url);
    if (at.origin !== allowed || at.pathname !== "/photo")
      throw new Error("scene photos load only the photo page");
    // Idle pages close once they've sat long enough, photo or no photo after them.
    setTimeout(() => warm.expire(), SCENE_PHOTO_LIMITS.warmMs).unref();
    const kept = warm.take();
    if (kept) {
      try {
        const png = await shoot(kept, "next", url);
        warm.give(kept);
        return png;
      } catch (err) {
        await close(kept);
        // The page drew nothing and said so: a fresh one would fail the same way.
        if (err instanceof PageFailed) throw err;
      }
    }
    const context = await fresh();
    try {
      const png = await shoot(context, "load", url);
      warm.give(context);
      return png;
    } catch (err) {
      await close(context);
      throw err;
    }
  };
}

/** The photo page drew nothing and said so. */
class PageFailed extends Error {}
