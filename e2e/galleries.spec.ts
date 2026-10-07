import { expect, test } from "@playwright/test";
import {
  act,
  join,
  overflowsSideways,
  persona,
  read,
  settler,
  signIn,
  tapTile,
  tinyPng,
  watchErrors,
} from "./support";

/**
 * Gallery reports (decision 0059) at 390x844: a co-owner's piece reported from the pedestal's sheet
 * and from /galleries, then deleted and taken off display by a maintainer in the staff app.
 * Listing and admiring a gallery are in make.spec.ts, which makes the piece through the UI.
 */
test("a piece on display is reported, taken down, and loses its picture", async ({ page }) => {
  const errors = watchErrors(page, { dialogs: true });
  // Odile's plot, shared with Bram, who has no plot of his own: his starter home is Odile's, so
  // `home` takes him to her hearth, and he puts his piece on her pedestal next to it.
  const odile = await settler(page.request, "Odile");
  const bram = await join(page.request, "Bram");
  const marlo = await persona(page.request, { name: "Marlo", staff: true });
  expect((await act(page.request, odile.token, { type: "share_plot", with: bram.id })).ok).toBe(
    true,
  );
  expect((await act(page.request, bram.token, { type: "build_starter_home" })).ok).toBe(true);
  expect((await act(page.request, bram.token, { type: "home" })).ok).toBe(true);
  const world = async () => (await page.request.get("/v1/world")).json();
  const me = (await world()).residents.find((r: { id: string }) => r.id === odile.id);
  const at = { x: me.x - 1, y: me.y - 1 };
  expect(
    (await act(page.request, odile.token, { type: "place", ...at, block: "pedestal" })).ok,
  ).toBe(true);
  const upload = await page.request.post("/v1/media", {
    headers: { ...bram.auth, "content-type": "image/png" },
    data: tinyPng(),
  });
  const media = (await upload.json()).media.id as string;
  expect(
    (await act(page.request, bram.token, { type: "make_piece", media, title: "Storm" })).ok,
  ).toBe(true);
  const piece = (await read(page.request, bram.token, "/v1/inventory")).inventory.goods[0];
  expect((await act(page.request, bram.token, { type: "display", item: piece.id, ...at })).ok).toBe(
    true,
  );
  const { plotSize } = (await world()).config;
  const plot = { px: Math.floor(at.x / plotSize), py: Math.floor(at.y / plotSize) };
  expect(
    (await act(page.request, odile.token, { type: "set_gallery", ...plot, open: true })).ok,
  ).toBe(true);

  // Odile taps the pedestal in the world and reports Bram's piece from its sheet.
  await signIn(page, odile);
  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  await tapTile(page, -1, -1);
  const shown = page.locator(".display-sheet");
  await expect(shown.locator(".showcase-name")).toHaveText("Piece of art “Storm”");
  const report = shown.locator("#display-report");
  expect((await report.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await report.click();
  const sheet = page.locator("dialog.report-sheet");
  await expect(sheet).toContainText("What's wrong with this piece of art?");
  await sheet.getByText("Sexual content", { exact: true }).click();
  await sheet.getByRole("button", { name: "Send report" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#site-toast")).toContainText("A maintainer will take a look");

  // A neighbor reports it from the gallery's list too; Bram's own row has no More menu.
  const sage = await join(page.request, "Sage");
  await signIn(page, sage);
  await page.goto("/galleries");
  const row = page.locator(`.gallery-piece[data-item="${piece.id}"]`);
  await expect(row).toContainText("Storm");
  await row.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Report piece" }).click();
  await sheet.getByText("Sexual content", { exact: true }).click();
  await sheet.getByRole("button", { name: "Send report" }).click();
  await expect(sheet).toBeHidden();
  expect(await overflowsSideways(page)).toBe(false);
  // And reports it as a thing on display, over the API.
  const filed = await page.request.post("/v1/reports", {
    headers: sage.auth,
    data: { kind: "display", id: piece.id, reason: "sexual" },
  });
  expect(filed.status()).toBe(201);
  await signIn(page, bram);
  await page.goto("/galleries");
  await expect(row.getByRole("button", { name: "More" })).toHaveCount(0);

  // Marlo deletes its picture in the staff app, with a reason and a second tap. That settles the
  // report on it as a thing on display too.
  await page.goto("/admin");
  expect(new URL(page.url()).hostname).toBe("admin.localhost");
  await page.getByLabel("Token", { exact: true }).fill(marlo.token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const items = page.locator(`article.item[data-id="${piece.id}"]`);
  const asPiece = items.filter({ hasText: "Piece of art · 2 reports" });
  await expect(asPiece).toContainText("Storm");
  await expect(asPiece.locator(".media-reveal")).toBeVisible();
  await expect(items.filter({ hasText: "On display · 1 report" })).toHaveCount(1);
  await asPiece.getByLabel("Reason").fill("Explicit picture");
  const remove = asPiece.getByRole("button", { name: "Delete picture" });
  expect((await remove.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await remove.click();
  await asPiece.getByRole("button", { name: "Tap again to delete the picture everywhere" }).click();
  await expect(page.locator("#site-toast")).toContainText("in the log");
  await expect(items).toHaveCount(0);
  const onPedestal = async () =>
    ((await world()).displays ?? []).filter(
      (d: { x: number; y: number }) => d.x === at.x && d.y === at.y,
    );
  await expect.poll(onPedestal).toEqual([]);
  await page.getByRole("link", { name: "Log" }).click();
  await expect(page.locator(".log-entry").filter({ hasText: piece.id }).first()).toContainText(
    "Deleted a piece's picture",
  );

  // Back in Bram's things, titled and without its picture, and the file is gone.
  const goods = (await read(page.request, bram.token, "/v1/inventory")).inventory.goods;
  expect(goods).toEqual([expect.objectContaining({ id: piece.id, label: "Storm" })]);
  expect(goods[0].media).toBeUndefined();
  expect((await page.request.get(`/media/${media}`)).status()).toBe(404);

  // Bram puts it up again. Reported for its title, Marlo takes it off display, keeping it.
  expect((await act(page.request, bram.token, { type: "display", item: piece.id, ...at })).ok).toBe(
    true,
  );
  const again = await page.request.post("/v1/reports", {
    headers: odile.auth,
    data: { kind: "display", id: piece.id, reason: "other", note: "The title" },
  });
  expect(again.status()).toBe(201);
  await page.getByRole("link", { name: "Queue" }).click();
  const shownItem = items.filter({ hasText: "On display · 1 report" });
  await shownItem.getByLabel("Reason").fill("Title");
  await shownItem.getByRole("button", { name: "Take off display" }).click();
  await shownItem.getByRole("button", { name: "Tap again to take it down" }).click();
  await expect(page.locator("#site-toast")).toContainText("in the log");
  await expect(items).toHaveCount(0);
  await expect.poll(onPedestal).toEqual([]);
  expect((await read(page.request, bram.token, "/v1/inventory")).inventory.goods).toEqual([
    expect.objectContaining({ id: piece.id }),
  ]);
  expect(errors).toEqual([]);
});
