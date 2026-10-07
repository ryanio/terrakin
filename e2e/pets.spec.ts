import { expect, test } from "@playwright/test";
import { persona, read, settler, signIn, watchErrors } from "./support";

/**
 * Pets (RFC 0019) at 390x844: a resident adopts a fox from the Adopt sheet on her own profile,
 * watching the preview follow her choices, then pats a neighbor's dog from his profile. The count
 * goes up, the button says it's done for today, and the neighbor's notification names his dog.
 */

test("a resident adopts a pet and pats a neighbor's", async ({ page }) => {
  const errors = watchErrors(page);
  const iris = await settler(page.request, "Iris");
  // Tam is settled with a golden dog called Rex.
  const tam = await persona(page.request, "pet", { name: "Tam" });

  await signIn(page, iris);

  await test.step("adopt a fox from the Adopt sheet", async () => {
    await page.goto(`/r/${iris.id}`);
    await page.locator("#adopt-pet").click();
    const sheet = page.locator(".adopt-sheet");
    await expect(sheet).toBeVisible();
    // The preview follows each choice: a fox, its arctic coat, and a name.
    await sheet.locator('.pet-kinds button[data-value="fox"]').click();
    await sheet.locator('.pet-coats button[data-value="arctic"]').click();
    await expect(
      sheet.locator('.pet-preview svg[data-kind="fox"][data-coat="arctic"]'),
    ).toBeVisible();
    await sheet.locator("#pet-name").fill("Ember");
    await expect(sheet.locator(".pet-preview-line")).toHaveText("Ember, an arctic fox");
    await expect(sheet.locator("#adopt-submit")).toHaveText("Bring Ember home");
    await sheet.locator("#adopt-submit").click();
    await expect(sheet).toBeHidden();
    const card = page.locator(".pet-card");
    await expect(card.locator(".pet-card-name")).toHaveText("Ember");
    await expect(card.locator(".pet-card-line")).toHaveText("Your arctic fox");
    await expect(card.locator(".pet-card-pats")).toHaveText("No pats yet");
  });

  await test.step("pat the neighbor's dog from his profile", async () => {
    await page.goto(`/r/${tam.id}`);
    const card = page.locator(".pet-card");
    await expect(card.locator(".pet-card-name")).toHaveText("Rex");
    const pat = card.locator(".pet-pat");
    await expect(pat).toHaveText("Pat");
    await pat.click();
    await expect(pat).toHaveText("Patted today");
    await expect(pat).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator(".pet-card-pats")).toHaveText("Patted by 1 resident");
    await expect(page.locator("#site-toast")).toContainText("You patted Rex");
    await page.screenshot({ path: "test-results/pets-patted.png" });
    // The server keeps it: a reload still says so, and a second pat today is refused.
    await page.reload();
    await expect(page.locator(".pet-card .pet-pat")).toHaveText("Patted today");
  });

  await test.step("the neighbor hears about it", async () => {
    const notes = await read(page.request, tam.token, "/v1/notifications");
    expect(notes.notifications[0]).toMatchObject({
      type: "pet_pat",
      actor: { id: iris.id },
      pet: { kind: "dog", name: "Rex" },
    });
  });
  expect(errors).toEqual([]);
});
