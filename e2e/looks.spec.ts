import { expect, test } from "@playwright/test";
import { freePlots, join, overflowsSideways, settleFree, signIn, watchErrors } from "./support";

/**
 * RFC 0005 looks: Capri loves lemons. She opens the look editor from her profile, picks the lemon
 * theme, citrus slices, and a straw hat, saves, and sees it on her profile and in the world. Then
 * someone at 390x844 picks a color on the card, waits on an upload, puts their hair in a ginger
 * bun, and styles single garments: a citrus dress in sun yellow and striped socks.
 */

test("pick lemon, citrus, and a straw hat, and see it on the profile and in the world", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const me = await join(page.request, "Capri", { color: "rose" });
  const residentId = me.id;
  await settleFree(page.request, me.token, await freePlots(page.request, 5));
  await signIn(page, me);

  await page.goto(`/r/${residentId}`);
  await page.getByRole("button", { name: "Dress up" }).click();
  const editor = page.getByRole("dialog", { name: "Your look" });
  await expect(editor).toBeVisible();
  await editor.locator('[data-theme="lemon"]').click();
  await editor.locator('[data-pattern="citrus"]').click();
  await editor.locator('[data-wear="straw_hat"]').click();
  await expect(editor.locator(".look-summary")).toHaveText("Lemon, citrus slices, straw hat");
  await expect(editor.locator('[data-theme="lemon"]')).toHaveAttribute("aria-pressed", "true");
  await editor.getByRole("button", { name: "Save my look" }).click();
  await expect(editor).toBeHidden();

  // The profile shows the look in words, and the avatar is now the figure.
  await expect(page.locator(".profile [data-look]")).toHaveText(
    "Lemon · Citrus slices · Straw hat",
  );
  await expect(page.locator(".profile .avatar.has-figure canvas")).toBeVisible();

  // The world has it too: the server's snapshot, and lemon yellow where Capri stands.
  const world = await (await page.request.get("/v1/world")).json();
  const capri = world.residents.find((r: { id: string }) => r.id === residentId);
  expect(capri).toMatchObject({ theme: "lemon", pattern: "citrus", wear: ["straw_hat"] });

  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          // The camera follows Capri, so her figure is at the middle of the screen.
          const canvas = document.getElementById("world") as HTMLCanvasElement;
          const ctx = canvas.getContext("2d");
          if (!ctx) return 0;
          const dpr = canvas.width / window.innerWidth;
          const cx = Math.round((window.innerWidth / 2) * dpr);
          const cy = Math.round((window.innerHeight / 2) * dpr);
          const size = Math.round(40 * dpr);
          const { data } = ctx.getImageData(cx - size / 2, cy - size / 2, size, size);
          let lemon = 0;
          for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
            // Yellow by hue, so it holds at night too: red and green well above blue, red on top.
            if (r >= g && r - b > 45 && g - b > 25) lemon++;
          }
          return lemon;
        }),
      { timeout: 5000 },
    )
    .toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("style a garment: a citrus dress in sun yellow and striped socks, keeping a color and waiting for an upload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  const who = await join(page.request, "Lemony");
  await signIn(page, who);

  await page.goto(`/r/${who.id}`);
  // A new color on the look card, not saved there, then on to the editor, which keeps it.
  await page.locator('.look [data-value="leaf"]').click();
  await page.getByRole("button", { name: "Dress up" }).click();
  const editor = page.getByRole("dialog", { name: "Your look" });
  await expect(editor).toBeVisible();

  await test.step("while an upload is on its way, Save waits for it", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/v1/media", async (route) => {
      await held;
      await route.abort();
    });
    await editor.locator('input[data-media="homeArt"]').setInputFiles({
      name: "home.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    const save = editor.locator(".look-save");
    await expect(save).toBeDisabled();
    await expect(save).toHaveText("Uploading…");
    release();
    await expect(save).toBeEnabled();
    await expect(save).toHaveText("Save my look");
    await page.unroute("**/v1/media");
  });

  // Every slot has a row, each with a None chip.
  for (const slot of ["hat", "top", "accessory", "bottom", "feet"]) {
    await expect(editor.locator(`[data-wear="none-${slot}"]`)).toBeVisible();
  }
  // Shop wear you don't own is a link to the shop, not something to put on.
  await expect(editor.locator('a[data-wear="top_hat"]')).toHaveAttribute("href", "/shop");

  // A skirt, then a dress: the dress takes the skirt off, so the world never refuses it.
  await editor.locator('[data-wear="skirt"]').click();
  await editor.locator('[data-wear="dress"]').click();
  await expect(editor.locator('[data-wear="dress"]')).toHaveAttribute("aria-pressed", "true");
  await expect(editor.locator('[data-wear="none-bottom"]')).toHaveAttribute("aria-pressed", "true");

  // Style it: citrus in sun yellow.
  await editor.getByRole("button", { name: "Style your dress" }).click();
  const dress = editor.getByRole("group", { name: "Style your dress" });
  await expect(dress).toBeVisible();
  await dress.locator('[data-garment-pattern="citrus"]').click();
  await dress.locator('[data-value="sun"]').click();
  await expect(dress.locator('[data-garment-pattern="citrus"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dress.getByRole("button", { name: "Done" }).click();
  await expect(dress).toBeHidden();

  // Hair: a style, then its color, which waits until there's a style to color.
  const hairColors = editor.locator(".look-hair-colors");
  await expect(hairColors).toBeHidden();
  await editor.locator('[data-hair="bun"]').click();
  await expect(editor.locator('[data-hair="bun"]')).toHaveAttribute("aria-pressed", "true");
  await hairColors.locator('[data-value="ginger"]').click();

  // Socks, then tap them again to style them: stripes.
  await editor.locator('[data-wear="socks"]').click();
  await editor.locator('[data-wear="socks"]').click();
  const socks = editor.getByRole("group", { name: "Style your socks" });
  await socks.locator('[data-garment-pattern="stripes"]').click();
  await expect(editor.locator(".look-summary")).toHaveText(
    "Your color, ginger bun, plain, citrus dress in sun yellow, striped socks",
  );

  // Nothing scrolls sideways, in the page or in the sheet.
  expect(await overflowsSideways(page)).toBe(false);
  const sheetOverflows = await editor
    .locator(".look-form")
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(sheetOverflows).toBe(false);
  await socks.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/looks-garment-styler.png" });

  await editor.getByRole("button", { name: "Save my look" }).click();
  await expect(editor).toBeHidden();

  // The world has the styles and the hair, as the profile action sent them.
  const world = await (await page.request.get("/v1/world")).json();
  const me = world.residents.find((r: { id: string }) => r.id === who.id);
  expect(me).toMatchObject({
    color: "leaf",
    wear: ["dress", "socks"],
    wearStyle: { dress: { pattern: "citrus", color: "sun" }, socks: { pattern: "stripes" } },
    hair: "bun",
    hairColor: "ginger",
  });

  // The profile says it in words and draws the figure.
  await expect(page.locator(".profile [data-look]")).toHaveText(
    "Ginger bun · Citrus dress in sun yellow, Striped socks",
  );
  await expect(page.locator(".profile .avatar.has-figure canvas")).toBeVisible();
  expect(await overflowsSideways(page)).toBe(false);
  await page.screenshot({ path: "test-results/looks-garment-profile.png" });

  // A locked piece of shop wear takes you to the shop, and the editor closes behind you.
  await page.getByRole("button", { name: "Dress up" }).click();
  await editor.locator('a[data-wear="top_hat"]').click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(editor).toBeHidden();
  expect(errors).toEqual([]);
});
