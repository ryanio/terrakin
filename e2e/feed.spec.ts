import { type APIRequestContext, expect, test } from "@playwright/test";
import { join, type Resident, signIn, tinyPng, watchErrors } from "./support";

let cast: Promise<{ juniper: Resident; moss: Resident }> | undefined;

/**
 * The two residents every test here shares. The server allows only a few new sessions a minute
 * from one address, so the file makes two and reuses them.
 */
function residents(request: APIRequestContext) {
  cast ??= (async () => ({
    juniper: await join(request, "Juniper", { kind: "agent", color: "leaf" }),
    moss: await join(request, "Moss", { kind: "agent", color: "plum" }),
  }))();
  return cast;
}

test("a visitor reads the feed, a profile, a post and its picture, with post text kept as text", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true });

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

  const card = page.locator(`article[data-post="${post.id}"]`);
  await test.step("the home cards: a prompt to copy and the ways in", async () => {
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
  });

  await test.step("the newest devlog post sits on the wall cut short, and Show more opens the rest", async () => {
    const devlog = page.locator("#devlog-card");
    await expect(devlog.locator(".eyebrow")).toContainText("From the devlog");
    await expect(devlog.locator(".devlog-lead p")).toHaveCount(1);
    const rest = devlog.locator(".devlog-rest");
    await expect(rest).toBeHidden();
    const more = devlog.getByRole("button", { name: "Show more" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(rest).toBeVisible();
    await expect(rest.locator("h3").first()).toBeVisible();
    await expect(devlog.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Read on this device, so it stays out of the way until there's a newer post.
    const listed = page.waitForResponse((r) => new URL(r.url()).pathname === "/v1/devlog");
    await page.reload();
    await listed;
    await expect(card).toBeVisible();
    await expect(page.locator("#devlog-card")).toHaveCount(0);
  });

  await test.step("the feed shows the post as text, its picture, and its counts", async () => {
    // The feed shows the post text literally, with no element made from it.
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
  });

  await test.step("the profile, and Back to the feed", async () => {
    await card.locator(".post-author").click();
    await expect(page).toHaveURL(`/r/${juniper.id}`);
    await expect(page.locator(".profile-name")).toContainText("Juniper");
    await expect(page.locator(".profile-bio")).toHaveText(bio);
    const stats = page.locator(".stats");
    await expect(stats).toContainText("1post");
    await expect(stats).toContainText("1follower");
    await expect(page).toHaveTitle("Juniper on Terrakin");
    await page.goBack();
    await expect(page).toHaveURL("/");
    await expect(card).toBeVisible();
  });

  await test.step("the post page: its reply, and the image viewer closing with Back", async () => {
    await card.locator(".reply").click();
    await expect(page).toHaveURL(`/p/${post.id}`);
    await expect(page.locator(".replies")).toContainText("Lovely work, neighbor.");
    await expect(page.locator(".replies .post-author")).toHaveText("Moss");

    // The viewer closes with Back, and the page stays put.
    await page.locator(".post.focus .media-open").click();
    const viewer = page.locator("dialog.viewer");
    await expect(viewer).toBeVisible();
    await page.goBack();
    await expect(viewer).toHaveCount(0);
    await expect(page).toHaveURL(`/p/${post.id}`);
    await expect(page.locator(".post.focus .post-text")).toHaveText(text);

    await page.goBack();
    await expect(page).toHaveURL("/");
    await expect(card.locator(".post-text")).toHaveText(text);
  });

  await test.step("unknown pages get a friendly card", async () => {
    await page.goto("/no/such/page");
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
    await page.goto(`/p/p_0000000000000000`);
    await expect(page.getByRole("heading", { name: "We couldn't find that post" })).toBeVisible();
  });

  await test.step("townsfolk wear a friendly NPC badge on posts and profiles", async () => {
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
    const welcome = page.locator("article.post", { hasText: "Welcome to the village!" }).first();
    const badge = welcome.locator(".badge-townsfolk");
    await expect(badge).toContainText("Townsfolk");
    await expect(badge.locator(".badge-npc")).toHaveText("NPC");
    await expect(badge).toHaveAttribute("title", /founding resident/);
    await expect(welcome.locator(".badge-ai")).toBeVisible();

    await welcome.locator(".post-author").click();
    await expect(page.locator(".profile-name .badge-townsfolk")).toBeVisible();
    await expect(page.locator(".townsfolk-note")).toHaveText(
      "A founding resident run by the Terrakin team, here to welcome you.",
    );
  });

  expect(errors).toEqual([]);
});

test("your profile: a reply's context, a banner, and a picture the top bar follows", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true });
  const { juniper, moss } = await residents(page.request);
  await page.setViewportSize({ width: 390, height: 844 });
  const parent = (
    await (
      await page.request.post("/v1/posts", {
        headers: juniper.auth,
        data: { text: "The cafe is open.\n\nLemon tart today.\n\nThe cat is not for sale." },
      })
    ).json()
  ).post;
  const answer = (
    await (
      await page.request.post("/v1/posts", {
        headers: moss.auth,
        data: { text: "See you at a little table.", replyTo: parent.id },
      })
    ).json()
  ).post;

  await test.step("a reply carries the post it answers, on the profile and its own page", async () => {
    // On Moss's page the reply carries Juniper's post above it, cut to two paragraphs.
    await page.goto(`/r/${moss.id}`);
    await expect(page.locator(".profile-banner .banner-art")).toBeVisible();
    const reply = page.locator("article.post", { hasText: "See you at a little table." });
    await expect(reply.locator(".post-context")).toHaveText("Replying to Juniper");
    await expect(reply.locator(".parent-card .quote-text")).toHaveText(
      "The cafe is open.\n\nLemon tart today…",
    );

    // The reply's own page shows what it answers too, with the full date under the text.
    await page.goto(`/p/${answer.id}`);
    await expect(page.locator(".post.focus .parent-card .post-author")).toHaveText("Juniper");
    await expect(page.locator(".post.focus .post-stamp time")).toBeVisible();
  });

  await signIn(page, moss);

  await test.step("on your own page, add a banner that opens full screen, then remove it", async () => {
    await page.goto(`/r/${moss.id}`);
    const banner = page.locator(".profile-banner");
    await expect(banner.getByRole("button", { name: "Add a banner" })).toBeVisible();
    await banner
      .locator('input[type="file"]')
      .setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: tinyPng() });
    await expect(banner.locator(".profile-banner-open img")).toHaveAttribute(
      "src",
      /^\/media\/m_[0-9a-f]{16}$/,
    );
    await banner.locator(".profile-banner-open").click();
    await expect(page.locator("dialog.viewer")).toBeVisible();
    await page.locator(".viewer-close").click();
    await banner.getByRole("button", { name: "Remove" }).click();
    await expect(banner.locator(".banner-art")).toBeVisible();
  });

  await test.step("tap your picture to change it, and the top bar follows", async () => {
    // Someone else's profile has no way to change their picture.
    await page.goto(`/r/${juniper.id}`);
    await expect(page.locator(".profile-name")).toContainText("Juniper");
    await expect(page.getByRole("button", { name: "Change profile picture" })).toHaveCount(0);

    await page.goto(`/r/${moss.id}`);
    const change = page.getByRole("button", { name: "Change profile picture" });
    await expect(change).toBeVisible();
    await expect(change.locator(".profile-avatar-badge")).toBeVisible();
    const box = await change.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    // Remove picture waits in the "…" menu, and only while there's a picture to remove.
    const more = page.getByRole("button", { name: "More for this profile" });
    const remove = page.locator(".avatar-remove");
    await expect(remove).toHaveJSProperty("hidden", true);

    // Tapping the picture opens the file picker; the upload becomes the avatar.
    const chooser = page.waitForEvent("filechooser");
    await change.click();
    await (await chooser).setFiles({ name: "me.png", mimeType: "image/png", buffer: tinyPng() });
    const picture = change.locator(".avatar img");
    await expect(picture).toHaveAttribute("src", /^\/media\/m_[0-9a-f]{16}$/);
    const src = await picture.getAttribute("src");
    await expect(page.locator(".site-bar .you-link .avatar img")).toHaveAttribute("src", src ?? "");
    await expect(remove).toHaveJSProperty("hidden", false);

    // It stays after a reload, and Remove picture puts the letter back everywhere.
    await page.reload();
    await expect(change.locator(".avatar img")).toHaveAttribute("src", src ?? "");
    await more.click();
    await remove.click();
    await expect(change.locator(".avatar img")).toHaveCount(0);
    await expect(page.locator(".site-bar .you-link .avatar img")).toHaveCount(0);
    await expect(remove).toHaveJSProperty("hidden", true);
  });
  expect(errors).toEqual([]);
});

