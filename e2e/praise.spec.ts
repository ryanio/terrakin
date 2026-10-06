import { expect, test } from "@playwright/test";
import { act, advanceDay, freePlots, join, read, signIn, watchErrors } from "./support";

/**
 * Praise (issue #36) and admiring a plot (RFC 0020) at 390x844: a resident praises a neighbor from
 * their profile, the count goes up, the button says it's done for today, and the neighbor gets a
 * notification. Then she visits the neighbor's plot from /visit, lands at its door in the world,
 * and admires it from the card there. Both start on a resident's second UTC day, so this moves its
 * server's clock a day on.
 */

test("a resident praises a neighbor, then visits their plot and admires it", async ({ page }) => {
  const errors = watchErrors(page);
  const iris = await join(page.request, "Iris");
  const tam = await join(page.request, "Tam");

  // Praise starts on a resident's second day.
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

  await test.step("visits Tam's plot from /visit and admires it in the world", async () => {
    const [plot] = await freePlots(page.request, 1);
    if (!plot) throw new Error("No free plots left in the test world");
    const [px, py] = plot;
    expect((await act(page.request, tam.token, { type: "settle", px, py })).ok).toBe(true);
    expect((await act(page.request, tam.token, { type: "build_starter_home" })).ok).toBe(true);

    await page.goto("/visit");
    const card = page.locator(`.plot-card[data-plot="${px},${py}"]`);
    await expect(card).toContainText("Tam");
    await expect(card.locator(".plot-thumb")).toBeVisible();
    await card.locator(".visit-button").click();
    await expect(page).toHaveURL(/\/world$/);

    // At the door: the card says whose plot it is and that Iris came by.
    const visit = page.locator("#visit-card");
    await expect(visit).toBeVisible();
    await expect(page.locator("#visit-card-owner")).toHaveText("Tam's plot");
    await expect(page.locator("#visit-card-week")).toHaveText("1 visitor this week");
    await page.locator("#visit-admire").click();
    await expect(page.locator("#visit-admire")).toHaveText("Admired today");
    await expect(page.locator("#visit-admire")).toBeDisabled();
    await expect(page.locator("#visit-card-week")).toHaveText(
      "Admired by 1 neighbor, 1 visitor this week",
    );
    await page.screenshot({ path: "test-results/visit-card.png" });

    // Tam hears about it, with the plot.
    const notes = await read(page.request, tam.token, "/v1/notifications");
    expect(notes.notifications[0]).toMatchObject({
      type: "plot_admired",
      actor: { id: iris.id },
      plot: { px, py },
    });
  });
  expect(errors).toEqual([]);
});
