import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/** RFC 0006 on a phone: a resident reports a post, and a maintainer hides it from /admin. */

// The full iPhone 13 screen, 390 by 844.
test.use({ viewport: { width: 390, height: 844 } });

async function join(request: APIRequestContext, name: string) {
  const res = await request.post("/v1/session", { data: { name, kind: "human" } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return {
    id: body.residentId as string,
    token: body.token as string,
    auth: { authorization: `Bearer ${body.token}` },
  };
}

/** Act as this resident in the browser, the way joining would leave it. */
async function signIn(page: Page, who: { id: string; token: string }) {
  await page.evaluate(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token ?? "");
      localStorage.setItem("terrakin.resident", id ?? "");
    },
    [who.token, who.id],
  );
}

test("a resident reports a post from a phone, and a maintainer hides it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => {
    errors.push(`unexpected dialog: ${d.message()}`);
    void d.dismiss();
  });
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });

  const author = await join(page.request, "Pebble");
  const reporter = await join(page.request, "Quill");
  const maintainer = await join(page.request, "Marlo");
  // The test server's hook: resident ids are random, so the suite names its maintainer here.
  const grant = await page.request.post("/v1/test/maintainer", {
    data: { residentId: maintainer.id },
  });
  expect(grant.ok()).toBe(true);

  const created = await page.request.post("/v1/posts", {
    headers: author.auth,
    data: { text: "Cheap lanterns, ask me how" },
  });
  expect(created.status()).toBe(201);
  const post = (await created.json()).post as { id: string };

  // Quill opens the post and reports it from the post's More menu.
  await page.goto("/");
  await signIn(page, reporter);
  await page.goto(`/p/${post.id}`);
  const card = page.locator(`article[data-post="${post.id}"]`);
  await card.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Report post" }).click();
  const sheet = page.locator("dialog.report-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Send report" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Pick a reason first.");
  await sheet.getByText("Spam", { exact: true }).click();
  await sheet.locator("#report-note").fill("The same lantern ad on every post");
  await sheet.getByRole("button", { name: "Send report" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#site-toast")).toContainText("A maintainer will take a look");

  // Quill can't open the queue.
  await page.goto("/admin");
  await expect(page.locator(".admin-list")).toContainText("only for Terrakin's maintainers");

  // Marlo can, and hides the post with a reason.
  await signIn(page, maintainer);
  await page.goto("/admin");
  const item = page.locator(`.admin-item[data-id="${post.id}"]`);
  await expect(item).toContainText("Cheap lanterns, ask me how");
  await expect(item).toContainText("Spam, from Quill");
  await expect(item).toContainText("The same lantern ad on every post");
  await item.getByRole("button", { name: "Hide post" }).click();
  await expect(item.getByRole("status")).toHaveText("Write a reason first.");
  await item.getByLabel("Reason").fill("Spam ad");
  await item.getByRole("button", { name: "Hide post" }).click();
  await expect(page.locator("#site-toast")).toContainText("in the log");
  await expect(item).toHaveCount(0);

  // Gone for everyone, and the queue page stays out of search.
  expect((await page.request.get(`/v1/posts/${post.id}`)).status()).toBe(404);
  await page.goto(`/p/${post.id}`);
  await expect(page.locator(".state-card")).toContainText("couldn't find");
  const adminHtml = await (await page.request.get("/admin")).text();
  expect(adminHtml).toMatch(/<meta name="robots" content="noindex"/);
  const numbers = await (await page.request.get("/v1/transparency")).json();
  expect(numbers.actions.hide_post).toBeGreaterThanOrEqual(1);

  expect(errors).toEqual([]);
});
