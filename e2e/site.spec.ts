import { expect, test } from "@playwright/test";
import { PAGES, type SitePage, TRUST_PAGES } from "../packages/protocol/src/site";
import { settler, signIn, touchingCards, watchErrors } from "./support";

test("the homepage and every static page render, describe themselves, and have Markdown twins", async ({
  page,
}) => {
  const errors = watchErrors(page);

  await test.step("the homepage describes itself to machines and links its docs and trust pages", async () => {
    await page.goto("/");
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    const graph = (JSON.parse(jsonLd ?? "{}")["@graph"] ?? []) as { "@type": string }[];
    expect(graph.map((node) => node["@type"])).toEqual([
      "WebSite",
      "Organization",
      "WebApplication",
      "FAQPage",
    ]);
    await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute(
      "href",
      "/index.md",
    );

    const foot = page.locator(".site-foot");
    for (const [name, href] of [
      ["Docs and API", "/docs"],
      ["What's new", "/changelog"],
      ["OpenAPI", "/v1/openapi.json"],
      ...TRUST_PAGES.map((p) => [p.label, p.href] as const),
    ] as const) {
      await expect(foot.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
  });

  await test.step("agents get the home page's Markdown from the same URL", async () => {
    const home = await page.request.get("/", { headers: { accept: "text/markdown" } });
    expect(home.headers()["content-type"]).toContain("text/markdown");
    expect(home.headers().vary).toBe("Accept");
    expect(await home.text()).toContain("## When to use Terrakin");
  });

  for (const { path, markdown, source } of (PAGES as readonly SitePage[]).filter(
    (p) => p.kind === "static",
  )) {
    const md = markdown ?? `${path}.md`;
    await test.step(`${path} renders as a real page at phone width`, async () => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(response?.headers().link).toContain(`<${md}>; rel="alternate"`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const text = (await page.locator("main").innerText()).trim();
      expect(text.length).toBeGreaterThan(500);
      await expect(page.locator(`link[rel="alternate"][type="text/markdown"]`)).toHaveAttribute(
        "href",
        md,
      );
      // Phone width: nothing scrolls sideways.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      const twin = await page.request.get(md);
      expect(twin.headers()["content-type"]).toContain("text/markdown");
      // A page built from a file elsewhere (/docs/skill) has that file as its twin, as it is.
      if (!source) expect(await twin.text()).toMatch(/^---\ntitle: /);
    });
  }

  await test.step("each devlog post is a page of its own, linked from /devlog, with its twin", async () => {
    await page.goto("/devlog");
    await page.getByRole("link", { name: "Read more" }).first().click();
    await expect(page).toHaveURL(/\/devlog\/\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator(`link[rel="alternate"][type="text/markdown"]`)).toHaveAttribute(
      "href",
      `${new URL(page.url()).pathname}.md`,
    );
    const asked = await page.request.get(page.url(), { headers: { accept: "text/markdown" } });
    expect(asked.headers()["content-type"]).toContain("text/markdown");
    expect(await asked.text()).toMatch(/^---\ntitle: /);
    const feed = await page.request.get("/devlog.xml");
    expect(feed.headers()["content-type"]).toContain("application/atom+xml");
  });
  expect(errors).toEqual([]);
});

test("the changelog page's links, feed, and API all work at phone size", async ({
  page,
  request,
}) => {
  const errors = watchErrors(page);
  // The full iPhone 13 screen (the device preset's viewport leaves out the browser bars).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".site-foot").getByRole("link", { name: "What's new", exact: true }).click();
  await expect(page).toHaveURL(/\/changelog$/);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "What's new in Terrakin" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  // Both feeds are linked from every static page, for feed readers to find.
  const feeds = page.locator('link[rel="alternate"][type="application/atom+xml"]');
  await expect(feeds).toHaveCount(2);
  expect(await feeds.evaluateAll((links) => links.map((l) => l.getAttribute("href")))).toEqual([
    "/changelog.xml",
    "/devlog.xml",
  ]);

  // Every link on our own site resolves.
  const hrefs = await page
    .locator("main a[href], .site-foot a[href]")
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
  const local = [
    ...new Set(
      hrefs.filter(
        (h) => h.startsWith(new URL(page.url()).origin) || /^https:\/\/terrakin\.org\//.test(h),
      ),
    ),
  ].map((h) => new URL(h).pathname);
  expect(local).toEqual(expect.arrayContaining(["/changelog.md", "/changelog.xml", "/docs"]));
  for (const path of local) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
  expect(errors).toEqual([]);

  const feed = await request.get("/changelog.xml");
  expect(feed.headers()["content-type"]).toContain("application/atom+xml");
  expect(await feed.text()).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');

  const api = await request.get("/v1/changelog?kind=security");
  const body = (await api.json()) as { entries: { kind: string }[]; latest: string };
  expect(body.entries.length).toBeGreaterThan(0);
  expect(body.entries.every((e) => e.kind === "security")).toBe(true);
  expect(body.latest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("cards on a resident's pages never touch at phone size", async ({ page, request }) => {
  const errors = watchErrors(page);
  const who = await settler(request, "Ledger Wren");
  await signIn(page, who);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/",
    "/purse",
    "/inventory",
    "/shop",
    "/town",
    "/notifications",
    "/letters",
  ]) {
    await page.goto(path);
    await expect(page.locator(".page h1, .page .paper").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await touchingCards(page), path).toEqual([]);
  }
  expect(errors).toEqual([]);
});
