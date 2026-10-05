import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * MuseFelipe's acceptance test: a partner opens an invite link, picks a name, color, and shape,
 * lands on a plot next to the inviter with a starter home, the two follow each other, and the
 * partner sends a hug and a private letter, all in well under two minutes with no docs.
 */

const SCREENSHOTS = "test-results";

async function join(request: APIRequestContext, name: string, color: string) {
  const res = await request.post("/v1/session", { data: { name, kind: "human", color } });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return {
    id: body.residentId as string,
    token: body.token as string,
    auth: { authorization: `Bearer ${body.token}` },
  };
}

async function act(request: APIRequestContext, token: string, action: unknown) {
  const res = await request.post("/v1/actions", {
    headers: { authorization: `Bearer ${token}` },
    data: action,
  });
  return res.json();
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

test("a partner accepts an invite, moves in next door, and sends a hug and a letter", async ({
  page,
}) => {
  const errors = watchErrors(page);

  // The inviter lives here already: joined over the API, settled far from other tests, home built.
  const felipe = await join(page.request, "Felipe", "sky");
  expect((await act(page.request, felipe.token, { type: "settle", px: 7, py: 1 })).ok).toBe(true);
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(60_000);
  test.info().annotations.push({ type: "duo flow", description: `${elapsed} ms` });

  // Felipe sees both, over the API, and only he and Lina can read the letter.
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
  const stranger = await join(page.request, "Stranger", "coal");
  const peek = await page.request.get(`/v1/letters/${inbox.letters[0].id}`, {
    headers: stranger.auth,
  });
  expect(peek.status()).toBe(404);

  // Her letters page lists the conversation.
  await page.goto("/letters");
  await expect(page.locator(".conversation .conversation-name")).toHaveText("Felipe");
  await page.screenshot({ path: `${SCREENSHOTS}/duo-letters.png` });

  expect(errors).toEqual([]);
});

test("a visitor joins and follows from a profile, and the top bar shows who they are", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const host = await join(page.request, "Marisol", "leaf");

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

  // The avatar in the top bar opens your own profile, with your key and your look.
  await page.locator(".site-bar .you-link").click();
  await expect(page.locator(".you-tag")).toHaveText("This is you");
  await expect(
    page.getByRole("heading", { name: "Your character lives in this browser" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite someone" })).toBeVisible();

  // The Join pill on another page leads home, to the cards.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/r/${host.id}`);
  await page.locator(".site-bar .join-pill").click();
  await expect(page).toHaveURL("/#join");
  await expect(page.locator("#join")).toBeFocused();

  expect(errors).toEqual([]);
});

test("with no plot yet, sharing your home turns itself off and the plain link stays", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const me = await join(page.request, "Wren", "sun");
  await page.addInitScript(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token);
      localStorage.setItem("terrakin.resident", id);
    },
    [me.token, me.id] as const,
  );

  await page.goto(`/r/${me.id}`);
  await page.getByRole("button", { name: "Invite someone" }).click();
  const link = page.locator("#invite-link");
  await expect(link).toContainText("/i/");
  const plain = await link.textContent();

  const option = page.locator("#invite-share-home");
  await option.check();
  await expect(option).not.toBeChecked();
  await expect(option).toBeDisabled();
  await expect(page.locator(".invite-sheet .check-hint")).toHaveText(
    "Settle a plot of your own first, then you can share it.",
  );
  await expect(link).toHaveText(plain ?? "");
  await expect(page.locator(".invite-copy")).toBeEnabled();

  expect(errors).toEqual([]);
});

test("Use a different key checks the key, then swaps the character in this browser", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const sol = await join(page.request, "Sol", "sun");
  const tam = await join(page.request, "Tam", "leaf");
  const saved = () =>
    page.evaluate(() => ({
      token: localStorage.getItem("terrakin.token"),
      id: localStorage.getItem("terrakin.resident"),
    }));
  await page.goto("/");
  await page.evaluate(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token);
      localStorage.setItem("terrakin.resident", id);
    },
    [sol.token, sol.id] as const,
  );
  await page.goto(`/r/${sol.id}`);
  await page.getByText("Use a different key").click();

  await page.locator("#switch-key").fill("not-a-real-key");
  await page.getByRole("button", { name: "Use this key" }).click();
  await expect(page.locator("#switch-key-error")).toContainText("doesn't open any character");
  expect(await saved()).toEqual({ token: sol.token, id: sol.id });

  await page.locator("#switch-key").fill(tam.token);
  await page.getByRole("button", { name: "Use this key" }).click();
  await expect(page).toHaveURL("/world");
  expect(await saved()).toEqual({ token: tam.token, id: tam.id });

  expect(errors).toEqual([]);
});

test("a link that went out is never offered again, and Make a new link makes one", async ({
  page,
}) => {
  const errors = watchErrors(page);
  const me = await join(page.request, "Ines", "plum");
  await page.addInitScript(
    ([token, id]) => {
      localStorage.setItem("terrakin.token", token);
      localStorage.setItem("terrakin.resident", id);
    },
    [me.token, me.id] as const,
  );
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

  expect(errors).toEqual([]);
});

test("Back from the world after accepting skips the invite, and a used invite offers a way in", async ({
  page,
  browser,
}) => {
  const errors = watchErrors(page);
  const host = await join(page.request, "Odile", "sand");
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

test("a profile's counts open its followers, following, and friends", async ({ page }) => {
  const errors = watchErrors(page);
  const me = await join(page.request, "Lark", "sky");
  const wren = await join(page.request, "Wren", "leaf");
  const rue = await join(page.request, "Rue", "rose");
  const follow = (who: { auth: Record<string, string> }, id: string) =>
    page.request.put(`/v1/residents/${id}/follow`, { headers: who.auth });
  // Wren and Lark follow each other; Rue follows Lark, who doesn't follow back.
  await follow(wren, me.id);
  await follow(rue, me.id);
  await follow(me, wren.id);

  await page.goto(`/r/${me.id}`);
  await page.locator(".profile .stat-link", { hasText: "followers" }).click();
  await expect(page).toHaveURL(`/r/${me.id}/followers`);
  await expect(page.locator(".people-row .person-name")).toHaveText(["Rue", "Wren"]);

  await page.locator(".people-tab", { hasText: "Friends" }).click();
  await expect(page).toHaveURL(`/r/${me.id}/friends`);
  await expect(page.locator(".people-row .person-name")).toHaveText(["Wren"]);
  await expect(page.locator(".people-tab[aria-current=page]")).toContainText("1");

  // Tabs swap the history entry, so Back returns to the profile.
  await page.goBack();
  await expect(page).toHaveURL(`/r/${me.id}`);
  expect(errors).toEqual([]);
});
