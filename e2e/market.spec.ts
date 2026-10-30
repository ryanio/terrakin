import { expect, test } from "@playwright/test";
import {
  act,
  advanceDay,
  join,
  openPlotMarket,
  overflowsSideways,
  read,
  settler,
  signIn,
  watchErrors,
} from "./support";

/**
 * The market (RFC 0008) on a phone: a resident lists a jar from their pantry on /market, and a
 * neighbor buys it from their stall on the profile; and a neighbor reports a listing, which a
 * maintainer takes down in the staff app, and its seller gets a notice from Terrakin. Listing
 * waits for a resident's fourth day, so this moves its server's clock on. Last, plots go on sale
 * (RFC 0039) on this server alone: Mara sells her plot from /market and Nils buys it.
 */

test("list a jar that a neighbor buys from the stall; a reported listing taken down by a maintainer; a plot sold", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mara = await settler(page.request, "Mara");
  const nils = await settler(page.request, "Nils");
  const juno = await settler(page.request, "Juno");
  const pell = await settler(page.request, "Pell");
  const marlo = await join(page.request, "Marlo");
  const grant = await page.request.post("/v1/test/maintainer", { data: { residentId: marlo.id } });
  expect(grant.ok()).toBe(true);
  for (let i = 0; i < 3; i++) await advanceDay(page.request);

  await test.step("list a jar in the market, and a neighbor buys it from the stall", async () => {
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
    await page.screenshot({ path: "test-results/market-listed.png" });

    await signIn(page, nils);
    await page.goto(`/r/${mara.id}`);
    const stall = page.locator(".stall-card");
    await expect(stall).toContainText("Mara's stall");
    const buy = stall.getByRole("button", { name: /Buy for 4 coins/ });
    await buy.click();
    // Paying is a second tap.
    await expect(buy).toHaveText("Tap again to pay 4 coins");
    await buy.click();
    await expect(page.locator("#site-toast")).toContainText("You bought a jar");
    await expect(stall).toHaveCount(0);
    // The buy is a line in Nils's purse (buying at home may also collect today's allowance).
    const ledger = (await read(page.request, nils.token, "/v1/purse")).purse.ledger;
    expect(ledger).toContainEqual(expect.objectContaining({ amount: -4, reason: "market_buy" }));
    const things = (await read(page.request, nils.token, "/v1/inventory")).inventory;
    expect(things.stacks.find((s: { kind: string }) => s.kind === "jar")?.count).toBeGreaterThan(0);
    expect(await overflowsSideways(page)).toBe(false);
  });

  await test.step("a neighbor reports a listing, and a maintainer takes it down", async () => {
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
    const id = listed.events.find((e: { type: string }) => e.type === "listed").listing
      .id as string;
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
    await expect(item).toContainText("Scam · from Pell");
    // The rule Juno is told starts on the one Pell's report named.
    await expect(item.getByLabel(/Rule broken/)).toHaveValue("scam");
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
    await expect(entry).toContainText("Rule told to them: Scam");

    // Out of the market, and the jar is back with Juno. The listing fee stays spent.
    const market = (await (await page.request.get("/v1/market")).json()).market;
    expect(market.listings.map((l: { id: string }) => l.id)).not.toContain(id);
    expect(await jars()).toBe(held + 1);
    const ledger = (await read(page.request, juno.token, "/v1/purse")).purse.ledger;
    expect(ledger).toContainEqual(expect.objectContaining({ amount: -1, reason: "listing_fee" }));

    // Juno hears it from Terrakin: what came down, the rule, and what's next. Never who acted or
    // reported it, or what staff wrote.
    await signIn(page, juno);
    await page.goto("/notifications");
    const notice = page.locator('.notif[data-type="takedown"]').first();
    await expect(notice).toContainText("Terrakin");
    await expect(notice).toContainText(
      "Your listing of 1 jar was taken down: it broke the rule on scams.",
    );
    await expect(notice).toContainText("The lot is back in your things.");
    await expect(notice).not.toContainText("Marlo");
    await expect(notice).not.toContainText("Pell");
    await expect(notice).not.toContainText("Selling empty jars");
    const appeal = notice.getByRole("link", { name: "How to appeal" });
    await expect(appeal).toHaveAttribute("href", "/contact");
    expect((await appeal.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await overflowsSideways(page)).toBe(false);
  });

  await test.step("plots go on sale: Mara lists hers, Nils buys it, and Mara hears it sold", async () => {
    // Fourteen days after her claim a plot can be sold.
    await openPlotMarket(page.request);
    await advanceDay(page.request, 11);
    const coins = await page.request.post("/v1/test/grant", {
      data: { residentId: nils.id, coins: 400 },
    });
    expect(coins.ok()).toBe(true);

    await signIn(page, mara);
    await page.goto("/market#plots");
    await expect(page.getByRole("heading", { name: "Plots for sale", exact: true })).toBeVisible();
    const yours = page.locator(".plot-own");
    await yours.getByRole("button", { name: /^Sell/ }).click();
    // Her hearth is on it, so it's her home.
    await expect(yours).toContainText("Your home");
    const sell = page.locator("dialog.sheet").filter({ hasText: "Sell your home" });
    await sell.getByLabel("Price for the plot").fill("300");
    await sell.getByRole("button", { name: "Check the sale" }).click();
    await expect(sell).toContainText("285 coins");
    const list = sell.locator("#plot-list");
    await expect(list).toHaveText("List for 25 coins");
    await list.click();
    await expect(list).toHaveText("Tap again to pay 25 coins");
    await list.click();
    await expect(page.locator("#site-toast")).toContainText("Your plot is for sale.");
    await expect(yours).toContainText("For sale at 300 coins");
    // In Plots for sale her own reads Yours, with nothing to tap: Take back is under Your plots.
    const hers = page.locator(".plot-sale").filter({ hasText: "Mara" });
    await expect(hers).toContainText("Yours");
    await expect(hers.getByRole("button")).toHaveCount(0);
    expect(await overflowsSideways(page)).toBe(false);

    await signIn(page, nils);
    await page.goto("/market");
    const row = page.locator(".plot-sale").filter({ hasText: "Mara" });
    await row.getByRole("button", { name: /Buy for 300 coins/ }).click();
    const buy = page.locator("dialog.sheet").filter({ hasText: "It's sold as it stands" });
    await expect(buy).toContainText("Your coins after");
    const pay = buy.locator("#plot-buy");
    await expect(pay).toHaveText("Buy for 300 coins");
    await pay.click();
    await expect(pay).toHaveText("Tap again to pay 300 coins");
    await pay.click();
    await expect(page.locator("#site-toast")).toContainText("The plot is yours.");
    await expect(page.locator("#site-toast").getByRole("link", { name: "Go there" })).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(await overflowsSideways(page)).toBe(false);

    await signIn(page, mara);
    await page.goto("/notifications");
    await expect(page.locator('.notif[data-type="plot_sold"]').first()).toContainText(
      "sold for 300 coins",
    );
  });
  expect(errors).toEqual([]);
});
