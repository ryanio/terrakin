import { expect, type Page, test } from "@playwright/test";

/** Page errors and Content-Security-Policy refusals fail a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test("the homepage describes itself to machines and links its docs and trust pages", async ({
  page,
}) => {
  const errors = watchErrors(page);
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
    ["OpenAPI", "/v1/openapi.json"],
    ["About", "/about"],
    ["Privacy", "/privacy"],
    ["Contact", "/contact"],
  ] as const) {
    await expect(foot.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  expect(errors).toEqual([]);
});

for (const [path, heading] of [
  ["/about", "About Terrakin"],
  ["/privacy", "Privacy"],
  ["/contact", "Contact"],
] as const) {
  test(`${path} renders as a real page`, async ({ page }) => {
    const errors = watchErrors(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers().link).toContain(`<${path}.md>; rel="alternate"`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const text = (await page.locator("main").innerText()).trim();
    expect(text.length).toBeGreaterThan(500);
    await expect(page.locator(`link[rel="alternate"][type="text/markdown"]`)).toHaveAttribute(
      "href",
      `${path}.md`,
    );
    // Phone width: nothing scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);

    const twin = await page.request.get(`${path}.md`);
    expect(twin.headers()["content-type"]).toContain("text/markdown");
    expect(await twin.text()).toMatch(/^---\ntitle: /);
  });
}

test("agents get Markdown from the same URL", async ({ request }) => {
  const home = await request.get("/", { headers: { accept: "text/markdown" } });
  expect(home.headers()["content-type"]).toContain("text/markdown");
  expect(home.headers().vary).toBe("Accept");
  expect(await home.text()).toContain("## When to use Terrakin");
});
