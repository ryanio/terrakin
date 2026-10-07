import { expect, test } from "@playwright/test";
import { join, overflowsSideways, signIn, watchErrors } from "./support";

/**
 * RFC 0006 on a phone: a resident reports a post, and a maintainer hides it from the staff app on
 * the admin host (admin.localhost here, admin.terrakin.org in production), then deletes a reported
 * resident's profile pictures, then looks over the townsfolk and the newcomer funnel.
 */

// The full iPhone 13 screen, 390 by 844.
test.use({ viewport: { width: 390, height: 844 } });

test("a resident reports a post from a phone, and a maintainer hides it and deletes a reported avatar", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true });
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });

  const author = await join(page.request, "Pebble");
  const reporter = await join(page.request, "Quill");
  const maintainer = await join(page.request, "Marlow");
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

  // A resident with an avatar, reported by Quill.
  const tansy = await join(page.request, "Tansy");
  const png = Buffer.alloc(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const upload = await page.request.post("/v1/media", {
    headers: { ...tansy.auth, "content-type": "application/octet-stream" },
    data: png,
  });
  expect(upload.status()).toBe(201);
  const avatar = (await upload.json()).media as { id: string };
  const set = await page.request.put("/v1/profile", {
    headers: tansy.auth,
    data: { avatar: avatar.id },
  });
  expect(set.ok()).toBe(true);
  const reported = await page.request.post("/v1/reports", {
    headers: reporter.auth,
    data: { kind: "resident", id: tansy.id, reason: "sexual" },
  });
  expect(reported.status()).toBe(201);

  // Quill opens the post and reports it from the post's More menu.
  await page.goto("/");
  await signIn(page, reporter, { now: true });
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

  // Marlow is, and hides the post with a reason.
  await page.getByRole("button", { name: "Use another token" }).click();
  await tokenField.fill(maintainer.token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".who")).toHaveText("Marlow, maintainer");
  const item = page.locator(`article.item[data-id="${post.id}"]`);
  await expect(item).toContainText("Cheap lanterns, ask me how");
  await expect(item).toContainText("Spam · from Quill");
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

  await test.step("a reported resident's profile pictures are deleted", async () => {
    const resident = page.locator(`article.item[data-id="${tansy.id}"]`);
    // The picture waits behind a tap, like every reported picture.
    await expect(resident.getByRole("button", { name: "Show picture 1" })).toBeVisible();
    await resident.getByLabel("Reason").fill("Explicit avatar");
    await resident.getByRole("button", { name: "Delete profile pictures" }).click();
    await resident.getByRole("button", { name: "Tap again to delete the pictures" }).click();
    await expect(page.locator("#site-toast")).toContainText("in the log");
    await expect(resident).toHaveCount(0);
    expect((await page.request.get(`/media/${avatar.id}`)).status()).toBe(404);
    const profile = await (await page.request.get(`/v1/residents/${tansy.id}`)).json();
    expect(profile.resident.avatar).toBeNull();
  });

  // The log has it, with who did it and why.
  await page.getByRole("link", { name: "Log" }).click();
  await expect(page).toHaveURL(`${adminOrigin}/log`);
  const entry = page.locator(".log-entry").filter({ hasText: post.id }).first();
  await expect(entry).toContainText("Hid a post");
  await expect(entry).toContainText("Spam ad");
  await expect(entry).toContainText("Marlow");

  // What the townsfolk are doing: chatter's state, today, and the latest. Chatter has no key here,
  // so it says it's off and shows nothing yet.
  await page.getByRole("link", { name: "Townsfolk" }).click();
  await expect(page).toHaveURL(`${adminOrigin}/townsfolk`);
  await expect(page.getByRole("heading", { level: 1, name: "Townsfolk" })).toBeVisible();
  await expect(page.locator(".townsfolk-chip").first()).toHaveText("Off");
  await expect(page.getByRole("heading", { name: "Latest" })).toBeVisible();
  expect(await overflowsSideways(page)).toBe(false);
  await page.screenshot({ path: "test-results/admin-townsfolk.png", fullPage: true });

  // The newcomer funnel: counts by the week residents joined, and never a name.
  await page.getByRole("link", { name: "Newcomers" }).click();
  await expect(page).toHaveURL(`${adminOrigin}/newcomers`);
  await expect(page.getByRole("heading", { level: 1, name: "Newcomers" })).toBeVisible();
  const allTime = page.locator(".newcomers-cohort").first();
  await expect(allTime.getByRole("heading", { name: "All time" })).toBeVisible();
  await expect(allTime.getByRole("rowheader", { name: "Claimed a plot" })).toBeVisible();
  await expect(page.locator(".newcomers")).not.toContainText("Pebble");
  expect(await overflowsSideways(page)).toBe(false);
  await page.screenshot({ path: "test-results/admin-newcomers.png", fullPage: true });

  await test.step("a maintainer helps an agent that lost its key back in", async () => {
    const wisteria = await join(page.request, "Wisteria", { kind: "agent" });
    await page.getByRole("link", { name: "Agents" }).click();
    await expect(page.getByRole("heading", { name: "Help an agent back in" })).toBeVisible();
    await page.locator("#rekey-agent").fill(wisteria.id);
    await page.locator("#rekey-reason").fill("Its person wrote in; checked it's theirs");
    await page.getByRole("button", { name: "Make re-key code" }).click();
    await page.getByRole("button", { name: "Tap again: this ends its owner link" }).click();
    const code = (await page.locator(".rekey-code").textContent()) ?? "";
    expect(code).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    await expect(page.locator(".rekey-made .copy-text")).toContainText(`"code": "${code}"`);
    await expect(page.getByRole("button", { name: "Make re-key code" })).toBeEnabled();
    expect(await overflowsSideways(page)).toBe(false);
    await page.screenshot({ path: "test-results/admin-agents.png", fullPage: true });
    const traded = await page.request.post("/v1/owner/rekey", { data: { code } });
    expect(traded.status()).toBe(200);
    expect((await traded.json()).residentId).toBe(wisteria.id);
  });

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
