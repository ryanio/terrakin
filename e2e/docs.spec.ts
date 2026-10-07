import { expect, type Page, test } from "@playwright/test";

/**
 * terrakin.org/docs: static pages built from the generated guides and the OpenAPI document
 * (decision 0195), walked at phone size against the production build, so the real
 * Content-Security-Policy applies. Any CSP violation, console error, script, or request to another
 * host fails the test. What the pages say is the protocol's `reference.test.ts` and the client's
 * `site-page.test.ts` to check; the desktop layout is the one every static page shares.
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
    if (!url.startsWith(origin)) problems.push(`request: ${url}`);
    if (r.resourceType() === "script") problems.push(`script: ${url}`);
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

/** Nothing on the page scrolls sideways. */
async function fits(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("docs at phone size", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("reads the guides, follows the reference to a route and a model, and keeps a deep link", async ({
    page,
    baseURL,
  }) => {
    const problems = await watch(page, baseURL);

    await test.step("/docs has the guides and the reference's index", async () => {
      await page.goto("/docs");
      await expect(page).toHaveTitle("Docs · Terrakin");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terrakin docs");
      for (const guide of ["Getting started for people", "Quickstart for AI agents", "Safety"]) {
        await expect(page.getByRole("heading", { level: 2, name: guide })).toBeAttached();
      }
      await fits(page);
      // The page's own contents list, first in the article.
      const article = page.locator(".layout-main");
      await article.getByRole("link", { name: "API reference", exact: true }).first().click();
      await expect(page.getByRole("heading", { name: "API reference" })).toBeInViewport();
    });

    await test.step("an area lists its routes, each with its body, answer, and errors", async () => {
      await page.getByRole("table").getByRole("link", { name: "Social", exact: true }).click();
      await expect(page).toHaveURL(/\/docs\/api\/social$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Social");
      // The page's contents, which list every route with its method.
      await page
        .getByRole("navigation", { name: /routes$/ })
        .getByRole("link", { name: "POST /v1/posts", exact: true })
        .click();
      const route = page.getByRole("heading", { name: "POST /v1/posts", exact: true });
      await expect(route).toBeInViewport();
      await fits(page);
      await page.getByRole("link", { name: "CreatePostRequest" }).first().click();
      await expect(page).toHaveURL(/\/docs\/api\/models#createpostrequest$/);
      await expect(page.getByRole("heading", { name: "CreatePostRequest" })).toBeInViewport();
    });

    await test.step("a deep link survives a reload", async () => {
      await page.goto("about:blank");
      await page.goto("/docs/api/social#post-v1posts");
      const route = page.getByRole("heading", { name: "POST /v1/posts", exact: true });
      await expect(route).toBeInViewport();
      await page.reload();
      await expect(route).toBeInViewport();
    });
    expect(problems).toEqual([]);

    await test.step("the site's main bar links to the docs, and still fits a phone", async () => {
      await page.goto("/");
      await fits(page);
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Docs" })
        .click();
      await expect(page).toHaveURL(/\/docs$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terrakin docs");
    });
  });
});
