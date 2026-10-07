/**
 * Ports for the e2e servers and the fakes they talk to. A suite uses ten ports from
 * TERRAKIN_E2E_PORT (default 8790), so set it ten or more apart to run a second suite at once (from
 * another worktree, say).
 */
export const E2E_PORT = Number(process.env.TERRAKIN_E2E_PORT ?? 8790);
export const FAKE_X_PORT = E2E_PORT + 1;
export const FAKE_CHAIN_PORT = E2E_PORT + 2;

/**
 * Specs that move the server clock a day or more on. That would expire what other specs hold (an X
 * connect code, say), so each gets a server of its own on the port after the fakes, and they all
 * run beside everything else.
 */
export const CLOCK_SPECS = [
  "town",
  "coins",
  "praise",
  "make",
  "shop",
  "market",
  "bounties",
] as const;

export const clockPort = (spec: (typeof CLOCK_SPECS)[number]) =>
  E2E_PORT + 3 + CLOCK_SPECS.indexOf(spec);

/**
 * Specs that flip a one-time switch for the whole world, like recipes opening (RFC 0024): on the
 * main server they would change what every other spec sees. Each borrows the server of a clock spec
 * that never meets what it turns on, so the suite still fits in ten ports.
 */
export const SWITCH_SPECS = { recipes: "bounties" } as const satisfies Record<
  string,
  (typeof CLOCK_SPECS)[number]
>;
