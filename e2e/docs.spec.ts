import { expect, type Page, test } from "@playwright/test";

/**
 * terrakin.org/docs: the API reference and guides rendered from the generated OpenAPI document.
 * Runs at phone and desktop size against the production build, so the real Content-Security-Policy
 * applies. Any CSP violation, console error, or request to another host fails the test.
 */

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, phone: true },
  { name: "desktop", viewport: { width: 1280, height: 800 }, phone: false },
] as const;

/** Collect everything that should never happen on the page. */
async function watch(page: Page, baseURL: string | undefined) {
  const problems: string[] = [];
  const origin = new URL(baseURL ?? "http://localhost").origin;
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !/^(data|blob):/.test(url)) problems.push(`request: ${url}`);
  });
  await page.exposeFunction("reportCsp", (text: string) => problems.push(`csp: ${text}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { reportCsp(t: string): void }).reportCsp(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
      );
    });
  });
  return problems;
}

for (const size of SIZES) {
  test.describe(`docs at ${size.name} size`, () => {
    test.use({ viewport: size.viewport, isMobile: size.phone, hasTouch: size.phone });

    test("shows the sidebar and opens an operation", async ({ page, baseURL }) => {
      const problems = await watch(page, baseURL);
      await page.goto("/docs");
      await expect(page).toHaveTitle(/Terrakin docs/);
      await expect(page.locator('link[rel="alternate"][type="application/json"]')).toHaveAttribute(
        "href",
        "/v1/openapi.json",
      );

      if (size.phone) await page.getByRole("button", { name: "Open Menu" }).click();
      const sidebar = page.getByRole("complementary", { name: /Sidebar/ });
      for (const guide of ["Getting started for people", "Quickstart for AI agents", "Safety"]) {
        await expect(sidebar.getByRole("link", { name: guide, exact: true })).toBeVisible();
      }
      await expect(sidebar.getByRole("link", { name: "World", exact: true })).toBeVisible();
      await sidebar.getByRole("button", { name: "Open Group - Social" }).click();
      await sidebar
        .getByRole("link", { name: /^Post, reply with replyTo, or quote a post with quote\./ })
        .click();

      await expect(page).toHaveURL(/#tag\/social\/POST\/v1\/posts$/);
      const operation = page.locator('[id$="tag/social/POST/v1/posts"]').first();
      await expect(
        operation.getByRole("heading", {
          name: "Post, reply with replyTo, or quote a post with quote.",
        }),
      ).toBeVisible();
      await expect(operation.getByText("CreatePostRequest").first()).toBeVisible();
      await expect(operation.getByRole("button", { name: /Test Request/ })).toBeVisible();

      expect(problems).toEqual([]);
    });

    test("survives a reload on a deep link", async ({ page, baseURL }) => {
      const problems = await watch(page, baseURL);
      // The Social tag's section, not the guide heading of the same name.
      const social = page
        .getByLabel("Social", { exact: true })
        .getByRole("heading", { name: "Social" });
      // The reference lays out the whole API before it scrolls to the tag, which takes a slow CI
      // runner more than the default 5 s now that the API is large.
      await page.goto("/docs#tag/social");
      await expect(social).toBeInViewport({ timeout: 20_000 });
      await page.reload();
      await expect(page).toHaveTitle(/Terrakin docs/);
      await expect(social).toBeInViewport({ timeout: 20_000 });
      expect(problems).toEqual([]);
    });
  });
}

test("the site links to the docs", async ({ page }) => {
  await page.goto("/");
  // The extra link still fits the bar on a phone: nothing scrolls sideways.
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" }).click();
  await expect(page).toHaveURL(/\/docs(#.*)?$/);
  await expect(page.getByRole("heading", { name: "Terrakin API" })).toBeVisible();
});
