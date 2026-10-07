import { defineConfig, devices } from "@playwright/test";
import {
  CLOCK_SPECS,
  clockPort,
  FAKE_CHAIN_PORT,
  FAKE_X_PORT,
  E2E_PORT as PORT,
  SWITCH_SPECS,
} from "./e2e/ports";
import { NIGHTLY, SHARDS, SMOKE_3D } from "./e2e/suite";

/** The fake X oEmbed endpoint that e2e/connect-x.spec.ts runs. Test servers only (decision 0022). */
const FAKE_X = `http://127.0.0.1:${FAKE_X_PORT}/oembed`;
/** The fake network and card host that e2e/partners.spec.ts runs (RFC 0007). Test servers only. */
const FAKE_CHAIN = `http://127.0.0.1:${FAKE_CHAIN_PORT}`;

/**
 * Test-only server settings. Every browser here shares one IP, so allow more joins a minute than
 * the real server does. The test clock lets specs move days on, and with the town's own events off
 * the calendar, a spec's moved clock never lands in the harvest night.
 */
const SERVER_ENV = {
  TERRAKIN_SESSIONS_PER_MINUTE: "60",
  TERRAKIN_STATIC_DIR: "packages/client/dist",
  TERRAKIN_TEST_X_OEMBED: FAKE_X,
  TERRAKIN_TEST_CHAIN: FAKE_CHAIN,
  TERRAKIN_TEST_CLOCK: "1",
  TERRAKIN_TOWN_EVENTS: "off",
};

const phone = { ...devices["iPhone 13"], browserName: "chromium" as const };

const specFile = (names: readonly string[]) => new RegExp(`/(${names.join("|")})\\.spec\\.ts$`);

/**
 * What a run covers (e2e/suite.ts). Unset runs what every push runs: the 2D specs, then the 3D
 * smoke. `2d` runs the 2D specs alone, narrowed to one of CI's shards by `TERRAKIN_E2E_SHARD`
 * (1 to 3); `3d` runs the 3D smoke alone; `nightly` runs the nightly 3D specs; `all` runs
 * everything.
 */
const only = process.env.TERRAKIN_E2E_ONLY;
const shard = process.env.TERRAKIN_E2E_SHARD;
const inShard: readonly string[] | undefined = shard ? SHARDS[Number(shard) - 1] : undefined;
if (shard && !inShard) throw new Error(`TERRAKIN_E2E_SHARD is 1 to ${SHARDS.length}, not ${shard}`);
const runs = (spec: string) => !inShard || inShard.includes(spec);

const clockSpecs = CLOCK_SPECS.filter(runs);
const switchSpecs = Object.entries(SWITCH_SPECS).filter(([spec]) => runs(spec));

const flat = [
  {
    name: "phone",
    ...(inShard ? { testMatch: specFile(inShard) } : {}),
    testIgnore: specFile([...CLOCK_SPECS, ...Object.keys(SWITCH_SPECS), ...SMOKE_3D, ...NIGHTLY]),
    use: phone,
  },
  // Specs that move the clock a day on each have a server of their own (e2e/ports.ts), so they
  // run beside everything else without expiring what other specs hold.
  ...clockSpecs.map((spec) => ({
    name: spec,
    testMatch: specFile([spec]),
    use: { ...phone, baseURL: `http://localhost:${clockPort(spec)}` },
  })),
  // Specs that switch something on for the whole world borrow a clock spec's server.
  ...switchSpecs.map(([spec, host]) => ({
    name: spec,
    testMatch: specFile([spec]),
    use: { ...phone, baseURL: `http://localhost:${clockPort(host)}` },
  })),
];

// The 3D specs draw every frame in software WebGL (SwiftShader), which takes a small CI runner's
// whole CPU. Beside other specs, or each other, their taps queue past the timeout, so they run
// after the rest, one at a time.
const smoke3d = {
  name: "smoke-3d",
  testMatch: specFile(SMOKE_3D),
  dependencies: only === "3d" ? [] : flat.map((p) => p.name),
  use: phone,
};
const nightly = [
  {
    name: "three-d",
    testMatch: specFile(["three-d"]),
    dependencies: only === "all" ? [smoke3d.name] : [],
    use: phone,
  },
  { name: "world-3d", testMatch: specFile(["world-3d"]), dependencies: ["three-d"], use: phone },
];

const projects =
  only === "2d"
    ? flat
    : only === "3d"
      ? [smoke3d]
      : only === "nightly"
        ? nightly
        : only === "all"
          ? [...flat, smoke3d, ...nightly]
          : [...flat, smoke3d];

/**
 * The client's build and every server the run needs, started by `e2e/servers.ts`: the clock specs'
 * servers boot while the client builds, and the main server, last, once both are done. The 3D
 * specs need only the main server, and a shard only the clock servers its specs use.
 */
const needsClock = only !== "3d" && only !== "nightly";
const clockHosts = new Set<(typeof CLOCK_SPECS)[number]>([
  ...clockSpecs,
  ...switchSpecs.map(([, host]) => host),
]);
const ports = needsClock ? [...[...clockHosts].map(clockPort), PORT] : [PORT];
const servers = {
  command: `node e2e/servers.ts ${ports.join(" ")}`,
  env: SERVER_ENV,
  url: `http://localhost:${PORT}/v1/health`,
  reuseExistingServer: false,
  timeout: 120_000,
};

/** Phone-first tests of the real build: the client served by the real server. */
export default defineConfig({
  testDir: "e2e",
  // A CI runner takes two to four times as long as a laptop for the same spec, and more with
  // other specs beside it, so CI gives each test twice the time. Locally a test still has 30
  // seconds, so one that grows too slow fails on the laptop first (decision 0109).
  timeout: process.env.CI ? 60_000 : 30_000,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects,
  webServer: servers,
});
