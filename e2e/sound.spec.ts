import { expect, test } from "@playwright/test";
import { persona, signIn, watchErrors } from "./support";

/**
 * The world's sound at 390x844 (decision 0097): off by default, with no audio context and no sound
 * code until the speaker is tapped; on with that tap, remembered across a reload and started again
 * by the first tap anywhere; then quiet, then off. Headless Chromium mutes its output, so nothing
 * is heard while this runs.
 */
test("sound waits for the speaker, makes nothing before it, and is remembered", async ({
  page,
}) => {
  const errors = watchErrors(page, { console: "all" });
  // Every audio context the page makes, as its state.
  await page.addInitScript(() => {
    const made: AudioContext[] = [];
    (window as unknown as { __audio: AudioContext[] }).__audio = made;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        made.push(this);
      }
    };
  });
  const contexts = () =>
    page.evaluate(() =>
      (window as unknown as { __audio: AudioContext[] }).__audio.map((c) => c.state),
    );
  const soundCode: string[] = [];
  page.on("request", (r) => {
    if (/\/assets\/soundscape-/.test(r.url())) soundCode.push(r.url());
  });

  // The speaker comes in with a plot (decision 0234).
  const lark = await persona(page.request, "settled", { name: "Lark" });
  await signIn(page, lark);
  await page.goto("/world");
  await expect(page.locator("#world-loader")).toBeHidden();
  const speaker = page.getByRole("button", { name: /^Sound/ });
  await expect(speaker).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: "test-results/sound-off.png" });

  await test.step("off: walking makes no audio context and loads no sound code", async () => {
    await page.click('[data-dir="e"]');
    await page.keyboard.press("ArrowLeft");
    await page.click('[data-dir="n"]');
    expect(await contexts()).toEqual([]);
    expect(soundCode).toEqual([]);
    await expect(page.locator("audio, video")).toHaveCount(0);
  });

  await test.step("a tap on the speaker starts it, and loads the sound code then", async () => {
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-pressed", "true");
    await expect(speaker).toHaveAttribute("data-state", "playing");
    expect(await contexts()).toEqual(["running"]);
    await expect.poll(() => soundCode.length).toBe(1);
    await page.screenshot({ path: "test-results/sound-on.png" });
  });

  await test.step("a reload remembers it, and the first tap anywhere starts it again", async () => {
    await page.reload();
    await expect(speaker).toHaveAttribute("data-state", "waiting");
    await expect(speaker).toHaveAttribute("aria-pressed", "true");
    expect(await contexts()).toEqual([]);
    await page.click('[data-dir="s"]');
    await expect(speaker).toHaveAttribute("data-state", "playing");
    expect(await contexts()).toEqual(["running"]);
  });

  await test.step("then quiet, then off, which fades out and stays off after a reload", async () => {
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-label", "Sound, quiet");
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-pressed", "false");
    await expect.poll(contexts).toEqual(["suspended"]);
    await page.reload();
    await expect(page.locator("#hud")).toBeVisible();
    await expect(speaker).toHaveAttribute("aria-pressed", "false");
    await page.click('[data-dir="w"]');
    expect(await contexts()).toEqual([]);
  });

  expect(errors).toEqual([]);
});
