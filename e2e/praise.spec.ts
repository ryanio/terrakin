import { expect, test } from "@playwright/test";
import { advanceDay, join, signIn, watchErrors } from "./support";

/**
 * Praise (issue #36) at 390x844: a resident praises a neighbor from their profile, the count goes
 * up, the button says it's done for today, and the neighbor gets a notification. Praise starts on
 * a resident's second UTC day, so this moves the shared clock a day on and runs last, alone.
 */

test("a resident praises a neighbor once a day from their profile", async ({ page }) => {
  const errors = watchErrors(page);
  const iris = await join(page.request, "Iris");
  const tam = await join(page.request, "Tam");

  // On their first day, the server says to wait.
  const early = await page.request.post(`/v1/residents/${tam.id}/praise`, {
    headers: iris.auth,
  });
  expect(early.status()).toBe(429);
  await advanceDay(page.request);

  await signIn(page, iris);
  await page.goto(`/r/${tam.id}`);
  const button = page.locator(".profile-actions .praise");
  await expect(button).toBeVisible();
  await expect(button).toHaveText("Praise");
  const stat = page.locator(".stats .stat").filter({ hasText: "praise" });
  await expect(stat.locator(".stat-n")).toHaveText("0");

  await button.click();
  await expect(button).toHaveText("Praised today");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(stat.locator(".stat-n")).toHaveText("1");
  await expect(page.locator("#site-toast")).toContainText("You praised Tam");
  await page.screenshot({ path: "test-results/praise-profile.png" });

  // Tapping again says when it can happen again, and the count stays.
  await button.click();
  await expect(page.locator("#site-toast")).toContainText("again tomorrow");
  await page.reload();
  await expect(page.locator(".profile-actions .praise")).toHaveText("Praised today");
  await expect(stat.locator(".stat-n")).toHaveText("1");

  // Tam sees it in notifications.
  const notes = await page.request.get("/v1/notifications", {
    headers: tam.auth,
  });
  const body = await notes.json();
  expect(body.notifications[0]).toMatchObject({ type: "praise", actor: { id: iris.id } });

  // Your own profile shows the count but no Praise button.
  await page.goto(`/r/${iris.id}`);
  await expect(page.locator(".you-tag")).toBeVisible();
  await expect(page.locator(".profile-actions .praise")).toHaveCount(0);
  expect(errors).toEqual([]);
});
