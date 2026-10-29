/**
 * Scene photos on Cloudflare (RFC 0049): Browser Run, through this Worker's `BROWSER` binding,
 * draws the main Worker's photo page and answers the PNG. It lives here rather than in the main
 * Worker because the browser library is the kind of weight decision 0299 keeps off the main
 * Worker's cold start.
 *
 * Each photo launches a browser and closes it after, since Browser Run bills a kept session for
 * every second it idles. The browser only ever loads `origin`: every other request is aborted, so
 * a scene can't fetch or navigate anywhere else.
 */
export async function renderScene(
  browserBinding: Fetcher,
  url: string,
  origin: string,
  readyMs: number,
): Promise<Uint8Array> {
  const at = new URL(url);
  if (at.origin !== origin || at.pathname !== "/photo")
    throw new Error("scene photos load only the photo page");
  // Loaded on the first photo, so a card drawing never pays for it.
  const { default: puppeteer } = await import("@cloudflare/puppeteer");
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const to = new URL(request.url());
      const ours = to.origin === origin || to.protocol === "data:" || to.protocol === "blob:";
      void (ours ? request.continue() : request.abort());
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: readyMs });
    // The page says `ready` once the scene has drawn, or `failed`.
    await page.waitForSelector('[data-photo="ready"], [data-photo="failed"]', { timeout: readyMs });
    const ready = await page.$eval("body", (body) => body.dataset.photo === "ready");
    if (!ready) throw new Error("the photo page couldn't draw the scene");
    return new Uint8Array(await page.screenshot({ type: "png" }));
  } finally {
    await browser.close();
  }
}
