import { expect, type Page, test } from "@playwright/test";
import { act, advanceDay, freePlots, join, read, settleFree, signIn, watchErrors } from "./support";

/**
 * Praise (issue #36), plot names (decision 0121), and admiring a plot (RFC 0020) at 390x844: a
 * resident praises a neighbor from their profile, the count goes up, the button says it's done for
 * today, and the neighbor gets a notification. She names her own plot from the card in the world
 * and sees the name on the card and over the plot on the map. Then she visits the neighbor's named
 * plot from /visit, lands at its door in the world, and admires it from the card there. Praise and
 * admiring start on a resident's second UTC day, so this moves its server's clock a day on.
 */

/**
 * How many rows of light paper the map has along the top of the plot you stand on, at your hearth,
 * in CSS pixels: where its name's label goes. At 390x844 the visit card ends above the plot's edge,
 * so the label sits right there. Labels are drawn over the night, so this holds at any hour.
 */
function labelRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById("world") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const dpr = canvas.width / window.innerWidth;
    const scale = Math.max(16, Math.floor(Math.min(window.innerWidth, window.innerHeight) / 13));
    // The starter home's hearth is 3 tiles in from the plot's west and north edges, so the plot's
    // middle is half a tile east of you, and its top edge three and a half tiles up. The top row
    // is open ground; the hut's wall starts on the next.
    const cx = window.innerWidth / 2 + scale / 2;
    const top = window.innerHeight / 2 - scale * 3.5;
    const w = Math.round(40 * dpr);
    const h = Math.round(scale * 1.2 * dpr);
    const { data } = ctx.getImageData(Math.round(cx * dpr - w / 2), Math.round(top * dpr), w, h);
    let rows = 0;
    for (let row = 0; row < h; row++) {
      let light = 0;
      for (let col = 0; col < w; col++) {
        const i = (row * w + col) * 4;
        const [r, g, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
        if (r > 200 && g > 195 && b > 185) light++;
      }
      if (light > w * 0.7) rows++;
    }
    return rows / dpr;
  });
}

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

  await test.step("names her own plot from the card in the world, and sees it there and on the map", async () => {
    await settleFree(page.request, iris.token, await freePlots(page.request, 5, "top-right"));
    expect((await act(page.request, iris.token, { type: "build_starter_home" })).ok).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/world");
    await expect(page.locator("#hud")).toBeVisible();
    // On her own plot the card is hers: no Admire, a way to name it.
    await expect(page.locator("#visit-card-owner")).toHaveText("Your plot");
    await expect(page.locator("#visit-admire")).toBeHidden();
    expect(await labelRows(page)).toBeLessThan(2);

    await page.locator("#visit-name").click();
    const sheet = page.getByRole("dialog", { name: "Name your plot" });
    await expect(sheet).toBeVisible();
    await sheet.locator("#plot-name-input").fill("Iris's Lemon Grove");
    await sheet.locator("#plot-name-save").click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("#visit-card-owner")).toHaveText("Iris's Lemon Grove");
    await expect(page.locator("#visit-card-whose")).toHaveText("Your plot");
    await expect(page.locator("#visit-name")).toHaveText("Rename");
    // Over the plot on the map: a paper label along its top edge.
    await expect.poll(() => labelRows(page), { timeout: 5000 }).toBeGreaterThan(6);
    await page.screenshot({ path: "test-results/plot-name.png" });
  });

  await test.step("visits Tam's plot from /visit and admires it in the world", async () => {
    const [plot] = await freePlots(page.request, 1);
    if (!plot) throw new Error("No free plots left in the test world");
    const [px, py] = plot;
    expect((await act(page.request, tam.token, { type: "settle", px, py })).ok).toBe(true);
    expect((await act(page.request, tam.token, { type: "build_starter_home" })).ok).toBe(true);
    const named = { type: "name_plot", px, py, name: "Tam's Tea Garden" };
    expect((await act(page.request, tam.token, named)).ok).toBe(true);

    await page.goto("/visit");
    const card = page.locator(`.plot-card[data-plot="${px},${py}"]`);
    await expect(card).toContainText("Tam");
    await expect(card.locator(".plot-card-name")).toHaveText("Tam's Tea Garden");
    await expect(card.locator(".plot-thumb")).toBeVisible();
    await card.locator(".visit-button").click();
    await expect(page).toHaveURL(/\/world$/);

    // At the door: the card says what the plot is called, whose it is, and that Iris came by.
    const visit = page.locator("#visit-card");
    await expect(visit).toBeVisible();
    await expect(page.locator("#visit-card-owner")).toHaveText("Tam's Tea Garden");
    await expect(page.locator("#visit-card-whose")).toHaveText("Tam's plot");
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
