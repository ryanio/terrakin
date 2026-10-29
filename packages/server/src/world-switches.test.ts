/**
 * Which world switches each adapter runs. The adapters can't be imported here (`main.ts` starts a
 * server and the Worker needs workerd), so their `new WorldService({...})` is read as text.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORLD_SWITCHES } from "./world-switches";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The options an adapter passes `WorldService` with a literal value, and whether it spreads the shared ones. */
function switchesIn(source: string) {
  const block = /new WorldService\(\{([\s\S]*?)\n\s*\}\);/.exec(source)?.[1] ?? "";
  const own = [...block.matchAll(/^\s*(\w+):\s*(?:true|false|\d+),?$/gm)].map((m) => m[1]);
  return { spreads: block.match(/\.\.\.WORLD_SWITCHES\b/g)?.length ?? 0, own: own.sort() };
}

describe("world switches", () => {
  it("are the systems terrakin.org runs, with the plot market and the Worker's own left out", () => {
    // Decisions 0249, 0262, 0265, 0285, 0310, and 0373.
    expect(WORLD_SWITCHES).toMatchObject({
      recipes: true,
      holidayPrices: true,
      levels: true,
      jobs: true,
      jobEdition: 2,
      pageEdition: 3,
      circles: true,
    });
    for (const off of ["plotMarket", "clay", "lands", "retireRepeatJoins"]) {
      expect(WORLD_SWITCHES).not.toHaveProperty(off);
    }
  });

  it("reach both adapters once, and only the Worker adds pottery, lands, and the repeat-join cleanup", () => {
    const node = switchesIn(read("./main.ts"));
    const worker = switchesIn(read("../cloudflare/worker.ts"));
    expect(node).toEqual({ spreads: 1, own: [] });
    expect(worker).toEqual({ spreads: 1, own: ["clay", "lands", "retireRepeatJoins"] });
  });
});
