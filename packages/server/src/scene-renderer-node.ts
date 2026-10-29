import { SCENE_PHOTO_LIMITS } from "@terrakin/protocol";
import type { Browser } from "playwright-core";
import type { SceneRenderer } from "./scene-photo-desk";

/**
 * Scene photos on Node (RFC 0049): Playwright's Chromium, the one the e2e suite installs, drives
 * the photo page. One browser is kept open and each photo gets a fresh context, closed after. The
 * browser only ever loads `origin`: every request elsewhere is aborted, so a scene can't fetch or
 * navigate away. Without Chromium installed every render throws, and the route answers
 * `photos_busy`.
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
  return async (url) => {
    const at = new URL(url);
    if (at.origin !== allowed || at.pathname !== "/photo")
      throw new Error("scene photos load only the photo page");
    const context = await (await open()).newContext({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 1,
    });
    try {
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === allowed ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: SCENE_PHOTO_LIMITS.readyMs });
      // The page says `ready` once the scene has drawn, or `failed`.
      const said = page.locator('[data-photo="ready"], [data-photo="failed"]').first();
      await said.waitFor({ timeout: SCENE_PHOTO_LIMITS.readyMs });
      if ((await said.getAttribute("data-photo")) !== "ready")
        throw new Error("the photo page couldn't draw the scene");
      return new Uint8Array(await page.screenshot({ type: "png" }));
    } finally {
      await context.close();
    }
  };
}
