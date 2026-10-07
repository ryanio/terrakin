import { expect, type Page, test } from "@playwright/test";

/**
 * terrakin.org/docs: the API reference and guides rendered from the generated OpenAPI document.
 * Runs against the production build, so the real Content-Security-Policy applies. Any CSP
 * violation, console error, or request to another host fails the test. The whole walk runs at phone
 * size; at desktop size the page only has to lay out its sidebar, since the same code opens an
 * operation and a deep link at either size. What the reference says comes from the generated
 * OpenAPI document, which `packages/protocol` tests and `pnpm gen:check` keep current.
 */

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

test.describe("docs at phone size", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("shows the sidebar, opens an operation, and survives a reload on a deep link", async ({
    page,
    baseURL,
  }) => {
    const problems = await watch(page, baseURL);

    await test.step("the sidebar opens an operation", async () => {
      await page.goto("/docs");
      await expect(page).toHaveTitle(/Terrakin docs/);
      await expect(page.locator('link[rel="alternate"][type="application/json"]')).toHaveAttribute(
        "href",
        "/v1/openapi.json",
      );

      await page.getByRole("button", { name: "Open Menu" }).click();
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
    });

    await test.step("a deep link survives a reload", async () => {
      // The Social tag's section, not the guide heading of the same name.
      const social = page
        .getByLabel("Social", { exact: true })
        .getByRole("heading", { name: "Social" });
      // A fresh load, not a jump within the page already open.
      await page.goto("about:blank");
      // The reference lays out the whole API before it scrolls to the tag, which takes a slow CI
      // runner more than the default 5 s now that the API is large.
      await page.goto("/docs#tag/social");
      await expect(social).toBeInViewport({ timeout: 20_000 });
      await page.reload();
      await expect(page).toHaveTitle(/Terrakin docs/);
      await expect(social).toBeInViewport({ timeout: 20_000 });
    });
    expect(problems).toEqual([]);

    await test.step("the site's main bar links to the docs, and still fits a phone", async () => {
      await page.goto("/");
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Docs" })
        .click();
      await expect(page).toHaveURL(/\/docs(#.*)?$/);
      // The reference renders from the whole OpenAPI document, as in the steps above.
      await expect(page.getByRole("heading", { name: "Terrakin API" })).toBeVisible({
        timeout: 20_000,
      });
    });
  });
});

test.describe("docs at desktop size", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("lays out the sidebar beside the reference", async ({ page, baseURL }) => {
    const problems = await watch(page, baseURL);
    await page.goto("/docs");
    await expect(page).toHaveTitle(/Terrakin docs/);
    const sidebar = page.getByRole("complementary", { name: /Sidebar/ });
    await expect(sidebar.getByRole("link", { name: "World", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Menu" })).toBeHidden();
    expect(problems).toEqual([]);
  });
});
