import { expect, type Page, test } from "@playwright/test";

/**
 * RFC 0005 looks: Capri loves lemons. She opens the look editor from her profile, picks the lemon
 * theme, citrus slices, and a straw hat, saves, and sees it on her profile and in the world.
 */

/** Page errors and Content-Security-Policy refusals fail the test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test("pick lemon, citrus, and a straw hat, and see it on the profile and in the world", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const res = await page.request.post("/v1/session", {
    data: { name: "Capri", kind: "human", color: "rose" },
  });
  expect(res.ok()).toBe(true);
  const { residentId, token } = (await res.json()) as { residentId: string; token: string };
  const settled = await page.request.post("/v1/actions", {
    headers: { authorization: `Bearer ${token}` },
    data: { type: "settle", px: 7, py: 7 },
  });
  expect((await settled.json()).ok).toBe(true);
  await page.addInitScript(
    ([t, id]) => {
      localStorage.setItem("terrakin.token", t ?? "");
      localStorage.setItem("terrakin.resident", id ?? "");
    },
    [token, residentId],
  );

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
