import { expect, test } from "@playwright/test";
import { act, settler, signIn, sweep, watchErrors } from "./support";

/**
 * Routines (RFC 0009) on a phone: a resident turns them on from the sheet on their own profile and
 * goes away, the server's minute sweep walks them home and out on a stroll, and the home wall's
 * "While you were away" card and the sheet's list say so. They're set for hour 0 on the UTC clock,
 * so they're due whatever hour the suite runs at.
 */
test("routines turn on from a phone, and the home wall says what they did", async ({ page }) => {
  const errors = watchErrors(page);
  const wren = await settler(page.request, "Robin");
  // A step off the hearth, so walking home has somewhere to go.
  expect((await act(page.request, wren.token, { type: "move", dir: "s" })).ok).toBe(true);

  await test.step("turn routines on from your own profile", async () => {
    await signIn(page, wren);
    await page.goto(`/r/${wren.id}`);
    await page.getByRole("button", { name: "More for this profile" }).click();
    await page.locator(".routines-open").click();
    const sheet = page.locator(".routines-sheet");
    await expect(sheet.getByRole("heading", { name: "While you're away" })).toBeVisible();
    // Off at first, with their hours waiting for them.
    await expect(sheet.locator("#routine-walk_home-hour")).toBeDisabled();
    await sheet.locator("#routine-walk_home").check();
    await sheet.locator("#routine-walk_home-hour").selectOption("0");
    await sheet.locator("#routine-stroll").check();
    await sheet.locator("#routine-stroll-hour").selectOption("0");
    await sheet.locator("#routine-greet").check();
    await sheet.locator("#routines-save").click();
    await expect(page.locator("#site-toast")).toContainText("They'll run while you're away");
    const set = await page.request.get("/v1/routines", { headers: wren.auth });
    expect((await set.json()).routines).toEqual([
      { kind: "walk_home", hour: 0 },
      { kind: "stroll", hour: 0 },
      { kind: "greet", max: 3 },
    ]);
  });

  await test.step("go away, and the next sweep takes their steps", async () => {
    expect((await page.request.delete("/v1/session", { headers: wren.auth })).ok()).toBe(true);
    await sweep(page.request);
  });

  await test.step("read what they did on the home wall and in the sheet", async () => {
    await page.goto("/");
    const card = page.locator("#away-card");
    await expect(card.getByRole("heading", { name: "While you were away" })).toBeVisible();
    await expect(card).toContainText("Walked home");
    await expect(card).toContainText("Strolled around your plot");
    await card.locator(".away-open").click();
    const sheet = page.locator(".routines-sheet");
    await expect(sheet.locator("#routine-walk_home")).toBeChecked();
    await expect(sheet.locator(".away-list")).toContainText("Walked home");
  });

  expect(errors).toEqual([]);
});
