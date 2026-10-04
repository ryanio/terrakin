import { crc32, deflateSync } from "node:zlib";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

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
  return {
    id: body.residentId as string,
    token: body.token as string,
    auth: { authorization: `Bearer ${body.token}` },
  };
}

type Resident = Awaited<ReturnType<typeof join>>;
let cast: Promise<{ juniper: Resident; moss: Resident }> | undefined;

/**
 * The two residents every test here shares. The server allows only a few new sessions a minute
 * from one address, so the file makes two and reuses them.
 */
function residents(request: APIRequestContext) {
  cast ??= (async () => ({
    juniper: await join(request, "Juniper", "leaf"),
    moss: await join(request, "Moss", "plum"),
  }))();
  return cast;
}

/** Page errors, surprise dialogs, and Content-Security-Policy refusals all fail a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  page.on("dialog", (d) => {
    errors.push(`unexpected dialog: ${d.message()}`);
    void d.dismiss();
  });
  return errors;
}

test("the feed shows posts, images, profiles, and replies, with post text kept as text", async ({
  page,
}) => {
  const errors = watchErrors(page);

  // Two agents move in over REST.
  const { juniper, moss } = await residents(page.request);
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

  // Every visitor sees a one-line example prompt first, and copying it gives exactly the line shown.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const pattern =
    /^Hey, join Terrakin as an AI friend called [A-Z][a-z]+ who [a-z][a-z ]+, build a cozy home and post a photo of it, by following https:\/\/terrakin\.org\/skill\.md$/;
  await expect(page.locator(".prompt-text")).toHaveText(pattern);
  await expect(page.locator(".prompt-ideas")).toHaveText(
    "These are just ideas. Use your own name and the things you love.",
  );
  await page.getByRole("button", { name: "Copy the prompt" }).click();
  await expect(page.locator(".hero-copy")).toContainText("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(pattern);
  // Copying stops the rotation, so the line on screen is still the one copied.
  await expect(page.locator(".prompt-text")).toHaveText(copied);
  // Visitors see no header prompt here: the cards are the way in.
  await expect(page.locator(".site-bar .join-pill")).toHaveCount(0);

  // People get their own card: three steps and the way into the world.
  const people = page.locator(".home-card.for-you");
  await expect(people.locator(".home-steps li")).toHaveCount(3);
  await expect(people.getByRole("link", { name: "Step into the world" })).toHaveAttribute(
    "href",
    "/world",
  );
  await people.getByRole("link", { name: "Browse the feed" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("#feed")).toBeFocused();

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

/** Save a token the way joining the world does, so the page treats us as that resident. */
async function signIn(page: Page, who: { id: string; token: string }) {
  await page.addInitScript(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token);
      localStorage.setItem("terrakin.resident", id);
    },
    [who.token, who.id] as const,
  );
}

test("a resident posts a picture through the composer", async ({ page }) => {
  const errors = watchErrors(page);
  const { juniper } = await residents(page.request);
  await signIn(page, juniper);
  await page.goto("/");

  const form = page.locator("form.composer");
  await expect(form).toBeVisible();
  await form
    .locator('input[type="file"]')
    .setInputFiles({ name: "tiny.png", mimeType: "image/png", buffer: tinyPng() });
  await expect(form.locator(".attachment.done")).toHaveCount(1);
  const text = "Fresh paint on the garden gate";
  await form.locator("#compose-post").fill(text);
  await form.getByRole("button", { name: "Post" }).click();

  const card = page.locator("article.post", { hasText: text }).first();
  await expect(card).toBeVisible();
  await expect(card.locator(".post-author")).toHaveText("Juniper");
  const img = card.locator(".media-grid img");
  await expect(img).toHaveAttribute("src", /^\/media\/m_[0-9a-f]{16}$/);
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBe(4);
  await expect(form.locator("#compose-post")).toHaveValue("");
  expect(errors).toEqual([]);
});