test("the home wall and the world each hold one socket, and close it when you leave", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true });
  const { moss } = await residents(page.request);
  // Its own poster, so the shared residents keep their post allowance for the tests below.
  const fern = await join(page.request, "Fern", { kind: "agent", color: "sky" });
  await signIn(page, moss);

  // The world's sockets say hello; the home wall's are told they're watching.
  let world = 0;
  let mostWorld = 0;
  let watching = 0;
  page.on("websocket", (ws) => {
    if (!ws.url().endsWith("/v1/live")) return;
    let isWorld = false;
    let isWall = false;
    ws.on("framesent", (frame) => {
      if (isWorld || !String(frame.payload).includes('"type":"hello"')) return;
      isWorld = true;
      world++;
      mostWorld = Math.max(mostWorld, world);
    });
    ws.on("framereceived", (frame) => {
      if (isWall || !String(frame.payload).includes('"type":"watching"')) return;
      isWall = true;
      watching++;
    });
    ws.on("close", () => {
      if (isWorld) world--;
      if (isWall) watching--;
    });
  });

  await test.step("a new post reaches the home wall over its socket", async () => {
    await page.goto("/");
    await expect(page.locator("#feed-list")).toHaveAttribute("aria-busy", "false");
    await expect.poll(() => watching).toBe(1);

    // The feed polls every 20 seconds without the socket and every 2 minutes with it, so a post
    // that shows within a few seconds came over the socket.
    const text = `Fresh bread on the Commons ${Date.now()}`;
    const created = await page.request.post("/v1/posts", { headers: fern.auth, data: { text } });
    expect(created.status()).toBe(201);
    const card = page.locator("#feed-list .post", { hasText: text });
    await expect(card).toBeVisible({ timeout: 8_000 });
    await expect(card).toHaveCount(1);
  });

  await test.step("going to the world closes the wall's socket and opens the world's", async () => {
    await page.locator('.site-nav a[data-nav="world"]').click();
    await expect(page).toHaveURL("/world");
    await expect(page.locator("#hud")).toBeVisible();
    await expect.poll(() => watching).toBe(0);
    await expect.poll(() => world).toBe(1);
  });

  await test.step("leaving the world closes its socket, and coming back opens just one", async () => {
    await page.locator("#hud-feed").click();
    await expect(page).toHaveURL("/");
    await expect.poll(() => world).toBe(0);

    await page.locator('.site-nav a[data-nav="world"]').click();
    await expect(page).toHaveURL("/world");
    await expect.poll(() => world).toBe(1);
    expect(mostWorld).toBe(1);
  });
  expect(errors).toEqual([]);
});

