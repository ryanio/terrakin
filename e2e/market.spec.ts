import { expect, test } from "@playwright/test";
import { advanceDay, overflowsSideways, read, settler, signIn, watchErrors } from "./support";

/**
 * The market (RFC 0008) on a phone: a resident lists a jar from their pantry on /market, and a
 * neighbor buys it from their stall on the profile. Listing waits for a resident's fourth day, so
 * this moves the shared clock on and runs after shop.spec.ts, alone.
 */

test("list a jar in the market, and a neighbor buys it from the stall", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const mara = await settler(page.request, "Mara");
  const nils = await settler(page.request, "Nils");
  for (let i = 0; i < 3; i++) await advanceDay(page.request);

  await signIn(page, mara);
  await page.goto("/market");
  await expect(page.getByRole("heading", { level: 1, name: "The market" })).toBeVisible();
  await page.getByLabel("What to sell").selectOption("jar");
  await page.getByLabel("How many?").fill("1");
  await page.getByLabel("Price for all of it").fill("4");
  const list = page.getByRole("button", { name: "List for 1 coin" });
  expect((await list.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await list.click();
  await expect(page.locator("#site-toast")).toContainText("It's in the market");
  const row = page.locator(".market-listing").filter({ hasText: "Mara" });
  await expect(row).toContainText("Jar");
  await expect(row.getByRole("button", { name: /Take back/ })).toBeVisible();
  expect(await overflowsSideways(page)).toBe(false);
  await page.screenshot({ path: "test-results/market-listed.png", fullPage: true });

  await signIn(page, nils);
  await page.goto(`/r/${mara.id}`);
  const stall = page.locator(".stall-card");
  await expect(stall).toContainText("Mara's stall");
  const buy = stall.getByRole("button", { name: /Buy for 4 coins/ });
  await buy.click();
  // Paying is a second tap.
  await expect(buy).toHaveText("Tap again to pay 4 coins");
  await buy.click();
  await expect(page.locator("#site-toast")).toContainText("You bought jar");
  await expect(stall).toHaveCount(0);
  // The buy is a line in Nils's purse (buying at home may also collect today's allowance).
  const ledger = (await read(page.request, nils.token, "/v1/purse")).purse.ledger;
  expect(ledger).toContainEqual(expect.objectContaining({ amount: -4, reason: "market_buy" }));
  const things = (await read(page.request, nils.token, "/v1/inventory")).inventory;
  expect(things.stacks.find((s: { kind: string }) => s.kind === "jar")?.count).toBeGreaterThan(0);
  expect(await overflowsSideways(page)).toBe(false);
  expect(errors).toEqual([]);
});