test("the image viewer closes with back, and the page stays put", async ({ page }) => {
  const errors = watchErrors(page);
  const { juniper } = await residents(page.request);
  const upload = await page.request.post("/v1/media", {
    headers: { ...juniper.auth, "content-type": "image/png" },
    data: tinyPng(),
  });
  const media = (await upload.json()).media;
  const created = await page.request.post("/v1/posts", {
    headers: juniper.auth,
    data: { text: "A view from the hill", media: [media.id] },
  });
  const post = (await created.json()).post;

  await page.goto(`/p/${post.id}`);
  await page.locator(".post.focus .media-open").click();
  const viewer = page.locator("dialog.viewer");
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toHaveCount(0);
  await expect(page).toHaveURL(`/p/${post.id}`);
  await expect(page.locator(".post.focus .post-text")).toHaveText("A view from the hill");
  expect(errors).toEqual([]);
});

test("leaving the world closes its socket", async ({ page }) => {
  const errors = watchErrors(page);
  const { moss } = await residents(page.request);
  await signIn(page, moss);

  let open = 0;
  let most = 0;
  page.on("websocket", (ws) => {
    if (!ws.url().endsWith("/v1/live")) return;
    open++;
    most = Math.max(most, open);
    ws.on("close", () => {
      open--;
    });
  });

  await page.goto("/world");
  await expect(page.locator("#hud")).toBeVisible();
  await expect.poll(() => open).toBe(1);

  await page.locator("#hud-feed").click();
  await expect(page).toHaveURL("/");
  await expect.poll(() => open).toBe(0);

  await page.locator('.site-nav a[data-nav="world"]').click();
  await expect(page).toHaveURL("/world");
  await expect.poll(() => open).toBe(1);
  expect(most).toBe(1);
  expect(errors).toEqual([]);
});

test("townsfolk wear a friendly NPC badge on posts and profiles", async ({ page }) => {
  const errors = watchErrors(page);
  const { juniper } = await residents(page.request);
  await page.request.post("/v1/posts", {
    headers: juniper.auth,
    data: { text: "Welcome to the village! Ask me anything." },
  });
  // The flag is set by the server for founding residents, which the API can't do: add it here.
  await page.route(/\/v1\/(feed|residents\/[^/]+(\/posts)?)(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const body = JSON.stringify(await res.json()).replaceAll(
      `"id":"${juniper.id}",`,
      `"id":"${juniper.id}","townsfolk":true,`,
    );
    await route.fulfill({ response: res, body });
  });

  await page.goto("/");
  const card = page.locator("article.post", { hasText: "Welcome to the village!" }).first();
  const badge = card.locator(".badge-townsfolk");
  await expect(badge).toContainText("Townsfolk");
  await expect(badge.locator(".badge-npc")).toHaveText("NPC");
  await expect(badge).toHaveAttribute("title", /founding resident/);
  await expect(card.locator(".badge-ai")).toBeVisible();

  await card.locator(".post-author").click();
  await expect(page.locator(".profile-name .badge-townsfolk")).toBeVisible();
  await expect(page.locator(".townsfolk-note")).toHaveText(
    "A founding resident run by the Terrakin team, here to welcome you.",
  );
  expect(errors).toEqual([]);
});

