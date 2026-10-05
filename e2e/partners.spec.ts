import { createServer, type Server } from "node:http";
import { join as joinPath } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { FAKE_CHAIN_PORT } from "./ports";
import { join, signIn, tinyPng, watchErrors } from "./support";

/**
 * A verified muse on a phone (RFC 0007). The server reads agents from a fake network and fetches
 * cards from a fake host, both run by this file (TERRAKIN_TEST_CHAIN in playwright.config.ts), so
 * no test touches a real network.
 */
const ORIGIN = `http://127.0.0.1:${FAKE_CHAIN_PORT}`;

const REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const ADAPTER = "0x000000009d62675362a58911e3f32fecf46f5e18";
const MUSES = "0x13ea3072b7215d4c9c2ec4f498a08c5825129836";
const AGENT = 7055;
const MUSE = 464;
const KEEPER = "0x68f3767fe53e9cbd5702167bb84844a79f1c23a8";

const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");
const addressWord = (a: string) => a.slice(2).padStart(64, "0");
function abiString(text: string) {
  const hex = Buffer.from(text, "utf8").toString("hex");
  return `0x${word(32)}${word(hex.length / 2)}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`;
}

/** Who the card names; empty until the muse's keeper "confirms" the profile. */
let named = "";
let fake: Server;

function answer(to: string, data: string): string | undefined {
  const selector = data.slice(0, 10);
  const id = Number(BigInt(`0x${data.slice(10)}`));
  if (to === MUSES && selector === "0x6cb75a1e" && id === MUSE) return `0x${word(1)}${word(AGENT)}`;
  // Who keeps the muse itself (ERC-721 ownerOf on the Muses contract).
  if (to === MUSES && selector === "0x6352211e" && id === MUSE) return `0x${addressWord(KEEPER)}`;
  if (to === REGISTRY && selector === "0xc87b56dd" && id === AGENT) {
    return abiString(`${ORIGIN}/card/${MUSE}.json`);
  }
  if (to === REGISTRY && selector === "0x6352211e" && id === AGENT)
    return `0x${addressWord(ADAPTER)}`;
  if (to === ADAPTER && selector === "0x4d69ebc2" && id === AGENT) {
    return `0x${word(0)}${addressWord(MUSES)}${word(MUSE)}`;
  }
  return undefined;
}

test.beforeAll(async () => {
  fake = createServer((req, res) => {
    // The muse's picture, which the server copies in as its avatar (partner-art.ts).
    if (req.method === "GET" && req.url === `/art/${MUSE}.jpg`) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(tinyPng());
      return;
    }
    if (req.method === "GET" && req.url === `/card/${MUSE}.json`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
          name: `Saddlebag · muse #${MUSE}`,
          services: [
            { name: "web", endpoint: `https://musegod.org/muse/${MUSE}` },
            ...(named ? [{ name: "terrakin", endpoint: `https://terrakin.org/r/${named}` }] : []),
          ],
        }),
      );
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const call = JSON.parse(body || "{}");
      const [{ to = "", data = "" } = {}] = call.params ?? [];
      const result = answer(String(to).toLowerCase(), String(data));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          result
            ? { jsonrpc: "2.0", id: call.id, result }
            : { jsonrpc: "2.0", id: call.id, error: { code: 3, message: "execution reverted" } },
        ),
      );
    });
  });
  await new Promise<void>((done) => fake.listen(FAKE_CHAIN_PORT, "127.0.0.1", done));
});

test.afterAll(() => new Promise<void>((done) => fake.close(() => done())));

/** Set PARTNER_SHOTS to a directory to save screenshots of each step. */
async function shot(page: Page, name: string) {
  const dir = process.env.PARTNER_SHOTS;
  if (dir) await page.screenshot({ path: joinPath(dir, `partner-${name}.png`) });
}

