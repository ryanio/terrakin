import { expect, test } from "@playwright/test";
import {
  act,
  freePlots,
  join,
  overflowsSideways,
  settleFree,
  signIn,
  watchErrors,
} from "./support";

/**
 * MuseFelipe's acceptance test: a partner opens an invite link, picks a name, color, and shape,
 * lands on a plot next to the inviter with a starter home, the two follow each other, and the
 * partner sends a hug and a private letter, all in well under two minutes with no docs.
 */

const SCREENSHOTS = "test-results";

test("a partner accepts an invite, moves in next door, and sends a hug and a letter", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true });

  // The inviter lives here already: joined over the API, settled, home built. Their plot is the free
  // one with the most free plots around it, so the partner can move in next door.
  const felipe = await join(page.request, "Felipe", { color: "sky" });
  const free = await freePlots(page.request, 64, "bottom-left");
  const isFree = new Set(free.map(([px, py]) => `${px},${py}`));
  const room = ([px, py]: [number, number]) =>
    [-1, 0, 1]
      .flatMap((dx) => [-1, 0, 1].map((dy) => `${px + dx},${py + dy}`))
      .filter((key) => key !== `${px},${py}` && isFree.has(key)).length;
  await settleFree(
    page.request,
    felipe.token,
    [...free].sort((a, b) => room(b) - room(a)),
  );
  expect((await act(page.request, felipe.token, { type: "build_starter_home" })).ok).toBe(true);
  const made = await page.request.post("/v1/invites", { headers: felipe.auth, data: {} });
  expect(made.status()).toBe(201);
  const { path } = (await made.json()).invite as { path: string };

  const started = Date.now();

  // The partner opens the link: who invited them, then a short form.
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Felipe invited you to Terrakin" })).toBeVisible();
  // The first color and shape are picked to start, every time.
  await expect(page.locator('#invite-color [aria-pressed="true"]')).toHaveAttribute(
    "data-value",
    "sun",
  );
  await page.screenshot({ path: `${SCREENSHOTS}/duo-invite.png` });

  await page.fill("#invite-name", "Lina");
  await page.click('#invite-color [data-value="rose"]');
  await page.click('#invite-shape [data-value="diamond"]');
  await page.fill("#invite-note", "Felipe's partner, loves lemons");
  await expect(page.locator("#invite-build")).toBeChecked();
  await page.getByRole("button", { name: "Move in" }).click();

  // She lands in the world, next door, with a home.
  await expect(page).toHaveURL("/world");
  await expect(page.locator("#hud")).toBeVisible();
  const lina = await page.evaluate(() => ({
    id: localStorage.getItem("terrakin.resident") ?? "",
    token: localStorage.getItem("terrakin.token") ?? "",
  }));
  expect(lina.token).not.toBe("");
  const linaAuth = { authorization: `Bearer ${lina.token}` };

  const world = await (await page.request.get("/v1/world")).json();
  const me = world.residents.find((r: { id: string }) => r.id === lina.id);
  expect(me).toMatchObject({ name: "Lina", color: "rose", shape: "diamond" });
  const plotOf = (owner: string) =>
    world.plots.find((p: { ownerId: string }) => p.ownerId === owner) as { px: number; py: number };
  const hers = plotOf(lina.id);
  const his = plotOf(felipe.id);
  expect(Math.max(Math.abs(hers.px - his.px), Math.abs(hers.py - his.py))).toBe(1);
  const size = world.config.plotSize;
  const onHerPlot = world.blocks.filter(
    (b: { x: number; y: number }) =>
      Math.floor(b.x / size) === hers.px && Math.floor(b.y / size) === hers.py,
  );
  expect(onHerPlot.length).toBeGreaterThanOrEqual(15);
  expect(me.hearth).not.toBeNull();

  // Felipe hugs her while she's in the world, and her figure shows love (RFC 0013).
  await expect(page.locator("#world")).toHaveAttribute("data-feeling", "neutral");
  const hug = await page.request.post(`/v1/residents/${lina.id}/gesture`, {
    headers: felipe.auth,
    data: { kind: "hug" },
  });
  expect(hug.status()).toBe(201);
  await expect(page.locator("#world")).toHaveAttribute("data-feeling", "love");

  // They follow each other.
  const seen = async (viewer: Record<string, string>, id: string) =>
    (await (await page.request.get(`/v1/residents/${id}`, { headers: viewer })).json()).resident;
  expect((await seen(linaAuth, felipe.id)).followed).toBe(true);
  expect((await seen(felipe.auth, lina.id)).followed).toBe(true);

  // From his profile she sends a hug...
  await page.goto(`/r/${felipe.id}`);
  await page.locator('.gesture[data-kind="hug"]').click();
  await expect(page.locator("#site-toast")).toContainText("You sent a hug to Felipe");
  await expect(page.locator(".streak-line")).toContainText("1 day in a row");
  await page.screenshot({ path: `${SCREENSHOTS}/duo-profile.png` });

  // ...and a letter.
  await page.getByRole("link", { name: "Write a letter" }).click();
  await expect(page).toHaveURL(`/letters/${felipe.id}`);
  const words = "Dinner at the hearth tonight? I'll bring the lemon cake.";
  await page.fill("#letter-text", words);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".letter.mine .letter-text")).toHaveText(words);

  // Nothing on these pages is wider than the phone.
  expect(await overflowsSideways(page)).toBe(false);

  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(60_000);
  test.info().annotations.push({ type: "duo flow", description: `${elapsed} ms` });

  // Felipe sees both, over the API.
  const gestures = await (await page.request.get("/v1/gestures", { headers: felipe.auth })).json();
  expect(gestures.gestures[0]).toMatchObject({
    kind: "hug",
    from: { id: lina.id },
    to: { id: felipe.id },
  });
  expect(gestures.streaks[0]).toMatchObject({ streak: 1, with: { id: lina.id } });
  const inbox = await (await page.request.get("/v1/letters", { headers: felipe.auth })).json();
  expect(inbox.unread).toBe(1);
  expect(inbox.letters[0]).toMatchObject({
    text: words,
    trust: "untrusted",
    from: { id: lina.id },
  });

  // Her letters page lists the conversation.
  await page.goto("/letters");
  await expect(page.locator(".conversation .conversation-name")).toHaveText("Felipe");
  await page.screenshot({ path: `${SCREENSHOTS}/duo-letters.png` });

  expect(errors).toEqual([]);
});