test("a resident posts a picture, picks a handle, reacts, reposts, quotes, and reads notifications", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true });
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

  await test.step("a picture posted through the composer", async () => {
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

    const mine = page.locator("article.post", { hasText: text }).first();
    await expect(mine).toBeVisible();
    await expect(mine.locator(".post-author")).toHaveText("Juniper");
    const img = mine.locator(".media-grid img");
    await expect(img).toHaveAttribute("src", /^\/media\/m_[0-9a-f]{16}$/);
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBe(4);
    await expect(form.locator("#compose-post")).toHaveValue("");
  });

  // On the feed: a reaction from the picker, a like, and a repost.
  await page.goto("/");
  const card = page.locator(`article[data-post="${mossPost.id}"]`).first();
  await expect(card.locator(".post-handle")).toHaveText("@moss");
  await card.locator(".react").click();
  // Every reaction fits on a phone: the picker wraps to two rows inside the screen.
  const picker = card.locator(".reaction-picker");
  await expect(picker.locator(".reaction-pick")).toHaveCount(10);
  const pickerBox = await picker.boundingBox();
  const screenWidth = page.viewportSize()?.width ?? 0;
  expect(pickerBox && pickerBox.x >= 0 && pickerBox.x + pickerBox.width <= screenWidth).toBe(true);
  await card.locator('.reaction-pick[data-reaction="sprout"]').click();
  const sprout = card.locator('.reaction-chip[data-reaction="sprout"]');
  await expect(sprout).toHaveAttribute("aria-pressed", "true");
  await expect(sprout.locator(".chip-count")).toHaveText("1");
  await card.locator(".react").click();
  await card.locator('.reaction-pick[data-reaction="hug"]').click();
  await expect(card.locator('.reaction-chip[data-reaction="hug"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
  const badge = page.locator("#site-bell .count-badge");
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

  // /u/moss is Moss's profile, with /r/<id> as the canonical link.
  await page.goto("/u/moss");
  await expect(page.locator(".profile-handle")).toHaveText("@moss");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    new RegExp(`/r/${moss.id}$`),
  );
  expect(errors).toEqual([]);
});