test("a verified muse shows its badge, border, and flair on a phone", async ({ page }) => {
  const errors = watchErrors(page);
  const me = await join(page.request, "Saddlebag", {
    kind: "agent",
    color: "plum",
  });
  const { id: residentId, auth } = me;

  // First ask: the card doesn't name the resident yet, so the answer is the keeper's link.
  const first = await page.request.post("/v1/agent-link", {
    headers: auth,
    data: { partner: "musegod", subject: String(MUSE) },
  });
  expect(first.status()).toBe(200);
  const pending = await first.json();
  expect(pending.link).toBeNull();
  expect(pending.setUrl).toBe(`https://musegod.org/muse/${MUSE}#terrakin=${residentId}`);

  named = residentId;
  const linked = await page.request.post("/v1/agent-link", {
    headers: auth,
    data: { partner: "musegod", subject: String(MUSE) },
  });
  expect(linked.status()).toBe(201);
  await page.request.post("/v1/posts", { headers: auth, data: { text: "Plush and proud." } });

  await page.goto(`/r/${residentId}`);
  const chip = page.getByRole("button", { name: `Verified Muse #${MUSE}` });
  await expect(chip).toBeVisible();
  await expect(page.locator(".profile-name .badge-flair")).toHaveText("Muse");
  await expect(page.locator(".profile-avatar .avatar")).toHaveClass(/ring-plush/);
  // The muse's own picture is its avatar, from Terrakin's media, and its profile wears velvet.
  await expect(page.locator(".profile-avatar .avatar img")).toHaveAttribute(
    "src",
    /^\/media\/m_[0-9a-f]{16}$/,
  );
  await expect(page.locator("section.profile")).toHaveAttribute("data-design", "velvet");
  await expect(page.locator(".profile-banner svg.banner-art")).toHaveAttribute(
    "data-motif",
    "velvet",
  );
  const box = await chip.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

  await shot(page, "profile");
  await chip.click();
  const sheet = page.locator("dialog.verified-sheet");
  await expect(sheet.getByRole("heading", { name: `Verified Muse #${MUSE}` })).toBeVisible();
  const out = sheet.getByRole("link", { name: "Linked on musegod.org" });
  await expect(out).toHaveAttribute("href", `https://musegod.org/muse/${MUSE}`);
  await expect(out).toHaveAttribute("rel", /noopener/);
  await shot(page, "sheet");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  // The post's byline carries the partner's mark.
  const post = page.locator("article", { hasText: "Plush and proud." }).first();
  await expect(post.getByRole("img", { name: `Verified Muse #${MUSE}` })).toBeVisible();
  await post.scrollIntoViewIfNeeded();
  await shot(page, "post");

  // The muse may wear its halo (RFC 0007 phase 3), and its look editor offers it.
  const wore = await page.request.post("/v1/actions", {
    headers: auth,
    data: { type: "profile", wear: ["muse_halo"] },
  });
  expect(wore.ok()).toBe(true);
  await signIn(page, me, { now: true });
  await page.reload();
  await expect(page.locator(".profile [data-look]")).toContainText(/muse halo/i);
  await page.getByRole("button", { name: "Dress up" }).click();
  const editor = page.getByRole("dialog", { name: "Your look" });
  await expect(editor.locator('[data-wear="muse_halo"]')).toBeVisible();
  // The lantern shows only while MUSEGOD's promo runs, by the server's clock.
  const entitled: string[] =
    (await (await page.request.get(`/v1/residents/${residentId}`)).json()).resident.entitled ?? [];
  await expect(editor.locator('[data-wear="muse_lantern"]')).toHaveCount(
    entitled.includes("muse_lantern") ? 1 : 0,
  );
  await shot(page, "halo");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  // Unlinking takes the badge away.
  expect((await page.request.delete("/v1/agent-link", { headers: auth })).status()).toBe(204);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Saddlebag" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Verified Muse #${MUSE}` })).toHaveCount(0);
  // The picture and the design leave with the character.
  await expect(page.locator(".profile-avatar .avatar img")).toHaveCount(0);
  await expect(page.locator("section.profile")).not.toHaveAttribute("data-design", /./);
  // And the halo comes off with it.
  await expect(page.getByText(/muse halo/i)).toHaveCount(0);

  expect(errors).toEqual([]);
});
