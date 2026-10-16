/**
 * The Worker asks the cards Worker to draw (decision 0299). Nothing else can prove it: the bundle
 * builds and every card still comes out right with satori back in this Worker, and the only sign
 * is 3.5 MB of upload and the startup time in front of every page.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const worker = readFileSync(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");

describe("drawing from the Worker", () => {
  it("goes over the CARDS binding, never through a card engine of its own", () => {
    const imported = [...worker.matchAll(/from "([^"]+)";/g)].map((m) => m[1]);
    expect(imported).toContain("@terrakin/cards");
    expect(imported).not.toContain("@terrakin/cards/worker");
    expect(imported).not.toContain("@terrakin/cards/node");
    // The two places a card is drawn: the /og/...png route and PlotPhotos for the World object.
    expect(worker).toContain("env.CARDS.render(");
    expect(worker).toContain("this.env.CARDS.render(");
  });

  it("binds CARDS to the Worker wrangler.cards.jsonc deploys", () => {
    const cards = repo("wrangler.cards.jsonc");
    const name = /"name":\s*"([^"]+)"/.exec(cards)?.[1];
    expect(name).toBeTruthy();
    expect(cards).toContain('"main": "packages/cards/cloudflare/worker.ts"');
    expect(repo("wrangler.jsonc")).toContain(`{ "binding": "CARDS", "service": "${name}" }`);
  });
});