test("a visitor joins and follows from a profile, and its counts open followers and friends", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true });
  const host = await join(page.request, "Marisol", { color: "leaf" });
  const rue = await join(page.request, "Rue", { color: "rose" });
  // Rue follows Marisol, who doesn't follow back.
  await page.request.put(`/v1/residents/${host.id}/follow`, { headers: rue.auth });

  await page.goto(`/r/${host.id}`);
  // Visitors get a Join pill that leads to the get-started cards.
  await expect(page.locator(".site-bar .join-pill")).toHaveAttribute("href", "/#join");
  await page.getByRole("button", { name: "Join and follow Marisol" }).click();
  await page.fill("#follow-join-name", "Teo");
  await page.click('#follow-join-shape [data-value="square"]');
  await page.locator("#follow-join-form").getByRole("button", { name: "Join and follow" }).click();

  await expect(page.locator("#site-toast")).toContainText("you follow Marisol");
  await expect(page.locator(".follow")).toHaveText("Following");
  await expect(page.locator(".site-bar .letters-link")).toBeVisible();
  await expect(page.locator(".site-bar .join-pill")).toHaveCount(0);

  await test.step("a profile's counts open its followers and friends", async () => {
    // Marisol follows Teo back, so Teo is a friend and Rue only a follower.
    const teo = await page.evaluate(() => localStorage.getItem("terrakin.resident") ?? "");
    await page.request.put(`/v1/residents/${teo}/follow`, { headers: host.auth });
    await page.reload();
    await page.locator(".profile .stat-link", { hasText: "followers" }).click();
    await expect(page).toHaveURL(`/r/${host.id}/followers`);
    // Newest first.
    await expect(page.locator(".people-row .person-name")).toHaveText(["Teo", "Rue"]);

    await page.locator(".people-tab", { hasText: "Friends" }).click();
    await expect(page).toHaveURL(`/r/${host.id}/friends`);
    await expect(page.locator(".people-row .person-name")).toHaveText(["Teo"]);
    await expect(page.locator(".people-tab[aria-current=page]")).toContainText("1");

    // Tabs swap the history entry, so Back returns to the profile.
    await page.goBack();
    await expect(page).toHaveURL(`/r/${host.id}`);
  });

  await test.step("the avatar in the top bar opens your own profile", async () => {
    await page.locator(".site-bar .you-link").click();
    await expect(page.locator(".you-tag")).toHaveText("This is you");
    await expect(
      page.getByRole("heading", { name: "Your character lives in this browser" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite someone" })).toBeVisible();
  });

  await test.step("signed out, the Join pill on another page leads home, to the cards", async () => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/r/${host.id}`);
    await page.locator(".site-bar .join-pill").click();
    await expect(page).toHaveURL("/#join");
    await expect(page.locator("#join")).toBeFocused();
  });

  expect(errors).toEqual([]);
});

test("the invite sheet: one link until it's sent, no home to share yet, and a different key", async ({
  page,
}) => {
  const errors = watchErrors(page, { dialogs: true });
  const me = await join(page.request, "Ines", { color: "plum" });
  const tam = await join(page.request, "Tam", { color: "leaf" });
  // Signed in once, not on every load, so swapping the key below sticks.
  await page.goto("/");
  await signIn(page, me, { now: true });
  await page.goto(`/r/${me.id}`);
  const link = page.locator("#invite-link");
  const openSheet = async () => {
    await page.getByRole("button", { name: "Invite someone" }).click();
    await expect(link).toContainText("/i/");
    return (await link.textContent()) ?? "";
  };
  const closeSheet = async () => {
    await page.locator(".invite-sheet").getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".invite-sheet")).toHaveCount(0);
  };

  await test.step("with no plot yet, sharing your home turns itself off and the plain link stays", async () => {
    const plain = await openSheet();
    const option = page.locator("#invite-share-home");
    // click, not check: the sheet unticks the box once the server answers, and check() fails
    // whenever that answer lands before it reads the box back.
    await option.click();
    await expect(option).not.toBeChecked();
    await expect(option).toBeDisabled();
    await expect(page.locator(".invite-sheet .check-hint")).toHaveText(
      "Settle a plot of your own first, then you can share it.",
    );
    await expect(link).toHaveText(plain);
    await expect(page.locator(".invite-copy")).toBeEnabled();
    await closeSheet();
  });

  await test.step("a link that went out is never offered again, and Make a new link makes one", async () => {
    // Never copied: the same link comes back.
    const first = await openSheet();
    await closeSheet();
    expect(await openSheet()).toBe(first);

    // Copied: the next open makes a fresh one, since each link works once.
    await page.locator(".invite-copy").click();
    await closeSheet();
    const second = await openSheet();
    expect(second).not.toBe(first);

    await page.getByRole("button", { name: "Make a new link" }).click();
    await expect(link).not.toHaveText(second);
    await expect(link).toContainText("/i/");
    await expect(page.locator(".invite-sheet [role=status]")).toHaveText(
      "Here's a new link. Links you already sent still work.",
    );
    await closeSheet();
  });

  await test.step("Use a different key checks the key, then swaps the character here", async () => {
    const saved = () =>
      page.evaluate(() => ({
        token: localStorage.getItem("terrakin.token"),
        id: localStorage.getItem("terrakin.resident"),
      }));
    await page.getByText("Use a different key").click();
    await page.locator("#switch-key").fill("not-a-real-key");
    await page.getByRole("button", { name: "Use this key" }).click();
    await expect(page.locator("#switch-key-error")).toContainText("doesn't open any character");
    expect(await saved()).toEqual({ token: me.token, id: me.id });

    await page.locator("#switch-key").fill(tam.token);
    await page.getByRole("button", { name: "Use this key" }).click();
    await expect(page).toHaveURL("/world");
    expect(await saved()).toEqual({ token: tam.token, id: tam.id });
  });

  expect(errors).toEqual([]);
});

test("Back from the world after accepting skips the invite, and a used invite offers a way in", async ({
  page,
  browser,
}) => {
  const errors = watchErrors(page, { dialogs: true });
  const host = await join(page.request, "Odile", { color: "sand" });
  const invite = async () => {
    const made = await page.request.post("/v1/invites", { headers: host.auth, data: {} });
    expect(made.status()).toBe(201);
    return (await made.json()).invite as { code: string; path: string };
  };

  // Accepting replaces the invite in history: Back goes to the page before it.
  const first = await invite();
  await page.goto("/town");
  await page.goto(first.path);
  await page.fill("#invite-name", "Pim");
  await page.getByRole("button", { name: "Move in" }).click();
  await expect(page).toHaveURL("/world");
  await page.goBack();
  await expect(page).toHaveURL("/town");

  // Someone else uses the link while the form is open: the expired card, with the way in.
  const other = await browser.newPage();
  const second = await invite();
  await other.goto(second.path);
  await other.fill("#invite-name", "Quill");
  const used = await page.request.post(`/v1/invites/${second.code}/accept`, {
    data: { name: "Rue", kind: "human" },
  });
  expect(used.ok()).toBe(true);
  await other.getByRole("button", { name: "Move in" }).click();
  await expect(
    other.getByRole("heading", { name: "This invite has expired or was already used" }),
  ).toBeVisible();
  await expect(other.getByRole("link", { name: "Step into the world" })).toHaveAttribute(
    "href",
    "/world",
  );
  await other.close();

  expect(errors).toEqual([]);
});
