import { expect, test } from "@playwright/test";
import { join, signIn, watchErrors } from "./support";

/**
 * A new person's first steps on a phone: the world's chip leaves the first to Claim plot, the
 * home wall's Getting started card lists them with a link each, a handle and a bio written on
 * their profile tick off there, and hiding the card keeps it away on this device.
 */
test("a newcomer's first steps tick off on the home wall as they're done", async ({ page }) => {
  const errors = watchErrors(page);
  const fern = await join(page.request, "Fern");
  await signIn(page, fern);
  const card = page.locator("#first-steps");
  const row = (id: string) => card.locator(`[data-step="${id}"]`);

  await test.step("the world's chip leaves the first step to Claim plot beside it", async () => {
    await page.goto("/world");
    await expect(page.locator("#claim")).toBeVisible();
    // Its words land with the server's answer, so by then it has decided to stay away.
    const chip = page.locator("#world-next");
    await expect(chip).toHaveText("Claim a plot");
    await expect(chip).toBeHidden();
  });

  await test.step("the home wall lists every step left, with where it's done", async () => {
    await page.goto("/");
    await expect(card.getByRole("heading", { name: "Your first steps" })).toBeVisible();
    await expect(card).toContainText("0 of");
    await expect(row("plot").getByRole("link", { name: "Claim a plot" })).toHaveAttribute(
      "href",
      "/world",
    );
    await expect(row("handle")).not.toHaveClass(/\bdone\b/);
    await row("handle").getByRole("link", { name: "Pick a handle" }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${fern.id}$`));
  });

  await test.step("a handle and a bio from the profile", async () => {
    await page.getByRole("button", { name: "Pick a handle" }).click();
    await page.locator("#handle-input").fill(`fern_${Date.now().toString(36).slice(-6)}`);
    await page.locator("#handle-form").getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".profile-handle")).toBeVisible();
    await page.getByRole("button", { name: "Write a bio" }).click();
    await page.locator("#bio-input").fill("Ferns, moss, and slow mornings.");
    await page.locator("#bio-save").click();
    await expect(page.locator(".profile-bio")).toHaveText("Ferns, moss, and slow mornings.");
  });

  await test.step("both tick off, and hiding the card keeps it away", async () => {
    await page.goto("/");
    await expect(row("handle")).toHaveClass(/\bdone\b/);
    await expect(row("bio")).toHaveClass(/\bdone\b/);
    await expect(row("plot")).not.toHaveClass(/\bdone\b/);
    await expect(card).toContainText("2 of");
    await card.getByRole("button", { name: "Hide getting started" }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.locator("form.composer")).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  expect(errors).toEqual([]);
});
