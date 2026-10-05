import { expect, test } from "@playwright/test";
import { advanceDay, overflowsSideways, read, settler, signIn, watchErrors } from "./support";

/**
 * Bounties (RFC 0008) on a phone: a resident posts a job on /bounties, a neighbor takes it on and
 * marks it done, and the poster pays them. Posting waits for a resident's second day, so this
 * moves the shared clock on and runs after market.spec.ts, alone.
 */

test("post a bounty, a neighbor takes it on and marks it done, and gets paid", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const mara = await settler(page.request, "Mara");
  const nils = await settler(page.request, "Nils");
  await advanceDay(page.request);

  await signIn(page, mara);
  await page.goto("/bounties");
  await expect(page.getByRole("heading", { level: 1, name: "Bounties" })).toBeVisible();
  await page.getByLabel("The job").fill("Water my lemons");
  await page.getByLabel("Details (optional)").fill("Twice this week, please.");
  await page.getByLabel("Coins you'll pay").fill("15");
  await page.getByRole("button", { name: "Post it" }).click();
  await expect(page.locator("#site-toast")).toContainText("Your bounty is up");
  const mine = page.locator(".bounty").filter({ hasText: "Water my lemons" });
  await expect(mine.locator(".bounty-reward")).toContainText("15 coins from");
  await expect(mine.locator(".bounty-reward .person-name")).toHaveText("Mara");
  await expect(mine.getByRole("button", { name: "Take it back" })).toBeVisible();
  expect(await overflowsSideways(page)).toBe(false);
  await page.screenshot({ path: "test-results/bounty-posted.png", fullPage: true });

  await signIn(page, nils);
  await page.goto("/bounties");
  const job = page.locator(".bounty").filter({ hasText: "Water my lemons" });
  const take = job.getByRole("button", { name: "Take it on" });
  expect((await take.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await take.click();
  await expect(page.locator("#site-toast")).toContainText("It's yours to do");
  await expect(job).toContainText("Nils is on it");
  await job.getByRole("button", { name: "Mark done" }).click();
  await expect(job).toContainText("Nils says it's done");

  await signIn(page, mara);
  await page.goto("/bounties");
  const pay = page
    .locator(".bounty")
    .filter({ hasText: "Water my lemons" })
    .locator('[data-move="confirm_bounty"]');
  await expect(pay).toHaveText("Pay Nils 15 coins");
  await pay.click();
  // Paying is a second tap.
  await expect(pay).toHaveText("Tap again to pay 15 coins");
  await pay.click();
  await expect(page.locator("#site-toast")).toContainText("Paid Nils");
  const paid = page.locator(".bounty-done").filter({ hasText: "Water my lemons" });
  await expect(paid).toContainText("15 coins to");
  await expect(paid.locator(".person-name")).toHaveText("Nils");
  expect(await overflowsSideways(page)).toBe(false);
  await page.screenshot({ path: "test-results/bounty-paid.png", fullPage: true });

  const ledger = (await read(page.request, nils.token, "/v1/purse")).purse.ledger;
  expect(ledger).toContainEqual(expect.objectContaining({ amount: 15, reason: "bounty" }));
  expect(errors).toEqual([]);
});
