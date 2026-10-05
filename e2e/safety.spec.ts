import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * RFC 0006 on a phone: a resident reports a post, and a maintainer hides it from the staff app on
 * the admin host (admin.localhost here, admin.terrakin.org in production).
 */

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
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
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

  // The staff app lives on its own host: /admin on the main site moves there.
  await page.goto("/admin");
  expect(new URL(page.url()).hostname).toBe("admin.localhost");
  const adminOrigin = new URL(page.url()).origin;

  // The test server has no Cloudflare Access, so staff sign in with a token. Quill isn't staff.
  const tokenField = page.getByLabel("Token", { exact: true });
  await tokenField.fill(reporter.token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".state-card")).toContainText("Only Terrakin's maintainers");

  // Marlo is, and hides the post with a reason.
  await page.getByRole("button", { name: "Use another token" }).click();
  await tokenField.fill(maintainer.token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".who")).toHaveText("Marlo, maintainer");
  const item = page.locator(`article.item[data-id="${post.id}"]`);
  await expect(item).toContainText("Cheap lanterns, ask me how");
  await expect(item).toContainText("Spam, from Quill");
  await expect(item).toContainText("The same lantern ad on every post");
  // Maintainers can suspend for longer than a week.
  await expect(item.getByLabel("Suspend for").locator("option")).toContainText(["30 days"]);
  await item.getByRole("button", { name: "Hide post" }).click();
  await expect(item.getByRole("status")).toHaveText("Write a reason first. It goes in the log.");
  await item.getByLabel("Reason").fill("Spam ad");
  // Hiding deletes the post's files, so it takes a second tap.
  await item.getByRole("button", { name: "Hide post" }).click();
  await item.getByRole("button", { name: "Tap again to hide it and delete its files" }).click();
  await expect(page.locator("#site-toast")).toContainText("in the log");
  await expect(item).toHaveCount(0);

  // The log has it, with who did it and why.
  await page.getByRole("link", { name: "Log" }).click();
  await expect(page).toHaveURL(`${adminOrigin}/log`);
  const entry = page.locator(".log-entry").filter({ hasText: post.id }).first();
  await expect(entry).toContainText("Hid a post");
  await expect(entry).toContainText("Spam ad");
  await expect(entry).toContainText("Marlo");

  // Gone for everyone.
  expect((await page.request.get(`/v1/posts/${post.id}`)).status()).toBe(404);
  await page.goto(`/p/${post.id}`);
  await expect(page.locator(".state-card")).toContainText("couldn't find");
  const numbers = await (await page.request.get("/v1/transparency")).json();
  expect(numbers.actions.hide_post).toBeGreaterThanOrEqual(1);

  // The staff app stays out of search and runs nothing from anywhere else; its files aren't on the
  // main site.
  const adminPage = await page.request.get(`${adminOrigin}/`);
  expect(adminPage.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(adminPage.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect((await page.request.get("/_admin/")).status()).toBe(404);

  expect(errors).toEqual([]);
});

test("a maintainer deletes a reported resident's profile pictures", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const resident = await join(page.request, "Tansy");
  const reporter = await join(page.request, "Wren");
  const maintainer = await join(page.request, "Oriel");
  const grant = await page.request.post("/v1/test/maintainer", {
    data: { residentId: maintainer.id },
  });
  expect(grant.ok()).toBe(true);

  const png = Buffer.alloc(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const upload = await page.request.post("/v1/media", {
    headers: { ...resident.auth, "content-type": "application/octet-stream" },
    data: png,
  });
  expect(upload.status()).toBe(201);
  const avatar = (await upload.json()).media as { id: string };
  const set = await page.request.put("/v1/profile", {
    headers: resident.auth,
    data: { avatar: avatar.id },
  });
  expect(set.ok()).toBe(true);
  const report = await page.request.post("/v1/reports", {
    headers: reporter.auth,
    data: { kind: "resident", id: resident.id, reason: "sexual" },
  });
  expect(report.status()).toBe(201);

  await page.goto("/admin");
  await page.getByLabel("Token", { exact: true }).fill(maintainer.token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const item = page.locator(`article.item[data-id="${resident.id}"]`);
  // The picture waits behind a tap, like every reported picture.
  await expect(item.getByRole("button", { name: "Show picture 1" })).toBeVisible();
  await item.getByLabel("Reason").fill("Explicit avatar");
  await item.getByRole("button", { name: "Delete profile pictures" }).click();
  await item.getByRole("button", { name: "Tap again to delete the pictures" }).click();
  await expect(page.locator("#site-toast")).toContainText("in the log");
  await expect(item).toHaveCount(0);

  expect((await page.request.get(`/media/${avatar.id}`)).status()).toBe(404);
  const profile = await (await page.request.get(`/v1/residents/${resident.id}`)).json();
  expect(profile.resident.avatar).toBeNull();
  expect(errors).toEqual([]);
});
