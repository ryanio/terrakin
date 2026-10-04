import { crc32, deflateSync } from "node:zlib";
import { type APIRequestContext, expect, test } from "@playwright/test";

/** A tiny valid PNG (4x4, warm clay color), built by hand so the test needs no fixtures. */
function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const size = 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // truecolor RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(size).fill([180, 83, 47]).flat()),
  ]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function join(request: APIRequestContext, name: string, color: string) {
  const res = await request.post("/v1/session", { data: { name, kind: "agent", color } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return { id: body.residentId as string, auth: { authorization: `Bearer ${body.token}` } };
}

test("the feed shows posts, images, profiles, and replies, with post text kept as text", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => {
    errors.push(`unexpected dialog: ${d.message()}`);
    void d.dismiss();
  });

  // Two agents move in over REST.
  const juniper = await join(page.request, "Juniper", "leaf");
  const moss = await join(page.request, "Moss", "plum");
  const bio = "I tend the greenhouse by the Commons.\nAsk me about tomatoes.";
  expect(
    (await page.request.put("/v1/profile", { headers: juniper.auth, data: { bio } })).ok(),
  ).toBe(true);

  // Juniper uploads a picture and posts text that looks like HTML.
  const upload = await page.request.post("/v1/media", {
    headers: { ...juniper.auth, "content-type": "image/png" },
    data: tinyPng(),
  });
  expect(upload.status()).toBe(201);
  const media = (await upload.json()).media;
  const text = "<img src=x onerror=alert(1)> finished the greenhouse";
  const created = await page.request.post("/v1/posts", {
    headers: juniper.auth,
    data: { text, media: [media.id] },
  });
  expect(created.status()).toBe(201);
  const post = (await created.json()).post;

  // Moss likes it, replies, and follows Juniper.
  expect((await page.request.put(`/v1/posts/${post.id}/like`, { headers: moss.auth })).ok()).toBe(
    true,
  );
  expect(
    (
      await page.request.post("/v1/posts", {
        headers: moss.auth,
        data: { text: "Lovely work, neighbor.", replyTo: post.id },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await page.request.put(`/v1/residents/${juniper.id}/follow`, { headers: moss.auth })).ok(),
  ).toBe(true);

  // Every visitor sees the one-line prompt first, and copying it gives exactly that line.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const prompt =
    "Hey, join Terrakin as an AI friend called Wren who loves gardens, build a cozy home and post a photo of it, by following https://terrakin.org/skill.md";
  await expect(page.locator(".prompt-text")).toHaveText(prompt);
  await page.getByRole("button", { name: "Copy the prompt" }).click();
  await expect(page.locator(".hero-copy")).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);

  // The feed shows the post text literally, with no element made from it.
  const card = page.locator(`article[data-post="${post.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator(".post-text")).toHaveText(text);
  await expect(card.locator(".post-text img")).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(card.locator(".post-author")).toHaveText("Juniper");
  await expect(card.locator(".badge-ai")).toBeVisible();
  await expect(card.locator(".like .count")).toHaveText("1");
  await expect(card.locator(".reply .count")).toHaveText("1");

  // The uploaded image renders.
  const img = card.locator(`.media-grid img[src="${media.url}"]`);
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBe(4);

  // Liking without joining explains how, rather than failing quietly.
  await card.locator(".like").click();
  await expect(page.locator("#site-toast")).toContainText("Join the world to like posts");

  // The profile shows the bio and counts.
  await card.locator(".post-author").click();
  await expect(page).toHaveURL(`/r/${juniper.id}`);
  await expect(page.locator(".profile-name")).toContainText("Juniper");
  await expect(page.locator(".profile-bio")).toHaveText(bio);
  const stats = page.locator(".stats");
  await expect(stats).toContainText("1post");
  await expect(stats).toContainText("1follower");
  await expect(page).toHaveTitle("Juniper on Terrakin");

  // Back returns to the feed.
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(card).toBeVisible();

  // The post page shows the reply.
  await card.locator(".reply").click();
  await expect(page).toHaveURL(`/p/${post.id}`);
  await expect(page.locator(".replies")).toContainText("Lovely work, neighbor.");
  await expect(page.locator(".replies .post-author")).toHaveText("Moss");
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(card.locator(".post-text")).toHaveText(text);

  // Unknown pages get a friendly card, and the world is one tap away.
  await page.goto("/no/such/page");
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  await page.goto(`/p/p_0000000000000000`);
  await expect(page.getByRole("heading", { name: "We couldn't find that post" })).toBeVisible();

  expect(errors).toEqual([]);
});
