import { expect, test } from "@playwright/test";
import { act, join, overflowsSideways, read, settler, signIn, watchErrors } from "./support";

/**
 * Party games (RFC 0011) on a phone: a person with a home opens a live Hearth race on /games, an
 * agent sits over the API, she starts it and decides with the big buttons in the decide sheet,
 * the agent's choice closes the round at once, and every choice comes out together on her page.
 */

test("open a table, decide on a phone, and see the round close", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const wren = await settler(page.request, "Wren");
  const dot = await join(page.request, "Dot", { kind: "agent" });

  await test.step("open a live Hearth race from /games", async () => {
    await signIn(page, wren);
    await page.goto("/games");
    await expect(page.getByRole("heading", { level: 1, name: "Games" })).toBeVisible();
    await page.getByRole("button", { name: "Open a table" }).click();
    const sheet = page.getByRole("dialog", { name: "Open a table" });
    await sheet.getByRole("button", { name: "Hearth race" }).click();
    await sheet.getByRole("button", { name: "Live" }).click();
    await sheet.getByRole("button", { name: "Open the table" }).click();
    await expect(page).toHaveURL(/\/games\/g_\d+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hearth race" })).toBeVisible();
    expect(await overflowsSideways(page)).toBe(false);
  });
  const table = new URL(page.url()).pathname.split("/").at(-1) ?? "";

  await test.step("an agent sits, and she starts the game", async () => {
    expect((await act(page.request, dot.token, { type: "sit", table })).ok).toBe(true);
    const start = page.getByRole("button", { name: "Start the game" });
    await expect(start).toBeVisible();
    await start.click();
    await expect(page.locator("#site-toast")).toContainText("Round 1 is open");
  });

  await test.step("she decides with a big button, sealed until the round closes", async () => {
    await page.getByRole("button", { name: "Your move" }).click();
    const sheet = page.getByRole("dialog", { name: "Round 1: your move" });
    const three = sheet.getByRole("button", { name: "3 steps" });
    expect((await three.boundingBox())?.height).toBeGreaterThanOrEqual(64);
    await page.screenshot({ path: "test-results/games-decide.png" });
    await three.click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("#game-line")).toContainText("You picked 3 steps");
    // The agent sees only that she has chosen.
    const seen = await read(page.request, dot.token, `/v1/games/${table}`);
    expect(seen.table.you.sealed).toBeNull();
    expect(seen.table.seats[0]).toMatchObject({ decided: true });
  });

  await test.step("the agent's choice closes the round, and both come out together", async () => {
    expect(
      (await act(page.request, dot.token, { type: "decide", table, round: 1, move: 2 })).ok,
    ).toBe(true);
    const reveal = page.locator(".game-reveal");
    await expect(reveal.getByRole("heading", { name: "Round 1: every choice" })).toBeVisible();
    await expect(reveal.locator(`[data-pick="${wren.id}"]`)).toContainText("picked 3, moved 3");
    await expect(reveal.locator(`[data-pick="${dot.id}"]`)).toContainText("picked 2, moved 2");
    await expect(page.locator(".game-round")).toContainText("Round 2");
    expect(await overflowsSideways(page)).toBe(false);
    await page.screenshot({ path: "test-results/games-reveal.png", fullPage: true });
  });
  expect(errors).toEqual([]);
});
