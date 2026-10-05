import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { join, signIn, watchErrors } from "./support";

/** Where the fake X listens. playwright.config.ts points the server here. */
const FAKE_X_PORT = 8791;

/**
 * Connecting an X account on a phone. The server reads posts from a fake X oEmbed endpoint that
 * this file runs (TERRAKIN_TEST_X_OEMBED in playwright.config.ts), so no test touches X.
 */

/** Posts the fake X knows, by status id. */
const posts = new Map<string, { handle: string; text: string }>();
let fake: Server;

test.beforeAll(async () => {
  fake = createServer((req, res) => {
    const asked = new URL(req.url ?? "/", "http://fake").searchParams.get("url") ?? "";
    const id = /\/status\/(\d+)$/.exec(asked)?.[1] ?? "";
    const post = posts.get(id);
    if (!post) {
      res.writeHead(404).end();
      return;
    }
    // Shaped like X's real answer, with a byline that must not count toward the check.
    const html = `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${escapeHtml(post.text)}</p>&mdash; Someone (@${post.handle}) <a href="https://x.com/${post.handle}/status/${id}">October 4, 2026</a></blockquote>`;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ author_url: `https://x.com/${post.handle}`, html }));
  });
  await new Promise<void>((done) => fake.listen(FAKE_X_PORT, "127.0.0.1", done));
});

test.afterAll(() => new Promise<void>((done) => fake.close(() => done())));

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

test("a resident connects their X account from their profile", async ({ page }) => {
  const errors = watchErrors(page, { dialogs: true, console: "none" });
  const fern = await join(page.request, "Fern", { color: "sky" });
  const { id: residentId, auth } = fern;
  await signIn(page, fern);
  await page.request.post("/v1/posts", { headers: auth, data: { text: "Planting beans today." } });

  await page.goto(`/r/${residentId}`);
  const connect = page.getByRole("button", { name: "Connect X" });
  await expect(connect).toBeVisible();
  await connect.click();

  // Step 1: the line to post, a copy button, and X's intent with exactly that line.
  const sheet = page.locator("dialog.x-sheet");
  await expect(sheet.getByRole("heading", { name: "Connect X" })).toBeVisible();
  const phrase = sheet.locator(".x-phrase");
  await expect(phrase).toContainText("code tk-");
  const text = (await phrase.textContent()) ?? "";
  expect(text).toMatch(
    new RegExp(`^Joining Terrakin as Fern · terrakin\\.org/r/${residentId} · code tk-[a-z2-9]{8}$`),
  );
  const open = sheet.getByRole("link", { name: "Open X" });
  const intent = new URL((await open.getAttribute("href")) ?? "");
  expect(intent.origin + intent.pathname).toBe("https://x.com/intent/post");
  expect(intent.searchParams.get("text")).toBe(text);
  await page.screenshot({ path: "test-results/x-connect-sheet.png", animations: "disabled" });

  // A post without the code is turned down with the server's reason.
  posts.set("1001", { handle: "fern_grows", text: "Hello from Fern" });
  const input = sheet.getByLabel("Paste the link to your post");
  await input.fill("https://x.com/fern_grows/status/1001");
  await sheet.getByRole("button", { name: "Verify" }).click();
  await expect(sheet.getByRole("alert")).toContainText("doesn't have your code");

  // Step 2: the real post.
  posts.set("1002", { handle: "Fern_Grows", text });
  await input.fill("https://x.com/fern_grows/status/1002");
  await sheet.getByRole("button", { name: "Verify" }).click();
  await expect(sheet.getByText("Connected @Fern_Grows")).toBeVisible();
  await page.screenshot({ path: "test-results/x-connected.png", animations: "disabled" });
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);

  const link = page.locator(".profile .x-account");
  await expect(link).toHaveText("@Fern_Grows on X");
  await expect(link).toHaveAttribute("href", "https://x.com/Fern_Grows");
  await expect(link).toHaveAttribute("rel", "me noopener");
  // Posts loaded before connecting get the mark on the next load.
  await page.reload();
  await expect(link).toBeVisible();
  await expect(page.locator("article .badge-x")).toHaveAttribute(
    "aria-label",
    "Connected X account @Fern_Grows",
  );
  await page.screenshot({ path: "test-results/x-profile.png", animations: "disabled" });

  // A visitor without a token sees the link too, but no way to change it.
  const visitor = await page
    .context()
    .browser()
    ?.newContext({ viewport: { width: 390, height: 844 } });
  if (!visitor) throw new Error("no browser");
  const other = await visitor.newPage();
  await other.goto(`/r/${residentId}`);
  await expect(other.locator(".profile .x-account")).toHaveText("@Fern_Grows on X");
  await expect(other.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  await visitor.close();

  // Disconnecting takes a second tap, then takes it off the profile.
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.locator(".profile .x-account")).toHaveText("@Fern_Grows on X");
  await page.getByRole("button", { name: "Tap again to disconnect" }).click();
  await expect(page.locator(".profile .x-account")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect X" })).toBeVisible();

  expect(errors).toEqual([]);
});
