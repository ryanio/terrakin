import { expect, type Page, test } from "@playwright/test";
import { persona, read, signIn, tapTile, watchErrors } from "./support";

/**
 * Links into the world at 390x844 (decision 0162): `/world?at=<resident>` opens looking at that
 * resident with a card naming them, Go there lands at their plot's door, and Back to me gives the
 * camera back. Someone with no character opens `/world?at=<px>,<py>` and looks at the plot before
 * joining, then goes there once in. A place that isn't on the map says so. The 3D view's link is
 * in `world-3d.spec.ts`.
 */

const GONE = "That place isn't on the map anymore.";

/** Which plot a resident stands on, from the public snapshot. */
async function plotOf(page: Page, token: string, id: string): Promise<[number, number]> {
  const world = await read(page.request, token, "/v1/world");
  const r = world.residents.find((p: { id: string }) => p.id === id);
  const size = world.config.plotSize;
  return [Math.floor(r.x / size), Math.floor(r.y / size)];
}

test("a link to a neighbor opens the world looking at her, and Go there lands at her door", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const ivy = await persona(page.request, "settled", { name: "Ivy" });
  const ben = await persona(page.request, "visitor", { name: "Ben" });
  await signIn(page, ben);
  const card = page.locator("#look-card");

  await test.step("a link to someone who isn't on the map says so and opens as usual", async () => {
    await page.goto("/world?at=r_0000000000000000");
    await expect(page.locator("#toast")).toHaveText(GONE);
    await expect(page).toHaveURL(/\/world$/);
    await expect(card).toBeHidden();
  });

  await test.step("her link puts her in the middle of the view, with a card naming her", async () => {
    await page.goto(`/world?at=${ivy.id}`);
    // The address bar keeps no place, so a reload opens the world as usual.
    await expect(page).toHaveURL(/\/world$/);
    await expect(card).toBeVisible();
    await expect(page.locator("#look-card-title")).toHaveText(ivy.name);
    await expect(page.locator("#look-card-title")).toHaveAttribute("href", `/r/${ivy.id}`);
    await expect(page.locator("#look-card-line")).toHaveText(`At ${ivy.name}'s plot`);
    // A tap on the middle of the screen is a tap on her: it names her.
    await tapTile(page, 0, 0);
    await expect(page.locator("#toast")).toHaveText(ivy.name);
    await page.screenshot({ path: "test-results/world-link.png" });
    // Opening the link moved nobody.
    expect(await plotOf(page, ben.token, ben.id)).not.toEqual(ivy.plot);
  });

  await test.step("Back to me puts the card away", async () => {
    await page.getByRole("button", { name: "Back to me" }).click();
    await expect(card).toBeHidden();
  });

  await test.step("Go there visits her plot and lands at its door", async () => {
    await page.goto(`/world?at=${ivy.id}`);
    await page.getByRole("button", { name: "Go there", exact: true }).click();
    await expect(card).toBeHidden();
    await expect.poll(() => plotOf(page, ben.token, ben.id)).toEqual(ivy.plot);
    // Standing on her plot, its own card is back.
    await expect(page.locator("#visit-card")).toBeVisible();
  });
  expect(errors).toEqual([]);
});

test("someone with no character looks at a plot from a link, steps inside, and goes there", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const wren = await persona(page.request, "settled", { name: "Wynn" });
  const [px, py] = wren.plot ?? [0, 0];
  const card = page.locator("#look-card");

  await test.step("a plot off the map says so over the landing", async () => {
    await page.goto("/world?at=999,999");
    await expect(page.locator("#world-join")).toBeVisible();
    await expect(page.locator("#toast")).toHaveText(GONE);
    await expect(card).toBeHidden();
  });

  await test.step("the world opens on her plot, read only, with a way in", async () => {
    await page.goto(`/world?at=${px},${py}`);
    await expect(card).toBeVisible();
    await expect(page.locator("#look-card-title")).toHaveText(`${wren.name}'s plot`);
    await expect(page.locator("#world-join")).toBeHidden();
    // No controls for someone who isn't in yet: the way back to the feed, the card, and notices.
    await expect(page.locator(".dpad")).toBeHidden();
    await expect(page.locator("#build")).toBeHidden();
    await expect(page.locator("#hud-feed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Go there", exact: true })).toBeHidden();
    await expect(page.locator("#world-loader")).toBeHidden();
    await page.screenshot({ path: "test-results/world-link-visitor.png" });
  });

  await test.step("one tap reaches the join form, and once in, Go there takes her there", async () => {
    await page.getByRole("button", { name: "Step inside to go there" }).click();
    await expect(page.locator("#join-name")).toBeVisible();
    await page.fill("#join-name", "Linnea");
    await page.click("#world-join button[type=submit]");
    await expect(page.locator(".dpad")).toBeVisible();
    await expect(card).toBeVisible();
    await expect(page.locator("#look-card-title")).toHaveText(`${wren.name}'s plot`);
    const token = await page.evaluate(() => localStorage.getItem("terrakin.token"));
    const id = await page.evaluate(() => localStorage.getItem("terrakin.resident"));
    if (!token || !id) throw new Error("not signed in");
    await page.getByRole("button", { name: "Go there", exact: true }).click();
    await expect.poll(() => plotOf(page, token, id)).toEqual([px, py]);
  });
  expect(errors).toEqual([]);
});
