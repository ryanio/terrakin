import { expect, test } from "@playwright/test";
import {
  act,
  advanceDay,
  join,
  overflowsSideways,
  read,
  settler,
  signIn,
  watchErrors,
} from "./support";

/**
 * The market (RFC 0008) on a phone: a resident lists a jar from their pantry on /market, and a
 * neighbor buys it from their stall on the profile; and a neighbor reports a listing, which a
 * maintainer takes down in the staff app. Listing waits for a resident's fourth day, so this moves
 * the shared clock on and runs after shop.spec.ts, alone.
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

test("a neighbor reports a listing, and a maintainer takes it down", async ({ page }) => {
  const errors = watchErrors(page, { dialogs: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const juno = await settler(page.request, "Juno");
  const pell = await settler(page.request, "Pell");
  const marlo = await join(page.request, "Marlo");
  const grant = await page.request.post("/v1/test/maintainer", { data: { residentId: marlo.id } });
  expect(grant.ok()).toBe(true);
  for (let i = 0; i < 3; i++) await advanceDay(page.request);
  const jars = async () =>
    (await read(page.request, juno.token, "/v1/inventory")).inventory.stacks.find(
      (s: { kind: string }) => s.kind === "jar",
    )?.count ?? 0;
  const listed = await act(page.request, juno.token, {
    type: "list_item",
    item: "jar",
    price: 7,
  });
  expect(listed.ok).toBe(true);
  const id = listed.events.find((e: { type: string }) => e.type === "listed").listing.id as string;
  // Counted after listing, since listing at home may also bring today's pantry.
  const held = await jars();

  // Pell reports it from the listing's More menu on /market.
  await signIn(page, pell);
  await page.goto("/market");
  const row = page.locator(`.market-listing[data-listing="${id}"]`);
  await expect(row).toContainText("Juno");
  const more = row.getByRole("button", { name: "More" });
  expect((await more.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await more.click();
  await page.getByRole("button", { name: "Report listing" }).click();
  const sheet = page.locator("dialog.report-sheet");
  await expect(sheet).toContainText("What's wrong with this listing?");
  await sheet.getByText("Scam", { exact: true }).click();
  await sheet.getByRole("button", { name: "Send report" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#site-toast")).toContainText("A maintainer will take a look");
  expect(await overflowsSideways(page)).toBe(false);
  // Juno's own listing has no More menu: nobody reports their own.
  await signIn(page, juno);
  await page.goto("/market");
  await expect(row.getByRole("button", { name: /Take back/ })).toBeVisible();
  await expect(row.getByRole("button", { name: "More" })).toHaveCount(0);

  // Marlo takes it down in the staff app, with a reason and a second tap.
  await page.goto("/admin");
  expect(new URL(page.url()).hostname).toBe("admin.localhost");
  await page.getByLabel("Token", { exact: true }).fill(marlo.token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const item = page.locator(`article.item[data-id="${id}"]`);
  await expect(item).toContainText("Listing · 1 report");
  await expect(item).toContainText("Jar for 7 coins");
  await expect(item).toContainText("Scam, from Pell");
  await item.getByLabel("Reason").fill("Selling empty jars as jam");
  const takeDown = item.getByRole("button", { name: "Take down listing" });
  expect((await takeDown.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await takeDown.click();
  await item.getByRole("button", { name: "Tap again to take it down" }).click();
  await expect(page.locator("#site-toast")).toContainText("in the log");
  await expect(item).toHaveCount(0);
  await page.getByRole("link", { name: "Log" }).click();
  const entry = page.locator(".log-entry").filter({ hasText: id }).first();
  await expect(entry).toContainText("Took down a listing");
  await expect(entry).toContainText("Selling empty jars as jam");

  // Out of the market, and the jar is back with Juno. The listing fee stays spent.
  const market = (await (await page.request.get("/v1/market")).json()).market;
  expect(market.listings.map((l: { id: string }) => l.id)).not.toContain(id);
  expect(await jars()).toBe(held + 1);
  const ledger = (await read(page.request, juno.token, "/v1/purse")).purse.ledger;
  expect(ledger).toContainEqual(expect.objectContaining({ amount: -1, reason: "listing_fee" }));
  expect(errors).toEqual([]);
});