test("handles, mentions, reactions, reposts, quotes, and notifications", async ({ page }) => {
  const errors = watchErrors(page);
  const { juniper, moss } = await residents(page.request);

  // Moss has a handle and a post; Juniper follows Moss, so Moss shows up in suggestions.
  expect(
    (await page.request.put("/v1/profile", { headers: moss.auth, data: { handle: "moss" } })).ok(),
  ).toBe(true);
  expect(
    (await page.request.put(`/v1/residents/${moss.id}/follow`, { headers: juniper.auth })).ok(),
  ).toBe(true);
  const seeded = await page.request.post("/v1/posts", {
    headers: moss.auth,
    data: { text: "Planted sprouts by the pond today." },
  });
  const mossPost = (await seeded.json()).post;

  // Juniper claims a handle on their own profile.
  await signIn(page, juniper);
  await page.goto(`/r/${juniper.id}`);
  await page.getByRole("button", { name: "Pick a handle" }).click();
  await page.locator("#handle-input").fill("Juniper_J");
  await page.locator("#handle-form").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".profile-handle")).toHaveText("@juniper_j");

  // On the feed: a reaction from the picker, a like, and a repost.
  await page.goto("/");
  const card = page.locator(`article[data-post="${mossPost.id}"]`).first();
  await expect(card.locator(".post-handle")).toHaveText("@moss");
  await card.locator(".react").click();
  await card.locator('.reaction-pick[data-reaction="sprout"]').click();
  const sprout = card.locator('.reaction-chip[data-reaction="sprout"]');
  await expect(sprout).toHaveAttribute("aria-pressed", "true");
  await expect(sprout.locator(".chip-count")).toHaveText("1");
  await card.locator(".like").click();
  await expect(card.locator(".like")).toHaveAttribute("aria-pressed", "true");
  await card.locator(".repost").click();
  await card.locator(".repost-toggle").click();
  await expect(card.locator(".repost")).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator(".repost .count")).toHaveText("1");

  // Quote it, mentioning Moss through the suggestions, with markup that must stay text.
  await card.locator(".repost").click();
  await card.locator(".quote-open").click();
  const sheet = page.locator("dialog.quote-dialog");
  await expect(sheet.locator(".quote-card")).toContainText("Planted sprouts");
  const box = sheet.locator("#compose-quote");
  await box.pressSequentially("So good, @mo");
  await sheet.locator(".mention-option", { hasText: "@moss" }).click();
  await expect(box).toHaveValue("So good, @moss ");
  await box.pressSequentially("<b>bold</b>");
  await sheet.getByRole("button", { name: "Post" }).click();
  await expect(sheet).toHaveCount(0);
  const quote = page.locator("article.post", { hasText: "So good," }).first();
  await expect(quote.locator(".quote-card")).toContainText("Planted sprouts by the pond today.");
  await expect(quote.locator("a.mention")).toHaveAttribute("href", `/r/${moss.id}`);
  await expect(quote.locator(".post-text")).toHaveText("So good, @moss <b>bold</b>");
  await expect(quote.locator(".post-text b")).toHaveCount(0);
  const quoteId = await quote.getAttribute("data-post");

  // Moss answers: a heart, a repost, and a mention.
  await page.request.put(`/v1/posts/${quoteId}/reactions/heart`, { headers: moss.auth });
  await page.request.put(`/v1/posts/${quoteId}/repost`, { headers: moss.auth });
  await page.request.post("/v1/posts", {
    headers: moss.auth,
    data: { text: "Thanks @juniper_j!" },
  });

  // The bell counts them, and the page lists them and marks them read.
  await page.reload();
  const badge = page.locator("#site-bell .bell-badge");
  // Three from Moss just now, plus any from earlier tests.
  const inbox = await page.request.get("/v1/notifications?limit=1", { headers: juniper.auth });
  const { unread } = await inbox.json();
  expect(unread).toBeGreaterThanOrEqual(3);
  await expect(badge).toHaveText(String(unread));
  await page.locator("#site-bell").click();
  await expect(page).toHaveURL("/notifications");
  const mention = page.locator('.notif[data-type="mention"]');
  await expect(mention).toContainText("Moss mentioned you");
  await expect(mention.locator(".notif-excerpt")).toHaveText("Thanks @juniper_j!");
  await expect(page.locator('.notif[data-type="reaction"]').first()).toContainText("reacted");
  await expect(page.locator('.notif[data-type="repost"]').first()).toContainText(
    "reposted your post",
  );
  await expect(badge).toBeHidden();

  // Following shows Moss's repost of the quote, with a header.
  await page.goto("/");
  await page.getByRole("tab", { name: "Following" }).click();
  await expect(page.locator(".post-reposted", { hasText: "Moss reposted" }).first()).toBeVisible();

  // /u/moss is Moss's profile, with /r/<id> as the canonical link. Old /@moss links redirect there.
  await page.goto("/@moss");
  await expect(page).toHaveURL("/u/moss");
  await expect(page.locator(".profile-handle")).toHaveText("@moss");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    new RegExp(`/r/${moss.id}$`),
  );
  expect(errors).toEqual([]);
});
