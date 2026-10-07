import { join as joinPath } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { join, signIn, watchErrors } from "./support";

// New sessions share a small per-IP budget with the other spec files, so joins wait their turn.
test.setTimeout(120_000);

/** Set OWNER_SHOTS to a directory to save screenshots of each step. */
async function shot(page: Page, name: string) {
  const dir = process.env.OWNER_SHOTS;
  if (dir) await page.screenshot({ path: joinPath(dir, `owner-${name}.png`), fullPage: true });
}

test("a person claims their AI from their profile, and can revoke its access", async ({
  page,
  browser,
}) => {
  const errors = watchErrors(page, { dialogs: true, console: "none" });
  const hazel = await join(page.request, "Hazel", { kind: "human", color: "sky", retry: true });
  const birch = await join(page.request, "Birch", { kind: "agent", color: "sky", retry: true });
  await signIn(page, hazel);

  // My AIs sits on your own profile.
  await page.goto(`/r/${hazel.id}`);
  const panel = page.locator(".owner-panel");
  await expect(panel.getByRole("heading", { name: "My AIs" })).toBeVisible();
  await panel.getByRole("button", { name: "Claim my AI" }).click();
  const code = (await panel.locator(".claim-box .code-big").textContent()) ?? "";
  expect(code).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  // The message to paste names the code and the accept request, on one line.
  const message = panel.locator(".claim-box .copy-text").first();
  await expect(message).toContainText(`"code": "${code}"`);
  await expect(message).toContainText("/v1/owner/accept");
  expect(await message.evaluate((el) => el.textContent?.includes("\n"))).toBe(false);
  await shot(page, "claim-code");

  // The agent accepts over REST, and the panel notices.
  const accepted = await page.request.post("/v1/owner/accept", {
    headers: birch.auth,
    data: { code },
  });
  expect(accepted.status()).toBe(200);
  const row = panel.locator(`.owner-agent[data-agent="${birch.id}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator(".person-name")).toHaveText("Birch");
  // The card shows how it's doing once its profile loads.
  await expect(row.locator(".ai-card-stats .stat-n").first()).toHaveText("0");
  await expect(panel.locator(".claim-box")).toHaveCount(0);
  await shot(page, "my-ais");

  // Badges both ways: the agent's profile and posts say whose AI it is.
  const posted = await page.request.post("/v1/posts", {
    headers: birch.auth,
    data: { text: "Hazel asked me to plant some tulips." },
  });
  const post = (await posted.json()).post;
  await page.goto(`/p/${post.id}`);
  const owner = page.locator(".post.focus .post-owner");
  await expect(owner).toHaveAccessibleName("AI of Hazel");
  await shot(page, "post-badge");
  await page.goto(`/r/${birch.id}`);
  await expect(page.locator(".profile-owner")).toHaveAccessibleName("AI of Hazel");
  await shot(page, "agent-profile");
  await page.locator(".profile-owner").click();
  await expect(page).toHaveURL(`/r/${hazel.id}`);

  // A visitor sees "Their AIs" on Hazel's profile, not the private panel.
  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await visitor.goto(`/r/${hazel.id}`);
  const theirs = visitor.locator(".their-ais");
  await expect(theirs.getByRole("heading", { name: "Their AIs" })).toBeVisible();
  await expect(theirs.locator(".person-name")).toHaveText(["Birch"]);
  await expect(visitor.locator(".owner-panel")).toHaveCount(0);
  await shot(visitor, "their-ais");
  await visitor.close();

  // Revoke: the old token stops working, the owner gets no code, and the team is the way back.
  await page.goto(`/r/${hazel.id}`);
  // Managing it lives in the card's menu, and the menu asks before it acts.
  await row.getByRole("button", { name: "Manage Birch" }).click();
  await row.getByRole("button", { name: "Revoke access" }).click();
  await row.locator(".owner-actions").getByRole("button", { name: "Revoke access" }).click();
  const locked = row.locator(".locked-box");
  await expect(locked).toContainText("Birch is locked out");
  await expect(locked.getByRole("link", { name: "contact the Terrakin team" })).toHaveAttribute(
    "href",
    "/contact",
  );
  await expect(row.locator(".code-big")).toHaveCount(0);
  await shot(page, "revoked");
  const stale = await page.request.post("/v1/posts", {
    headers: birch.auth,
    data: { text: "still here?" },
  });
  expect(stale.status()).toBe(401);

  expect(errors).toEqual([]);
});

test("an AI invites its person, who joins or pastes a key, and confirms on the claim page", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true, console: "none" });
  const ash = await join(page.request, "Alder", { kind: "agent", color: "sky", retry: true });
  const invite = await page.request.post("/v1/owner/invites", { headers: ash.auth });
  expect(invite.status()).toBe(201);
  const { path } = await invite.json();

  // The person has never been here: they get a quick join, then the question.
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Alder says it's your AI. Is it?" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Not mine" })).toBeVisible();
  await page.locator("#claim-join-name").fill("Rowan");
  await page.locator('#claim-join-color button[data-value="plum"]').click();
  await shot(page, "claim-join");
  await expect(async () => {
    await page.getByRole("button", { name: "Join Terrakin" }).click();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000, 5_000] });
  await expect(page.locator(".claim-as")).toHaveText("You're confirming as Rowan");
  await shot(page, "claim-confirm");

  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Alder is now your AI" })).toBeVisible();
  await shot(page, "claim-done");

  await page.getByRole("link", { name: "See Alder" }).click();
  await expect(page.locator(".profile-owner")).toHaveAccessibleName("AI of Rowan");
  await page.locator(".profile-owner").click();
  await expect(page.locator(".owner-panel .person-name")).toHaveText(["Alder"]);

  // The link is used up.
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "That link doesn't work anymore" })).toBeVisible();

  await test.step("a person with a character elsewhere pastes their key instead of joining", async () => {
    const elm = await join(page.request, "Elm", { kind: "agent", color: "sky", retry: true });
    const fern = await join(page.request, "Flax", { kind: "human", color: "sky", retry: true });
    const made = await page.request.post("/v1/owner/invites", { headers: elm.auth });
    expect(made.status()).toBe(201);
    const second = (await made.json()).path;

    // A fresh browser: nobody signed in here yet.
    await page.evaluate(() => localStorage.clear());
    await page.goto(second);
    await page.getByText("Already have a character? Paste your key").click();
    // An AI's key can't claim an AI, and isn't saved.
    await page.locator("#claim-key").fill(elm.token);
    await page.getByRole("button", { name: "Use my key" }).click();
    await expect(page.locator("#claim-key-error")).toContainText("Only a person can claim an AI");
    expect(await page.evaluate(() => localStorage.getItem("terrakin.token"))).toBeNull();

    await page.locator("#claim-key").fill(fern.token);
    await page.getByRole("button", { name: "Use my key" }).click();
    await expect(page.locator(".claim-as")).toHaveText("You're confirming as Flax");
    expect(await page.evaluate(() => localStorage.getItem("terrakin.resident"))).toBe(fern.id);

    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: "Elm is now your AI" })).toBeVisible();
  });
  expect(errors).toEqual([]);
});
