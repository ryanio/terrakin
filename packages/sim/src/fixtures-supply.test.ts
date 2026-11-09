import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { inventoryMaxOf, inventorySize } from "./items";
import { expectSupplyHolds } from "./test-support";
import type { Input, WorldConfig, WorldState } from "./types";
import { createWorld } from "./world";

/**
 * Every fixture log keeps the coin supply identity, no negative purse or treasury, and no
 * inventory past the cap after every input, not only at its end. A rule that mints, burns, or
 * moves a coin or a thing out of order shows up here even when a later input happens to put it
 * right before the pinned hash is taken.
 */

type Fixture = { name: string; config: WorldConfig; log: Input[] };

const fixtures: Fixture[] = await Promise.all(
  readdirSync(new URL("./fixtures/", import.meta.url))
    .filter((file) => file.endsWith("-log.ts"))
    .sort()
    .map(async (file) => {
      const mod = (await import(`./fixtures/${file}`)) as Record<string, unknown>;
      const logName = Object.keys(mod).find((key) => key.endsWith("_LOG"));
      if (!logName) throw new Error(`${file} exports no _LOG`);
      const config = mod[logName.replace(/_LOG$/, "_CONFIG")] as WorldConfig | undefined;
      if (!config) throw new Error(`${file} exports no config for ${logName}`);
      return { name: file, config, log: mod[logName] as Input[] };
    }),
);

/** What's wrong with the world's coins and things right now, as words; empty when nothing is. */
function problems(state: WorldState): string[] {
  const out: string[] = [];
  try {
    expectSupplyHolds(state);
  } catch (error) {
    out.push(`supply: ${(error as Error).message.split("\n")[0]}`);
  }
  const econ = state.economy;
  if (econ) {
    for (const [id, n] of Object.entries(econ.coins)) if (n < 0) out.push(`${id} has ${n} coins`);
    if (econ.treasury < 0) out.push(`the treasury has ${econ.treasury} coins`);
  }
  const max = inventoryMaxOf(state);
  for (const [id, inv] of Object.entries(state.items?.inventories ?? {})) {
    const size = inventorySize(inv);
    if (size > max) out.push(`${id} holds ${size} things, past ${max}`);
  }
  return out;
}

describe("every fixture log", () => {
  it("covers every fixture", () => {
    expect(fixtures.length).toBeGreaterThan(40);
  });

  for (const { name, config, log } of fixtures) {
    it(`keeps the coins adding up and every inventory under the cap after each input of ${name}`, () => {
      const state = createWorld(config);
      const wrong: string[] = [];
      for (const [i, input] of log.entries()) {
        const result = apply(state, input);
        if (!result.ok) throw new Error(`${name} refused input ${i}, ${input.command.type}`);
        for (const problem of problems(state))
          wrong.push(`input ${i} (${input.command.type}): ${problem}`);
      }
      expect(wrong).toEqual([]);
    });
  }
});
