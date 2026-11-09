import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { hashWorld } from "./hash";
import { REPLAY_VERSION, replay } from "./replay";
import type { Input, WorldConfig } from "./types";
import { createWorld } from "./world";

/**
 * A world snapshot (RFC 0014) is the state at some `seq` written with `JSON.stringify` and read
 * back with `JSON.parse`, and a boot applies the rest of the log to it. That has to make exactly
 * the world, and exactly the events, a straight replay makes. This catches a rule that depends on
 * something outside the state, or on the order records were made in beyond what JSON keeps.
 */

type Fixture = { name: string; config: WorldConfig; log: Input[] };

/** Every fixture log in `fixtures/`: each file exports a `*_LOG` and its `*_CONFIG`. */
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

describe("REPLAY_VERSION", () => {
  it("is a whole number, bumped only by an RFC that changes how logs replay", () => {
    expect(REPLAY_VERSION).toBe(2);
  });
});

describe("a snapshot plus the rest of the log", () => {
  it("covers every fixture log", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  for (const { name, config, log } of fixtures) {
    it(`matches a straight replay at every split point of ${name}`, () => {
      // The straight replay: every input's events as bytes, and the final hash.
      const straight = createWorld(config);
      const events: string[] = [];
      const prefixes: string[] = [JSON.stringify(straight)];
      for (const input of log) {
        const result = apply(straight, input);
        if (!result.ok) throw new Error(`${name} refused ${input.command.type}`);
        events.push(JSON.stringify(result.events));
        prefixes.push(JSON.stringify(straight));
      }
      const want = hashWorld(straight);
      expect(hashWorld(replay(config, log))).toBe(want);

      // One step from each snapshot: read back at `k`, input `k` must give exactly the straight
      // replay's events and the straight replay's next snapshot. By induction from `k = 0`, a
      // boot from any split point then walks the same bytes to the same final world. The snapshot
      // at the end equals the straight world's bytes, so its hash is `want` too.
      const wrong: string[] = [];
      for (let k = 0; k < log.length; k++) {
        const state = JSON.parse(prefixes[k] as string);
        const result = apply(state, log[k] as Input);
        if (!result.ok) {
          wrong.push(`input ${k}: refused ${result.rejection.code}`);
          continue;
        }
        if (JSON.stringify(result.events) !== events[k]) wrong.push(`input ${k}: events differ`);
        if (JSON.stringify(state) !== prefixes[k + 1]) wrong.push(`input ${k}: world differs`);
      }
      expect(wrong, name).toEqual([]);
      expect(hashWorld(JSON.parse(prefixes[log.length] as string))).toBe(want);
    });
  }
});
