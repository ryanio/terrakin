import { expect, test } from "@playwright/test";
import { act, freePlots, join, read, settleFree, signIn, watchErrors } from "./support";

/**
 * A new person's first steps on a phone: the world's chip leaves the first to Claim plot, the
 * home wall's Getting started card lists the first three with a link each, a handle and a bio
 * written on their profile tick off there and count toward the round, hiding the card keeps
 * it away on this device, and once she has a home, away from her hearth, the chip plants a first
 * seed in one tap (decision 0269).
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

  await test.step("the home wall lists the first three steps, with where each is done", async () => {
    await page.goto("/");
    await expect(card.getByRole("heading", { name: "Your first steps" })).toBeVisible();
    await expect(card).toContainText("0 of 3 done");
    await expect(card.locator("ol.first-steps > li")).toHaveCount(3);
    await expect(row("plot").getByRole("link", { name: "Claim a plot" })).toHaveAttribute(
      "href",
      "/world",
    );
    await expect(row("handle")).toHaveCount(0);
    await page.goto(`/r/${fern.id}`);
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
    await expect(card).toContainText("2 of 3 done");
    await expect(card.locator("ol.first-steps > li")).toHaveCount(1);
    await card.getByRole("button", { name: "Hide getting started" }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.locator("form.composer")).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  await test.step("with a home, the chip plants a first seed in one tap, from away from the hearth", async () => {
    await settleFree(page.request, fern.token, await freePlots(page.request, 5, "top-right"));
    expect((await act(page.request, fern.token, { type: "build_starter_home" })).ok).toBe(true);
    // A step south of the hearth, out the hut's open middle, so the chip has to go home first.
    type Spot = { id: string; x: number; y: number; hearth?: { x: number; y: number } };
    const me = async () =>
      ((await read(page.request, fern.token, "/v1/world")).residents as Spot[]).find(
        (r) => r.id === fern.id,
      );
    const hearth = (await me())?.hearth;
    expect(hearth).toBeDefined();
    expect((await act(page.request, fern.token, { type: "move", dir: "s" })).ok).toBe(true);
    await page.goto("/world");
    // The chip keeps its place whatever lies within reach: Gather all took its slot before
    // decision 0312, and about half of new hearths have a branch or a stone beside them, so this
    // was the step nobody could see. Waiting for its words is waiting for the server's answer.
    const chip = page.locator("#world-next");
    await expect(chip).toHaveText("Plant a seed");
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByText(/You planted an? .+ seed by your hearth\./)).toBeVisible();
    const steps = (await read(page.request, fern.token, "/v1/first-visit")).steps as {
      id: string;
      done: boolean;
    }[];
    expect(steps.find((s) => s.id === "garden")?.done).toBe(true);
    const after = await me();
    expect({ x: after?.x, y: after?.y }).toEqual(hearth);
  });

  expect(errors).toEqual([]);
});
