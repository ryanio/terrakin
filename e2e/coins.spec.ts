import { expect, test } from "@playwright/test";
import { act, advanceDay, freePlots, join, signIn, watchErrors } from "./support";

/**
 * Coins (RFC 0008) on a phone: a newcomer settles and sees the welcome gift in the purse in the
 * top bar, opens the purse, comes home for the daily allowance the next day, and gives a friend
 * coins from their profile. The friend gets a live notice. Runs after town.spec.ts, since it moves
 * the shared clock a day on.
 */

test("a newcomer earns coins, comes home for more, and gives a friend some", async ({
  page,
  browser,
}) => {
  const errors = watchErrors(page);
  const juno = await join(page.request, "Juno");
  const pip = await join(page.request, "Pip");
  const [a, b] = await freePlots(page.request, 2, "bottom-left");
  if (!a || !b) throw new Error("No free plots left in the test world");
  const settle = (px: number, py: number) => ({ type: "settle", px, py });
  expect((await act(page.request, juno.token, settle(...a))).ok).toBe(true);
  expect((await act(page.request, juno.token, { type: "build_starter_home" })).ok).toBe(true);
  expect((await act(page.request, pip.token, settle(...b))).ok).toBe(true);

  await signIn(page, juno);
  await page.goto("/");
  const purse = page.locator("#site-purse");
  await expect(purse).toBeVisible();
  // The welcome gift, plus today's allowance if building the home put Juno on the hearth.
  const first = Number((await purse.locator(".purse-amount").textContent()) ?? "0");
  expect(first).toBeGreaterThanOrEqual(50);
  await expect(purse).not.toContainText(/token/i);

  // The purse page: balance, how coins come in, and the welcome line.
  await purse.click();
  await expect(page).toHaveURL(/\/purse$/);
  await expect(page.locator(".purse-balance-amount")).toHaveText(String(first));
  await expect(page.locator(".purse-lines")).toContainText("Welcome gift for your first plot");
  await expect(page.locator(".purse-how")).toContainText("Come home to your hearth");

  // The next day: the purse shows today's coins are waiting, and coming home collects them.
  await advanceDay(page.request);
  await page.reload();
  const home = page.locator(".purse-home");
  await expect(home).toBeVisible();
  await home.click();
  await expect(page.locator(".purse-lines li").first()).toContainText("Coming home");
  await expect(page.locator(".purse-balance-amount")).toHaveText(String(first + 10));

  // Pip watches the home wall in another phone while Juno gives coins from Pip's profile.
  const pipPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(pipPage, pip);
  await pipPage.goto("/");
  await expect(pipPage.locator("#site-purse")).toBeVisible();

  await page.goto(`/r/${pip.id}`);
  await page.locator(".coin-open").click();
  await page.locator("#coin-amount").fill("12");
  await page.locator("#coin-note").fill("for the seeds");
  await page.locator(".coin-form button[type=submit]").click();
  await expect(page.locator("#site-toast")).toContainText("You gave 12 coins to Pip");
  await expect(page.locator("#site-purse .purse-amount")).toHaveText(String(first + 10 - 12));

  // Pip's purse ticks up and a notice says who gave it, with the note as plain text.
  await pipPage.bringToFront();
  await pipPage.goto("/notifications");
  const notice = pipPage.locator(".live-toast.tone-coins");
  await expect(notice).toContainText("Juno");
  await expect(notice).toContainText("gave you 12 coins");
  await expect(notice).toContainText("for the seeds");
  await expect(pipPage.locator("#site-purse .purse-amount")).toHaveText(/^\d+$/);
  await pipPage.screenshot({ path: "test-results/coins-notice.png" });

  // The town's public gift list (behind Happening now) says who and whom, never how much.
  const town = await (await page.request.get("/v1/town")).json();
  expect(town.treasury.gifts[0]).toMatchObject({ from: { id: juno.id }, to: { id: pip.id } });
  expect(Object.keys(town.treasury.gifts[0]).sort()).toEqual(["day", "from", "seq", "to"]);

  await pipPage.close();
  expect(errors).toEqual([]);
});
